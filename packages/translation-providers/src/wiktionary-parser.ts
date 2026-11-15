import type { LanguageCode, PartOfSpeech } from '@lexistream/shared-types';
import { normalizeToken } from '@lexistream/language-core';

export interface WiktionarySenseItem {
  pos: PartOfSpeech;
  gloss: string;
  translations: string[];
  seeAlso?: string;
}

export interface WiktionaryHeadwordEntry {
  headword: string;
  normalized: string;
  senses: WiktionarySenseItem[];
}

const POS_TAG_MAP: Record<string, PartOfSpeech> = {
  n: 'noun',
  noun: 'noun',
  prop: 'noun',
  v: 'verb',
  verb: 'verb',
  vi: 'verb',
  vt: 'verb',
  adj: 'adjective',
  adjective: 'adjective',
  adv: 'adverb',
  adverb: 'adverb',
  pron: 'pronoun',
  pronoun: 'pronoun',
  prep: 'preposition',
  preposition: 'preposition',
  conj: 'conjunction',
  conjunction: 'conjunction',
  interj: 'interjection',
  intj: 'interjection',
  article: 'determiner',
  det: 'determiner',
  num: 'determiner',
  phr: 'phrase',
  phrase: 'phrase',
  idiom: 'idiom',
};

export function mapWiktionaryPos(rawPos: string, headword = ''): PartOfSpeech {
  const cleaned = rawPos.trim().toLowerCase().replace(/[^a-z]/g, '');
  const mapped = POS_TAG_MAP[cleaned];
  if (headword.includes(' ') && (!mapped || mapped === 'verb' || mapped === 'other')) {
    return mapped === 'verb' ? 'verb' : 'phrase';
  }
  return mapped ?? 'other';
}

function cleanTranslationToken(raw: string): string {
  return raw
    .replace(/\{[^}]*\}/g, '') // remove gender/number tags like {m}, {f}, {m-f}
    .replace(/\[[^\]]*\]/g, '') // remove region/register tags like [Brazil]
    .replace(/\s+/g, ' ')
    .trim();
}

const LINE_REGEX =
  /^([^#{:\r\n]+?)\s*\{([^}]+)\}\s*(?:\(([^)]*)\))?\s*(?:SEE:\s*([^:]+?)\s*)?::\s*(.*)$/;

/**
 * Parses Wiktionary CC BY-SA bilingual plain-text dictionaries (`open-dsl-dict` format)
 * into a compact headword-indexed Map.
 */
export function parseWiktionaryDslTxt(
  rawText: string,
  sourceLanguage: LanguageCode,
  _targetLanguage: LanguageCode,
): Map<string, WiktionaryHeadwordEntry> {
  const entries = new Map<string, WiktionaryHeadwordEntry>();
  const lines = rawText.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith('#')) continue;

    const match = LINE_REGEX.exec(line);
    if (!match) continue;

    const headword = match[1]!.trim();
    const rawPos = match[2] ?? '';
    const gloss = (match[3] ?? '').trim();
    const seeRef = match[4]?.trim();
    const rhs = (match[5] ?? '').trim();

    const normalized = normalizeToken(headword, sourceLanguage);
    if (!normalized) continue;

    const translations = rhs
      ? Array.from(
          new Set(
            rhs
              .split(/[,;]/)
              .map(cleanTranslationToken)
              .filter((t) => t.length > 0),
          ),
        )
      : [];

    if (translations.length === 0 && !seeRef) continue;

    const pos = mapWiktionaryPos(rawPos, headword);
    const sense: WiktionarySenseItem = {
      pos,
      gloss,
      translations,
      seeAlso: seeRef ? normalizeToken(seeRef, sourceLanguage) : undefined,
    };

    const existing = entries.get(normalized);
    if (existing) {
      if (existing.senses.length < 8) {
        existing.senses.push(sense);
      }
    } else {
      entries.set(normalized, {
        headword,
        normalized,
        senses: [sense],
      });
    }
  }

  return entries;
}

/**
 * Synthesizes a direct `source -> target` dictionary from two Wiktionary CC BY-SA dictionaries
 * sharing an intermediate pivot language (e.g. `fr -> en` + `en -> pt` => `fr -> pt`).
 */
export function synthesizeBridgeDictionary(
  sourceToPivot: Map<string, WiktionaryHeadwordEntry>,
  pivotToTarget: Map<string, WiktionaryHeadwordEntry>,
  pivotLanguage: LanguageCode = 'en',
): Map<string, WiktionaryHeadwordEntry> {
  const synthesized = new Map<string, WiktionaryHeadwordEntry>();

  for (const [normKey, srcEntry] of sourceToPivot.entries()) {
    const bridgedSenses: WiktionarySenseItem[] = [];

    for (const sense of srcEntry.senses) {
      const targetTranslations = new Set<string>();
      for (const pivotWord of sense.translations) {
        const pivotNorm = normalizeToken(pivotWord, pivotLanguage);
        const pivotEntry = pivotToTarget.get(pivotNorm);
        if (!pivotEntry) continue;

        // Prefer matching POS senses first, fallback to any sense with translations
        const posMatches = pivotEntry.senses.filter(
          (ps) => ps.pos === sense.pos && ps.translations.length > 0,
        );
        const chosenSenses =
          posMatches.length > 0
            ? posMatches
            : pivotEntry.senses.filter((ps) => ps.translations.length > 0);

        for (const cs of chosenSenses.slice(0, 2)) {
          for (const tr of cs.translations.slice(0, 3)) {
            targetTranslations.add(tr);
          }
        }
      }

      if (targetTranslations.size > 0) {
        bridgedSenses.push({
          pos: sense.pos,
          gloss: sense.gloss || sense.translations.slice(0, 2).join(', '),
          translations: Array.from(targetTranslations).slice(0, 5),
        });
      }
    }

    if (bridgedSenses.length > 0) {
      synthesized.set(normKey, {
        headword: srcEntry.headword,
        normalized: normKey,
        senses: bridgedSenses,
      });
    }
  }

  return synthesized;
}
