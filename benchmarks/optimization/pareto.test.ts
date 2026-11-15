import { describe, expect, it } from 'vitest';
import {
  computeParetoFrontier,
  dominates,
  generateFractionalSamplingPlan,
  summarizeDistribution,
  type EvaluatedConfiguration,
} from './pareto';

describe('Multiobjective Optimization & Sampling Plans (Kochenderfer & Wheeler Ch. 1, 15, 16, 20)', () => {
  it('identifies Pareto-optimal non-dominated configurations while rejecting infeasible designs', () => {
    const configs: EvaluatedConfiguration[] = [
      {
        id: 'cfg-ts-delegated-lru',
        variables: { tokenizer: 'ts', dom: 'delegated', cache: 'lru+idb', observer: 'scoped' },
        objectives: {
          p95LatencyMs: 0.42,
          memoryKb: 180,
          cpuMsPer100Cues: 4.1,
          bundleGzipKb: 29.0,
          networkRequestsPer100Hovers: 18,
        },
        feasible: true,
        constraintViolations: [],
      },
      {
        id: 'cfg-wasm-delegated-lru',
        variables: { tokenizer: 'wasm', dom: 'delegated', cache: 'lru+idb', observer: 'scoped' },
        objectives: {
          // Slightly worse single-cue P95 and larger bundle due to +20KB WASM binary -> strictly dominated for live cues!
          p95LatencyMs: 0.68,
          memoryKb: 310,
          cpuMsPer100Cues: 5.5,
          bundleGzipKb: 49.0,
          networkRequestsPer100Hovers: 18,
        },
        feasible: true,
        constraintViolations: [],
      },
      {
        id: 'cfg-ts-delegated-idb-only',
        variables: { tokenizer: 'ts', dom: 'delegated', cache: 'idb-only', observer: 'scoped' },
        objectives: {
          // Slower P95 than LRU, but slightly lower RAM -> non-dominated trade-off!
          p95LatencyMs: 1.95,
          memoryKb: 120,
          cpuMsPer100Cues: 6.2,
          bundleGzipKb: 28.5,
          networkRequestsPer100Hovers: 18,
        },
        feasible: true,
        constraintViolations: [],
      },
      {
        id: 'cfg-infeasible-heavy',
        variables: { tokenizer: 'wasm', dom: 'per-node', cache: 'none', observer: 'document' },
        objectives: {
          p95LatencyMs: 24.0,
          memoryKb: 90,
          cpuMsPer100Cues: 40.0,
          bundleGzipKb: 65.0,
          networkRequestsPer100Hovers: 100,
        },
        feasible: false,
        constraintViolations: ['p95LatencyMs > 16ms frame budget'],
      },
    ];

    expect(dominates(configs[0]!.objectives, configs[1]!.objectives)).toBe(true);
    expect(dominates(configs[0]!.objectives, configs[2]!.objectives)).toBe(false);

    const result = computeParetoFrontier(configs);
    expect(result.paretoFront.map((c) => c.id)).toEqual([
      'cfg-ts-delegated-lru',
      'cfg-ts-delegated-idb-only',
    ]);
    expect(result.dominated[0]?.id).toBe('cfg-wasm-delegated-lru');
    expect(result.infeasible[0]?.id).toBe('cfg-infeasible-heavy');
  });

  it('generates balanced fractional-factorial sampling plans covering every level of every design variable', () => {
    const plan = generateFractionalSamplingPlan({
      tokenizer: ['ts', 'wasm'],
      dom: ['delegated', 'per-node'],
      cache: ['lru+idb', 'idb-only', 'none'],
      observer: ['scoped', 'document'],
    });

    // Strictly smaller than full factorial (2 * 2 * 3 * 2 = 24) while covering every factor value
    expect(plan.length).toBeLessThan(24);
    expect(new Set(plan.map((p) => p.tokenizer)).size).toBe(2);
    expect(new Set(plan.map((p) => p.dom)).size).toBe(2);
    expect(new Set(plan.map((p) => p.cache)).size).toBe(3);
    expect(new Set(plan.map((p) => p.observer)).size).toBe(2);
  });

  it('computes accurate median, P95, and P99 latency percentiles under uncertainty', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    const stats = summarizeDistribution(samples);
    expect(stats.p50).toBeCloseTo(50.5, 1);
    expect(stats.p95).toBeGreaterThanOrEqual(95);
    expect(stats.p99).toBeGreaterThanOrEqual(99);
  });
});
