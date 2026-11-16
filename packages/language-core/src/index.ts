import type { LanguageCode, PartOfSpeech } from '@lexistream/shared-types';
import {
  AUXILIARIES_AND_ADVERBS,
  COMMON_ADJECTIVES,
  CONJUNCTIONS,
  DETERMINERS,
  IRREGULAR_FORMS,
  PHRASAL_VERBS,
  POLYSEMOUS_NOUN_VERB,
  PREPOSITIONS,
  PRONOUN_SUBJECTS,
} from './english-lexicon';
import {
  FRENCH_CONJUNCTIONS,
  FRENCH_DETERMINERS,
  FRENCH_ETRE_AUX,
  FRENCH_IRREGULAR_FORMS,
  FRENCH_PREPOSITIONS,
  FRENCH_SUBJECT_PRONOUNS,
} from './french-lexicon';
import {
  type SubtitleToken,
  extractSentenceForToken,
  normalizeToken,
  tokenizeSubtitle,
} from './tokenizer';

export {
  type SubtitleToken,
  extractSentenceForToken,
  normalizeToken,
  tokenizeSubtitle,
};

export interface LexicalAnalysis {
  surfaceForm: string;
  normalized: string;
  lemma: string;
  partOfSpeech: PartOfSpeech;
  detectedPhrase?: string;
}

export interface TextProcessor {
  readonly id: string;
  tokenize(text: string, language?: LanguageCode): SubtitleToken[];
  normalize(word: string, language?: LanguageCode): string;
  analyzeWord(
    word: string,
    contextSentence: string,
    language?: LanguageCode,
    targetStartOffset?: number,
  ): LexicalAnalysis;
}

const DOUBLE_CONSONANTS = new Set([
  'b',
  'd',
  'g',
  'l',
  'm',
  'n',
  'p',
  'r',
  't',
]);

const LANG_STOPWORDS: Record<string, ReadonlySet<string>> = {
  fr: new Set([
    "aujourd'hui",
    'je',
    'tu',
    'il',
    'elle',
    'on',
    'le',
    'la',
    'un',
    'du',
    'au',
    'mon',
    'ma',
    'mes',
    'ton',
    'ta',
    'tes',
    'son',
    'sa',
    'ses',
    'ne',
    'se',
    'ce',
    'cet',
    'cette',
    'ces',
    'petit',
    'dans',
    'avec',
    'pour',
    'pas',
    'plus',
    'est',
    'sont',
    'une',
    'des',
    'les',
    'aux',
    'mais',
    'qui',
    'sur',
    'être',
    'avoir',
    'nous',
    'vous',
    'ils',
    'elles',
    'leur',
    'comme',
    'tout',
    'tous',
    'très',
    'aussi',
    'même',
    'sans',
    'dont',
  ]),
  es: new Set([
    'el',
    'los',
    'las',
    'una',
    'unos',
    'unas',
    'pero',
    'para',
    'como',
    'muy',
    'también',
    'este',
    'esta',
    'estos',
    'estas',
    'está',
    'están',
    'del',
    'por',
    'con',
    'sin',
    'sobre',
    'todo',
    'todos',
  ]),
  pt: new Set([
    'não',
    'você',
    'vocês',
    'está',
    'estão',
    'são',
    'uma',
    'umas',
    'com',
    'isso',
    'isto',
    'aquilo',
    'muito',
    'também',
    'pelos',
    'pelas',
    'nosso',
    'nossa',
  ]),
  de: new Set([
    'der',
    'die',
    'das',
    'und',
    'nicht',
    'ich',
    'sie',
    'wir',
    'ihr',
    'ein',
    'eine',
    'einer',
    'mit',
    'auf',
    'für',
    'von',
    'ist',
    'sind',
    'auch',
    'noch',
    'aber',
  ]),
  it: new Set([
    'non',
    'che',
    'sono',
    'della',
    'delle',
    'degli',
    'questo',
    'questa',
    'anche',
    'molto',
    'più',
    'perché',
    'gli',
    'una',
    'nel',
    'nella',
  ]),
  en: new Set([
    'the',
    'and',
    'that',
    'this',
    'with',
    'would',
    'should',
    'could',
    'never',
    'always',
    'have',
    'has',
    'from',
    'they',
    'what',
    'when',
    'where',
    'which',
    "don't",
    "can't",
    "won't",
    "it's",
    "i'm",
  ]),
};

/**
 * Lightweight, zero-dependency subtitle language detector.
 * Identifies 'fr', 'es', 'pt', 'de', 'it', or 'en' from lexical and orthographic cues.
 */
export function detectSubtitleLanguage(
  text: string,
  fallback: LanguageCode = 'en',
): LanguageCode {
  if (!text || !text.trim()) return fallback;
  const lower = text.normalize('NFC').replace(/’/g, "'").toLowerCase();

  const scores: Record<string, number> = {
    en: 0,
    fr: 0,
    es: 0,
    pt: 0,
    de: 0,
    it: 0,
  };

  if (/[¿¡ñ]/.test(lower)) scores.es! += 5;
  if (/ß|[äöü]/.test(lower)) scores.de! += 4;
  if (/[ãõ]/.test(lower)) scores.pt! += 5;
  if (/\b(?:l'|d'|qu'|c'|n'|j'|s'|aujourd'hui)/.test(lower)) scores.fr! += 5;
  if (/[œæ]|[éèêëàâîïôûùç]/.test(lower)) scores.fr! += 2;

  const words = tokenizeSubtitle(lower, fallback)
    .filter((t) => t.isWord)
    .map((t) => t.normalized);

  for (const w of words) {
    for (const [lang, stopSet] of Object.entries(LANG_STOPWORDS)) {
      if (stopSet.has(w)) {
        scores[lang] = (scores[lang] ?? 0) + 3;
      }
    }
  }

  let bestLang = fallback.slice(0, 2).toLowerCase();
  let bestScore = scores[bestLang] ?? 0;

  for (const [lang, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      bestScore = sc;
      bestLang = lang;
    }
  }

  return bestScore >= 2 ? bestLang : fallback;
}

const FRENCH_ELISION_PREFIX = /^(?:qu'|l'|d'|n'|c'|j'|s'|m'|t')(.{2,})$/i;

export function stripFrenchElision(word: string): string {
  const normalized = word.normalize('NFC').replace(/’/g, "'").trim();
  const match = FRENCH_ELISION_PREFIX.exec(normalized);
  return match?.[1] ? match[1] : normalized;
}

/**
 * Generates ordered lemma candidates (most specific first) for inflected words
 * in French, Spanish, Portuguese, Italian, German, and English.
 */
export function generateLemmaCandidates(
  surfaceOrNorm: string,
  language: LanguageCode = 'en',
): string[] {
  const lang = language.slice(0, 2).toLowerCase();
  let norm = normalizeToken(surfaceOrNorm, lang);
  if (!norm) return [];

  const out: string[] = [];
  const push = (w: string) => {
    if (w && w.length >= 2 && !out.includes(w)) {
      out.push(w);
    }
  };

  push(norm);

  if (lang === 'fr') {
    const unelided = stripFrenchElision(norm).toLowerCase();
    if (unelided !== norm) {
      norm = unelided;
      push(norm);
    }

    const irreg = FRENCH_IRREGULAR_FORMS[norm];
    if (irreg) {
      push(irreg.lemma);
    }

    // 2nd-group -ir verbs (finissent -> finir, choisissons -> choisir)
    for (const suffix of ['issent', 'issons', 'issez', 'issait', 'issaient', 'issais']) {
      if (norm.endsWith(suffix) && norm.length > suffix.length + 1) {
        push(`${norm.slice(0, -suffix.length)}ir`);
      }
    }

    // Past participles -> -er / -ir / -re infinitives (appelée -> appeler, choisie -> choisir)
    for (const suffix of ['ées', 'és', 'ée', 'é']) {
      if (norm.endsWith(suffix) && norm.length > suffix.length + 2) {
        push(`${norm.slice(0, -suffix.length)}er`);
      }
    }
    for (const suffix of ['ies', 'ie', 'is']) {
      if (norm.endsWith(suffix) && norm.length > suffix.length + 2) {
        push(`${norm.slice(0, -suffix.length)}ir`);
      }
    }

    // Present, imperfect, future & participial regular verb endings (parlons -> parler, rendez -> rendre, mange -> manger)
    for (const suffix of [
      'eront',
      'erons',
      'erez',
      'erai',
      'eras',
      'era',
      'aient',
      'ions',
      'iez',
      'ais',
      'ait',
      'ant',
      'ons',
      'ez',
      'ent',
    ]) {
      if (norm.endsWith(suffix) && norm.length > suffix.length + 2) {
        const stem = norm.slice(0, -suffix.length);
        if (stem.endsWith('e') && (suffix === 'ons' || suffix === 'ais' || suffix === 'ait' || suffix === 'aient')) {
          push(`${stem}r`); // mangeons -> manger
        }
        push(`${stem}er`);
        push(`${stem}re`);
        push(`${stem}ir`);
      }
    }

    // Adverbs & plural/feminine adjectives/nouns
    if (norm.endsWith('aux') && norm.length > 4) {
      push(`${norm.slice(0, -3)}al`);
    }
    if (norm.endsWith('euses') && norm.length > 6) {
      push(`${norm.slice(0, -5)}eux`);
    }
    if (norm.endsWith('euse') && norm.length > 5) {
      push(`${norm.slice(0, -4)}eux`);
    }
    if (norm.endsWith('ives') && norm.length > 5) {
      push(`${norm.slice(0, -4)}if`);
    }
    if (norm.endsWith('ive') && norm.length > 4) {
      push(`${norm.slice(0, -3)}if`);
    }
    if (norm.endsWith('iennes') && norm.length > 7) {
      push(`${norm.slice(0, -6)}ien`);
    }
    if (norm.endsWith('ienne') && norm.length > 6) {
      push(`${norm.slice(0, -5)}ien`);
    }
    if (norm.endsWith('es') && norm.length > 4) {
      push(norm.slice(0, -1)); // numériques -> numérique
      push(norm.slice(0, -2)); // indépendantes -> indépendant, petites -> petit
      push(`${norm.slice(0, -2)}er`); // parles -> parler
    }
    if ((norm.endsWith('s') || norm.endsWith('x')) && norm.length > 3) {
      push(norm.slice(0, -1)); // souverains -> souverain, amis -> ami
    }
    if (norm.endsWith('e') && norm.length > 3) {
      push(`${norm}r`); // mange -> manger, parle -> parler, défie -> défier
      push(norm.slice(0, -1)); // indépendante -> indépendant, petite -> petit
    }
    return out;
  }

  if (lang === 'pt' || lang === 'es' || lang === 'it') {
    for (const suffix of ['ados', 'adas', 'ado', 'ada']) {
      if (norm.endsWith(suffix) && norm.length > suffix.length + 2) {
        push(`${norm.slice(0, -suffix.length)}ar`);
      }
    }
    for (const suffix of ['idos', 'idas', 'ido', 'ida']) {
      if (norm.endsWith(suffix) && norm.length > suffix.length + 2) {
        push(`${norm.slice(0, -suffix.length)}er`);
        push(`${norm.slice(0, -suffix.length)}ir`);
      }
    }
    if ((norm.endsWith('ando') || norm.endsWith('endo') || norm.endsWith('indo')) && norm.length > 5) {
      const stem = norm.slice(0, -4);
      push(`${stem}${norm.endsWith('ando') ? 'ar' : norm.endsWith('endo') ? 'er' : 'ir'}`);
    }
    if (norm.endsWith('es') && norm.length > 4) push(norm.slice(0, -2));
    if (norm.endsWith('s') && norm.length > 3) push(norm.slice(0, -1));
    if (norm.endsWith('a') && norm.length > 3) push(`${norm.slice(0, -1)}o`);
    return out;
  }

  if (lang === 'en') {
    const stemmed = stemRegularEnglish(norm);
    push(stemmed.lemma);
  }

  return out;
}

function stemRegularEnglish(word: string): { lemma: string; pos: PartOfSpeech } {
  if (DETERMINERS.has(word)) return { lemma: word, pos: 'determiner' };
  if (PRONOUN_SUBJECTS.has(word)) return { lemma: word, pos: 'pronoun' };
  if (PREPOSITIONS.has(word)) return { lemma: word, pos: 'preposition' };
  if (CONJUNCTIONS.has(word)) return { lemma: word, pos: 'conjunction' };
  if (COMMON_ADJECTIVES.has(word)) return { lemma: word, pos: 'adjective' };

  const irregular = IRREGULAR_FORMS[word];
  if (irregular) return { lemma: irregular.lemma, pos: irregular.pos };

  if (word.includes("n't")) {
    if (word === "won't") return { lemma: 'will', pos: 'verb' };
    if (word === "can't") return { lemma: 'can', pos: 'verb' };
    return { lemma: word.replace("n't", ''), pos: 'verb' };
  }

  if (word.endsWith('ly') && word.length > 4) {
    const stem = word.slice(0, -2);
    if (stem.endsWith('i')) {
      return { lemma: `${stem.slice(0, -1)}y`, pos: 'adverb' };
    }
    return { lemma: stem, pos: 'adverb' };
  }

  if (word.endsWith('ing') && word.length > 5) {
    const stem = word.slice(0, -3);
    const last = stem[stem.length - 1];
    const prev = stem[stem.length - 2];
    if (last && last === prev && DOUBLE_CONSONANTS.has(last)) {
      return { lemma: stem.slice(0, -1), pos: 'verb' };
    }
    if (
      stem.length >= 2 &&
      !'aeiou'.includes(stem[stem.length - 1]!) &&
      'aeiou'.includes(stem[stem.length - 2]!) &&
      !stem.endsWith('w') &&
      !stem.endsWith('x') &&
      !stem.endsWith('y') &&
      !['think', 'walk', 'talk', 'work', 'play', 'stay', 'read', 'eat', 'look', 'turn', 'learn', 'adapt', 'happen'].includes(stem)
    ) {
      if (['mak', 'tak', 'giv', 'com', 'hav', 'liv', 'us', 'lov', 'mov', 'writ'].includes(stem)) {
        return { lemma: `${stem}e`, pos: 'verb' };
      }
    }
    return { lemma: stem, pos: 'verb' };
  }

  if (word.endsWith('ied') && word.length > 4) {
    return { lemma: `${word.slice(0, -3)}y`, pos: 'verb' };
  }

  if (word.endsWith('ed') && word.length > 4) {
    const stem = word.slice(0, -2);
    const last = stem[stem.length - 1];
    const prev = stem[stem.length - 2];
    if (last && last === prev && DOUBLE_CONSONANTS.has(last)) {
      return { lemma: stem.slice(0, -1), pos: 'verb' };
    }
    if (['us', 'lov', 'mov', 'liv', 'clos', 'provid', 'decid', 'creat'].includes(stem)) {
      return { lemma: `${stem}e`, pos: 'verb' };
    }
    return { lemma: stem, pos: 'verb' };
  }

  if (word.endsWith('ies') && word.length > 4) {
    return { lemma: `${word.slice(0, -3)}y`, pos: 'noun' };
  }

  if (word.endsWith('es') && word.length > 4 && /(sh|ch|x|z|ss)es$/.test(word)) {
    return { lemma: word.slice(0, -2), pos: 'noun' };
  }

  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && word.length > 3) {
    return { lemma: word.slice(0, -1), pos: 'noun' };
  }

  return { lemma: word, pos: 'noun' };
}

function stemFrenchInContext(
  word: string,
  prevWord: string,
): { lemma: string; pos: PartOfSpeech } {
  const unelided = stripFrenchElision(word).toLowerCase();

  // Contextual "partie": after être auxiliary ("Elle est partie") -> partir (verb)
  if (unelided === 'partie' || unelided === 'parties') {
    if (FRENCH_ETRE_AUX.has(prevWord)) {
      return { lemma: 'partir', pos: 'verb' };
    }
    return { lemma: 'partie', pos: 'noun' };
  }

  // Contextual "est": unless preceded by determiner "l'" ("l'est" = the East), "est" in French sentences is "être" ("is")!
  if (word === "l'est" || (unelided === 'est' && (prevWord === 'au' || prevWord === 'du'))) {
    return { lemma: 'est', pos: 'noun' };
  }

  const irreg = FRENCH_IRREGULAR_FORMS[unelided];
  if (irreg) return irreg;

  if (FRENCH_DETERMINERS.has(unelided)) return { lemma: unelided, pos: 'determiner' };
  if (FRENCH_SUBJECT_PRONOUNS.has(unelided)) return { lemma: unelided, pos: 'pronoun' };
  if (FRENCH_PREPOSITIONS.has(unelided)) return { lemma: unelided, pos: 'preposition' };
  if (FRENCH_CONJUNCTIONS.has(unelided)) return { lemma: unelided, pos: 'conjunction' };

  for (const suffix of ['issent', 'issons', 'issez', 'issait', 'issaient']) {
    if (unelided.endsWith(suffix) && unelided.length > suffix.length + 1) {
      return { lemma: `${unelided.slice(0, -suffix.length)}ir`, pos: 'verb' };
    }
  }

  for (const suffix of ['ées', 'és', 'ée', 'é']) {
    if (unelided.endsWith(suffix) && unelided.length > suffix.length + 2) {
      return { lemma: `${unelided.slice(0, -suffix.length)}er`, pos: 'verb' };
    }
  }

  for (const suffix of ['eront', 'erons', 'erez', 'erai', 'eras', 'era', 'aient', 'ais', 'ait', 'ons', 'ez', 'ent']) {
    if (unelided.endsWith(suffix) && unelided.length > suffix.length + 2 && !unelided.endsWith('ment')) {
      const stem = unelided.slice(0, -suffix.length);
      if (stem.endsWith('e') && (suffix === 'ons' || suffix === 'ais' || suffix === 'ait')) {
        return { lemma: `${stem}r`, pos: 'verb' };
      }
      return { lemma: `${stem}er`, pos: 'verb' };
    }
  }

  if (unelided.endsWith('e') && unelided.length > 3 && FRENCH_SUBJECT_PRONOUNS.has(prevWord)) {
    return { lemma: `${unelided}r`, pos: 'verb' };
  }

  if (unelided.endsWith('ment') && unelided.length > 6) {
    return { lemma: unelided, pos: 'adverb' };
  }

  return { lemma: unelided, pos: 'other' };
}

function stemRomanceOrOther(
  word: string,
  language: LanguageCode,
  prevWord = '',
): { lemma: string; pos: PartOfSpeech } {
  const lang = language.slice(0, 2).toLowerCase();

  if (lang === 'fr') {
    return stemFrenchInContext(word, prevWord);
  }

  if (lang === 'pt' || lang === 'es') {
    if (word.endsWith('mente') && word.length > 7) {
      return { lemma: word.slice(0, -5), pos: 'adverb' };
    }
    if ((word.endsWith('ando') || word.endsWith('endo') || word.endsWith('indo')) && word.length > 5) {
      const prefix = word.slice(0, -4);
      const infSuffix = word.endsWith('ando') ? 'ar' : word.endsWith('endo') ? 'er' : 'ir';
      return { lemma: `${prefix}${infSuffix}`, pos: 'verb' };
    }
  }
  return { lemma: word, pos: 'other' };
}

/**
 * Annotates phrasal verbs (both contiguous e.g. "give up" and object-separated e.g. "look it up")
 * on a SubtitleToken array.
 */
export function detectPhrasesInTokens(
  tokens: SubtitleToken[],
  language: LanguageCode = 'en',
): SubtitleToken[] {
  if (!language.startsWith('en')) return tokens;

  const result = tokens.map((t) => ({ ...t }));
  const wordIndices: number[] = [];
  for (let i = 0; i < result.length; i++) {
    if (result[i]!.isWord) wordIndices.push(i);
  }

  for (let w = 0; w < wordIndices.length; w++) {
    const tokenIdx = wordIndices[w]!;
    const tok = result[tokenIdx]!;
    if (tok.detectedPhrase) continue;

    const baseVerb = stemRegularEnglish(tok.normalized).lemma;
    const allowedParticles = PHRASAL_VERBS[baseVerb];
    if (!allowedParticles) continue;

    for (let offset = 1; offset <= 2 && w + offset < wordIndices.length; offset++) {
      const candidateIdx = wordIndices[w + offset]!;
      const candidate = result[candidateIdx]!;

      if (offset === 2) {
        const mid = result[wordIndices[w + 1]!]!;
        const separableObjects = new Set(['it', 'them', 'him', 'her', 'me', 'us', 'this', 'that']);
        if (!separableObjects.has(mid.normalized)) break;
      }

      if (allowedParticles.has(candidate.normalized)) {
        const canonicalPhrase = `${baseVerb} ${candidate.normalized}`;
        tok.detectedPhrase = canonicalPhrase;
        candidate.detectedPhrase = canonicalPhrase;
        break;
      }
    }
  }

  return result;
}

/**
 * Context-sensitive lemmatization and POS disambiguation.
 */
export function lemmatizeInContext(
  surfaceWord: string,
  contextSentence: string,
  language: LanguageCode = 'en',
  targetStartOffset?: number,
): LexicalAnalysis {
  const normalized = normalizeToken(surfaceWord, language);
  if (!normalized) {
    return {
      surfaceForm: surfaceWord,
      normalized: '',
      lemma: surfaceWord,
      partOfSpeech: 'other',
    };
  }

  const tokens = detectPhrasesInTokens(
    tokenizeSubtitle(contextSentence, language),
    language,
  );
  const words = tokens.filter((t) => t.isWord);
  const targetIdx =
    targetStartOffset !== undefined
      ? words.findIndex((w) => w.startOffset === targetStartOffset)
      : words.findIndex((w) => w.normalized === normalized);

  if (!language.startsWith('en')) {
    const prevWord = targetIdx > 0 ? words[targetIdx - 1]!.normalized : '';
    const romance = stemRomanceOrOther(normalized, language, prevWord);
    return {
      surfaceForm: surfaceWord,
      normalized,
      lemma: romance.lemma,
      partOfSpeech: romance.pos,
    };
  }

  if (targetIdx !== -1 && words[targetIdx]!.detectedPhrase) {
    const phrase = words[targetIdx]!.detectedPhrase!;
    return {
      surfaceForm: surfaceWord,
      normalized,
      lemma: phrase,
      partOfSpeech: 'phrase',
      detectedPhrase: phrase,
    };
  }

  const polysemous = POLYSEMOUS_NOUN_VERB[normalized];
  if (polysemous && targetIdx !== -1) {
    const prev1 = targetIdx > 0 ? words[targetIdx - 1]!.normalized : '';
    const prev2 = targetIdx > 1 ? words[targetIdx - 2]!.normalized : '';

    if (
      DETERMINERS.has(prev1) ||
      PREPOSITIONS.has(prev1) ||
      (COMMON_ADJECTIVES.has(prev1) && (DETERMINERS.has(prev2) || PREPOSITIONS.has(prev2)))
    ) {
      return {
        surfaceForm: surfaceWord,
        normalized,
        lemma: polysemous.nounLemma,
        partOfSpeech: 'noun',
      };
    }

    if (
      PRONOUN_SUBJECTS.has(prev1) ||
      AUXILIARIES_AND_ADVERBS.has(prev1) ||
      PRONOUN_SUBJECTS.has(prev2)
    ) {
      return {
        surfaceForm: surfaceWord,
        normalized,
        lemma: polysemous.verbLemma,
        partOfSpeech: 'verb',
      };
    }
  }

  const stemmed = stemRegularEnglish(normalized);
  return {
    surfaceForm: surfaceWord,
    normalized,
    lemma: stemmed.lemma,
    partOfSpeech: stemmed.pos,
  };
}

export function createTypeScriptTextProcessor(): TextProcessor {
  return {
    id: 'typescript-native',
    tokenize: tokenizeSubtitle,
    normalize: normalizeToken,
    analyzeWord: lemmatizeInContext,
  };
}
