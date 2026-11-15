import { useState } from 'preact/hooks';
import {
  buildYouTubeTimestampUrl,
  type LearningStatus,
  type PartOfSpeech,
  type VocabularyItem,
} from '@lexistream/shared-types';
import type { VocabularyRepository } from '@lexistream/vocabulary-engine';

export interface VocabularyPageProps {
  repo: VocabularyRepository;
  items: VocabularyItem[];
  onRefresh: () => Promise<void>;
}

export function VocabularyPage({ repo, items, onRefresh }: VocabularyPageProps) {
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('');
  const [pos, setPos] = useState('');
  const [status, setStatus] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTranslation, setEditTranslation] = useState('');
  const [editDefinition, setEditDefinition] = useState('');
  const [editCustomExample, setEditCustomExample] = useState('');
  const [editTags, setEditTags] = useState('');
  const [importBanner, setImportBanner] = useState('');

  const allLanguages = Array.from(new Set(items.map((i) => i.language)));
  const allTags = Array.from(new Set(items.flatMap((i) => i.tags)));

  const filtered = items.filter((item) => {
    if (language && item.language !== language) return false;
    if (pos && item.part_of_speech !== pos) return false;
    if (status && item.status !== status) return false;
    if (tagFilter && !item.tags.includes(tagFilter)) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = [
        item.lemma,
        ...item.surface_forms,
        item.primary_translation,
        item.primary_definition,
        ...item.occurrences.map((o) => o.context),
        ...item.tags,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const beginEdit = (item: VocabularyItem) => {
    setEditingId(item.id);
    setEditTranslation(item.primary_translation);
    setEditDefinition(item.primary_definition);
    setEditCustomExample(item.custom_examples.join('\n'));
    setEditTags(item.tags.join(', '));
  };

  const saveEdit = async (id: string) => {
    await repo.updateVocabulary(id, {
      primary_translation: editTranslation.trim(),
      primary_definition: editDefinition.trim(),
      custom_examples: editCustomExample
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      tags: editTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    setEditingId(null);
    await onRefresh();
  };

  const handleExport = async (kind: 'json' | 'csv') => {
    const content = kind === 'json' ? await repo.exportJson() : await repo.exportCsv();
    const blob = new Blob([content], {
      type: kind === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lexistream-vocabulary.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileImport = async (ev: Event) => {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const count = file.name.endsWith('.csv')
      ? await repo.importCsv(text)
      : await repo.importJson(text);
    setImportBanner(`Imported ${count} vocabulary entries.`);
    await onRefresh();
  };

  return (
    <section class="panel">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          marginBottom: '14px',
        }}
      >
        <h2>Vocabulary Library ({filtered.length})</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" class="btn" onClick={() => void handleExport('json')}>
            Export JSON
          </button>
          <button type="button" class="btn" onClick={() => void handleExport('csv')}>
            Export CSV
          </button>
          <label class="btn" style={{ cursor: 'pointer' }}>
            Import JSON/CSV
            <input
              type="file"
              accept=".json,.csv"
              style={{ display: 'none' }}
              onChange={(e) => void handleFileImport(e)}
            />
          </label>
        </div>
      </div>

      {importBanner && (
        <p role="status" style={{ color: 'var(--success)', fontSize: '13px' }}>
          {importBanner}
        </p>
      )}

      <div class="filters-row" role="search">
        <input
          type="search"
          aria-label="Search vocabulary"
          data-testid="vocab-search-input"
          placeholder="Search word, translation, context, tag…"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        />
        <select
          aria-label="Filter by language"
          value={language}
          onChange={(e) => setLanguage((e.target as HTMLSelectElement).value)}
        >
          <option value="">All Languages</option>
          {allLanguages.map((lang) => (
            <option key={lang} value={lang}>
              {lang.toUpperCase()}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by part of speech"
          value={pos}
          onChange={(e) => setPos((e.target as HTMLSelectElement).value as PartOfSpeech | '')}
        >
          <option value="">All Categories</option>
          <option value="noun">Noun</option>
          <option value="verb">Verb</option>
          <option value="adjective">Adjective</option>
          <option value="adverb">Adverb</option>
          <option value="phrase">Phrase</option>
          <option value="other">Other</option>
        </select>
        <select
          aria-label="Filter by learning status"
          value={status}
          onChange={(e) => setStatus((e.target as HTMLSelectElement).value as LearningStatus | '')}
        >
          <option value="">All Statuses</option>
          <option value="new">New</option>
          <option value="learning">Learning</option>
          <option value="review">Review</option>
          <option value="relearning">Relearning</option>
          <option value="mastered">Mastered</option>
        </select>
        <select
          aria-label="Filter by tag"
          value={tagFilter}
          onChange={(e) => setTagFilter((e.target as HTMLSelectElement).value)}
        >
          <option value="">All Tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
      </div>

      <div class="vocab-list">
        {filtered.map((item) => (
          <article key={item.id} class="vocab-item" data-testid="vocab-card">
            <div class="vocab-head">
              <div>
                <strong style={{ fontSize: '17px', marginRight: '8px' }}>{item.lemma}</strong>
                <span class="badge">{item.part_of_speech}</span>
                <span class="badge">{item.status}</span>
                {item.tags.map((t) => (
                  <span key={t} class="badge">
                    #{t}
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  class="btn"
                  data-testid={`edit-${item.lemma}`}
                  onClick={() => beginEdit(item)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  class="btn btn-danger"
                  onClick={async () => {
                    await repo.deleteVocabulary(item.id);
                    await onRefresh();
                  }}
                >
                  Remove
                </button>
              </div>
            </div>

            <div style={{ marginTop: '6px', color: 'var(--accent)', fontWeight: 600 }}>
              {item.primary_translation}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              {item.primary_definition}
            </div>

            {editingId === item.id && (
              <div
                style={{
                  marginTop: '12px',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--border-subtle)',
                  display: 'grid',
                  gap: '8px',
                }}
              >
                <label>
                  Translation
                  <input
                    value={editTranslation}
                    onInput={(e) => setEditTranslation((e.target as HTMLInputElement).value)}
                  />
                </label>
                <label>
                  Definition
                  <input
                    value={editDefinition}
                    onInput={(e) => setEditDefinition((e.target as HTMLInputElement).value)}
                  />
                </label>
                <label>
                  Custom Examples (one per line)
                  <textarea
                    rows={2}
                    value={editCustomExample}
                    onInput={(e) => setEditCustomExample((e.target as HTMLTextAreaElement).value)}
                  />
                </label>
                <label>
                  Tags (comma-separated)
                  <input
                    value={editTags}
                    onInput={(e) => setEditTags((e.target as HTMLInputElement).value)}
                  />
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    class="btn btn-primary"
                    onClick={() => void saveEdit(item.id)}
                  >
                    Save Changes
                  </button>
                  <button type="button" class="btn" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {item.occurrences.length > 0 && (
              <div style={{ marginTop: '8px', fontSize: '12.5px', color: 'var(--text-muted)' }}>
                {item.occurrences.map((occ) => (
                  <div key={occ.id} style={{ marginTop: '4px' }}>
                    “{occ.context}” —{' '}
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
                      {occ.video_title} @ {Math.floor(occ.timestamp)}s
                    </a>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
