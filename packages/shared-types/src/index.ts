import { z } from 'zod';

export const LanguageCodeSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Expected valid ISO language code (e.g. en, pt, es, fr, de, la)');

export type LanguageCode = z.infer<typeof LanguageCodeSchema>;

export const PartOfSpeechSchema = z.enum([
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'preposition',
  'conjunction',
  'interjection',
  'determiner',
  'phrase',
  'idiom',
  'other',
]);

export type PartOfSpeech = z.infer<typeof PartOfSpeechSchema>;

export const LearningStatusSchema = z.enum([
  'new',
  'learning',
  'review',
  'relearning',
  'mastered',
]);

export type LearningStatus = z.infer<typeof LearningStatusSchema>;

export const LexicalMeaningSchema = z.object({
  id: z.string().min(1),
  part_of_speech: PartOfSpeechSchema,
  translation: z.string().trim().min(1),
  definition: z.string().trim().min(1),
  examples: z.array(z.string()).default([]),
});

export type LexicalMeaning = z.infer<typeof LexicalMeaningSchema>;

export const ContextOccurrenceSchema = z.object({
  id: z.string().min(1),
  surface_form: z.string().trim().min(1),
  context: z.string().trim().min(1),
  context_translation: z.string().default(''),
  video_id: z.string().trim().min(1),
  video_title: z.string().trim().min(1),
  video_url: z.string().url(),
  timestamp: z.number().min(0),
  captured_at: z.string().datetime({ offset: true }).or(z.string().min(1)),
});

export type ContextOccurrence = z.infer<typeof ContextOccurrenceSchema>;

export const VocabularyCaptureInputSchema = z.object({
  surface_form: z.string().trim().min(1),
  lemma: z.string().trim().min(1),
  language: LanguageCodeSchema,
  target_language: LanguageCodeSchema.default('pt'),
  translation: z.string().trim().min(1),
  definition: z.string().trim().default(''),
  part_of_speech: PartOfSpeechSchema.default('other'),
  context: z.string().trim().min(1),
  context_translation: z.string().default(''),
  video_id: z.string().trim().min(1),
  video_title: z.string().trim().min(1),
  video_url: z.string().url(),
  timestamp: z.number().min(0),
  additional_meanings: z.array(LexicalMeaningSchema).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
});

export type VocabularyCaptureInput = z.infer<typeof VocabularyCaptureInputSchema>;

export const VocabularyItemSchema = z.object({
  id: z.string().min(1),
  lemma: z.string().trim().min(1),
  normalized_key: z.string().trim().min(1),
  surface_forms: z.array(z.string().trim().min(1)).min(1),
  language: LanguageCodeSchema,
  target_language: LanguageCodeSchema,
  primary_translation: z.string().trim().min(1),
  primary_definition: z.string().default(''),
  part_of_speech: PartOfSpeechSchema,
  meanings: z.array(LexicalMeaningSchema).default([]),
  occurrences: z.array(ContextOccurrenceSchema).default([]),
  custom_examples: z.array(z.string().trim().min(1)).default([]),
  tags: z.array(z.string().trim().min(1)).default([]),
  status: LearningStatusSchema.default('new'),
  version: z.number().int().min(1).default(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  deleted_at: z.string().nullable().default(null),
});

export type VocabularyItem = z.infer<typeof VocabularyItemSchema>;

export const TranslationRequestSchema = z.object({
  word: z.string().trim().min(1).max(128),
  context: z.string().trim().max(2000).default(''),
  source_language: LanguageCodeSchema,
  target_language: LanguageCodeSchema,
  word_offset: z.number().int().min(0).optional(),
});

export type TranslationRequest = z.infer<typeof TranslationRequestSchema>;

export const TranslationResultSchema = z.object({
  word: z.string().trim().min(1),
  lemma: z.string().trim().min(1),
  part_of_speech: PartOfSpeechSchema,
  contextual_translation: z.string().trim().min(1),
  definition: z.string().default(''),
  context_sentence: z.string().default(''),
  context_translation: z.string().default(''),
  meanings: z.array(LexicalMeaningSchema).default([]),
  provider: z.string().min(1),
  cached: z.boolean().default(false),
});

export type TranslationResult = z.infer<typeof TranslationResultSchema>;

export const ReviewRatingSchema = z.enum(['again', 'hard', 'good', 'easy']);
export type ReviewRating = z.infer<typeof ReviewRatingSchema>;

export const FlashcardRecordSchema = z.object({
  id: z.string().min(1),
  vocabulary_id: z.string().min(1),
  due: z.string().min(1),
  stability: z.number().min(0),
  difficulty: z.number().min(0),
  elapsed_days: z.number().min(0),
  scheduled_days: z.number().min(0),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  state: z.number().int().min(0).max(3),
  last_review: z.string().nullable().default(null),
  version: z.number().int().min(1).default(1),
  updated_at: z.string().min(1),
});

export type FlashcardRecord = z.infer<typeof FlashcardRecordSchema>;

export const ReviewLogRecordSchema = z.object({
  id: z.string().min(1),
  flashcard_id: z.string().min(1),
  vocabulary_id: z.string().min(1),
  rating: ReviewRatingSchema,
  state_before: z.number().int().min(0).max(3),
  stability_after: z.number().min(0),
  difficulty_after: z.number().min(0),
  elapsed_days: z.number().min(0),
  scheduled_days: z.number().min(0),
  reviewed_at: z.string().min(1),
  duration_ms: z.number().int().min(0).default(0),
});

export type ReviewLogRecord = z.infer<typeof ReviewLogRecordSchema>;

export const SyncPushRequestSchema = z.object({
  client_id: z.string().min(1),
  vocabulary_items: z.array(VocabularyItemSchema).default([]),
  flashcards: z.array(FlashcardRecordSchema).default([]),
  review_logs: z.array(ReviewLogRecordSchema).default([]),
});

export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

export const SyncPullResponseSchema = z.object({
  server_seq: z.number().int().min(0),
  vocabulary_items: z.array(VocabularyItemSchema),
  flashcards: z.array(FlashcardRecordSchema),
  review_logs: z.array(ReviewLogRecordSchema),
});

export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;

export const UserSettingsSchema = z.object({
  source_language: LanguageCodeSchema.default('en'),
  target_language: LanguageCodeSchema.default('pt'),
  daily_new_limit: z.number().int().min(1).max(200).default(20),
  daily_review_limit: z.number().int().min(1).max(1000).default(100),
  enable_interactive_captions: z.boolean().default(true),
  hover_debounce_ms: z.number().int().min(0).max(1000).default(120),
  api_base_url: z.string().url().default('http://127.0.0.1:8787'),
  auth_token: z.string().nullable().default(null),
  user_email: z.string().nullable().default(null),
  last_sync_seq: z.number().int().min(0).default(0),
});

export type UserSettings = z.infer<typeof UserSettingsSchema>;

/**
 * Builds a clean, safe YouTube watch URL anchored at `Math.floor(timestamp)` seconds.
 */
export function buildYouTubeTimestampUrl(
  videoUrl: string,
  videoId: string,
  timestamp: number,
): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(timestamp) ? timestamp : 0));
  try {
    const parsed = new URL(videoUrl);
    if (parsed.hostname.endsWith('youtube.com') || parsed.hostname === 'youtu.be') {
      const url = new URL('https://www.youtube.com/watch');
      url.searchParams.set('v', videoId);
      url.searchParams.set('t', `${seconds}s`);
      return url.toString();
    }
  } catch {
    // Fall back to canonical watch URL below
  }
  const fallback = new URL('https://www.youtube.com/watch');
  fallback.searchParams.set('v', encodeURIComponent(videoId));
  fallback.searchParams.set('t', `${seconds}s`);
  return fallback.toString();
}
