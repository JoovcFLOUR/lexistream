# System Architecture

## 1. Architectural Overview

LexiStream is structured as a modular monorepo with strict boundary separation between **DOM/UI integration**, **linguistic & spaced-repetition engines**, **local-first persistence**, and **remote synchronization**.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        Browser Extension (MV3)                          │
│  YouTubeCaptionAdapter ──► InteractiveSubtitleController ──► ShadowDOM  │
│         (Scoped MO)          (DocumentFragment + 1-Listener)  Tooltip   │
└───────────────────┬─────────────────────────────────┬───────────────────┘
                    │                                 │
                    ▼                                 ▼
      ┌───────────────────────────┐     ┌───────────────────────────────┐
      │ @lexistream/language-core │     │@lexistream/translation-prov.  │
      │ Tokenizer · Lemmatizer    │     │ Memory LRU ──► IDB Cache ──►  │
      │ Contextual POS · Phrases  │     │ In-Flight Dedup ──► Providers │
      └─────────────┬─────────────┘     └──────────────┬────────────────┘
                    │                                  │
                    ▼                                  │ (Optional HTTP)
      ┌───────────────────────────┐                    │
      │@lexistream/vocabulary-eng.│                    │
      │ IndexedDB · CRDT Merge    │◄───────┐           │
      │ Outbox Queue · JSON/CSV   │        │           │
      └─────────────┬─────────────┘        │           │
                    │                      │           │
                    ▼                      │           ▼
      ┌───────────────────────────┐        │   ┌────────────────────────┐
      │@lexistream/flashcard-eng. │        ├──►│  apps/api (Rust/Axum)  │
      │ ts-fsrs · Honest Metrics  │        │   │  Auth · Delta Sync     │
      └─────────────┬─────────────┘        │   │  Translation Proxy     │
                    │                      │   └───────────┬────────────┘
                    ▼                      │               │
      ┌───────────────────────────┐        │               ▼
      │    apps/web (Preact)      │────────┘      ┌─────────────────┐
      │ Dashboard · Vocab · Study │               │  PostgreSQL 16  │
      └───────────────────────────┘               └─────────────────┘
```

## 2. Module Responsibilities

### `packages/shared-types`
- Authoritative Zod schemas and TypeScript types shared across the extension, web app, and Rust API JSON contract.
- Enforces input validation at every trust boundary.

### `packages/language-core`
- Defines the swappable `TextProcessor` interface (`tokenize`, `normalize`, `analyzeWord`).
- Implements lossless single-pass Unicode subtitle tokenization (`tokens.map(t => t.text).join('') === rawCue`), case/NFC normalization, contextual noun-vs-verb disambiguation (e.g., `"I never thought"` → verb `think` vs `"a fascinating thought"` → noun `thought`), and separable phrasal-verb detection (`"look it up"` → `look up`).

### `packages/translation-providers`
- Decouples UI code from translation/dictionary backends via `TranslationProvider`.
- Implements:
  1. **Tier-1 `BoundedLruCache`** ($O(1)$ JS `Map` insertion-order eviction).
  2. **Tier-2 `IndexedDbTranslationCache`** (survives tab closes and offline sessions).
  3. **In-flight request deduplication** (`Map<cacheKey, Promise>`).
  4. **`AbortSignal` propagation** so outdated hover requests cancel immediately.
  5. **Fallback chain**: `BackendProxyTranslationProvider` → `ContextualLexicalProvider`.

### `packages/vocabulary-engine`
- Owns local IndexedDB persistence (`vocabulary`, `flashcards`, `review_logs`, `sync_outbox`, `settings`).
- Deduplicates entries by `language::lemma::part_of_speech` while preserving distinct grammatical senses and aggregating multiple video `ContextOccurrence` records (`video_id`, `video_title`, `video_url`, `timestamp`, `context`, `context_translation`).
- Provides RFC-4180 CSV & JSON import/export and deterministic delta synchronization.

### `packages/flashcard-engine`
- Integrates `ts-fsrs` for scientifically grounded spaced repetition (`Again`, `Hard`, `Good`, `Easy`).
- Persists full FSRS `Card` state (`stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`, `state`, `due`) and immutable `ReviewLogRecord` entries.
- Computes non-misleading statistics separating **Collected**, **Reviewed**, and **Demonstrably Retained** (`State.Review` with `stability >= 7` days).

### `apps/extension`
- Built with WXT targeting Chrome Manifest V3.
- `YouTubeCaptionAdapter` isolates all YouTube DOM selectors in `modules/youtube/selectors.ts` and binds a scoped `MutationObserver` directly to `#movie_player`, disconnecting any bootstrap observer once the player mounts.
- `InteractiveSubtitleController` renders interactive word spans in a non-invasive sibling overlay using `DocumentFragment` and single-container event delegation, while `ShadowTooltipView` isolates tooltip CSS inside an open `ShadowRoot`.
- `background.ts` is strictly event-driven with zero background polling timers.

### `apps/web`
- Built with Preact + Vite + native CSS (`~19 KB` gzipped app code).
- Provides Dashboard, Vocabulary Library (multi-facet filtering, inline editing, tags, custom examples, JSON/CSV import/export), Flashcard Review Session (keyboard shortcuts + Web Speech audio), SVG Statistics, and Settings/Sync.

### `apps/api`
- Modular monolithic Rust service (`axum` + `tokio` + `sqlx` + `postgres` with pure-Rust `rustls`).
- Organized by domain (`auth`, `sync`, `translate`, `database`, `domain`, `error`) without premature microservices, Redis, or message brokers.
