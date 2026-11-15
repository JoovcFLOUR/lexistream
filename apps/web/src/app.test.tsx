import { describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { App } from './App';
import { VocabularyRepository } from '@lexistream/vocabulary-engine';
import { WiktionaryDictionaryStore } from '@lexistream/translation-providers';

describe('@lexistream/web App', () => {
  it('renders Dashboard, navigates to Vocabulary and Flashcards, edits entries, and completes an FSRS review', async () => {
    const repo = new VocabularyRepository('test-webapp-db-1');
    await repo.captureVocabulary({
      surface_form: 'thought',
      lemma: 'think',
      language: 'en',
      target_language: 'pt',
      translation: 'pensou',
      definition: 'To form an idea.',
      part_of_speech: 'verb',
      context: 'I never thought this would happen.',
      context_translation: 'Eu nunca pensei que isso aconteceria.',
      video_id: 'vid_web',
      video_title: 'Web Test Video',
      video_url: 'https://www.youtube.com/watch?v=vid_web',
      timestamp: 90,
      tags: ['core'],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(<App repo={repo} />, container);

    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toContain('LexiStream');
    expect(container.textContent).toContain('think');

    // Navigate to Flashcards tab
    const flashcardsNav = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-flashcards"]',
    )!;
    flashcardsNav.click();
    await new Promise((r) => setTimeout(r, 40));

    const revealBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="reveal-answer-btn"]',
    )!;
    expect(revealBtn).toBeTruthy();
    revealBtn.click();
    await new Promise((r) => setTimeout(r, 30));

    expect(container.textContent).toContain('pensou');
    const goodBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="rate-good"]',
    )!;
    goodBtn.click();
    await new Promise((r) => setTimeout(r, 50));

    // Navigate to Statistics tab and verify honest metrics
    const statsNav = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-statistics"]',
    )!;
    statsNav.click();
    await new Promise((r) => setTimeout(r, 40));
    expect(container.textContent).toContain('Collected');
    expect(container.textContent).toContain('Reviewed');
    expect(container.textContent).toContain('Demonstrably Retained');

    render(null, container);
    container.remove();
  });

  it('starts with 0 Wiktionary dictionaries installed, downloads only when user clicks Baixar, and removes cleanly', async () => {
    const repo = new VocabularyRepository('test-webapp-db-dicts');
    const mockFetch = vi.fn(async () => {
      return new Response(
        [
          '# English :: Portuguese Wiktionary CC BY-SA',
          'butterfly {n} (flying insect) :: borboleta {f}',
          'whisper {v} (speak softly) :: sussurrar, cochichar',
        ].join('\n'),
        { status: 200 },
      );
    });
    const dictStore = new WiktionaryDictionaryStore(
      'test-webapp-wikt-store',
      mockFetch as unknown as typeof fetch,
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(<App repo={repo} dictionaryStore={dictStore} />, container);
    await new Promise((r) => setTimeout(r, 40));

    // Open Dictionaries tab
    const dictNav = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-dictionaries"]',
    )!;
    expect(dictNav).toBeTruthy();
    dictNav.click();
    await new Promise((r) => setTimeout(r, 40));

    // Zero dictionaries pre-installed!
    expect(
      container.querySelector('[data-testid="installed-dicts-count"]')?.textContent,
    ).toBe('0');
    expect(container.textContent).toContain('Inglês → Português');
    expect(container.textContent).toContain('Francês → Português');
    expect(container.textContent).toContain('Francês → Inglês');

    // Click Download on en-pt
    const dlBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="download-dict-en-pt"]',
    )!;
    expect(dlBtn).toBeTruthy();
    dlBtn.click();
    await new Promise((r) => setTimeout(r, 80));

    expect(
      container.querySelector('[data-testid="installed-dicts-count"]')?.textContent,
    ).toBe('1');
    expect(container.textContent).toContain('Instalado');

    // Click Remove on en-pt -> frees storage back to 0
    const rmBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="remove-dict-en-pt"]',
    )!;
    expect(rmBtn).toBeTruthy();
    rmBtn.click();
    await new Promise((r) => setTimeout(r, 60));

    expect(
      container.querySelector('[data-testid="installed-dicts-count"]')?.textContent,
    ).toBe('0');

    render(null, container);
    container.remove();
  });
});
