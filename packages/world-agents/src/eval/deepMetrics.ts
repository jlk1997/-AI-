/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scores for the deep town: whether people repeat themselves, whether an
 * escalation has a cause, and whether a forecast is calibrated.
 */

import { brierScore, intervalCovered } from '../mind/calibration.js';
import { runEnsemble, type ForecastScenario } from '../mind/forecast.js';
import { noveltyScore, topicKey } from '../mind/novelty.js';
import { forecastCrowd, type SocietyMind } from '../societyMind.js';

export type TraceStep = {
  readonly hour: number;
  readonly text: string;
  readonly rung: number;
};

export function semanticNovelty(lines: readonly string[]): number {
  if (lines.length < 2) return 1;
  let sum = 0;
  for (let i = 1; i < lines.length; i++) {
    sum += noveltyScore(lines[i] ?? '', lines.slice(0, i));
  }
  return sum / (lines.length - 1);
}

export function topicEvenness(lines: readonly string[]): number {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = topicKey(line);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!counts.size) return 0;
  const total = lines.length || 1;
  let entropy = 0;
  for (const n of counts.values()) {
    const p = n / total;
    entropy -= p * Math.log(p);
  }
  const max = Math.log(counts.size);
  return max > 0 ? entropy / max : 1;
}

const FLUFF = /真有这事|留个心|回头再说|noted|talk later/i;

export function fluffRate(lines: readonly string[]): number {
  if (!lines.length) return 0;
  return lines.filter((line) => FLUFF.test(line) || line.trim().length < 4).length / lines.length;
}

export function personaConsistency(input: {
  readonly lines: readonly string[];
  readonly voice: string;
}): number {
  if (!input.lines.length) return 1;
  const marker = input.voice.slice(0, 2);
  if (!marker) return 1;
  const hit = input.lines.filter((line) => line.includes(marker) || line.length > 6).length;
  return hit / input.lines.length;
}

export function surpriseScore(actions: readonly string[], predictable: readonly string[]): number {
  if (!actions.length) return 0;
  const bag = new Set(predictable);
  const fresh = actions.filter((a) => ![...bag].some((p) => a.includes(p.slice(0, 4)))).length;
  return fresh / actions.length;
}

export function escalationPlausible(trace: readonly TraceStep[]): {
  readonly ok: boolean;
  readonly jumps: number;
} {
  let jumps = 0;
  for (let i = 1; i < trace.length; i++) {
    const prev = trace[i - 1]!;
    const cur = trace[i]!;
    if (cur.rung - prev.rung > 2 && cur.text.length < 4) jumps += 1;
  }
  return { ok: jumps === 0, jumps };
}

export function softeningRate(calls: number, softened: number): number {
  if (calls <= 0) return 0;
  return softened / calls;
}

export { brierScore, intervalCovered };

export async function abReplay(input: {
  readonly mind: SocietyMind;
  readonly scenario: ForecastScenario;
  readonly seed?: number;
}): Promise<{
  readonly classicSpread: number;
  readonly deepViolence: number;
  readonly deepDeadP50: number;
}> {
  const classic = forecastCrowd(input.mind, 8, 20, input.seed ?? 1);
  const last = classic.bands[classic.bands.length - 1];
  const deep = await runEnsemble(input.scenario, {
    deepRuns: 1,
    fastRuns: 40,
    seed: input.seed ?? 1,
  });
  return {
    classicSpread: (last?.supportHi ?? 0) - (last?.supportLo ?? 0),
    deepViolence: deep.violentProbability,
    deepDeadP50: deep.casualties.dead.p50,
  };
}
