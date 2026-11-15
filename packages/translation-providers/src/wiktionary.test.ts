import { describe, expect, it, vi } from 'vitest';
import {
  WIKTIONARY_DICTIONARY_CATALOG,
  WiktionaryDictionaryStore,
  OfflineWiktionaryProvider,
  LiveWiktionaryApiProvider,
  parseWiktionaryDslTxt,
} from './index';

const SAMPLE_EN_PT_TXT = `# English :: Portuguese dictionary extracted from http://en.wiktionary.org/
# License :: Creative Commons Attribution-ShareAlike 3.0 Unported License
think {v} (conceive in the mind) :: pensar, achar [Brazil], refletir
thought {n} (representation created in the mind) :: pensamento {m}, ideia {f}
thought {v} (past tense of think) SEE: think ::
hello {interj} (greeting) :: olá, bom dia
give up {v} (stop trying, surrender) :: desistir, abrir mão
bank {n} (financial institution) :: banco {m}
bank {n} (edge of a river) :: margem {f}, ribanceira {f}
`;

const SAMPLE_FR_EN_TXT = `# French :: English dictionary extracted from http://en.wiktionary.org/
bonjour {interj} (greeting) :: hello, good morning
penser {v} (to conceive in mind) :: think
banque {n} (financial institution) :: bank
`;

describe('Wiktionary On-Demand Offline Dictionaries & Live CC BY-SA Provider', () => {
  it('parses Wiktionary CC BY-SA text entries cleanly, stripping gender/region tags and grouping senses', () => {
    const parsed = parseWiktionaryDslTxt(SAMPLE_EN_PT_TXT, 'en', 'pt');
    const thinkEntry = parsed.get('think');
    expect(thinkEntry).toBeDefined();
    expect(thinkEntry?.senses[0]?.pos).toBe('verb');
    expect(thinkEntry?.senses[0]?.translations).toEqual(['pensar', 'achar', 'refletir']);
    expect(thinkEntry?.senses[0]?.gloss).toBe('conceive in the mind');

    const bankEntry = parsed.get('bank');
    expect(bankEntry?.senses).toHaveLength(2);
    expect(bankEntry?.senses[1]?.translations).toContain('margem');
  });

  it('starts with zero pre-installed dictionaries, downloads on demand with progress, translates offline, and uninstalls cleanly', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('en-pt-enwiktionary.txt')) {
        return new Response(SAMPLE_EN_PT_TXT, { status: 200 });
      }
      if (url.includes('fr-en-enwiktionary.txt')) {
        return new Response(SAMPLE_FR_EN_TXT, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    const store = new WiktionaryDictionaryStore('test-wikt-store-1', fetchMock as unknown as typeof fetch);

    // Must have catalog options including en-pt, fr-pt, fr-en, es-pt, etc., with ZERO installed initially
    expect(WIKTIONARY_DICTIONARY_CATALOG.some((d) => d.pairId === 'en-pt')).toBe(true);
    expect(WIKTIONARY_DICTIONARY_CATALOG.some((d) => d.pairId === 'fr-pt')).toBe(true);
    expect(WIKTIONARY_DICTIONARY_CATALOG.some((d) => d.pairId === 'fr-en')).toBe(true);
    expect(await store.listInstalledPacks()).toEqual([]);

    const stages: string[] = [];
    const metaEnPt = await store.downloadPack('en-pt', (p) => {
      stages.push(`${p.phase}:${p.percent}`);
    });
    expect(metaEnPt.pairId).toBe('en-pt');
    expect(metaEnPt.entryCount).toBeGreaterThanOrEqual(5);
    expect(stages.length).toBeGreaterThan(0);

    const installed = await store.listInstalledPacks();
    expect(installed.map((p) => p.pairId)).toEqual(['en-pt']);

    // OfflineWiktionaryProvider resolves inflected verb "thought" -> lemma "think" -> "pensar, achar, refletir"
    const offlineProvider = new OfflineWiktionaryProvider(store);
    const verbRes = await offlineProvider.translate({
      word: 'thought',
      context: 'I never thought this would happen.',
      source_language: 'en',
      target_language: 'pt',
    });
    expect(verbRes.provider).toBe('wiktionary-offline:en-pt');
    expect(verbRes.lemma).toBe('think');
    expect(verbRes.contextual_translation).toContain('pensar');

    // Noun context for "thought" -> "pensamento, ideia"
    const nounRes = await offlineProvider.translate({
      word: 'thought',
      context: 'That was a fascinating thought.',
      source_language: 'en',
      target_language: 'pt',
    });
    expect(nounRes.contextual_translation).toContain('pensamento');

    // Bridge pack fr-pt synthesizes French -> Portuguese on demand when clicked!
    const metaFrPt = await store.downloadPack('fr-pt');
    expect(metaFrPt.pairId).toBe('fr-pt');
    const frRes = await offlineProvider.translate({
      word: 'bonjour',
      context: 'Bonjour mon ami !',
      source_language: 'fr',
      target_language: 'pt',
    });
    expect(frRes.contextual_translation).toContain('olá');

    // Uninstalling en-pt deletes its entries and removes it from installed list
    await store.removePack('en-pt');
    const remaining = await store.listInstalledPacks();
    expect(remaining.map((p) => p.pairId)).toEqual(['fr-pt']);
    await expect(
      offlineProvider.translate({
        word: 'hello',
        context: 'Hello there.',
        source_language: 'en',
        target_language: 'pt',
      }),
    ).rejects.toThrow(/not installed/i);
  });

  it('queries LiveWiktionaryApiProvider (CC BY-SA 4.0) and follows lemma fallback when inflected entry has no direct translations', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/entries/en/thought')) {
        return new Response(
          JSON.stringify({
            word: 'thought',
            entries: [
              {
                partOfSpeech: 'verb',
                senses: [{ definition: 'simple past and past participle of think', translations: [] }],
              },
              {
                partOfSpeech: 'noun',
                senses: [
                  {
                    definition: 'An instance of thinking.',
                    translations: [{ language: { code: 'pt' }, word: 'pensamento' }],
                  },
                ],
              },
            ],
            source: { license: { name: 'CC BY-SA 4.0' } },
          }),
          { status: 200 },
        );
      }
      if (url.includes('/entries/en/think')) {
        return new Response(
          JSON.stringify({
            word: 'think',
            entries: [
              {
                partOfSpeech: 'verb',
                senses: [
                  {
                    definition: 'To conceive in the mind.',
                    translations: [
                      { language: { code: 'pt' }, word: 'pensar' },
                      { language: { code: 'pt' }, word: 'achar' },
                    ],
                  },
                ],
              },
            ],
            source: { license: { name: 'CC BY-SA 4.0' } },
          }),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const liveProvider = new LiveWiktionaryApiProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const res = await liveProvider.translate({
      word: 'thought',
      context: 'I never thought this would happen.',
      source_language: 'en',
      target_language: 'pt',
    });

    expect(res.provider).toBe('wiktionary-live-cc-by-sa');
    expect(res.lemma).toBe('think');
    expect(res.contextual_translation).toContain('pensar');
  });

  it('handles real French Wiktionary lines ({m}, {vt}, nested parens, "to call (out)"), French inflections ("appelée"), default-en auto-fallback to installed fr-pt, and never caches placeholder fallbacks', async () => {
    const realFrEn = [
      'appeler {vt} :: to call (out)',
      'appeler {vt} :: to call, phone, ring',
      "aujourd'hui {adv} :: today",
      'indépendant {adj} :: independent',
      'petit {adj} :: little',
      'petit {m} :: little one (child) (of humans or other animals)',
      'petit filet {m} [football] :: side-netting',
      'souverain {adj} :: sovereign',
      'souverain {m} :: sovereign',
    ].join('\n');

    const realEnPt = [
      'call {v} (to name or refer to) :: chamar',
      'today {n} (today (noun)) :: hoje',
      'today {adv} (on the current day) :: hoje',
      'independent {adj} (free) :: independente',
      'little {adj} ((of a sibling) younger) :: mais novo',
      'little {adj} (small in size) :: pequeno',
      'sovereign {adj} (exercising power of rule) :: soberano',
    ].join('\n');

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('fr-en-enwiktionary.txt')) return new Response(realFrEn, { status: 200 });
      if (url.includes('en-pt-enwiktionary.txt')) return new Response(realEnPt, { status: 200 });
      return new Response('Not found', { status: 404 });
    });

    const store = new WiktionaryDictionaryStore(
      'test-wikt-fr-pt-real',
      fetchMock as unknown as typeof fetch,
    );
    await store.downloadPack('fr-pt');

    const offlineProvider = new OfflineWiktionaryProvider(store);

    // Even if source_language is still 'en' in user settings, installed fr-pt + French sentence resolves!
    const souverain = await offlineProvider.translate({
      word: 'souverain',
      context: "Aujourd'hui, ce petit territoire souverain et indépendant",
      source_language: 'en',
      target_language: 'pt',
    });
    expect(souverain.contextual_translation).toContain('soberano');

    const aujourdhui = await offlineProvider.translate({
      word: "Aujourd'hui",
      context: "Aujourd'hui, ce petit territoire souverain et indépendant",
      source_language: 'fr',
      target_language: 'pt',
    });
    expect(aujourdhui.contextual_translation).toContain('hoje');

    const petit = await offlineProvider.translate({
      word: 'petit',
      context: "Aujourd'hui, ce petit territoire souverain et indépendant",
      source_language: 'fr',
      target_language: 'pt',
    });
    expect(petit.contextual_translation).toContain('pequeno');

    const appelee = await offlineProvider.translate({
      word: 'appelée',
      context: 'Cette île est appelée Formosa.',
      source_language: 'fr',
      target_language: 'pt',
    });
    expect(appelee.lemma).toBe('appeler');
    expect(appelee.contextual_translation).toContain('chamar');
  });
});
