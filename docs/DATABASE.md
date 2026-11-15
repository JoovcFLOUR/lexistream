# Database & Synchronization Architecture

LexiStream uses a **dual-store local-first model**: **IndexedDB** is the primary source of truth on every client device, and **PostgreSQL 16** (managed via `SQLx` in `apps/api`) acts as an asynchronous, versioned replication & backup hub.

---

## 1. Local Persistence: IndexedDB (`lexistream-local-db-v1`)

Managed by `@lexistream/vocabulary-engine` (`packages/vocabulary-engine/src/idb.ts`) without heavy ORM wrappers.

| Object Store | Primary Key | Indexes | Purpose |
| :--- | :--- | :--- | :--- |
| `vocabulary` | `id` (UUID) | `by_normalized_key` (unique), `by_language`, `by_status`, `by_updated_at` | Stores `VocabularyItem` records including embedded `occurrences[]`, `meanings[]`, `surface_forms[]`, `custom_examples[]`, `tags[]`, `version`, and soft-delete tombstone `deleted_at`. |
| `flashcards` | `id` (UUID) | `by_vocabulary_id` (unique), `by_due` | Stores FSRS `FlashcardRecord` state (`due`, `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`, `state`, `last_review`, `version`). |
| `review_logs` | `id` (UUID) | `by_vocabulary_id`, `by_reviewed_at` | Append-only immutable `ReviewLogRecord` audit trail used to reconstruct learning statistics and streaks. |
| `sync_outbox` | `key` (`type::id`) | — | Tracks locally mutated entities awaiting push to `/api/v1/sync/push`; coalesces multiple offline edits to the same item into a single push entry. |
| `settings` | `key` | — | Stores `UserSettings` (`source_language`, `target_language`, daily limits, `last_sync_seq`, optional `auth_token`). |

A separate lightweight database (`lexistream-translation-cache-v1`) stores persistent translation lookups so clearing cache never touches user vocabulary.

---

## 2. Backend Schema: PostgreSQL 16 (`apps/api/migrations/0001_init.sql`)

- **`sync_global_seq`**: Monotonic PostgreSQL `SEQUENCE` assigning a strictly increasing `sync_seq BIGINT` to every insert or update across `vocabulary_items`, `flashcards`, and `review_logs`.
- **`users`**: `(id UUID PK, email TEXT UNIQUE, password_hash TEXT, created_at TIMESTAMPTZ)`
- **`auth_sessions`**: `(token_hash TEXT PK, user_id UUID FK ON DELETE CASCADE, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ)` — indexed by `user_id`.
- **`vocabulary_items`**: Composite PK `(user_id, id)` with `ON DELETE CASCADE`, `JSONB` columns for `surface_forms`, `meanings`, `occurrences`, `custom_examples`, and `tags`, plus B-tree indexes:
  - `idx_vocabulary_user_seq (user_id, sync_seq)` for $O(\log N)$ incremental delta pulls.
  - `idx_vocabulary_user_norm (user_id, normalized_key)` for fast deduplication checks.
- **`flashcards`**: Composite PK `(user_id, id)` with FSRS scheduling columns + `idx_flashcards_user_seq (user_id, sync_seq)`.
- **`review_logs`**: Composite PK `(user_id, id)` append-only log + `idx_review_logs_user_seq (user_id, sync_seq)`.

---

## 3. Synchronization & Deterministic Conflict Resolution

Synchronization is **event-driven / user-triggered** (never a busy polling loop):

1. **Push (`POST /api/v1/sync/push`):** Sends dirty entities recorded in `sync_outbox`. Once acknowledged (`200 OK`), the outbox entries are cleared.
2. **Pull (`GET /api/v1/sync/pull?since_seq=<last_sync_seq>`):** Fetches only rows with `sync_seq > since_seq` and advances `last_sync_seq` to `server_seq`.

### Conflict Resolution Rules (`conflict.ts` & `apps/api/src/services/mod.rs`)
Both client and server apply the exact same commutative, idempotent merge function:
- **Collection fields (`occurrences`, `surface_forms`, `meanings`, `custom_examples`, `tags`):** Merged via **grow-only set union** keyed by canonical signatures (`video_id + floor(timestamp) + normalized_context` for occurrences). Capturing the same word offline on Laptop A and Phone B preserves **both** video contexts without data loss.
- **Mutable scalar fields (`primary_translation`, `primary_definition`, `status`, `deleted_at`):** Resolved deterministically by higher `version`, breaking ties by ISO-8601 `updated_at` timestamp.
- **Deletions:** Propagated via soft-delete tombstones (`deleted_at != null`, `version + 1`) during sync, while full local wipe (`wipeAllData()`) and account deletion (`DELETE /api/v1/auth/account`) permanently purge all records.
