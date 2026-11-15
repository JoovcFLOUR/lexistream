import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import type { TranslationRequest, TranslationResult } from '@lexistream/shared-types';
import {
  ContextualLexicalProvider,
  IndexedDbTranslationCache,
  LiveWiktionaryApiProvider,
  OfflineWiktionaryProvider,
  TranslationService,
  WiktionaryDictionaryStore,
  type TranslationProvider,
} from '@lexistream/translation-providers';
import { VocabularyRepository } from '@lexistream/vocabulary-engine';
import { InteractiveSubtitleController } from '../modules/interaction/subtitle-controller';

class ExtensionBackgroundDictionaryBridge implements TranslationProvider {
  readonly id = 'extension-background-wiktionary-bridge';

  async translate(
    request: TranslationRequest,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    if (signal?.aborted) {
      throw new DOMException('Translation aborted', 'AbortError');
    }
    const resp = (await browser.runtime.sendMessage({
      type: 'LEXISTREAM_TRANSLATE',
      request,
    })) as { ok?: boolean; result?: TranslationResult; error?: string } | undefined;

    if (!resp?.ok || !resp.result) {
      throw new Error(resp?.error ?? 'Background dictionary bridge unavailable');
    }
    return resp.result;
  }
}

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_idle',
  async main(ctx) {
    const vocabularyRepo = new VocabularyRepository();
    const settings = await vocabularyRepo.getSettings();

    if (!settings.enable_interactive_captions) {
      return;
    }

    const translationService = new TranslationService({
      providers: [
        new ExtensionBackgroundDictionaryBridge(),
        new OfflineWiktionaryProvider(new WiktionaryDictionaryStore()),
        new LiveWiktionaryApiProvider({ timeoutMs: 2800 }),
        new ContextualLexicalProvider(),
      ],
      persistentCache: new IndexedDbTranslationCache(),
      memoryCacheSize: 512,
    });

    const controller = new InteractiveSubtitleController({
      translationService,
      vocabularyRepo,
      sourceLanguage: settings.source_language,
      targetLanguage: settings.target_language,
      hoverDebounceMs: settings.hover_debounce_ms,
      onVocabularyCaptured: (payload) => {
        void browser.runtime
          .sendMessage({ type: 'LEXISTREAM_CAPTURE', payload })
          .catch(() => {});
      },
    });

    controller.start();
    ctx.onInvalidated(() => {
      controller.stop();
    });
  },
});
