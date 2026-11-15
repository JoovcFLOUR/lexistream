import { describe, expect, it, vi } from 'vitest';
import {
  BoundedLruCache,
  ContextualLexicalProvider,
  BackendProxyTranslationProvider,
  IndexedDbTranslationCache,
  TranslationService,
  type TranslationProvider,
} from './index';
import type { TranslationRequest, TranslationResult } from '@lexistream/shared-types';

describe('@lexistream/translation-providers', () => {
  it('disambiguates polysemous words using sentence context and returns multiple meanings', async () => {
    const provider = new ContextualLexicalProvider();

    const verbRes = await provider.translate({
      word: 'thought',
      context: 'I never thought this would happen.',
      source_language: 'en',
      target_language: 'pt',
    });
    expect(verbRes.lemma).toBe('think');
    expect(verbRes.part_of_speech).toBe('verb');
    expect(verbRes.contextual_translation).toBe('pensei / pensou');
    expect(verbRes.context_translation).toBe('Eu nunca pensei que isso aconteceria.');
    expect(verbRes.meanings.length).toBeGreaterThanOrEqual(2);

    const nounRes = await provider.translate({
      word: 'thought',
      context: 'That was a fascinating thought about language.',
      source_language: 'en',
      target_language: 'pt',
    });
    expect(nounRes.lemma).toBe('thought');
    expect(nounRes.part_of_speech).toBe('noun');
    expect(nounRes.contextual_translation).toBe('pensamento');

    const riverBank = await provider.translate({
      word: 'bank',
      context: 'We sat quietly by the river bank.',
      source_language: 'en',
      target_language: 'pt',
    });
    expect(riverBank.contextual_translation).toBe('margem');

    const moneyBank = await provider.translate({
      word: 'bank',
      context: 'She deposited her salary at the central bank.',
      source_language: 'en',
      target_language: 'pt',
    });
    expect(moneyBank.contextual_translation).toBe('banco');
  });

  it('evicts oldest entries in BoundedLruCache when capacity is exceeded', () => {
    const lru = new BoundedLruCache<TranslationResult>(2);
    const dummy = (w: string): TranslationResult => ({
      word: w,
      lemma: w,
      part_of_speech: 'noun',
      contextual_translation: w,
      definition: '',
      context_sentence: '',
      context_translation: '',
      meanings: [],
      provider: 'mock',
      cached: false,
    });

    lru.set('k1', dummy('one'));
    lru.set('k2', dummy('two'));
    // Touch k1 so k2 becomes least-recently-used
    expect(lru.get('k1')?.word).toBe('one');
    lru.set('k3', dummy('three'));

    expect(lru.get('k2')).toBeUndefined();
    expect(lru.get('k1')?.word).toBe('one');
    expect(lru.get('k3')?.word).toBe('three');
  });

  it('deduplicates concurrent identical requests and caches across LRU + IndexedDB', async () => {
    let providerCalls = 0;
    const slowProvider: TranslationProvider = {
      id: 'counting-provider',
      async translate(req: TranslationRequest): Promise<TranslationResult> {
        providerCalls++;
        await new Promise((r) => setTimeout(r, 25));
        return {
          word: req.word,
          lemma: req.word.toLowerCase(),
          part_of_speech: 'noun',
          contextual_translation: 'olá',
          definition: 'A greeting.',
          context_sentence: req.context,
          context_translation: 'Olá mundo!',
          meanings: [],
          provider: 'counting-provider',
          cached: false,
        };
      },
    };

    const idbCache = new IndexedDbTranslationCache('test-trans-cache-db');
    const service = new TranslationService({
      providers: [slowProvider],
      persistentCache: idbCache,
      memoryCacheSize: 64,
    });

    const req: TranslationRequest = {
      word: 'hello',
      context: 'Hello world!',
      source_language: 'en',
      target_language: 'pt',
    };

    // Fire 3 concurrent requests for the exact same word + context
    const [r1, r2, r3] = await Promise.all([
      service.translate(req),
      service.translate(req),
      service.translate(req),
    ]);

    expect(providerCalls).toBe(1);
    expect(r1.contextual_translation).toBe('olá');
    expect(r2.contextual_translation).toBe('olá');
    expect(r3.contextual_translation).toBe('olá');

    // Subsequent call hits warm cache with cached: true and zero provider invocations
    const cachedHit = await service.translate(req);
    expect(cachedHit.cached).toBe(true);
    expect(providerCalls).toBe(1);

    // Even a brand-new TranslationService instance (cold memory, warm IndexedDB) hits IndexedDB!
    const coldMemoryService = new TranslationService({
      providers: [slowProvider],
      persistentCache: idbCache,
      memoryCacheSize: 64,
    });
    const idbHit = await coldMemoryService.translate(req);
    expect(idbHit.cached).toBe(true);
    expect(providerCalls).toBe(1);
  });

  it('cancels outdated requests via AbortSignal and falls back gracefully when primary provider fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network offline'));
    const proxyProvider = new BackendProxyTranslationProvider({
      baseUrl: 'http://127.0.0.1:8787',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const fallbackLexical = new ContextualLexicalProvider();

    const service = new TranslationService({
      providers: [proxyProvider, fallbackLexical],
      memoryCacheSize: 32,
    });

    // Primary fails -> fallback succeeds transparently
    const fallbackResult = await service.translate({
      word: 'thought',
      context: 'I never thought this would happen.',
      source_language: 'en',
      target_language: 'pt',
    });
    expect(fallbackResult.provider).toBe('local-contextual-lexicon');
    expect(fallbackResult.lemma).toBe('think');

    // Aborted signal rejects immediately without caching partial state
    const abortController = new AbortController();
    abortController.abort();
    await expect(
      service.translate(
        {
          word: 'never',
          context: 'Never give up.',
          source_language: 'en',
          target_language: 'pt',
        },
        abortController.signal,
      ),
    ).rejects.toThrow(/abort/i);
  });
});
