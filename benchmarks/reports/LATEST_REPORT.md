# LexiStream Empirical Benchmark & Pareto Optimization Report

- **Timestamp:** `2026-11-15T22:16:01.333Z`
- **Hardware / OS:** `linux arm64` (4 cores, 7956 MB RAM, Node `v22.23.1`)
- **Sampling Plan:** 11 fractional-factorial configurations evaluated out of 24 full-factorial combinations.

## 1. TypeScript vs Rust/WebAssembly Tokenization
| Metric | TypeScript (`@lexistream/language-core`) | Rust/WASM JSON Round-Trip | Rust/WASM Scalar Count |
| :--- | ---: | ---: | ---: |
| Extra Gzipped Bundle Cost | **0.00 KB** | +20.21 KB | +20.21 KB |
| Cold Initialization | 2.143 ms | 12.093 ms | 12.093 ms |
| Live Subtitle (11 words) P50 | **0.0159 ms** | 0.0388 ms | 0.0094 ms |
| Live Subtitle (11 words) P95 | **0.0206 ms** | 0.0484 ms | 0.0134 ms |
| Batch Transcript (2,200 words) P50 | 1.005 ms | 5.506 ms | **0.828 ms** |
| Lossless Reconstruction Verified | Yes | Yes | N/A |

## 2. Subtitle DOM Rendering & MutationObserver Scoping
- **Delegated `DocumentFragment` (3 total listeners):** P50 = `0.2854 ms`, P95 = `0.9902 ms`
- **Per-Word Listeners (33 listeners/cue):** P50 = `0.2107 ms`, P95 = `0.5460 ms`
- **Scoped `#movie_player` Observer during 300 Comment Mutations:** `1` callback(s)
- **Document-Wide Observer during 300 Comment Mutations:** `31` callback(s)

## 3. Translation Caching (100 Zipfian Hover Events across 18 Unique Words)
- **Two-Tier Bounded LRU + IndexedDB:** P50 = `0.0223 ms`, Network Calls = `14/100` (82% reduction)
- **IndexedDB-Only:** P50 = `0.0582 ms`, Network Calls = `14/100`
- **Uncached Direct:** P50 = `3.0806 ms`, Network Calls = `100/100`

## 4. Non-Dominated Pareto Frontier (Kochenderfer & Wheeler Ch. 15)
- **`cfg-1-ts-native-delegated-fragment-lru+idb-scoped-player`**: P95=`1.6016 ms`, RAM=`204 KB`, CPU/100cues=`157.932 ms`, Bundle=`28.48 KB`, NetReqs=`14`
- **`cfg-3-ts-native-per-word-listeners-lru+idb-scoped-player`**: P95=`1.1575 ms`, RAM=`299 KB`, CPU/100cues=`113.517 ms`, Bundle=`28.48 KB`, NetReqs=`14`
- **`cfg-4-ts-native-delegated-fragment-idb-only-scoped-player`**: P95=`1.6375 ms`, RAM=`140 KB`, CPU/100cues=`157.932 ms`, Bundle=`28.48 KB`, NetReqs=`14`
