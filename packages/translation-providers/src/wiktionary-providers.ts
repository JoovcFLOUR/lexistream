import type {
  LexicalMeaning,
  PartOfSpeech,
  TranslationRequest,
  TranslationResult,
} from '@lexistream/shared-types';
import { lemmatizeInContext, normalizeToken } from '@lexistream/language-core';
import type { TranslationProvider } from './index';
import { mapWiktionaryPos } from './wiktionary-parser';
import type {
  StoredDictionaryRecord,
  WiktionaryDictionaryStore,
} from './wiktionary-store';

/**
 * Offline provider backed by user-downloaded Wiktionary CC BY-SA packs in IndexedDB.
 * Throws cleanly if the requested language pair has not been downloaded by the user,
 * allowing TranslationService to fall through to live Wiktionary or optional backend providers.
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

    const src = request.source_language.slice(0, 2).toLowerCase();
    const tgt = request.target_language.slice(0, 2).toLowerCase();
    const pairId = `${src}-${tgt}`;

    const installed = await this.store.isPackInstalled(pairId);
    if (!installed) {
      throw new Error(`Wiktionary offline pack ${pairId} is not installed`);
    }

    const analysis = lemmatizeInContext(request.word, request.context, src);
    const candidates = Array.from(
      new Set(
        [analysis.detectedPhrase, analysis.normalized, analysis.lemma].filter(
          (x): x is string => Boolean(x),
        ),
      ),
    );

    // Order candidates: if contextual analysis identified a distinct lemma (e.g. verb "thought" -> "think"),
    // inspect both surface record and lemma record so verb/noun senses are all available!
    const records: StoredDictionaryRecord[] = [];
    for (const cand of candidates) {
      const rec = await this.store.lookupEntry(pairId, cand, src);
      if (rec) {
        records.push(rec);
        // Follow any `SEE: <lemma>` cross-references in Wiktionary
        for (const s of rec.senses) {
          if (s.seeAlso && !candidates.includes(s.seeAlso)) {
            const refRec = await this.store.lookupEntry(pairId, s.seeAlso, src);
            if (refRec) records.push(refRec);
          }
        }
      }
    }

    if (records.length === 0) {
      throw new Error(`Word "${request.word}" not found in offline pack ${pairId}`);
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

    if (flatSenses.length === 0) {
      throw new Error(`No translated senses for "${request.word}" in ${pairId}`);
    }

    // Score senses by contextual POS and lemma match
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
  /\b(?:past tense|past participle|present participle|plural|inflection|form|singular|third-person singular)\s+(?:and\s+past\s+participle\s+)?of\s+([a-zA-ZÀ-ÿ'-]+)/i;

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

    const src = request.source_language.slice(0, 2).toLowerCase();
    const tgt = request.target_language.slice(0, 2).toLowerCase();
    const analysis = lemmatizeInContext(request.word, request.context, src);
    const surfaceNorm = normalizeToken(request.word, src);

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

    if (detectedRedirectLemma && detectedRedirectLemma !== surfaceNorm) {
      lemmaDoc = await this.fetchEntry(src, detectedRedirectLemma, signal);
    }

    const combinedDocs: Array<{ lemma: string; doc: FreeDictApiResponse }> = [];
    if (analysis.partOfSpeech === 'verb' && lemmaDoc) {
      combinedDocs.push({ lemma: detectedRedirectLemma, doc: lemmaDoc });
    }
    if (primaryDoc) {
      combinedDocs.push({ lemma: surfaceNorm, doc: primaryDoc });
    }
    if (analysis.partOfSpeech !== 'verb' && lemmaDoc) {
      combinedDocs.push({ lemma: detectedRedirectLemma, doc: lemmaDoc });
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

          // If target language === source language (monolingual lookup) or Wiktionary has translations:
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

    // Prefer meaning matching contextual POS
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
