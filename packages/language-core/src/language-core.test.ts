import { describe, expect, it } from 'vitest';
import {
  createTypeScriptTextProcessor,
  tokenizeSubtitle,
  normalizeToken,
  lemmatizeInContext,
  detectPhrasesInTokens,
  extractSentenceForToken,
  detectSubtitleLanguage,
} from './index';

describe('@lexistream/language-core', () => {
  it('tokenizes subtitles losslessly while preserving punctuation, whitespace, contractions, and Unicode', () => {
    const input = `Wait—don't "give up", ¿dónde está l'amour? <script>alert(1)</script>`;
    const tokens = tokenizeSubtitle(input, 'en');

    // Lossless reconstruction invariant
    expect(tokens.map((t) => t.text).join('')).toBe(input);

    const words = tokens.filter((t) => t.isWord).map((t) => t.text);
    expect(words).toEqual([
      'Wait',
      "don't",
      'give',
      'up',
      'dónde',
      'está',
      "l'amour",
      'script',
      'alert',
      '1',
      'script',
    ]);
  });

  it('normalizes tokens consistently across case and Unicode NFC', () => {
    expect(normalizeToken('  "Thought!" ', 'en')).toBe('thought');
    // Decomposed 'e' + combining acute accent -> NFC 'é'
    expect(normalizeToken('Cafe\u0301', 'fr')).toBe('café');
  });

  it('disambiguates polysemous lemma and part-of-speech from sentence context ("thought" verb vs noun)', () => {
    const verbUse = lemmatizeInContext(
      'thought',
      'I never thought this would happen.',
      'en',
    );
    expect(verbUse.lemma).toBe('think');
    expect(verbUse.partOfSpeech).toBe('verb');

    const nounUse = lemmatizeInContext(
      'thought',
      'That was a fascinating thought about linguistics.',
      'en',
    );
    expect(nounUse.lemma).toBe('thought');
    expect(nounUse.partOfSpeech).toBe('noun');
  });

  it('lemmatizes regular and irregular English inflections accurately', () => {
    expect(lemmatizeInContext('running', 'She is running fast.', 'en')).toMatchObject({
      lemma: 'run',
      partOfSpeech: 'verb',
    });
    expect(lemmatizeInContext('studied', 'He studied every evening.', 'en')).toMatchObject({
      lemma: 'study',
      partOfSpeech: 'verb',
    });
    expect(lemmatizeInContext('children', 'The children laughed.', 'en')).toMatchObject({
      lemma: 'child',
      partOfSpeech: 'noun',
    });
    expect(lemmatizeInContext('quickly', 'They adapted quickly.', 'en')).toMatchObject({
      lemma: 'quick',
      partOfSpeech: 'adverb',
    });
  });

  it('detects phrasal verbs and multiword expressions including separated particles', () => {
    const tokens = tokenizeSubtitle('Never give up when you look it up in context.', 'en');
    const annotated = detectPhrasesInTokens(tokens, 'en');

    const giveToken = annotated.find((t) => t.normalized === 'give');
    const upToken1 = annotated.find((t, idx) => t.normalized === 'up' && idx < 6);
    expect(giveToken?.detectedPhrase).toBe('give up');
    expect(upToken1?.detectedPhrase).toBe('give up');

    const lookToken = annotated.find((t) => t.normalized === 'look');
    expect(lookToken?.detectedPhrase).toBe('look up');
  });

  it('extracts the exact sentence containing a target token from multi-sentence cues', () => {
    const cue = 'First sentence here! I never thought this would happen. Maybe tomorrow?';
    const tokens = tokenizeSubtitle(cue, 'en');
    const thoughtToken = tokens.find((t) => t.normalized === 'thought')!;
    expect(extractSentenceForToken(cue, thoughtToken)).toBe(
      'I never thought this would happen.',
    );
  });

  it('exposes the swappable TextProcessor interface for benchmarking and WASM replacement', () => {
    const processor = createTypeScriptTextProcessor();
    const res = processor.analyzeWord('gave', 'She gave up smoking last year.', 'en');
    expect(res.lemma).toBe('give up');
    expect(res.partOfSpeech).toBe('phrase');
  });

  it('lemmatizes French inflections ("appelée" -> "appeler", elisions "l\'état" -> "état") and auto-detects French subtitle language', () => {
    expect(
      detectSubtitleLanguage("Aujourd'hui, ce petit territoire souverain et indépendant"),
    ).toBe('fr');

    const appelee = lemmatizeInContext(
      'appelée',
      'Cette île est appelée Formosa.',
      'fr',
    );
    expect(appelee.lemma).toBe('appeler');
    expect(appelee.partOfSpeech).toBe('verb');

    const elided = lemmatizeInContext(
      "l'indépendance",
      "C'est l'indépendance du pays.",
      'fr',
    );
    expect(elided.lemma).toBe('indépendance');

    const aujourdhui = lemmatizeInContext(
      "Aujourd'hui",
      "Aujourd'hui, ce petit territoire souverain et indépendant",
      'fr',
    );
    expect(aujourdhui.lemma).toBe("aujourd'hui");
  });
});
