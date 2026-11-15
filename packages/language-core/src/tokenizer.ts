import type { LanguageCode } from '@lexistream/shared-types';

export interface SubtitleToken {
  index: number;
  text: string;
  isWord: boolean;
  normalized: string;
  startOffset: number;
  endOffset: number;
  detectedPhrase?: string;
}

const TOKEN_PATTERN =
  /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

const EDGE_PUNCT_PATTERN = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function normalizeToken(raw: string, language: LanguageCode = 'en'): string {
  const nfc = raw.normalize('NFC').replace(/’/g, "'").trim();
  const stripped = nfc.replace(EDGE_PUNCT_PATTERN, '');
  const langPrefix = language.slice(0, 2).toLowerCase();
  if (langPrefix === 'tr' || langPrefix === 'az' || langPrefix === 'lt') {
    try {
      return stripped.toLocaleLowerCase(language);
    } catch {
      return stripped.toLowerCase();
    }
  }
  return stripped.toLowerCase();
}

/**
 * Single-pass lossless subtitle tokenizer.
 * Concatenating `token.text` across all returned tokens always reproduces `text` byte-for-byte.
 */
export function tokenizeSubtitle(
  text: string,
  language: LanguageCode = 'en',
): SubtitleToken[] {
  if (!text) return [];

  const tokens: SubtitleToken[] = [];
  let cursor = 0;
  let index = 0;

  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    const matchStart = match.index;
    const matchText = match[0];

    if (matchStart > cursor) {
      const sep = text.slice(cursor, matchStart);
      tokens.push({
        index: index++,
        text: sep,
        isWord: false,
        normalized: '',
        startOffset: cursor,
        endOffset: matchStart,
      });
    }

    tokens.push({
      index: index++,
      text: matchText,
      isWord: true,
      normalized: normalizeToken(matchText, language),
      startOffset: matchStart,
      endOffset: matchStart + matchText.length,
    });

    cursor = matchStart + matchText.length;
  }

  if (cursor < text.length) {
    const tail = text.slice(cursor);
    tokens.push({
      index: index++,
      text: tail,
      isWord: false,
      normalized: '',
      startOffset: cursor,
      endOffset: text.length,
    });
  }

  return tokens;
}

/**
 * Extracts the surrounding sentence for a given token within a cue.
 */
export function extractSentenceForToken(
  fullText: string,
  token: Pick<SubtitleToken, 'startOffset' | 'endOffset'>,
): string {
  if (!fullText.trim()) return '';

  const boundaryChars = new Set(['.', '!', '?', '…', '\n']);
  let start = token.startOffset;
  while (start > 0 && !boundaryChars.has(fullText[start - 1]!)) {
    start--;
  }

  let end = token.endOffset;
  while (end < fullText.length && !boundaryChars.has(fullText[end]!)) {
    end++;
  }
  if (end < fullText.length && boundaryChars.has(fullText[end]!)) {
    end++;
  }

  return fullText.slice(start, end).trim();
}
