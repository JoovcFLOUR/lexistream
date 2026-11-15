# ADR-0001: Use pnpm Workspaces Without Turborepo Daemon

**Date**: 2026-11-15
**Status**: accepted
**Deciders**: Core Engineering

## Context

The monorepo contains 6 TypeScript packages (`shared-types`, `language-core`, `translation-providers`, `vocabulary-engine`, `flashcard-engine`, `benchmarks`), 2 TypeScript apps (`extension`, `web`), and 2 Rust crates (`apps/api`, `packages/language-wasm`). Development and verification run on an 8 GB ARM64 Linux host (~2.9 GB free RAM).

## Decision

We manage TypeScript packages using native `pnpm` workspaces (`pnpm -r`) and Cargo workspaces (`Cargo.toml`) without introducing Turborepo (`turbo.json`).

## Alternatives Considered

### Alternative 1: Turborepo (`turbo`)
- **Pros**: Remote build caching and task graph visualization for large multi-team monorepos.
- **Cons**: Adds ~50 MB of native daemon binaries and resident background memory overhead while offering negligible speedup when internal packages consume TypeScript source directly via bundler resolution (`workspace:*`).
- **Why not**: Violates our minimal-footprint rule without providing measurable build time gains (`wxt build` finishes in `716 ms` and `vite build` finishes in `1.10 s` directly).

### Alternative 2: Separate Standalone Repositories
- **Pros**: Independent CI pipelines.
- **Cons**: Schema drift across extension, web app, and backend sync payloads.
- **Why not**: Shared Zod contracts (`@lexistream/shared-types`) prevent serialization mismatches.

## Consequences

### Positive
- Zero background JS build daemon memory consumption.
- `pnpm install` completes in `59 ms` warm; full production builds finish in `< 2 s`.

### Negative
- If the repository grows beyond ~30 independently compiled TS packages, task caching may need re-evaluation.
