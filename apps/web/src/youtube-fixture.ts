import {
  ContextualLexicalProvider,
  IndexedDbTranslationCache,
  OfflineWiktionaryProvider,
  TranslationService,
  WiktionaryDictionaryStore,
} from '@lexistream/translation-providers';
import {
  VocabularyRepository,
  subscribeLexiStreamEvents,
} from '@lexistream/vocabulary-engine';
import { InteractiveSubtitleController } from '../../extension/modules/interaction/subtitle-controller';

const video = document.querySelector<HTMLVideoElement>('video.html5-main-video')!;
const playPauseBtn = document.getElementById('play-pause-btn')!;
const statusBadge = document.getElementById('playback-status')!;
const seg = document.getElementById('cue-segment')!;
const ccBtn = document.getElementById('cc-toggle')!;

let simulatedTime = 125.4;
let simulatedPaused = true;
let autoCycleCues = false;

const TIMED_CUES = [
  "Aujourd'hui, ce petit territoire souverain et indépendant",
  'Cette île est appelée Formosa.',
  'Nous parlons français dans ce pays libre.',
  'I never thought this would happen.',
  'Never give up when you look it up in context.',
];
let cueIndex = 0;

function updatePlaybackHud() {
  statusBadge.dataset.playing = simulatedPaused ? 'false' : 'true';
  statusBadge.textContent = `${simulatedPaused ? '⏸ PAUSED' : '▶ PLAYING'} · ${simulatedTime.toFixed(1)}s`;
  playPauseBtn.textContent = simulatedPaused ? '▶ Play Video' : '⏸ Pause Video';
}

Object.defineProperty(video, 'currentTime', {
  get: () => simulatedTime,
  set: (v: number) => {
    simulatedTime = v;
    updatePlaybackHud();
  },
  configurable: true,
});

Object.defineProperty(video, 'paused', {
  get: () => simulatedPaused,
  configurable: true,
});

Object.defineProperty(video, 'ended', {
  get: () => false,
  configurable: true,
});

video.pause = () => {
  if (!simulatedPaused) {
    simulatedPaused = true;
    updatePlaybackHud();
    video.dispatchEvent(new Event('pause'));
  }
};

video.play = async () => {
  if (simulatedPaused) {
    simulatedPaused = false;
    updatePlaybackHud();
    video.dispatchEvent(new Event('play'));
  }
};

let elapsedSinceCueSwitch = 0;
let asrRollupTimer: ReturnType<typeof setInterval> | null = null;

function stopAsrDomRollup() {
  if (asrRollupTimer !== null) {
    clearInterval(asrRollupTimer);
    asrRollupTimer = null;
  }
}

setInterval(() => {
  if (!simulatedPaused) {
    simulatedTime = Number((simulatedTime + 0.1).toFixed(1));
    video.dispatchEvent(new Event('timeupdate'));
    elapsedSinceCueSwitch += 0.1;
    if (autoCycleCues && elapsedSinceCueSwitch >= 2.5 && ccBtn.getAttribute('aria-pressed') === 'true') {
      elapsedSinceCueSwitch = 0;
      cueIndex = (cueIndex + 1) % TIMED_CUES.length;
      seg.textContent = TIMED_CUES[cueIndex]!;
    }
    updatePlaybackHud();
  }
}, 100);

playPauseBtn.addEventListener('click', () => {
  if (simulatedPaused) {
    autoCycleCues = true;
    elapsedSinceCueSwitch = 0;
    void video.play();
  } else {
    autoCycleCues = false;
    video.pause();
  }
});

const repo = new VocabularyRepository();
const translationService = new TranslationService({
  providers: [
    new OfflineWiktionaryProvider(new WiktionaryDictionaryStore()),
    new ContextualLexicalProvider(),
  ],
  persistentCache: new IndexedDbTranslationCache(),
});

let controller: InteractiveSubtitleController | null = null;

void repo.getSettings().then((settings) => {
  controller = new InteractiveSubtitleController({
    rootDocument: document,
    locationHref: () => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    translationService,
    vocabularyRepo: repo,
    sourceLanguage: settings.source_language,
    targetLanguage: settings.target_language,
    hoverDebounceMs: 25,
    pauseOnHover: settings.pause_on_hover,
    resumeGraceMs: 90,
  });
  controller.start();
});

subscribeLexiStreamEvents((ev) => {
  if (ev.type === 'settings_changed') {
    void repo.getSettings().then((s) => {
      controller?.setPauseOnHover(s.pause_on_hover);
    });
  }
});

document.getElementById('cue-1')?.addEventListener('click', () => {
  stopAsrDomRollup();
  controller?.clearStaticTrack();
  autoCycleCues = false;
  simulatedTime = 125.4;
  seg.textContent = 'I never thought this would happen.';
  updatePlaybackHud();
});

document.getElementById('cue-2')?.addEventListener('click', () => {
  stopAsrDomRollup();
  controller?.clearStaticTrack();
  autoCycleCues = false;
  simulatedTime = 182.0;
  seg.textContent = 'That was a fascinating thought by the river bank.';
  updatePlaybackHud();
});

document.getElementById('cue-3')?.addEventListener('click', () => {
  stopAsrDomRollup();
  controller?.clearStaticTrack();
  autoCycleCues = false;
  simulatedTime = 240.5;
  seg.textContent = 'Never give up when you look it up in context.';
  updatePlaybackHud();
});

document.getElementById('cue-4')?.addEventListener('click', () => {
  stopAsrDomRollup();
  controller?.clearStaticTrack();
  autoCycleCues = false;
  simulatedTime = 69.0;
  seg.textContent = "Aujourd'hui, ce petit territoire souverain et indépendant";
  updatePlaybackHud();
});

document.getElementById('cue-5')?.addEventListener('click', () => {
  stopAsrDomRollup();
  controller?.clearStaticTrack();
  autoCycleCues = false;
  simulatedTime = 74.2;
  seg.textContent = 'Cette île est appelée Formosa.';
  updatePlaybackHud();
});

const SAMPLE_ASR_JSON3 = JSON.stringify({
  wireMagic: 'pb3',
  events: [
    {
      tStartMs: 10000,
      dDurationMs: 4200,
      wWinId: 1,
      segs: [
        { utf8: 'voterai' },
        { utf8: ' lors', tOffsetMs: 220 },
        { utf8: ' des', tOffsetMs: 420 },
        { utf8: ' prochaines', tOffsetMs: 650 },
        { utf8: ' élections', tOffsetMs: 920 },
        { utf8: ' présidentielles', tOffsetMs: 1250 },
        { utf8: ' en', tOffsetMs: 1580 },
        { utf8: ' 2027.', tOffsetMs: 1820 },
      ],
    },
    {
      tStartMs: 14200,
      dDurationMs: 4000,
      wWinId: 1,
      segs: [
        { utf8: 'Et' },
        { utf8: ' cette', tOffsetMs: 240 },
        { utf8: ' personne,', tOffsetMs: 520 },
        { utf8: " c'est", tOffsetMs: 850 },
        { utf8: ' Jean-Luc', tOffsetMs: 1150 },
        { utf8: ' Mélenchon.', tOffsetMs: 1480 },
      ],
    },
  ],
});

document.getElementById('asr-rollup-btn')?.addEventListener('click', () => {
  stopAsrDomRollup();
  autoCycleCues = false;
  simulatedTime = 10.1;
  updatePlaybackHud();

  // Load full static pre-assembled track into LexiStream
  controller?.loadStaticJson3Track('dQw4w9WgXcQ', SAMPLE_ASR_JSON3);

  // Simultaneously simulate YouTube's raw DOM appending 1 word every 180ms in .ytp-caption-segment
  const rawWords = [
    'voterai',
    'lors',
    'des',
    'prochaines',
    'élections',
    'présidentielles',
    'en',
    '2027.',
  ];
  let wIdx = 1;
  seg.textContent = rawWords[0]!;
  void video.play();

  asrRollupTimer = setInterval(() => {
    if (!simulatedPaused && wIdx < rawWords.length) {
      wIdx++;
      seg.textContent = rawWords.slice(0, wIdx).join(' ');
    }
  }, 180);
});

document.getElementById('cue-off')?.addEventListener('click', () => {
  const isPressed = ccBtn.getAttribute('aria-pressed') === 'true';
  ccBtn.setAttribute('aria-pressed', isPressed ? 'false' : 'true');
  ccBtn.textContent = isPressed ? 'CC: OFF' : 'CC: ON';
  seg.textContent = isPressed ? '' : 'I never thought this would happen.';
});
