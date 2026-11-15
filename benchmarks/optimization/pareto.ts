/**
 * Mathematical Optimization & Sampling Framework
 * Grounded in Mykel J. Kochenderfer & Tim A. Wheeler, *Algorithms for Optimization*:
 * - Ch. 1: Problem formulation (design variables, objective vector, constraints)
 * - Ch. 15: Multiobjective optimization & exact Pareto frontier filtering
 * - Ch. 16: Structured Latin-hypercube / fractional-factorial sampling plans
 * - Ch. 20: Optimization under uncertainty (percentile & worst-case statistics)
 * - Ch. 22: Discrete architectural choice evaluation
 */

export interface ObjectiveVector {
  p95LatencyMs: number;
  memoryKb: number;
  cpuMsPer100Cues: number;
  bundleGzipKb: number;
  networkRequestsPer100Hovers: number;
}

export interface EvaluatedConfiguration {
  id: string;
  variables: Record<string, string>;
  objectives: ObjectiveVector;
  feasible: boolean;
  constraintViolations: string[];
}

export interface ParetoAnalysisResult {
  paretoFront: EvaluatedConfiguration[];
  dominated: Array<EvaluatedConfiguration & { dominatedBy: string }>;
  infeasible: EvaluatedConfiguration[];
}

export interface DistributionSummary {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  stdDev: number;
}

const OBJECTIVE_KEYS: Array<keyof ObjectiveVector> = [
  'p95LatencyMs',
  'memoryKb',
  'cpuMsPer100Cues',
  'bundleGzipKb',
  'networkRequestsPer100Hovers',
];

/**
 * Returns true iff `a` Pareto-dominates `b` (all minimization objectives <=, at least one strictly <).
 */
export function dominates(a: ObjectiveVector, b: ObjectiveVector): boolean {
  let strictlyBetterInAtLeastOne = false;
  for (const key of OBJECTIVE_KEYS) {
    if (a[key] > b[key]) return false;
    if (a[key] < b[key]) strictlyBetterInAtLeastOne = true;
  }
  return strictlyBetterInAtLeastOne;
}

export function computeParetoFrontier(
  configs: EvaluatedConfiguration[],
): ParetoAnalysisResult {
  const feasible = configs.filter((c) => c.feasible);
  const infeasible = configs.filter((c) => !c.feasible);

  const paretoFront: EvaluatedConfiguration[] = [];
  const dominated: Array<EvaluatedConfiguration & { dominatedBy: string }> = [];

  for (const candidate of feasible) {
    const dominator = feasible.find(
      (other) => other.id !== candidate.id && dominates(other.objectives, candidate.objectives),
    );
    if (dominator) {
      dominated.push({ ...candidate, dominatedBy: dominator.id });
    } else {
      paretoFront.push(candidate);
    }
  }

  return { paretoFront, dominated, infeasible };
}

/**
 * Generates an orthogonal / cyclic fractional-factorial sampling plan (Ch. 16)
 * covering all single-variable perturbations around the baseline + stratified Latin combinations.
 */
export function generateFractionalSamplingPlan<T extends Record<string, readonly string[]>>(
  space: T,
): Array<{ [K in keyof T]: T[K][number] }> {
  const keys = Object.keys(space) as Array<keyof T>;
  const seen = new Set<string>();
  const samples: Array<{ [K in keyof T]: T[K][number] }> = [];

  const pushUnique = (cfg: { [K in keyof T]: T[K][number] }) => {
    const sig = keys.map((k) => `${String(k)}=${cfg[k]}`).join('|');
    if (!seen.has(sig)) {
      seen.add(sig);
      samples.push(cfg);
    }
  };

  // Baseline anchor (level 0 of every factor)
  const baseline = {} as { [K in keyof T]: T[K][number] };
  for (const k of keys) {
    const levels = space[k]!;
    baseline[k] = levels[0]!;
  }
  pushUnique(baseline);

  // One-at-a-time orthogonal factor sweeps
  for (const k of keys) {
    const levels = space[k]!;
    for (const level of levels) {
      pushUnique({ ...baseline, [k]: level });
    }
  }

  // Cyclic Latin-style cross-factor interaction points
  const maxArity = Math.max(...keys.map((k) => space[k]!.length));
  for (let s = 0; s < maxArity * 2; s++) {
    const point = {} as { [K in keyof T]: T[K][number] };
    keys.forEach((k, idx) => {
      const levels = space[k]!;
      point[k] = levels[(s + idx) % levels.length]!;
    });
    pushUnique(point);
  }

  return samples;
}

export function summarizeDistribution(rawSamples: number[]): DistributionSummary {
  if (rawSamples.length === 0) {
    return { count: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0, stdDev: 0 };
  }
  const sorted = [...rawSamples].sort((a, b) => a - b);
  const n = sorted.length;
  const quantile = (q: number) => {
    const pos = (n - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = sorted[base + 1] ?? sorted[base]!;
    return sorted[base]! + rest * (next - sorted[base]!);
  };

  const mean = sorted.reduce((acc, v) => acc + v, 0) / n;
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;

  return {
    count: n,
    min: sorted[0]!,
    p50: quantile(0.5),
    p95: quantile(0.95),
    p99: quantile(0.99),
    max: sorted[n - 1]!,
    mean,
    stdDev: Math.sqrt(variance),
  };
}
