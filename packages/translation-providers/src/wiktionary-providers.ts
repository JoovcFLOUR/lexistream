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

/**
 * Offline provider backed by user-downloaded Wiktionary CC BY-SA packs in IndexedDB.
 * Automatically resolves across installed packs for the user's target language even when
 * the subtitle language differs from the default `source_language` setting (e.g., watching
 * a French video with `fr-pt` installed while settings still say `en`).
 */
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

    // Build ordered candidate pairs to check:
    // 1. Detected sentence language -> target (e.g. 'fr-pt' when watching French subtitles!)
    // 2. Requested source language -> target (e.g. 'en-pt')
    // 3. Any other installed pack whose targetLanguage === tgt
    const candidatePairs: Array<{ pairId: string; srcLang: string }> = [];
    const pushPair = (srcLang: string) => {
      const pid = `${srcLang}-${tgt}`;
      if (
        installedPacks.some((p) => p.pairId === pid) &&
        !candidatePairs.some((c) => c.pairId === pid)
      ) {
        candidatePairs.push({ pairId: pid, srcLang });
      }
    };

    pushPair(detectedSrc);
    pushPair(requestedSrc);
    for (const p of installedPacks) {
      if (p.targetLanguage === tgt) {
        pushPair(p.sourceLanguage);
      }
    }

    if (candidatePairs.length === 0) {
      throw new Error(`Wiktionary offline pack ${requestedSrc}-${tgt} is not installed`);
    }

    for (const { pairId, srcLang } of candidatePairs) {
      const analysis = lemmatizeInContext(request.word, request.context, srcLang);
      const morphCandidates = generateLemmaCandidates(request.word, srcLang);
      const candidates = Array.from(
        new Set(
          [
            analysis.detectedPhrase,
            analysis.normalized,
            analysis.lemma,
            ...morphCandidates,
          ].filter((x): x is string => Boolean(x)),
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
        if (s.lemma === analysis.lemma) score += 3;
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

/**
 * Queries live Wiktionary CC BY-SA 4.0 entries on demand over HTTPS (zero API key required).
 */
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
    const analysis = lemmatizeInContext(request.word, request.context, src);
    const candidates = generateLemmaCandidates(request.word, src);
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
