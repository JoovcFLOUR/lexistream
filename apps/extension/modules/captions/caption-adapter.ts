import {
  YOUTUBE_SELECTORS,
  extractYouTubeMetadata,
  parseYouTubeVideoId,
  type YouTubeVideoMetadata,
} from '../youtube/selectors';
import {
  canonicalTimedTextSignature,
  findActiveCueAtTime,
  parseYouTubeJson3ToStaticCues,
  type TimedSubtitleCue,
} from './static-track';

export interface SubtitleCueSnapshot {
  text: string;
  captionsAvailable: boolean;
  timestamp: number;
  video: YouTubeVideoMetadata | null;
}

export interface YouTubeCaptionAdapterOptions {
  rootDocument?: Document;
  locationHref?: () => string;
  fetchImpl?: typeof fetch;
  getResourceUrls?: () => string[];
  onCueChange: (snapshot: SubtitleCueSnapshot) => void;
}

/**
 * Observes YouTube subtitles with Static Pre-Assembled Track priority:
 * 1. Passively detects YouTube's own `/api/timedtext` resource URLs via `PerformanceObserver`
 *    and converts word-by-word ASR roll-up tracks into motionless, embedded-style static cue blocks.
 * 2. Synchronizes static cues to `<video>` playback (`timeupdate`, `seeked`, `play`, plus exact
 *    boundary timer while playing — zero idle polling when paused).
 * 3. Gracefully falls back to scoped `#movie_player` DOM segment observation when no timedtext
 *    resource URL is present (e.g., offline fixtures).
 */
export class YouTubeCaptionAdapter {
  private readonly doc: Document;
  private readonly getHref: () => string;
  private readonly fetchImpl: typeof fetch;
  private readonly getResourceUrls: () => string[];
  private readonly onCueChange: (snapshot: SubtitleCueSnapshot) => void;

  private playerObserver: MutationObserver | null = null;
  private bootstrapObserver: MutationObserver | null = null;
  private resourceObserver: PerformanceObserver | null = null;
  private observedPlayer: Element | null = null;
  private observedVideo: HTMLVideoElement | null = null;

  private activeTrackKey: string | null = null;
  private activeStaticCues: TimedSubtitleCue[] | null = null;
  private readonly fetchedTracks = new Map<string, Promise<TimedSubtitleCue[] | null>>();
  private readonly ownFetchUrls = new Set<string>();
  private boundaryTimer: ReturnType<typeof setTimeout> | null = null;

  private lastEmittedSignature = '';
  private readonly boundHandleNavigation: () => void;
  private readonly boundVideoSync: () => void;
  private readonly boundHandlePostMessage: (ev: MessageEvent) => void;

  constructor(options: YouTubeCaptionAdapterOptions) {
    this.doc = options.rootDocument ?? document;
    this.getHref = options.locationHref ?? (() => window.location.href);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.getResourceUrls =
      options.getResourceUrls ??
      (() => {
        if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
          return [];
        }
        return performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((name) => name.includes('/api/timedtext'));
      });
    this.onCueChange = options.onCueChange;
    this.boundHandleNavigation = () => this.handleNavigation();
    this.boundVideoSync = () => this.inspectCurrentCue();
    this.boundHandlePostMessage = (ev: MessageEvent) => {
      const data = ev.data as {
        source?: string;
        type?: string;
        url?: string;
        body?: string;
      } | null;
      if (
        data?.source === 'lexistream-yt-main' &&
        data.type === 'TIMEDTEXT_PAYLOAD' &&
        typeof data.url === 'string' &&
        typeof data.body === 'string'
      ) {
        this.ingestDirectTimedTextPayload(data.url, data.body);
      }
    };
  }

  /**
   * Allows tests or fixtures to load a pre-assembled static `json3` track directly.
   */
  loadStaticJson3Track(videoId: string, rawJson3: string): void {
    const cues = parseYouTubeJson3ToStaticCues(rawJson3);
    if (cues.length > 0) {
      this.activeTrackKey = `${videoId}::manual-static`;
      this.activeStaticCues = cues;
      this.inspectCurrentCue();
    }
  }

  clearStaticTrack(): void {
    this.activeTrackKey = null;
    this.activeStaticCues = null;
    this.clearBoundaryTimer();
    this.inspectCurrentCue();
  }

  start(): void {
    this.rebindPlayerObserver();
    this.startResourceObserver();
    this.scanExistingTimedTextResources();

    if (!this.observedPlayer && this.doc.body) {
      this.bootstrapObserver = new MutationObserver(() => {
        const player = this.doc.querySelector(YOUTUBE_SELECTORS.playerContainer);
        if (player) {
          this.bootstrapObserver?.disconnect();
          this.bootstrapObserver = null;
          this.rebindPlayerObserver();
          this.scanExistingTimedTextResources();
        }
      });
      this.bootstrapObserver.observe(this.doc.body, {
        childList: true,
        subtree: true,
      });
    }

    window.addEventListener('message', this.boundHandlePostMessage);
    window.addEventListener('yt-navigate-finish', this.boundHandleNavigation);
    window.addEventListener('popstate', this.boundHandleNavigation);
  }

  stop(): void {
    this.clearBoundaryTimer();
    this.unbindVideoEvents();
    this.playerObserver?.disconnect();
    this.playerObserver = null;
    this.bootstrapObserver?.disconnect();
    this.bootstrapObserver = null;
    this.resourceObserver?.disconnect();
    this.resourceObserver = null;
    this.observedPlayer = null;
    window.removeEventListener('message', this.boundHandlePostMessage);
    window.removeEventListener('yt-navigate-finish', this.boundHandleNavigation);
    window.removeEventListener('popstate', this.boundHandleNavigation);
  }

  private handleNavigation(): void {
    const currentVid = parseYouTubeVideoId(this.getHref());
    if (this.activeTrackKey && currentVid && !this.activeTrackKey.startsWith(`${currentVid}::`)) {
      this.activeTrackKey = null;
      this.activeStaticCues = null;
    }
    this.rebindPlayerObserver();
    this.scanExistingTimedTextResources();
  }

  private startResourceObserver(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      this.resourceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name.includes('/api/timedtext') && !this.ownFetchUrls.has(entry.name)) {
            void this.ingestTimedTextUrl(entry.name);
          }
        }
      });
      this.resourceObserver.observe({ type: 'resource', buffered: true });
    } catch {
      this.resourceObserver = null;
    }
  }

  private scanExistingTimedTextResources(): void {
    const urls = this.getResourceUrls();
    for (let i = urls.length - 1; i >= 0; i--) {
      const url = urls[i]!;
      if (this.ownFetchUrls.has(url)) continue;
      const parsed = canonicalTimedTextSignature(url);
      const currentVid = parseYouTubeVideoId(this.getHref());
      if (parsed && (!currentVid || parsed.videoId === currentVid)) {
        void this.ingestTimedTextUrl(url);
        break;
      }
    }
  }

  private ingestDirectTimedTextPayload(rawUrl: string, rawBody: string): void {
    const sig = canonicalTimedTextSignature(rawUrl);
    if (!sig) return;
    const currentVid = parseYouTubeVideoId(this.getHref());
    if (currentVid && sig.videoId !== currentVid) return;

    const cues = parseYouTubeJson3ToStaticCues(rawBody);
    if (cues.length > 0) {
      this.fetchedTracks.set(sig.trackKey, Promise.resolve(cues));
      this.activeTrackKey = sig.trackKey;
      this.activeStaticCues = cues;
      this.inspectCurrentCue();
    } else {
      void this.ingestTimedTextUrl(rawUrl);
    }
  }

  private async ingestTimedTextUrl(rawUrl: string): Promise<void> {
    const sig = canonicalTimedTextSignature(rawUrl);
    if (!sig) return;

    const currentVid = parseYouTubeVideoId(this.getHref());
    if (currentVid && sig.videoId !== currentVid) return;

    let task = this.fetchedTracks.get(sig.trackKey);
    if (!task) {
      this.ownFetchUrls.add(sig.json3Url);
      task = (async () => {
        try {
          const resp = await this.fetchImpl(sig.json3Url);
          if (!resp.ok) return null;
          const body = await resp.text();
          const cues = parseYouTubeJson3ToStaticCues(body);
          return cues.length > 0 ? cues : null;
        } catch {
          return null;
        }
      })();
      this.fetchedTracks.set(sig.trackKey, task);
    }

    const cues = await task;
    const latestVid = parseYouTubeVideoId(this.getHref());
    if (cues && (!latestVid || sig.videoId === latestVid)) {
      this.activeTrackKey = sig.trackKey;
      this.activeStaticCues = cues;
      this.inspectCurrentCue();
    }
  }

  private bindVideoEvents(player: Element): void {
    const video = player.querySelector<HTMLVideoElement>(YOUTUBE_SELECTORS.videoElement);
    if (video === this.observedVideo) return;
    this.unbindVideoEvents();
    if (!video) return;

    this.observedVideo = video;
    video.addEventListener('timeupdate', this.boundVideoSync);
    video.addEventListener('seeking', this.boundVideoSync);
    video.addEventListener('seeked', this.boundVideoSync);
    video.addEventListener('play', this.boundVideoSync);
    video.addEventListener('pause', this.boundVideoSync);
    video.addEventListener('ratechange', this.boundVideoSync);
  }

  private unbindVideoEvents(): void {
    if (!this.observedVideo) return;
    this.observedVideo.removeEventListener('timeupdate', this.boundVideoSync);
    this.observedVideo.removeEventListener('seeking', this.boundVideoSync);
    this.observedVideo.removeEventListener('seeked', this.boundVideoSync);
    this.observedVideo.removeEventListener('play', this.boundVideoSync);
    this.observedVideo.removeEventListener('pause', this.boundVideoSync);
    this.observedVideo.removeEventListener('ratechange', this.boundVideoSync);
    this.observedVideo = null;
  }

  private rebindPlayerObserver(): void {
    const player = this.doc.querySelector(YOUTUBE_SELECTORS.playerContainer);
    if (!player) {
      this.emitIfChanged({
        text: '',
        captionsAvailable: false,
        timestamp: 0,
        video: extractYouTubeMetadata(this.doc, this.getHref()),
      });
      return;
    }

    this.bindVideoEvents(player);

    if (player !== this.observedPlayer) {
      this.playerObserver?.disconnect();
      this.observedPlayer = player;
      this.playerObserver = new MutationObserver((mutations) => {
        const relevant = mutations.some((m) => {
          const target = m.target as HTMLElement | null;
          if (target?.closest?.('[data-lexistream-internal="true"]')) return false;

          // When Static Pre-Assembled Track is active, ignore word-by-word DOM caption
          // mutations completely, reacting ONLY to the CC toggle button's aria-pressed state!
          if (this.activeStaticCues) {
            return (
              m.type === 'attributes' &&
              m.attributeName === 'aria-pressed' &&
              Boolean(target?.matches?.(YOUTUBE_SELECTORS.subtitlesToggleButton))
            );
          }
          return true;
        });
        if (relevant) {
          this.inspectCurrentCue();
        }
      });

      this.playerObserver.observe(player, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['aria-pressed'],
      });
    }

    this.inspectCurrentCue();
  }

  private clearBoundaryTimer(): void {
    if (this.boundaryTimer !== null) {
      clearTimeout(this.boundaryTimer);
      this.boundaryTimer = null;
    }
  }

  private scheduleNextCueBoundary(
    cues: readonly TimedSubtitleCue[],
    currentTimeSec: number,
    video: HTMLVideoElement | null,
  ): void {
    this.clearBoundaryTimer();
    if (!video || video.paused || video.ended) return;

    const nowMs = currentTimeSec * 1000;
    const active = findActiveCueAtTime(cues, currentTimeSec);
    let nextTransitionMs: number | null = null;

    if (active) {
      nextTransitionMs = active.endMs;
    } else {
      // Find next upcoming cue start
      const upcoming = cues.find((c) => c.startMs > nowMs);
      if (upcoming) nextTransitionMs = upcoming.startMs;
    }

    if (nextTransitionMs !== null && nextTransitionMs > nowMs) {
      const rate = video.playbackRate > 0 ? video.playbackRate : 1;
      const delayMs = Math.min(5000, Math.max(16, (nextTransitionMs - nowMs) / rate + 8));
      this.boundaryTimer = setTimeout(() => {
        this.boundaryTimer = null;
        this.inspectCurrentCue();
      }, delayMs);
    }
  }

  inspectCurrentCue(): void {
    const player =
      this.observedPlayer ?? this.doc.querySelector(YOUTUBE_SELECTORS.playerContainer);
    const meta = extractYouTubeMetadata(this.doc, this.getHref());
    if (!player) return;

    this.bindVideoEvents(player);
    const subButton = player.querySelector(YOUTUBE_SELECTORS.subtitlesToggleButton);
    const buttonPressed = subButton?.getAttribute('aria-pressed') === 'true';

    // Mode 1: Static Pre-Assembled Track (eliminates ASR word-by-word roll-up jitter)
    if (this.activeStaticCues && this.activeStaticCues.length > 0) {
      // If user explicitly has CC button present and turned OFF, honor CC OFF
      if (subButton && !buttonPressed) {
        this.clearBoundaryTimer();
        this.emitIfChanged({
          text: '',
          captionsAvailable: false,
          timestamp: meta?.currentTime ?? 0,
          video: meta,
        });
        return;
      }

      const currentTime = meta?.currentTime ?? 0;
      const cue = findActiveCueAtTime(this.activeStaticCues, currentTime);
      this.scheduleNextCueBoundary(this.activeStaticCues, currentTime, this.observedVideo);

      this.emitIfChanged({
        text: cue?.text ?? '',
        captionsAvailable: true,
        timestamp: currentTime,
        video: meta,
      });
      return;
    }

    // Mode 2: Fallback DOM segment reader (for non-timedtext fixtures or custom embeds)
    const segments = Array.from(player.querySelectorAll(YOUTUBE_SELECTORS.captionSegment));
    const text = segments
      .map((s) => s.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const captionsAvailable = buttonPressed || text.length > 0;

    this.emitIfChanged({
      text,
      captionsAvailable,
      timestamp: meta?.currentTime ?? 0,
      video: meta,
    });
  }

  private emitIfChanged(snapshot: SubtitleCueSnapshot): void {
    const sig = `${snapshot.video?.videoId ?? ''}::${snapshot.captionsAvailable}::${snapshot.text}`;
    if (sig === this.lastEmittedSignature) return;
    this.lastEmittedSignature = sig;
    this.onCueChange(snapshot);
  }
}
