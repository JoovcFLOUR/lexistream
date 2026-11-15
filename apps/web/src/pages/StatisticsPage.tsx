import type { LearningStatistics } from '@lexistream/flashcard-engine';

export interface StatisticsPageProps {
  stats: LearningStatistics;
}

export function StatisticsPage({ stats }: StatisticsPageProps) {
  const maxDaily = Math.max(
    1,
    ...stats.dailyHistory.map((d) => Math.max(d.reviewsCount, d.newWordsCount)),
  );

  return (
    <div>
      <section class="panel" aria-label="Honest vocabulary stage distinction">
        <h2>Acquisition Stages (Collected vs Reviewed vs Retained)</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: 0 }}>
          Capturing a word does not mean knowing it. LexiStream separates collected items,
          actively reviewed items, and items with demonstrated FSRS stability ≥ 7 days.
        </p>
        <div class="kpi-grid" style={{ marginBottom: 0 }}>
          <div class="kpi-card">
            <div class="kpi-value">{stats.totalCollected}</div>
            <div class="kpi-label">Collected</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">{stats.totalReviewed}</div>
            <div class="kpi-label">Reviewed (≥1 rep)</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value" style={{ color: 'var(--success)' }}>
              {stats.totalRetained}
            </div>
            <div class="kpi-label">Demonstrably Retained</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">{Math.round(stats.retentionRate * 100)}%</div>
            <div class="kpi-label">Mature Retention Rate</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">{Math.round(stats.reviewAccuracy * 100)}%</div>
            <div class="kpi-label">Recall Accuracy</div>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>14-Day Activity (Reviews &amp; New Captures)</h2>
        <svg
          viewBox="0 0 560 150"
          width="100%"
          height="150"
          role="img"
          aria-label="14-day review and capture bar chart"
        >
          {stats.dailyHistory.map((pt, idx) => {
            const x = idx * 40 + 10;
            const revH = Math.round((pt.reviewsCount / maxDaily) * 105);
            const newH = Math.round((pt.newWordsCount / maxDaily) * 105);
            return (
              <g key={pt.date}>
                <rect
                  x={x}
                  y={120 - revH}
                  width={12}
                  height={Math.max(2, revH)}
                  rx={3}
                  fill="#38bdf8"
                />
                <rect
                  x={x + 14}
                  y={120 - newH}
                  width={12}
                  height={Math.max(2, newH)}
                  rx={3}
                  fill="#34d399"
                />
                <text x={x + 13} y={140} fontSize="9" fill="#94a3b8" textAnchor="middle">
                  {pt.date.slice(5)}
                </text>
              </g>
            );
          })}
        </svg>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Blue: Daily Flashcard Reviews · Green: New Contextual Words Collected
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <section class="panel">
          <h2>Progress by Language</h2>
          {stats.progressByLanguage.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No data yet.</div>
          ) : (
            stats.progressByLanguage.map((lp) => (
              <div key={lp.language} style={{ marginBottom: '8px', fontSize: '13.5px' }}>
                <strong>{lp.language.toUpperCase()}</strong>: {lp.collected} collected ·{' '}
                {lp.reviewed} reviewed · {lp.retained} retained
              </div>
            ))
          )}
        </section>

        <section class="panel">
          <h2>Most Frequently Reviewed</h2>
          {stats.mostReviewedWords.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              Complete flashcard sessions to populate review frequency.
            </div>
          ) : (
            stats.mostReviewedWords.map((w) => (
              <div key={w.lemma} style={{ marginBottom: '6px', fontSize: '13.5px' }}>
                <strong>{w.lemma}</strong> ({w.language}) — {w.reps} reviews, {w.lapses} lapses
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
