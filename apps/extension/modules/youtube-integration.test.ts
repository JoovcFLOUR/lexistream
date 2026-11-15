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

    const controller = new InteractiveSubtitleController({
      rootDocument: document,
      locationHref: () => 'https://www.youtube.com/watch?v=vid_yt_mvp',
      translationService,
      vocabularyRepo: repo,
      sourceLanguage: 'en',
      targetLanguage: 'pt',
      hoverDebounceMs: 15,
    });

    controller.start();
    await new Promise((r) => setTimeout(r, 20));

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
});
