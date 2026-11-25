# LexiStream — Interactive YouTube Subtitles, Local Vocabulary & FSRS Flashcards

[![License: MIT](https://img.shields.io/badge/License-MIT-800000.svg)](./LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-245858.svg)](./apps/extension/wxt.config.ts)
[![Spaced Repetition: FSRS](https://img.shields.io/badge/Spaced_Repetition-FSRS-15803D.svg)](./packages/flashcard-engine)

**LexiStream** is an open-source, local-first browser extension for learning languages from YouTube. Hover over a subtitle word to look it up without leaving the video, click to save it with its original sentence and timestamp, and review it later with **FSRS** spaced repetition. Inspired by **Language Reactor** and **Anki**, LexiStream keeps the study dashboard and your saved vocabulary in the browser. You do not need an account, a server, or a paid translation key to get started.

## Table of Contents

1. [What LexiStream Does](#1-what-lexistream-does)
2. [Browser Installation Guide](#2-browser-installation-guide)
3. [Architecture & Optional Services](#3-architecture--optional-services)
4. [Verification Commands](#4-verification-commands)
5. [License, Privacy & Third-Party Notices](#5-license-privacy--third-party-notices)
6. [AI-Assisted Development](#6-ai-assisted-development)

## 1. What LexiStream Does

- **Interactive YouTube captions.** Hover over a word to see available meanings and click to save it. Optional **Auto-pause** pauses playback while you inspect a word. Where timed caption data is available, LexiStream displays automatic captions in stable blocks rather than as a word-by-word roll-up. It can fall back to reading the visible captions from the player.
- **A second subtitle line for bilingual viewing.** Use **2nd Subtitle (YT Auto)** and **Translate to** in the popup to show YouTube's own translation. Keep it visible, blur it until you hover, or turn it off. Availability depends on the video and YouTube's available caption tracks.
- **On-demand Wiktionary dictionaries.** Download only the language pairs you study. The catalog has 11 directed pairs across English, Portuguese, French, Spanish, German, and Italian. Installed packs are indexed in your browser for offline lookup. Coverage varies by language pair and word.
- **A vocabulary library built around context.** Saved entries preserve subtitle excerpts and timestamped links so you can return to the moment you heard a word. The dashboard offers search, tags, vocabulary editing, and CSV and JSON import/export.
- **FSRS flashcards with editable answers.** Review with **Again**, **Hard**, **Good**, or **Easy**. On a card, choose **Show Answer → Add translation** if no translation was found, or **Edit translation** to correct one. Your edit is saved to the vocabulary entry without resetting the review schedule. The dashboard counts collected and reviewed words separately.

## 2. Browser Installation Guide

**Requirements:** Git, [Node.js](https://nodejs.org/) (22.23 or newer), [pnpm](https://pnpm.io/installation) `12.21.0`, and a current version of **Chrome** or **Chromium**. No Rust toolchain, Docker, or database is needed to build or use the extension.

```bash
git clone https://github.com/JoovcFLOUR/lexistream.git
cd lexistream
pnpm install --frozen-lockfile
pnpm --filter @lexistream/extension build
```

1. Open `chrome://extensions/` and enable **Developer mode** (*Modo do desenvolvedor*).
2. Click **Load unpacked** (*Carregar sem compactação*) and select `apps/extension/.output/chrome-mv3` inside the cloned repository. Select the folder that contains `manifest.json`.
3. Open or reload a YouTube watch page with captions and turn on **CC**. Hover over a caption word to look it up, then click it to add it to your vocabulary.
4. In the LexiStream popup, choose **Open Study Dashboard** to review saved words or **Dicionários Wiktionary** to download a dictionary. In the dashboard, click **Download** on the language pair you want to install.

This is a manual installation from source, not a Chrome Web Store installation. To update it, rebuild the extension and click **Reload** for LexiStream on the Extensions page.

## 3. Architecture & Optional Services

| Path | Responsibility |
| --- | --- |
| [`apps/extension`](./apps/extension) | WXT / Chrome Manifest V3. The TypeScript content script handles captions with native DOM APIs and a Shadow DOM tooltip. An event-driven service worker connects the YouTube tab to the local dictionary and study data. |
| [`apps/web`](./apps/web) | Preact / Vite dashboard for vocabulary, dictionaries, flashcards, statistics, and settings. The same UI is bundled as a page inside the extension. |
| [`packages/`](./packages) | Shared TypeScript contracts, tokenization and lemmatization, dictionary providers and caches, IndexedDB vocabulary storage, and the `ts-fsrs` scheduler. The experimental Rust/WASM tokenizer is a benchmark reference, not a browser runtime dependency. |
| [`apps/api`](./apps/api) | Optional Rust / Axum / Tokio / SQLx service backed by PostgreSQL. It provides account-based delta synchronization and can proxy DeepL requests without putting the API key in the browser. |

### Run the standalone dashboard (optional)

```bash
pnpm --filter @lexistream/web dev
```

Open `http://localhost:5173`. The standalone page uses its own browser storage; it does not automatically read the extension's IndexedDB. Use the dashboard from the extension popup to see words captured on YouTube.

### Run the API locally (optional)

With a stable Rust toolchain and Docker Compose installed, run:

```bash
docker compose up -d --wait postgres
cargo run -p lexistream-api
```

The API listens on `127.0.0.1:8787` by default. With it running, the dashboard's **Settings** page lets you register or sign in and choose **Synchronize Now**. `DATABASE_URL` and `BIND_ADDR` override the local defaults. `DEEPL_API_KEY` is optional and belongs in the server environment only. The bundled Compose database credentials are for local development, not public deployment. `127.0.0.1` always means the computer running the software.

## 4. Verification Commands

```bash
pnpm test                           # Vitest: language, storage, captions, and UI
pnpm build                          # Shared packages, standalone dashboard, and MV3 extension
docker compose up -d --wait postgres
cargo test --workspace               # Rust workspace and PostgreSQL integration tests
cargo build -p lexistream-api        # Build the API binary used by Playwright
pnpm test:e2e                        # Playwright: browser flows and API synchronization
```

The Playwright suite uses `/usr/bin/chromium` by default. Set `CHROMIUM_PATH` if Chromium is installed elsewhere. See [Architecture](./docs/ARCHITECTURE.md), [Performance](./docs/PERFORMANCE.md), [Database](./docs/DATABASE.md), and [Architecture Decisions](./docs/ADR/README.md) for more detail.

## 5. License, Privacy & Third-Party Notices

- **Code:** LexiStream's original code is available under the [MIT License](./LICENSE). Third-party components retain their own licenses.
- **Dictionary data:** No Wiktionary packs ship in the extension. The downloadable files are maintained by the [Open DSL Dictionary Project](https://github.com/open-dsl-dict/wiktionary-dict), based on [Matthias Buchmeier's Wiktionary dictionaries](https://en.wiktionary.org/wiki/User:Matthias_Buchmeier) and the work of Wiktionary contributors. The upstream repository lists [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) and the [GNU Free Documentation License](https://www.gnu.org/licenses/fdl-1.3.html) for its collection. Live dictionary results have their own source and attribution. None of this dictionary data is relicensed under MIT.
- **Local storage and network use:** Saved vocabulary, flashcards, and review history are stored in the browser and can be studied offline. YouTube playback and translated captions, dictionary downloads, live lookups, and synchronization require a connection. A lookup can send a word or phrase and its source language to [Free Dictionary API](https://freedictionaryapi.com/) when it cannot be answered locally. The optional backend can receive the lookup's subtitle excerpt, and synchronization sends saved study records to the configured server. See [Security & Privacy](./docs/SECURITY.md) for what is exchanged with each service.

## 6. AI-Assisted Development

LexiStream was developed with AI assistance, with implementation and independent verification handled by different models:

| Role | Model |
| --- | --- |
| Software creation and implementation | **Gemini 4 Carbon** |
| Independent software verification | **DeepSeek V4.1 Flash 1017** |

These models were used during development. Neither is required to install or run LexiStream.
