import { describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { App } from './App';
import { VocabularyRepository } from '@lexistream/vocabulary-engine';
import { WiktionaryDictionaryStore } from '@lexistream/translation-providers';

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('@lexistream/web App', () => {
  it('can correct an existing flashcard answer without resetting its schedule or context', async () => {
    const repo = new VocabularyRepository('test-webapp-manual-translation');
    const { item } = await repo.captureVocabulary({
      surface_form: 'banc',
      lemma: 'banc',
      language: 'fr',
      target_language: 'pt',
      translation: 'assento',
      definition: 'A seat for more than one person.',
      part_of_speech: 'noun',
      context: 'Nous sommes assis sur le banc.',
      context_translation: '',
      video_id: 'study-clip',
      video_title: 'Study Clip',
      video_url: 'https://www.youtube.com/watch?v=study-clip',
      timestamp: 15,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const button = (text: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (el) => el.textContent?.trim() === text,
      );
    render(<App repo={repo} />, container);

    try {
      container.querySelector<HTMLButtonElement>('[data-testid="nav-flashcards"]')!.click();
      const reveal = () => container.querySelector<HTMLButtonElement>('[data-testid="reveal-answer-btn"]');
      await vi.waitFor(() => expect(reveal()).not.toBeNull());
      reveal()!.click();
      const cardBefore = await repo.getFlashcardByVocabularyId(item.id);
      expect(cardBefore).toBeDefined();
      await vi.waitFor(() => expect(button('Edit translation')).toBeTruthy());
      button('Edit translation')!.click();

      const editor = () => container.querySelector<HTMLInputElement>('form input');
      await vi.waitFor(() => expect(editor()?.value).toBe('assento'));
      editor()!.value = '  ';
      editor()!.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.waitFor(() => expect(button('Save translation')?.disabled).toBe(true));
      button('Cancel')!.click();
      await vi.waitFor(() => expect(editor()).toBeNull());
      expect((await repo.getVocabularyById(item.id))?.primary_translation).toBe('assento');

      button('Edit translation')!.click();
      await vi.waitFor(() => expect(editor()?.value).toBe('assento'));
      editor()!.value = '  banco de praça  ';
      editor()!.dispatchEvent(new Event('input', { bubbles: true }));
      editor()!.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await vi.waitFor(() => expect(container.textContent).toContain('banco de praça'));
      const saved = await repo.getVocabularyById(item.id);
      expect(saved?.primary_translation).toBe('banco de praça');
      expect(saved?.occurrences).toEqual(item.occurrences);
      expect(await repo.getFlashcardByVocabularyId(item.id)).toEqual(cardBefore);
      expect(await repo.getAllReviewLogs()).toHaveLength(0);
    } finally {
      render(null, container);
      container.remove();
    }
  });

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
    await waitForCondition(
      () =>
        container.querySelector('[data-testid="installed-dicts-count"]')
          ?.textContent === '1',
    );

    expect(
      container.querySelector('[data-testid="installed-dicts-count"]')?.textContent,
    ).toBe('1');
    expect(container.textContent).toContain('Installed');

    // Click Remove on en-pt -> frees storage back to 0
    const rmBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="remove-dict-en-pt"]',
    )!;
    expect(rmBtn).toBeTruthy();
    rmBtn.click();
    await waitForCondition(
      () =>
        container.querySelector('[data-testid="installed-dicts-count"]')
          ?.textContent === '0',
    );

    expect(
      container.querySelector('[data-testid="installed-dicts-count"]')?.textContent,
    ).toBe('0');

    render(null, container);
    container.remove();
  });

  it('automatically updates Vocabulary count and list in real time without page reload when a new word is captured externally', async () => {
    const dbName = 'test-webapp-live-reactive-db';
    const dashboardRepo = new VocabularyRepository(dbName);
    const youtubeTabRepo = new VocabularyRepository(dbName);

    const container = document.createElement('div');
    document.body.appendChild(container);
    render(<App repo={dashboardRepo} />, container);
    await new Promise((r) => setTimeout(r, 40));

    // Switch to Vocabulary tab -> starts with 0 words
    container.querySelector<HTMLButtonElement>('[data-testid="nav-vocabulary"]')!.click();
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toContain('Vocabulary Library (0)');

    // Capture a word from another repository instance (simulating clicking a subtitle word on YouTube!)
    await youtubeTabRepo.captureVocabulary({
      surface_form: 'souverain',
      lemma: 'souverain',
      language: 'fr',
      target_language: 'pt',
      translation: 'soberano',
      definition: 'Exercising power of rule.',
      part_of_speech: 'adjective',
      context: "Aujourd'hui, ce petit territoire souverain et indépendant",
      context_translation: '',
      video_id: 'taiwan_doc',
      video_title: 'TAÏWAN : la démocratie numérique',
      video_url: 'https://www.youtube.com/watch?v=taiwan_doc',
      timestamp: 69,
    });

    // Without reloading or clicking anything, Dashboard updates automatically!
    await new Promise((r) => setTimeout(r, 80));
    expect(container.textContent).toContain('Vocabulary Library (1)');
    expect(container.textContent).toContain('soberano');

    render(null, container);
    container.remove();
  });
});
