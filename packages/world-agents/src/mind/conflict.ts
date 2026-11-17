/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Escalation is a ladder with a threshold model, not a script. People join
 * when enough others already have. Repression can frighten a crowd or, after
 * deaths, rebound.
 */

import type { ForceKind } from './conflictBaseRates.js';
import { clamp01 } from './rng.js';

export const LADDER = [
  'complaint',
  'petition',
  'rally',
  'strike',
  'standoff',
  'throwing',
  'riot',
  'lethal',
  'organized',
] as const;

export type LadderRung = (typeof LADDER)[number];

export type ConflictCell = {
  readonly regionId: string;
  readonly grievance: number;
  readonly fear: number;
  readonly anger: number;
  readonly efficacy: number;
  readonly legitimacy: number;
  readonly identity: number;
  /** Share of the crowd already visibly involved, 0–1. */
  readonly visible: number;
  readonly rung: number;
  readonly mobilized: number;
  readonly population: number;
  readonly deaths: number;
  readonly injured: number;
  readonly rumorHeat: number;
  /** Mean of "I join once this fraction is already out". */
  readonly thresholdMean: number;
};

export function emptyConflict(regionId: string, population: number): ConflictCell {
  return {
    regionId,
    grievance: 0.35,
    fear: 0.2,
    anger: 0.2,
    efficacy: 0.4,
    legitimacy: 0.55,
    identity: 0.4,
    visible: 0,
    rung: 0,
    mobilized: 0,
    population: Math.max(1, population),
    deaths: 0,
    injured: 0,
    rumorHeat: 0,
    thresholdMean: 0.45,
  };
}

/** Fraction who join when `visible` are already out. Logistic around the mean threshold. */
export function joinShare(cell: ConflictCell): number {
  const shift =
    (cell.grievance - 0.4) * 0.35 +
    (cell.anger - 0.3) * 0.25 +
    (cell.efficacy - 0.4) * 0.2 +
    (0.5 - cell.legitimacy) * 0.2 +
    (cell.identity - 0.4) * 0.1 -
    cell.fear * 0.35 -
    cell.thresholdMean * 0.15;
  const x = cell.visible + shift;
  const share = 1 / (1 + Math.exp(-(x - cell.thresholdMean) * 8));
  return clamp01(share);
}

export type AuthorityResponse =
  | 'concession'
  | 'dialogue'
  | 'disperse'
  | 'arrest'
  | 'lethal'
  | 'none';

export function responseForce(response: AuthorityResponse): ForceKind {
  if (response === 'lethal') return 'firearm';
  if (response === 'disperse') return 'irritant';
  if (response === 'arrest') return 'blunt';
  return 'none';
}

export function applyResponse(cell: ConflictCell, response: AuthorityResponse): ConflictCell {
  if (response === 'concession') {
    return {
      ...cell,
      grievance: clamp01(cell.grievance - 0.12),
      anger: clamp01(cell.anger - 0.08),
      legitimacy: clamp01(cell.legitimacy + 0.08),
      efficacy: clamp01(cell.efficacy - 0.05),
    };
  }
  if (response === 'dialogue') {
    return {
      ...cell,
      legitimacy: clamp01(cell.legitimacy + 0.04),
      anger: clamp01(cell.anger - 0.03),
    };
  }
  if (response === 'disperse') {
    const backlash = cell.grievance > 0.55 ? 0.08 : 0;
    return {
      ...cell,
      fear: clamp01(cell.fear + 0.12),
      anger: clamp01(cell.anger + backlash),
      legitimacy: clamp01(cell.legitimacy - backlash),
      visible: clamp01(cell.visible + (cell.grievance > 0.6 ? 0.07 : 0)),
    };
  }
  if (response === 'arrest') {
    return {
      ...cell,
      fear: clamp01(cell.fear + 0.1),
      grievance: clamp01(cell.grievance + 0.06),
      efficacy: clamp01(cell.efficacy - 0.04),
      legitimacy: clamp01(cell.legitimacy - 0.04),
    };
  }
  if (response === 'lethal') {
    return {
      ...cell,
      fear: clamp01(cell.fear + 0.2),
      anger: clamp01(cell.anger + 0.15),
      legitimacy: clamp01(cell.legitimacy - 0.18),
      grievance: clamp01(cell.grievance + 0.1),
    };
  }
  return cell;
}

/** Deaths attributed to the clash. Fear rises, and legitimacy can break. */
export function applyHarm(
  cell: ConflictCell,
  harm: { readonly dead: number; readonly injured: number },
): ConflictCell {
  const martyr = harm.dead > 0 ? Math.min(0.35, 0.12 + harm.dead * 0.04) : 0;
  return {
    ...cell,
    deaths: cell.deaths + harm.dead,
    injured: cell.injured + harm.injured,
    grievance: clamp01(cell.grievance + martyr + harm.injured * 0.002),
    anger: clamp01(cell.anger + martyr),
    legitimacy: clamp01(cell.legitimacy - martyr),
    fear: clamp01(cell.fear + (harm.dead > 0 ? 0.1 : harm.injured > 0 ? 0.04 : 0)),
    rumorHeat: clamp01(cell.rumorHeat + (harm.dead > 0 ? 0.4 : 0.05)),
  };
}

export function stepConflict(
  cell: ConflictCell,
  input?: {
    readonly response?: AuthorityResponse;
    readonly rumor?: number;
    readonly trigger?: 'death' | 'arrest' | 'funeral' | 'payday' | 'weather' | 'none';
  },
): ConflictCell {
  let next = cell;
  if (input?.response) next = applyResponse(next, input.response);
  if (input?.trigger === 'funeral') {
    next = {
      ...next,
      anger: clamp01(next.anger + 0.1),
      visible: clamp01(next.visible + 0.08),
    };
  }
  if (input?.trigger === 'payday') {
    next = { ...next, grievance: clamp01(next.grievance + 0.04) };
  }
  const rumor = input?.rumor ?? 0;
  next = { ...next, rumorHeat: clamp01(next.rumorHeat * 0.9 + rumor) };
  const share = joinShare(next);
  const visible = clamp01(next.visible * 0.85 + share * 0.35 + next.rumorHeat * 0.05);
  let rung = next.rung;
  if (visible > 0.08 && next.grievance > 0.45 && rung < 2) rung = 2;
  if (visible > 0.18 && next.anger > 0.45 && rung < 4) rung = 4;
  if (visible > 0.48 && next.anger > 0.66 && next.fear < 0.62 && rung < 5) rung = 5;
  if (
    input?.response === 'disperse' &&
    next.grievance > 0.62 &&
    next.anger > 0.5 &&
    visible > 0.2 &&
    rung < 4
  ) {
    rung = Math.min(4, rung + 1);
  }
  if (input?.response === 'lethal') rung = Math.max(rung, 6);
  if (visible > 0.4 && next.anger > 0.7 && rung < 6) rung = 6;
  if (next.deaths > 0 && next.legitimacy < 0.45 && next.anger > 0.55 && rung < 7) rung = 7;
  if (next.fear > 0.7 && next.anger < 0.5) rung = Math.max(0, rung - 1);
  if (next.grievance < 0.3 && next.anger < 0.3) rung = Math.max(0, rung - 1);
  return {
    ...next,
    visible,
    rung,
    mobilized: Math.round(share * next.population),
  };
}

export function violent(cell: ConflictCell): boolean {
  return cell.rung >= 5;
}

export function rungName(rung: number): LadderRung {
  return LADDER[Math.max(0, Math.min(LADDER.length - 1, rung))] ?? 'complaint';
}

const RUNG_LABEL = ['抱怨', '请愿', '聚集', '罢工', '对峙', '投掷', '骚乱', '致死', '有组织'] as const;

export function rungLabel(rung: number): string {
  return RUNG_LABEL[Math.max(0, Math.min(RUNG_LABEL.length - 1, Math.floor(rung)))] ?? '平静';
}
