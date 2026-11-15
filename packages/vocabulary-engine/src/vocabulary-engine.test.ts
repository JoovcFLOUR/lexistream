import { describe, expect, it, vi } from 'vitest';
import { VocabularyRepository } from './index';

describe('@lexistream/vocabulary-engine', () => {
  it('captures vocabulary with context, deduplicates by lemma+POS while preserving multiple video occurrences, and separates distinct POS', async () => {
    const repo = new VocabularyRepository('test-vocab-db-1');

    // First capture: "thought" (verb -> lemma "think")
    const first = await repo.captureVocabulary({
      surface_form: 'thought',
      lemma: 'think',
      language: 'en',
      target_language: 'pt',
      translation: 'pensou',
      definition: 'To form an idea or opinion.',
      part_of_speech: 'verb',
      context: 'I never thought this would happen.',
      context_translation: 'Eu nunca pensei que isso aconteceria.',
      video_id: 'vid_001',
      video_title: 'Clip One',
      video_url: 'https://www.youtube.com/watch?v=vid_001',
      timestamp: 125.4,
    });

    expect(first.created).toBe(true);
    expect(first.item.lemma).toBe('think');
    expect(first.item.occurrences).toHaveLength(1);
    expect(first.item.surface_forms).toEqual(['thought']);

    // Second capture of same lemma+POS in a different video & surface form ("thinking")
    const second = await repo.captureVocabulary({
      surface_form: 'thinking',
      lemma: 'think',
      language: 'en',
      target_language: 'pt',
      translation: 'pensando',
      definition: 'Active mental reflection.',
      part_of_speech: 'verb',
      context: 'We were thinking about performance.',
      context_translation: 'Estávamos pensando em desempenho.',
      video_id: 'vid_002',
      video_title: 'Clip Two',
      video_url: 'https://www.youtube.com/watch?v=vid_002',
      timestamp: 48.2,
    });

    expect(second.created).toBe(false);
    expect(second.item.id).toBe(first.item.id);
    expect(second.item.occurrences).toHaveLength(2);
    expect(second.item.surface_forms).toEqual(['thought', 'thinking']);
    expect(second.item.version).toBe(2);

    // Clicking the exact same subtitle moment twice does not duplicate the occurrence
    const duplicateClick = await repo.captureVocabulary({
      surface_form: 'thought',
      lemma: 'think',
      language: 'en',
      target_language: 'pt',
      translation: 'pensou',
      definition: 'To form an idea or opinion.',
      part_of_speech: 'verb',
      context: 'I never thought this would happen.',
      context_translation: 'Eu nunca pensei que isso aconteceria.',
      video_id: 'vid_001',
      video_title: 'Clip One',
      video_url: 'https://www.youtube.com/watch?v=vid_001',
      timestamp: 125.4,
    });
    expect(duplicateClick.item.occurrences).toHaveLength(2);

    // Capturing "thought" as a NOUN creates a distinct entry without overwriting the verb
    const nounCapture = await repo.captureVocabulary({
      surface_form: 'thought',
      lemma: 'thought',
      language: 'en',
      target_language: 'pt',
      translation: 'pensamento',
      definition: 'An idea produced by thinking.',
      part_of_speech: 'noun',
      context: 'That was a deep thought.',
      context_translation: 'Esse foi um pensamento profundo.',
      video_id: 'vid_003',
      video_title: 'Clip Three',
      video_url: 'https://www.youtube.com/watch?v=vid_003',
      timestamp: 19.0,
    });
    expect(nounCapture.created).toBe(true);
    expect(nounCapture.item.id).not.toBe(first.item.id);

    const lookup = await repo.findMatchingEntries('thought', 'en');
    expect(lookup).toHaveLength(2);
  });

  it('supports search, multi-facet filtering, editing translations/definitions/examples/tags, and deletion', async () => {
    const repo = new VocabularyRepository('test-vocab-db-2');
    const { item } = await repo.captureVocabulary({
      surface_form: 'resilient',
      lemma: 'resilient',
      language: 'en',
      target_language: 'pt',
      translation: 'resiliente',
      definition: 'Able to withstand or recover quickly from difficult conditions.',
      part_of_speech: 'adjective',
      context: 'Local-first software is resilient to offline drops.',
      context_translation: 'Software local-first é resiliente a quedas de conexão.',
      video_id: 'vid_arch',
      video_title: 'Systems Architecture',
      video_url: 'https://www.youtube.com/watch?v=vid_arch',
      timestamp: 302.1,
      tags: ['engineering'],
    });

    const updated = await repo.updateVocabulary(item.id, {
      primary_translation: 'resiliente / robusto',
      primary_definition: 'Recovering rapidly from network or hardware faults.',
      custom_examples: ['A resilient sync queue never drops user edits.'],
      tags: ['engineering', 'systems'],
      status: 'review',
    });

    expect(updated.primary_translation).toBe('resiliente / robusto');
    expect(updated.custom_examples).toHaveLength(1);
    expect(updated.tags).toEqual(['engineering', 'systems']);

    const bySearch = await repo.queryVocabulary({ search: 'offline drops' });
    expect(bySearch).toHaveLength(1);

    const byFilter = await repo.queryVocabulary({
      language: 'en',
      partOfSpeech: 'adjective',
      status: 'review',
      tag: 'systems',
    });
    expect(byFilter).toHaveLength(1);

    const nonMatch = await repo.queryVocabulary({ partOfSpeech: 'verb' });
    expect(nonMatch).toHaveLength(0);

    await repo.deleteVocabulary(item.id);
    const afterDelete = await repo.queryVocabulary({});
    expect(afterDelete).toHaveLength(0);
  });

  it('exports and imports JSON and RFC-4180 CSV losslessly, and supports complete user data wipe', async () => {
    const sourceRepo = new VocabularyRepository('test-vocab-db-export');
    await sourceRepo.captureVocabulary({
      surface_form: 'thought',
      lemma: 'think',
      language: 'en',
      target_language: 'pt',
      translation: 'pensou, refletiu',
      definition: 'To form an "idea" or opinion.',
      part_of_speech: 'verb',
      context: 'Wait, "I never thought" this would happen!',
      context_translation: 'Espere, "eu nunca pensei" que isso aconteceria!',
      video_id: 'vid_csv',
      video_title: 'Quotes, Commas & Context',
      video_url: 'https://www.youtube.com/watch?v=vid_csv',
      timestamp: 88.5,
      tags: ['verbs', 'spoken'],
    });

    const jsonExport = await sourceRepo.exportJson();
    const csvExport = await sourceRepo.exportCsv();
    expect(csvExport).toContain('"pensou, refletiu"');

    // Import JSON into clean DB
    const jsonTargetRepo = new VocabularyRepository('test-vocab-db-import-json');
    const jsonCount = await jsonTargetRepo.importJson(jsonExport);
    expect(jsonCount).toBe(1);
    const jsonItems = await jsonTargetRepo.queryVocabulary({});
    expect(jsonItems[0]?.occurrences[0]?.video_id).toBe('vid_csv');

    // Import CSV into clean DB
    const csvTargetRepo = new VocabularyRepository('test-vocab-db-import-csv');
    const csvCount = await csvTargetRepo.importCsv(csvExport);
    expect(csvCount).toBe(1);
    const csvItems = await csvTargetRepo.queryVocabulary({});
    expect(csvItems[0]?.primary_translation).toBe('pensou, refletiu');

    // Full privacy wipe
    await sourceRepo.wipeAllData();
    expect(await sourceRepo.queryVocabulary({})).toHaveLength(0);
  });

  it('synchronizes offline outbox deltas and deterministically resolves conflicts without losing occurrences', async () => {
    const repo = new VocabularyRepository('test-vocab-db-sync');
    const { item: localItem } = await repo.captureVocabulary({
      surface_form: 'thought',
      lemma: 'think',
      language: 'en',
      target_language: 'pt',
      translation: 'pensou',
      definition: 'Local definition.',
      part_of_speech: 'verb',
      context: 'Local sentence A.',
      context_translation: 'Frase local A.',
      video_id: 'vid_local',
      video_title: 'Local Video',
      video_url: 'https://www.youtube.com/watch?v=vid_local',
      timestamp: 10,
    });

    const remoteConflictingItem = {
      ...localItem,
      primary_translation: 'pensou (editado remotamente)',
      version: localItem.version + 2,
      updated_at: new Date(Date.now() + 5000).toISOString(),
      occurrences: [
        {
          id: 'remote-occ-99',
          surface_form: 'thinks',
          context: 'Remote sentence B.',
          context_translation: 'Frase remota B.',
          video_id: 'vid_remote',
          video_title: 'Remote Video',
          video_url: 'https://www.youtube.com/watch?v=vid_remote',
          timestamp: 45,
          captured_at: new Date().toISOString(),
        },
      ],
    };

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/sync/push')) {
        return new Response(JSON.stringify({ accepted: 1, server_seq: 11 }), { status: 200 });
      }
      if (url.includes('/api/v1/sync/pull')) {
        return new Response(
          JSON.stringify({
            server_seq: 12,
            vocabulary_items: [remoteConflictingItem],
            flashcards: [],
            review_logs: [],
          }),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const syncResult = await repo.synchronizeWithBackend({
      baseUrl: 'http://127.0.0.1:8787',
      authToken: 'test-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(syncResult.pushedVocabulary).toBe(1);
    expect(syncResult.pulledVocabulary).toBe(1);
    expect(syncResult.serverSeq).toBe(12);

    const merged = await repo.getVocabularyById(localItem.id);
    // Remote scalar won because of higher version, while BOTH local and remote occurrences were preserved!
    expect(merged?.primary_translation).toBe('pensou (editado remotamente)');
    expect(merged?.occurrences).toHaveLength(2);
  });
});
