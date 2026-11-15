import type { TranslationResult } from '@lexistream/shared-types';

export interface TranslationPersistentCache {
  get(key: string): Promise<TranslationResult | undefined>;
  set(key: string, value: TranslationResult): Promise<void>;
  clear(): Promise<void>;
}

/**
 * O(1) bounded Least-Recently-Used in-memory cache backed by JS Map insertion order.
 */
export class BoundedLruCache<V> {
  private readonly store = new Map<string, V>();
  private readonly capacity: number;

  constructor(capacity = 512) {
    this.capacity = Math.max(1, capacity);
  }

  get size(): number {
    return this.store.size;
  }

  get(key: string): V | undefined {
    if (!this.store.has(key)) return undefined;
    const val = this.store.get(key)!;
    this.store.delete(key);
    this.store.set(key, val);
    return val;
  }

  set(key: string, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.capacity) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, value);
  }

  clear(): void {
    this.store.clear();
  }
}

const STORE_NAME = 'translations';

export class IndexedDbTranslationCache implements TranslationPersistentCache {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName = 'lexistream-translation-cache-v1') {}

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable in current runtime'));
        return;
      }
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB cache'));
    });
    return this.dbPromise;
  }

  async get(key: string): Promise<TranslationResult | undefined> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => {
          const row = req.result as { key: string; value: TranslationResult } | undefined;
          resolve(row?.value);
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: TranslationResult): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ key, value, updatedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore cache persistence errors gracefully in restricted contexts
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // No-op
    }
  }
}
