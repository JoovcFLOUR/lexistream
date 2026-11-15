import type {
  LexicalMeaning,
  PartOfSpeech,
  TranslationRequest,
  TranslationResult,
} from '@lexistream/shared-types';
import { lemmatizeInContext, normalizeToken, tokenizeSubtitle } from '@lexistream/language-core';
import type { TranslationProvider } from './index';

interface SenseRecord {
  id: string;
  pos: PartOfSpeech;
  lemma: string;
  translations: Record<string, string>;
  definition: string;
  contextKeywords?: string[];
  examples: string[];
}

const LEXICON: Record<string, SenseRecord[]> = {
  thought: [
    {
      id: 'think-v-past',
      pos: 'verb',
      lemma: 'think',
      translations: { pt: 'pensei / pensou', es: 'pensé / pensó', fr: 'pensé', de: 'dachte' },
      definition: 'To form or hold an idea, belief, or opinion in the mind.',
      examples: ['I never thought this would happen.'],
    },
    {
      id: 'thought-n-idea',
      pos: 'noun',
      lemma: 'thought',
      translations: { pt: 'pensamento', es: 'pensamiento', fr: 'pensée', de: 'Gedanke' },
      definition: 'An idea or opinion produced by thinking or occurring suddenly in the mind.',
      examples: ['That was a fascinating thought about language.'],
    },
  ],
  think: [
    {
      id: 'think-v',
      pos: 'verb',
      lemma: 'think',
      translations: { pt: 'pensar / achar', es: 'pensar', fr: 'penser', de: 'denken' },
      definition: 'To direct one’s mind toward someone or something.',
      examples: ['What do you think about this approach?'],
    },
  ],
  bank: [
    {
      id: 'bank-n-river',
      pos: 'noun',
      lemma: 'bank',
      translations: { pt: 'margem', es: 'orilla', fr: 'rive', de: 'Ufer' },
      definition: 'The land alongside or sloping down to a river or lake.',
      contextKeywords: ['river', 'water', 'stream', 'lake', 'shore', 'boat', 'fish', 'sat'],
      examples: ['We sat quietly by the river bank.'],
    },
    {
      id: 'bank-n-finance',
      pos: 'noun',
      lemma: 'bank',
      translations: { pt: 'banco', es: 'banco', fr: 'banque', de: 'Bank' },
      definition: 'A financial institution licensed to receive deposits and make loans.',
      contextKeywords: ['money', 'central', 'deposit', 'deposited', 'salary', 'loan', 'account', 'credit'],
      examples: ['She deposited her salary at the central bank.'],
    },
  ],
  light: [
    {
      id: 'light-n-illumination',
      pos: 'noun',
      lemma: 'light',
      translations: { pt: 'luz', es: 'luz', fr: 'lumière', de: 'Licht' },
      definition: 'Natural or artificial illumination that makes sight possible.',
      contextKeywords: ['sun', 'bright', 'dark', 'lamp', 'room', 'speed'],
      examples: ['The morning light filled the room.'],
    },
    {
      id: 'light-adj-weight',
      pos: 'adjective',
      lemma: 'light',
      translations: { pt: 'leve', es: 'ligero', fr: 'léger', de: 'leicht' },
      definition: 'Of little weight; not heavy.',
      contextKeywords: ['bag', 'carry', 'weight', 'feather', 'footprint', 'lightweight'],
      examples: ['Keep the runtime footprint light.'],
    },
  ],
  'give up': [
    {
      id: 'give-up-phr',
      pos: 'phrase',
      lemma: 'give up',
      translations: { pt: 'desistir', es: 'rendirse', fr: 'abandonner', de: 'aufgeben' },
      definition: 'To cease making an effort; admit defeat or stop trying.',
      examples: ['Never give up when learning a new language.'],
    },
  ],
  'look up': [
    {
      id: 'look-up-phr',
      pos: 'phrase',
      lemma: 'look up',
      translations: { pt: 'consultar / pesquisar', es: 'buscar', fr: 'chercher', de: 'nachschlagen' },
      definition: 'To search for and find a piece of information in a book or database.',
      examples: ['You can look it up in context while watching.'],
    },
  ],
  never: [
    {
      id: 'never-adv',
      pos: 'adverb',
      lemma: 'never',
      translations: { pt: 'nunca', es: 'nunca', fr: 'jamais', de: 'nie' },
      definition: 'At no time in the past or future; not ever.',
      examples: ['I never thought this would happen.'],
    },
  ],
  happen: [
    {
      id: 'happen-v',
      pos: 'verb',
      lemma: 'happen',
      translations: { pt: 'acontecer', es: 'suceder', fr: 'arriver', de: 'passieren' },
      definition: 'To take place; occur.',
      examples: ['I never thought this would happen.'],
    },
  ],
  context: [
    {
      id: 'context-n',
      pos: 'noun',
      lemma: 'context',
      translations: { pt: 'contexto', es: 'contexto', fr: 'contexte', de: 'Kontext' },
      definition: 'The circumstances or surrounding words that clarify meaning.',
      examples: ['Words acquire precise meaning in context.'],
    },
  ],
  subtitle: [
    {
      id: 'subtitle-n',
      pos: 'noun',
      lemma: 'subtitle',
      translations: { pt: 'legenda', es: 'subtítulo', fr: 'sous-titre', de: 'Untertitel' },
      definition: 'Captions displayed at the bottom of a screen translating or transcribing dialogue.',
      examples: ['Hover over any subtitle word to inspect its meaning.'],
    },
  ],
  language: [
    {
      id: 'language-n',
      pos: 'noun',
      lemma: 'language',
      translations: { pt: 'idioma / linguagem', es: 'idioma', fr: 'langue', de: 'Sprache' },
      definition: 'The principal method of human communication.',
      examples: ['Context accelerates natural language acquisition.'],
    },
  ],
  learn: [
    {
      id: 'learn-v',
      pos: 'verb',
      lemma: 'learn',
      translations: { pt: 'aprender', es: 'aprender', fr: 'apprendre', de: 'lernen' },
      definition: 'To gain or acquire knowledge or skill by study or experience.',
      examples: ['We learn vocabulary faster from real stories.'],
    },
  ],
  remember: [
    {
      id: 'remember-v',
      pos: 'verb',
      lemma: 'remember',
      translations: { pt: 'lembrar', es: 'recordar', fr: 'se souvenir', de: 'erinnern' },
      definition: 'To keep in memory; not forget.',
      examples: ['Spaced repetition helps you remember effortlessly.'],
    },
  ],
};

const CANONICAL_SENTENCE_TRANSLATIONS: Record<string, Record<string, string>> = {
  'i never thought this would happen.': {
    pt: 'Eu nunca pensei que isso aconteceria.',
    es: 'Nunca pensé que esto sucedería.',
    fr: "Je n'aurais jamais pensé que cela arriverait.",
    de: 'Ich hätte nie gedacht, dass das passieren würde.',
  },
  'never give up when you look it up in context.': {
    pt: 'Nunca desista quando você pesquisar no contexto.',
    es: 'Nunca te rindas cuando lo busques en contexto.',
  },
};

const WORD_GLOSS_PT: Record<string, string> = {
  i: 'Eu',
  you: 'você',
  we: 'nós',
  they: 'eles',
  she: 'ela',
  he: 'ele',
  it: 'isso',
  this: 'isso',
  that: 'aquilo',
  the: 'o',
  a: 'um',
  an: 'um',
  is: 'é',
  are: 'são',
  was: 'era',
  were: 'eram',
  would: 'iria',
  never: 'nunca',
  always: 'sempre',
  happen: 'acontecer',
  fascinating: 'fascinante',
  about: 'sobre',
  by: 'perto de',
  river: 'rio',
  hello: 'olá',
  world: 'mundo',
};

function translateSentenceLightweight(
  sentence: string,
  targetLang: string,
): string {
  if (!sentence.trim()) return '';
  const langKey = targetLang.slice(0, 2).toLowerCase();
  const exact = CANONICAL_SENTENCE_TRANSLATIONS[sentence.trim().toLowerCase()]?.[langKey];
  if (exact) return exact;

  if (langKey === 'pt') {
    const tokens = tokenizeSubtitle(sentence, 'en');
    return tokens
      .map((tok) => {
        if (!tok.isWord) return tok.text;
        const sense = LEXICON[tok.normalized]?.[0];
        if (sense?.translations.pt) {
          return sense.translations.pt.split('/')[0]!.trim();
        }
        return WORD_GLOSS_PT[tok.normalized] ?? tok.text;
      })
      .join('');
  }

  return `[${langKey.toUpperCase()}] ${sentence}`;
}

export class ContextualLexicalProvider implements TranslationProvider {
  readonly id = 'local-contextual-lexicon';

  async translate(
    request: TranslationRequest,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    if (signal?.aborted) {
      throw new DOMException('Translation aborted', 'AbortError');
    }

    const analysis = lemmatizeInContext(
      request.word,
      request.context,
      request.source_language,
    );
    const targetLang = request.target_language.slice(0, 2).toLowerCase();
    const lookupKeys = [
      analysis.detectedPhrase,
      analysis.normalized,
      analysis.lemma,
    ].filter((k): k is string => Boolean(k));

    let matchedSenses: SenseRecord[] = [];
    for (const key of lookupKeys) {
      if (LEXICON[key]) {
        matchedSenses = LEXICON[key]!;
        break;
      }
    }

    const contextTokens = new Set(
      tokenizeSubtitle(request.context, request.source_language)
        .filter((t) => t.isWord)
        .map((t) => normalizeToken(t.text, request.source_language)),
    );

    let chosenSense: SenseRecord | undefined;
    if (matchedSenses.length > 0) {
      // Score senses by POS match + context keyword overlap
      let bestScore = -1;
      for (const sense of matchedSenses) {
        let score = 0;
        if (sense.pos === analysis.partOfSpeech) score += 3;
        if (sense.lemma === analysis.lemma) score += 2;
        if (sense.contextKeywords) {
          for (const kw of sense.contextKeywords) {
            if (contextTokens.has(kw)) score += 4;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          chosenSense = sense;
        }
      }
    }

    const meanings: LexicalMeaning[] = matchedSenses.map((s) => ({
      id: s.id,
      part_of_speech: s.pos,
      translation: s.translations[targetLang] ?? s.translations.pt ?? analysis.lemma,
      definition: s.definition,
      examples: s.examples,
    }));

    const fallbackTranslation =
      WORD_GLOSS_PT[analysis.normalized] ??
      WORD_GLOSS_PT[analysis.lemma] ??
      `${analysis.lemma} (${targetLang})`;

    const contextualTranslation =
      chosenSense?.translations[targetLang] ??
      chosenSense?.translations.pt ??
      fallbackTranslation;

    const definition =
      chosenSense?.definition ??
      `Contextual lexical entry for "${analysis.lemma}" (${analysis.partOfSpeech}).`;

    if (meanings.length === 0) {
      meanings.push({
        id: `${analysis.lemma}-${analysis.partOfSpeech}`,
        part_of_speech: analysis.partOfSpeech,
        translation: contextualTranslation,
        definition,
        examples: request.context ? [request.context] : [],
      });
    }

    return {
      word: request.word,
      lemma: chosenSense?.lemma ?? analysis.lemma,
      part_of_speech: chosenSense?.pos ?? analysis.partOfSpeech,
      contextual_translation: contextualTranslation,
      definition,
      context_sentence: request.context,
      context_translation: translateSentenceLightweight(request.context, targetLang),
      meanings,
      provider: this.id,
      cached: false,
    };
  }
}
