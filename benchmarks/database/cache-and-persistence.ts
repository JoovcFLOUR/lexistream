import 'fake-indexeddb/auto';
import { performance } from 'node:perf_hooks';
import {
  IndexedDbTranslationCache,
  TranslationService,
  type TranslationProvider,
} from '@lexistream/translation-providers';
import type { TranslationRequest, TranslationResult } from '@lexistream/shared-types';
import { summarizeDistribution, type DistributionSummary } from '../optimization/pareto';

export interface CacheBenchmarkResult {
  twoTierLruPlusIdb: {
    latencyMs: DistributionSummary;
    networkCalls: number;
  };
  idbOnlyNoMemoryLru: {
    latencyMs: DistributionSummary;
    networkCalls: number;
  };
  uncachedDirect: {
    latencyMs: DistributionSummary;
    networkCalls: number;
  };
}

function createSimulatedNetworkProvider(
  simulatedRttMs: number,
  counter: { calls: number },
): TranslationProvider {
  return {
    id: 'simulated-remote-provider',
    async translate(req: TranslationRequest): Promise<TranslationResult> {
      counter.calls++;
      await new Promise((r) => setTimeout(r, simulatedRttMs));
      return {
        word: req.word,
        lemma: req.word.toLowerCase(),
        part_of_speech: 'noun',
        contextual_translation: `${req.word}-pt`,
        definition: 'Benchmark definition',
        context_sentence: req.context,
        context_translation: `${req.context}-pt`,
        meanings: [],
        provider: 'simulated-remote-provider',
        cached: false,
      };
    },
  };
}

export async function runCacheBenchmarks(): Promise<CacheBenchmarkResult> {
  // Realistic Zipfian hover trace: 18 unique words across 100 hover interactions
  const vocabPool = Array.from({ length: 18 }, (_, i) => `word_${i}`);
  const hoverSequence: TranslationRequest[] = Array.from({ length: 100 }, (_, i) => {
    // High-frequency words repeat often (Zipf-like skew)
    const idx = i % 3 === 0 ? i % 4 : i % vocabPool.length;
    const word = vocabPool[idx]!;
    return {
      word,
      context: `Example sentence containing ${word}.`,
      source_language: 'en',
      target_language: 'pt',
    };
  });

  // 1. Two-tier LRU + IndexedDB
  const twoTierCounter = { calls: 0 };
  const twoTierService = new TranslationService({
    providers: [createSimulatedNetworkProvider(3, twoTierCounter)],
    persistentCache: new IndexedDbTranslationCache('bench-cache-two-tier'),
    memoryCacheSize: 256,
  });
  const twoTierSamples: number[] = [];
  for (const req of hoverSequence) {
    const t0 = performance.now();
    await twoTierService.translate(req);
    twoTierSamples.push(performance.now() - t0);
  }

  // 2. IndexedDB-only (simulate tiny/bypassed memory cache by reading persistent IDB directly)
  const idbCounter = { calls: 0 };
  const idbStore = new IndexedDbTranslationCache('bench-cache-idb-only');
  const rawProvider = createSimulatedNetworkProvider(3, idbCounter);
  const idbSamples: number[] = [];
  for (const req of hoverSequence) {
    const key = `${req.source_language}:${req.target_language}:${req.word}:${req.context}`;
    const t0 = performance.now();
    const hit = await idbStore.get(key);
    if (!hit) {
      const fresh = await rawProvider.translate(req);
      await idbStore.set(key, fresh);
    }
    idbSamples.push(performance.now() - t0);
  }

  // 3. Uncached direct calls
  const uncachedCounter = { calls: 0 };
  const uncachedProvider = createSimulatedNetworkProvider(3, uncachedCounter);
  const uncachedSamples: number[] = [];
  for (const req of hoverSequence) {
    const t0 = performance.now();
    await uncachedProvider.translate(req);
    uncachedSamples.push(performance.now() - t0);
  }

  return {
    twoTierLruPlusIdb: {
      latencyMs: summarizeDistribution(twoTierSamples),
      networkCalls: twoTierCounter.calls,
    },
    idbOnlyNoMemoryLru: {
      latencyMs: summarizeDistribution(idbSamples),
      networkCalls: idbCounter.calls,
    },
    uncachedDirect: {
      latencyMs: summarizeDistribution(uncachedSamples),
      networkCalls: uncachedCounter.calls,
    },
  };
}
