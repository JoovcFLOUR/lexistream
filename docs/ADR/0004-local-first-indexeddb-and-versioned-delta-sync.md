# ADR-0004: Local-First IndexedDB Persistence with Sequence-Based CRDT-Inspired Delta Sync

**Date**: 2026-11-15
**Status**: accepted
**Deciders**: Core Engineering

## Context

Users must never lose captured YouTube vocabulary or flashcard reviews due to offline travel, flaky Wi-Fi, or backend downtime. Furthermore, `chrome.storage.local` has quota and serialization bottlenecks when storing thousands of contextual sentences and review logs, and naive Last-Writer-Wins synchronization silently overwrites video occurrences captured on a second device.

## Decision

We store all vocabulary, occurrences, flashcards, review logs, and outbox mutations in **IndexedDB** (`@lexistream/vocabulary-engine`), paired with an **event-driven monotonic sequence (`sync_global_seq`) delta protocol** that merges collection fields (`occurrences`, `surface_forms`, `meanings`, `tags`, `custom_examples`) via commutative set union and scalar fields via `(version, updated_at)`.

## Alternatives Considered

### Alternative 1: `chrome.storage.local` Whole-Array Persistence
- **Pros**: Simple key-value API.
- **Cons**: Re-serializes the entire vocabulary dataset on every single word click; unavailable in standard web browsers (`apps/web`).
- **Why not**: IndexedDB works identically in both the MV3 Extension and Web Application with indexed $O(\log N)$ lookups.

### Alternative 2: Continuous Background Polling Sync
- **Pros**: Automatic near-real-time updates.
- **Cons**: Wakes up the MV3 Service Worker and radio/CPU continuously even when nothing changed.
- **Why not**: Event-driven outbox push + `since_seq` delta pull consumes zero idle CPU or network traffic.

## Consequences

### Positive
- 100% offline capability for both vocabulary capture and FSRS flashcard study.
- Zero lost video context occurrences when two devices edit or capture the same lemma concurrently (verified in `apps/api/tests/api_integration.rs` and `tests/e2e/platform.spec.ts`).

### Negative
- Soft-delete tombstones (`deleted_at`) remain as lightweight metadata rows so deletions replicate cleanly to offline peers.
