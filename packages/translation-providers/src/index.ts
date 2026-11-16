import {
  TranslationRequestSchema,
  type TranslationRequest,
  type TranslationResult,
} from '@lexistream/shared-types';
import { normalizeToken } from '@lexistream/language-core';
import {
  BoundedLruCache,
  IndexedDbTranslationCache,
  type TranslationPersistentCache,
} from './cache';
import { ContextualLexicalProvider } from './lexical-provider';
import { BackendProxyTranslationProvider, type BackendProxyOptions } from './backend-proxy-provider';
import {
  parseWiktionaryDslTxt,
  synthesizeBridgeDictionary,
  mapWiktionaryPos,
  type WiktionaryHeadwordEntry,
  type WiktionarySenseItem,
} from './wiktionary-parser';
import {
  WIKTIONARY_DICTIONARY_CATALOG,
  WiktionaryDictionaryStore,
  type WiktionaryCatalogEntry,
  type InstalledDictionaryPack,
  type DictionaryDownloadProgress,
  type StoredDictionaryRecord,
} from './wiktionary-store';
import {
  OfflineWiktionaryProvider,
  LiveWiktionaryApiProvider,
  type LiveWiktionaryApiOptions,
} from './wiktionary-providers';

export {
  BoundedLruCache,
  IndexedDbTranslationCache,
  type TranslationPersistentCache,
  ContextualLexicalProvider,
  BackendProxyTranslationProvider,
  type BackendProxyOptions,
  parseWiktionaryDslTxt,
  synthesizeBridgeDictionary,
  mapWiktionaryPos,
  type WiktionaryHeadwordEntry,
  type WiktionarySenseItem,
  WIKTIONARY_DICTIONARY_CATALOG,
  WiktionaryDictionaryStore,
  type WiktionaryCatalogEntry,
  type InstalledDictionaryPack,
  type DictionaryDownloadProgress,
  type StoredDictionaryRecord,
  OfflineWiktionaryProvider,
  LiveWiktionaryApiProvider,
  type LiveWiktionaryApiOptions,
};

export interface TranslationProvider {
  readonly id: string;
  translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult>;
}

export interface TranslationServiceOptions {
  providers: TranslationProvider[];
  persistentCache?: TranslationPersistentCache;
  memoryCacheSize?: number;
}

function hashContext(context: string): string {
  const normalized = context.trim().toLowerCase();
  // Fast deterministic FNV-1a 32-bit hash for compact cache keys
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function buildTranslationCacheKey(req: TranslationRequest): string {
  const normWord = normalizeToken(req.word, req.source_language);
  const ctxHash = hashContext(req.context);
  const offsetPart = req.word_offset !== undefined ? `:${req.word_offset}` : '';
  return `${req.source_language}:${req.target_language}:${normWord}:${ctxHash}${offsetPart}`;
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name ?? '';
  const msg = (err as { message?: string }).message ?? '';
  return name === 'AbortError' || /abort/i.test(msg);
}

export class TranslationService {
  private readonly providers: TranslationProvider[];
  private readonly memoryCache: BoundedLruCache<TranslationResult>;
  private readonly persistentCache?: TranslationPersistentCache;
  private readonly inFlight = new Map<string, Promise<TranslationResult>>();
  private broadcastChannel: BroadcastChannel | null = null;

  constructor(options: TranslationServiceOptions) {
    if (options.providers.length === 0) {
      throw new Error('TranslationService requires at least one provider');
    }
    this.providers = options.providers;
    this.memoryCache = new BoundedLruCache<TranslationResult>(options.memoryCacheSize ?? 512);
    this.persistentCache = options.persistentCache;

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel('lexistream-events');
        this.broadcastChannel.onmessage = (ev: MessageEvent<{ type?: string }>) => {
          if (ev.data?.type === 'dictionary_changed') {
            void this.clearCaches();
          }
        };
      } catch {
        this.broadcastChannel = null;
      }
    }
  }

  async clearCaches(): Promise<void> {
    this.memoryCache.clear();
    if (this.persistentCache) {
      await this.persistentCache.clear();
    }
  }

  async translate(
    rawRequest: TranslationRequest,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    if (signal?.aborted) {
      throw new DOMException('Translation request aborted', 'AbortError');
    }

    const request = TranslationRequestSchema.parse(rawRequest);
    const cacheKey = buildTranslationCacheKey(request);

    // Tier 1: O(1) Memory LRU Cache (ignore stale untranslated fallback entries)
    const memHit = this.memoryCache.get(cacheKey);
    if (memHit && memHit.provider !== 'local-fallback-untranslated') {
      return { ...memHit, cached: true };
    }

    // Tier 2: Persistent IndexedDB Cache
    if (this.persistentCache) {
      const diskHit = await this.persistentCache.get(cacheKey);
      if (signal?.aborted) {
        throw new DOMException('Translation request aborted', 'AbortError');
      }
      if (diskHit && diskHit.provider !== 'local-fallback-untranslated') {
        const marked = { ...diskHit, cached: true };
        this.memoryCache.set(cacheKey, marked);
        return marked;
      }
    }

    // In-flight request deduplication
    const existingPromise = this.inFlight.get(cacheKey);
    if (existingPromise) {
      return await this.raceWithAbort(existingPromise, signal);
    }

    const task = this.executeProviderChain(request, cacheKey, signal);
    this.inFlight.set(cacheKey, task);

    try {
      return await this.raceWithAbort(task, signal);
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private async executeProviderChain(
    request: TranslationRequest,
    cacheKey: string,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    let lastError: unknown;
    for (const provider of this.providers) {
      if (signal?.aborted) {
        throw new DOMException('Translation request aborted', 'AbortError');
      }
      try {
        const result = await provider.translate(request, signal);
        // Never poison persistent or memory cache with untranslated emergency placeholders
        if (result.provider !== 'local-fallback-untranslated') {
          this.memoryCache.set(cacheKey, result);
          if (this.persistentCache) {
            await this.persistentCache.set(cacheKey, result);
          }
        }
        return result;
      } catch (err) {
        if (isAbortError(err) && signal?.aborted) {
          throw err;
        }
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('All translation providers failed');
  }

  private raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) {
      return Promise.reject(new DOMException('Translation request aborted', 'AbortError'));
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () =>
        reject(new DOMException('Translation request aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (val) => {
          signal.removeEventListener('abort', onAbort);
          resolve(val);
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  }
}
