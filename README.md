# LexiStream — Lightweight Context-Based Language Learning Platform

LexiStream is a local-first, resource-conscious contextual language acquisition platform inspired by Language Reactor and Anki. It pairs a lightweight **Chrome Manifest V3 YouTube Extension** with a **Preact Local-First Study Web Application** (using **FSRS** spaced repetition) and an optional **Rust (Axum + Tokio + SQLx + PostgreSQL) Modular Monolith API** for cross-device delta synchronization and credential-safe translation proxying.

---

## Core Engineering Principles

1. **Performance Over Technological Prestige:** Zero frontend framework inside YouTube's Content Script (native `DocumentFragment` + Shadow DOM + $O(1)$ event delegation). Rust/WebAssembly was built and benchmarked empirically (`packages/language-wasm`), proving pure TypeScript is **2.4× faster** on live 11-word subtitle cues (`0.0159 ms` vs `0.0388 ms`) while saving `+20.21 KB` gzipped bundle weight and `12.1 ms` cold instantiation.
2. **Local-First Resilience:** Vocabulary, multiple video context occurrences, FSRS scheduling cards, and immutable review logs live in **IndexedDB** first. Both the extension and web dashboard remain 100% functional offline.
3. **Minimal Runtime Footprint:**
   - Web App CSS: **1.18 KB gzipped**; Preact UI bundle: **19.11 KB gzipped** (+ `17.76 KB` shared validation chunk).
   - Extension Content Script: **28.48 KB gzipped** (`0` background polling loops).
   - Scoped `#movie_player` `MutationObserver` ignores YouTube comment/live-chat DOM churn (**1** callback vs **31** for document-wide observers).
4. **Honest Learning Metrics:** Explicitly separates **Collected**, **Reviewed (≥1 rep)**, and **Demonstrably Retained (FSRS Review state with stability ≥ 7 days)**.

---

## Repository Structure

```text
language-learning-platform/
├── apps/
│   ├── extension/               # WXT Chrome MV3 extension (YouTube caption adapter, Shadow DOM tooltip, popup)
│   ├── web/                     # Preact + Vite local-first dashboard, vocabulary manager, FSRS flashcards, SVG stats
│   └── api/                     # Rust + Axum + Tokio + SQLx + PostgreSQL modular monolith API
├── packages/
│   ├── shared-types/            # Zod validation schemas & shared TypeScript contracts
│   ├── language-core/           # Lossless Unicode tokenizer, contextual lemmatizer/POS disambiguator, phrasal verbs
│   ├── translation-providers/   # Provider-agnostic interfaces, 2-tier LRU+IDB cache, in-flight dedup, fallback chain
│   ├── vocabulary-engine/       # IndexedDB repository, lemma+POS deduplication, multi-occurrence merge, JSON/CSV, sync
│   ├── flashcard-engine/        # ts-fsrs scheduler, interval previews, review log, honest retention statistics
│   └── language-wasm/           # Experimental Rust/WASM tokenizer + Criterion benchmarks for empirical comparison
├── benchmarks/                  # Reproducible benchmarks & Kochenderfer/Wheeler Pareto optimization suite
├── tests/e2e/                   # Playwright Chromium end-to-end & multi-device live sync tests
└── docs/                        # Architecture, Performance, Database, Security & ADRs
```

---

## Quick Start & Development

### Prerequisites
- **Node.js** `>= 22` and **pnpm** `>= 10`
- **Rust** stable toolchain (`cargo`, `rustc`, plus `wasm32-unknown-unknown` target for WASM benchmarks)
- **Docker** & **Docker Compose** (for local PostgreSQL 16)
- **Chromium** (for Playwright E2E tests; defaults to `/usr/bin/chromium` or `CHROMIUM_PATH`)

### 1. Install Dependencies & Build All Packages
```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install
pnpm build
```

### 2. Run the Web Application (Works Immediately Offline)
```bash
pnpm --filter @lexistream/web dev
```
Open `http://localhost:5173` (and `http://localhost:5173/youtube-fixture.html` to test the interactive YouTube subtitle overlay directly in any browser tab).

### 3. Load the Chrome MV3 Extension
1. Build the extension: `pnpm --filter @lexistream/extension build`
2. Open `chrome://extensions` in Chromium/Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select `apps/extension/.output/chrome-mv3`.
4. Open any YouTube video with captions enabled (`CC`), hover over any subtitle word to inspect contextual meanings, and click to save it to your local vocabulary.

### 4. Start PostgreSQL & Rust Backend API (Optional Cloud Sync & Translation Proxy)
```bash
docker compose up -d
cargo run -p lexistream-api
```
Environment variables supported by `lexistream-api`:
- `DATABASE_URL` (default: `postgres://lexistream:lexistream_dev_password@127.0.0.1:54329/lexistream`)
- `BIND_ADDR` (default: `127.0.0.1:8787`)
- `DEEPL_API_KEY` (optional: enables live DeepL upstream translation in `/api/v1/translate` while keeping keys off the client)
- `RATE_LIMIT_PER_MINUTE` (default: `180`)

---

## Testing & Benchmarking

```bash
# Unit & Component Tests (Vitest + fake-indexeddb + happy-dom)
pnpm test

# Rust Unit & Live PostgreSQL Integration Tests
cargo test -p lexistream-api
cargo test -p lexistream-language-wasm

# End-to-End Browser & Multi-Device Sync Tests (Playwright + Chromium + Live Rust API)
pnpm test:e2e

# Empirical Benchmarks & Pareto Optimization Report (Criterion + Node/DOM/WASM)
cargo bench -p lexistream-language-wasm --bench tokenizer_bench -- --quick
pnpm bench
```

Detailed documentation is available in:
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md)
- [`docs/DATABASE.md`](docs/DATABASE.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/ADR/README.md`](docs/ADR/README.md)
