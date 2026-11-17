import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Lightweight Chrome MV3 MAIN-world listener at `document_start`.
 * Passively forwards YouTube's own `/api/timedtext` responses to LexiStream's
 * isolated-world `YouTubeCaptionAdapter` via `window.postMessage` (structured clone)
 * so ASR subtitles render as static, embedded-style sentence blocks with zero extra network calls.
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
    };

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
