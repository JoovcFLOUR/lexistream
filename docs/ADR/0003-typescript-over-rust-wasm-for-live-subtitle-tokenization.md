# ADR-0003: Retain Native TypeScript Over Rust/WebAssembly for Live Subtitle Tokenization

**Date**: 2026-11-15
**Status**: accepted
**Deciders**: Core Engineering

## Context

Subtitle tokenization, Unicode normalization, and contextual word analysis run on every YouTube subtitle transition. We built both a pure TypeScript implementation (`@lexistream/language-core`) and a zero-dependency `wasm32-unknown-unknown` Rust implementation (`packages/language-wasm`) to test empirically whether WebAssembly improves end-to-end performance.

## Decision

We use the native TypeScript `TextProcessor` in production for both the Browser Extension and Web Application, keeping `packages/language-wasm` in the repository strictly as a reproducible benchmark baseline behind the `TextProcessor` interface.

## Alternatives Considered

### Alternative 1: Rust/WebAssembly (`wasm_tokenize_json`) in Content Script
- **Pros**: Raw native Rust tokenization takes `3.28 µs` in Criterion (`tokenizer_bench`).
- **Cons**: Crossing the JS↔WASM boundary (`TextEncoder` UTF-8 copy + linear memory `alloc` + JSON serialization + `TextDecoder` + `JSON.parse`) raises 11-word cue P50 latency to **`38.8 µs`** vs **`15.9 µs`** in pure TypeScript, adds **`+20.21 KB` gzipped** to the bundle, adds **`12.09 ms`** cold WASM instantiation, and allocates **`1.1 MB`** of WASM linear memory.
- **Why not**: Strictly Pareto-dominated across latency, memory, cold start, and bundle size (`benchmarks/reports/LATEST_REPORT.md`).

## Benchmark Evidence (`linux arm64`, Node `v22.23.1`, `rustc 1.100.0`)

- **11-word live subtitle cue P50:** TypeScript `0.0159 ms` vs Rust/WASM JSON `0.0388 ms` (**TypeScript is 2.44× faster**).
- **Cold start:** TypeScript `2.14 ms` vs Rust/WASM `12.09 ms`.
- **Bundle delta:** `0 KB` vs `+20.21 KB` gzipped (`47 KB` raw `.wasm`).
- **Note on batch scalar workloads:** When returning only a scalar count (`wasm_count_words`) over a 2,200-word transcript without JSON marshaling, WASM achieved `0.828 ms` vs TypeScript's `1.005 ms` (1.21× faster), confirming WASM only pays off when large text buffers remain inside WASM memory with minimal structured JS return values.

## Consequences

### Positive
- Smaller extension bundle, zero WASM instantiation delay, lower per-tab RAM footprint, and simpler debugging.

### Negative
- If future features perform heavy morphological parsing on multi-megabyte imported ebooks, a batch-oriented Web Worker WASM adapter may warrant revisiting.
