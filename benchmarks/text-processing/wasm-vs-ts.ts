import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { tokenizeSubtitle } from '@lexistream/language-core';
import { summarizeDistribution, type DistributionSummary } from '../optimization/pareto';

export interface TextProcessingBenchmarkResult {
  wasmBinaryBytes: number;
  wasmBinaryGzipBytes: number;
  wasmColdInstantiateMs: number;
  tsColdCallMs: number;
  shortCue11Words: {
    ts: DistributionSummary;
    wasmJsonRoundTrip: DistributionSummary;
    wasmScalarCountOnly: DistributionSummary;
    exactMatchVerified: boolean;
  };
  longTranscript2200Words: {
    ts: DistributionSummary;
    wasmJsonRoundTrip: DistributionSummary;
    wasmScalarCountOnly: DistributionSummary;
  };
}

interface WasmExports {
  memory: WebAssembly.Memory;
  wasm_alloc: (size: number) => number;
  wasm_dealloc: (ptr: number, size: number) => void;
  wasm_last_result_len: () => number;
  wasm_tokenize_json: (ptr: number, len: number) => number;
  wasm_count_words: (ptr: number, len: number) => number;
}

export async function runTextProcessingBenchmarks(): Promise<TextProcessingBenchmarkResult> {
  const wasmPath = path.resolve(
    process.cwd(),
    '../target/wasm32-unknown-unknown/release/lexistream_language_wasm.wasm',
  );
  const resolvedWasmPath = fs.existsSync(wasmPath)
    ? wasmPath
    : path.resolve(
        process.cwd(),
        'target/wasm32-unknown-unknown/release/lexistream_language_wasm.wasm',
      );

  const wasmBytes = fs.readFileSync(resolvedWasmPath);
  const wasmGzipBytes = zlib.gzipSync(wasmBytes).byteLength;

  const shortCue = `I never thought this would happen, so don't give up now!`;
  const longTranscript = `${shortCue} `.repeat(200);

  // Measure cold start
  const tTsCold0 = performance.now();
  const tsCheck = tokenizeSubtitle(shortCue, 'en');
  const tsColdCallMs = performance.now() - tTsCold0;

  const tWasmCold0 = performance.now();
  const instantiated = await WebAssembly.instantiate(wasmBytes, {});
  const exports = instantiated.instance.exports as unknown as WasmExports;
  const wasmColdInstantiateMs = performance.now() - tWasmCold0;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const callWasmJson = (input: string) => {
    const encoded = encoder.encode(input);
    const inPtr = exports.wasm_alloc(encoded.byteLength);
    new Uint8Array(exports.memory.buffer, inPtr, encoded.byteLength).set(encoded);
    const outPtr = exports.wasm_tokenize_json(inPtr, encoded.byteLength);
    const outLen = exports.wasm_last_result_len();
    const jsonStr = decoder.decode(
      new Uint8Array(exports.memory.buffer, outPtr, outLen),
    );
    exports.wasm_dealloc(inPtr, encoded.byteLength);
    exports.wasm_dealloc(outPtr, outLen);
    return JSON.parse(jsonStr) as Array<{ text: string; is_word: boolean; normalized: string }>;
  };

  const callWasmCount = (input: string) => {
    const encoded = encoder.encode(input);
    const inPtr = exports.wasm_alloc(encoded.byteLength);
    new Uint8Array(exports.memory.buffer, inPtr, encoded.byteLength).set(encoded);
    const count = exports.wasm_count_words(inPtr, encoded.byteLength);
    exports.wasm_dealloc(inPtr, encoded.byteLength);
    return count;
  };

  const wasmCheck = callWasmJson(shortCue);
  const exactMatchVerified =
    wasmCheck.map((t) => t.text).join('') === tsCheck.map((t) => t.text).join('') &&
    wasmCheck.filter((t) => t.is_word).length === tsCheck.filter((t) => t.isWord).length;

  // Warm-up
  for (let i = 0; i < 40; i++) {
    tokenizeSubtitle(shortCue, 'en');
    callWasmJson(shortCue);
    callWasmCount(shortCue);
  }

  const shortTsSamples: number[] = [];
  const shortWasmJsonSamples: number[] = [];
  const shortWasmScalarSamples: number[] = [];

  for (let i = 0; i < 300; i++) {
    const t0 = performance.now();
    tokenizeSubtitle(shortCue, 'en');
    shortTsSamples.push(performance.now() - t0);

    const t1 = performance.now();
    callWasmJson(shortCue);
    shortWasmJsonSamples.push(performance.now() - t1);

    const t2 = performance.now();
    callWasmCount(shortCue);
    shortWasmScalarSamples.push(performance.now() - t2);
  }

  const longTsSamples: number[] = [];
  const longWasmJsonSamples: number[] = [];
  const longWasmScalarSamples: number[] = [];

  for (let i = 0; i < 40; i++) {
    const t0 = performance.now();
    tokenizeSubtitle(longTranscript, 'en');
    longTsSamples.push(performance.now() - t0);

    const t1 = performance.now();
    callWasmJson(longTranscript);
    longWasmJsonSamples.push(performance.now() - t1);

    const t2 = performance.now();
    callWasmCount(longTranscript);
    longWasmScalarSamples.push(performance.now() - t2);
  }

  return {
    wasmBinaryBytes: wasmBytes.byteLength,
    wasmBinaryGzipBytes: wasmGzipBytes,
    wasmColdInstantiateMs,
    tsColdCallMs,
    shortCue11Words: {
      ts: summarizeDistribution(shortTsSamples),
      wasmJsonRoundTrip: summarizeDistribution(shortWasmJsonSamples),
      wasmScalarCountOnly: summarizeDistribution(shortWasmScalarSamples),
      exactMatchVerified,
    },
    longTranscript2200Words: {
      ts: summarizeDistribution(longTsSamples),
      wasmJsonRoundTrip: summarizeDistribution(longWasmJsonSamples),
      wasmScalarCountOnly: summarizeDistribution(longWasmScalarSamples),
    },
  };
}
