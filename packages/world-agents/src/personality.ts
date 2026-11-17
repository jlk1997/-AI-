/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-resident temperament, derived from the Spec identity text.
 *
 * Occupation alone shaped the heuristic day, so twelve residents with twelve
 * different jobs still walked one shared route: work, then the square at the
 * same hour, then bed. Temperament is the second axis — it decides *when* and
 * *where* someone shows up in public, and how often they leave the route.
 */

import { unitHash } from './anchors.js';

export interface Temperament {
  /** 0..1 — appetite for public time; drives hub hour, place and dwell. */
  readonly sociability: number;
  /** 0..1 — chance of an off-route errand on any given day. */
  readonly wanderlust: number;
  /** 0..1 — how tightly they hold to shift hours (low = drifts more). */
  readonly punctuality: number;
}

interface TraitRule {
  readonly match: RegExp;
  readonly sociability?: number;
  readonly wanderlust?: number;
  readonly punctuality?: number;
}

/**
 * Spec `personality` / `traits` land in `identitySummary` as free text, so the
 * cues are matched rather than parsed. Values are pulls in -1..1 toward a pole,
 * not deltas: a resident the Spec calls "健谈" must actually read as outgoing,
 * however their hash fell, while unlabelled residents stay spread by the hash.
 */
const TRAIT_RULES: readonly TraitRule[] = [
  {
    match: /孤僻|内向|寡言|沉默|害羞|怕生|独来独往|shy|reclusive|withdrawn|quiet|solitary/i,
    sociability: -0.6,
  },
  {
    match: /热心|好客|健谈|爱聊|开朗|外向|八卦|多话|gregarious|outgoing|chatty|talkative|sociable|gossip/i,
    sociability: 0.6,
  },
  {
    match: /好奇|爱打听|探险|不安分|冒险|游荡|curious|inquisitive|restless|wanderer|adventurous/i,
    wanderlust: 0.55,
    sociability: 0.15,
  },
  {
    match: /恋家|安分|守旧|谨小慎微|homebody|cautious|timid|traditional/i,
    wanderlust: -0.55,
  },
  {
    match: /严谨|守时|一丝不苟|勤勉|刻苦|punctual|meticulous|diligent|disciplined/i,
    punctuality: 0.55,
  },
  {
    match: /散漫|懒|随性|拖沓|迷糊|lazy|sloppy|absent-minded|erratic/i,
    punctuality: -0.55,
    wanderlust: 0.25,
  },
];

/** Move `v` toward 1 (positive pull) or 0 (negative), never past the pole. */
function pull(v: number, amount: number): number {
  if (!amount) return v;
  return amount > 0 ? v + (1 - v) * amount : v + v * amount;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Deterministic per-resident temperament. Same seed and identity always give
 * the same answer, so replays and reloads keep the same town.
 */
export function temperamentFor(
  seed: string,
  identityText?: string,
): Temperament {
  // Centred on 0.5 with a ±0.3 spread: the hash alone already differentiates,
  // and the trait cues then push a resident to either end.
  let sociability = 0.2 + unitHash(`soc:${seed}`) * 0.6;
  let wanderlust = 0.15 + unitHash(`wan:${seed}`) * 0.55;
  let punctuality = 0.25 + unitHash(`pun:${seed}`) * 0.6;
  const text = identityText ?? '';
  if (text) {
    for (const rule of TRAIT_RULES) {
      if (!rule.match.test(text)) continue;
      sociability = pull(sociability, rule.sociability ?? 0);
      wanderlust = pull(wanderlust, rule.wanderlust ?? 0);
      punctuality = pull(punctuality, rule.punctuality ?? 0);
    }
  }
  return {
    sociability: clamp01(sociability),
    wanderlust: clamp01(wanderlust),
    punctuality: clamp01(punctuality),
  };
}

/**
 * True on the days this resident breaks their route for an errand. Seeded by
 * day so it is stable within a day but different across days and residents.
 */
export function hasErrandToday(
  seed: string,
  dayIndex: number,
  wanderlust: number,
): boolean {
  if (wanderlust <= 0.2) return false;
  return unitHash(`errand:${seed}:${dayIndex}`) < wanderlust * 0.55;
}
