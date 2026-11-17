/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Order-of-magnitude priors for "what fraction of people in contact are hurt".
 * These are not instructions and not a claim of precision. Calibration may
 * replace the multipliers. Sources are named so a report can show them.
 *
 * - Threshold dynamics: Granovetter, AJS, 1978.
 * - Most demonstrations are not fatal events: structural prior aligned with
 *   how ACLED separates demonstrations from violent events. The 0.08 figure
 *   is a prior, not a published ACLED statistic.
 * - Crowd density: Fruin's level-of-service work — crush risk rises sharply
 *   once a crowd cannot move.
 * - Live-fire training near civilians: a low prior when notice and an
 *   exclusion zone exist, higher when they do not. Confidence stays low
 *   because published training-accident rates differ by country and year.
 */

export type ForceKind =
  | 'none'
  | 'unarmed'
  | 'thrown'
  | 'blunt'
  | 'irritant'
  | 'less_lethal'
  | 'firearm'
  | 'exercise_accident'
  | 'vehicle'
  | 'crush'
  | 'fire'
  | 'collapse';

export type RatePrior = {
  readonly id: ForceKind;
  readonly source: string;
  readonly confidence: number;
  /** Chance a contact of this kind produces any violent clash. */
  readonly pViolent: number;
  /** Expected lightly injured people per 100 in contact. */
  readonly lightPer100: number;
  readonly seriousPer100: number;
  readonly deadPer100: number;
  readonly arrestedPer100: number;
};

export const RATE_PRIORS: readonly RatePrior[] = [
  {
    id: 'none',
    source: 'no contact',
    confidence: 0.8,
    pViolent: 0,
    lightPer100: 0,
    seriousPer100: 0,
    deadPer100: 0,
    arrestedPer100: 0,
  },
  {
    id: 'unarmed',
    source: 'structural prior: most demonstrations stay nonviolent',
    confidence: 0.4,
    pViolent: 0.08,
    lightPer100: 0.4,
    seriousPer100: 0.05,
    deadPer100: 0.005,
    arrestedPer100: 0.3,
  },
  {
    id: 'thrown',
    source: 'prior for stone-throwing contact; calibrate',
    confidence: 0.3,
    pViolent: 0.55,
    lightPer100: 4,
    seriousPer100: 0.6,
    deadPer100: 0.04,
    arrestedPer100: 2,
  },
  {
    id: 'blunt',
    source: 'prior for baton or stick contact; calibrate',
    confidence: 0.3,
    pViolent: 0.7,
    lightPer100: 8,
    seriousPer100: 1.2,
    deadPer100: 0.08,
    arrestedPer100: 3,
  },
  {
    id: 'irritant',
    source: 'prior for crowd-control irritant dispersal; calibrate',
    confidence: 0.35,
    pViolent: 0.35,
    lightPer100: 6,
    seriousPer100: 0.4,
    deadPer100: 0.02,
    arrestedPer100: 1.5,
  },
  {
    id: 'less_lethal',
    source: 'prior for impact or less-lethal rounds; calibrate',
    confidence: 0.3,
    pViolent: 0.6,
    lightPer100: 7,
    seriousPer100: 1.5,
    deadPer100: 0.15,
    arrestedPer100: 2,
  },
  {
    id: 'firearm',
    source: 'prior: firearm discharge into a crowd raises deaths sharply; calibrate',
    confidence: 0.25,
    pViolent: 0.95,
    lightPer100: 10,
    seriousPer100: 4,
    deadPer100: 1.2,
    arrestedPer100: 2,
  },
  {
    id: 'exercise_accident',
    source: 'prior for a notified live-fire exclusion zone; see notice modifier',
    confidence: 0.25,
    pViolent: 0.02,
    lightPer100: 0.2,
    seriousPer100: 0.05,
    deadPer100: 0.02,
    arrestedPer100: 0.05,
  },
  {
    id: 'vehicle',
    source: 'prior for training or crowd vehicle contact',
    confidence: 0.3,
    pViolent: 0.15,
    lightPer100: 1.5,
    seriousPer100: 0.4,
    deadPer100: 0.08,
    arrestedPer100: 0.1,
  },
  {
    id: 'crush',
    source: 'Fruin: crush risk when a crowd cannot move',
    confidence: 0.45,
    pViolent: 0.2,
    lightPer100: 5,
    seriousPer100: 1.5,
    deadPer100: 0.3,
    arrestedPer100: 0,
  },
  {
    id: 'fire',
    source: 'prior for an urban fire with medical access varying',
    confidence: 0.3,
    pViolent: 0.1,
    lightPer100: 3,
    seriousPer100: 1,
    deadPer100: 0.2,
    arrestedPer100: 0,
  },
  {
    id: 'collapse',
    source: 'prior for a structural collapse',
    confidence: 0.3,
    pViolent: 0.05,
    lightPer100: 4,
    seriousPer100: 2,
    deadPer100: 0.5,
    arrestedPer100: 0,
  },
];

export function priorFor(kind: ForceKind): RatePrior {
  return RATE_PRIORS.find((row) => row.id === kind) ?? RATE_PRIORS[0]!;
}

export type RateContext = {
  readonly density: 'sparse' | 'crowd' | 'crush';
  readonly minutes: number;
  readonly medicalAccess: boolean;
  readonly noticeHours: number;
  readonly weather: 'clear' | 'rain' | 'hot';
};

/** Multipliers on the prior. Never invents a procedure. */
export function contextMultiplier(kind: ForceKind, ctx: RateContext): number {
  let m = 1;
  if (ctx.density === 'crowd') m *= 1.4;
  if (ctx.density === 'crush') m *= kind === 'crush' ? 3 : 1.8;
  if (ctx.minutes > 60) m *= 1.3;
  if (!ctx.medicalAccess) m *= 1.25;
  if (ctx.weather === 'hot' && (kind === 'crush' || kind === 'irritant')) m *= 1.2;
  if (kind === 'exercise_accident') {
    if (ctx.noticeHours >= 24) m *= 0.35;
    else if (ctx.noticeHours <= 0) m *= 2.2;
  }
  return m;
}
