import { useState } from 'preact/hooks';
import {
  OfflineWiktionaryProvider,
  WIKTIONARY_DICTIONARY_CATALOG,
  type DictionaryDownloadProgress,
  type InstalledDictionaryPack,
  type WiktionaryDictionaryStore,
} from '@lexistream/translation-providers';
import type { TranslationResult } from '@lexistream/shared-types';

export interface DictionariesPageProps {
  dictionaryStore: WiktionaryDictionaryStore;
  installedPacks: InstalledDictionaryPack[];
  onChanged: () => Promise<void>;
}

export function DictionariesPage({
  dictionaryStore,
  installedPacks,
  onChanged,
}: DictionariesPageProps) {
  const [filterText, setFilterText] = useState('');
  const [progressByPair, setProgressByPair] = useState<
    Record<string, DictionaryDownloadProgress | undefined>
  >({});
  const [removingByPair, setRemovingByPair] = useState<Record<string, boolean>>({});
  const [errorBanner, setErrorBanner] = useState('');

  // Quick offline tester state
  const [testPairId, setTestPairId] = useState('');
  const [testWord, setTestWord] = useState('');
  const [testResult, setTestResult] = useState<TranslationResult | null>(null);
  const [testError, setTestError] = useState('');

  const installedByPair = new Map(installedPacks.map((p) => [p.pairId, p]));
  const totalEntries = installedPacks.reduce((acc, p) => acc + p.entryCount, 0);
  const totalMb = (
    installedPacks.reduce((acc, p) => acc + p.byteSize, 0) /
    (1024 * 1024)
  ).toFixed(1);

  const handleDownload = async (pairId: string) => {
    setErrorBanner('');
    try {
      await dictionaryStore.downloadPack(pairId, (prog) => {
        setProgressByPair((prev) => ({ ...prev, [pairId]: prog }));
      });
      await onChanged();
    } catch (err) {
      setErrorBanner(
        `Falha ao baixar ${pairId}: ${err instanceof Error ? err.message : 'Erro de rede'}`,
      );
    } finally {
      setProgressByPair((prev) => {
        const next = { ...prev };
        delete next[pairId];
        return next;
      });
    }
  };

  const handleRemove = async (pairId: string) => {
    setErrorBanner('');
    setRemovingByPair((prev) => ({ ...prev, [pairId]: true }));
    try {
      await dictionaryStore.removePack(pairId);
      if (testPairId === pairId) {
        setTestResult(null);
      }
      await onChanged();
    } finally {
      setRemovingByPair((prev) => {
        const next = { ...prev };
        delete next[pairId];
        return next;
      });
    }
  };

  const handleQuickLookup = async () => {
    setTestError('');
    setTestResult(null);
    const activePair = testPairId || installedPacks[0]?.pairId;
    if (!activePair || !testWord.trim()) return;
    const [src, tgt] = activePair.split('-');
    if (!src || !tgt) return;

    try {
      const provider = new OfflineWiktionaryProvider(dictionaryStore);
      const res = await provider.translate({
        word: testWord.trim(),
        context: testWord.trim(),
        source_language: src,
        target_language: tgt,
      });
      setTestResult(res);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Palavra não encontrada');
    }
  };

  const visibleCatalog = WIKTIONARY_DICTIONARY_CATALOG.filter((entry) => {
    if (!filterText.trim()) return true;
    const q = filterText.trim().toLowerCase();
    return (
      entry.title.toLowerCase().includes(q) ||
      entry.pairId.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <section class="kpi-grid" aria-label="Offline dictionaries summary">
        <div class="kpi-card">
          <div class="kpi-value" data-testid="installed-dicts-count">
            {installedPacks.length}
          </div>
          <div class="kpi-label">Dicionários Instalados</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">{totalEntries.toLocaleString()}</div>
          <div class="kpi-label">Verbetes Offline (Wiktionary)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">{totalMb} MB</div>
          <div class="kpi-label">Espaço Local Usado</div>
        </div>
      </section>

      <section class="panel">
        <h2>Dicionários Offline Sob Demanda — Wiktionary (Creative Commons)</h2>
        <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: 0 }}>
          Nenhum dicionário pesado vem pré-instalado para economizar memória e disco. Escolha
          apenas os pares de idiomas que você realmente estuda e clique em{' '}
          <strong>Baixar Dicionário</strong>. Os dados vêm do{' '}
          <a
            href="https://www.wiktionary.org/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            Wiktionary
          </a>{' '}
          sob licença livre{' '}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            CC BY-SA
          </a>{' '}
          e funcionam 100% offline nas legendas do YouTube após instalados.
        </p>

        {errorBanner && (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(248, 113, 113, 0.14)',
              border: '1px solid var(--danger)',
              color: '#fecaca',
              marginBottom: '12px',
              fontSize: '13px',
            }}
          >
            {errorBanner}
          </div>
        )}

        <div style={{ marginBottom: '16px', maxWidth: '420px' }}>
          <input
            type="search"
            aria-label="Filtrar dicionários disponíveis"
            placeholder="Filtrar idioma (ex: Inglês, Francês, Português, fr-pt)…"
            value={filterText}
            onInput={(e) => setFilterText((e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="vocab-list">
          {visibleCatalog.map((item) => {
            const installed = installedByPair.get(item.pairId);
            const activeProgress = progressByPair[item.pairId];

            return (
              <article
                key={item.pairId}
                class="vocab-item"
                data-testid={`dict-card-${item.pairId}`}
              >
                <div class="vocab-head">
                  <div>
                    <span class="badge">{item.pairId.toUpperCase()}</span>
                    <strong style={{ fontSize: '16px', marginRight: '8px' }}>
                      {item.title}
                    </strong>
                    {installed && (
                      <span
                        class="badge"
                        style={{
                          background: 'rgba(52, 211, 153, 0.18)',
                          color: 'var(--success)',
                        }}
                      >
                        ✓ Instalado ({installed.entryCount.toLocaleString()} verbetes)
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {installed ? (
                      <button
                        type="button"
                        class="btn btn-danger"
                        data-testid={`remove-dict-${item.pairId}`}
                        disabled={Boolean(activeProgress) || Boolean(removingByPair[item.pairId])}
                        onClick={() => void handleRemove(item.pairId)}
                      >
                        {removingByPair[item.pairId] ? 'Removing…' : 'Remove'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        class="btn btn-primary"
                        data-testid={`download-dict-${item.pairId}`}
                        disabled={Boolean(activeProgress)}
                        onClick={() => void handleDownload(item.pairId)}
                      >
                        {activeProgress
                          ? `${activeProgress.percent}%…`
                          : `⬇ Download (~${item.estimatedSizeMb} MB)`}
                      </button>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: '6px',
                    fontSize: '12.5px',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    gap: '14px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>
                    ~{item.estimatedEntries.toLocaleString()} entradas · ~{item.estimatedSizeMb}{' '}
                    MB download
                  </span>
                  <span>Licença: {item.license}</span>
                </div>

                {activeProgress && (
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--accent)' }}>
                      {activeProgress.detail}
                    </div>
                    <div class="progress-track">
                      <div
                        class="progress-fill"
                        style={{ width: `${activeProgress.percent}%` }}
                      />
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {installedPacks.length > 0 && (
        <section class="panel" aria-label="Test installed offline dictionary">
          <h2>Testar Consulta Offline Instantânea</h2>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <select
              style={{ maxWidth: '340px', minWidth: '260px' }}
              value={testPairId || installedPacks[0]?.pairId || ''}
              onChange={(e) => setTestPairId((e.target as HTMLSelectElement).value)}
            >
              {installedPacks.map((p) => (
                <option key={p.pairId} value={p.pairId}>
                  {p.pairId.toUpperCase()} — {p.title}
                </option>
              ))}
            </select>
            <input
              style={{ maxWidth: '260px' }}
              placeholder="Digite uma palavra (ex: butterfly, bonjour)…"
              value={testWord}
              onInput={(e) => setTestWord((e.target as HTMLInputElement).value)}
            />
            <button
              type="button"
              class="btn btn-primary"
              onClick={() => void handleQuickLookup()}
            >
              Consultar Offline
            </button>
          </div>

          {testError && (
            <p style={{ color: 'var(--warning)', fontSize: '13px', marginTop: '10px' }}>
              {testError}
            </p>
          )}
          {testResult && (
            <div
              class="vocab-item"
              style={{ marginTop: '12px' }}
              data-testid="offline-test-result"
            >
              <strong>{testResult.lemma}</strong>{' '}
              <span class="badge">{testResult.part_of_speech}</span> →{' '}
              <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
                {testResult.contextual_translation}
              </span>
              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {testResult.definition}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
