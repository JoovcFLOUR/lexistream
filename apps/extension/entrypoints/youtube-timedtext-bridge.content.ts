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

interface QueuedTranslationReq {
  videoId: string;
  targetLang: string;
}

function getCurrentUrlVideoId(): string {
  try {
    const u = new URL(window.location.href);
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]+)/);
    return m?.[1] ?? '';
  } catch {
    return '';
  }
}

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
    let pendingRestoreVideoId = '';
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;
    let queuedRequest: QueuedTranslationReq | null = null;
    const completedTranslations = new Set<string>();

    const recordCompleted = (key: string) => {
      while (completedTranslations.size >= 32) {
        const oldest = completedTranslations.values().next().value;
        if (oldest !== undefined) completedTranslations.delete(oldest);
        else break;
      }
      completedTranslations.add(key);
    };

    const resetPendingOnNavigation = () => {
      const nowVid = getCurrentUrlVideoId();
      if (pendingRestoreVideoId && nowVid !== pendingRestoreVideoId) {
        pendingRestoreTrack = null;
        pendingRestoreVideoId = '';
        queuedRequest = null;
        if (restoreTimer !== null) {
          clearTimeout(restoreTimer);
          restoreTimer = null;
        }
      }
    };

    window.addEventListener('yt-navigate-finish', resetPendingOnNavigation);
    window.addEventListener('popstate', resetPendingOnNavigation);

    const triggerTranslationFetch = (req: QueuedTranslationReq) => {
      const nowVid = getCurrentUrlVideoId();
      if (req.videoId && nowVid && req.videoId !== nowVid) return;

      const player = document.getElementById('movie_player') as YtPlayerElement | null;
      if (
        !player ||
        typeof player.getOption !== 'function' ||
        typeof player.setOption !== 'function'
      ) {
        return;
      }

      player.loadModule?.('captions');
      const activeTrack = player.getOption('captions', 'track') as
        | YtCaptionTrackOption
        | undefined;
      if (!activeTrack?.languageCode) return;

      const srcLang = activeTrack.languageCode.slice(0, 2).toLowerCase();
      if (srcLang === req.targetLang) return;

      const dedupKey = `${req.videoId || nowVid}::${srcLang}::${req.targetLang}`;
      if (completedTranslations.has(dedupKey)) return;

      pendingRestoreTrack = { ...activeTrack };
      delete pendingRestoreTrack.translationLanguage;
      pendingRestoreVideoId = req.videoId || nowVid;

      player.setOption('captions', 'track', {
        ...pendingRestoreTrack,
        translationLanguage: { languageCode: req.targetLang },
      });

      restoreTimer = setTimeout(() => {
        restoreOriginalTrackIfNeeded();
      }, 2500);
    };

    const restoreOriginalTrackIfNeeded = () => {
      if (!pendingRestoreTrack) return;
      const toRestore = pendingRestoreTrack;
      const targetVid = pendingRestoreVideoId;
      pendingRestoreTrack = null;
      pendingRestoreVideoId = '';
      if (restoreTimer !== null) {
        clearTimeout(restoreTimer);
        restoreTimer = null;
      }

      // Only restore if the user is still on the same video (prevents SPA video-switch clobber!)
      const nowVid = getCurrentUrlVideoId();
      if (!targetVid || !nowVid || targetVid === nowVid) {
        try {
          const player = document.getElementById('movie_player') as YtPlayerElement | null;
          const cleanTrack = { ...toRestore };
          delete cleanTrack.translationLanguage;
          player?.setOption?.('captions', 'track', cleanTrack);
        } catch {
          // Ignore
        }
      }

      if (queuedRequest) {
        const nextReq = queuedRequest;
        queuedRequest = null;
        if (!nextReq.videoId || !nowVid || nextReq.videoId === nowVid) {
          setTimeout(() => triggerTranslationFetch(nextReq), 40);
        }
      }
    };

    const emitTimedText = (url: string, body: string) => {
      if (!url.includes('/api/timedtext') || !body) return;
      try {
        const parsed = new URL(url, window.location.origin);
        const vid = parsed.searchParams.get('v') ?? parsed.searchParams.get('docid') ?? '';
        const src = (parsed.searchParams.get('lang') ?? '').slice(0, 2).toLowerCase();
        const tlang = (parsed.searchParams.get('tlang') ?? '').slice(0, 2).toLowerCase();
        if (vid && src && tlang && body.trim().length > 0) {
          recordCompleted(`${vid}::${src}::${tlang}`);
        }
      } catch {
        // Ignore URL parse error
      }

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
        const req: QueuedTranslationReq = {
          videoId: data.videoId ?? getCurrentUrlVideoId(),
          targetLang: data.targetLanguage.slice(0, 2).toLowerCase(),
        };

        if (pendingRestoreTrack) {
          // Queue rapid target-language switches during the restore window instead of dropping!
          queuedRequest = req;
          return;
        }
        triggerTranslationFetch(req);
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
