import type {
  LexicalMeaning,
  PartOfSpeech,
  TranslationRequest,
  TranslationResult,
} from '@lexistream/shared-types';
import {
  detectSubtitleLanguage,
  generateLemmaCandidates,
  lemmatizeInContext,
  normalizeToken,
} from '@lexistream/language-core';
import type { TranslationProvider } from './index';
import { mapWiktionaryPos } from './wiktionary-parser';
import type {
  StoredDictionaryRecord,
  WiktionaryDictionaryStore,
} from './wiktionary-store';

interface CoreGrammarSense {
  lemma: string;
  pos: PartOfSpeech;
  translations: Record<string, string>;
  definition: string;
}

/**
 * High-frequency French grammar overrides so conjugated auxiliaries/determiners
 * (like "est" = "is" vs compass "east", "cette" = "this" vs noun "woman") never mislead learners.
 */
const CORE_FRENCH_GRAMMAR: Record<string, CoreGrammarSense> = {
  être: {
    lemma: 'être',
    pos: 'verb',
    translations: { pt: 'ser, estar', en: 'to be', es: 'ser, estar', de: 'sein' },
    definition: 'To be; auxiliary verb of state or identity.',
  },
  avoir: {
    lemma: 'avoir',
    pos: 'verb',
    translations: { pt: 'ter, haver', en: 'to have', es: 'tener, haber', de: 'haben' },
    definition: 'To have; auxiliary verb.',
  },
  aller: {
    lemma: 'aller',
    pos: 'verb',
    translations: { pt: 'ir', en: 'to go', es: 'ir', de: 'gehen' },
    definition: 'To go; near-future auxiliary.',
  },
  ce: {
    lemma: 'ce',
    pos: 'determiner',
    translations: { pt: 'este, esta, esse, essa, isso', en: 'this, that', es: 'este, esta' },
    definition: 'Demonstrative determiner or pronoun (ce, cet, cette, ces).',
  },
  vous: {
    lemma: 'vous',
    pos: 'pronoun',
    translations: { pt: 'você, vocês', en: 'you', es: 'usted, ustedes' },
    definition: 'Second-person plural or polite singular pronoun.',
  },
  nous: {
    lemma: 'nous',
    pos: 'pronoun',
    translations: { pt: 'nós, nos', en: 'we, us', es: 'nosotros' },
    definition: 'First-person plural pronoun.',
  },
  œuvre: {
    lemma: 'œuvre',
    pos: 'noun',
    translations: { pt: 'obra, trabalho', en: 'work, oeuvre', es: 'obra' },
    definition: 'Artistic, literary, or intellectual work; action.',
  },
  école: {
    lemma: 'école',
    pos: 'noun',
    translations: { pt: 'escola', en: 'school', es: 'escuela' },
    definition: 'Institution for educating children or students.',
  },
  rendre: {
    lemma: 'rendre',
    pos: 'verb',
    translations: { pt: 'devolver, tornar, entregar', en: 'to return, make, render', es: 'devolver, volver' },
    definition: 'To give back, return, or cause to become.',
  },
  pays: {
    lemma: 'pays',
    pos: 'noun',
    translations: { pt: 'país, nação, terra', en: 'country, nation, land', es: 'país, nación' },
    definition: 'Country, sovereign state, or territory.',
  },
};

export class OfflineWiktionaryProvider implements TranslationProvider {
  readonly id = 'wiktionary-offline';

  constructor(private readonly store: WiktionaryDictionaryStore) {}

  async translate(
    request: TranslationRequest,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    if (signal?.aborted) {
      throw new DOMException('Translation aborted', 'AbortError');
    }

    const installedPacks = await this.store.listInstalledPacks();
    if (installedPacks.length === 0) {
      throw new Error('No Wiktionary offline dictionaries installed');
    }

    const tgt = request.target_language.slice(0, 2).toLowerCase();
    const requestedSrc = request.source_language.slice(0, 2).toLowerCase();
    const detectedSrc = detectSubtitleLanguage(request.context, requestedSrc);

    // Strict cross-language guard:
    // Only check `detectedSrc-tgt` and (if sentence wasn't confidently detected as another language) `requestedSrc-tgt`.
    // Never answer a confidently English sentence from a French pack!
    const candidatePairs: Array<{ pairId: string; srcLang: string }> = [];
    const pushIfInstalled = (srcLang: string) => {
      const pid = `${srcLang}-${tgt}`;
      if (
        installedPacks.some((p) => p.pairId === pid) &&
        !candidatePairs.some((c) => c.pairId === pid)
      ) {
        candidatePairs.push({ pairId: pid, srcLang });
      }
    };

    pushIfInstalled(detectedSrc);
    if (detectedSrc === requestedSrc) {
      pushIfInstalled(requestedSrc);
    }

    if (candidatePairs.length === 0) {
      throw new Error(`Wiktionary offline pack ${detectedSrc}-${tgt} is not installed`);
    }

    for (const { pairId, srcLang } of candidatePairs) {
      const analysis = lemmatizeInContext(
        request.word,
        request.context,
        srcLang,
        request.word_offset,
      );

      // Check core French grammar disambiguation first when language is French
      if (srcLang === 'fr') {
        const grammarHit =
          CORE_FRENCH_GRAMMAR[analysis.lemma] ??
          CORE_FRENCH_GRAMMAR[analysis.normalized];
        if (grammarHit && grammarHit.pos === analysis.partOfSpeech) {
          const tr = grammarHit.translations[tgt] ?? grammarHit.translations.pt!;
          return {
            word: request.word,
            lemma: grammarHit.lemma,
            part_of_speech: grammarHit.pos,
            contextual_translation: tr,
            definition: grammarHit.definition,
            context_sentence: request.context,
            context_translation: '',
            meanings: [
              {
                id: `wikt-core-fr-${grammarHit.lemma}`,
                part_of_speech: grammarHit.pos,
                translation: tr,
                definition: grammarHit.definition,
                examples: [],
              },
            ],
            provider: `wiktionary-offline:${pairId}`,
            cached: false,
          };
        }
        if (CORE_FRENCH_GRAMMAR[analysis.normalized] && analysis.partOfSpeech === 'other') {
          const g = CORE_FRENCH_GRAMMAR[analysis.normalized]!;
          const tr = g.translations[tgt] ?? g.translations.pt!;
          return {
            word: request.word,
            lemma: g.lemma,
            part_of_speech: g.pos,
            contextual_translation: tr,
            definition: g.definition,
            context_sentence: request.context,
            context_translation: '',
            meanings: [
              {
                id: `wikt-core-fr-${g.lemma}`,
                part_of_speech: g.pos,
                translation: tr,
                definition: g.definition,
                examples: [],
              },
            ],
            provider: `wiktionary-offline:${pairId}`,
            cached: false,
          };
        }
      }

      // If a phrasal verb was detected (e.g. "look up"), look up the phrase itself first;
      // do not silently degrade "look up" to single-word noun "look"!
      if (analysis.detectedPhrase) {
        const phraseRec = await this.store.lookupEntry(
          pairId,
          analysis.detectedPhrase,
          srcLang,
        );
        if (!phraseRec) {
          throw new Error(
            `Phrase "${analysis.detectedPhrase}" not in ${pairId}; deferring to phrase-capable provider`,
          );
        }
      }

      const morphCandidates = analysis.detectedPhrase
        ? [analysis.detectedPhrase]
        : generateLemmaCandidates(request.word, srcLang);

      const candidates = Array.from(
        new Set(
          analysis.detectedPhrase
            ? [analysis.detectedPhrase]
            : [analysis.normalized, analysis.lemma, ...morphCandidates].filter(
                (x): x is string => Boolean(x),
              ),
        ),
      );

      const records: StoredDictionaryRecord[] = [];
      for (const cand of candidates) {
        const rec = await this.store.lookupEntry(pairId, cand, srcLang);
        if (rec) {
          records.push(rec);
          for (const s of rec.senses) {
            if (s.seeAlso && !candidates.includes(s.seeAlso)) {
              const refRec = await this.store.lookupEntry(pairId, s.seeAlso, srcLang);
              if (refRec) records.push(refRec);
            }
          }
        }
      }

      const flatSenses: Array<{
        lemma: string;
        pos: PartOfSpeech;
        gloss: string;
        translations: string[];
      }> = [];

      for (const rec of records) {
        for (const s of rec.senses) {
          if (s.translations.length > 0) {
            flatSenses.push({
              lemma: rec.headword.toLowerCase(),
              pos: s.pos,
              gloss: s.gloss,
              translations: s.translations,
            });
          }
        }
      }

      if (flatSenses.length === 0) continue;

      const contextLower = request.context.toLowerCase();
      let best = flatSenses[0]!;
      let bestScore = -1;

      for (const s of flatSenses) {
        let score = 0;
        if (s.pos === analysis.partOfSpeech) score += 5;
        if (s.lemma === analysis.lemma) score += 4;
        if (s.gloss && contextLower.includes(s.gloss.toLowerCase())) score += 4;
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }

      const meanings: LexicalMeaning[] = flatSenses.slice(0, 6).map((s, idx) => ({
        id: `wikt-${pairId}-${idx}`,
        part_of_speech: s.pos,
        translation: s.translations.slice(0, 3).join(', '),
        definition: s.gloss || `${s.lemma} (${s.pos})`,
        examples: [],
      }));

      return {
        word: request.word,
        lemma: best.lemma,
        part_of_speech: best.pos,
        contextual_translation: best.translations.slice(0, 3).join(', '),
        definition: best.gloss || `Wiktionary (${pairId.toUpperCase()}) — CC BY-SA`,
        context_sentence: request.context,
        context_translation: '',
        meanings,
        provider: `wiktionary-offline:${pairId}`,
        cached: false,
      };
    }

    const exactInstalled = installedPacks.some(
      (p) => p.pairId === `${requestedSrc}-${tgt}`,
    );
    throw new Error(
      exactInstalled
        ? `Word "${request.word}" not found in installed Wiktionary packs`
        : `Word "${request.word}" not found (${requestedSrc}-${tgt} pack not installed)`,
    );
  }
}

interface FreeDictApiResponse {
  word?: string;
  entries?: Array<{
    partOfSpeech?: string;
    senses?: Array<{
      definition?: string;
      examples?: string[];
      translations?: Array<{
        language?: { code?: string; name?: string };
        word?: string;
      }>;
    }>;
  }>;
}

export interface LiveWiktionaryApiOptions {
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const INFLECTION_OF_REGEX =
  /\b(?:past tense|past participle|present participle|plural|inflection|form|singular|feminine|masculine|third-person singular)\s+(?:and\s+past\s+participle\s+)?of\s+([a-zA-ZÀ-ÿ'-]+)/i;

export class LiveWiktionaryApiProvider implements TranslationProvider {
  readonly id = 'wiktionary-live-cc-by-sa';
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: LiveWiktionaryApiOptions = {}) {
    this.apiBaseUrl = (
      options.apiBaseUrl ?? 'https://freedictionaryapi.com/api/v1'
    ).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 3500;
  }

  private async fetchEntry(
    lang: string,
    word: string,
    signal?: AbortSignal,
  ): Promise<FreeDictApiResponse | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const url = `${this.apiBaseUrl}/entries/${encodeURIComponent(lang)}/${encodeURIComponent(word)}?translations=true`;
      const res = await this.fetchImpl(url, { signal: controller.signal });
      if (!res.ok) return null;
      return (await res.json()) as FreeDictApiResponse;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async translate(
    request: TranslationRequest,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    if (signal?.aborted) {
      throw new DOMException('Translation aborted', 'AbortError');
    }

    const requestedSrc = request.source_language.slice(0, 2).toLowerCase();
    const src = detectSubtitleLanguage(request.context, requestedSrc);
    const tgt = request.target_language.slice(0, 2).toLowerCase();
    const analysis = lemmatizeInContext(
      request.word,
      request.context,
      src,
      request.word_offset,
    );
    const candidates = analysis.detectedPhrase
      ? [analysis.detectedPhrase]
      : generateLemmaCandidates(request.word, src);
    const surfaceNorm = candidates[0] ?? normalizeToken(request.word, src);

    const primaryDoc = await this.fetchEntry(src, surfaceNorm, signal);
    let lemmaDoc: FreeDictApiResponse | null = null;
    let detectedRedirectLemma = analysis.lemma;

    if (primaryDoc?.entries) {
      for (const entry of primaryDoc.entries) {
        for (const sense of entry.senses ?? []) {
          const m = INFLECTION_OF_REGEX.exec(sense.definition ?? '');
          if (m?.[1]) {
            detectedRedirectLemma = m[1].toLowerCase();
            break;
          }
        }
      }
    }

    const fallbackLemma =
      detectedRedirectLemma !== surfaceNorm
        ? detectedRedirectLemma
        : candidates.find((c) => c !== surfaceNorm);

    if (fallbackLemma && fallbackLemma !== surfaceNorm) {
      lemmaDoc = await this.fetchEntry(src, fallbackLemma, signal);
    }

    const combinedDocs: Array<{ lemma: string; doc: FreeDictApiResponse }> = [];
    if (analysis.partOfSpeech === 'verb' && lemmaDoc && fallbackLemma) {
      combinedDocs.push({ lemma: fallbackLemma, doc: lemmaDoc });
    }
    if (primaryDoc) {
      combinedDocs.push({ lemma: surfaceNorm, doc: primaryDoc });
    }
    if (analysis.partOfSpeech !== 'verb' && lemmaDoc && fallbackLemma) {
      combinedDocs.push({ lemma: fallbackLemma, doc: lemmaDoc });
    }

    if (combinedDocs.length === 0) {
      throw new Error(`No live Wiktionary entry found for "${request.word}"`);
    }

    const extractedMeanings: Array<LexicalMeaning & { lemma: string }> = [];

    for (const { lemma, doc } of combinedDocs) {
      for (const entry of doc.entries ?? []) {
        const pos = mapWiktionaryPos(entry.partOfSpeech ?? 'other', lemma);
        for (const sense of entry.senses ?? []) {
          const def = (sense.definition ?? '').trim();
          if (!def) continue;

          const targetWords = Array.from(
            new Set(
              (sense.translations ?? [])
                .filter((t) => t.language?.code?.slice(0, 2).toLowerCase() === tgt)
                .map((t) => t.word?.trim() ?? '')
                .filter(Boolean),
            ),
          );

          if (targetWords.length > 0 || src === tgt) {
            extractedMeanings.push({
              id: `wikt-live-${lemma}-${extractedMeanings.length}`,
              lemma,
              part_of_speech: pos,
              translation:
                targetWords.length > 0
                  ? targetWords.slice(0, 4).join(', ')
                  : def.slice(0, 60),
              definition: def,
              examples: (sense.examples ?? []).slice(0, 2),
            });
          }
        }
      }
    }

    if (extractedMeanings.length === 0) {
      throw new Error(
        `Wiktionary entry found for "${request.word}", but no ${tgt} translations listed`,
      );
    }

    const chosen =
      extractedMeanings.find((m) => m.part_of_speech === analysis.partOfSpeech) ??
      extractedMeanings[0]!;

    return {
      word: request.word,
      lemma: chosen.lemma,
      part_of_speech: chosen.part_of_speech,
      contextual_translation: chosen.translation,
      definition: chosen.definition,
      context_sentence: request.context,
      context_translation: '',
      meanings: extractedMeanings.slice(0, 5).map(({ lemma: _l, ...rest }) => rest),
      provider: this.id,
      cached: false,
    };
  }
}
