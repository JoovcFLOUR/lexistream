# ADR-0006: On-Demand Downloadable Wiktionary (CC BY-SA) Dictionaries Over Pre-Bundled Lexicons or Mandatory Paid APIs

**Date**: 2026-11-15
**Status**: accepted
**Deciders**: Product Owner & Core Engineering

## Context

Relying primarily on proprietary translation APIs (such as DeepL) requires user API keys or paid quotas, while bundling 10+ full bilingual dictionaries (`en-pt`, `fr-pt`, `fr-en`, `es-pt`, `en-de`, `it-pt`, etc., ~35 MB total) inside the browser extension would bloat every installation with language pairs a given learner never uses.

## Decision

We integrate **Wiktionary** (licensed under Creative Commons `CC BY-SA 3.0 / 4.0`) through two complementary layers while keeping DeepL strictly optional:
1. **On-Demand Offline Wiktionary Dictionary Manager (`WiktionaryDictionaryStore` + `DictionariesPage`):** Ships with **0 bytes** of pre-installed heavy dictionaries. Users browse 11 language pairs (`en-pt`, `pt-en`, `fr-pt`, `fr-en`, `en-fr`, `es-pt`, `es-en`, `en-es`, `en-de`, `it-pt`, `it-en`), click **Baixar** only on the pairs they study, index headwords/POS/glosses into IndexedDB in batched 2,500-entry chunks, and can uninstall any pair at any time.
2. **Live Wiktionary CC BY-SA 4.0 Fallback (`LiveWiktionaryApiProvider`):** Queries Wiktionary's CC BY-SA 4.0 REST entries (with automatic lemma redirection for inflected verbs/plurals) when online if a user has not downloaded an offline pack yet.

## Alternatives Considered

### Alternative 1: Pre-Bundling All Dictionaries Inside the Extension ZIP
- **Pros**: Immediate offline coverage for every language without clicking Download.
- **Cons**: Inflates the extension from `~330 KB` to `> 35 MB` and wastes disk/RAM on unused languages.
- **Why not**: Violates minimal footprint principles and user preference for opt-in installation.

### Alternative 2: Mandatory DeepL / Paid Cloud Translation Only
- **Pros**: Full neural machine translation for arbitrary sentences.
- **Cons**: Requires API keys, internet connectivity, and external vendor dependency.
- **Why not**: Kept only as an optional backend proxy (`DEEPL_API_KEY`); Wiktionary CC BY-SA provides open, free, offline-capable lexical definitions and translations.

## Consequences

### Positive
- Base extension remains ~345 KB unpacked with zero pre-installed dictionary bloat.
- Once a user clicks **Baixar** on a pair (e.g., `Inglês → Português`, ~44,700 Wiktionary glosses), subtitle word lookups resolve in `< 1 ms` 100% offline across all YouTube tabs via the MV3 background bridge.
- Full Creative Commons (`CC BY-SA`) attribution and one-click uninstallation.

### Negative
- Bridge-synthesized pairs (`fr-pt`, `es-pt`, `it-pt`) download two ~2.5 MB Wiktionary source files once during initial indexing (~3–5 seconds) before storing the unified pair locally.
