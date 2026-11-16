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
    .replace(/\{[^}]*\}/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBracketAnnotations(text: string): string {
  const matches = text.match(/\[[^\]]+\]/g);
  return matches ? matches.join(' ') : '';
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

    const parenGloss = extractBalancedParenGloss(glossPart);
    const bracketNotes = extractBracketAnnotations(glossPart);
    const rawPosLower = rawPos.trim().toLowerCase();
    const reflexiveNote = rawPosLower === 'vr' ? '[reflexive]' : '';
    const gloss = [reflexiveNote, bracketNotes, parenGloss].filter(Boolean).join(' ').trim();
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
      if (existing.senses.length < 12) {
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

function stripNestedParens(text: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      out += ch;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

function extractPivotLookupCandidates(
  rawPivotGloss: string,
  pivotLanguage: LanguageCode,
): string[] {
  const candidates: string[] = [];
  const push = (s: string) => {
    const cleaned = s.trim();
    if (!cleaned) return;
    const wordCount = cleaned.split(/\s+/).length;
    // Reject sentence-length descriptive glosses so we never extract random stopword pivots!
    if (wordCount > 3) return;
    const n = normalizeToken(cleaned, pivotLanguage);
    if (n && !candidates.includes(n)) candidates.push(n);
  };

  const withoutParens = stripNestedParens(rawPivotGloss);
  const withoutTo = withoutParens.replace(/^to\s+/i, '').trim();
  const withoutArticles = withoutTo.replace(/^(?:the|a|an)\s+/i, '').trim();

  push(withoutTo);
  if (withoutArticles !== withoutTo) {
    push(withoutArticles);
  }

  // "French language" -> "French", "little one" -> "little"
  const langSuffix = /^([a-zA-ZÀ-ÿ'-]{3,})\s+(?:language|people|person|one|ones)$/i.exec(
    withoutArticles,
  );
  if (langSuffix?.[1]) {
    push(langSuffix[1]);
  }

  return candidates;
}

const SPECIALIZED_GLOSS_RE =
  /\b(?:music|computing|baseball|cricket|soccer|football|chess|archaic|obsolete|dated|slang|vulgar|heraldry|botany|zoology|fish|group of fish|sibling|comparative|figurative|figuratively|euphemistic|informal|reflexive|sarcastic|boyfriend)\b/i;

function sharedPrefixLen(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  return i;
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
  const srcPlain = (w: string) =>
    w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  for (const [normKey, srcEntry] of sourceToPivot.entries()) {
    const rawBridged: Array<{ sense: WiktionarySenseItem; cognateBonus: number }> = [];
    const plainHeadword = srcPlain(normKey);

    for (const sense of srcEntry.senses) {
      const targetTranslations: string[] = [];
      let bestCognate = 0;

      for (const pivotPhrase of sense.translations) {
        const pivotCandidates = extractPivotLookupCandidates(pivotPhrase, pivotLanguage);

        for (const pivotNorm of pivotCandidates) {
          const pivotEntry = pivotToTarget.get(pivotNorm);
          if (!pivotEntry) continue;

          bestCognate = Math.max(bestCognate, sharedPrefixLen(plainHeadword, srcPlain(pivotNorm)));

          const posMatches = pivotEntry.senses.filter(
            (ps) => ps.pos === sense.pos && ps.translations.length > 0,
          );
          const chosenSenses =
            posMatches.length > 0
              ? posMatches
              : pivotEntry.senses.filter((ps) => ps.translations.length > 0);

          const rankedSenses = [...chosenSenses].sort((a, b) => {
            const aSpec =
              (a.gloss.startsWith('(') ? 1 : 0) + (SPECIALIZED_GLOSS_RE.test(a.gloss) ? 2 : 0);
            const bSpec =
              (b.gloss.startsWith('(') ? 1 : 0) + (SPECIALIZED_GLOSS_RE.test(b.gloss) ? 2 : 0);
            return aSpec - bSpec;
          });

          for (const cs of rankedSenses.slice(0, 5)) {
            for (const tr of cs.translations.slice(0, 3)) {
              // Filter out untranslated English loanwords (e.g. "country" for country music) when real target words exist
              if (
                tr.toLowerCase() === pivotNorm &&
                SPECIALIZED_GLOSS_RE.test(cs.gloss)
              ) {
                continue;
              }
              if (!targetTranslations.includes(tr)) {
                targetTranslations.push(tr);
              }
            }
          }
          if (targetTranslations.length > 0) break;
        }
      }

      // Remove residual identical-to-pivot loanwords if genuine target words were also found
      const pivotSet = new Set(
        sense.translations.map((p) => normalizeToken(p, pivotLanguage)),
      );
      const nonLoan = targetTranslations.filter(
        (t) => !pivotSet.has(t.toLowerCase()),
      );
      const candidatesForRank = nonLoan.length > 0 ? nonLoan : targetTranslations;

      // Boost Romance/cognate target words to the front (e.g. "ami" -> "amigo" ahead of "aliado")
      const cognateSorted = [...candidatesForRank].sort((a, b) => {
        const aPref = sharedPrefixLen(plainHeadword, srcPlain(a));
        const bPref = sharedPrefixLen(plainHeadword, srcPlain(b));
        const aScore = aPref >= 3 ? aPref : 0;
        const bScore = bPref >= 3 ? bPref : 0;
        return bScore - aScore;
      });
      const finalTrans = cognateSorted.slice(0, 5);

      if (finalTrans.length > 0) {
        const sensePenalty =
          (SPECIALIZED_GLOSS_RE.test(sense.gloss) ? -10 : 0) +
          (sense.translations.some((t) => /\bdie\b/i.test(t)) ? -4 : 0);
        rawBridged.push({
          cognateBonus: (bestCognate >= 4 ? bestCognate : 0) + sensePenalty,
          sense: {
            pos: sense.pos,
            gloss: stripNestedParens(sense.gloss) || sense.translations.slice(0, 2).join(', '),
            translations: finalTrans,
          },
        });
      }
    }

    if (rawBridged.length > 0) {
      // Rank cognate senses first (e.g. territoire -> territory -> território ahead of country -> país)
      rawBridged.sort((a, b) => b.cognateBonus - a.cognateBonus);
      synthesized.set(normKey, {
        headword: srcEntry.headword,
        normalized: normKey,
        senses: rawBridged.map((r) => r.sense),
      });
    }
  }

  return synthesized;
}
