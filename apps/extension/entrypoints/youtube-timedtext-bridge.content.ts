import { defineContentScript } from 'wxt/utils/define-content-script';

interface YtCaptionTrackOption {
  languageCode?: string;
  languageName?: string;
  kind?: string;
  vss_id?: string;
  translationLanguage?: { languageCode: string; languageName?: string };
  [key: string]: unknown;
}

interface YtPlayerElement extends HTMLElement {
  loadModule?: (mod: string) => void;
  getOption?: (mod: string, key: string) => unknown;
  setOption?: (mod: string, key: string, val: unknown) => void;
}

/**
 * Lightweight Chrome MV3 MAIN-world bridge at `document_start`.
 * 1. Passively forwards YouTube's own `/api/timedtext` responses to LexiStream's isolated-world
 *    `YouTubeCaptionAdapter` via `window.postMessage` (zero extra network calls for primary cues).
 * 2. When the user enables Dual Subtitles (`blurred` or `visible`), triggers YouTube's native
 *    HTML5 player auto-translation (`translationLanguage`) once for the chosen target language
 *    and immediately restores the original track so both tracks stay cached locally in memory.
 */
export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    try {
      if (
        typeof performance !== 'undefined' &&
        typeof performance.setResourceTimingBufferSize === 'function'
      ) {
        performance.setResourceTimingBufferSize(1000);
      }
    } catch {
      // Ignore
    }

    let pendingRestoreTrack: YtCaptionTrackOption | null = null;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;
    const requestedTranslations = new Set<string>();

    const restoreOriginalTrackIfNeeded = () => {
      if (!pendingRestoreTrack) return;
      const toRestore = pendingRestoreTrack;
      pendingRestoreTrack = null;
      if (restoreTimer !== null) {
        clearTimeout(restoreTimer);
        restoreTimer = null;
      }
      try {
        const player = document.getElementById('movie_player') as YtPlayerElement | null;
        const cleanTrack = { ...toRestore };
        delete cleanTrack.translationLanguage;
        player?.setOption?.('captions', 'track', cleanTrack);
      } catch {
        // Ignore
      }
    };

    const emitTimedText = (url: string, body: string) => {
      if (!url.includes('/api/timedtext') || !body) return;
      window.postMessage(
        {
          source: 'lexistream-yt-main',
          type: 'TIMEDTEXT_PAYLOAD',
          url,
          body,
        },
        window.location.origin,
      );
      if (url.includes('tlang=')) {
        restoreOriginalTrackIfNeeded();
      }
    };

    window.addEventListener('message', (ev: MessageEvent) => {
      if (ev.source !== window || ev.origin !== window.location.origin) return;
      const data = ev.data as {
        source?: string;
        type?: string;
        videoId?: string;
        targetLanguage?: string;
      } | null;

      if (
        data?.source === 'lexistream-yt-isolated' &&
        data.type === 'REQUEST_TRANSLATED_TRACK' &&
        typeof data.targetLanguage === 'string'
      ) {
        const targetLang = data.targetLanguage.slice(0, 2).toLowerCase();
        const vid = data.videoId ?? '';
        const dedupKey = `${vid}::${targetLang}`;
        if (requestedTranslations.has(dedupKey) || pendingRestoreTrack) return;

        const player = document.getElementById('movie_player') as YtPlayerElement | null;
        if (!player || typeof player.getOption !== 'function' || typeof player.setOption !== 'function') {
          return;
        }

        player.loadModule?.('captions');
        const activeTrack = player.getOption('captions', 'track') as
          | YtCaptionTrackOption
          | undefined;
        if (!activeTrack?.languageCode) return;
        if (activeTrack.languageCode.slice(0, 2).toLowerCase() === targetLang) return;

        requestedTranslations.add(dedupKey);
        pendingRestoreTrack = { ...activeTrack };
        delete pendingRestoreTrack.translationLanguage;

        player.setOption('captions', 'track', {
          ...pendingRestoreTrack,
          translationLanguage: { languageCode: targetLang },
        });

        restoreTimer = setTimeout(() => {
          restoreOriginalTrackIfNeeded();
        }, 2500);
      }
    });

    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      const urlStr = typeof url === 'string' ? url : String(url);
      if (urlStr.includes('/api/timedtext')) {
        this.addEventListener(
          'load',
          function () {
            try {
              if (this.responseType === '' || this.responseType === 'text') {
                if (this.responseText) emitTimedText(urlStr, this.responseText);
              } else if (this.responseType === 'json' && this.response) {
                emitTimedText(urlStr, JSON.stringify(this.response));
              } else if (
                this.responseType === 'arraybuffer' &&
                this.response instanceof ArrayBuffer
              ) {
                emitTimedText(urlStr, new TextDecoder().decode(this.response));
              }
            } catch {
              // Ignore
            }
          },
          { once: true },
        );
      }
      return (origOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
    };

    const origFetch = window.fetch;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const response = await origFetch.call(this, input, init);
      try {
        const urlStr =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (urlStr.includes('/api/timedtext')) {
          void response
            .clone()
            .text()
            .then((txt) => {
              if (txt) emitTimedText(urlStr, txt);
            })
            .catch(() => {});
        }
      } catch {
        // Ignore
      }
      return response;
    };
  },
});
