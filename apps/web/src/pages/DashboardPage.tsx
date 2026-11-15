import {
  buildYouTubeTimestampUrl,
  type UserSettings,
  type VocabularyItem,
} from '@lexistream/shared-types';
import type { LearningStatistics } from '@lexistream/flashcard-engine';

export interface DashboardPageProps {
  stats: LearningStatistics;
  recentVocabulary: VocabularyItem[];
  settings: UserSettings;
  onStartReview: () => void;
  onSeedSample: () => Promise<void>;
}

export function DashboardPage({
  stats,
  recentVocabulary,
  settings,
  onStartReview,
  onSeedSample,
}: DashboardPageProps) {
  const dailyGoalPct = Math.min(
    100,
    Math.round((stats.dailyReviewsToday / Math.max(1, settings.daily_review_limit)) * 100),
  );

  return (
    <div>
      <section class="kpi-grid" aria-label="Learning overview metrics">
        <div class="kpi-card">
          <div class="kpi-value" data-testid="kpi-collected">
            {stats.totalCollected}
          </div>
          <div class="kpi-label">Total Vocabulary Collected</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value" data-testid="kpi-retained">
            {stats.totalRetained}
          </div>
          <div class="kpi-label">Words Retained (FSRS ≥7d)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value" data-testid="kpi-awaiting">
            {stats.awaitingReviewCount}
          </div>
          <div class="kpi-label">Words Awaiting Review</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">{stats.currentStreakDays}d</div>
          <div class="kpi-label">Learning Streak</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">{Math.round(stats.reviewAccuracy * 100)}%</div>
          <div class="kpi-label">Review Recall Accuracy</div>
        </div>
      </section>

      <section class="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>Daily Review Progress</h2>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              {stats.dailyReviewsToday} of {settings.daily_review_limit} target reviews completed
              today
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <a class="btn" href="/youtube-fixture.html">
              Open Interactive Subtitle Player
            </a>
            <button
              type="button"
              class="btn btn-primary"
              data-testid="dashboard-start-review"
              onClick={onStartReview}
            >
              Review Due Cards ({stats.awaitingReviewCount})
            </button>
          </div>
        </div>
        <div class="progress-track" role="progressbar" aria-valuenow={dailyGoalPct}>
          <div class="progress-fill" style={{ width: `${dailyGoalPct}%` }} />
        </div>
      </section>

      <section class="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Recent Contextual Vocabulary</h2>
          {recentVocabulary.length === 0 && (
            <button
              type="button"
              class="btn"
              data-testid="seed-sample-btn"
              onClick={() => void onSeedSample()}
            >
              Load Contextual Starter Examples
            </button>
          )}
        </div>
        {recentVocabulary.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            No words saved yet. Capture subtitle words on YouTube or load starter examples to try
            offline flashcards.
          </p>
        ) : (
          <div class="vocab-list">
            {recentVocabulary.slice(0, 6).map((item) => {
              const latestOcc = item.occurrences[item.occurrences.length - 1];
              return (
                <article key={item.id} class="vocab-item">
                  <div class="vocab-head">
                    <div>
                      <strong style={{ fontSize: '16px', marginRight: '8px' }}>
                        {item.lemma}
                      </strong>
                      <span class="badge">{item.part_of_speech}</span>
                      <span class="badge">{item.language.toUpperCase()}</span>
                      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
                        {item.primary_translation}
                      </span>
                    </div>
                    {latestOcc && (
                      <a
                        href={buildYouTubeTimestampUrl(
                          latestOcc.video_url,
                          latestOcc.video_id,
                          latestOcc.timestamp,
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--text-muted)', fontSize: '12px' }}
                      >
                        ▶ {latestOcc.video_title} ({Math.floor(latestOcc.timestamp)}s)
                      </a>
                    )}
                  </div>
                  {latestOcc && (
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                      “{latestOcc.context}”
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
