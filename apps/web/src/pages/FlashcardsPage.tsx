import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  PENDING_TRANSLATION,
  buildYouTubeTimestampUrl,
  type ReviewRating,
} from '@lexistream/shared-types';
import type { FlashcardService, StudyCardItem } from '@lexistream/flashcard-engine';
import type { VocabularyRepository } from '@lexistream/vocabulary-engine';

export interface FlashcardsPageProps {
  flashcardService: FlashcardService;
  repo: VocabularyRepository;
  onReviewCompleted: () => Promise<void>;
}

export function FlashcardsPage({
  flashcardService,
  repo,
  onReviewCompleted,
}: FlashcardsPageProps) {
  const [queue, setQueue] = useState<StudyCardItem[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [shownAt, setShownAt] = useState<number>(Date.now());
  const [translationDraft, setTranslationDraft] = useState<string | null>(null);
  const [savingTranslation, setSavingTranslation] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const translationInput = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreEditorFocus = useRef(false);

  const loadQueue = async () => {
    const due = await flashcardService.getDueStudyQueue();
    setQueue(due);
    setRevealed(false);
    setShownAt(Date.now());
  };

  useEffect(() => {
    void loadQueue();
  }, []);

  const current = queue[0];
  const editingTranslation = translationDraft !== null;
  const needsTranslation = current?.vocabulary.primary_translation === PENDING_TRANSLATION;
  const canRate = revealed && !editingTranslation;

  useLayoutEffect(() => {
    if (editingTranslation) {
      translationInput.current?.focus();
    } else if (restoreEditorFocus.current) {
      restoreEditorFocus.current = false;
      editButton.current?.focus();
    }
  }, [editingTranslation]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!current || editingTranslation || e.defaultPrevented || e.isComposing) return;
      if (e.code === 'Space' && !revealed) {
        e.preventDefault();
        setRevealed(true);
      } else if (canRate) {
        const ratingByKey: Record<string, ReviewRating> = {
          Digit1: 'again',
          Digit2: 'hard',
          Digit3: 'good',
          Digit4: 'easy',
        };
        const r = ratingByKey[e.code];
        if (r) {
          e.preventDefault();
          void handleRate(r);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current, revealed, canRate, editingTranslation]);

  const speakWord = (text: string, lang: string) => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang;
      window.speechSynthesis.speak(utter);
    }
  };

  const handleRate = async (rating: ReviewRating) => {
    if (!current || !canRate) return;
    const duration = Date.now() - shownAt;
    await flashcardService.submitReview(current.vocabulary.id, rating, duration);
    await onReviewCompleted();
    await loadQueue();
  };

  const closeTranslationEditor = () => {
    restoreEditorFocus.current = true;
    setTranslationError('');
    setTranslationDraft(null);
  };

  const saveTranslation = async () => {
    const translation = translationInput.current?.value.trim();
    if (!current || !translation || savingTranslation) return;

    setSavingTranslation(true);
    setTranslationError('');
    try {
      const updated = await repo.updateVocabulary(current.vocabulary.id, {
        primary_translation: translation,
      });
      setQueue((items) =>
        items.map((item) =>
          item.vocabulary.id === updated.id ? { ...item, vocabulary: updated } : item,
        ),
      );
      closeTranslationEditor();
    } catch {
      setTranslationError('Could not save the translation. Please try again.');
    } finally {
      setSavingTranslation(false);
    }
  };

  if (!current) {
    return (
      <section class="flashcard-stage" data-testid="flashcards-empty">
        <h2>All Caught Up!</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          No flashcards are currently due according to your FSRS schedule.
        </p>
      </section>
    );
  }

  const { vocabulary, card } = current;
  const occ = vocabulary.occurrences[vocabulary.occurrences.length - 1];
  const intervals = canRate ? flashcardService.previewIntervals(card) : null;

  return (
    <section class="flashcard-stage" aria-label="Flashcard review">
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
        {queue.length} {queue.length === 1 ? 'card' : 'cards'} remaining in session
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}>
        <h2 style={{ fontSize: '30px', margin: 0 }}>{vocabulary.lemma}</h2>
        <button
          type="button"
          class="btn"
          aria-label="Listen to pronunciation"
          onClick={() => speakWord(vocabulary.lemma, vocabulary.language)}
        >
          🔊 Audio
        </button>
      </div>

      <div style={{ marginTop: '6px' }}>
        <span class="badge">{vocabulary.part_of_speech}</span>
        <span class="badge">{vocabulary.language.toUpperCase()}</span>
      </div>

      {occ && (
        <blockquote
          style={{
            margin: '18px 0',
            padding: '12px 16px',
            background: 'var(--bg-primary)',
            borderRadius: '8px',
            fontStyle: 'italic',
            color: 'var(--text-secondary)',
          }}
        >
          “{occ.context}”
        </blockquote>
      )}

      {!revealed ? (
        <button
          type="button"
          class="btn btn-primary"
          data-testid="reveal-answer-btn"
          style={{ marginTop: '12px', width: '100%', padding: '12px' }}
          onClick={() => setRevealed(true)}
        >
          Show Answer (Space)
        </button>
      ) : (
        <div style={{ marginTop: '16px', textAlign: 'left' }}>
          <div
            style={{
              padding: '14px',
              background: 'var(--bg-primary)',
              borderRadius: '10px',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {editingTranslation ? (
              <form
                class="flashcard-translation-editor"
                aria-busy={savingTranslation}
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveTranslation();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !savingTranslation) {
                    event.preventDefault();
                    closeTranslationEditor();
                  }
                }}
              >
                <label htmlFor="flashcard-translation">
                  Your translation ({vocabulary.target_language.toUpperCase()})
                </label>
                <input
                  ref={translationInput}
                  id="flashcard-translation"
                  lang={vocabulary.target_language}
                  value={translationDraft ?? ''}
                  onInput={(event) => setTranslationDraft(event.currentTarget.value)}
                  aria-describedby={translationError ? 'flashcard-translation-error' : undefined}
                  readOnly={savingTranslation}
                  required
                />
                <div class="flashcard-translation-actions">
                  <button
                    type="submit"
                    class="btn btn-primary"
                    disabled={savingTranslation || !translationDraft?.trim()}
                  >
                    {savingTranslation ? 'Saving…' : 'Save translation'}
                  </button>
                  <button
                    type="button"
                    class="btn"
                    onClick={closeTranslationEditor}
                    disabled={savingTranslation}
                  >
                    Cancel
                  </button>
                </div>
                {translationError && (
                  <div id="flashcard-translation-error" role="alert" style={{ color: 'var(--danger)' }}>
                    {translationError}
                  </div>
                )}
              </form>
            ) : (
              <div class="flashcard-translation-actions">
                <div class="flashcard-translation" role="status">
                  {needsTranslation ? 'No translation yet' : vocabulary.primary_translation}
                </div>
                <button
                  ref={editButton}
                  type="button"
                  class="btn"
                  onClick={() => setTranslationDraft(needsTranslation ? '' : vocabulary.primary_translation)}
                >
                  {needsTranslation ? 'Add translation' : 'Edit translation'}
                </button>
              </div>
            )}
            <div style={{ fontSize: '14px', marginTop: '4px' }}>
              {vocabulary.primary_definition}
            </div>
            {occ?.context_translation && (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>
                Translated context: “{occ.context_translation}”
              </div>
            )}
            {occ && (
              <div style={{ marginTop: '8px', fontSize: '12px' }}>
                <a
                  href={buildYouTubeTimestampUrl(
                    occ.video_url,
                    occ.video_id,
                    occ.timestamp,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent)' }}
                >
                  ▶ Watch source video ({occ.video_title} @ {Math.floor(occ.timestamp)}s)
                </a>
              </div>
            )}
          </div>

          {intervals && (
            <div class="rating-grid" role="group" aria-label="Evaluate recall">
              <button
                type="button"
                class="btn btn-danger"
                data-testid="rate-again"
                onClick={() => void handleRate('again')}
              >
                1 · Again ({intervals.again})
              </button>
              <button
                type="button"
                class="btn"
                data-testid="rate-hard"
                onClick={() => void handleRate('hard')}
              >
                2 · Hard ({intervals.hard})
              </button>
              <button
                type="button"
                class="btn btn-primary"
                data-testid="rate-good"
                onClick={() => void handleRate('good')}
              >
                3 · Good ({intervals.good})
              </button>
              <button
                type="button"
                class="btn"
                style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
                data-testid="rate-easy"
                onClick={() => void handleRate('easy')}
              >
                4 · Easy ({intervals.easy})
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
