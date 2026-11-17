/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * A small library of structural cases — initial conditions and what was
 * observed — used to score the ensemble. They are stylized priors, not a
 * recipe for any real operation. Scenarios far from every case are marked
 * as extrapolation.
 */

import { seedDeepWorld, type DeepWorld } from './deepWorld.js';
import { hashSeed } from './rng.js';
import { stepDeepMind } from './stepDeep.js';

export type HistoricalCase = {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly grievance: number;
  readonly legitimacy: number;
  readonly population: number;
  readonly execution: 'dialogue' | 'disperse' | 'sudden' | 'notified_exercise' | 'unnotified_exercise';
  readonly noticeHours: number;
  readonly liveFire: boolean;
  readonly windowHours: number;
  /** 1 if a violent clash was observed. */
  readonly violence: 0 | 1;
  readonly deaths: number;
  readonly injured: number;
};

export const HISTORICAL_CASES: readonly HistoricalCase[] = [
  {
    id: 'announced_price',
    title: '提前说明的价格调整，随后有人对话',
    note: '结构先验：有通知、怨气中等时，多数停留在抱怨和请愿',
    grievance: 0.45,
    legitimacy: 0.58,
    population: 800,
    execution: 'dialogue',
    noticeHours: 72,
    liveFire: false,
    windowHours: 72,
    violence: 0,
    deaths: 0,
    injured: 2,
  },
  {
    id: 'sudden_cut',
    title: '突然取消补贴，没有协商',
    note: '结构先验：高怨气、低认可、突然执行时，出现对峙和投掷的可能性上升',
    grievance: 0.78,
    legitimacy: 0.28,
    population: 2000,
    execution: 'sudden',
    noticeHours: 0,
    liveFire: false,
    windowHours: 72,
    violence: 1,
    deaths: 2,
    injured: 40,
  },
  {
    id: 'rally_talk',
    title: '集会后先谈话',
    note: '结构先验：同一压力下，对话通常压低升级',
    grievance: 0.5,
    legitimacy: 0.5,
    population: 1000,
    execution: 'dialogue',
    noticeHours: 24,
    liveFire: false,
    windowHours: 48,
    violence: 0,
    deaths: 0,
    injured: 0,
  },
  {
    id: 'rally_disperse',
    title: '集会后直接驱散',
    note: '结构先验：驱散在高怨气人群里更容易反弹，但不必然致命',
    grievance: 0.7,
    legitimacy: 0.32,
    population: 1500,
    execution: 'disperse',
    noticeHours: 0,
    liveFire: false,
    windowHours: 48,
    violence: 1,
    deaths: 0,
    injured: 25,
  },
  {
    id: 'exercise_notice',
    title: '提前划出禁区的实弹演训',
    note: '结构先验：通知和禁区把平民误入压得很低',
    grievance: 0.25,
    legitimacy: 0.6,
    population: 500,
    execution: 'notified_exercise',
    noticeHours: 72,
    liveFire: true,
    windowHours: 48,
    violence: 0,
    deaths: 0,
    injured: 0,
  },
  {
    id: 'exercise_none',
    title: '没有通知、靠近居民点的实弹演训',
    note: '结构先验：没有通知时，误入和事故的先验更高；这不是操作说明',
    grievance: 0.4,
    legitimacy: 0.45,
    population: 700,
    execution: 'unnotified_exercise',
    noticeHours: 0,
    liveFire: true,
    windowHours: 48,
    violence: 0,
    deaths: 1,
    injured: 2,
  },
];

export type Prediction = {
  readonly pViolence: number;
  readonly deadP50: number;
  readonly injuredP50: number;
};

export function brierScore(probs: readonly number[], outcomes: readonly number[]): number {
  if (!probs.length || probs.length !== outcomes.length) return 1;
  let s = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = Math.max(0, Math.min(1, probs[i] ?? 0));
    const y = outcomes[i] ?? 0;
    s += (p - y) ** 2;
  }
  return s / probs.length;
}

export function intervalCovered(
  intervals: ReadonlyArray<{ readonly lo: number; readonly hi: number }>,
  actuals: readonly number[],
): number {
  if (!intervals.length) return 0;
  let hit = 0;
  for (let i = 0; i < intervals.length; i++) {
    const band = intervals[i];
    const y = actuals[i] ?? 0;
    if (band && y >= band.lo && y <= band.hi) hit += 1;
  }
  return hit / intervals.length;
}

export function caseDistance(
  row: HistoricalCase,
  probe: { readonly grievance: number; readonly legitimacy: number; readonly liveFire: boolean; readonly noticeHours: number },
): number {
  const fire = row.liveFire === probe.liveFire ? 0 : 0.45;
  const notice = Math.min(1, Math.abs(row.noticeHours - probe.noticeHours) / 72) * 0.25;
  return (
    Math.abs(row.grievance - probe.grievance) +
    Math.abs(row.legitimacy - probe.legitimacy) +
    fire +
    notice
  );
}

export function nearestCase(probe: {
  readonly grievance: number;
  readonly legitimacy: number;
  readonly liveFire: boolean;
  readonly noticeHours: number;
}): { readonly row: HistoricalCase; readonly distance: number; readonly extrapolated: boolean } {
  let best = HISTORICAL_CASES[0]!;
  let dist = Infinity;
  for (const row of HISTORICAL_CASES) {
    const d = caseDistance(row, probe);
    if (d < dist) {
      dist = d;
      best = row;
    }
  }
  return { row: best, distance: dist, extrapolated: dist > 0.55 };
}

export type CalibrationProfile = {
  readonly casualtyScale: number;
  readonly pressureScale: number;
  readonly brier: number;
  readonly coverage: number;
};

async function predictCase(
  row: HistoricalCase,
  profile: { readonly casualtyScale: number; readonly pressureScale: number },
): Promise<Prediction> {
  let world = seedDeepWorld({
    seed: hashSeed(row.id + String(profile.casualtyScale) + String(profile.pressureScale)),
    population: row.population,
    grievance: Math.max(0, Math.min(1, row.grievance * profile.pressureScale)),
    legitimacy: row.legitimacy,
    regionId: 'case',
    core: 8,
    liveFire: row.liveFire,
    noticeHours: row.noticeHours,
  });
  world = { ...world, casualtyScale: profile.casualtyScale };
  const hours = Math.min(18, row.windowHours);
  for (let h = 0; h < hours; h++) {
    const stepped = await stepDeepMind(world, { maxLlmCalls: 0, dtHours: 1 });
    world = stepped.world;
  }
  const cell = world.conflict[0];
  return {
    pViolence: cell && cell.rung >= 5 ? 1 : cell && cell.rung >= 4 ? 0.55 : 0.15,
    deadP50: cell?.deaths ?? 0,
    injuredP50: cell?.injured ?? 0,
  };
}

export async function fitCalibration(): Promise<CalibrationProfile> {
  const grid = [0.75, 1, 1.25];
  let best: CalibrationProfile = {
    casualtyScale: 1,
    pressureScale: 1,
    brier: 1,
    coverage: 0,
  };
  for (const casualtyScale of grid) {
    for (const pressureScale of grid) {
      const preds: Prediction[] = [];
      for (const row of HISTORICAL_CASES) {
        preds.push(await predictCase(row, { casualtyScale, pressureScale }));
      }
      const brier = brierScore(
        preds.map((p) => p.pViolence),
        HISTORICAL_CASES.map((c) => c.violence),
      );
      const coverage = intervalCovered(
        preds.map((p) => ({ lo: Math.max(0, p.deadP50 - 2), hi: p.deadP50 + 3 })),
        HISTORICAL_CASES.map((c) => c.deaths),
      );
      if (brier < best.brier) {
        best = { casualtyScale, pressureScale, brier, coverage };
      }
    }
  }
  return best;
}

export function townForCase(row: HistoricalCase): DeepWorld {
  return seedDeepWorld({
    agents: [{ id: 'a', name: '甲', regionId: 'case' }],
    grievance: row.grievance,
    legitimacy: row.legitimacy,
    population: row.population,
    regionId: 'case',
    liveFire: row.liveFire,
    noticeHours: row.noticeHours,
    core: 4,
  });
}
