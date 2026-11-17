/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Drives (hunger / energy / social / curiosity).
 *
 * The cognition loop already had a `replan` reaction, but nothing ever
 * requested one, so residents executed their schedule verbatim forever and the
 * town read as scripted. Drives are what make an agent abandon its plan — the
 * cheapest available source of the "they decided that themselves" feeling.
 *
 * Values run 0 (satisfied) → 1 (desperate) so "urgent" is always "high".
 */

import type { AnchorKind } from './anchors.js';

export const NEED_KINDS = ['hunger', 'energy', 'social', 'curiosity'] as const;
export type NeedKind = (typeof NEED_KINDS)[number];
export type Needs = Record<NeedKind, number>;

/** Rise per sim hour when nothing is being done about it. */
const DECAY_PER_HOUR: Needs = {
  hunger: 0.14,
  energy: 0.07,
  social: 0.1,
  curiosity: 0.06,
};

/** Fall per sim hour while the matching activity is happening. */
const RELIEF_PER_HOUR: Needs = {
  hunger: 0.9,
  energy: 0.35,
  social: 0.8,
  curiosity: 0.5,
};

/** Above this an agent will break its schedule. */
export const URGENT_THRESHOLD = 0.72;

const SATISFIES: Record<NeedKind, RegExp> = {
  hunger:
    /吃|早饭|早餐|午饭|午餐|晚饭|晚餐|用餐|下厨|做饭|eat|meal|breakfast|lunch|dinner|galley|refectory|stew|bread/i,
  energy:
    /睡|休息|打盹|歇|回家|洗漱|sleep|rest|nap|bunk|cell|quarters|off-watch|off watch/i,
  social:
    /聊|社交|闲聊|聚会|派对|串门|打听|议论|喝酒|喝茶|咖啡|赴约|talk|chat|social|party|handoff|vespers|gathering|promised|meet at/i,
  curiosity:
    /学习|读书|研究|练习|上课|查看|探索|打听|study|learn|read|explore|investigate|notice|duty log|vespers/i,
};

const NEED_LABEL: Record<NeedKind, string> = {
  hunger: '饿了',
  energy: '累了',
  social: '想找人说说话',
  curiosity: '心里有个问题没想通',
};

const NEED_ACTIVITY: Record<NeedKind, string> = {
  hunger: '去炉边找点热的吃',
  energy: '回床上躺一会儿',
  social: '找人聊两句',
  curiosity: '去布告栏看看有什么新消息',
};

const NEED_ANCHOR: Record<NeedKind, AnchorKind> = {
  hunger: 'food',
  energy: 'rest',
  social: 'social',
  curiosity: 'learn',
};

export type NeedClockKind = 'diurnal' | 'watch' | 'event';

function needLabel(kind: NeedKind, ascii: boolean): string {
  if (!ascii) return NEED_LABEL[kind];
  if (kind === 'hunger') return 'hungry';
  if (kind === 'energy') return 'tired';
  if (kind === 'social') return 'want to talk';
  return 'something does not add up';
}

function needActivity(
  kind: NeedKind,
  ascii: boolean,
  packId?: string,
): string {
  const pack = packId ?? '';
  if (kind === 'hunger') {
    if (pack === 'society.crew') {
      return ascii ? 'head to the galley' : '去公共舱找点热的';
    }
    if (pack === 'society.cloister') {
      return ascii ? 'go to the refectory' : '去膳堂吃点';
    }
    return ascii ? 'get something hot to eat' : NEED_ACTIVITY.hunger;
  }
  if (kind === 'energy') {
    if (pack === 'society.crew') {
      return ascii ? 'go off-watch to the bunks' : '回铺位歇一会儿';
    }
    if (pack === 'society.cloister') {
      return ascii ? 'return to the cell' : '回僧房歇一会儿';
    }
    return ascii ? 'lie down for a while' : NEED_ACTIVITY.energy;
  }
  if (kind === 'social') {
    if (pack === 'society.crew') {
      return ascii ? 'catch someone at the handoff' : '去交班处跟人说两句';
    }
    if (pack === 'society.cloister') {
      return ascii ? 'speak after vespers' : '晚课后跟人说两句';
    }
    return ascii ? 'find someone to talk with' : NEED_ACTIVITY.social;
  }
  if (pack === 'society.crew') {
    return ascii ? 'check the duty log' : '去交班日志看看';
  }
  if (pack === 'society.cloister') {
    return ascii ? 'read the chapel notice' : '去礼拜堂告示看看';
  }
  return ascii ? 'check the notice board' : NEED_ACTIVITY.curiosity;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Deterministic per-agent starting point so residents do not all get hungry on
 * the same tick, which would make the whole town move as one blob.
 */
export function createNeeds(seed: string): Needs {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const pick = (shift: number): number =>
    clamp01(0.1 + (((h >>> shift) & 0xff) / 255) * 0.35);
  return {
    hunger: pick(0),
    energy: pick(8),
    social: pick(16),
    curiosity: pick(24),
  };
}

export function normalizeNeeds(value: unknown): Needs {
  const src = (value ?? {}) as Partial<Record<NeedKind, unknown>>;
  const out = {} as Needs;
  for (const kind of NEED_KINDS) {
    const n = Number(src[kind]);
    out[kind] = Number.isFinite(n) ? clamp01(n) : 0.2;
  }
  return out;
}

/** Which need, if any, does this activity address? */
export function activitySatisfies(activity: string): NeedKind | undefined {
  for (const kind of NEED_KINDS) {
    if (SATISFIES[kind].test(activity)) return kind;
  }
  return undefined;
}

/**
 * Advance drives one step. Night hours drain energy faster while awake, which
 * is what eventually sends everyone home without a hardcoded curfew.
 */
export function advanceNeeds(input: {
  readonly needs: Needs;
  readonly dtHours: number;
  readonly hourOfDay: number;
  readonly activity?: string;
  /** Talking with someone relieves loneliness regardless of the plan text. */
  readonly talked?: boolean;
  /** Reaching a conclusion settles curiosity; otherwise it can only climb. */
  readonly reflected?: boolean;
  /**
   * Watch / event clocks have no town night. Extra energy drain at 22–6 would
   * send a night-shift crew to bed mid-watch.
   */
  readonly clockKind?: NeedClockKind;
}): Needs {
  const dt = Math.max(0, input.dtHours);
  const relieved = input.activity ? activitySatisfies(input.activity) : undefined;
  const night =
    input.clockKind === 'watch' || input.clockKind === 'event'
      ? false
      : input.hourOfDay >= 22 || input.hourOfDay < 6;
  const out = { ...input.needs };
  for (const kind of NEED_KINDS) {
    const isRelieved =
      kind === relieved ||
      (kind === 'social' && input.talked === true) ||
      (kind === 'curiosity' && input.reflected === true);
    if (isRelieved) {
      out[kind] = clamp01(out[kind] - RELIEF_PER_HOUR[kind] * dt);
      continue;
    }
    const rate =
      DECAY_PER_HOUR[kind] * (kind === 'energy' && night ? 2.2 : 1);
    out[kind] = clamp01(out[kind] + rate * dt);
  }
  return out;
}

export interface UrgentNeed {
  readonly kind: NeedKind;
  readonly value: number;
  /** Human-readable reason for the replan event / talk topic. */
  readonly label: string;
  readonly activity: string;
  readonly anchorKind: AnchorKind;
}

/**
 * The most pressing drive, or undefined when the schedule is already handling
 * it (no point interrupting lunch because you are hungry).
 */
export function urgentNeed(
  needs: Needs,
  options?: {
    readonly threshold?: number;
    readonly currentActivity?: string;
    readonly ascii?: boolean;
    readonly packId?: string;
  },
): UrgentNeed | undefined {
  const threshold = options?.threshold ?? URGENT_THRESHOLD;
  const handled = options?.currentActivity
    ? activitySatisfies(options.currentActivity)
    : undefined;
  let best: NeedKind | undefined;
  for (const kind of NEED_KINDS) {
    if (kind === handled) continue;
    if (needs[kind] < threshold) continue;
    if (!best || needs[kind] > needs[best]) best = kind;
  }
  if (!best) return undefined;
  const ascii = options?.ascii === true;
  return {
    kind: best,
    value: needs[best],
    label: needLabel(best, ascii),
    activity: needActivity(best, ascii, options?.packId),
    anchorKind: NEED_ANCHOR[best],
  };
}

export function needsSummary(needs: Needs, ascii = false): string {
  return NEED_KINDS.map(
    (k) => `${needLabel(k, ascii)}:${needs[k].toFixed(2)}`,
  ).join(' ');
}

/**
 * Prediction error from the town's occupancy model. A crowd that did not go
 * where we expected is new information, which is exactly what curiosity is for.
 */
export function applyCuriositySurprise(needs: Needs, surprise: number): Needs {
  const bump = Math.min(0.4, Math.max(0, surprise) * 0.2);
  if (bump <= 0) return needs;
  return { ...needs, curiosity: clamp01(needs.curiosity + bump) };
}
