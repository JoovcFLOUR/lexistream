import { describe, expect, it, vi } from 'vitest';
import {
  findActiveCueAtTime,
  parseYouTubeJson3ToStaticCues,
} from './static-track';
import { YouTubeCaptionAdapter } from './caption-adapter';

const REAL_YOUTUBE_ASR_JSON3 = JSON.stringify({
  wireMagic: 'pb3',
  events: [
    { tStartMs: 0, dDurationMs: 1201240, id: 1 },
    {
      tStartMs: 0,
      dDurationMs: 3200,
      wWinId: 1,
      segs: [
        { utf8: "Jusqu'à" },
        { utf8: ' présent,', tOffsetMs: 280 },
        { utf8: ' je', tOffsetMs: 720 },
        { utf8: " n'avais", tOffsetMs: 880 },
        { utf8: ' jamais', tOffsetMs: 1120 },
        { utf8: ' voté', tOffsetMs: 1360 },
      ],
    },
    {
      tStartMs: 1550,
      dDurationMs: 1650,
      wWinId: 1,
      aAppend: 1,
      segs: [{ utf8: '\n' }],
    },
    {
      tStartMs: 1560,
      dDurationMs: 3320,
      wWinId: 1,
      segs: [
        { utf8: 'de' },
        { utf8: ' ma', tOffsetMs: 120 },
        { utf8: ' vie.', tOffsetMs: 340 },
      ],
    },
    {
      tStartMs: 5200,
      dDurationMs: 3500,
      wWinId: 1,
      segs: [
        { utf8: 'voterai' },
        { utf8: ' lors', tOffsetMs: 220 },
        { utf8: ' des', tOffsetMs: 410 },
        { utf8: ' prochaines', tOffsetMs: 650 },
        { utf8: ' élections', tOffsetMs: 980 },
        { utf8: ' présidentielles', tOffsetMs: 1320 },
        { utf8: ' en', tOffsetMs: 1680 },
        { utf8: ' 2027', tOffsetMs: 1900 },
      ],
    },
  ],
});

describe('Static Pre-Assembled YouTube Subtitle Track (ASR De-Rollup)', () => {
  it('converts word-by-word ASR json3 events into non-overlapping static sentence blocks', () => {
    const cues = parseYouTubeJson3ToStaticCues(REAL_YOUTUBE_ASR_JSON3);

    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({
      startMs: 0,
      endMs: 4880,
      text: "Jusqu'à présent, je n'avais jamais voté de ma vie.",
    });
    expect(cues[1]).toEqual({
      startMs: 5200,
      endMs: 8700,
      text: 'voterai lors des prochaines élections présidentielles en 2027',
    });

    // Binary search lookup at 0.1s returns the FULL static sentence immediately, not just "Jusqu'à"!
    expect(findActiveCueAtTime(cues, 0.1)?.text).toBe(
      "Jusqu'à présent, je n'avais jamais voté de ma vie.",
    );
    // Silent gap at 5.0s returns null
    expect(findActiveCueAtTime(cues, 5.0)).toBeNull();
    // At 5.3s (when ASR would only have shown "voterai"), full static block is returned!
    expect(findActiveCueAtTime(cues, 5.3)?.text).toBe(
      'voterai lors des prochaines élections présidentielles en 2027',
    );
  });

  it('suppresses word-by-word DOM roll-up jitter once static timedtext track is loaded and deduplicates fetches', async () => {
    window.history.replaceState({}, 'Test', '/watch?v=ENjeI4s6Lx0');
    document.body.innerHTML = '';

    const player = document.createElement('div');
    player.id = 'movie_player';
    player.className = 'html5-video-player';

    const video = document.createElement('video');
    video.className = 'html5-main-video';
    let currentTime = 5.25;
    Object.defineProperty(video, 'currentTime', {
      get: () => currentTime,
      set: (v: number) => {
        currentTime = v;
      },
      configurable: true,
    });
    player.appendChild(video);

    const subBtn = document.createElement('button');
    subBtn.className = 'ytp-subtitles-button';
    subBtn.setAttribute('aria-pressed', 'true');
    player.appendChild(subBtn);

    const captionContainer = document.createElement('div');
    captionContainer.className = 'ytp-caption-window-container';
    // Simulate YouTube ASR roll-up having rendered ONLY the first word "voterai" at t=5.25s!
    const seg = document.createElement('span');
    seg.className = 'ytp-caption-segment';
    seg.textContent = 'voterai';
    captionContainer.appendChild(seg);
    player.appendChild(captionContainer);
    document.body.appendChild(player);

    const fetchMock = vi.fn(async () => new Response(REAL_YOUTUBE_ASR_JSON3, { status: 200 }));
    const snapshots: string[] = [];

    const adapter = new YouTubeCaptionAdapter({
      rootDocument: document,
      locationHref: () => 'https://www.youtube.com/watch?v=ENjeI4s6Lx0',
      fetchImpl: fetchMock as unknown as typeof fetch,
      getResourceUrls: () => [
        'https://www.youtube.com/api/timedtext?v=ENjeI4s6Lx0&lang=fr&kind=asr&pot=abc',
      ],
      onCueChange: (snap) => {
        snapshots.push(snap.text);
      },
    });

    adapter.start();
    await new Promise((r) => setTimeout(r, 30));

    // Fetch called once, and the FULL static cue replaced the single-word ASR fragment!
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(snapshots[snapshots.length - 1]).toBe(
      'voterai lors des prochaines élections présidentielles en 2027',
    );

    // Simulate YouTube's ASR DOM appending word #2 ("voterai lors") -> adapter ignores DOM jitter!
    const countBeforeJitter = snapshots.length;
    seg.textContent = 'voterai lors';
    await new Promise((r) => setTimeout(r, 25));
    expect(snapshots.length).toBe(countBeforeJitter);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Seeking video to t=0.5s immediately emits the static cue at 0.5s!
    currentTime = 0.5;
    video.dispatchEvent(new Event('seeked'));
    expect(snapshots[snapshots.length - 1]).toBe(
      "Jusqu'à présent, je n'avais jamais voté de ma vie.",
    );

    adapter.stop();
  });

  it('ingests MAIN-world postMessage timedtext payloads with zero extra network fetches', async () => {
    window.history.replaceState({}, 'Test', '/watch?v=ENjeI4s6Lx0');
    document.body.innerHTML = '';

    const player = document.createElement('div');
    player.id = 'movie_player';
    player.className = 'html5-video-player';

    const video = document.createElement('video');
    video.className = 'html5-main-video';
    Object.defineProperty(video, 'currentTime', { value: 5.4, configurable: true });
    player.appendChild(video);

    const subBtn = document.createElement('button');
    subBtn.className = 'ytp-subtitles-button';
    subBtn.setAttribute('aria-pressed', 'true');
    player.appendChild(subBtn);

    const captionContainer = document.createElement('div');
    captionContainer.className = 'ytp-caption-window-container';
    player.appendChild(captionContainer);
    document.body.appendChild(player);

    const fetchMock = vi.fn();
    const snapshots: string[] = [];

    const adapter = new YouTubeCaptionAdapter({
      rootDocument: document,
      locationHref: () => 'https://www.youtube.com/watch?v=ENjeI4s6Lx0',
      fetchImpl: fetchMock as unknown as typeof fetch,
      getResourceUrls: () => [],
      onCueChange: (snap) => snapshots.push(snap.text),
    });

    adapter.start();

    window.postMessage(
      {
        source: 'lexistream-yt-main',
        type: 'TIMEDTEXT_PAYLOAD',
        url: 'https://www.youtube.com/api/timedtext?v=ENjeI4s6Lx0&lang=fr&kind=asr&fmt=json3',
        body: REAL_YOUTUBE_ASR_JSON3,
      },
      window.location.origin,
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(snapshots[snapshots.length - 1]).toBe(
      'voterai lors des prochaines élections présidentielles en 2027',
    );

    // Rejects cross-origin forged MessageEvents (B2 security check)
    const crossOriginEvent = new MessageEvent('message', {
      origin: 'https://evil.example.com',
      source: null,
      data: {
        source: 'lexistream-yt-main',
        type: 'TIMEDTEXT_PAYLOAD',
        url: 'https://www.youtube.com/api/timedtext?v=ENjeI4s6Lx0&lang=fr&kind=asr&fmt=json3',
        body: JSON.stringify({
          events: [{ tStartMs: 5000, dDurationMs: 2000, segs: [{ utf8: 'FORGED' }] }],
        }),
      },
    });
    window.dispatchEvent(crossOriginEvent);
    expect(snapshots[snapshots.length - 1]).not.toBe('FORGED');

    adapter.stop();
  });

  it('strips nested srv3 <s> tags and decodes numeric XML entities in XML fallback', () => {
    const xml = `<transcript><text start="1.0" dur="2.5"><s t="0">Pr&#233;sidentielles</s> <s t="400">&#x2014; 2027</s></text></transcript>`;
    const cues = parseYouTubeJson3ToStaticCues(xml);
    expect(cues).toEqual([
      {
        startMs: 1000,
        endMs: 3500,
        text: 'Présidentielles — 2027',
      },
    ]);
  });
});
