import type { LanguageCode } from '@lexistream/shared-types';
import { normalizeToken } from '@lexistream/language-core';
import {
  parseWiktionaryDslTxt,
  synthesizeBridgeDictionary,
  type WiktionaryHeadwordEntry,
  type WiktionarySenseItem,
} from './wiktionary-parser';

export interface WiktionaryCatalogEntry {
  pairId: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  title: string;
  estimatedSizeMb: number;
  estimatedEntries: number;
  license: string;
  licenseUrl: string;
  attributionUrl: string;
  downloadUrls: [string] | [string, string];
}

export interface InstalledDictionaryPack {
  pairId: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  title: string;
  entryCount: number;
  byteSize: number;
  license: string;
  installedAt: string;
}

export interface DictionaryDownloadProgress {
  pairId: string;
  phase: 'downloading' | 'indexing' | 'complete';
  percent: number;
  detail: string;
}

const RAW_WIKTIONARY_BASE =
  'https://raw.githubusercontent.com/open-dsl-dict/wiktionary-dict/master/src';

/**
 * Available Wiktionary Creative Commons dictionaries.
 * None of these are pre-installed; each is downloaded into IndexedDB strictly when the user clicks Download.
 */
export const WIKTIONARY_DICTIONARY_CATALOG: readonly WiktionaryCatalogEntry[] = [
  {
    pairId: 'en-pt',
    sourceLanguage: 'en',
    targetLanguage: 'pt',
    title: 'Inglês → Português (English → Portuguese)',
    estimatedSizeMb: 2.8,
    estimatedEntries: 44700,
    license: 'CC BY-SA 3.0 / 4.0 (Wiktionary)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attributionUrl: 'https://en.wiktionary.org/',
    downloadUrls: [`${RAW_WIKTIONARY_BASE}/en-pt-enwiktionary.txt`],
  },
  {
    pairId: 'pt-en',
    sourceLanguage: 'pt',
    targetLanguage: 'en',
    title: 'Português → Inglês (Portuguese → English)',
    estimatedSizeMb: 2.6,
    estimatedEntries: 41200,
    license: 'CC BY-SA 3.0 / 4.0 (Wiktionary)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attributionUrl: 'https://en.wiktionary.org/',
    downloadUrls: [`${RAW_WIKTIONARY_BASE}/pt-en-enwiktionary.txt`],
  },
  {
    pairId: 'fr-pt',
    sourceLanguage: 'fr',
    targetLanguage: 'pt',
    title: 'Francês → Português (French → Portuguese)',
    estimatedSizeMb: 5.3,
    estimatedEntries: 31500,
    license: 'CC BY-SA 3.0 / 4.0 (Wiktionary)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attributionUrl: 'https://en.wiktionary.org/',
    downloadUrls: [
      `${RAW_WIKTIONARY_BASE}/fr-en-enwiktionary.txt`,
      `${RAW_WIKTIONARY_BASE}/en-pt-enwiktionary.txt`,
    ],
  },
  {
    pairId: 'fr-en',
    sourceLanguage: 'fr',
    targetLanguage: 'en',
    title: 'Francês → Inglês (French → English)',
    estimatedSizeMb: 2.5,
    estimatedEntries: 39400,
    license: 'CC BY-SA 3.0 / 4.0 (Wiktionary)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attributionUrl: 'https://en.wiktionary.org/',
    downloadUrls: [`${RAW_WIKTIONARY_BASE}/fr-en-enwiktionary.txt`],
  },
  {
    pairId: 'en-fr',
    sourceLanguage: 'en',
    targetLanguage: 'fr',
    title: 'Inglês → Francês (English → French)',
    estimatedSizeMb: 4.2,
    estimatedEntries: 62000,
    license: 'CC BY-SA 3.0 / 4.0 (Wiktionary)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attributionUrl: 'https://en.wiktionary.org/',
    downloadUrls: [`${RAW_WIKTIONARY_BASE}/en-fr-enwiktionary.txt`],
  },
  {
    pairId: 'es-pt',
    sourceLanguage: 'es',
    targetLanguage: 'pt',
    title: 'Espanhol → Português (Spanish → Portuguese)',
    estimatedSizeMb: 5.1,
    estimatedEntries: 29800,
    license: 'CC BY-SA 3.0 / 4.0 (Wiktionary)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attributionUrl: 'https://en.wiktionary.org/',
    downloadUrls: [
      `${RAW_WIKTIONARY_BASE}/es-en-enwiktionary.txt`,
      `${RAW_WIKTIONARY_BASE}/en-pt-enwiktionary.txt`,
    ],
  },
  {
    pairId: 'es-en',
    sourceLanguage: 'es',
    targetLanguage: 'en',
    title: 'Espanhol → Inglês (Spanish → English)',
    estimatedSizeMb: 2.3,
    estimatedEntries: 36100,
    license: 'CC BY-SA 3.0 / 4.0 (Wiktionary)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attributionUrl: 'https://en.wiktionary.org/',
    downloadUrls: [`${RAW_WIKTIONARY_BASE}/es-en-enwiktionary.txt`],
  },
  {
    pairId: 'en-es',
    sourceLanguage: 'en',
    targetLanguage: 'es',
    title: 'Inglês → Espanhol (English → Spanish)',
    estimatedSizeMb: 3.7,
    estimatedEntries: 56000,
    license: 'CC BY-SA 3.0 / 4.0 (Wiktionary)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attributionUrl: 'https://en.wiktionary.org/',
    downloadUrls: [`${RAW_WIKTIONARY_BASE}/en-es-enwiktionary.txt`],
  },
  {
    pairId: 'en-de',
    sourceLanguage: 'en',
    targetLanguage: 'de',
    title: 'Inglês → Alemão (English → German)',
    estimatedSizeMb: 4.0,
    estimatedEntries: 58500,
    license: 'CC BY-SA 3.0 / 4.0 (Wiktionary)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attributionUrl: 'https://en.wiktionary.org/',
    downloadUrls: [`${RAW_WIKTIONARY_BASE}/en-de-enwiktionary.txt`],
  },
  {
    pairId: 'it-pt',
    sourceLanguage: 'it',
    targetLanguage: 'pt',
    title: 'Italiano → Português (Italian → Portuguese)',
    estimatedSizeMb: 7.9,
    estimatedEntries: 38000,
    license: 'CC BY-SA 3.0 / 4.0 (Wiktionary)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attributionUrl: 'https://en.wiktionary.org/',
    downloadUrls: [
      `${RAW_WIKTIONARY_BASE}/it-en-enwiktionary.txt`,
      `${RAW_WIKTIONARY_BASE}/en-pt-enwiktionary.txt`,
    ],
  },
  {
    pairId: 'it-en',
    sourceLanguage: 'it',
    targetLanguage: 'en',
    title: 'Italiano → Inglês (Italian → English)',
    estimatedSizeMb: 5.1,
    estimatedEntries: 70200,
    license: 'CC BY-SA 3.0 / 4.0 (Wiktionary)',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attributionUrl: 'https://en.wiktionary.org/',
    downloadUrls: [`${RAW_WIKTIONARY_BASE}/it-en-enwiktionary.txt`],
  },
];

const PACKS_STORE = 'installed_packs';
const ENTRIES_STORE = 'entries';

export interface StoredDictionaryRecord {
  key: string;
  pairId: string;
  headword: string;
  senses: WiktionarySenseItem[];
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Dictionary IDB transaction aborted'));
  });
}

export class WiktionaryDictionaryStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(
    public readonly dbName = 'lexistream-wiktionary-dicts-v1',
    fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PACKS_STORE)) {
          db.createObjectStore(PACKS_STORE, { keyPath: 'pairId' });
        }
        if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
          const store = db.createObjectStore(ENTRIES_STORE, { keyPath: 'key' });
          store.createIndex('by_pair', 'pairId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Failed to open Wiktionary IndexedDB'));
    });
    return this.dbPromise;
  }

  async listInstalledPacks(): Promise<InstalledDictionaryPack[]> {
    const db = await this.getDb();
    const tx = db.transaction(PACKS_STORE, 'readonly');
    const packs = (await idbReq(
      tx.objectStore(PACKS_STORE).getAll(),
    )) as InstalledDictionaryPack[];
    return packs.sort((a, b) => a.pairId.localeCompare(b.pairId));
  }

  async isPackInstalled(pairId: string): Promise<boolean> {
    const db = await this.getDb();
    const tx = db.transaction(PACKS_STORE, 'readonly');
    const found = await idbReq(tx.objectStore(PACKS_STORE).get(pairId));
    return Boolean(found);
  }

  async lookupEntry(
    pairId: string,
    word: string,
    sourceLanguage: LanguageCode,
  ): Promise<StoredDictionaryRecord | undefined> {
    const norm = normalizeToken(word, sourceLanguage);
    if (!norm) return undefined;
    const db = await this.getDb();
    const tx = db.transaction(ENTRIES_STORE, 'readonly');
    return (await idbReq(
      tx.objectStore(ENTRIES_STORE).get(`${pairId}::${norm}`),
    )) as StoredDictionaryRecord | undefined;
  }

  async downloadPack(
    pairId: string,
    onProgress?: (progress: DictionaryDownloadProgress) => void,
  ): Promise<InstalledDictionaryPack> {
    const catalogEntry = WIKTIONARY_DICTIONARY_CATALOG.find((c) => c.pairId === pairId);
    if (!catalogEntry) {
      throw new Error(`Unknown Wiktionary dictionary pair: ${pairId}`);
    }

    onProgress?.({
      pairId,
      phase: 'downloading',
      percent: 5,
      detail: `Downloading ${catalogEntry.title} from Wiktionary…`,
    });

    const downloadedTexts: string[] = [];
    let totalBytes = 0;

    for (let i = 0; i < catalogEntry.downloadUrls.length; i++) {
      const url = catalogEntry.downloadUrls[i]!;
      const resp = await this.fetchImpl(url);
      if (!resp.ok) {
        throw new Error(`Failed to download Wiktionary pack (${resp.status}) from ${url}`);
      }
      const text = await resp.text();
      totalBytes += text.length;
      downloadedTexts.push(text);

      const dlPct = Math.round(((i + 1) / catalogEntry.downloadUrls.length) * 45);
      onProgress?.({
        pairId,
        phase: 'downloading',
        percent: dlPct,
        detail: `Downloaded ${(totalBytes / (1024 * 1024)).toFixed(1)} MB…`,
      });
    }

    onProgress?.({
      pairId,
      phase: 'indexing',
      percent: 55,
      detail: 'Parsing Wiktionary headwords & senses…',
    });

    let finalMap: Map<string, WiktionaryHeadwordEntry>;
    if (downloadedTexts.length === 1) {
      finalMap = parseWiktionaryDslTxt(
        downloadedTexts[0]!,
        catalogEntry.sourceLanguage,
        catalogEntry.targetLanguage,
      );
    } else {
      const srcToEn = parseWiktionaryDslTxt(
        downloadedTexts[0]!,
        catalogEntry.sourceLanguage,
        'en',
      );
      const enToTgt = parseWiktionaryDslTxt(
        downloadedTexts[1]!,
        'en',
        catalogEntry.targetLanguage,
      );
      finalMap = synthesizeBridgeDictionary(srcToEn, enToTgt, 'en');
    }

    // Remove any stale records for this pair before batch-inserting fresh entries
    await this.removePack(pairId);

    const allEntries = Array.from(finalMap.values());
    const db = await this.getDb();
    const BATCH_SIZE = 8000;

    for (let offset = 0; offset < allEntries.length; offset += BATCH_SIZE) {
      const slice = allEntries.slice(offset, offset + BATCH_SIZE);
      const tx = db.transaction(ENTRIES_STORE, 'readwrite');
      const store = tx.objectStore(ENTRIES_STORE);
      for (const entry of slice) {
        store.put({
          key: `${pairId}::${entry.normalized}`,
          pairId,
          headword: entry.headword,
          senses: entry.senses,
        } satisfies StoredDictionaryRecord);
      }
      await idbTx(tx);

      const idxPct = 60 + Math.round(((offset + slice.length) / Math.max(1, allEntries.length)) * 35);
      onProgress?.({
        pairId,
        phase: 'indexing',
        percent: Math.min(98, idxPct),
        detail: `Indexed ${Math.min(offset + slice.length, allEntries.length)} / ${allEntries.length} headwords…`,
      });
    }

    const packMeta: InstalledDictionaryPack = {
      pairId,
      sourceLanguage: catalogEntry.sourceLanguage,
      targetLanguage: catalogEntry.targetLanguage,
      title: catalogEntry.title,
      entryCount: allEntries.length,
      byteSize: totalBytes,
      license: catalogEntry.license,
      installedAt: new Date().toISOString(),
    };

    const metaTx = db.transaction(PACKS_STORE, 'readwrite');
    metaTx.objectStore(PACKS_STORE).put(packMeta);
    await idbTx(metaTx);

    onProgress?.({
      pairId,
      phase: 'complete',
      percent: 100,
      detail: `Installed ${allEntries.length} Wiktionary entries`,
    });

    this.emitDictionaryChanged(pairId);
    return packMeta;
  }

  async removePack(pairId: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction([PACKS_STORE, ENTRIES_STORE], 'readwrite');
    tx.objectStore(PACKS_STORE).delete(pairId);

    const entryStore = tx.objectStore(ENTRIES_STORE);
    const index = entryStore.index('by_pair');
    const keys = await idbReq(index.getAllKeys(IDBKeyRange.only(pairId)));
    for (const key of keys) {
      entryStore.delete(key);
    }

    await idbTx(tx);
    this.emitDictionaryChanged(pairId);
  }

  private emitDictionaryChanged(pairId: string): void {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const ch = new BroadcastChannel('lexistream-events');
        ch.postMessage({ type: 'dictionary_changed', pairId });
        ch.close();
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('lexistream:events', {
            detail: { type: 'dictionary_changed', pairId },
          }),
        );
      }
    } catch {
      // Ignore in restricted environments
    }
  }
}
