# Security & Privacy Documentation

## 1. Privacy-First Data Minimization

- **Zero Telemetry & Zero Silent Subtitle Harvesting:** LexiStream never transmits video watch history, full subtitle streams, or pointer movements to the backend.
- **Local Processing by Default:** Subtitle detection, tokenization, lemmatization, phrasal-verb recognition, FSRS scheduling, and local dictionary lookups execute entirely inside the user's browser.
- **Explicit Transmission Boundaries:** Network requests occur only when:
  1. Looking up an uncached hovered/clicked word via the configured `/api/v1/translate` endpoint (sending only `{ word, context, source_language, target_language }`), or
  2. Explicitly synchronizing saved vocabulary with a user-configured account.

## 2. Browser Extension Security (Manifest V3)

- **Minimal Permissions (`apps/extension/wxt.config.ts`):**
  - `permissions: ["storage"]` (no `tabs`, `webRequest`, `scripting`, `history`, or `<all_urls>`).
  - `host_permissions: ["*://*.youtube.com/*"]`.
- **Cross-Site Scripting (XSS) Prevention:**
  - Subtitle overlays and Shadow DOM tooltips construct DOM nodes exclusively with `document.createElement` and `node.textContent`.
  - Adversarial subtitle payloads (e.g., `<img src=x onerror=alert(1)>` or `<script>`) are rendered inertly as literal text, verified by automated tests in `apps/extension/modules/youtube-integration.test.ts`.
- **Style & DOM Isolation:**
  - The hover tooltip renders inside an encapsulated `ShadowRoot`, preventing page scripts/styles from spoofing or breaking extension UI.

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

- **Portable Export:** Users can export their complete vocabulary, contexts, flashcards, and review history at any time in **JSON** or **RFC-4180 CSV** formats.
- **Complete Deletion:**
  - **Local:** `Settings -> Delete All Local Data` clears all IndexedDB stores immediately.
  - **Remote:** `DELETE /api/v1/auth/account` deletes the `users` row with `ON DELETE CASCADE` across `auth_sessions`, `vocabulary_items`, `flashcards`, and `review_logs`.
