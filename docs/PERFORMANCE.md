# Performance Engineering & Mathematical Optimization

## 1. Mathematical Problem Formulation (*Algorithms for Optimization*, Ch. 1)

We formulate architectural design selection as a constrained discrete multiobjective optimization problem:

$$\min_{\mathbf{x} \in \mathcal{X}} \mathbf{f}(\mathbf{x}) = \begin{bmatrix} f_{\text{p95}}(\mathbf{x}) \\ f_{\text{ram}}(\mathbf{x}) \\ f_{\text{cpu}}(\mathbf{x}) \\ f_{\text{bundle}}(\mathbf{x}) \\ f_{\text{net}}(\mathbf{x}) \end{bmatrix} \quad \text{subject to} \quad \begin{cases} g_1(\mathbf{x}): f_{\text{p95}}(\mathbf{x}) - 16.0\text{ ms} \le 0 & \text{(60 FPS frame budget)} \\ g_2(\mathbf{x}): f_{\text{bundle}}(\mathbf{x}) - 45.0\text{ KB} \le 0 & \text{(gzipped content-script cap)} \\ g_3(\mathbf{x}): 1 - \text{correctness}(\mathbf{x}) = 0 & \text{(lossless subtitle reconstruction)} \end{cases}$$

### Discrete Design Variables (Ch. 22)
- $x_{\text{tok}} \in \{\texttt{ts-native}, \texttt{rust-wasm}\}$ — Subtitle tokenization & normalization engine.
- $x_{\text{dom}} \in \{\texttt{delegated-fragment}, \texttt{per-word-listeners}\}$ — Interactive subtitle span mounting strategy.
- $x_{\text{cache}} \in \{\texttt{lru+idb}, \texttt{idb-only}, \texttt{uncached}\}$ — Translation lookup caching hierarchy.
- $x_{\text{obs}} \in \{\texttt{scoped-player}, \texttt{document-wide}\}$ — `MutationObserver` attachment root.

---

## 2. Sampling Plan & Experimental Environment (Ch. 16 & Ch. 20)

Rather than exhaustively benchmarking every combinatorial permutation under every network/DOM stressor ($2 \times 2 \times 3 \times 2 = 24$ base configurations $\times$ multiple workloads), `benchmarks/optimization/pareto.ts` generates a **balanced 11-point fractional-factorial sampling plan** covering all main effects and cross-factor interactions.

- **Measured Host Environment:** Linux `6.12.109+rpt-rpi-v8` (`aarch64` Raspberry Pi, 4 cores, 7,956 MB RAM, Node.js `v22.23.1`, `rustc 1.100.0`).
- Evaluating directly on constrained ARM64 hardware exposes real CPU, memory-allocation, and I/O bottlenecks that desktop workstations mask (Ch. 20 Optimization Under Uncertainty).

---

## 3. Empirical Benchmark Results

Reproduce anytime with:
```bash
cargo bench -p lexistream-language-wasm --bench tokenizer_bench -- --quick
pnpm bench
```
Raw machine-readable output is stored in `benchmarks/reports/latest-benchmark-report.json`.

### 3.1 TypeScript vs Rust/WebAssembly Tokenization

Criterion native Rust baseline (`packages/language-wasm`):
- 11-word cue in native Rust: **`3.28 µs`**
- 2,200-word transcript in native Rust: **`626.24 µs`**

End-to-end JS/WASM runtime comparison (`benchmarks/text-processing/wasm-vs-ts.ts`):

| Metric | TypeScript (`@lexistream/language-core`) | Rust/WASM JSON Round-Trip | Rust/WASM Scalar Count |
| :--- | ---: | ---: | ---: |
| Extra Gzipped Bundle Payload | **0.00 KB** | +20.21 KB (`47 KB` raw) | +20.21 KB |
| Cold Initialization Latency | **2.143 ms** | 12.093 ms | 12.093 ms |
| Live Subtitle (11 words) Median (P50) | **0.0159 ms (15.9 µs)** | 0.0388 ms (38.8 µs) | 0.0094 ms (9.4 µs) |
| Live Subtitle (11 words) P95 | **0.0206 ms (20.6 µs)** | 0.0484 ms (48.4 µs) | 0.0134 ms (13.4 µs) |
| Batch Transcript (2,200 words) P50 | 1.005 ms | 5.506 ms | **0.828 ms** |
| Lossless Reconstruction | Verified | Verified | N/A |

**Engineering Conclusion:** Although pure Rust executes the tokenization loop in `3.28 µs` natively (and `9.4 µs` when returning a single scalar integer from WASM), returning structured token slices across the JS↔WASM linear-memory boundary (`TextEncoder` + `alloc` + `serde_json` + `TextDecoder` + `JSON.parse`) increases live-cue latency to **`38.8 µs` (2.4× slower than pure TypeScript's `15.9 µs`)**, adds **`+20.21 KB` gzipped** to the extension, adds **`12.1 ms`** cold-start compilation, and allocates **`1.1 MB`** of WASM linear memory pages. Therefore, **TypeScript is strictly superior for live subtitle processing**, while `TextProcessor` keeps the interface open if future offline full-book indexing ever processes megabytes of raw text without per-line JS marshaling.

### 3.2 DOM Rendering & Scoped `MutationObserver`

| Experiment | Strategy A | Strategy B | Measured Result |
| :--- | :--- | :--- | :--- |
| 300 YouTube Comment/Chat Mutations (30 bursts) | Scoped `#movie_player` Observer | Document-Wide `document.body` Observer | **1 callback** vs **31 callbacks** (96.8% wake-up reduction) |
| Interactive Word Span Mounting | Delegated `DocumentFragment` (**3 listeners** fixed) | Per-Word Listeners (**33 listeners/cue**) | `0.285 ms` vs `0.211 ms` P50; delegation eliminates $O(N)$ closure retention across multi-hour videos |

### 3.3 Translation Caching (100 Zipfian Word Hovers across 18 Unique Words)

| Cache Strategy | P50 Latency | Network Calls / 100 Hovers | Reduction |
| :--- | ---: | ---: | ---: |
| **Two-Tier Bounded LRU + IndexedDB** | **0.0223 ms** | **14** | **86% fewer requests** (2.6× faster than IDB-only) |
| IndexedDB-Only | 0.0582 ms | 14 | 86% fewer requests |
| Uncached Direct | 3.0806 ms | 100 | 0% |

### 3.4 Production Bundle Sizes

| Artifact | Raw Size | Gzipped Size |
| :--- | ---: | ---: |
| Extension Content Script (`content.js`, 0 UI framework) | 112.03 KB | **28.48 KB** |
| Extension MV3 Service Worker (`background.js`) | 74.27 KB | **17.35 KB** |
| Extension Popup (`popup.js` + CSS) | 91.02 KB | **23.90 KB** |
| Web Application Styles (`main.css`) | 3.52 KB | **1.18 KB** |
| Web Application Entry (`main.js`) | 60.52 KB | **19.11 KB** |
| Shared Schema Validation Chunk (`index.js`) | 72.38 KB | **17.76 KB** |

---

## 4. Multiobjective Pareto Frontier Analysis (Ch. 15)

Filtering all sampled configurations via exact Pareto dominance ($\mathbf{f}(\mathbf{a}) \le \mathbf{f}(\mathbf{b})$ componentwise with strict inequality in at least one objective) eliminates all `rust-wasm`, `uncached`, and `document-wide` configurations, leaving **3 non-dominated Pareto-optimal designs**:

1. **`cfg-1` (`ts-native` + `delegated-fragment` + `lru+idb` + `scoped-player`) — Selected Production Configuration:**
   - `P95 = 1.60 ms` (10× below the 16 ms frame budget), `RAM = 204 KB`, `Bundle = 28.48 KB`, `NetReqs = 14/100`, and $O(1)$ DOM listeners over arbitrarily long playback sessions.
2. **`cfg-3` (`ts-native` + `per-word-listeners` + `lru+idb` + `scoped-player`):**
   - Trades `+95 KB` closure memory and $O(N)$ listener churn per cue for a `0.44 ms` micro-rendering gain — unnecessary given `1.60 ms` is already well within `16 ms`.
3. **`cfg-4` (`ts-native` + `delegated-fragment` + `idb-only` + `scoped-player`):**
   - Saves `64 KB` of in-memory LRU cache at the expense of async IndexedDB reads on repeated word hovers.
