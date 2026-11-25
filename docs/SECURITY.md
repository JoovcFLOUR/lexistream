# Security & Privacy Documentation

## 1. Privacy-First Data Minimization

- **Local study and processing:** Subtitle processing, cached and installed-dictionary lookup, and FSRS scheduling run in the browser. LexiStream does not include analytics or telemetry. Saved vocabulary can include a video link, timestamp, and subtitle excerpt.
- **YouTube:** LexiStream uses the player's available captions. Timed and auto-translated caption requests go to YouTube; the translated subtitle line is off by default.
- **Downloaded dictionaries:** Selecting **Download** fetches the selected pack's source files from `raw.githubusercontent.com/open-dsl-dict/wiktionary-dict`. The pack is indexed locally in IndexedDB.
- **Online lookup:** After a cache and installed-dictionary miss, the extension can send the queried word or phrase and source language to `freedictionaryapi.com`. It does not send the full subtitle excerpt to this service.
- **Optional backend:** A lookup that falls through to the backend can send the word, subtitle excerpt, language pair, and word offset to `/api/v1/translate`. The translation proxy defaults to loopback. If the backend operator configures `DEEPL_API_KEY`, that backend can forward the text and language pair to DeepL.
- **Account and sync:** Registering or signing in sends account credentials to the API URL in Settings. **Synchronize Now** exchanges saved vocabulary (including its captured contexts), flashcards, and review logs with that server. The credentials in Docker Compose are local development defaults; do not expose that setup to the public internet.

## 2. Browser Extension Security (Manifest V3)

- **Minimal Permissions (`apps/extension/wxt.config.ts`):**
  - `permissions: ["storage"]` (no `tabs`, `webRequest`, `scripting`, `history`, or `<all_urls>`).
  - `host_permissions: ["*://*.youtube.com/*"]`.
- **Cross-Site Scripting (XSS) Prevention:**
  - Subtitle overlays and Shadow DOM tooltips render caption text with DOM text APIs rather than treating it as HTML. See `apps/extension/modules/youtube-integration.test.ts` for automated coverage.
- **Style & DOM Isolation:**
  - The hover tooltip uses a `ShadowRoot` for style isolation; this is not a security boundary against scripts on the page.

## 3. API Credential Custody & Authentication (`apps/api`)

- **Zero Client-Side Secret Keys:** Third-party translation credentials (`DEEPL_API_KEY`) live exclusively in backend server environment variables (`BackendProxyTranslationProvider` calls `/api/v1/translate`).
- **Password & Session Security:**
  - User passwords are hashed with **Argon2id** (`argon2` crate with per-user CSPRNG salts via `OsRng`).
  - Bearer session tokens are 256-bit cryptographically random tokens (`32 bytes` hex); only their **SHA-256 digest** (`token_hash`) is stored in PostgreSQL `auth_sessions` with a 30-day expiration, protecting active sessions even if database backups were exposed.
- **Input Validation & Parameterized SQL:**
  - Every client boundary validates payloads with `Zod` schemas; every Rust endpoint deserializes typed structs and executes strictly parameterized `SQLx` queries (`$1, $2, ...`), eliminating SQL injection.
- **Rate Limiting:**
  - Token-bucket rate limiting (`RateLimiter` in `apps/api/src/services/mod.rs`) protects authentication, synchronization, and translation endpoints against brute-force or quota-exhaustion abuse (`HTTP 429 Too Many Requests`).

## 4. User Data Portability & Right to Erasure

- **Portable Export:** **JSON** includes vocabulary with saved contexts, flashcards, and review history. **CSV** exports vocabulary with a representative context per entry, without review history.
- **Deleting Study Data:**
  - **Local:** **Settings → Delete All Local Data** clears vocabulary, flashcards, reviews, pending sync, and settings in that dashboard's storage. Dictionary packs are managed separately from the **Dictionaries** page.
  - **Remote:** `DELETE /api/v1/auth/account` deletes the `users` row with `ON DELETE CASCADE` across `auth_sessions`, `vocabulary_items`, `flashcards`, and `review_logs`.
