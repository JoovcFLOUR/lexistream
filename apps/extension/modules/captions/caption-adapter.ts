import {
  YOUTUBE_SELECTORS,
  extractYouTubeMetadata,
  parseYouTubeVideoId,
  type YouTubeVideoMetadata,
} from '../youtube/selectors';
import {
  canonicalTimedTextSignature,
  findActiveCueAtTime,
  findSecondaryTextForCue,
  parseYouTubeJson3ToStaticCues,
  type TimedSubtitleCue,
} from './static-track';

export interface SubtitleCueSnapshot {
  text: string;
  secondaryText?: string;
  captionsAvailable: boolean;
  timestamp: number;
  video: YouTubeVideoMetadata | null;
}

export interface YouTubeCaptionAdapterOptions {
  rootDocument?: Document;
  locationHref?: () => string;
  fetchImpl?: typeof fetch;
  getResourceUrls?: () => string[];
  enableSecondarySubtitles?: boolean;
  secondaryLanguage?: string;
  onCueChange: (snapshot: SubtitleCueSnapshot) => void;
}

export class YouTubeCaptionAdapter {
  private readonly doc: Document;
  private readonly getHref: () => string;
  private readonly fetchImpl: typeof fetch;
  private readonly getResourceUrls: () => string[];
  private enableSecondarySubtitles: boolean;
  private secondaryLanguage: string;
  private readonly onCueChange: (snapshot: SubtitleCueSnapshot) => void;

  private playerObserver: MutationObserver | null = null;
  private bootstrapObserver: MutationObserver | null = null;
  private resourceObserver: PerformanceObserver | null = null;
  private observedPlayer: Element | null = null;
  private observedVideo: HTMLVideoElement | null = null;

  private activeTrackKey: string | null = null;
  private activePrimaryLang = '';
  private activeStaticCues: TimedSubtitleCue[] | null = null;
  private readonly secondaryCuesByVidLang = new Map<string, TimedSubtitleCue[]>();
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
    this.enableSecondarySubtitles = options.enableSecondarySubtitles ?? false;
    this.secondaryLanguage = (options.secondaryLanguage ?? 'pt').slice(0, 2).toLowerCase();
    this.getResourceUrls =
      options.getResourceUrls ??
      (() => {
        if (
          typeof performance === 'undefined' ||
          typeof performance.getEntriesByType !== 'function'
        ) {
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
      if (ev.origin !== '' && ev.origin !== window.location.origin) {
        return;
      }
      try {
        const srcWin = ev.source as Window | null;
        if (srcWin && srcWin.parent && srcWin !== srcWin.parent) {
          return;
        }
      } catch {
        return;
      }
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

  setSecondaryConfig(enabled: boolean, targetLanguage: string): void {
    this.enableSecondarySubtitles = enabled;
    this.secondaryLanguage = targetLanguage.slice(0, 2).toLowerCase();
    if (enabled) {
      this.requestAutoTranslationFromPlayerIfNeeded();
    }
    this.inspectCurrentCue();
  }

  loadStaticJson3Track(videoId: string, rawJson3: string): void {
    const cues = parseYouTubeJson3ToStaticCues(rawJson3);
    if (cues.length > 0) {
      this.activeTrackKey = `${videoId}::manual-static`;
      this.activeStaticCues = cues;
      this.inspectCurrentCue();
    }
  }

  loadSecondaryStaticJson3Track(
    videoId: string,
    lang: string,
    rawJson3: string,
    sourceLang = '',
  ): void {
    const cues = parseYouTubeJson3ToStaticCues(rawJson3);
    if (cues.length > 0) {
      const srcNorm = sourceLang.slice(0, 2).toLowerCase();
      const tgtNorm = lang.slice(0, 2).toLowerCase();
      this.secondaryCuesByVidLang.set(`${videoId}::${srcNorm}::${tgtNorm}`, cues);
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
      this.activePrimaryLang = '';
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
        if (!parsed.tlang) break;
      }
    }
  }

  private trimCaches(): void {
    while (this.fetchedTracks.size > 16) {
      const oldest = this.fetchedTracks.keys().next().value;
      if (oldest !== undefined) this.fetchedTracks.delete(oldest);
      else break;
    }
    while (this.secondaryCuesByVidLang.size > 12) {
      const oldest = this.secondaryCuesByVidLang.keys().next().value;
      if (oldest !== undefined) this.secondaryCuesByVidLang.delete(oldest);
      else break;
    }
    while (this.ownFetchUrls.size > 32) {
      const oldest = this.ownFetchUrls.values().next().value;
      if (oldest !== undefined) this.ownFetchUrls.delete(oldest);
      else break;
    }
  }

  private secondaryLookupKey(videoId: string, srcLang: string, tgtLang: string): string {
    return `${videoId}::${srcLang.slice(0, 2).toLowerCase()}::${tgtLang.slice(0, 2).toLowerCase()}`;
  }

  private requestAutoTranslationFromPlayerIfNeeded(): void {
    if (!this.enableSecondarySubtitles) return;
    const vid = parseYouTubeVideoId(this.getHref());
    if (!vid) return;

    const targetLang = this.secondaryLanguage;
    const srcNorm = this.activePrimaryLang.slice(0, 2).toLowerCase();
    if (srcNorm && srcNorm === targetLang) {
      return;
    }
    if (
      this.secondaryCuesByVidLang.has(this.secondaryLookupKey(vid, srcNorm, targetLang)) ||
      this.secondaryCuesByVidLang.has(this.secondaryLookupKey(vid, '', targetLang))
    ) {
      return;
    }

    try {
      window.postMessage(
        {
          source: 'lexistream-yt-isolated',
          type: 'REQUEST_TRANSLATED_TRACK',
          videoId: vid,
          sourceLanguage: srcNorm,
          targetLanguage: targetLang,
        },
        window.location.origin === 'null' ? '*' : window.location.origin,
      );
    } catch {
      // Ignore in restricted runtimes
    }
  }

  private applyParsedTrack(
    sig: NonNullable<ReturnType<typeof canonicalTimedTextSignature>>,
    cues: TimedSubtitleCue[],
  ): void {
    this.trimCaches();
    this.fetchedTracks.set(sig.trackKey, Promise.resolve(cues));

    if (sig.tlang) {
      const tlangKey = this.secondaryLookupKey(sig.videoId, sig.lang, sig.tlang);
      this.secondaryCuesByVidLang.set(tlangKey, cues);
      this.inspectCurrentCue();
      return;
    }

    this.activeTrackKey = sig.trackKey;
    this.activePrimaryLang = sig.lang;
    this.activeStaticCues = cues;
    this.requestAutoTranslationFromPlayerIfNeeded();
    this.inspectCurrentCue();
  }

  private ingestDirectTimedTextPayload(rawUrl: string, rawBody: string): void {
    const sig = canonicalTimedTextSignature(rawUrl);
    if (!sig) return;
    const currentVid = parseYouTubeVideoId(this.getHref());
    if (currentVid && sig.videoId !== currentVid) return;

    const cues = parseYouTubeJson3ToStaticCues(rawBody);
    if (cues.length > 0) {
      this.applyParsedTrack(sig, cues);
    } else {
      void this.ingestTimedTextUrl(rawUrl);
    }
  }

  private async ingestTimedTextUrl(rawUrl: string): Promise<void> {
    const sig = canonicalTimedTextSignature(rawUrl);
    if (!sig) return;

    const currentVid = parseYouTubeVideoId(this.getHref());
    if (currentVid && sig.videoId !== currentVid) return;

    if (!sig.tlang && this.activeTrackKey === sig.trackKey && this.activeStaticCues) {
      return;
    }
    if (
      sig.tlang &&
      this.secondaryCuesByVidLang.has(
        this.secondaryLookupKey(sig.videoId, sig.lang, sig.tlang),
      )
    ) {
      return;
    }

    let task = this.fetchedTracks.get(sig.trackKey);
    if (!task) {
      this.trimCaches();
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
    if (!cues) {
      this.fetchedTracks.delete(sig.trackKey);
      if (!sig.tlang && this.activeTrackKey && this.activeTrackKey !== sig.trackKey) {
        this.activeTrackKey = null;
        this.activeStaticCues = null;
        this.inspectCurrentCue();
      }
      return;
    }

    const latestVid = parseYouTubeVideoId(this.getHref());
    if (!latestVid || sig.videoId === latestVid) {
      this.applyParsedTrack(sig, cues);
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
        secondaryText: '',
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

    if (this.activeStaticCues && this.activeStaticCues.length > 0) {
      if (subButton && !buttonPressed) {
        this.clearBoundaryTimer();
        this.emitIfChanged({
          text: '',
          secondaryText: '',
          captionsAvailable: false,
          timestamp: meta?.currentTime ?? 0,
          video: meta,
        });
        return;
      }

      const currentTime = meta?.currentTime ?? 0;
      const cue = findActiveCueAtTime(this.activeStaticCues, currentTime);
      this.scheduleNextCueBoundary(this.activeStaticCues, currentTime, this.observedVideo);

      let secondaryText = '';
      if (this.enableSecondarySubtitles && cue && meta?.videoId) {
        const secCues =
          this.secondaryCuesByVidLang.get(
            this.secondaryLookupKey(
              meta.videoId,
              this.activePrimaryLang,
              this.secondaryLanguage,
            ),
          ) ??
          (this.activePrimaryLang === ''
            ? this.secondaryCuesByVidLang.get(
                this.secondaryLookupKey(meta.videoId, '', this.secondaryLanguage),
              )
            : undefined);
        if (secCues) {
          secondaryText = findSecondaryTextForCue(secCues, cue, currentTime);
        }
      }

      this.emitIfChanged({
        text: cue?.text ?? '',
        secondaryText,
        captionsAvailable: true,
        timestamp: currentTime,
        video: meta,
      });
      return;
    }

    const segments = Array.from(player.querySelectorAll(YOUTUBE_SELECTORS.captionSegment));
    const text = segments
      .map((s) => s.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const captionsAvailable = buttonPressed || text.length > 0;

    this.emitIfChanged({
      text,
      secondaryText: '',
      captionsAvailable,
      timestamp: meta?.currentTime ?? 0,
      video: meta,
    });
  }

  private emitIfChanged(snapshot: SubtitleCueSnapshot): void {
    const sig = `${snapshot.video?.videoId ?? ''}::${snapshot.captionsAvailable}::${snapshot.text}::${snapshot.secondaryText ?? ''}`;
    if (sig === this.lastEmittedSignature) return;
    this.lastEmittedSignature = sig;
    this.onCueChange(snapshot);
  }
}
