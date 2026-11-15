export const DB_VERSION = 1;

export const STORES = {
  VOCABULARY: 'vocabulary',
  FLASHCARDS: 'flashcards',
  REVIEW_LOGS: 'review_logs',
  SYNC_OUTBOX: 'sync_outbox',
  SETTINGS: 'settings',
} as const;

export interface OutboxRecord {
  key: string;
  entity_type: 'vocabulary' | 'flashcard' | 'review_log';
  entity_id: string;
  queued_at: number;
}

export function openLexiStreamDatabase(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORES.VOCABULARY)) {
        const vocabStore = db.createObjectStore(STORES.VOCABULARY, { keyPath: 'id' });
        vocabStore.createIndex('by_normalized_key', 'normalized_key', { unique: true });
        vocabStore.createIndex('by_language', 'language', { unique: false });
        vocabStore.createIndex('by_status', 'status', { unique: false });
        vocabStore.createIndex('by_updated_at', 'updated_at', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.FLASHCARDS)) {
        const cardStore = db.createObjectStore(STORES.FLASHCARDS, { keyPath: 'id' });
        cardStore.createIndex('by_vocabulary_id', 'vocabulary_id', { unique: true });
        cardStore.createIndex('by_due', 'due', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.REVIEW_LOGS)) {
        const logStore = db.createObjectStore(STORES.REVIEW_LOGS, { keyPath: 'id' });
        logStore.createIndex('by_vocabulary_id', 'vocabulary_id', { unique: false });
        logStore.createIndex('by_reviewed_at', 'reviewed_at', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.SYNC_OUTBOX)) {
        db.createObjectStore(STORES.SYNC_OUTBOX, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
        db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(`Failed to open IndexedDB ${dbName}`));
  });
}

export function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function idbTxComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}
