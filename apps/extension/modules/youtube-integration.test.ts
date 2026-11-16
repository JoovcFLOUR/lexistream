import { describe, expect, it, vi } from 'vitest';
import { YouTubeCaptionAdapter } from './captions/caption-adapter';
import { InteractiveSubtitleController } from './interaction/subtitle-controller';
import {
  ContextualLexicalProvider,
  TranslationService,
} from '@lexistream/translation-providers';
import { VocabularyRepository } from '@lexistream/vocabulary-engine';

function createMockYouTubeDom(options?: {
  videoId?: string;
  title?: string;
  currentTime?: number;
  captionsEnabled?: boolean;
  initialSubtitle?: string;
}) {
  const videoId = options?.videoId ?? 'dQw4w9WgXcQ';
  const title = options?.title ?? 'Deep Dive Into Context Learning';
  const currentTime = options?.currentTime ?? 125.4;
  const captionsEnabled = options?.captionsEnabled ?? true;

  window.history.replaceState({}, title, `/watch?v=${videoId}`);
  document.body.innerHTML = '';

  const titleHeading = document.createElement('h1');
  titleHeading.className = 'ytd-watch-metadata';
  const formatted = document.createElement('yt-formatted-string');
  formatted.textContent = title;
  titleHeading.appendChild(formatted);
  document.body.appendChild(titleHeading);

  const player = document.createElement('div');
  player.id = 'movie_player';
  player.className = 'html5-video-player';

  const video = document.createElement('video');
  video.className = 'html5-main-video';
  Object.defineProperty(video, 'currentTime', {
    value: currentTime,
    writable: true,
    configurable: true,
  });
  player.appendChild(video);

  const subBtn = document.createElement('button');
  subBtn.className = 'ytp-subtitles-button';
  subBtn.setAttribute('aria-pressed', captionsEnabled ? 'true' : 'false');
  player.appendChild(subBtn);

  const captionContainer = document.createElement('div');
  captionContainer.className = 'ytp-caption-window-container';
  if (options?.initialSubtitle) {
    const seg = document.createElement('span');
    seg.className = 'ytp-caption-segment';
    seg.textContent = options.initialSubtitle;
    captionContainer.appendChild(seg);
  }
  player.appendChild(captionContainer);

  document.body.appendChild(player);

  return { player, video, subBtn, captionContainer };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('YouTube Caption Adapter & Interactive Subtitle Controller', () => {
  it('detects active video, observes subtitle mutations, handles disappearance, and reports unavailable captions gracefully', async () => {
    const { captionContainer, subBtn, video } = createMockYouTubeDom({
      captionsEnabled: false,
    });

    const events: Array<{ text: string; available: boolean; timestamp: number }> = [];
    const adapter = new YouTubeCaptionAdapter({
      rootDocument: document,
      locationHref: () => window.location.href,
      onCueChange: (cue) => {
        events.push({
          text: cue.text,
          available: cue.captionsAvailable,
          timestamp: cue.timestamp,
        });
      },
    });

    adapter.start();
    expect(events[0]?.available).toBe(false);

    // Enable captions and emit a subtitle segment
    subBtn.setAttribute('aria-pressed', 'true');
    (video as HTMLVideoElement & { currentTime: number }).currentTime = 42.75;
    const seg = document.createElement('span');
    seg.className = 'ytp-caption-segment';
    seg.textContent = 'I never thought this would happen.';
    captionContainer.appendChild(seg);

    await new Promise((r) => setTimeout(r, 20));
    const latest = events[events.length - 1]!;
    expect(latest.available).toBe(true);
    expect(latest.text).toBe('I never thought this would happen.');
    expect(latest.timestamp).toBeCloseTo(42.75);

    // Subtitle disappears
    captionContainer.innerHTML = '';
    await new Promise((r) => setTimeout(r, 20));
    expect(events[events.length - 1]?.text).toBe('');

    adapter.stop();
  });

  it('renders interactive words preserving punctuation, isolates tooltip in Shadow DOM, cancels stale hovers, and saves contextual vocabulary on click', async () => {
    createMockYouTubeDom({
      videoId: 'vid_yt_mvp',
      title: 'Science of Vocabulary',
      currentTime: 125.4,
      captionsEnabled: true,
      initialSubtitle: 'I never thought, <img onerror="alert(1)"> this would happen!',
    });

    const repo = new VocabularyRepository('test-ext-mvp-db');
    const translationService = new TranslationService({
      providers: [new ContextualLexicalProvider()],
    });

    const capturedPayloads: Array<{ lemma: string; video_id: string }> = [];
    const controller = new InteractiveSubtitleController({
      rootDocument: document,
      locationHref: () => 'https://www.youtube.com/watch?v=vid_yt_mvp',
      translationService,
      vocabularyRepo: repo,
      sourceLanguage: 'en',
      targetLanguage: 'pt',
      hoverDebounceMs: 15,
      onVocabularyCaptured: (payload) => {
        capturedPayloads.push({ lemma: payload.lemma, video_id: payload.video_id });
      },
    });

    controller.start();
    await waitFor(() => Boolean(document.querySelector('[data-lexistream-overlay="true"]')));

    const overlay = document.querySelector('[data-lexistream-overlay="true"]')!;
    expect(overlay).toBeTruthy();
    // Exact text + punctuation preserved, and raw <img ...> rendered safely as text without creating an HTMLImageElement!
    expect(overlay.textContent).toBe(
      'I never thought, <img onerror="alert(1)"> this would happen!',
    );
    expect(overlay.querySelector('img')).toBeNull();

    const wordSpans = Array.from(overlay.querySelectorAll<HTMLElement>('.lx-word'));
    const neverSpan = wordSpans.find((el) => el.textContent === 'never')!;
    const thoughtSpan = wordSpans.find((el) => el.textContent === 'thought')!;
    expect(thoughtSpan).toBeTruthy();

    // Rapid hover sweep: hover "never" then immediately hover "thought" within 5ms
    const translateSpy = vi.spyOn(translationService, 'translate');
    neverSpan.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
    thoughtSpan.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    // Wait for debounce (15ms) + async lookup
    await new Promise((r) => setTimeout(r, 45));

    // Debounce prevented "never" from even firing a provider lookup!
    expect(translateSpy).toHaveBeenCalledTimes(1);

    const tooltipHost = document.querySelector('[data-lexistream-tooltip-host="true"]')!;
    expect(tooltipHost?.shadowRoot).toBeTruthy();
    const shadowText = tooltipHost.shadowRoot!.textContent ?? '';
    expect(shadowText).toContain('thought');
    expect(shadowText).toContain('think');
    expect(shadowText).toContain('verb');
    expect(shadowText).toContain('pensei / pensou');

    // Click "thought" -> saves to IndexedDB with full linguistic & video context
    thoughtSpan.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 45));

    expect(thoughtSpan.dataset.saved).toBe('true');
    expect(capturedPayloads).toEqual([{ lemma: 'think', video_id: 'vid_yt_mvp' }]);
    const savedItems = await repo.queryVocabulary({});
    expect(savedItems).toHaveLength(1);
    expect(savedItems[0]?.lemma).toBe('think');
    expect(savedItems[0]?.occurrences[0]).toMatchObject({
      surface_form: 'thought',
      video_id: 'vid_yt_mvp',
      video_title: 'Science of Vocabulary',
      timestamp: 125.4,
    });

    // Clicking an already-saved word displays its saved status in the Shadow DOM tooltip
    thoughtSpan.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 35));
    expect(tooltipHost.shadowRoot!.textContent).toContain('Saved');

    controller.stop();
  });

  it('auto-pauses playing YouTube video on word hover like Language Reactor, stays paused across words in the bar, resumes on leave, and respects manual pause', async () => {
    const { video } = createMockYouTubeDom({
      videoId: 'vid_autopause',
      title: 'Auto Pause Lecture',
      currentTime: 33.5,
      captionsEnabled: true,
      initialSubtitle: 'I never thought this would happen.',
    });

    let isPaused = false;
    Object.defineProperty(video, 'paused', {
      get: () => isPaused,
      configurable: true,
    });
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => {
      isPaused = true;
    });
    const playSpy = vi.spyOn(video, 'play').mockImplementation(async () => {
      isPaused = false;
    });

    const repo = new VocabularyRepository('test-ext-autopause-db');
    const translationService = new TranslationService({
      providers: [new ContextualLexicalProvider()],
    });

    const controller = new InteractiveSubtitleController({
      rootDocument: document,
      locationHref: () => 'https://www.youtube.com/watch?v=vid_autopause',
      translationService,
      vocabularyRepo: repo,
      hoverDebounceMs: 10,
      resumeGraceMs: 15,
    });

    controller.start();
    await waitFor(() => Boolean(document.querySelector('[data-lexistream-overlay="true"]')));

    const overlay = document.querySelector('[data-lexistream-overlay="true"]')!;
    const bar = overlay.querySelector<HTMLElement>('.lexistream-caption-bar')!;
    const words = Array.from(overlay.querySelectorAll<HTMLElement>('.lx-word'));
    const neverSpan = words.find((w) => w.textContent === 'never')!;
    const thoughtSpan = words.find((w) => w.textContent === 'thought')!;

    // 1. Video is playing -> hovering "never" immediately pauses the video
    neverSpan.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(isPaused).toBe(true);

    // 2. Moving from "never" across the bar space onto "thought" does NOT prematurely resume playback
    neverSpan.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: bar }),
    );
    thoughtSpan.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(playSpy).not.toHaveBeenCalled();
    expect(isPaused).toBe(true);

    // 3. Leaving the subtitle bar completely resumes video playback
    thoughtSpan.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    );
    await waitFor(() => playSpy.mock.calls.length === 1);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(isPaused).toBe(false);

    // 4. If user manually paused the video BEFORE hovering, leaving the word must NOT auto-play!
    isPaused = true;
    pauseSpy.mockClear();
    playSpy.mockClear();

    neverSpan.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(pauseSpy).not.toHaveBeenCalled();
    neverSpan.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    );
    await new Promise((r) => setTimeout(r, 35));
    expect(playSpy).not.toHaveBeenCalled();
    expect(isPaused).toBe(true);

    // 5. Clicking a native Play/Pause toggle button while auto-paused must NOT cancel out (pointerdown + click)
    isPaused = false;
    const playToggleBtn = document.createElement('button');
    playToggleBtn.className = 'ytp-play-button';
    playToggleBtn.addEventListener('click', () => {
      if (isPaused) {
        void video.play();
      } else {
        video.pause();
      }
    });
    document.body.appendChild(playToggleBtn);

    // Hover word -> auto-pauses video
    thoughtSpan.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(isPaused).toBe(true);

    // User clicks playToggleBtn (fires pointerdown then click) -> must end PLAYING (isPaused === false)!
    playToggleBtn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    playToggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isPaused).toBe(false);

    // 6. Realistic human mouse journey (200ms > resumeGraceMs): hover -> mouseout -> 200ms -> click Play/Pause toggle
    thoughtSpan.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(isPaused).toBe(true);
    thoughtSpan.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    );
    await new Promise((r) => setTimeout(r, 200));
    playToggleBtn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    playToggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isPaused).toBe(false);

    controller.stop();
  });
});
