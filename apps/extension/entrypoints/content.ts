import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  BackendProxyTranslationProvider,
  ContextualLexicalProvider,
  IndexedDbTranslationCache,
  TranslationService,
} from '@lexistream/translation-providers';
import { VocabularyRepository } from '@lexistream/vocabulary-engine';
import { InteractiveSubtitleController } from '../modules/interaction/subtitle-controller';

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_idle',
  async main(ctx) {
    const vocabularyRepo = new VocabularyRepository();
    const settings = await vocabularyRepo.getSettings();

    if (!settings.enable_interactive_captions) {
      return;
    }

    const proxyProvider = new BackendProxyTranslationProvider({
      baseUrl: settings.api_base_url,
      getAuthToken: () => settings.auth_token,
      timeoutMs: 2500,
    });
    const fallbackLexical = new ContextualLexicalProvider();

    const translationService = new TranslationService({
      providers: [proxyProvider, fallbackLexical],
      persistentCache: new IndexedDbTranslationCache(),
      memoryCacheSize: 512,
    });

    const controller = new InteractiveSubtitleController({
      translationService,
      vocabularyRepo,
      sourceLanguage: settings.source_language,
      targetLanguage: settings.target_language,
      hoverDebounceMs: settings.hover_debounce_ms,
    });

    controller.start();
    ctx.onInvalidated(() => {
      controller.stop();
    });
  },
});
