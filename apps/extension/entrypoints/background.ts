import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import type { VocabularyCaptureInput } from '@lexistream/shared-types';
import { VocabularyRepository } from '@lexistream/vocabulary-engine';

/**
 * Event-driven Manifest V3 Service Worker.
 * Intentionally avoids continuous timers or background polling loops to keep idle RAM/CPU at zero.
 */
export default defineBackground(() => {
  const repo = new VocabularyRepository();

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as
      | { type?: 'LEXISTREAM_SYNC_NOW' }
      | { type?: 'LEXISTREAM_CAPTURE'; payload?: VocabularyCaptureInput }
      | null;

    if (msg?.type === 'LEXISTREAM_CAPTURE' && msg.payload) {
      const payload = msg.payload;
      void (async () => {
        try {
          const saved = await repo.captureVocabulary(payload);
          sendResponse({ ok: true, id: saved.item.id });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Capture mirror failed',
          });
        }
      })();
      return true;
    }

    if (msg?.type === 'LEXISTREAM_SYNC_NOW') {
      void (async () => {
        try {
          const settings = await repo.getSettings();
          const summary = await repo.synchronizeWithBackend({
            baseUrl: settings.api_base_url,
            authToken: settings.auth_token,
          });
          sendResponse({ ok: true, summary });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Sync failed',
          });
        }
      })();
      return true;
    }
    return false;
  });
});
