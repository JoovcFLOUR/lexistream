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
  m: 'noun',
  f: 'noun',
  mf: 'noun',
  nt: 'noun',
  pl: 'noun',
  p: 'noun',
  c: 'noun',
  v: 'verb',
  verb: 'verb',
  vi: 'verb',
  vt: 'verb',
  vr: 'verb',
  vtr: 'verb',
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
  determiner: 'determiner',
  num: 'determiner',
  phr: 'phrase',
  phrase: 'phrase',
  idiom: 'idiom',
};

export function mapWiktionaryPos(rawPos: string, headword = ''): PartOfSpeech {
  const cleaned = rawPos.trim().toLowerCase().replace(/[^a-z]/g, '');
  const mapped = POS_TAG_MAP[cleaned];
  if (headword.includes(' ') && (!mapped || mapped === 'other')) {
    return 'phrase';
  }
  return mapped ?? 'other';
}

function cleanTranslationToken(raw: string): string {
  return raw
    .replace(/\{[^}]*\}/g, '') // remove gender/number tags like {m}, {f}, {m-f}
    .replace(/\[[^\]]*\]/g, '') // remove region/register tags like [Brazil], [idiomatic]
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBalancedParenGloss(restLeft: string): string {
  const firstOpen = restLeft.indexOf('(');
  if (firstOpen === -1) return '';
  let depth = 0;
  for (let i = firstOpen; i < restLeft.length; i++) {
    const ch = restLeft[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return restLeft.slice(firstOpen + 1, i).trim();
      }
    }
  }
  const lastClose = restLeft.lastIndexOf(')');
  return lastClose > firstOpen ? restLeft.slice(firstOpen + 1, lastClose).trim() : '';
}

/**
 * Parses Wiktionary CC BY-SA bilingual plain-text dictionaries (`open-dsl-dict` format)
 * into a compact headword-indexed Map. Handles nested parentheses, `{m}`/`{vt}` tags,
 * `[domain]` brackets, and `SEE:` cross-references cleanly.
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

    const sepIdx = line.indexOf('::');
    if (sepIdx === -1) continue;

    const lhs = line.slice(0, sepIdx).trim();
    const rhs = line.slice(sepIdx + 2).trim();

    const braceOpen = lhs.indexOf('{');
    const braceClose = braceOpen !== -1 ? lhs.indexOf('}', braceOpen + 1) : -1;
    if (braceOpen === -1 || braceClose === -1) continue;

    const headword = lhs.slice(0, braceOpen).trim();
    const rawPos = lhs.slice(braceOpen + 1, braceClose).trim();
    const afterPos = lhs.slice(braceClose + 1).trim();

    let seeRef: string | undefined;
    let glossPart = afterPos;
    const seeIdx = afterPos.indexOf('SEE:');
    if (seeIdx !== -1) {
      seeRef = afterPos.slice(seeIdx + 4).trim();
      glossPart = afterPos.slice(0, seeIdx).trim();
    }

    const gloss = extractBalancedParenGloss(glossPart);
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
      if (existing.senses.length < 10) {
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

function extractPivotLookupCandidates(
  rawPivotGloss: string,
  pivotLanguage: LanguageCode,
): string[] {
  const candidates: string[] = [];
  const push = (s: string) => {
    const n = normalizeToken(s, pivotLanguage);
    if (n && !candidates.includes(n)) candidates.push(n);
  };

  // Strip parenthetical clarifications e.g. "to call (out)" -> "to call", "little one (child)" -> "little one"
  const withoutParens = rawPivotGloss.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const withoutTo = withoutParens.replace(/^to\s+/i, '').trim();

  push(withoutTo);
  push(withoutParens);

  // If multiword like "little one", also try leading headword "little" as secondary candidate
  if (withoutTo.includes(' ')) {
    const firstWord = withoutTo.split(' ')[0];
    if (firstWord && firstWord.length >= 3) {
      push(firstWord);
    }
  }

  return candidates;
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
      for (const pivotPhrase of sense.translations) {
        const pivotCandidates = extractPivotLookupCandidates(pivotPhrase, pivotLanguage);

        for (const pivotNorm of pivotCandidates) {
          const pivotEntry = pivotToTarget.get(pivotNorm);
          if (!pivotEntry) continue;

          const posMatches = pivotEntry.senses.filter(
            (ps) => ps.pos === sense.pos && ps.translations.length > 0,
          );
          const chosenSenses =
            posMatches.length > 0
              ? posMatches
              : pivotEntry.senses.filter((ps) => ps.translations.length > 0);

          // Rank general everyday senses ahead of narrow parenthetical domain senses like "((computing): ...)"
          const rankedSenses = [...chosenSenses].sort((a, b) => {
            const aSpecialized = a.gloss.startsWith('(') ? 1 : 0;
            const bSpecialized = b.gloss.startsWith('(') ? 1 : 0;
            return aSpecialized - bSpecialized;
          });

          for (const cs of rankedSenses.slice(0, 5)) {
            for (const tr of cs.translations.slice(0, 2)) {
              targetTranslations.add(tr);
            }
          }
          if (targetTranslations.size > 0) break;
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
