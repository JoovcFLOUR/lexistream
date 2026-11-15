import type {
  LanguageCode,
  TranslationResult,
  VocabularyCaptureInput,
} from '@lexistream/shared-types';
import {
  detectPhrasesInTokens,
  extractSentenceForToken,
  tokenizeSubtitle,
  type SubtitleToken,
} from '@lexistream/language-core';
import type { TranslationService } from '@lexistream/translation-providers';
import type { VocabularyRepository } from '@lexistream/vocabulary-engine';
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
    max-width: 82%;
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
    font-size: clamp(15px, 2.1vw, 24px);
    line-height: 1.42;
    user-select: none;
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
  .lx-word:hover {
    background: rgba(56, 189, 248, 0.28);
    color: #e0f2fe;
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
  private readonly onVocabularyCaptured?: (payload: VocabularyCaptureInput) => void;

  private readonly adapter: YouTubeCaptionAdapter;
  private tooltip: ShadowTooltipView | null = null;
  private overlayRoot: HTMLElement | null = null;

  private activeCue: SubtitleCueSnapshot | null = null;
  private activeTokens: SubtitleToken[] = [];
  private latestResultByTokenIdx = new Map<number, TranslationResult>();
  private savedNormalizedSet = new Set<string>();

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private activeAbortController: AbortController | null = null;

  private readonly boundPointerOver: (ev: Event) => void;
  private readonly boundPointerOut: (ev: Event) => void;
  private readonly boundClick: (ev: Event) => void;

  constructor(options: InteractiveSubtitleControllerOptions) {
    this.doc = options.rootDocument ?? document;
    this.getHref = options.locationHref ?? (() => window.location.href);
    this.translationService = options.translationService;
    this.vocabularyRepo = options.vocabularyRepo;
    this.sourceLanguage = options.sourceLanguage ?? 'en';
    this.targetLanguage = options.targetLanguage ?? 'pt';
    this.hoverDebounceMs = options.hoverDebounceMs ?? 120;
    this.onVocabularyCaptured = options.onVocabularyCaptured;

    this.boundPointerOver = (ev) => this.handleDelegatedHover(ev);
    this.boundPointerOut = (ev) => this.handleDelegatedOut(ev);
    this.boundClick = (ev) => {
      void this.handleDelegatedClick(ev);
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
    void this.refreshSavedNormalizedCache().then(() => {
      this.adapter.start();
    });
  }

  stop(): void {
    this.cancelPendingHover();
    this.adapter.stop();
    if (this.overlayRoot) {
      this.overlayRoot.removeEventListener('mouseover', this.boundPointerOver);
      this.overlayRoot.removeEventListener('mouseout', this.boundPointerOut);
      this.overlayRoot.removeEventListener('click', this.boundClick);
      this.overlayRoot.remove();
      this.overlayRoot = null;
    }
    const player = this.doc.querySelector(YOUTUBE_SELECTORS.playerContainer);
    player?.classList.remove('lexistream-active');
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

    // Single delegated listener set on the overlay container (O(1) event listeners)
    root.addEventListener('mouseover', this.boundPointerOver);
    root.addEventListener('mouseout', this.boundPointerOut);
    root.addEventListener('click', this.boundClick);

    player.appendChild(root);
    this.overlayRoot = root;
    return root;
  }

  private async refreshSavedNormalizedCache(): Promise<void> {
    const items = await this.vocabularyRepo.queryVocabulary({
      language: this.sourceLanguage,
    });
    this.savedNormalizedSet.clear();
    for (const item of items) {
      this.savedNormalizedSet.add(item.lemma.toLowerCase());
      for (const sf of item.surface_forms) {
        this.savedNormalizedSet.add(sf.toLowerCase());
      }
    }
  }

  private async renderCueSnapshot(snapshot: SubtitleCueSnapshot): Promise<void> {
    this.activeCue = snapshot;
    this.latestResultByTokenIdx.clear();
    this.cancelPendingHover();

    const root = this.ensureOverlayMounted();
    const player = this.doc.querySelector(YOUTUBE_SELECTORS.playerContainer);
    if (!root || !player) return;

    root.replaceChildren();

    if (!snapshot.captionsAvailable) {
      player.classList.remove('lexistream-active');
      this.tooltip?.hide();
      const status = this.doc.createElement('div');
      status.className = 'lexistream-status-pill';
      status.textContent = 'LexiStream: Enable YouTube captions (CC) for interactive words';
      root.appendChild(status);
      return;
    }

    if (!snapshot.text) {
      player.classList.remove('lexistream-active');
      this.tooltip?.hide();
      return;
    }

    player.classList.add('lexistream-active');
    const rawTokens = tokenizeSubtitle(snapshot.text, this.sourceLanguage);
    this.activeTokens = detectPhrasesInTokens(rawTokens, this.sourceLanguage);

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
      span.dataset.tokenIdx = String(tok.index);
      if (tok.detectedPhrase) {
        span.dataset.phrase = 'true';
      }
      if (
        this.savedNormalizedSet.has(tok.normalized) ||
        (tok.detectedPhrase && this.savedNormalizedSet.has(tok.detectedPhrase))
      ) {
        span.dataset.saved = 'true';
      }
      span.textContent = tok.text;
      fragment.appendChild(span);
    }

    bar.appendChild(fragment);
    root.appendChild(bar);
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
    const resolved = this.resolveWordTarget(ev);
    if (!resolved) return;

    this.cancelPendingHover();
    this.debounceTimer = setTimeout(() => {
      void this.lookupAndShowTooltip(resolved.span, resolved.token);
    }, this.hoverDebounceMs);
  }

  private handleDelegatedOut(ev: Event): void {
    const mouseEv = ev as MouseEvent;
    const related = mouseEv.relatedTarget as HTMLElement | null;
    if (related?.closest?.('.lx-word')) return;
    // Keep tooltip visible briefly unless user leaves word bar completely
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

  private async lookupAndShowTooltip(
    span: HTMLElement,
    token: SubtitleToken,
  ): Promise<TranslationResult | null> {
    if (!this.activeCue || !this.tooltip) return null;

    const controller = new AbortController();
    this.activeAbortController = controller;

    const sentence = extractSentenceForToken(this.activeCue.text, token) || this.activeCue.text;
    const rect = span.getBoundingClientRect();

    const savedMatches = await this.vocabularyRepo.findMatchingEntries(
      token.detectedPhrase ?? token.text,
      this.sourceLanguage,
    );

    this.tooltip.render({
      anchorRect: rect,
      surfaceWord: token.text,
      loading: true,
      savedEntries: savedMatches,
    });

    try {
      const result = await this.translationService.translate(
        {
          word: token.text,
          context: sentence,
          source_language: this.sourceLanguage,
          target_language: this.targetLanguage,
        },
        controller.signal,
      );

      if (controller.signal.aborted) return null;
      this.latestResultByTokenIdx.set(token.index, result);

      const postLookupSaved = await this.vocabularyRepo.findMatchingEntries(
        result.lemma,
        this.sourceLanguage,
      );

      this.tooltip.render({
        anchorRect: span.getBoundingClientRect(),
        surfaceWord: token.text,
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

    let translation = this.latestResultByTokenIdx.get(token.index);
    if (!translation) {
      translation =
        (await this.lookupAndShowTooltip(span, token)) ?? {
          word: token.text,
          lemma: token.normalized || token.text.toLowerCase(),
          part_of_speech: 'other',
          contextual_translation: token.text,
          definition: '',
          context_sentence: sentence,
          context_translation: '',
          meanings: [],
          provider: 'fallback',
          cached: false,
        };
    }

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

    const capturePayload: VocabularyCaptureInput = {
      surface_form: token.text,
      lemma: translation.lemma,
      language: this.sourceLanguage,
      target_language: this.targetLanguage,
      translation: translation.contextual_translation,
      definition: translation.definition,
      part_of_speech: translation.part_of_speech,
      context: sentence,
      context_translation: translation.context_translation,
      video_id: videoMeta.videoId,
      video_title: videoMeta.videoTitle,
      video_url: videoMeta.videoUrl,
      timestamp: exactTimestamp,
      additional_meanings: translation.meanings,
    };

    await this.vocabularyRepo.captureVocabulary(capturePayload);
    this.onVocabularyCaptured?.(capturePayload);

    this.savedNormalizedSet.add(translation.lemma.toLowerCase());
    this.savedNormalizedSet.add(token.normalized);
    span.dataset.saved = 'true';

    const updatedMatches = await this.vocabularyRepo.findMatchingEntries(
      translation.lemma,
      this.sourceLanguage,
    );

    this.tooltip?.render({
      anchorRect: span.getBoundingClientRect(),
      surfaceWord: token.text,
      result: translation,
      savedEntries: updatedMatches,
    });
  }
}
