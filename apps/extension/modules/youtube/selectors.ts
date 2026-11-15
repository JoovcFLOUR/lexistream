/**
 * Single isolated selector map for YouTube's user-facing player DOM.
 * Isolating all DOM selectors here prevents YouTube layout updates from leaking
 * into caption parsing, linguistic analysis, or vocabulary storage modules.
 */
export const YOUTUBE_SELECTORS = {
  playerContainer: '#movie_player, .html5-video-player',
  videoElement: 'video.html5-main-video, #movie_player video, video',
  captionWindowContainer: '.ytp-caption-window-container',
  captionSegment: '.ytp-caption-segment',
  subtitlesToggleButton: '.ytp-subtitles-button',
  videoTitleCandidates: [
    'h1.ytd-watch-metadata yt-formatted-string',
    'h1.ytd-watch-metadata',
    '#title h1 yt-formatted-string',
    '#above-the-fold #title h1',
  ],
} as const;

export interface YouTubeVideoMetadata {
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  currentTime: number;
}

export function parseYouTubeVideoId(href: string): string | null {
  try {
    const url = new URL(href);
    const vParam = url.searchParams.get('v');
    if (vParam) return vParam;

    const shortsMatch = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]+)/);
    if (shortsMatch?.[1]) return shortsMatch[1];

    const embedMatch = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]+)/);
    if (embedMatch?.[1]) return embedMatch[1];
  } catch {
    return null;
  }
  return null;
}

export function extractYouTubeMetadata(
  doc: Document,
  href: string,
): YouTubeVideoMetadata | null {
  const videoId = parseYouTubeVideoId(href);
  if (!videoId) return null;

  let title = '';
  for (const selector of YOUTUBE_SELECTORS.videoTitleCandidates) {
    const el = doc.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text) {
      title = text;
      break;
    }
  }
  if (!title) {
    title = doc.title.replace(/\s*-\s*YouTube$/i, '').trim() || `YouTube Video (${videoId})`;
  }

  const videoEl = doc.querySelector<HTMLVideoElement>(YOUTUBE_SELECTORS.videoElement);
  const currentTime =
    videoEl && Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0;

  return {
    videoId,
    videoTitle: title,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    currentTime,
  };
}
