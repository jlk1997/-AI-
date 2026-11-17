/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Destination resolution for the society sim.
 *
 * Residents used to walk to `hash(activity)` tiles. Because the activity text
 * embeds the agent name, every resident got a private random corner, so two of
 * them landing inside the 3-tile perception radius was a coin flip — and with
 * no meetings there is no conversation, no gossip and no relationships.
 *
 * Destinations now resolve to real named places, and "social" activities pull
 * the whole region toward one shared hub so gathering is the default, not luck.
 */

export type AnchorKind =
  | 'social'
  | 'work'
  | 'food'
  | 'rest'
  | 'learn'
  | 'commerce'
  | 'other';

export interface SocietyAnchor {
  readonly regionId: string;
  readonly x: number;
  readonly y: number;
  readonly name?: string;
  readonly kind?: AnchorKind;
  readonly parentAreaId?: string;
}

export type AnchorMap = Map<string, SocietyAnchor>;

const KIND_KEYWORDS: ReadonlyArray<readonly [AnchorKind, RegExp]> = [
  [
    'food',
    /早饭|早餐|午饭|午餐|晚饭|晚餐|吃|用餐|下厨|breakfast|lunch|dinner|eat|meal/i,
  ],
  [
    'social',
    /社交|闲聊|聊天|聚会|派对|打听|串门|喝酒|喝茶|咖啡|集市|广场|八卦|议论|散步|gossip|chat|party|social|hang/i,
  ],
  ['learn', /学习|读书|研究|练习|上课|教|抄写|study|learn|read|teach|class/i],
  ['rest', /睡|休息|回家|打盹|歇|洗漱|sleep|rest|home|nap/i],
  [
    'commerce',
    /买|卖|采购|进货|摆摊|交易|记账|shop|buy|sell|trade|market/i,
  ],
  [
    'work',
    /工作|干活|上班|打铁|锻造|挖矿|巡逻|送信|出诊|烘|烤|做饭|经营|值守|修|种|鸡舍|看鸡|work|shift|forge|mine|deliver|patrol/i,
  ],
];

/** What kind of place does this activity want? Falls back to time-of-day. */
export function activityAnchorKind(
  activity: string,
  hourOfDay: number,
): AnchorKind | undefined {
  for (const [kind, re] of KIND_KEYWORDS) {
    if (re.test(activity)) return kind;
  }
  if (hourOfDay >= 17 && hourOfDay < 20) return 'social';
  if (hourOfDay >= 20 || hourOfDay < 6) return 'rest';
  return undefined;
}

const NAME_KINDS: ReadonlyArray<readonly [AnchorKind, RegExp]> = [
  [
    'social',
    /广场|喷泉|酒馆|旅店|旅馆|客栈|吧台|酒吧|咖啡|茶|大堂|公园|长椅|篝火|square|plaza|fountain|inn|tavern|bar|cafe|pub|park|lounge/i,
  ],
  [
    'food',
    /厨房|餐|食堂|面包|磨坊|灶|bakery|kitchen|canteen|diner|mill/i,
  ],
  ['learn', /学校|学堂|图书|书|讲|教室|school|library|study|class/i],
  ['rest', /卧室|家|宿舍|床|屋|住宅|home|house|bed|room|cabin/i],
  // Before `commerce`: a 铁匠铺 is a workplace, not a shop.
  [
    'work',
    /铁匠|铁砧|炉|锻|矿|工坊|作坊|田|农|鸡|舍|窝|码头|哨|医|诊|药|forge|anvil|mine|workshop|smith|farm|coop|hen|chicken|dock|post|clinic/i,
  ],
  [
    'commerce',
    /店|铺|市场|集市|摊|仓|货|shop|store|market|stall|warehouse|trade/i,
  ],
];

/** Classify a place by its display name so Specs need no extra authoring. */
export function anchorKindFromName(name: string): AnchorKind {
  for (const [kind, re] of NAME_KINDS) {
    if (re.test(name)) return kind;
  }
  return 'other';
}

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Deterministic 0..1 from a seed. `hashStr` is `h*31 + c`, so seeds differing
 * only in their last characters land on adjacent integers; the bits are
 * avalanched here so per-day / per-step seeds spread instead of clustering.
 */
export function unitHash(seed: string): number {
  let h = hashStr(seed) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 0xffffffff;
}

/** Deterministic choice — same seed always lands on the same item. */
export function stablePick<T>(items: readonly T[], seed: string): T | undefined {
  if (!items.length) return undefined;
  return items[Math.abs(hashStr(seed)) % items.length];
}

export type GoalReason =
  | 'plan'
  | 'named'
  | 'crowd'
  | 'hub'
  | 'kind'
  | 'home-base'
  | 'centre';

export interface GoalResolution {
  readonly x: number;
  readonly y: number;
  readonly anchorId?: string;
  readonly reason: GoalReason;
}

export interface CrowdPose {
  readonly regionId: string;
  readonly x: number;
  readonly y: number;
}

/** Tiles within which an agent counts as "already at" a place. */
const CROWD_RADIUS = 4;

function crowdAt(
  anchor: SocietyAnchor,
  crowd: readonly CrowdPose[] | undefined,
): number {
  if (!crowd?.length) return 0;
  let n = 0;
  for (const p of crowd) {
    if (p.regionId !== anchor.regionId) continue;
    if (Math.hypot(p.x - anchor.x, p.y - anchor.y) <= CROWD_RADIUS) n += 1;
  }
  return n;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * How much busier another place must be before a resident abandons the one they
 * are already walking to. Without this margin, crowd gravity re-decided the
 * destination every tick and residents turned around halfway.
 */
const CROWD_SWITCH_MARGIN = 2;

type AnchorEntry = readonly [string, SocietyAnchor];

/** The candidate the resident is already heading for, if it is still on offer. */
function stickyEntry(
  candidates: readonly AnchorEntry[],
  goal: { readonly x: number; readonly y: number } | undefined,
): AnchorEntry | undefined {
  if (!goal) return undefined;
  return candidates.find(
    ([, a]) => Math.round(a.x) === Math.round(goal.x) && Math.round(a.y) === Math.round(goal.y),
  );
}

/** Busiest place, but only if it beats the one already chosen by a clear margin. */
function busiestAnchor(
  candidates: readonly AnchorEntry[],
  crowd: readonly CrowdPose[] | undefined,
  stickyGoal: { readonly x: number; readonly y: number } | undefined,
): { entry: AnchorEntry; count: number } | undefined {
  let best: AnchorEntry | undefined;
  let bestN = -1;
  for (const entry of candidates) {
    const n = crowdAt(entry[1], crowd);
    if (n > bestN || (n === bestN && best && entry[0] < best[0])) {
      best = entry;
      bestN = n;
    }
  }
  if (!best) return undefined;
  const sticky = stickyEntry(candidates, stickyGoal);
  if (sticky && sticky[0] !== best[0]) {
    const stickyN = crowdAt(sticky[1], crowd);
    if (bestN < stickyN + CROWD_SWITCH_MARGIN) {
      return { entry: sticky, count: stickyN };
    }
  }
  return { entry: best, count: bestN };
}

export function resolveActivityGoal(input: {
  readonly anchors?: AnchorMap;
  readonly agentId: string;
  readonly regionId: string;
  readonly locationId?: string;
  readonly activity: string;
  readonly hourOfDay: number;
  readonly bounds: { readonly width: number; readonly height: number };
  /** Everyone's poses, for social gravity. */
  readonly crowd?: readonly CrowdPose[];
  /** Destination from the previous tick — kept unless a place is clearly busier. */
  readonly stickyGoal?: { readonly x: number; readonly y: number };
}): GoalResolution {
  const { bounds } = input;
  const entries = [...(input.anchors ?? new Map<string, SocietyAnchor>())].filter(
    ([, a]) => a.regionId === input.regionId,
  );

  const at = (id: string, a: SocietyAnchor, reason: GoalReason): GoalResolution => ({
    x: clamp(Math.round(a.x), 1, Math.max(1, bounds.width - 2)),
    y: clamp(Math.round(a.y), 1, Math.max(1, bounds.height - 2)),
    anchorId: id,
    reason,
  });

  // 1. The plan named a place explicitly.
  if (input.locationId) {
    const direct = input.anchors?.get(input.locationId);
    if (direct && direct.regionId === input.regionId) {
      return at(input.locationId, direct, 'plan');
    }
  }

  // 2. The activity text names a place ("在铁砧铺打铁").
  const named = entries.find(([id, a]) => {
    const label = a.name ?? id;
    return label.length >= 2 && input.activity.includes(label);
  });
  if (named) return at(named[0], named[1], 'named');

  const wanted = activityAnchorKind(input.activity, input.hourOfDay);

  // Meals go to food places. Mixing them with the social hub made dinner
  // a second gathering, and the square never emptied after dark.
  if (wanted === 'food') {
    const foods = entries.filter(([, a]) => a.kind === 'food');
    if (foods.length) {
      const busiest = busiestAnchor(foods, input.crowd, input.stickyGoal);
      if (busiest && busiest.count > 0) {
        return at(busiest.entry[0], busiest.entry[1], 'crowd');
      }
      const table = stablePick(foods, `food:${input.regionId}:${input.agentId}`);
      if (table) return at(table[0], table[1], 'kind');
    }
  }

  // Social activities head for whichever hub already has a crowd — that is the
  // gravity that turns two people into a gathering. Seeding the *empty* case by
  // region made the whole town file into one square in lockstep, so the fallback
  // is per agent: different people open different hubs, and the crowd term then
  // decides which one grows.
  if (wanted === 'social') {
    const hubs = entries.filter(([, a]) => a.kind === 'social');
    if (hubs.length) {
      const busiest = busiestAnchor(hubs, input.crowd, input.stickyGoal);
      if (busiest && busiest.count > 0) {
        return at(busiest.entry[0], busiest.entry[1], 'crowd');
      }
      const hub = stablePick(hubs, `hub:${input.regionId}:${input.agentId}`);
      if (hub) return at(hub[0], hub[1], 'hub');
    }
  }

  // 4. Any place of the right kind — stable per agent so they keep a routine.
  if (wanted) {
    const byKind = entries.filter(([, a]) => a.kind === wanted);
    const pick = stablePick(byKind, `${wanted}:${input.agentId}`);
    if (pick) return at(pick[0], pick[1], 'kind');
  }

  // 5. A stable home base beats teleporting whenever the activity text changes.
  const base = stablePick(entries, `base:${input.agentId}:${input.regionId}`);
  if (base) return at(base[0], base[1], 'home-base');

  // 6. No anchors at all: cluster near the centre instead of scattering.
  const spread = Math.max(1, Math.floor(Math.min(bounds.width, bounds.height) / 6));
  const h = Math.abs(hashStr(input.agentId));
  return {
    x: clamp(
      Math.round(bounds.width / 2) + ((h % (spread * 2 + 1)) - spread),
      1,
      Math.max(1, bounds.width - 2),
    ),
    y: clamp(
      Math.round(bounds.height / 2) +
        (((h >> 8) % (spread * 2 + 1)) - spread),
      1,
      Math.max(1, bounds.height - 2),
    ),
    reason: 'centre',
  };
}

/**
 * Nearest named area in the agent's region (not the region hub, not an object).
 * Pose is still region+xy; this is the Park location-tree leaf we can name.
 */
export function nearestAreaAnchor(
  anchors: AnchorMap | undefined,
  objects: ReadonlyArray<{
    readonly id: string;
    readonly areaId: string;
    readonly areaName?: string;
    readonly regionId?: string;
  }>,
  pose: { readonly regionId: string; readonly x: number; readonly y: number },
): { areaId: string; areaName: string } | undefined {
  const objectIds = new Set(objects.map((o) => o.id));
  let best:
    | { areaId: string; areaName: string; dist: number; leaf: boolean }
    | undefined;
  for (const [id, a] of anchors ?? []) {
    if (a.regionId !== pose.regionId) continue;
    if (id === pose.regionId) continue;
    if (objectIds.has(id)) continue;
    const dist = Math.hypot(pose.x - a.x, pose.y - a.y);
    const leaf = Boolean(a.parentAreaId);
    if (
      !best ||
      dist < best.dist - 0.4 ||
      (Math.abs(dist - best.dist) <= 0.4 && leaf && !best.leaf)
    ) {
      best = { areaId: id, areaName: a.name ?? id, dist, leaf };
    }
  }
  if (best) return { areaId: best.areaId, areaName: best.areaName };
  for (const o of objects) {
    if ((o.regionId ?? o.areaId) !== pose.regionId) continue;
    const a = anchors?.get(o.areaId);
    if (!a) continue;
    const dist = Math.hypot(pose.x - a.x, pose.y - a.y);
    if (!best || dist < best.dist) {
      best = {
        areaId: o.areaId,
        areaName: o.areaName ?? a.name ?? o.areaId,
        dist,
        leaf: Boolean(a.parentAreaId),
      };
    }
  }
  return best
    ? { areaId: best.areaId, areaName: best.areaName }
    : undefined;
}
