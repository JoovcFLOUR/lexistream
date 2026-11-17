export interface TimedSubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

interface Json3Seg {
  utf8?: string;
  tOffsetMs?: number;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  aAppend?: number;
  segs?: Json3Seg[];
}

interface Json3Payload {
  events?: Json3Event[];
}

const SENTENCE_END_RE = /[.!?…»"']$/;

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseXmlFallback(xml: string): TimedSubtitleCue[] {
  const cues: Array<{ startMs: number; rawEndMs: number; text: string }> = [];
  const re = /<text\b[^>]*\bstart="([\d.]+)"[^>]*?(?:\bdur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const startSec = Number(m[1]);
    const durSec = m[2] !== undefined ? Number(m[2]) : 3.0;
    const text = decodeXmlEntities(m[3] ?? '');
    if (!text || !Number.isFinite(startSec)) continue;
    const startMs = Math.round(startSec * 1000);
    const rawEndMs = startMs + Math.max(400, Math.round(durSec * 1000));
    cues.push({ startMs, rawEndMs, text });
  }
  return finalizeNonOverlappingCues(cues);
}

function finalizeNonOverlappingCues(
  rawCues: Array<{ startMs: number; rawEndMs: number; text: string }>,
): TimedSubtitleCue[] {
  if (rawCues.length === 0) return [];
  const sorted = [...rawCues].sort((a, b) => a.startMs - b.startMs);
  const out: TimedSubtitleCue[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const next = sorted[i + 1];
    const clampedEnd = next ? Math.min(cur.rawEndMs, next.startMs) : cur.rawEndMs;
    if (clampedEnd <= cur.startMs) continue;
    out.push({
      startMs: cur.startMs,
      endMs: clampedEnd,
      text: cur.text,
    });
  }
  return out;
}

/**
 * Converts YouTube's `fmt=json3` (`pb3`) timedtext payload — including ASR word-by-word
 * roll-up tracks (`tOffsetMs` per word + `\n` append events) — into clean, static,
 * non-overlapping embedded-style subtitle blocks.
 */
export function parseYouTubeJson3ToStaticCues(rawBody: string): TimedSubtitleCue[] {
  const trimmed = rawBody.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('<')) {
    return parseXmlFallback(trimmed);
  }

  let parsed: Json3Payload;
  try {
    parsed = JSON.parse(trimmed) as Json3Payload;
  } catch {
    return [];
  }

  const events = Array.isArray(parsed.events) ? parsed.events : [];
  let hasWordOffsets = false;

  const rawLines: Array<{ startMs: number; rawEndMs: number; text: string }> = [];

  for (const ev of events) {
    if (!Array.isArray(ev.segs) || ev.segs.length === 0) continue;
    if (typeof ev.tStartMs !== 'number') continue;

    for (const seg of ev.segs) {
      if (typeof seg.tOffsetMs === 'number' && seg.tOffsetMs > 0) {
        hasWordOffsets = true;
      }
    }

    const joined = ev.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();

    if (!joined) continue;

    const dur = typeof ev.dDurationMs === 'number' && ev.dDurationMs > 0 ? ev.dDurationMs : 3000;
    rawLines.push({
      startMs: ev.tStartMs,
      rawEndMs: ev.tStartMs + dur,
      text: joined,
    });
  }

  if (rawLines.length === 0) return [];

  // For ASR word-by-word roll-up tracks, coalesce short adjacent phrase fragments into
  // comfortable ~1–2 line static blocks (~95 chars max) so cues don't flash too rapidly.
  const merged: Array<{ startMs: number; rawEndMs: number; text: string }> = [];
  if (hasWordOffsets) {
    let i = 0;
    while (i < rawLines.length) {
      const first = rawLines[i]!;
      let curStart = first.startMs;
      let curEnd = first.rawEndMs;
      let curText = first.text;

      while (i + 1 < rawLines.length) {
        const next = rawLines[i + 1]!;
        const combinedLen = curText.length + 1 + next.text.length;
        const gapFromPrevStart = next.startMs - first.startMs;
        const endsSentence = SENTENCE_END_RE.test(curText);

        // Merge if combined static cue fits comfortably (< 96 chars) and happens within ~4.2s window
        if (!endsSentence && combinedLen <= 96 && gapFromPrevStart <= 4200 && next.startMs <= curEnd + 400) {
          curText = `${curText} ${next.text}`;
          curEnd = Math.max(curEnd, next.rawEndMs);
          i++;
        } else {
          break;
        }
      }

      merged.push({ startMs: curStart, rawEndMs: curEnd, text: curText });
      i++;
    }
  } else {
    merged.push(...rawLines);
  }

  return finalizeNonOverlappingCues(merged);
}

/**
 * O(log N) binary search for the active static subtitle cue at `currentTimeSec`.
 */
export function findActiveCueAtTime(
  cues: readonly TimedSubtitleCue[],
  currentTimeSec: number,
): TimedSubtitleCue | null {
  if (cues.length === 0 || !Number.isFinite(currentTimeSec)) return null;
  const timeMs = currentTimeSec * 1000;

  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const cue = cues[mid]!;
    if (timeMs < cue.startMs) {
      hi = mid - 1;
    } else if (timeMs >= cue.endMs) {
      lo = mid + 1;
    } else {
      return cue;
    }
  }
  return null;
}

/**
 * Produces a stable deduplication key `(videoId, lang, kind, tlang, name)` for a YouTube
 * `/api/timedtext` URL, or null if not a timedtext URL.
 */
export function canonicalTimedTextSignature(rawUrl: string): {
  videoId: string;
  trackKey: string;
  json3Url: string;
} | null {
  if (!rawUrl.includes('/api/timedtext')) return null;
  try {
    const u = new URL(rawUrl);
    const videoId = u.searchParams.get('v') ?? u.searchParams.get('docid') ?? '';
    if (!videoId) return null;
    const lang = u.searchParams.get('lang') ?? '';
    const kind = u.searchParams.get('kind') ?? '';
    const tlang = u.searchParams.get('tlang') ?? '';
    const name = u.searchParams.get('name') ?? '';

    u.searchParams.set('fmt', 'json3');
    return {
      videoId,
      trackKey: `${videoId}::${lang}::${kind}::${tlang}::${name}`,
      json3Url: u.toString(),
    };
  } catch {
    return null;
  }
}
