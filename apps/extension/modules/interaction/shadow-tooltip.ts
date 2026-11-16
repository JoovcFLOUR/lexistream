import type { TranslationResult, VocabularyItem } from '@lexistream/shared-types';

const SHADOW_CSS = `
  :host {
    position: fixed;
    z-index: 2147483646;
    pointer-events: none;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .card {
    pointer-events: none;
    box-sizing: border-box;
    min-width: 220px;
    max-width: min(340px, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
    overflow-y: auto;
    background: rgba(15, 23, 42, 0.96);
    color: #f8fafc;
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 10px;
    padding: 10px 12px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
    font-size: 13px;
    line-height: 1.4;
  }
  .header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }
  .word {
    font-size: 16px;
    font-weight: 700;
    color: #38bdf8;
  }
  .meta {
    font-size: 11px;
    color: #94a3b8;
  }
  .translation {
    font-size: 15px;
    font-weight: 600;
    color: #f1f5f9;
    margin-bottom: 4px;
  }
  .translation-missing {
    font-size: 13px;
    font-weight: 500;
    color: #fbbf24;
    margin-bottom: 4px;
  }
  .definition {
    font-size: 12px;
    color: #cbd5e1;
    margin-bottom: 6px;
  }
  .meanings {
    border-top: 1px solid rgba(148, 163, 184, 0.18);
    padding-top: 5px;
    margin-top: 5px;
    font-size: 11.5px;
    color: #cbd5e1;
  }
  .meaning-item {
    margin-bottom: 2px;
  }
  .context-box {
    border-top: 1px solid rgba(148, 163, 184, 0.18);
    padding-top: 6px;
    margin-top: 6px;
    font-size: 11.5px;
  }
  .ctx-trans {
    color: #cbd5e1;
  }
  .status-badge {
    display: inline-block;
    margin-top: 6px;
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
  }
  .status-saved {
    background: rgba(16, 185, 129, 0.2);
    color: #34d399;
    border: 1px solid rgba(52, 211, 153, 0.35);
  }
  .status-unsaved {
    background: rgba(56, 189, 248, 0.15);
    color: #7dd3fc;
  }
`;

export interface TooltipRenderState {
  anchorRect: DOMRect;
  surfaceWord: string;
  loading?: boolean;
  result?: TranslationResult;
  savedEntries?: VocabularyItem[];
}

export class ShadowTooltipView {
  private readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private readonly container: HTMLElement;

  constructor(private readonly doc: Document) {
    this.host = this.doc.createElement('div');
    this.host.setAttribute('data-lexistream-tooltip-host', 'true');
    this.host.setAttribute('data-lexistream-internal', 'true');
    this.host.style.display = 'none';

    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = this.doc.createElement('style');
    style.textContent = SHADOW_CSS;
    this.container = this.doc.createElement('div');
    this.container.className = 'card';
    this.container.setAttribute('role', 'tooltip');

    this.shadow.appendChild(style);
    this.shadow.appendChild(this.container);
    this.doc.body.appendChild(this.host);
  }

  render(state: TooltipRenderState): void {
    this.container.replaceChildren();

    const header = this.doc.createElement('div');
    header.className = 'header';

    const wordEl = this.doc.createElement('span');
    wordEl.className = 'word';
    wordEl.textContent = state.surfaceWord;
    header.appendChild(wordEl);

    if (state.result) {
      const metaEl = this.doc.createElement('span');
      metaEl.className = 'meta';
      const sameAsSurface =
        state.result.lemma.trim().toLowerCase() === state.surfaceWord.trim().toLowerCase();
      metaEl.textContent = sameAsSurface
        ? state.result.part_of_speech
        : `${state.result.lemma} · ${state.result.part_of_speech}`;
      header.appendChild(metaEl);
    }
    this.container.appendChild(header);

    if (state.loading && !state.result) {
      const loadingEl = this.doc.createElement('div');
      loadingEl.className = 'definition';
      loadingEl.textContent = 'Translating in context…';
      this.container.appendChild(loadingEl);
    } else if (state.result) {
      const isUntranslatedFallback =
        state.result.provider === 'local-fallback-untranslated';

      if (isUntranslatedFallback) {
        const missingEl = this.doc.createElement('div');
        missingEl.className = 'translation-missing';
        missingEl.textContent = 'No entry found (install language pack in Dictionaries)';
        this.container.appendChild(missingEl);
      } else {
        const transEl = this.doc.createElement('div');
        transEl.className = 'translation';
        transEl.textContent = state.result.contextual_translation;
        this.container.appendChild(transEl);

        if (
          state.result.definition &&
          state.result.definition.trim().toLowerCase() !==
            state.result.contextual_translation.trim().toLowerCase()
        ) {
          const defEl = this.doc.createElement('div');
          defEl.className = 'definition';
          defEl.textContent = state.result.definition;
          this.container.appendChild(defEl);
        }

        const distinctMeanings = state.result.meanings.filter(
          (m) =>
            m.translation.trim().toLowerCase() !==
              state.result!.contextual_translation.trim().toLowerCase() ||
            m.part_of_speech !== state.result!.part_of_speech,
        );

        if (distinctMeanings.length > 0) {
          const meaningsBox = this.doc.createElement('div');
          meaningsBox.className = 'meanings';
          for (const m of distinctMeanings.slice(0, 3)) {
            const item = this.doc.createElement('div');
            item.className = 'meaning-item';
            item.textContent = `[${m.part_of_speech}] ${m.translation} — ${m.definition}`;
            meaningsBox.appendChild(item);
          }
          this.container.appendChild(meaningsBox);
        }

        if (
          state.result.context_translation &&
          state.result.context_translation.trim().toLowerCase() !==
            state.result.context_sentence.trim().toLowerCase()
        ) {
          const ctxBox = this.doc.createElement('div');
          ctxBox.className = 'context-box';
          const tr = this.doc.createElement('div');
          tr.className = 'ctx-trans';
          tr.textContent = state.result.context_translation;
          ctxBox.appendChild(tr);
          this.container.appendChild(ctxBox);
        }
      }
    }

    const saved = state.savedEntries ?? [];
    const badge = this.doc.createElement('span');
    if (saved.length > 0) {
      const totalContexts = saved.reduce((acc, s) => acc + s.occurrences.length, 0);
      badge.className = 'status-badge status-saved';
      badge.textContent = `Saved (${totalContexts} ${totalContexts === 1 ? 'context' : 'contexts'})`;
    } else {
      badge.className = 'status-badge status-unsaved';
      badge.textContent = 'Click word to save';
    }
    this.container.appendChild(badge);

    // Measure actual card dimensions and strictly clamp inside viewport bounds
    this.host.style.visibility = 'hidden';
    this.host.style.transform = 'none';
    this.host.style.display = 'block';

    const vw = Math.max(320, window.innerWidth || 800);
    const vh = Math.max(240, window.innerHeight || 600);
    const cardRect = this.container.getBoundingClientRect();
    const cardW = cardRect.width || 280;
    const cardH = cardRect.height || 140;

    const left = Math.max(12, Math.min(vw - cardW - 12, state.anchorRect.left));

    let top: number;
    const aboveCandidate = state.anchorRect.top - cardH - 8;
    const belowCandidate = state.anchorRect.bottom + 8;

    if (aboveCandidate >= 8) {
      top = aboveCandidate;
    } else if (belowCandidate + cardH <= vh - 8) {
      top = belowCandidate;
    } else {
      top = Math.max(8, Math.min(vh - cardH - 8, aboveCandidate));
    }

    this.host.style.left = `${Math.round(left)}px`;
    this.host.style.top = `${Math.round(top)}px`;
    this.host.style.visibility = 'visible';
  }

  hide(): void {
    this.host.style.display = 'none';
  }

  destroy(): void {
    this.host.remove();
  }
}
