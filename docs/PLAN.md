# Context-Based Language Learning Platform (LexiStream) — Implementation Plan

> **Engineering Mandate:** Build for measured efficiency, local-first resilience, privacy, and zero technological vanity. Follow strict TDD (Red → Green → Refactor) and verify every milestone with automated tests and real benchmarks.

**Goal:** Design, implement, test, benchmark, and document a complete lightweight context-driven language-learning platform comprising a Chrome MV3 YouTube subtitle extension, a Preact local-first web application with FSRS spaced repetition, and a modular monolithic Rust (Axum + SQLx + PostgreSQL) synchronization & translation-proxy backend.

**Host & Environment Constraints Identified:**
- **Hardware/OS:** Linux `aarch64` (Raspberry Pi, 4 cores, 7.8 GiB RAM / ~2.9 GiB free, 320 GiB disk).
- **Tooling:** Node.js `v22.23.1`, `pnpm 12.21.0`, Rust `1.100.0` (`aarch64-unknown-linux-gnu` + `wasm32-unknown-unknown`), Docker `29.9.0` + Compose `v5.6.0`, Chromium `155.0` (`/usr/bin/chromium`).
- **Build Constraints:** No `libssl-dev` headers on host → all Rust network/DB crates use pure-Rust `rustls`; `CARGO_BUILD_JOBS=2` in `.cargo/config.toml` prevents linker memory spikes on 8 GB RAM; Playwright uses system `/usr/bin/chromium` with `--disable-gpu --no-sandbox` for fast ARM64 headless execution; `pnpm -r` replaces Turborepo daemon to eliminate idle background RAM overhead (documented in ADR-0001).

---

## Global Constraints
- Content script must use native DOM APIs + Shadow DOM + single-container event delegation (0 KB UI framework in YouTube page).
- Private translation API keys must never be embedded in extension or web bundles.
- All user vocabulary, occurrences, flashcards, and review logs must persist locally first in IndexedDB and remain functional 100% offline.
- Spaced repetition must use standard FSRS (`ts-fsrs`), never a custom ad-hoc algorithm.
- Statistics must distinguish **Collected**, **Reviewed**, and **Demonstrably Retained** items.
- Every optimization claim must be backed by reproducible benchmark output in `benchmarks/reports/`.

## Review Focus (High-Risk Edge Cases Pinned by Tests)
1. **Polysemous words & repeated captures across videos:** Saving `"thought"` as a verb in video A and `"thought"` as a noun in video B (or saving `"thought"` twice at different timestamps) must preserve distinct senses and append contextual occurrences without losing prior context or duplicating cards unnecessarily.
2. **Rapid hover sweep across subtitle words:** Moving the pointer rapidly across 8 words in 200 ms must debounce intermediate hovers and abort outdated provider requests via `AbortController` so stale translations never overwrite the currently hovered word.
3. **Punctuation, contractions, Unicode & XSS payloads in subtitles:** Subtitles containing `"Don't"`, `"l'amour"`, `"¿Dónde?"`, or malicious `<img src=x onerror=alert(1)>` text must tokenize cleanly while preserving punctuation and rendering strictly via `textContent` / Shadow DOM without XSS execution.
4. **Offline capture → reconnect delta synchronization:** Capturing and reviewing words while offline, editing on another client, and syncing with the Rust/PostgreSQL backend must converge deterministically without losing occurrences or review history.
5. **Caption unavailability & dynamic track/video switching:** Navigating between YouTube videos (SPA navigation) or disabling captions must cleanly detach/reattach scoped `MutationObserver` instances without memory leaks and surface a clear non-intrusive status when captions are off.

---

## Milestone Roadmap & Tasks

### Milestone 1: Shared Domain Contracts & Linguistic Core (Phase 1 & 2 Foundation)
- [x] **Task 1.1 (`packages/shared-types`):** Zod schemas & TypeScript contracts for `VocabularyItem`, `ContextOccurrence`, `LexicalMeaning`, `TranslationQuery`, `TranslationResponse`, `FlashcardRecord`, `ReviewLogRecord`, `SyncPushPayload`, `SyncPullResponse`, and `UserSettings`. (TDD with Vitest)
- [x] **Task 1.2 (`packages/language-core`):** Modular `TextProcessor` interface + lightweight TypeScript tokenizer (preserving punctuation/whitespace, contractions, Unicode), case normalizer, English/multilingual lemmatizer & POS heuristic dictionary, and phrasal-verb/multiword expression detector. (TDD with Vitest)

### Milestone 2: Provider-Independent Translation & Local-First Vocabulary Engine (Phase 1 & 2)
- [x] **Task 2.1 (`packages/translation-providers`):** `TranslationProvider` interface with `AbortSignal`, bounded in-memory LRU + IndexedDB persistent cache, in-flight request deduplication, `ContextualLexicalMockProvider` (polysemous context disambiguation for offline/dev), and `BackendProxyTranslationProvider` with automatic fallback chain. (TDD with Vitest + `fake-indexeddb`)
- [x] **Task 2.2 (`packages/vocabulary-engine`):** IndexedDB schema & repository (`vocabulary`, `occurrences`, `translation_cache`, `sync_outbox`, `settings`), smart lemma+POS deduplication with multi-occurrence aggregation, search/filter by language/POS/status/tag, JSON & CSV export/import, full data wipe, and versioned sync queue. (TDD with Vitest + `fake-indexeddb`)

### Milestone 3: Browser Extension — YouTube Subtitle Integration (Phase 1 MVP)
- [x] **Task 3.1 (`apps/extension` Caption Adapter):** Isolated YouTube selector map (`selectors.ts`), `YouTubeCaptionAdapter` using scoped `MutationObserver`, video metadata & `currentTime` extraction, track/video change handling, and graceful missing-caption detection. (TDD with Vitest `happy-dom` / `jsdom`)
- [x] **Task 3.2 (`apps/extension` Interactive Overlay & Shadow DOM Tooltip):** `DocumentFragment` interactive word renderer with single-listener event delegation, debounced hover controller with `AbortController` cancellation, Shadow DOM tooltip (word, contextual translation, lemma, POS, multi-sense definitions, sentence + sentence translation, saved badge), click-to-save to IndexedDB, and WXT Manifest V3 build (`content.ts`, `background.ts`, Preact `popup/`). (Build + Unit + Playwright tests)

### Milestone 4: FSRS Spaced Repetition & Local-First Web Application (Phase 3 & 4)
- [x] **Task 4.1 (`packages/flashcard-engine`):** `ts-fsrs` integration (`Again`, `Hard`, `Good`, `Easy`), interval preview generator, card state & `ReviewLogRecord` persistence in IndexedDB, and honest statistics calculator (collected vs reviewed vs retained, retention %, accuracy, daily streak). (TDD with Vitest)
- [x] **Task 4.2 (`apps/web`):** Lightweight Preact + Vite + CSS Modules web app: Dashboard, Vocabulary browser/editor (search, filters, tags, custom examples, JSON/CSV import/export, data deletion), Interactive Flashcard review session (keyboard shortcuts + Web Speech audio), SVG Statistics view, and Settings/Sync panel. (Unit + Build + Playwright E2E tests)

### Milestone 5: Rust Modular Monolith Backend & Synchronization (Phase 3)
- [x] **Task 5.1 (`apps/api`):** Rust + Axum + Tokio + SQLx + PostgreSQL modular monolith (`auth`, `vocabulary`, `sync`, `translate`, `health`), SQL migrations, Argon2 auth + bearer tokens, right-to-erasure `DELETE /api/v1/auth/account`, versioned delta sync (`push`/`pull` with occurrence union + version conflict resolution), and secure server-side translation proxy with rate limiting. (Cargo unit tests + live PostgreSQL Docker integration tests)

### Milestone 6: Performance Engineering, Rust/WASM Experiment & Documentation (Phase 5)
- [x] **Task 6.1 (`packages/language-wasm` & `benchmarks/`):** Real `wasm32-unknown-unknown` Rust tokenizer/normalizer + Criterion benchmarks + end-to-end Node/Chromium benchmark suite comparing:
  1. TypeScript vs Rust/WASM tokenization/normalization (cold start, warm start, P50, P95, bundle size, JS↔WASM boundary cost).
  2. Event-delegated `DocumentFragment` DOM vs per-word listener rendering.
  3. Two-tier LRU+IndexedDB cache vs IndexedDB-only vs uncached.
  4. Scoped player `MutationObserver` vs document-wide `MutationObserver`.
  5. Kochenderfer & Wheeler Ch. 1 / 15 / 16 / 20 / 22 Pareto-optimal configuration analysis saved to `benchmarks/reports/`.
- [x] **Task 6.2 (`docs/` & `README.md`):** Complete `README.md`, `ARCHITECTURE.md`, `PERFORMANCE.md`, `DATABASE.md`, `SECURITY.md`, and numbered ADRs in `docs/ADR/` backed by real measured numbers.
