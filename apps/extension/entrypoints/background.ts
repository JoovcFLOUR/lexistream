import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import type {
  TranslationRequest,
  TranslationResult,
  VocabularyCaptureInput,
} from '@lexistream/shared-types';
import {
  BackendProxyTranslationProvider,
  ContextualLexicalProvider,
  IndexedDbTranslationCache,
  LiveWiktionaryApiProvider,
  OfflineWiktionaryProvider,
  TranslationService,
  WiktionaryDictionaryStore,
} from '@lexistream/translation-providers';
import { VocabularyRepository } from '@lexistream/vocabulary-engine';

/**
 * Event-driven Manifest V3 Service Worker.
 * Provides shared access to user-downloaded Wiktionary offline dictionaries
 * (`chrome-extension://` IndexedDB) for all YouTube content scripts with zero idle polling.
 */
export default defineBackground(() => {
  const repo = new VocabularyRepository();
  const dictStore = new WiktionaryDictionaryStore();

  let cachedApiUrl = 'http://127.0.0.1:8787';
  let cachedToken: string | null = null;

  const translationService = new TranslationService({
    providers: [
      new OfflineWiktionaryProvider(dictStore),
      new LiveWiktionaryApiProvider({ timeoutMs: 2800 }),
      new BackendProxyTranslationProvider({
        baseUrl: cachedApiUrl,
        getAuthToken: () => cachedToken,
        timeoutMs: 2200,
      }),
      new ContextualLexicalProvider(),
    ],
    persistentCache: new IndexedDbTranslationCache(),
    memoryCacheSize: 512,
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as
      | { type?: 'LEXISTREAM_SYNC_NOW' }
      | { type?: 'LEXISTREAM_CAPTURE'; payload?: VocabularyCaptureInput }
      | { type?: 'LEXISTREAM_TRANSLATE'; request?: TranslationRequest }
      | null;

    if (msg?.type === 'LEXISTREAM_TRANSLATE' && msg.request) {
      const req = msg.request;
      void (async () => {
        try {
          const cfg = await repo.getSettings();
          cachedApiUrl = cfg.api_base_url;
          cachedToken = cfg.auth_token;
          const result: TranslationResult = await translationService.translate(req);
          sendResponse({ ok: true, result });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Translation failed',
          });
        }
      })();
      return true;
    }

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
