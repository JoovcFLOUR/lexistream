import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import {
  UserSettingsSchema,
  type UserSettings,
  type VocabularyItem,
} from '@lexistream/shared-types';
import {
  VocabularyRepository,
  subscribeLexiStreamEvents,
} from '@lexistream/vocabulary-engine';
import {
  WiktionaryDictionaryStore,
  type InstalledDictionaryPack,
} from '@lexistream/translation-providers';
import {
  FlashcardService,
  type LearningStatistics,
} from '@lexistream/flashcard-engine';
import { DashboardPage } from './pages/DashboardPage';
import { VocabularyPage } from './pages/VocabularyPage';
import { FlashcardsPage } from './pages/FlashcardsPage';
import { DictionariesPage } from './pages/DictionariesPage';
import { StatisticsPage } from './pages/StatisticsPage';
import { SettingsPage } from './pages/SettingsPage';

type TabRoute =
  | 'dashboard'
  | 'vocabulary'
  | 'flashcards'
  | 'dictionaries'
  | 'statistics'
  | 'settings';

const EMPTY_STATS: LearningStatistics = {
  totalCollected: 0,
  totalReviewed: 0,
  totalRetained: 0,
  awaitingReviewCount: 0,
  dailyReviewsToday: 0,
  newWordsToday: 0,
  reviewAccuracy: 0,
  retentionRate: 0,
  currentStreakDays: 0,
  dailyHistory: [],
  mostReviewedWords: [],
  progressByLanguage: [],
};

export interface AppProps {
  repo?: VocabularyRepository;
  dictionaryStore?: WiktionaryDictionaryStore;
}

function initialTabFromHash(): TabRoute {
  if (typeof window !== 'undefined') {
    const h = window.location.hash.replace(/^#/, '');
    if (
      h === 'dictionaries' ||
      h === 'vocabulary' ||
      h === 'flashcards' ||
      h === 'statistics' ||
      h === 'settings'
    ) {
      return h;
    }
  }
  return 'dashboard';
}

export function App({ repo: injectedRepo, dictionaryStore: injectedDictStore }: AppProps) {
  const repo = useMemo(() => injectedRepo ?? new VocabularyRepository(), [injectedRepo]);
  const dictStore = useMemo(
    () => injectedDictStore ?? new WiktionaryDictionaryStore(),
    [injectedDictStore],
  );
  const flashcardService = useMemo(() => new FlashcardService(repo), [repo]);

  const [tab, setTab] = useState<TabRoute>(initialTabFromHash);
  const [items, setItems] = useState<VocabularyItem[]>([]);
  const [installedPacks, setInstalledPacks] = useState<InstalledDictionaryPack[]>([]);
  const [stats, setStats] = useState<LearningStatistics>(EMPTY_STATS);
  const [settings, setSettings] = useState<UserSettings>(() =>
    UserSettingsSchema.parse({}),
  );

  const refreshAll = useCallback(async () => {
    const [vocab, computedStats, cfg, packs] = await Promise.all([
      repo.queryVocabulary({}),
      flashcardService.computeStatistics(),
      repo.getSettings(),
      dictStore.listInstalledPacks(),
    ]);
    setItems(vocab);
    setStats(computedStats);
    setSettings(cfg);
    setInstalledPacks(packs);
  }, [repo, flashcardService, dictStore]);

  useEffect(() => {
    void refreshAll();

    const unsubscribeBus = subscribeLexiStreamEvents(() => {
      void refreshAll();
    });

    const onFocusOrVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void refreshAll();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    // Also listen to MV3 extension runtime broadcasts when running inside dashboard.html
    const extRuntime = (
      globalThis as unknown as {
        chrome?: {
          runtime?: {
            onMessage?: {
              addListener: (fn: (msg: unknown) => void) => void;
              removeListener: (fn: (msg: unknown) => void) => void;
            };
          };
        };
      }
    ).chrome?.runtime?.onMessage;

    const onExtMessage = (msg: unknown) => {
      const m = msg as { type?: string } | null;
      if (
        m?.type === 'LEXISTREAM_DB_UPDATED' ||
        m?.type === 'LEXISTREAM_CAPTURE' ||
        m?.type === 'LEXISTREAM_DICTIONARY_CHANGED'
      ) {
        void refreshAll();
      }
    };
    extRuntime?.addListener(onExtMessage);

    return () => {
      unsubscribeBus();
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      extRuntime?.removeListener(onExtMessage);
    };
  }, [refreshAll]);

  const seedSamples = async () => {
    await repo.captureVocabulary({
      surface_form: 'thought',
      lemma: 'think',
      language: 'en',
      target_language: 'pt',
      translation: 'pensei / pensou',
      definition: 'To form or hold an idea in the mind.',
      part_of_speech: 'verb',
      context: 'I never thought this would happen.',
      context_translation: 'Eu nunca pensei que isso aconteceria.',
      video_id: 'dQw4w9WgXcQ',
      video_title: 'How Context Shapes Meaning',
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      timestamp: 125.4,
      tags: ['starter', 'verbs'],
    });
    await repo.captureVocabulary({
      surface_form: 'give up',
      lemma: 'give up',
      language: 'en',
      target_language: 'pt',
      translation: 'desistir',
      definition: 'To stop trying; cease effort.',
      part_of_speech: 'phrase',
      context: 'Never give up when you look it up in context.',
      context_translation: 'Nunca desista quando você pesquisar no contexto.',
      video_id: 'dQw4w9WgXcQ',
      video_title: 'How Context Shapes Meaning',
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      timestamp: 240.5,
      tags: ['starter', 'phrasal-verbs'],
    });
    await refreshAll();
  };

  return (
    <div class="app-layout">
      <header class="topbar">
        <div class="brand">
          <h1>LexiStream</h1>
          <span>Local-First Contextual Language Acquisition</span>
        </div>

        <nav class="nav-tabs" aria-label="Primary navigation">
          {(
            [
              ['dashboard', 'Dashboard'],
              ['vocabulary', `Vocabulary (${items.length})`],
              ['flashcards', `Flashcards (${stats.awaitingReviewCount})`],
              ['dictionaries', `Dictionaries (${installedPacks.length})`],
              ['statistics', 'Statistics'],
              ['settings', 'Settings & Sync'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              class="nav-btn"
              data-testid={`nav-${id}`}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {tab === 'dashboard' && (
          <DashboardPage
            stats={stats}
            recentVocabulary={items}
            settings={settings}
            onStartReview={() => setTab('flashcards')}
            onSeedSample={seedSamples}
          />
        )}
        {tab === 'vocabulary' && (
          <VocabularyPage repo={repo} items={items} onRefresh={refreshAll} />
        )}
        {tab === 'flashcards' && (
          <FlashcardsPage
            flashcardService={flashcardService}
            onReviewCompleted={refreshAll}
          />
        )}
        {tab === 'dictionaries' && (
          <DictionariesPage
            dictionaryStore={dictStore}
            installedPacks={installedPacks}
            onChanged={refreshAll}
          />
        )}
        {tab === 'statistics' && <StatisticsPage stats={stats} />}
        {tab === 'settings' && (
          <SettingsPage repo={repo} settings={settings} onUpdated={refreshAll} />
        )}
      </main>
    </div>
  );
}
