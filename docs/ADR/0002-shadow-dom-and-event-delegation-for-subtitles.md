# ADR-0002: Non-Invasive Subtitle Overlay with Shadow DOM Tooltip and Event Delegation

**Date**: 2026-11-15
**Status**: accepted
**Deciders**: Core Engineering

## Context

YouTube continuously mutates `.ytp-caption-segment` nodes during video playback and mutates comment/live-chat containers outside the player. Injecting React/Preact into the Content Script or mutating YouTube's internal caption nodes directly risks layout thrashing, observer feedback loops, style collisions, and high memory usage.

## Decision

We keep YouTube's `.ytp-caption-window-container` untouched for read-only text extraction via a scoped `#movie_player` `MutationObserver`, mount a lightweight sibling overlay using `DocumentFragment` with **3 delegated event listeners** on the container, and isolate the translation tooltip inside an open `ShadowRoot` using pure `createElement` + `textContent`.

## Alternatives Considered

### Alternative 1: Preact/React Component Tree Inside Content Script
- **Pros**: Declarative JSX templating for subtitles and tooltips.
- **Cons**: Adds VDOM diffing on every subtitle cue change and increases Content Script bundle weight.
- **Why not**: Native `DocumentFragment` + `ShadowRoot` achieves `0.285 ms` P50 cue rendering with zero framework runtime in YouTube tabs.

### Alternative 2: Document-Wide `MutationObserver` + Mutating `.ytp-caption-segment` In-Place
- **Pros**: Fewer lines of CSS positioning code.
- **Cons**: Mutating `.ytp-caption-segment` re-triggers observers and conflicts with YouTube's internal player updates; document-wide observers fire on every live-chat/comment mutation.
- **Why not**: Benchmark `benchmarks/extension/dom-and-observer.ts` measured **31 observer callbacks** for document-wide observation vs **1 callback** for `#movie_player`-scoped observation across 30 bursts of 300 comment mutations.

## Consequences

### Positive
- Content Script stays at **28.48 KB gzipped** with zero UI framework overhead.
- Complete CSS encapsulation via Shadow DOM and strict XSS immunity via `textContent`.
- Fixed $O(1)$ listener count regardless of video duration.

### Negative
- Manual DOM construction in `shadow-tooltip.ts` is slightly more verbose than JSX (~90 lines of TypeScript).
