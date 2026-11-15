import { describe, expect, it } from 'vitest';
import {
  VocabularyCaptureInputSchema,
  VocabularyItemSchema,
  TranslationRequestSchema,
  FlashcardRecordSchema,
  SyncPushRequestSchema,
  UserSettingsSchema,
  buildYouTubeTimestampUrl,
} from './index';

describe('@lexistream/shared-types schemas', () => {
  it('validates a contextual YouTube vocabulary capture payload matching spec section 5.4', () => {
    const raw = {
      surface_form: 'thought',
      lemma: 'think',
      language: 'en',
      target_language: 'pt',
      translation: 'pensou',
      definition: 'To form an idea or opinion.',
      part_of_speech: 'verb',
      context: 'I never thought this would happen.',
      context_translation: 'Eu nunca pensei que isso aconteceria.',
      video_id: 'dQw4w9WgXcQ',
      video_title: 'Understanding Context in Language Acquisition',
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      timestamp: 125.4,
    };

    const parsed = VocabularyCaptureInputSchema.parse(raw);
    expect(parsed.lemma).toBe('think');
    expect(parsed.part_of_speech).toBe('verb');
    expect(parsed.timestamp).toBeCloseTo(125.4);
  });

  it('rejects empty surface_form, negative timestamps, or invalid language codes', () => {
    expect(() =>
      VocabularyCaptureInputSchema.parse({
        surface_form: '   ',
        lemma: 'think',
        language: 'en',
        target_language: 'pt',
        translation: 'pensou',
        definition: 'To form an idea.',
        part_of_speech: 'verb',
        context: 'I thought so.',
        context_translation: 'Eu pensei assim.',
        video_id: 'abc',
        video_title: 'Video',
        video_url: 'https://www.youtube.com/watch?v=abc',
        timestamp: -5,
      }),
    ).toThrow();

    expect(() =>
      TranslationRequestSchema.parse({
        word: 'hello',
        context: 'Hello world!',
        source_language: 'INVALID_LANG_123',
        target_language: 'pt',
      }),
    ).toThrow();
  });

  it('validates full VocabularyItem, FlashcardRecord, SyncPushRequest, and UserSettings', () => {
    const now = new Date().toISOString();
    const item = VocabularyItemSchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      lemma: 'think',
      normalized_key: 'en::think::verb',
      surface_forms: ['thought', 'thinking'],
      language: 'en',
      target_language: 'pt',
      primary_translation: 'pensar',
      primary_definition: 'To form or hold an idea in the mind.',
      part_of_speech: 'verb',
      meanings: [
        {
          id: 'm1',
          part_of_speech: 'verb',
          translation: 'pensou',
          definition: 'Past tense of think.',
          examples: ['I never thought this would happen.'],
        },
      ],
      occurrences: [
        {
          id: 'occ-1',
          surface_form: 'thought',
          context: 'I never thought this would happen.',
          context_translation: 'Eu nunca pensei que isso aconteceria.',
          video_id: 'dQw4w9WgXcQ',
          video_title: 'Lecture 1',
          video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          timestamp: 125.4,
          captured_at: now,
        },
      ],
      custom_examples: ['Think carefully before optimizing.'],
      tags: ['youtube', 'core-verbs'],
      status: 'learning',
      version: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    });

    const card = FlashcardRecordSchema.parse({
      id: '660e8400-e29b-41d4-a716-446655440001',
      vocabulary_id: item.id,
      due: now,
      stability: 3.2,
      difficulty: 5.1,
      elapsed_days: 1,
      scheduled_days: 3,
      reps: 2,
      lapses: 0,
      state: 2,
      last_review: now,
      version: 1,
      updated_at: now,
    });

    const syncPush = SyncPushRequestSchema.parse({
      client_id: 'ext-client-1',
      vocabulary_items: [item],
      flashcards: [card],
      review_logs: [],
    });

    const settings = UserSettingsSchema.parse({});
    expect(settings.source_language).toBe('en');
    expect(settings.target_language).toBe('pt');
    expect(syncPush.vocabulary_items).toHaveLength(1);
  });

  it('builds safe YouTube deep-link URLs with rounded second offsets', () => {
    expect(
      buildYouTubeTimestampUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', 125.8),
    ).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=125s');
  });
});
