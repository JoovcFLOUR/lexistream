import { describe, expect, it } from 'vitest';
import { VocabularyRepository } from '@lexistream/vocabulary-engine';
import { FlashcardService } from './index';

describe('@lexistream/flashcard-engine (FSRS)', () => {
  it('creates FSRS cards for saved vocabulary, previews all 4 rating intervals, schedules reviews, and persists review history', async () => {
    const repo = new VocabularyRepository('test-fsrs-db-1');
    const flashcards = new FlashcardService(repo);

    const { item } = await repo.captureVocabulary({
      surface_form: 'thought',
      lemma: 'think',
      language: 'en',
      target_language: 'pt',
      translation: 'pensou',
      definition: 'To form an idea.',
      part_of_speech: 'verb',
      context: 'I never thought this would happen.',
      context_translation: 'Eu nunca pensei que isso aconteceria.',
      video_id: 'vid_fsrs',
      video_title: 'FSRS Study Session',
      video_url: 'https://www.youtube.com/watch?v=vid_fsrs',
      timestamp: 55.2,
    });

    const now = new Date('2026-11-15T12:00:00.000Z');
    const dueQueue = await flashcards.getDueStudyQueue(now);
    expect(dueQueue).toHaveLength(1);
    expect(dueQueue[0]?.vocabulary.lemma).toBe('think');

    const previews = flashcards.previewIntervals(dueQueue[0]!.card, now);
    expect(previews.again).toBeTruthy();
    expect(previews.hard).toBeTruthy();
    expect(previews.good).toBeTruthy();
    expect(previews.easy).toBeTruthy();

    // Rate "good"
    const afterGood = await flashcards.submitReview(item.id, 'good', 1800, now);
    expect(afterGood.card.reps).toBe(1);
    expect(afterGood.card.stability).toBeGreaterThan(0);
    expect(new Date(afterGood.card.due).getTime()).toBeGreaterThan(now.getTime());

    // Rate "easy" on follow-up review -> advances to Review state with higher stability
    const nextDay = new Date(afterGood.card.due);
    const afterEasy = await flashcards.submitReview(item.id, 'easy', 1200, nextDay);
    expect(afterEasy.card.reps).toBe(2);
    expect(afterEasy.card.stability).toBeGreaterThan(afterGood.card.stability);

    const logs = await repo.getAllReviewLogs();
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.rating)).toEqual(['good', 'easy']);
  });

  it('computes honest statistics distinguishing collected, reviewed, and demonstrably retained vocabulary', async () => {
    const repo = new VocabularyRepository('test-fsrs-db-stats');
    const flashcards = new FlashcardService(repo);

    // 3 collected words:
    // Word 1: reviewed multiple times -> retained (stability >= 7d)
    // Word 2: reviewed once with "again" -> reviewed, NOT retained
    // Word 3: never reviewed -> collected only
    const w1 = await repo.captureVocabulary({
      surface_form: 'resilient',
      lemma: 'resilient',
      language: 'en',
      target_language: 'pt',
      translation: 'resiliente',
      definition: 'Strong under stress.',
      part_of_speech: 'adjective',
      context: 'Resilient systems.',
      context_translation: 'Sistemas resilientes.',
      video_id: 'v1',
      video_title: 'V1',
      video_url: 'https://www.youtube.com/watch?v=v1',
      timestamp: 10,
    });
    const w2 = await repo.captureVocabulary({
      surface_form: 'ephemeral',
      lemma: 'ephemeral',
      language: 'en',
      target_language: 'pt',
      translation: 'efêmero',
      definition: 'Short-lived.',
      part_of_speech: 'adjective',
      context: 'Ephemeral state.',
      context_translation: 'Estado efêmero.',
      video_id: 'v1',
      video_title: 'V1',
      video_url: 'https://www.youtube.com/watch?v=v1',
      timestamp: 20,
    });
    await repo.captureVocabulary({
      surface_form: 'bonjour',
      lemma: 'bonjour',
      language: 'fr',
      target_language: 'pt',
      translation: 'bom dia',
      definition: 'French greeting.',
      part_of_speech: 'interjection',
      context: 'Bonjour tout le monde.',
      context_translation: 'Bom dia a todos.',
      video_id: 'v2',
      video_title: 'V2',
      video_url: 'https://www.youtube.com/watch?v=v2',
      timestamp: 5,
    });

    const day1 = new Date('2026-11-14T10:00:00.000Z');
    const r1 = await flashcards.submitReview(w1.item.id, 'easy', 1000, day1);
    const day2 = new Date('2026-11-15T10:00:00.000Z');
    await flashcards.submitReview(
      w1.item.id,
      'easy',
      900,
      new Date(Math.max(day2.getTime(), new Date(r1.card.due).getTime())),
    );
    await flashcards.submitReview(w2.item.id, 'again', 2500, day2);

    const stats = await flashcards.computeStatistics(day2);
    expect(stats.totalCollected).toBe(3);
    expect(stats.totalReviewed).toBe(2);
    expect(stats.totalRetained).toBe(1);
    // 2 successful recalls ("easy", "easy") out of 3 total reviews ("easy", "easy", "again") = 66.7%
    expect(stats.reviewAccuracy).toBeCloseTo(2 / 3, 2);
    expect(stats.currentStreakDays).toBeGreaterThanOrEqual(2);
    expect(stats.progressByLanguage).toHaveLength(2);
  });
});
