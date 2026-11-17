/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turns a qualitative contact ("irritant used, stones thrown") into counts.
 * The write-up is a factual report: time, place, counts, injury grade, cause.
 */

import {
  contextMultiplier,
  priorFor,
  type ForceKind,
  type RateContext,
} from './conflictBaseRates.js';
import { normal01 } from './rng.js';

export type OutcomeInput = {
  readonly kind: ForceKind;
  readonly peopleInContact: number;
  readonly place: string;
  readonly cause: string;
  readonly simHour: number;
  readonly ctx: RateContext;
  /** From calibration. 1 leaves the prior alone. */
  readonly casualtyScale?: number;
};

export type OutcomeRoll = {
  readonly kind: ForceKind;
  readonly light: number;
  readonly serious: number;
  readonly dead: number;
  readonly arrested: number;
  readonly propertyLoss: number;
  readonly report: string;
  readonly source: string;
  readonly confidence: number;
};

/** Small means must stay Poisson. Rounding a normal draw turns a rare death into zero. */
function hits(people: number, per100: number, rng: () => number, scale: number): number {
  const n = Math.max(0, Math.round(people));
  const p = Math.max(0, (per100 / 100) * scale);
  if (n === 0 || p === 0) return 0;
  const mean = Math.min(n, n * p);
  if (mean >= 12) {
    const z = normal01(rng);
    return Math.max(0, Math.min(n, Math.round(mean + Math.sqrt(mean) * z)));
  }
  const limit = Math.exp(-mean);
  let k = 0;
  let draw = 1;
  do {
    k += 1;
    draw *= rng();
  } while (draw > limit && k <= n);
  return k - 1;
}

export function rollOutcome(input: OutcomeInput, rng: () => number): OutcomeRoll {
  const prior = priorFor(input.kind);
  const scale =
    contextMultiplier(input.kind, input.ctx) * (input.casualtyScale ?? 1);
  const people = Math.max(0, Math.round(input.peopleInContact));
  const light = hits(people, prior.lightPer100, rng, scale);
  const serious = hits(people, prior.seriousPer100, rng, scale);
  const dead = hits(people, prior.deadPer100, rng, scale);
  const arrested = hits(people, prior.arrestedPer100, rng, scale);
  const propertyLoss = Math.round(
    (input.kind === 'fire' || input.kind === 'thrown' ? 1 : 0.2) *
      people *
      scale *
      rng(),
  );
  const report = factualReport({
    simHour: input.simHour,
    place: input.place,
    cause: input.cause,
    light,
    serious,
    dead,
    arrested,
  });
  return {
    kind: input.kind,
    light,
    serious,
    dead,
    arrested,
    propertyLoss,
    report,
    source: prior.source,
    confidence: prior.confidence,
  };
}

/**
 * Conditional severity once an accident has already happened.
 * Rates are low-confidence priors for the people in the footprint, not a method.
 */
export function rollIncident(
  kind: 'exercise' | 'intrusion' | 'traffic' | 'crush' | 'fire',
  input: {
    readonly noticeHours: number;
    readonly near: boolean;
    readonly liveFire: boolean;
    readonly simHour: number;
    readonly place: string;
  },
  rng: () => number,
): OutcomeRoll {
  const noticed = input.noticeHours >= 24;
  const exposed = kind === 'exercise' || kind === 'intrusion';
  let pDeath = 0.04;
  let pSerious = 0.12;
  let pLight = 0.35;
  if (exposed && input.liveFire && input.near && !noticed) {
    pDeath = 0.22;
    pSerious = 0.35;
    pLight = 0.55;
  } else if (exposed && input.near && !noticed) {
    pDeath = 0.1;
    pSerious = 0.22;
    pLight = 0.4;
  } else if (noticed) {
    pDeath = 0.03;
    pSerious = 0.08;
    pLight = 0.18;
  }
  if (kind === 'crush') {
    pDeath = 0.15;
    pSerious = 0.3;
    pLight = 0.5;
  }
  const dead = rng() < pDeath ? 1 + (rng() < 0.15 ? 1 : 0) : 0;
  const serious = rng() < pSerious ? 1 + Math.floor(rng() * 3) : 0;
  const light = rng() < pLight ? 1 + Math.floor(rng() * 5) : 0;
  const cause =
    kind === 'exercise'
      ? '演训事故（结果结算，不含做法）'
      : kind === 'intrusion'
        ? '有人进入已封闭的区域'
        : kind === 'traffic'
          ? '车辆事故'
          : kind === 'crush'
            ? '人群拥挤'
            : '起火';
  return {
    kind: kind === 'exercise' || kind === 'intrusion' ? 'exercise_accident' : kind === 'traffic' ? 'vehicle' : kind,
    light,
    serious,
    dead,
    arrested: kind === 'intrusion' && rng() < 0.4 ? 1 : 0,
    propertyLoss: kind === 'fire' ? 5 : 0,
    report: factualReport({
      simHour: input.simHour,
      place: input.place,
      cause,
      light,
      serious,
      dead,
      arrested: 0,
    }),
    source: 'conditional incident prior, low confidence',
    confidence: noticed ? 0.35 : 0.22,
  };
}

export function factualReport(input: {
  readonly simHour: number;
  readonly place: string;
  readonly cause: string;
  readonly light: number;
  readonly serious: number;
  readonly dead: number;
  readonly arrested: number;
}): string {
  const hour = Math.floor(((input.simHour % 24) + 24) % 24);
  return `模拟第 ${input.simHour.toFixed(1)} 小时（约 ${hour} 点），${input.place}：${input.cause}。轻伤 ${input.light}，重伤 ${input.serious}，死亡 ${input.dead}，被限制人身自由 ${input.arrested}。`;
}
