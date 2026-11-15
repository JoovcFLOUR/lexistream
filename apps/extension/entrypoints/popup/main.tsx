import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import {
  buildYouTubeTimestampUrl,
  type UserSettings,
  type VocabularyItem,
} from '@lexistream/shared-types';
import { VocabularyRepository } from '@lexistream/vocabulary-engine';

const repo = new VocabularyRepository();

export function PopupApp() {
  const [items, setItems] = useState<VocabularyItem[]>([]);
  const [pendingSync, setPendingSync] = useState(0);
  const [settings, setSettings] = useState<UserSettings | null>(null);

  useEffect(() => {
    void (async () => {
      const [vocab, pending, cfg] = await Promise.all([
        repo.queryVocabulary({}),
        repo.getPendingSyncCount(),
        repo.getSettings(),
      ]);
      setItems(vocab);
      setPendingSync(pending);
      setSettings(cfg);
    })();
  }, []);

  const toggleInteractive = async () => {
    if (!settings) return;
    const updated = await repo.saveSettings({
      enable_interactive_captions: !settings.enable_interactive_captions,
    });
    setSettings(updated);
  };

  return (
    <main class="popup-shell">
      <header class="brand-row">
        <span class="brand-title">LexiStream</span>
        <label style={{ fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={settings?.enable_interactive_captions ?? true}
            onChange={() => void toggleInteractive()}
          />
          Active on YT
        </label>
      </header>

      <section class="stats-strip" aria-label="Vocabulary summary">
        <div class="stat-card">
          <div class="stat-value">{items.length}</div>
          <div class="stat-label">Saved Words</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{pendingSync}</div>
          <div class="stat-label">Offline Queued</div>
        </div>
      </section>

      <section class="recent-list" aria-label="Recent captures">
        {items.length === 0 ? (
          <div style={{ fontSize: '12px', color: '#94a3b8', padding: '8px 0' }}>
            Watch any YouTube video with captions and click a word to capture it in context.
          </div>
        ) : (
          items.slice(0, 5).map((item) => {
            const occ = item.occurrences[item.occurrences.length - 1];
            const href = occ
              ? buildYouTubeTimestampUrl(occ.video_url, occ.video_id, occ.timestamp)
              : 'https://www.youtube.com';
            return (
              <a
                key={item.id}
                class="recent-item"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="recent-word">{item.lemma}</span>
                <span class="recent-trans">{item.primary_translation}</span>
              </a>
            );
          })
        )}
      </section>

      <button
        type="button"
        class="btn-primary"
        onClick={() => {
          const dashboardUrl = browser.runtime.getURL('/dashboard.html');
          window.open(dashboardUrl, '_blank', 'noopener');
        }}
      >
        Open Study Dashboard
      </button>
    </main>
  );
}

const mount = document.getElementById('app');
if (mount) {
  render(<PopupApp />, mount);
}
