import { useState } from 'preact/hooks';
import type { SecondarySubtitleMode, UserSettings } from '@lexistream/shared-types';
import type { VocabularyRepository } from '@lexistream/vocabulary-engine';

export interface SettingsPageProps {
  repo: VocabularyRepository;
  settings: UserSettings;
  onUpdated: () => Promise<void>;
}

export function SettingsPage({ repo, settings, onUpdated }: SettingsPageProps) {
  const [sourceLang, setSourceLang] = useState(settings.source_language);
  const [targetLang, setTargetLang] = useState(settings.target_language);
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.api_base_url);
  const [dailyNew, setDailyNew] = useState(settings.daily_new_limit);
  const [dailyReview, setDailyReview] = useState(settings.daily_review_limit);
  const [pauseOnHover, setPauseOnHover] = useState(settings.pause_on_hover);
  const [secondaryMode, setSecondaryMode] = useState<SecondarySubtitleMode>(
    settings.secondary_subtitle_mode,
  );

  const [email, setEmail] = useState(settings.user_email ?? '');
  const [password, setPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const handleSavePreferences = async () => {
    await repo.saveSettings({
      source_language: sourceLang,
      target_language: targetLang,
      api_base_url: apiBaseUrl,
      daily_new_limit: Number(dailyNew),
      daily_review_limit: Number(dailyReview),
      pause_on_hover: pauseOnHover,
      secondary_subtitle_mode: secondaryMode,
    });
    setStatusMessage('Local preferences saved.');
    await onUpdated();
  };

  const handleAuth = async (mode: 'register' | 'login') => {
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/+$/, '')}/api/v1/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(errBody || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { token: string; email: string };
      await repo.saveSettings({
        api_base_url: apiBaseUrl,
        auth_token: data.token,
        user_email: data.email,
      });
      setPassword('');
      setStatusMessage(`Authenticated as ${data.email}.`);
      await onUpdated();
    } catch (err) {
      setStatusMessage(`Auth error: ${err instanceof Error ? err.message : 'Failed'}`);
    }
  };

  const handleSyncNow = async () => {
    try {
      const summary = await repo.synchronizeWithBackend({
        baseUrl: apiBaseUrl,
      });
      setStatusMessage(
        `Sync complete (seq #${summary.serverSeq}): pushed ${summary.pushedVocabulary} words, pulled ${summary.pulledVocabulary} words.`,
      );
      await onUpdated();
    } catch (err) {
      setStatusMessage(
        `Offline / Sync deferred: ${err instanceof Error ? err.message : 'Unreachable'}. Local data remains safe.`,
      );
    }
  };

  const handleWipeAll = async () => {
    await repo.wipeAllData();
    setStatusMessage('All local IndexedDB vocabulary and review history deleted.');
    await onUpdated();
  };

  return (
    <div>
      {statusMessage && (
        <div class="panel" role="status" style={{ borderColor: 'var(--accent)' }}>
          {statusMessage}
        </div>
      )}

      <section class="panel">
        <h2>Study &amp; Language Preferences (Local-First)</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <label>
            Source Subtitle Language
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang((e.target as HTMLSelectElement).value)}
            >
              <option value="en">English (en)</option>
              <option value="es">Spanish (es)</option>
              <option value="fr">French (fr)</option>
              <option value="de">German (de)</option>
              <option value="pt">Portuguese (pt)</option>
              <option value="la">Latin (la)</option>
            </select>
          </label>
          <label>
            Target Translation Language
            <select
              value={targetLang}
              onChange={(e) => setTargetLang((e.target as HTMLSelectElement).value)}
            >
              <option value="pt">Portuguese (pt)</option>
              <option value="en">English (en)</option>
              <option value="es">Spanish (es)</option>
              <option value="fr">French (fr)</option>
              <option value="de">German (de)</option>
              <option value="it">Italian (it)</option>
            </select>
          </label>
          <label>
            Secondary Translated Subtitle (YouTube Auto-Translate)
            <select
              data-testid="secondary-subtitle-mode-select"
              value={secondaryMode}
              onChange={(e) =>
                setSecondaryMode(
                  (e.target as HTMLSelectElement).value as SecondarySubtitleMode,
                )
              }
            >
              <option value="off">Off — LexiStream primary subtitle only</option>
              <option value="blurred">Blurred — Reveal on mouse hover</option>
              <option value="visible">Visible — Always sharp &amp; readable</option>
            </select>
          </label>
          <label>
            Daily New Cards Limit
            <input
              type="number"
              min={1}
              max={200}
              value={dailyNew}
              onInput={(e) => setDailyNew(Number((e.target as HTMLInputElement).value))}
            />
          </label>
          <label>
            Daily Total Reviews Limit
            <input
              type="number"
              min={1}
              max={1000}
              value={dailyReview}
              onInput={(e) => setDailyReview(Number((e.target as HTMLInputElement).value))}
            />
          </label>
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '14px',
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            data-testid="pause-on-hover-checkbox"
            checked={pauseOnHover}
            onChange={(e) => setPauseOnHover((e.target as HTMLInputElement).checked)}
          />
          Auto-pause YouTube video when hovering over a subtitle word (Language Reactor mode)
        </label>
        <button
          type="button"
          class="btn btn-primary"
          style={{ marginTop: '14px' }}
          onClick={() => void handleSavePreferences()}
        >
          Save Preferences
        </button>
      </section>

      <section class="panel">
        <h2>Cloud Synchronization (Optional — Works 100% Offline)</h2>
        <div style={{ display: 'grid', gap: '10px', maxWidth: '520px' }}>
          <label>
            Rust Backend API URL
            <input
              value={apiBaseUrl}
              onInput={(e) => setApiBaseUrl((e.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            Account Email
            <input
              type="email"
              value={email}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            />
          </label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" class="btn" onClick={() => void handleAuth('register')}>
              Register Account
            </button>
            <button type="button" class="btn" onClick={() => void handleAuth('login')}>
              Sign In
            </button>
            <button
              type="button"
              class="btn btn-primary"
              data-testid="sync-now-btn"
              onClick={() => void handleSyncNow()}
            >
              Synchronize Now
            </button>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>Privacy &amp; Data Control</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Your vocabulary lives locally in IndexedDB first. You can export it anytime in JSON/CSV
          from the Vocabulary tab or permanently erase all local data below.
        </p>
        <button
          type="button"
          class="btn btn-danger"
          data-testid="wipe-data-btn"
          onClick={() => void handleWipeAll()}
        >
          Delete All Local Data
        </button>
      </section>
    </div>
  );
}
