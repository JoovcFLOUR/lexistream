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

function stemRomanceOrOther(
  word: string,
  language: LanguageCode,
): { lemma: string; pos: PartOfSpeech } {
  if (language.startsWith('pt') || language.startsWith('es')) {
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

    // Look ahead 1 word (contiguous: "give up") or 2 words across a pronoun/short noun ("look it up")
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

  if (!language.startsWith('en')) {
    const romance = stemRomanceOrOther(normalized, language);
    return {
      surfaceForm: surfaceWord,
      normalized,
      lemma: romance.lemma,
      partOfSpeech: romance.pos,
    };
  }

  const tokens = detectPhrasesInTokens(
    tokenizeSubtitle(contextSentence, language),
    language,
  );
  const words = tokens.filter((t) => t.isWord);
  const targetIdx = words.findIndex((w) => w.normalized === normalized);

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

    // Noun cue: preceded by determiner ("a thought", "the bank") or determiner + adjective ("a fascinating thought")
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

    // Verb cue: preceded by pronoun subject ("I thought") or subject + adverb/auxiliary ("I never thought", "to book")
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
