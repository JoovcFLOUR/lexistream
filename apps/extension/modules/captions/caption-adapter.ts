import {
  YOUTUBE_SELECTORS,
  extractYouTubeMetadata,
  type YouTubeVideoMetadata,
} from '../youtube/selectors';

export interface SubtitleCueSnapshot {
  text: string;
  captionsAvailable: boolean;
  timestamp: number;
  video: YouTubeVideoMetadata | null;
}

export interface YouTubeCaptionAdapterOptions {
  rootDocument?: Document;
  locationHref?: () => string;
  onCueChange: (snapshot: SubtitleCueSnapshot) => void;
}

/**
 * Observes YouTube's rendered subtitle segments using a scoped MutationObserver.
 * Avoids whole-document traversal once `#movie_player` is mounted.
 */
export class YouTubeCaptionAdapter {
  private readonly doc: Document;
  private readonly getHref: () => string;
  private readonly onCueChange: (snapshot: SubtitleCueSnapshot) => void;

  private playerObserver: MutationObserver | null = null;
  private bootstrapObserver: MutationObserver | null = null;
  private observedPlayer: Element | null = null;
  private lastEmittedSignature = '';
  private readonly boundHandleNavigation: () => void;

  constructor(options: YouTubeCaptionAdapterOptions) {
    this.doc = options.rootDocument ?? document;
    this.getHref = options.locationHref ?? (() => window.location.href);
    this.onCueChange = options.onCueChange;
    this.boundHandleNavigation = () => this.rebindPlayerObserver();
  }

  start(): void {
    this.rebindPlayerObserver();
    if (!this.observedPlayer && this.doc.body) {
      // Lightweight bootstrap observer until #movie_player mounts, then immediately disconnected!
      this.bootstrapObserver = new MutationObserver(() => {
        const player = this.doc.querySelector(YOUTUBE_SELECTORS.playerContainer);
        if (player) {
          this.bootstrapObserver?.disconnect();
          this.bootstrapObserver = null;
          this.rebindPlayerObserver();
        }
      });
      this.bootstrapObserver.observe(this.doc.body, {
        childList: true,
        subtree: true,
      });
    }

    window.addEventListener('yt-navigate-finish', this.boundHandleNavigation);
    window.addEventListener('popstate', this.boundHandleNavigation);
  }

  stop(): void {
    this.playerObserver?.disconnect();
    this.playerObserver = null;
    this.bootstrapObserver?.disconnect();
    this.bootstrapObserver = null;
    this.observedPlayer = null;
    window.removeEventListener('yt-navigate-finish', this.boundHandleNavigation);
    window.removeEventListener('popstate', this.boundHandleNavigation);
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

    if (player !== this.observedPlayer) {
      this.playerObserver?.disconnect();
      this.observedPlayer = player;
      this.playerObserver = new MutationObserver((mutations) => {
        // Ignore mutations exclusively inside our own LexiStream overlay
        const relevant = mutations.some((m) => {
          const target = m.target as HTMLElement | null;
          return !target?.closest?.('[data-lexistream-internal="true"]');
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

  inspectCurrentCue(): void {
    const player = this.observedPlayer ?? this.doc.querySelector(YOUTUBE_SELECTORS.playerContainer);
    const meta = extractYouTubeMetadata(this.doc, this.getHref());
    if (!player) return;

    const subButton = player.querySelector(YOUTUBE_SELECTORS.subtitlesToggleButton);
    const segments = Array.from(
      player.querySelectorAll(YOUTUBE_SELECTORS.captionSegment),
    );
    const text = segments
      .map((s) => s.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const buttonPressed = subButton?.getAttribute('aria-pressed') === 'true';
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
