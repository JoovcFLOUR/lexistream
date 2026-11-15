import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card,
  type Grade,
} from 'ts-fsrs';
import type {
  FlashcardRecord,
  LearningStatus,
  ReviewLogRecord,
  ReviewRating,
  VocabularyItem,
} from '@lexistream/shared-types';
import type { VocabularyRepository } from '@lexistream/vocabulary-engine';

export interface StudyCardItem {
  vocabulary: VocabularyItem;
  card: FlashcardRecord;
}

export interface IntervalPreviewMap {
  again: string;
  hard: string;
  good: string;
  easy: string;
}

export interface DailyActivityPoint {
  date: string;
  reviewsCount: number;
  newWordsCount: number;
}

export interface LanguageProgressItem {
  language: string;
  collected: number;
  reviewed: number;
  retained: number;
}

export interface LearningStatistics {
  totalCollected: number;
  totalReviewed: number;
  totalRetained: number;
  awaitingReviewCount: number;
  dailyReviewsToday: number;
  newWordsToday: number;
  reviewAccuracy: number;
  retentionRate: number;
  currentStreakDays: number;
  dailyHistory: DailyActivityPoint[];
  mostReviewedWords: Array<{ lemma: string; language: string; reps: number; lapses: number }>;
  progressByLanguage: LanguageProgressItem[];
}

const RATING_TO_FSRS: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

function toFsrsCard(record: FlashcardRecord): Card {
  return {
    due: new Date(record.due),
    stability: record.stability,
    difficulty: record.difficulty,
    elapsed_days: record.elapsed_days,
    scheduled_days: record.scheduled_days,
    reps: record.reps,
    lapses: record.lapses,
    state: record.state as State,
    last_review: record.last_review ? new Date(record.last_review) : undefined,
  };
}

function fromFsrsCard(
  id: string,
  vocabularyId: string,
  card: Card,
  version: number,
  now: Date,
): FlashcardRecord {
  return {
    id,
    vocabulary_id: vocabularyId,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : null,
    version,
    updated_at: now.toISOString(),
  };
}

function deriveLearningStatus(card: Card): LearningStatus {
  if (card.reps === 0 || card.state === State.New) return 'new';
  if (card.state === State.Relearning) return 'relearning';
  if (card.state === State.Learning) return 'learning';
  if (card.state === State.Review && card.stability >= 21) return 'mastered';
  return 'review';
}

export function formatRelativeInterval(from: Date, due: Date): string {
  const diffMs = Math.max(0, due.getTime() - from.getTime());
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = (days / 30).toFixed(1);
  return `${months}mo`;
}

function utcDateKey(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  return d.toISOString().slice(0, 10);
}

export class FlashcardService {
  private readonly scheduler = fsrs();

  constructor(private readonly repo: VocabularyRepository) {}

  async ensureFlashcard(
    vocabularyId: string,
    now = new Date(),
  ): Promise<FlashcardRecord> {
    const existing = await this.repo.getFlashcardByVocabularyId(vocabularyId);
    if (existing) return existing;

    const empty = createEmptyCard(now);
    const created = fromFsrsCard(
      crypto.randomUUID(),
      vocabularyId,
      empty,
      1,
      now,
    );
    await this.repo.putFlashcard(created);
    return created;
  }

  async getDueStudyQueue(now = new Date()): Promise<StudyCardItem[]> {
    const [vocabList, settings] = await Promise.all([
      this.repo.queryVocabulary({}),
      this.repo.getSettings(),
    ]);

    const dueItems: StudyCardItem[] = [];
    let newCardsIncluded = 0;

    for (const vocab of vocabList) {
      const card = await this.ensureFlashcard(vocab.id, now);
      const isDue = new Date(card.due).getTime() <= now.getTime();
      if (!isDue) continue;

      if (card.reps === 0) {
        if (newCardsIncluded >= settings.daily_new_limit) continue;
        newCardsIncluded++;
      }
      dueItems.push({ vocabulary: vocab, card });
      if (dueItems.length >= settings.daily_review_limit) break;
    }

    return dueItems.sort(
      (a, b) => new Date(a.card.due).getTime() - new Date(b.card.due).getTime(),
    );
  }

  previewIntervals(cardRecord: FlashcardRecord, now = new Date()): IntervalPreviewMap {
    const card = toFsrsCard(cardRecord);
    const repeat = this.scheduler.repeat(card, now);
    return {
      again: formatRelativeInterval(now, repeat[Rating.Again].card.due),
      hard: formatRelativeInterval(now, repeat[Rating.Hard].card.due),
      good: formatRelativeInterval(now, repeat[Rating.Good].card.due),
      easy: formatRelativeInterval(now, repeat[Rating.Easy].card.due),
    };
  }

  async submitReview(
    vocabularyId: string,
    rating: ReviewRating,
    durationMs = 0,
    now = new Date(),
  ): Promise<{ card: FlashcardRecord; log: ReviewLogRecord }> {
    const currentRecord = await this.ensureFlashcard(vocabularyId, now);
    const fsrsCard = toFsrsCard(currentRecord);
    const grade = RATING_TO_FSRS[rating];
    const outcome = this.scheduler.next(fsrsCard, now, grade);

    const updatedRecord = fromFsrsCard(
      currentRecord.id,
      vocabularyId,
      outcome.card,
      currentRecord.version + 1,
      now,
    );

    const reviewLog: ReviewLogRecord = {
      id: crypto.randomUUID(),
      flashcard_id: currentRecord.id,
      vocabulary_id: vocabularyId,
      rating,
      state_before: currentRecord.state,
      stability_after: outcome.card.stability,
      difficulty_after: outcome.card.difficulty,
      elapsed_days: outcome.card.elapsed_days,
      scheduled_days: outcome.card.scheduled_days,
      reviewed_at: now.toISOString(),
      duration_ms: Math.max(0, Math.round(durationMs)),
    };

    await this.repo.putFlashcard(updatedRecord);
    await this.repo.appendReviewLog(reviewLog);
    await this.repo.updateVocabulary(vocabularyId, {
      status: deriveLearningStatus(outcome.card),
    });

    return { card: updatedRecord, log: reviewLog };
  }

  async computeStatistics(now = new Date()): Promise<LearningStatistics> {
    const [vocabItems, cards, logs] = await Promise.all([
      this.repo.queryVocabulary({}),
      this.repo.getAllFlashcards(),
      this.repo.getAllReviewLogs(),
    ]);

    const activeVocabById = new Map(vocabItems.map((v) => [v.id, v]));
    const cardByVocabId = new Map(
      cards
        .filter((c) => activeVocabById.has(c.vocabulary_id))
        .map((c) => [c.vocabulary_id, c]),
    );

    const totalCollected = vocabItems.length;
    let totalReviewed = 0;
    let totalRetained = 0;
    let awaitingReviewCount = 0;

    for (const vocab of vocabItems) {
      const card = cardByVocabId.get(vocab.id);
      if (!card) {
        awaitingReviewCount++;
        continue;
      }
      if (new Date(card.due).getTime() <= now.getTime()) {
        awaitingReviewCount++;
      }
      if (card.reps >= 1) {
        totalReviewed++;
        // Demonstrably retained: graduated to FSRS Review state with >= 7 days memory stability
        if (card.state === State.Review && card.stability >= 7) {
          totalRetained++;
        }
      }
    }

    const activeLogs = logs.filter((l) => activeVocabById.has(l.vocabulary_id));
    const successfulLogs = activeLogs.filter((l) => l.rating !== 'again');
    const reviewAccuracy =
      activeLogs.length > 0 ? successfulLogs.length / activeLogs.length : 0;
    const retentionRate =
      totalReviewed > 0 ? totalRetained / totalReviewed : 0;

    const todayKey = utcDateKey(now);
    const dailyReviewsToday = activeLogs.filter(
      (l) => utcDateKey(l.reviewed_at) === todayKey,
    ).length;
    const newWordsToday = vocabItems.filter(
      (v) => utcDateKey(v.created_at) === todayKey,
    ).length;

    // Streak calculation across unique review days
    const reviewDateSet = new Set(activeLogs.map((l) => utcDateKey(l.reviewed_at)));
    let currentStreakDays = 0;
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (!reviewDateSet.has(utcDateKey(cursor))) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    while (reviewDateSet.has(utcDateKey(cursor))) {
      currentStreakDays++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    // Last 14 days history
    const dailyHistory: DailyActivityPoint[] = [];
    for (let offset = 13; offset >= 0; offset--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
      const key = utcDateKey(d);
      dailyHistory.push({
        date: key,
        reviewsCount: activeLogs.filter((l) => utcDateKey(l.reviewed_at) === key).length,
        newWordsCount: vocabItems.filter((v) => utcDateKey(v.created_at) === key).length,
      });
    }

    const mostReviewedWords = vocabItems
      .map((v) => {
        const c = cardByVocabId.get(v.id);
        return {
          lemma: v.lemma,
          language: v.language,
          reps: c?.reps ?? 0,
          lapses: c?.lapses ?? 0,
        };
      })
      .filter((x) => x.reps > 0)
      .sort((a, b) => b.reps - a.reps)
      .slice(0, 8);

    const langMap = new Map<string, LanguageProgressItem>();
    for (const v of vocabItems) {
      const entry = langMap.get(v.language) ?? {
        language: v.language,
        collected: 0,
        reviewed: 0,
        retained: 0,
      };
      entry.collected++;
      const card = cardByVocabId.get(v.id);
      if (card && card.reps >= 1) {
        entry.reviewed++;
        if (card.state === State.Review && card.stability >= 7) {
          entry.retained++;
        }
      }
      langMap.set(v.language, entry);
    }

    return {
      totalCollected,
      totalReviewed,
      totalRetained,
      awaitingReviewCount,
      dailyReviewsToday,
      newWordsToday,
      reviewAccuracy,
      retentionRate,
      currentStreakDays,
      dailyHistory,
      mostReviewedWords,
      progressByLanguage: Array.from(langMap.values()),
    };
  }
}
