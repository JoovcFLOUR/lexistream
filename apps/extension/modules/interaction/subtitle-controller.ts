import type {
  LanguageCode,
  TranslationResult,
  VocabularyCaptureInput,
} from '@lexistream/shared-types';
import {
  detectPhrasesInTokens,
  detectSubtitleLanguage,
  extractSentenceForToken,
  tokenizeSubtitle,
  type SubtitleToken,
} from '@lexistream/language-core';
import type { TranslationService } from '@lexistream/translation-providers';
import {
  subscribeLexiStreamEvents,
  type VocabularyRepository,
} from '@lexistream/vocabulary-engine';
import {
  YouTubeCaptionAdapter,
  type SubtitleCueSnapshot,
} from '../captions/caption-adapter';
import { YOUTUBE_SELECTORS } from '../youtube/selectors';
import { ShadowTooltipView } from './shadow-tooltip';

export interface InteractiveSubtitleControllerOptions {
  rootDocument?: Document;
  locationHref?: () => string;
  translationService: TranslationService;
  vocabularyRepo: VocabularyRepository;
  sourceLanguage?: LanguageCode;
  targetLanguage?: LanguageCode;
  hoverDebounceMs?: number;
  pauseOnHover?: boolean;
  resumeGraceMs?: number;
  onVocabularyCaptured?: (payload: VocabularyCaptureInput) => void;
}

const OVERLAY_STYLE_ID = 'lexistream-player-overlay-style';

const OVERLAY_CSS = `
  .lexistream-caption-overlay {
    position: absolute;
    left: 50%;
    bottom: 11%;
    transform: translateX(-50%);
    z-index: 65;
    width: max-content;
    max-width: 86%;
    text-align: center;
    pointer-events: none;
    font-family: "YouTube Noto", Roboto, Arial, Helvetica, sans-serif;
  }
  .lexistream-caption-bar {
    display: inline-block;
    pointer-events: auto;
    background: rgba(8, 8, 8, 0.82);
    color: #ffffff;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid transparent;
    font-size: clamp(15px, 2.1vw, 24px);
    line-height: 1.42;
    user-select: none;
    transition: border-color 120ms ease;
  }
  .lexistream-caption-bar[data-autopause="true"] {
    border-color: rgba(56, 189, 248, 0.45);
  }
  .lexistream-status-pill {
    display: inline-block;
    background: rgba(15, 23, 42, 0.72);
    color: #cbd5e1;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 12px;
  }
  .lx-word {
    cursor: pointer;
    border-radius: 3px;
    padding: 0 1px;
    transition: background-color 90ms ease, color 90ms ease;
  }
  .lx-word:hover,
  .lx-word:focus-visible {
    background: rgba(56, 189, 248, 0.28);
    color: #e0f2fe;
    outline: none;
  }
  .lx-word[data-phrase="true"] {
    border-bottom: 1px dashed rgba(125, 211, 252, 0.55);
  }
  .lx-word[data-saved="true"] {
    border-bottom: 2px solid #34d399;
    color: #a7f3d0;
  }
  .html5-video-player.lexistream-active .ytp-caption-window-container {
    opacity: 0 !important;
    pointer-events: none !important;
  }
`;

export class InteractiveSubtitleController {
  private readonly doc: Document;
  private readonly getHref: () => string;
  private readonly translationService: TranslationService;
  private readonly vocabularyRepo: VocabularyRepository;
  private sourceLanguage: LanguageCode;
  private targetLanguage: LanguageCode;
  private readonly hoverDebounceMs: number;
  private pauseOnHover: boolean;
  private readonly resumeGraceMs: number;
  private readonly onVocabularyCaptured?: (payload: VocabularyCaptureInput) => void;

  private readonly adapter: YouTubeCaptionAdapter;
  private tooltip: ShadowTooltipView | null = null;
  private overlayRoot: HTMLElement | null = null;

  private activeCue: SubtitleCueSnapshot | null = null;
  private activeTokens: SubtitleToken[] = [];
  private latestResultByTokenIdx = new Map<number, TranslationResult>();
  private savedNormalizedSet = new Set<string>();

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private autoPausedByHover = false;
  private lastAutoResumeAt = 0;
  private activeAbortController: AbortController | null = null;
  private unsubscribeEvents: (() => void) | null = null;

  private readonly boundPointerOver: (ev: Event) => void;
  private readonly boundPointerOut: (ev: Event) => void;
  private readonly boundClick: (ev: Event) => void;
  private readonly boundFocusIn: (ev: Event) => void;
  private readonly boundKeyDown: (ev: KeyboardEvent) => void;
  private readonly boundDocPointerDown: (ev: Event) => void;
  private readonly boundDocCaptureClick: (ev: MouseEvent) => void;
  private readonly boundDocKeyDown: (ev: KeyboardEvent) => void;

  constructor(options: InteractiveSubtitleControllerOptions) {
    this.doc = options.rootDocument ?? document;
    this.getHref = options.locationHref ?? (() => window.location.href);
    this.translationService = options.translationService;
    this.vocabularyRepo = options.vocabularyRepo;
    this.sourceLanguage = options.sourceLanguage ?? 'en';
    this.targetLanguage = options.targetLanguage ?? 'pt';
    this.hoverDebounceMs = options.hoverDebounceMs ?? 120;
    this.pauseOnHover = options.pauseOnHover ?? true;
    this.resumeGraceMs = options.resumeGraceMs ?? 120;
    this.onVocabularyCaptured = options.onVocabularyCaptured;

    this.boundPointerOver = (ev) => this.handleDelegatedHover(ev);
    this.boundPointerOut = (ev) => this.handleDelegatedOut(ev);
    this.boundClick = (ev) => {
      void this.handleDelegatedClick(ev);
    };
    this.boundFocusIn = (ev) => this.handleDelegatedHover(ev);
    this.boundKeyDown = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        void this.handleDelegatedClick(ev);
      } else if (ev.key === 'Escape') {
        this.cancelPendingHover();
        this.tooltip?.hide();
        this.resumeIfAutoPaused();
      }
    };
    this.boundDocPointerDown = (ev) => {
      const target = ev.target as HTMLElement | null;
      if (!target?.closest?.('[data-lexistream-overlay="true"]')) {
        this.cancelPendingHover();
        this.tooltip?.hide();

        const isInteractiveControl = Boolean(
          target?.closest?.(
            'video, .ytp-play-button, .ytp-chrome-bottom, button, [role="button"], a, input, select, textarea',
          ),
        );
        if (isInteractiveControl) {
          // Hand playback state over cleanly to the native control's own click handler
          this.cancelPendingResume();
          this.autoPausedByHover = false;
          const bar = this.overlayRoot?.querySelector<HTMLElement>('.lexistream-caption-bar');
          if (bar) delete bar.dataset.autopause;
        } else {
          this.resumeIfAutoPaused();
        }
      }
    };
    this.boundDocCaptureClick = (ev) => {
      if (this.lastAutoResumeAt === 0) return;
      const elapsed = Date.now() - this.lastAutoResumeAt;
      this.lastAutoResumeAt = 0;
      if (elapsed > 650) return;

      const target = ev.target as HTMLElement | null;
      const isPlayToggle = Boolean(
        target?.closest?.('.ytp-play-button, #play-pause-btn, video.html5-main-video'),
      );
      const videoEl = this.doc.querySelector<HTMLVideoElement>(YOUTUBE_SELECTORS.videoElement);
      if (isPlayToggle && videoEl && !videoEl.paused) {
        // Absorb the single redundant "Play" click because mouseout grace already resumed playback
        ev.stopPropagation();
        ev.preventDefault();
      }
    };
    this.boundDocKeyDown = (ev) => {
      if (ev.key === 'Escape') {
        this.cancelPendingHover();
        this.tooltip?.hide();
        this.resumeIfAutoPaused();
      }
    };

    this.adapter = new YouTubeCaptionAdapter({
      rootDocument: this.doc,
      locationHref: this.getHref,
      onCueChange: (snapshot) => {
        void this.renderCueSnapshot(snapshot);
      },
    });
  }

  start(): void {
    this.injectPlayerStyleOnce();
    this.tooltip = new ShadowTooltipView(this.doc);
    this.doc.addEventListener('pointerdown', this.boundDocPointerDown);
    this.doc.addEventListener('click', this.boundDocCaptureClick, true);
    this.doc.addEventListener('keydown', this.boundDocKeyDown);

    this.unsubscribeEvents = subscribeLexiStreamEvents((ev) => {
      if (ev.type === 'dictionary_changed') {
        this.latestResultByTokenIdx.clear();
        void this.translationService.clearCaches();
      }
      if (ev.type === 'vocabulary_changed') {
        void this.refreshSavedNormalizedCache().then(() => {
          this.syncSavedHighlightsInDom();
        });
      }
    });
    void this.refreshSavedNormalizedCache().then(() => {
      this.adapter.start();
    });
  }

  setPauseOnHover(enabled: boolean): void {
    this.pauseOnHover = enabled;
    if (!enabled) {
      this.resumeIfAutoPaused();
    }
  }

  loadStaticJson3Track(videoId: string, rawJson3: string): void {
    this.adapter.loadStaticJson3Track(videoId, rawJson3);
  }

  clearStaticTrack(): void {
    this.adapter.clearStaticTrack();
  }

  stop(): void {
    this.cancelPendingHover();
    this.cancelPendingResume();
    this.autoPausedByHover = false;
    this.lastAutoResumeAt = 0;
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.doc.removeEventListener('pointerdown', this.boundDocPointerDown);
    this.doc.removeEventListener('click', this.boundDocCaptureClick, true);
    this.doc.removeEventListener('keydown', this.boundDocKeyDown);
    this.adapter.stop();

    if (this.overlayRoot) {
      this.overlayRoot.removeEventListener('mouseover', this.boundPointerOver);
      this.overlayRoot.removeEventListener('mouseout', this.boundPointerOut);
      this.overlayRoot.removeEventListener('click', this.boundClick);
      this.overlayRoot.removeEventListener('focusin', this.boundFocusIn);
      this.overlayRoot.removeEventListener('keydown', this.boundKeyDown);
      this.overlayRoot.remove();
      this.overlayRoot = null;
    }
    const player = this.doc.querySelector(YOUTUBE_SELECTORS.playerContainer);
    player?.classList.remove('lexistream-active');
    player
      ?.querySelector(YOUTUBE_SELECTORS.captionWindowContainer)
      ?.removeAttribute('aria-hidden');
    this.tooltip?.destroy();
    this.tooltip = null;
  }

  private injectPlayerStyleOnce(): void {
    if (this.doc.getElementById(OVERLAY_STYLE_ID)) return;
    const style = this.doc.createElement('style');
    style.id = OVERLAY_STYLE_ID;
    style.setAttribute('data-lexistream-internal', 'true');
    style.textContent = OVERLAY_CSS;
    (this.doc.head ?? this.doc.documentElement).appendChild(style);
  }

  private ensureOverlayMounted(): HTMLElement | null {
    const player = this.doc.querySelector<HTMLElement>(YOUTUBE_SELECTORS.playerContainer);
    if (!player) return null;

    if (this.overlayRoot && player.contains(this.overlayRoot)) {
      return this.overlayRoot;
    }

    const root = this.doc.createElement('div');
    root.className = 'lexistream-caption-overlay';
    root.setAttribute('data-lexistream-overlay', 'true');
    root.setAttribute('data-lexistream-internal', 'true');

    root.addEventListener('mouseover', this.boundPointerOver);
    root.addEventListener('mouseout', this.boundPointerOut);
    root.addEventListener('click', this.boundClick);
    root.addEventListener('focusin', this.boundFocusIn);
    root.addEventListener('keydown', this.boundKeyDown);

    player.appendChild(root);
    this.overlayRoot = root;
    return root;
  }

  private async refreshSavedNormalizedCache(): Promise<void> {
    const items = await this.vocabularyRepo.queryVocabulary({});
    this.savedNormalizedSet.clear();
    for (const item of items) {
      this.savedNormalizedSet.add(item.lemma.toLowerCase());
      for (const sf of item.surface_forms) {
        this.savedNormalizedSet.add(sf.toLowerCase());
      }
    }
  }

  private isTokenSaved(tok: SubtitleToken): boolean {
    if (tok.detectedPhrase) {
      return this.savedNormalizedSet.has(tok.detectedPhrase);
    }
    return this.savedNormalizedSet.has(tok.normalized);
  }

  private syncSavedHighlightsInDom(): void {
    if (!this.overlayRoot) return;
    const spans = this.overlayRoot.querySelectorAll<HTMLElement>('.lx-word');
    spans.forEach((sp) => {
      const idx = Number(sp.dataset.tokenIdx);
      const tok = this.activeTokens.find((t) => t.index === idx);
      if (!tok) return;
      if (this.isTokenSaved(tok)) {
        sp.dataset.saved = 'true';
      } else {
        delete sp.dataset.saved;
      }
    });
  }

  private async renderCueSnapshot(snapshot: SubtitleCueSnapshot): Promise<void> {
    this.activeCue = snapshot;
    this.latestResultByTokenIdx.clear();
    this.cancelPendingHover();
    this.tooltip?.hide();

    const root = this.ensureOverlayMounted();
    const player = this.doc.querySelector(YOUTUBE_SELECTORS.playerContainer);
    if (!root || !player) return;

    const nativeCap = player.querySelector(YOUTUBE_SELECTORS.captionWindowContainer);
    root.replaceChildren();

    if (!snapshot.captionsAvailable) {
      player.classList.remove('lexistream-active');
      nativeCap?.removeAttribute('aria-hidden');
      const status = this.doc.createElement('div');
      status.className = 'lexistream-status-pill';
      status.textContent = 'LexiStream: Enable YouTube captions (CC) for interactive words';
      root.appendChild(status);
      return;
    }

    // Keep native YouTube roll-up captions hidden throughout active CC playback,
    // including brief silent inter-cue gaps so native captions never flash between sentences!
    player.classList.add('lexistream-active');
    nativeCap?.setAttribute('aria-hidden', 'true');

    if (!snapshot.text) {
      return;
    }

    const cueLang = detectSubtitleLanguage(snapshot.text, this.sourceLanguage);
    const rawTokens = tokenizeSubtitle(snapshot.text, cueLang);
    this.activeTokens = detectPhrasesInTokens(rawTokens, cueLang);

    const bar = this.doc.createElement('div');
    bar.className = 'lexistream-caption-bar';
    const fragment = this.doc.createDocumentFragment();

    for (const tok of this.activeTokens) {
      if (!tok.isWord) {
        fragment.appendChild(this.doc.createTextNode(tok.text));
        continue;
      }

      const span = this.doc.createElement('span');
      span.className = 'lx-word';
      span.tabIndex = 0;
      span.setAttribute('role', 'button');
      span.dataset.tokenIdx = String(tok.index);
      if (tok.detectedPhrase) {
        span.dataset.phrase = 'true';
      }
      if (this.isTokenSaved(tok)) {
        span.dataset.saved = 'true';
      }
      span.textContent = tok.text;
      fragment.appendChild(span);
    }

    bar.appendChild(fragment);
    root.appendChild(bar);
  }

  private computeTooltipAnchorRect(span: HTMLElement): DOMRect {
    const wordRect = span.getBoundingClientRect();
    const bar = span.closest('.lexistream-caption-bar');
    if (!bar) return wordRect;
    const barRect = bar.getBoundingClientRect();
    return new DOMRect(wordRect.x, barRect.y, wordRect.width, barRect.height);
  }

  private resolveWordTarget(ev: Event): { span: HTMLElement; token: SubtitleToken } | null {
    const el = (ev.target as HTMLElement | null)?.closest?.('.lx-word') as HTMLElement | null;
    if (!el) return null;
    const idx = Number(el.dataset.tokenIdx);
    const token = this.activeTokens.find((t) => t.index === idx);
    if (!token) return null;
    return { span: el, token };
  }

  private handleDelegatedHover(ev: Event): void {
    const target = ev.target as HTMLElement | null;
    if (target?.closest?.('.lexistream-caption-bar')) {
      // Keep video paused while moving across spaces/punctuation between words in the bar
      this.cancelPendingResume();
    }

    const resolved = this.resolveWordTarget(ev);
    if (!resolved) return;

    this.pauseVideoOnWordEnter();
    this.cancelPendingHover();
    this.debounceTimer = setTimeout(() => {
      void this.lookupAndShowTooltip(resolved.span, resolved.token);
    }, this.hoverDebounceMs);
  }

  private handleDelegatedOut(ev: Event): void {
    const mouseEv = ev as MouseEvent;
    const related = mouseEv.relatedTarget as HTMLElement | null;
    if (related?.closest?.('.lexistream-caption-bar')) return;
    this.cancelPendingHover();
    this.scheduleResumeAndHide();
  }

  private pauseVideoOnWordEnter(): void {
    if (!this.pauseOnHover) return;
    this.cancelPendingResume();

    const videoEl = this.doc.querySelector<HTMLVideoElement>(YOUTUBE_SELECTORS.videoElement);
    if (!videoEl) return;

    if (!videoEl.paused && !videoEl.ended) {
      try {
        videoEl.pause();
        this.autoPausedByHover = true;
        const bar = this.overlayRoot?.querySelector<HTMLElement>('.lexistream-caption-bar');
        if (bar) bar.dataset.autopause = 'true';

        // If user manually resumes playback while pointer is still inside subtitle bar, respect it
        videoEl.addEventListener(
          'play',
          () => {
            this.autoPausedByHover = false;
            const currentBar =
              this.overlayRoot?.querySelector<HTMLElement>('.lexistream-caption-bar');
            if (currentBar) delete currentBar.dataset.autopause;
          },
          { once: true },
        );
      } catch {
        // Ignore restricted media pause errors
      }
    }
  }

  private scheduleResumeAndHide(): void {
    this.cancelPendingResume();
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      this.tooltip?.hide();
      this.resumeIfAutoPaused();
    }, this.resumeGraceMs);
  }

  private cancelPendingResume(): void {
    if (this.resumeTimer !== null) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  private resumeIfAutoPaused(): void {
    this.cancelPendingResume();
    const bar = this.overlayRoot?.querySelector<HTMLElement>('.lexistream-caption-bar');
    if (bar) delete bar.dataset.autopause;

    if (!this.autoPausedByHover) return;
    this.autoPausedByHover = false;

    const videoEl = this.doc.querySelector<HTMLVideoElement>(YOUTUBE_SELECTORS.videoElement);
    if (videoEl && videoEl.paused && !videoEl.ended) {
      try {
        this.lastAutoResumeAt = Date.now();
        const playPromise = videoEl.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
      } catch {
        // Ignore autoplay policy restrictions
      }
    }
  }

  private cancelPendingHover(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  private computeRelativeWordOffset(fullCue: string, sentence: string, token: SubtitleToken): number | undefined {
    const sentenceStart = fullCue.indexOf(sentence);
    if (sentenceStart === -1) return undefined;
    const rel = token.startOffset - sentenceStart;
    return rel >= 0 ? rel : undefined;
  }

  private async lookupAndShowTooltip(
    span: HTMLElement,
    token: SubtitleToken,
  ): Promise<TranslationResult | null> {
    if (!this.activeCue || !this.tooltip) return null;

    const controller = new AbortController();
    this.activeAbortController = controller;

    const sentence = extractSentenceForToken(this.activeCue.text, token) || this.activeCue.text;
    const effectiveLang = detectSubtitleLanguage(sentence, this.sourceLanguage);
    const wordOffset = this.computeRelativeWordOffset(this.activeCue.text, sentence, token);
    const rect = this.computeTooltipAnchorRect(span);

    const savedMatches = await this.vocabularyRepo.findMatchingEntries(
      token.detectedPhrase ?? token.text,
      effectiveLang,
    );

    this.tooltip.render({
      anchorRect: rect,
      surfaceWord: token.detectedPhrase ?? token.text,
      loading: true,
      savedEntries: savedMatches,
    });

    try {
      const result = await this.translationService.translate(
        {
          word: token.text,
          context: sentence,
          source_language: effectiveLang,
          target_language: this.targetLanguage,
          word_offset: wordOffset,
        },
        controller.signal,
      );

      if (controller.signal.aborted) return null;
      this.latestResultByTokenIdx.set(token.index, result);

      const postLookupSaved = await this.vocabularyRepo.findMatchingEntries(
        result.lemma,
        effectiveLang,
      );

      this.tooltip.render({
        anchorRect: this.computeTooltipAnchorRect(span),
        surfaceWord: token.detectedPhrase ?? token.text,
        result,
        savedEntries: postLookupSaved.length > 0 ? postLookupSaved : savedMatches,
      });
      return result;
    } catch {
      return null;
    }
  }

  private async handleDelegatedClick(ev: Event): Promise<void> {
    const resolved = this.resolveWordTarget(ev);
    if (!resolved || !this.activeCue) return;
    ev.stopPropagation();

    const { span, token } = resolved;
    const sentence = extractSentenceForToken(this.activeCue.text, token) || this.activeCue.text;
    const effectiveLang = detectSubtitleLanguage(sentence, this.sourceLanguage);

    let translation = this.latestResultByTokenIdx.get(token.index);
    if (!translation) {
      translation =
        (await this.lookupAndShowTooltip(span, token)) ?? {
          word: token.text,
          lemma: token.detectedPhrase ?? (token.normalized || token.text.toLowerCase()),
          part_of_speech: token.detectedPhrase ? 'phrase' : 'other',
          contextual_translation: token.text,
          definition: '',
          context_sentence: sentence,
          context_translation: '',
          meanings: [],
          provider: 'local-fallback-untranslated',
          cached: false,
        };
    }

    const isUntranslatedFallback =
      translation.provider === 'local-fallback-untranslated';

    const videoMeta = this.activeCue.video ?? {
      videoId: 'unknown',
      videoTitle: 'YouTube Video',
      videoUrl: 'https://www.youtube.com/watch?v=unknown',
      currentTime: this.activeCue.timestamp,
    };

    const videoEl = this.doc.querySelector<HTMLVideoElement>(YOUTUBE_SELECTORS.videoElement);
    const exactTimestamp =
      videoEl && Number.isFinite(videoEl.currentTime)
        ? videoEl.currentTime
        : videoMeta.currentTime;

    const surfaceToSave = token.detectedPhrase ?? token.text;
    const cleanTranslationToSave = isUntranslatedFallback
      ? 'Pending translation (edit in Vocabulary)'
      : translation.contextual_translation;

    const capturePayload: VocabularyCaptureInput = {
      surface_form: surfaceToSave,
      lemma: translation.lemma,
      language: effectiveLang,
      target_language: this.targetLanguage,
      translation: cleanTranslationToSave,
      definition: isUntranslatedFallback ? '' : translation.definition,
      part_of_speech: translation.part_of_speech,
      context: sentence,
      context_translation: translation.context_translation,
      video_id: videoMeta.videoId,
      video_title: videoMeta.videoTitle,
      video_url: videoMeta.videoUrl,
      timestamp: exactTimestamp,
      additional_meanings: isUntranslatedFallback ? [] : translation.meanings,
    };

    await this.vocabularyRepo.captureVocabulary(capturePayload);
    this.onVocabularyCaptured?.(capturePayload);

    this.savedNormalizedSet.add(translation.lemma.toLowerCase());
    this.savedNormalizedSet.add(surfaceToSave.toLowerCase());
    this.syncSavedHighlightsInDom();

    const updatedMatches = await this.vocabularyRepo.findMatchingEntries(
      translation.lemma,
      effectiveLang,
    );

    this.tooltip?.render({
      anchorRect: this.computeTooltipAnchorRect(span),
      surfaceWord: token.detectedPhrase ?? token.text,
      result: translation,
      savedEntries: updatedMatches,
    });
  }
}
