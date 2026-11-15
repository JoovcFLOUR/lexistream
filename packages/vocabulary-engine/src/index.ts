import {
  FlashcardRecordSchema,
  ReviewLogRecordSchema,
  SyncPullResponseSchema,
  UserSettingsSchema,
  VocabularyCaptureInputSchema,
  VocabularyItemSchema,
  type ContextOccurrence,
  type FlashcardRecord,
  type LanguageCode,
  type LearningStatus,
  type PartOfSpeech,
  type ReviewLogRecord,
  type UserSettings,
  type VocabularyCaptureInput,
  type VocabularyItem,
} from '@lexistream/shared-types';
import { normalizeToken } from '@lexistream/language-core';
import {
  mergeFlashcardRecords,
  mergeMeanings,
  mergeOccurrences,
  mergeVocabularyItems,
} from './conflict';
import { parseCsv, serializeCsv } from './csv';
import {
  STORES,
  idbRequest,
  idbTxComplete,
  openLexiStreamDatabase,
  type OutboxRecord,
} from './idb';

export { mergeVocabularyItems, mergeFlashcardRecords, serializeCsv, parseCsv };

export interface VocabularyQuery {
  search?: string;
  language?: LanguageCode;
  partOfSpeech?: PartOfSpeech;
  status?: LearningStatus;
  tag?: string;
  includeDeleted?: boolean;
}

export interface VocabularyUpdatePatch {
  primary_translation?: string;
  primary_definition?: string;
  part_of_speech?: PartOfSpeech;
  custom_examples?: string[];
  tags?: string[];
  status?: LearningStatus;
}

export interface SyncOptions {
  baseUrl: string;
  authToken?: string | null;
  clientId?: string;
  fetchImpl?: typeof fetch;
}

export interface SyncSummary {
  pushedVocabulary: number;
  pushedFlashcards: number;
  pushedReviewLogs: number;
  pulledVocabulary: number;
  pulledFlashcards: number;
  pulledReviewLogs: number;
  serverSeq: number;
}

export interface ExportBundle {
  format: 'lexistream-export-v1';
  exported_at: string;
  vocabulary_items: VocabularyItem[];
  flashcards: FlashcardRecord[];
  review_logs: ReviewLogRecord[];
}

export function buildNormalizedVocabularyKey(
  language: LanguageCode,
  lemma: string,
  partOfSpeech: PartOfSpeech,
): string {
  return `${language.toLowerCase()}::${normalizeToken(lemma, language)}::${partOfSpeech}`;
}

export interface LexiStreamDbEvent {
  type: 'vocabulary_changed' | 'dictionary_changed' | 'settings_changed';
  dbName?: string;
}

export function emitLexiStreamEvent(event: LexiStreamDbEvent): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel('lexistream-events');
      ch.postMessage(event);
      ch.close();
    }
    if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      globalThis.dispatchEvent(new CustomEvent('lexistream:events', { detail: event }));
    }
  } catch {
    // Ignore in restricted runtimes
  }
}

export function subscribeLexiStreamEvents(
  listener: (event: LexiStreamDbEvent) => void,
): () => void {
  let ch: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      ch = new BroadcastChannel('lexistream-events');
      ch.onmessage = (ev: MessageEvent<LexiStreamDbEvent>) => {
        if (ev.data?.type) listener(ev.data);
      };
    } catch {
      ch = null;
    }
  }

  const domHandler = (ev: Event) => {
    const detail = (ev as CustomEvent<LexiStreamDbEvent>).detail;
    if (detail?.type) listener(detail);
  };
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('lexistream:events', domHandler);
  }

  return () => {
    ch?.close();
    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('lexistream:events', domHandler);
    }
  };
}

export class VocabularyRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(public readonly dbName = 'lexistream-local-db-v1') {}

  async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openLexiStreamDatabase(this.dbName);
    }
    return this.dbPromise;
  }

  async captureVocabulary(
    rawInput: VocabularyCaptureInput,
  ): Promise<{ item: VocabularyItem; created: boolean }> {
    const input = VocabularyCaptureInputSchema.parse(rawInput);
    const db = await this.getDb();
    const normalizedLemma = normalizeToken(input.lemma, input.language) || input.lemma.toLowerCase();
    const normalizedKey = buildNormalizedVocabularyKey(
      input.language,
      normalizedLemma,
      input.part_of_speech,
    );
    const now = new Date().toISOString();

    const newOccurrence: ContextOccurrence = {
      id: crypto.randomUUID(),
      surface_form: input.surface_form.trim(),
      context: input.context.trim(),
      context_translation: input.context_translation.trim(),
      video_id: input.video_id.trim(),
      video_title: input.video_title.trim(),
      video_url: input.video_url.trim(),
      timestamp: input.timestamp,
      captured_at: now,
    };

    const incomingMeanings =
      input.additional_meanings && input.additional_meanings.length > 0
        ? input.additional_meanings
        : [
            {
              id: crypto.randomUUID(),
              part_of_speech: input.part_of_speech,
              translation: input.translation,
              definition: input.definition || `Contextual meaning of "${normalizedLemma}".`,
              examples: [input.context],
            },
          ];

    const tx = db.transaction([STORES.VOCABULARY, STORES.SYNC_OUTBOX], 'readwrite');
    const vocabStore = tx.objectStore(STORES.VOCABULARY);
    const outboxStore = tx.objectStore(STORES.SYNC_OUTBOX);
    const index = vocabStore.index('by_normalized_key');

    const existing = (await idbRequest(index.get(normalizedKey))) as
      | VocabularyItem
      | undefined;

    let savedItem: VocabularyItem;
    let created = false;

    if (existing && existing.deleted_at === null) {
      const mergedOccurrences = mergeOccurrences(existing.occurrences, [newOccurrence]);
      const surfaceForms = Array.from(
        new Set([...existing.surface_forms, input.surface_form.trim()]),
      );
      const mergedMeanings = mergeMeanings(existing.meanings, incomingMeanings);
      const mergedTags = Array.from(new Set([...existing.tags, ...(input.tags ?? [])]));

      savedItem = {
        ...existing,
        surface_forms: surfaceForms,
        occurrences: mergedOccurrences,
        meanings: mergedMeanings,
        tags: mergedTags,
        version: existing.version + 1,
        updated_at: now,
      };
    } else {
      created = true;
      savedItem = {
        id: existing?.id ?? crypto.randomUUID(),
        lemma: normalizedLemma,
        normalized_key: normalizedKey,
        surface_forms: [input.surface_form.trim()],
        language: input.language,
        target_language: input.target_language,
        primary_translation: input.translation.trim(),
        primary_definition:
          input.definition.trim() || `Contextual meaning of "${normalizedLemma}".`,
        part_of_speech: input.part_of_speech,
        meanings: incomingMeanings,
        occurrences: [newOccurrence],
        custom_examples: [],
        tags: input.tags ?? [],
        status: 'new',
        version: existing ? existing.version + 1 : 1,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        deleted_at: null,
      };
    }

    vocabStore.put(savedItem);
    const outboxEntry: OutboxRecord = {
      key: `vocabulary::${savedItem.id}`,
      entity_type: 'vocabulary',
      entity_id: savedItem.id,
      queued_at: Date.now(),
    };
    outboxStore.put(outboxEntry);
    await idbTxComplete(tx);
    emitLexiStreamEvent({ type: 'vocabulary_changed', dbName: this.dbName });

    return { item: savedItem, created };
  }

  async getVocabularyById(id: string): Promise<VocabularyItem | undefined> {
    const db = await this.getDb();
    const tx = db.transaction(STORES.VOCABULARY, 'readonly');
    const item = (await idbRequest(tx.objectStore(STORES.VOCABULARY).get(id))) as
      | VocabularyItem
      | undefined;
    if (item && item.deleted_at !== null) return undefined;
    return item;
  }

  async findMatchingEntries(
    surfaceOrLemma: string,
    language?: LanguageCode,
  ): Promise<VocabularyItem[]> {
    const norm = normalizeToken(surfaceOrLemma, language ?? 'en');
    if (!norm) return [];
    const all = await this.queryVocabulary({});
    const matches = all.filter(
      (item) =>
        item.lemma === norm ||
        item.surface_forms.some((sf) => normalizeToken(sf, item.language) === norm),
    );
    if (language) {
      const exactLang = matches.filter((m) => m.language === language);
      if (exactLang.length > 0) return exactLang;
    }
    return matches;
  }

  async queryVocabulary(query: VocabularyQuery = {}): Promise<VocabularyItem[]> {
    const db = await this.getDb();
    const tx = db.transaction(STORES.VOCABULARY, 'readonly');
    const all = (await idbRequest(
      tx.objectStore(STORES.VOCABULARY).getAll(),
    )) as VocabularyItem[];

    const q = query.search?.trim().toLowerCase() ?? '';

    return all
      .filter((item) => {
        if (!query.includeDeleted && item.deleted_at !== null) return false;
        if (query.language && item.language !== query.language) return false;
        if (query.partOfSpeech && item.part_of_speech !== query.partOfSpeech) return false;
        if (query.status && item.status !== query.status) return false;
        if (query.tag && !item.tags.includes(query.tag)) return false;

        if (q) {
          const inLemma = item.lemma.toLowerCase().includes(q);
          const inSurface = item.surface_forms.some((s) => s.toLowerCase().includes(q));
          const inTrans = item.primary_translation.toLowerCase().includes(q);
          const inDef = item.primary_definition.toLowerCase().includes(q);
          const inContext = item.occurrences.some((o) =>
            o.context.toLowerCase().includes(q),
          );
          const inTags = item.tags.some((t) => t.toLowerCase().includes(q));
          if (!inLemma && !inSurface && !inTrans && !inDef && !inContext && !inTags) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async updateVocabulary(
    id: string,
    patch: VocabularyUpdatePatch,
  ): Promise<VocabularyItem> {
    const db = await this.getDb();
    const tx = db.transaction([STORES.VOCABULARY, STORES.SYNC_OUTBOX], 'readwrite');
    const store = tx.objectStore(STORES.VOCABULARY);
    const existing = (await idbRequest(store.get(id))) as VocabularyItem | undefined;
    if (!existing || existing.deleted_at !== null) {
      throw new Error(`Vocabulary entry not found: ${id}`);
    }

    const nextPos = patch.part_of_speech ?? existing.part_of_speech;
    const updated: VocabularyItem = VocabularyItemSchema.parse({
      ...existing,
      ...patch,
      part_of_speech: nextPos,
      normalized_key: buildNormalizedVocabularyKey(
        existing.language,
        existing.lemma,
        nextPos,
      ),
      version: existing.version + 1,
      updated_at: new Date().toISOString(),
    });

    store.put(updated);
    tx.objectStore(STORES.SYNC_OUTBOX).put({
      key: `vocabulary::${updated.id}`,
      entity_type: 'vocabulary',
      entity_id: updated.id,
      queued_at: Date.now(),
    } satisfies OutboxRecord);

    await idbTxComplete(tx);
    emitLexiStreamEvent({ type: 'vocabulary_changed', dbName: this.dbName });
    return updated;
  }

  async deleteVocabulary(id: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction([STORES.VOCABULARY, STORES.SYNC_OUTBOX], 'readwrite');
    const store = tx.objectStore(STORES.VOCABULARY);
    const existing = (await idbRequest(store.get(id))) as VocabularyItem | undefined;
    if (!existing) return;

    const now = new Date().toISOString();
    const tombstone: VocabularyItem = {
      ...existing,
      deleted_at: now,
      updated_at: now,
      version: existing.version + 1,
    };
    store.put(tombstone);
    tx.objectStore(STORES.SYNC_OUTBOX).put({
      key: `vocabulary::${id}`,
      entity_type: 'vocabulary',
      entity_id: id,
      queued_at: Date.now(),
    } satisfies OutboxRecord);

    await idbTxComplete(tx);
    emitLexiStreamEvent({ type: 'vocabulary_changed', dbName: this.dbName });
  }

  async putFlashcard(card: FlashcardRecord, queueSync = true): Promise<void> {
    const validated = FlashcardRecordSchema.parse(card);
    const db = await this.getDb();
    const tx = db.transaction([STORES.FLASHCARDS, STORES.SYNC_OUTBOX], 'readwrite');
    tx.objectStore(STORES.FLASHCARDS).put(validated);
    if (queueSync) {
      tx.objectStore(STORES.SYNC_OUTBOX).put({
        key: `flashcard::${validated.id}`,
        entity_type: 'flashcard',
        entity_id: validated.id,
        queued_at: Date.now(),
      } satisfies OutboxRecord);
    }
    await idbTxComplete(tx);
    emitLexiStreamEvent({ type: 'vocabulary_changed', dbName: this.dbName });
  }

  async getFlashcardByVocabularyId(
    vocabularyId: string,
  ): Promise<FlashcardRecord | undefined> {
    const db = await this.getDb();
    const tx = db.transaction(STORES.FLASHCARDS, 'readonly');
    const idx = tx.objectStore(STORES.FLASHCARDS).index('by_vocabulary_id');
    return (await idbRequest(idx.get(vocabularyId))) as FlashcardRecord | undefined;
  }

  async getAllFlashcards(): Promise<FlashcardRecord[]> {
    const db = await this.getDb();
    const tx = db.transaction(STORES.FLASHCARDS, 'readonly');
    return (await idbRequest(
      tx.objectStore(STORES.FLASHCARDS).getAll(),
    )) as FlashcardRecord[];
  }

  async appendReviewLog(log: ReviewLogRecord, queueSync = true): Promise<void> {
    const validated = ReviewLogRecordSchema.parse(log);
    const db = await this.getDb();
    const tx = db.transaction([STORES.REVIEW_LOGS, STORES.SYNC_OUTBOX], 'readwrite');
    tx.objectStore(STORES.REVIEW_LOGS).put(validated);
    if (queueSync) {
      tx.objectStore(STORES.SYNC_OUTBOX).put({
        key: `review_log::${validated.id}`,
        entity_type: 'review_log',
        entity_id: validated.id,
        queued_at: Date.now(),
      } satisfies OutboxRecord);
    }
    await idbTxComplete(tx);
    emitLexiStreamEvent({ type: 'vocabulary_changed', dbName: this.dbName });
  }

  async getAllReviewLogs(): Promise<ReviewLogRecord[]> {
    const db = await this.getDb();
    const tx = db.transaction(STORES.REVIEW_LOGS, 'readonly');
    const logs = (await idbRequest(
      tx.objectStore(STORES.REVIEW_LOGS).getAll(),
    )) as ReviewLogRecord[];
    return logs.sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));
  }

  async getSettings(): Promise<UserSettings> {
    const db = await this.getDb();
    const tx = db.transaction(STORES.SETTINGS, 'readonly');
    const row = (await idbRequest(
      tx.objectStore(STORES.SETTINGS).get('user_settings'),
    )) as { key: string; value: UserSettings } | undefined;
    return UserSettingsSchema.parse(row?.value ?? {});
  }

  async saveSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
    const current = await this.getSettings();
    const next = UserSettingsSchema.parse({ ...current, ...patch });
    const db = await this.getDb();
    const tx = db.transaction(STORES.SETTINGS, 'readwrite');
    tx.objectStore(STORES.SETTINGS).put({ key: 'user_settings', value: next });
    await idbTxComplete(tx);
    emitLexiStreamEvent({ type: 'settings_changed', dbName: this.dbName });
    return next;
  }

  async exportJson(): Promise<string> {
    const [vocabularyItems, flashcards, reviewLogs] = await Promise.all([
      this.queryVocabulary({}),
      this.getAllFlashcards(),
      this.getAllReviewLogs(),
    ]);
    const bundle: ExportBundle = {
      format: 'lexistream-export-v1',
      exported_at: new Date().toISOString(),
      vocabulary_items: vocabularyItems,
      flashcards,
      review_logs: reviewLogs,
    };
    return JSON.stringify(bundle, null, 2);
  }

  async importJson(jsonString: string): Promise<number> {
    const parsed = JSON.parse(jsonString) as Partial<ExportBundle>;
    const items = Array.isArray(parsed.vocabulary_items)
      ? parsed.vocabulary_items.map((i) => VocabularyItemSchema.parse(i))
      : [];
    const cards = Array.isArray(parsed.flashcards)
      ? parsed.flashcards.map((c) => FlashcardRecordSchema.parse(c))
      : [];
    const logs = Array.isArray(parsed.review_logs)
      ? parsed.review_logs.map((l) => ReviewLogRecordSchema.parse(l))
      : [];

    const db = await this.getDb();
    const tx = db.transaction(
      [STORES.VOCABULARY, STORES.FLASHCARDS, STORES.REVIEW_LOGS],
      'readwrite',
    );
    const vocabStore = tx.objectStore(STORES.VOCABULARY);
    for (const incoming of items) {
      const existing = (await idbRequest(vocabStore.get(incoming.id))) as
        | VocabularyItem
        | undefined;
      vocabStore.put(existing ? mergeVocabularyItems(existing, incoming) : incoming);
    }
    const cardStore = tx.objectStore(STORES.FLASHCARDS);
    for (const card of cards) {
      cardStore.put(card);
    }
    const logStore = tx.objectStore(STORES.REVIEW_LOGS);
    for (const log of logs) {
      logStore.put(log);
    }
    await idbTxComplete(tx);
    return items.length;
  }

  async exportCsv(): Promise<string> {
    const items = await this.queryVocabulary({});
    const headers = [
      'lemma',
      'surface_form',
      'language',
      'target_language',
      'part_of_speech',
      'translation',
      'definition',
      'context',
      'context_translation',
      'video_id',
      'video_title',
      'video_url',
      'timestamp',
      'tags',
    ];

    const rows = items.map((item) => {
      const firstOcc = item.occurrences[0];
      return [
        item.lemma,
        item.surface_forms[0] ?? item.lemma,
        item.language,
        item.target_language,
        item.part_of_speech,
        item.primary_translation,
        item.primary_definition,
        firstOcc?.context ?? item.custom_examples[0] ?? item.lemma,
        firstOcc?.context_translation ?? '',
        firstOcc?.video_id ?? 'imported',
        firstOcc?.video_title ?? 'Imported Entry',
        firstOcc?.video_url ?? 'https://www.youtube.com/watch?v=imported',
        firstOcc?.timestamp ?? 0,
        item.tags.join(';'),
      ];
    });

    return serializeCsv(headers, rows);
  }

  async importCsv(csvText: string): Promise<number> {
    const rows = parseCsv(csvText);
    if (rows.length <= 1) return 0;
    const header = rows[0]!.map((h) => h.trim().toLowerCase());
    const idx = (col: string) => header.indexOf(col);

    let imported = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]!;
      const lemma = row[idx('lemma')]?.trim();
      const translation = row[idx('translation')]?.trim();
      if (!lemma || !translation) continue;

      const tagsStr = row[idx('tags')]?.trim() ?? '';
      await this.captureVocabulary({
        lemma,
        surface_form: row[idx('surface_form')]?.trim() || lemma,
        language: (row[idx('language')]?.trim() || 'en') as LanguageCode,
        target_language: (row[idx('target_language')]?.trim() || 'pt') as LanguageCode,
        part_of_speech: (row[idx('part_of_speech')]?.trim() || 'other') as PartOfSpeech,
        translation,
        definition: row[idx('definition')]?.trim() ?? '',
        context: row[idx('context')]?.trim() || lemma,
        context_translation: row[idx('context_translation')]?.trim() ?? '',
        video_id: row[idx('video_id')]?.trim() || 'imported',
        video_title: row[idx('video_title')]?.trim() || 'Imported CSV',
        video_url:
          row[idx('video_url')]?.trim() || 'https://www.youtube.com/watch?v=imported',
        timestamp: Number(row[idx('timestamp')] ?? 0) || 0,
        tags: tagsStr ? tagsStr.split(';').filter(Boolean) : [],
      });
      imported++;
    }
    return imported;
  }

  async wipeAllData(): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(
      [
        STORES.VOCABULARY,
        STORES.FLASHCARDS,
        STORES.REVIEW_LOGS,
        STORES.SYNC_OUTBOX,
        STORES.SETTINGS,
      ],
      'readwrite',
    );
    tx.objectStore(STORES.VOCABULARY).clear();
    tx.objectStore(STORES.FLASHCARDS).clear();
    tx.objectStore(STORES.REVIEW_LOGS).clear();
    tx.objectStore(STORES.SYNC_OUTBOX).clear();
    tx.objectStore(STORES.SETTINGS).clear();
    await idbTxComplete(tx);
    emitLexiStreamEvent({ type: 'vocabulary_changed', dbName: this.dbName });
  }

  async getPendingSyncCount(): Promise<number> {
    const db = await this.getDb();
    const tx = db.transaction(STORES.SYNC_OUTBOX, 'readonly');
    return await idbRequest(tx.objectStore(STORES.SYNC_OUTBOX).count());
  }

  async synchronizeWithBackend(options: SyncOptions): Promise<SyncSummary> {
    const fetchFn = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const baseUrl = options.baseUrl.replace(/\/+$/, '');
    const settings = await this.getSettings();
    const token = options.authToken ?? settings.auth_token;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const db = await this.getDb();
    const readTx = db.transaction(
      [STORES.SYNC_OUTBOX, STORES.VOCABULARY, STORES.FLASHCARDS, STORES.REVIEW_LOGS],
      'readonly',
    );
    const outbox = (await idbRequest(
      readTx.objectStore(STORES.SYNC_OUTBOX).getAll(),
    )) as OutboxRecord[];

    const vocabToPush: VocabularyItem[] = [];
    const cardsToPush: FlashcardRecord[] = [];
    const logsToPush: ReviewLogRecord[] = [];

    for (const entry of outbox) {
      if (entry.entity_type === 'vocabulary') {
        const v = (await idbRequest(
          readTx.objectStore(STORES.VOCABULARY).get(entry.entity_id),
        )) as VocabularyItem | undefined;
        if (v) vocabToPush.push(v);
      } else if (entry.entity_type === 'flashcard') {
        const c = (await idbRequest(
          readTx.objectStore(STORES.FLASHCARDS).get(entry.entity_id),
        )) as FlashcardRecord | undefined;
        if (c) cardsToPush.push(c);
      } else if (entry.entity_type === 'review_log') {
        const l = (await idbRequest(
          readTx.objectStore(STORES.REVIEW_LOGS).get(entry.entity_id),
        )) as ReviewLogRecord | undefined;
        if (l) logsToPush.push(l);
      }
    }

    if (vocabToPush.length > 0 || cardsToPush.length > 0 || logsToPush.length > 0) {
      const pushRes = await fetchFn(`${baseUrl}/api/v1/sync/push`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          client_id: options.clientId ?? 'lexistream-local-client',
          vocabulary_items: vocabToPush,
          flashcards: cardsToPush,
          review_logs: logsToPush,
        }),
      });
      if (!pushRes.ok) {
        throw new Error(`Sync push failed with HTTP ${pushRes.status}`);
      }

      const clearTx = db.transaction(STORES.SYNC_OUTBOX, 'readwrite');
      const outboxStore = clearTx.objectStore(STORES.SYNC_OUTBOX);
      for (const entry of outbox) {
        outboxStore.delete(entry.key);
      }
      await idbTxComplete(clearTx);
    }

    const pullRes = await fetchFn(
      `${baseUrl}/api/v1/sync/pull?since_seq=${settings.last_sync_seq}`,
      {
        method: 'GET',
        headers,
      },
    );
    if (!pullRes.ok) {
      throw new Error(`Sync pull failed with HTTP ${pullRes.status}`);
    }

    const pullData = SyncPullResponseSchema.parse(await pullRes.json());

    const applyTx = db.transaction(
      [STORES.VOCABULARY, STORES.FLASHCARDS, STORES.REVIEW_LOGS],
      'readwrite',
    );
    const vocabStore = applyTx.objectStore(STORES.VOCABULARY);
    for (const remoteItem of pullData.vocabulary_items) {
      const localItem = (await idbRequest(vocabStore.get(remoteItem.id))) as
        | VocabularyItem
        | undefined;
      vocabStore.put(
        localItem ? mergeVocabularyItems(localItem, remoteItem) : remoteItem,
      );
    }

    const cardStore = applyTx.objectStore(STORES.FLASHCARDS);
    for (const remoteCard of pullData.flashcards) {
      const localCard = (await idbRequest(cardStore.get(remoteCard.id))) as
        | FlashcardRecord
        | undefined;
      cardStore.put(
        localCard ? mergeFlashcardRecords(localCard, remoteCard) : remoteCard,
      );
    }

    const logStore = applyTx.objectStore(STORES.REVIEW_LOGS);
    for (const remoteLog of pullData.review_logs) {
      logStore.put(remoteLog);
    }

    await idbTxComplete(applyTx);
    await this.saveSettings({ last_sync_seq: pullData.server_seq });

    return {
      pushedVocabulary: vocabToPush.length,
      pushedFlashcards: cardsToPush.length,
      pushedReviewLogs: logsToPush.length,
      pulledVocabulary: pullData.vocabulary_items.length,
      pulledFlashcards: pullData.flashcards.length,
      pulledReviewLogs: pullData.review_logs.length,
      serverSeq: pullData.server_seq,
    };
  }
}
