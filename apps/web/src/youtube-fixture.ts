import {
  ContextualLexicalProvider,
  IndexedDbTranslationCache,
  OfflineWiktionaryProvider,
  TranslationService,
  WiktionaryDictionaryStore,
} from '@lexistream/translation-providers';
import { VocabularyRepository } from '@lexistream/vocabulary-engine';
import { InteractiveSubtitleController } from '../../extension/modules/interaction/subtitle-controller';

const video = document.querySelector<HTMLVideoElement>('video.html5-main-video')!;
let simulatedTime = 125.4;
Object.defineProperty(video, 'currentTime', {
  get: () => simulatedTime,
  set: (v: number) => {
    simulatedTime = v;
  },
  configurable: true,
});

const repo = new VocabularyRepository();
const translationService = new TranslationService({
  providers: [
    new OfflineWiktionaryProvider(new WiktionaryDictionaryStore()),
    new ContextualLexicalProvider(),
  ],
  persistentCache: new IndexedDbTranslationCache(),
});

const controller = new InteractiveSubtitleController({
  rootDocument: document,
  locationHref: () => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  translationService,
  vocabularyRepo: repo,
  sourceLanguage: 'en',
  targetLanguage: 'pt',
  hoverDebounceMs: 25,
});

controller.start();

const seg = document.getElementById('cue-segment')!;
const ccBtn = document.getElementById('cc-toggle')!;

document.getElementById('cue-1')?.addEventListener('click', () => {
  simulatedTime = 125.4;
  seg.textContent = 'I never thought this would happen.';
});

document.getElementById('cue-2')?.addEventListener('click', () => {
  simulatedTime = 182.0;
  seg.textContent = 'That was a fascinating thought by the river bank.';
});

document.getElementById('cue-3')?.addEventListener('click', () => {
  simulatedTime = 240.5;
  seg.textContent = 'Never give up when you look it up in context.';
});

document.getElementById('cue-4')?.addEventListener('click', () => {
  simulatedTime = 69.0;
  seg.textContent = "Aujourd'hui, ce petit territoire souverain et indépendant";
});

document.getElementById('cue-5')?.addEventListener('click', () => {
  simulatedTime = 74.2;
  seg.textContent = 'Cette île est appelée Formosa.';
});

document.getElementById('cue-off')?.addEventListener('click', () => {
  const isPressed = ccBtn.getAttribute('aria-pressed') === 'true';
  ccBtn.setAttribute('aria-pressed', isPressed ? 'false' : 'true');
  ccBtn.textContent = isPressed ? 'CC: OFF' : 'CC: ON';
  seg.textContent = isPressed ? '' : 'I never thought this would happen.';
});
