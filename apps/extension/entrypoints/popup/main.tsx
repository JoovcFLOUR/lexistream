import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import {
  buildYouTubeTimestampUrl,
  type SecondarySubtitleMode,
  type UserSettings,
  type VocabularyItem,
} from '@lexistream/shared-types';
import { WiktionaryDictionaryStore } from '@lexistream/translation-providers';
import { VocabularyRepository } from '@lexistream/vocabulary-engine';

const repo = new VocabularyRepository();
const dictStore = new WiktionaryDictionaryStore();

export function PopupApp() {
  const [items, setItems] = useState<VocabularyItem[]>([]);
  const [installedDictCount, setInstalledDictCount] = useState(0);
  const [settings, setSettings] = useState<UserSettings | null>(null);

  useEffect(() => {
    void (async () => {
      const [vocab, packs, cfg] = await Promise.all([
        repo.queryVocabulary({}),
        dictStore.listInstalledPacks(),
        repo.getSettings(),
      ]);
      setItems(vocab);
      setInstalledDictCount(packs.length);
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

  const togglePauseOnHover = async () => {
    if (!settings) return;
    const updated = await repo.saveSettings({
      pause_on_hover: !settings.pause_on_hover,
    });
    setSettings(updated);
  };

  const updateSecondaryMode = async (mode: SecondarySubtitleMode) => {
    const updated = await repo.saveSettings({ secondary_subtitle_mode: mode });
    setSettings(updated);
  };

  const updateTargetLanguage = async (lang: string) => {
    const updated = await repo.saveSettings({ target_language: lang });
    setSettings(updated);
  };

  const openExtensionPage = (hash = '') => {
    const base = browser.runtime.getURL('/dashboard.html');
    window.open(`${base}${hash}`, '_blank', 'noopener');
  };

  return (
    <main class="popup-shell">
      <header class="brand-row">
        <span class="brand-title">LexiStream</span>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <label style={{ fontSize: '11.5px', display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={settings?.pause_on_hover ?? true}
              onChange={() => void togglePauseOnHover()}
            />
            Auto-pause
          </label>
          <label style={{ fontSize: '11.5px', display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={settings?.enable_interactive_captions ?? true}
              onChange={() => void toggleInteractive()}
            />
            Active
          </label>
        </div>
      </header>

      <section class="stats-strip" aria-label="Vocabulary summary">
        <div class="stat-card">
          <div class="stat-value">{items.length}</div>
          <div class="stat-label">Saved Words</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{installedDictCount}</div>
          <div class="stat-label">Wiktionary Dicts</div>
        </div>
      </section>

      <section class="popup-select-row" aria-label="Dual subtitle controls">
        <label class="popup-field">
          2nd Subtitle (YT Auto)
          <select
            value={settings?.secondary_subtitle_mode ?? 'off'}
            onChange={(e) =>
              void updateSecondaryMode(
                (e.target as HTMLSelectElement).value as SecondarySubtitleMode,
              )
            }
          >
            <option value="off">Off (LexiStream only)</option>
            <option value="blurred">Blurred (Reveal on hover)</option>
            <option value="visible">Visible (Always sharp)</option>
          </select>
        </label>
        <label class="popup-field">
          Translate to
          <select
            value={settings?.target_language ?? 'pt'}
            onChange={(e) => void updateTargetLanguage((e.target as HTMLSelectElement).value)}
          >
            <option value="pt">Português (pt)</option>
            <option value="en">English (en)</option>
            <option value="es">Español (es)</option>
            <option value="fr">Français (fr)</option>
            <option value="de">Deutsch (de)</option>
            <option value="it">Italiano (it)</option>
          </select>
        </label>
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

      <div style={{ display: 'grid', gap: '7px' }}>
        <button
          type="button"
          class="btn-primary"
          style={{ background: '#334155' }}
          onClick={() => openExtensionPage('#dictionaries')}
        >
          📚 Dicionários Wiktionary ({installedDictCount})
        </button>
        <button
          type="button"
          class="btn-primary"
          onClick={() => openExtensionPage('')}
        >
          Open Study Dashboard
        </button>
      </div>
    </main>
  );
}

const mount = document.getElementById('app');
if (mount) {
  render(<PopupApp />, mount);
}
