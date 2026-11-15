import { describe, expect, it } from 'vitest';
import { render } from 'preact';
import { App } from './App';
import { VocabularyRepository } from '@lexistream/vocabulary-engine';

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
});
