/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 走向盘: one wallet, pari-mutuel pool on an adjudicable town node.
 * Stakes never change SKUs for 镇时 / 点亮 / talk floors.
 */

import { societyTalkMuteReason } from './societyLease.js';

export const COURSE = {
  minStake: 12,
  stakeSteps: [12, 24, 48],
  rakeRate: 0.15,
  authorShare: 0.7,
  maxPayoutMultiple: 8,
  maxShareOfPool: 0.2,
  firstStakeCap: 200,
  bettingMs: 4 * 60 * 60 * 1000,
  evidenceMs: 4 * 60 * 60 * 1000,
} as const;

export type CourseStatus = 'open' | 'closed' | 'settled' | 'void';

export type CoursePredicate = {
  readonly type: 'event_needle' | 'event_kind' | 'agent_key' | 'agent_presence';
  readonly kind?: string;
  readonly needles?: readonly string[];
  readonly agentKey?: string;
  /** Display name so a paid 巷议 can mention the resident without agentKey. */
  readonly name?: string;
  /** For `agent_presence`: true = still in town, false = left. */
  readonly present?: boolean;
};

export function alleyCourseOverlapsChinaDay(input: {
  readonly opensAtMs: number;
  readonly settlesAtMs: number;
  readonly dayStartMs: number;
}): boolean {
  const dayEnd = input.dayStartMs + 24 * 60 * 60 * 1000;
  return input.opensAtMs < dayEnd && input.settlesAtMs > input.dayStartMs;
}

export function decideCourseOutcome(input: {
  readonly judged: {
    readonly muted: boolean;
    readonly unclear: boolean;
    readonly winningOptionId: string | null;
    readonly fingerprint: string;
  };
  readonly clockPaused?: boolean;
  readonly takenDown?: boolean;
  readonly uncontested?: boolean;
  readonly forceVoidReason?: string | null;
}): {
  readonly voided: boolean;
  readonly voidReason: string | null;
  readonly winningOptionId: string | null;
  readonly transcriptHash: string;
} {
  const forced =
    input.forceVoidReason
    ?? (input.takenDown ? 'takedown' : null)
    ?? (input.clockPaused ? 'paused' : null)
    ?? (input.uncontested ? 'uncontested' : null);
  const voided =
    Boolean(forced) ||
    input.judged.muted ||
    input.judged.unclear ||
    !input.judged.winningOptionId;
  const voidReason = forced
    ? forced
    : input.judged.muted
      ? 'muted'
      : input.judged.unclear
        ? 'unclear'
        : !input.judged.winningOptionId
          ? 'no_winner'
          : null;
  return {
    voided,
    voidReason,
    winningOptionId: voided ? null : input.judged.winningOptionId,
    transcriptHash: input.judged.fingerprint,
  };
}

export type CourseSettlementTelemetry = {
  readonly nodeId: string;
  readonly worldId: string;
  readonly seedKind: string;
  readonly pool: number;
  readonly contested: boolean;
  readonly voided: boolean;
  readonly voidReason: string | null;
  readonly muted: boolean;
  readonly unclear: boolean;
  readonly winningOptionId: string | null;
};

/** Structured settle line for logs / future metrics (phase-5 observability). */
export function courseSettlementTelemetry(input: {
  readonly nodeId: string;
  readonly worldId: string;
  readonly seedKind: string;
  readonly pool: number;
  readonly contested: boolean;
  readonly judged: {
    readonly muted: boolean;
    readonly unclear: boolean;
    readonly winningOptionId: string | null;
  };
  readonly outcome: {
    readonly voided: boolean;
    readonly voidReason: string | null;
    readonly winningOptionId: string | null;
  };
}): CourseSettlementTelemetry {
  return {
    nodeId: input.nodeId,
    worldId: input.worldId,
    seedKind: input.seedKind,
    pool: input.pool,
    contested: input.contested,
    voided: input.outcome.voided,
    voidReason: input.outcome.voidReason,
    muted: input.judged.muted,
    unclear: input.judged.unclear,
    winningOptionId: input.outcome.winningOptionId,
  };
}

export type CourseEventFact = {
  readonly id: string;
  readonly kind: string;
  readonly agentKey: string | null;
  readonly createdAtMs: number;
  readonly text: string;
  /** Template / replay-padded talks never decide a board. */
  readonly degraded?: boolean;
  /** Paid 夜市 SKU: unmutes the window, never needle-matches. */
  readonly neutral?: boolean;
};

export const NIGHT_MARKET_COURSE_PROMPT = {
  zh: '今夜哪件事会成为正史',
  en: 'What becomes canon in this town tonight',
} as const;

/** Paid 巷议 / 夜市 land as intervene. They are evidence, not fake dialogue. */
export function isLivingCourseEvidence(event: CourseEventFact): boolean {
  if (event.degraded) return false;
  return event.kind === 'dialogue' || event.kind === 'intervene';
}

export function courseStakeSteps(maxAdd: number): readonly number[] {
  const cap = Math.max(0, Math.round(maxAdd));
  return COURSE.stakeSteps.filter((n) => n <= cap);
}

export function needlesFromLine(text: string): string[] {
  const raw = text.trim();
  if (!raw) return [];
  const out: string[] = [];
  const push = (token: string): void => {
    const next = token.trim();
    if (next.length < 2 || next.length > 16) return;
    if (!out.includes(next)) out.push(next);
  };
  for (const part of raw.split(/[\s,，。！？!?；;、]+/).filter(Boolean)) {
    push(part);
    for (const token of part.match(/[\u4e00-\u9fff]{2,8}/g) ?? []) push(token);
    for (const token of part.match(/[A-Za-z]{3,12}/g) ?? []) push(token);
    if (/[\u4e00-\u9fff]{3,}/.test(part)) {
      push(part.slice(0, 3));
      push(part.slice(0, 4));
    }
  }
  return out.slice(0, 6);
}

export const BINARY_STAY_COURSE = {
  stayNeedles: ['留下', '还在', '没走', 'stayed', 'still here'],
  leaveNeedles: [
    '出走',
    '离开这座镇',
    '离开镇上',
    '不在镇上',
    '不在了',
    '出镇',
    '出城',
    '镇外',
    '城外',
    '失踪',
    'left town',
    'left the town',
    'gone from town',
  ],
} as const;

export const NIGHT_MARKET_COURSE_OPTIONS: ReadonlyArray<{
  readonly key: string;
  readonly labelZh: string;
  readonly labelEn: string;
  readonly predicate: CoursePredicate;
}> = [
  {
    key: 'harvest',
    labelZh: '丰收',
    labelEn: 'A harvest',
    predicate: {
      type: 'event_needle',
      needles: ['丰收', '粮仓', '收成', '麦熟', '谷满', 'harvest'],
    },
  },
  {
    key: 'fire',
    labelZh: '失火',
    labelEn: 'A fire',
    predicate: {
      type: 'event_needle',
      needles: ['失火', '火光', '马厩', '走了水', '着火', '起火', '烧起来'],
    },
  },
  {
    key: 'guest',
    labelZh: '贵客',
    labelEn: 'A guest arrives',
    predicate: {
      type: 'event_needle',
      needles: ['贵客', '外地', '进了镇', '来客', '外乡'],
    },
  },
  {
    key: 'rumor',
    labelZh: '谣言',
    labelEn: 'A rumor sticks',
    predicate: {
      type: 'event_needle',
      needles: ['谣言', '后窗', '客栈', '闲话'],
    },
  },
];

export function authorCourseRake(rake: number): number {
  if (rake <= 0) return 0;
  return Math.max(1, Math.floor(rake * COURSE.authorShare));
}

export function courseRake(pool: number): number {
  if (pool <= 0) return 0;
  return Math.floor(pool * COURSE.rakeRate);
}

/**
 * Extra chips one org may add. An empty pool has no whale yet, so the first
 * chip is allowed up to `firstStakeCap`. After that, one org stays ≤ 20% —
 * except a new seat may always place `minStake`, or a 12-point board
 * could never take a second player.
 */
export function maxAdditionalStake(poolBefore: number, already: number): number {
  const have = Math.max(0, Math.round(already));
  const pool = Math.max(0, Math.round(poolBefore));
  if (pool <= 0 && have <= 0) return COURSE.firstStakeCap;
  const addMax = Math.floor(
    (COURSE.maxShareOfPool * pool - have) / (1 - COURSE.maxShareOfPool),
  );
  if (have <= 0) {
    return Math.max(COURSE.minStake, addMax);
  }
  return Math.max(0, addMax);
}

export function isCourseStakeStep(points: number): boolean {
  return (COURSE.stakeSteps as readonly number[]).includes(Math.round(points));
}

export function canAddStake(input: {
  readonly points: number;
  readonly poolBefore: number;
  readonly already: number;
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const points = Math.round(input.points);
  if (points < COURSE.minStake) {
    return { ok: false, reason: 'min_stake' };
  }
  const cap = maxAdditionalStake(input.poolBefore, input.already);
  if (points > cap) return { ok: false, reason: 'share_cap' };
  return { ok: true };
}

export type CourseStakeRow = {
  readonly organizationId: string;
  readonly optionId: string;
  readonly points: number;
};

/** Two sides with chips. One pile is a donation, not a board. */
export function courseContest(stakes: readonly CourseStakeRow[]): {
  readonly sides: number;
  readonly stakers: number;
  readonly contested: boolean;
} {
  const live = stakes.filter((row) => row.points > 0);
  const sides = new Set(live.map((row) => row.optionId)).size;
  const stakers = new Set(live.map((row) => row.organizationId)).size;
  return { sides, stakers, contested: sides >= 2 };
}

/** First chip is not a game yet — take it back while betting is still open. */
export function canWithdrawCourseStake(input: {
  readonly status: string;
  readonly contested: boolean;
  readonly myPoints: number;
}): boolean {
  return input.status === 'open' && !input.contested && input.myPoints > 0;
}

export type CoursePayoutRow = {
  readonly organizationId: string;
  readonly points: number;
  readonly kind: 'payout' | 'void';
};

/** What this chip would pay if that side wins right now. Others can still add. */
export function previewCoursePayout(input: {
  readonly pool: number;
  readonly optionPoints: number;
  readonly stake: number;
}): {
  readonly payout: number;
  readonly multiple: number;
  readonly contested: boolean;
} | null {
  const stake = Math.round(input.stake);
  if (stake < COURSE.minStake) return null;
  const poolBefore = Math.max(0, Math.round(input.pool));
  const optionBefore = Math.max(0, Math.round(input.optionPoints));
  const other = Math.max(0, poolBefore - optionBefore);
  const pool = poolBefore + stake;
  const optionPoints = optionBefore + stake;
  const distributable = pool - courseRake(pool);
  if (optionPoints <= 0 || distributable <= 0) return null;
  const payout = Math.min(
    Math.floor((stake * distributable) / optionPoints),
    stake * COURSE.maxPayoutMultiple,
  );
  return { payout, multiple: payout / stake, contested: other > 0 };
}

export function buildCustomCourseSeed(
  prompt: string,
  labels: readonly string[],
): {
  readonly kind: 'custom';
  readonly prompt: string;
  readonly options: Array<{
    readonly key: string;
    readonly label: string;
    readonly needles: string[];
  }>;
} | null {
  const cleaned = labels
    .map((label) => label.trim())
    .filter((label) => label.length >= 2)
    .slice(0, 4);
  if (cleaned.length < 2) return null;
  return {
    kind: 'custom',
    prompt: prompt.trim().slice(0, 80),
    options: cleaned.map((label, i) => {
      const needles = needlesFromLine(label);
      return {
        key: `c${i + 1}`,
        label: label.slice(0, 24),
        needles: needles.length > 0 ? needles : [label.slice(0, 16)],
      };
    }),
  };
}

export function settlePariMutuel(input: {
  readonly stakes: readonly CourseStakeRow[];
  readonly winningOptionId: string | null;
  readonly voided: boolean;
}): {
  readonly pool: number;
  readonly rake: number;
  readonly authorRake: number;
  readonly platformRake: number;
  readonly leftover: number;
  readonly payouts: readonly CoursePayoutRow[];
} {
  const pool = input.stakes.reduce((sum, row) => sum + Math.max(0, row.points), 0);
  if (input.voided || !input.winningOptionId) {
    return {
      pool,
      rake: 0,
      authorRake: 0,
      platformRake: 0,
      leftover: 0,
      payouts: input.stakes.map((row) => ({
        organizationId: row.organizationId,
        points: row.points,
        kind: 'void',
      })),
    };
  }
  const winning = input.stakes.filter((row) => row.optionId === input.winningOptionId);
  const winningTotal = winning.reduce((sum, row) => sum + row.points, 0);
  if (winningTotal <= 0) {
    return {
      pool,
      rake: 0,
      authorRake: 0,
      platformRake: 0,
      leftover: 0,
      payouts: input.stakes.map((row) => ({
        organizationId: row.organizationId,
        points: row.points,
        kind: 'void',
      })),
    };
  }
  const rake = courseRake(pool);
  const authorRake = authorCourseRake(rake);
  const distributable = pool - rake;
  const payouts: CoursePayoutRow[] = [];
  for (const row of winning) {
    const raw = Math.floor((row.points * distributable) / winningTotal);
    const capped = Math.min(raw, row.points * COURSE.maxPayoutMultiple);
    if (capped > 0) {
      payouts.push({
        organizationId: row.organizationId,
        points: capped,
        kind: 'payout',
      });
    }
  }
  const paidOut = payouts.reduce((sum, row) => sum + row.points, 0);
  const leftover = Math.max(0, distributable - paidOut);
  return {
    pool,
    rake,
    authorRake,
    platformRake: Math.max(0, rake - authorRake),
    leftover,
    payouts,
  };
}

export function eventMatchesPredicate(
  event: CourseEventFact,
  predicate: CoursePredicate,
): boolean {
  if (event.degraded) return false;
  if (predicate.type === 'event_kind') {
    return Boolean(predicate.kind) && event.kind === predicate.kind;
  }
  if (predicate.type === 'agent_key') {
    return Boolean(predicate.agentKey) && event.agentKey === predicate.agentKey;
  }
  if (predicate.type === 'agent_presence') {
    if (!eventConcernsAgent(event, predicate)) return false;
    const leave = courseEventLooksLikeLeave(event);
    if (isSupportCourseFact(event)) {
      return predicate.present === false
        ? leave
        : courseEventLooksLikeStay(event) && !leave;
    }
    if (!isPresenceKind(event.kind)) return false;
    return predicate.present === false ? leave : !leave;
  }
  if (event.neutral) return false;
  const needles = predicate.needles ?? [];
  if (needles.length === 0) return false;
  if (predicate.agentKey && event.agentKey !== predicate.agentKey) return false;
  const hay = `${event.kind} ${event.text}`.toLowerCase();
  return needles.some((needle) => hay.includes(needle.toLowerCase()));
}

function eventHaystack(event: CourseEventFact): string {
  return `${event.kind} ${event.text}`.toLowerCase();
}

export function courseEventLooksLikeLeave(event: CourseEventFact): boolean {
  const hay = eventHaystack(event);
  return BINARY_STAY_COURSE.leaveNeedles.some((needle) =>
    hay.includes(needle.toLowerCase()),
  );
}

export function courseEventLooksLikeStay(event: CourseEventFact): boolean {
  const hay = eventHaystack(event);
  return BINARY_STAY_COURSE.stayNeedles.some((needle) =>
    hay.includes(needle.toLowerCase()),
  );
}

function eventConcernsAgent(
  event: CourseEventFact,
  predicate: Pick<CoursePredicate, 'agentKey' | 'name'>,
): boolean {
  if (predicate.agentKey && event.agentKey === predicate.agentKey) return true;
  const name = predicate.name?.trim();
  return Boolean(name && event.text.includes(name));
}

function isPresenceKind(kind: string): boolean {
  return (
    kind === 'dialogue' ||
    kind === 'intervene' ||
    kind === 'action' ||
    kind === 'act' ||
    kind === 'move'
  );
}

function presenceBoardAgent(
  options: ReadonlyArray<{ readonly predicate: CoursePredicate }>,
): string | null {
  if (options.length < 2) return null;
  let agentKey: string | null = null;
  for (const option of options) {
    if (option.predicate.type !== 'agent_presence' || !option.predicate.agentKey) {
      return null;
    }
    if (agentKey && option.predicate.agentKey !== agentKey) return null;
    agentKey = option.predicate.agentKey;
  }
  return agentKey;
}

function needleLooksLikeLeave(needles: readonly string[] | undefined): boolean {
  const leave = new Set<string>([
    ...BINARY_STAY_COURSE.leaveNeedles,
    '离开',
    'gone',
    'left',
  ]);
  return (needles ?? []).some((needle) => leave.has(needle));
}

/** Older binary boards stored stay/leave as event_needle + agentKey. */
function inferredPresenceBoard(
  options: ReadonlyArray<{ readonly id: string; readonly predicate: CoursePredicate }>,
): {
  readonly agentKey: string;
  readonly name?: string;
  readonly stayId: string;
  readonly leaveId: string;
} | null {
  if (options.length !== 2) return null;
  const [left, right] = options;
  if (
    left.predicate.type !== 'event_needle' ||
    right.predicate.type !== 'event_needle' ||
    !left.predicate.agentKey ||
    left.predicate.agentKey !== right.predicate.agentKey
  ) {
    return null;
  }
  const leftLeave = needleLooksLikeLeave(left.predicate.needles);
  const rightLeave = needleLooksLikeLeave(right.predicate.needles);
  if (leftLeave === rightLeave) return null;
  return {
    agentKey: left.predicate.agentKey,
    name: left.predicate.name ?? right.predicate.name,
    stayId: leftLeave ? right.id : left.id,
    leaveId: leftLeave ? left.id : right.id,
  };
}

/** Last living stay/leave signal for a named resident. Leave after talk wins. */
export function lastAgentPresenceSignal(
  events: readonly CourseEventFact[],
  predicate: Pick<CoursePredicate, 'agentKey' | 'name'>,
): 'stay' | 'leave' | null {
  let last: 'stay' | 'leave' | null = null;
  const ordered = [...events].sort(
    (a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id),
  );
  for (const event of ordered) {
    if (event.degraded || event.neutral || isSupportCourseFact(event)) continue;
    if (!isPresenceKind(event.kind) || !eventConcernsAgent(event, predicate)) {
      continue;
    }
    if (courseEventLooksLikeLeave(event)) {
      last = 'leave';
      continue;
    }
    if (event.kind === 'dialogue' || event.kind === 'intervene') {
      last = 'stay';
      continue;
    }
    if (!event.text.trim()) continue;
    if (courseEventLooksLikeStay(event)) {
      last = 'stay';
      continue;
    }
    if (event.kind === 'move' || event.kind === 'action' || event.kind === 'act') {
      last = 'stay';
    }
  }
  return last;
}

function scoreCourseMatches(
  events: readonly CourseEventFact[],
  options: ReadonlyArray<{ readonly id: string; readonly predicate: CoursePredicate }>,
): Record<string, number> {
  const matches: Record<string, number> = {};
  for (const option of options) {
    matches[option.id] = events.filter((event) =>
      eventMatchesPredicate(event, option.predicate),
    ).length;
  }
  return matches;
}

function pickCourseWinner(
  options: ReadonlyArray<{ readonly id: string }>,
  matches: Readonly<Record<string, number>>,
  onlyIds?: ReadonlySet<string>,
): { readonly id: string | null; readonly best: number; readonly tie: boolean } {
  let bestId: string | null = null;
  let best = 0;
  let tie = false;
  for (const option of options) {
    if (onlyIds && !onlyIds.has(option.id)) continue;
    const n = matches[option.id] ?? 0;
    if (n > best) {
      best = n;
      bestId = option.id;
      tie = false;
    } else if (n === best && n > 0) {
      tie = true;
    }
  }
  return { id: best <= 0 || tie ? null : bestId, best, tie: tie && best > 0 };
}

function isSupportCourseFact(event: CourseEventFact): boolean {
  return event.kind === 'memory' || event.kind === 'relation';
}

export function judgeCourseWindow(input: {
  readonly events: readonly CourseEventFact[];
  readonly options: ReadonlyArray<{
    readonly id: string;
    readonly predicate: CoursePredicate;
  }>;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
}): {
  readonly muted: boolean;
  readonly unclear: boolean;
  readonly winningOptionId: string | null;
  readonly matches: Readonly<Record<string, number>>;
  readonly fingerprint: string;
} {
  const windowed = input.events.filter(
    (event) =>
      event.createdAtMs >= input.windowStartMs && event.createdAtMs < input.windowEndMs,
  );
  const living = windowed.filter((event) => !isSupportCourseFact(event));
  const support = windowed.filter((event) => isSupportCourseFact(event));
  const fingerprint = transcriptFingerprint(windowed);
  const muted = !living.some(isLivingCourseEvidence);
  const livingMatches = scoreCourseMatches(living, input.options);
  const supportMatches = scoreCourseMatches(support, input.options);
  const matches: Record<string, number> = {};
  for (const option of input.options) {
    matches[option.id] = (livingMatches[option.id] ?? 0) + (supportMatches[option.id] ?? 0);
  }
  if (muted) {
    return {
      muted: true,
      unclear: false,
      winningOptionId: null,
      matches,
      fingerprint,
    };
  }
  const presenceAgent = presenceBoardAgent(input.options);
  const inferred = presenceAgent ? null : inferredPresenceBoard(input.options);
  if (presenceAgent || inferred) {
    const named = input.options.find(
      (option) => option.predicate.type === 'agent_presence',
    )?.predicate;
    const signal = lastAgentPresenceSignal(living, {
      agentKey: presenceAgent ?? inferred!.agentKey,
      name: named?.name ?? inferred?.name,
    });
    const stayId = presenceAgent
      ? input.options.find(
          (option) =>
            option.predicate.type === 'agent_presence' &&
            option.predicate.present === true,
        )?.id
      : inferred?.stayId;
    const leaveId = presenceAgent
      ? input.options.find(
          (option) =>
            option.predicate.type === 'agent_presence' &&
            option.predicate.present === false,
        )?.id
      : inferred?.leaveId;
    const winnerId = signal === 'stay' ? stayId : signal === 'leave' ? leaveId : undefined;
    if (winnerId) {
      return {
        muted: false,
        unclear: false,
        winningOptionId: winnerId,
        matches,
        fingerprint,
      };
    }
  }
  const livingWin = pickCourseWinner(input.options, livingMatches);
  if (livingWin.id) {
    return {
      muted: false,
      unclear: false,
      winningOptionId: livingWin.id,
      matches,
      fingerprint,
    };
  }
  if (livingWin.tie) {
    const tied = new Set(
      input.options
        .filter((option) => (livingMatches[option.id] ?? 0) === livingWin.best)
        .map((option) => option.id),
    );
    const broken = pickCourseWinner(input.options, supportMatches, tied);
    if (broken.id) {
      return {
        muted: false,
        unclear: false,
        winningOptionId: broken.id,
        matches,
        fingerprint,
      };
    }
  }
  return {
    muted: false,
    unclear: true,
    winningOptionId: null,
    matches,
    fingerprint,
  };
}

export function transcriptFingerprint(events: readonly CourseEventFact[]): string {
  const lines = [...events]
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id))
    .map((event) => `${event.id}|${event.kind}|${event.agentKey ?? ''}|${event.text}`)
    .join('\n');
  return fnv1aHex(lines);
}

function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function parseCoursePredicate(raw: unknown): CoursePredicate {
  if (!raw || typeof raw !== 'object') {
    return { type: 'event_needle', needles: [] };
  }
  const row = raw as Record<string, unknown>;
  const type =
    row.type === 'event_kind' ||
    row.type === 'agent_key' ||
    row.type === 'event_needle' ||
    row.type === 'agent_presence'
      ? row.type
      : 'event_needle';
  const needles = Array.isArray(row.needles)
    ? row.needles.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    type,
    ...(typeof row.kind === 'string' ? { kind: row.kind } : {}),
    ...(needles.length > 0 ? { needles } : {}),
    ...(typeof row.agentKey === 'string' ? { agentKey: row.agentKey } : {}),
    ...(typeof row.name === 'string' ? { name: row.name } : {}),
    ...(typeof row.present === 'boolean' ? { present: row.present } : {}),
  };
}

/** Night-market SKU ids match night-market course option keys. */
export function matchCourseOptionKey(
  eventId: string,
  optionKeys: readonly string[],
): string | null {
  const id = eventId.trim().toLowerCase();
  if (!id) return null;
  return optionKeys.find((key) => key.toLowerCase() === id) ?? null;
}

export function coursePromptLocale(prompt: string): 'zh-CN' | 'en' {
  const raw = prompt.trim();
  if (!raw) return 'zh-CN';
  if (raw === NIGHT_MARKET_COURSE_PROMPT.en) return 'en';
  if (
    /became canon|still in town|what becomes canon|which beat/i.test(raw)
  ) {
    return 'en';
  }
  return 'zh-CN';
}

export function courseCanonLine(input: {
  readonly locale: 'zh-CN' | 'en';
  readonly prompt: string;
  readonly winningLabel: string;
}): string {
  if (input.locale === 'en') {
    return `${input.prompt}: ${input.winningLabel} became canon`;
  }
  return `${input.prompt}：${input.winningLabel}成了`;
}

export function courseVoidCanonLine(input: {
  readonly locale?: 'zh-CN' | 'en';
  readonly prompt: string;
}): string {
  const locale = input.locale ?? coursePromptLocale(input.prompt);
  if (locale === 'en') return `${input.prompt}: the board voided`;
  return `${input.prompt}：整盘退了`;
}

/**
 * Harvest / barn / stable boards only fit a village night-market pack.
 * A bare 客栈 (school inn, academy lodge) must not fall onto 丰收 / 失火.
 */
export function worldCoursePrefersNightMarket(spec: unknown): boolean {
  if (!spec || typeof spec !== 'object') return false;
  let hay = '';
  try {
    hay = JSON.stringify(spec);
  } catch {
    return false;
  }
  if (hay.length > 80_000) hay = hay.slice(0, 80_000);
  return [
    '粮仓',
    '马厩',
    '丰收',
    '收成',
    'inn_lane',
    'harvest',
    'barn',
    'stable',
  ].some((needle) => hay.includes(needle));
}

/** After beats fail: village pack → 丰收/失火; school inn → 是否盘 only. */
export function nextWorldCourseSeedKind(
  spec: unknown,
): 'night_market' | 'binary' {
  return worldCoursePrefersNightMarket(spec) ? 'night_market' : 'binary';
}

export function courseWinLine(input: {
  readonly locale: 'zh-CN' | 'en';
  readonly predicate?: CoursePredicate | null;
  readonly label?: string;
}): string {
  const predicate = input.predicate;
  if (predicate?.type === 'agent_presence') {
    const name = predicate.name || predicate.agentKey || input.label || '';
    if (predicate.present !== false) {
      return input.locale === 'en'
        ? `In the 4-hour evidence window, ${name} is still in town`
        : `取证这 4 小时里，${name} 还在镇上`;
    }
    return input.locale === 'en'
      ? `In the 4-hour evidence window, ${name} has left town`
      : `取证这 4 小时里，${name} 离开了镇上`;
  }
  const needles =
    predicate?.needles && predicate.needles.length > 0
      ? predicate.needles.slice(0, 3)
      : input.label
        ? needlesFromLine(input.label).slice(0, 3)
        : [];
  if (needles.length > 0) {
    const joined = needles.join(' / ');
    return input.locale === 'en'
      ? `Talk or alley mention: ${joined}`
      : `对白或巷议提到 ${joined}`;
  }
  return input.locale === 'en'
    ? 'This side must show living evidence in the window'
    : '取证窗里必须有真对白能对上这一边';
}

export type CourseTalkHint = {
  readonly who?: string;
  readonly text: string;
  readonly degraded?: boolean;
  readonly kind?: string;
};

export function suggestCourseFromTalks(
  lines: readonly CourseTalkHint[],
  locale: 'zh-CN' | 'en' = 'zh-CN',
): {
  readonly prompt: string;
  readonly options: ReadonlyArray<{
    readonly label: string;
    readonly needles: readonly string[];
  }>;
} | null {
  const living = lines.filter(
    (line) =>
      !line.degraded &&
      (line.kind == null ||
        line.kind === 'dialogue' ||
        line.kind === 'intervene') &&
      line.text.trim().length >= 2,
  );
  const labels: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    const next = raw.trim().slice(0, 24);
    if (next.length < 2) return;
    const key = next.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    labels.push(next);
  };
  for (const line of living.slice(-12)) {
    const who = line.who?.trim();
    if (who && who !== '访客') push(who);
  }
  if (labels.length < 2) {
    for (const line of living.slice(-12)) {
      for (const needle of needlesFromLine(line.text)) push(needle);
      if (labels.length >= 4) break;
    }
  }
  if (labels.length < 2) return null;
  return {
    prompt:
      locale === 'en' ? 'What just happened in this town' : '刚才镇上发生了哪一件',
    options: labels.slice(0, 4).map((label) => {
      const needles = needlesFromLine(label);
      return {
        label,
        needles: needles.length > 0 ? needles : [label.slice(0, 16)],
      };
    }),
  };
}

export function scoreCourseLabelHits(
  options: readonly {
    readonly id: string;
    readonly label: string;
    readonly needles?: readonly string[];
  }[],
  texts: readonly string[],
): ReadonlyArray<{
  readonly optionId: string;
  readonly label: string;
  readonly hits: number;
}> {
  const hay = texts.map((row) => row.trim()).filter(Boolean);
  return options.map((option) => {
    const needles = [option.label, ...(option.needles ?? needlesFromLine(option.label))]
      .map((row) => row.trim())
      .filter((row) => row.length >= 2);
    let hits = 0;
    for (const text of hay) {
      const low = text.toLowerCase();
      if (needles.some((needle) => low.includes(needle.toLowerCase()))) hits += 1;
    }
    return { optionId: option.id, label: option.label, hits };
  });
}

export type CourseEvidenceOption = {
  readonly id: string;
  readonly label: string;
  readonly needles?: readonly string[];
  readonly predicateType?: CoursePredicate['type'];
  readonly agentKey?: string;
  readonly agentName?: string;
  readonly present?: boolean;
};

export type CourseEvidenceTalk = {
  readonly id: string;
  readonly kind: string;
  readonly text: string;
  readonly who?: string;
  readonly agentId?: string;
  readonly agentKey?: string;
  readonly degraded?: boolean;
  readonly neutral?: boolean;
  readonly createdAtMs?: number;
};

export function talksToCourseFacts(
  talks: readonly CourseEvidenceTalk[],
): CourseEventFact[] {
  const now = Date.now();
  return talks.map((line, i) => {
    const who = line.who?.trim() ?? '';
    const body = line.text.trim();
    const locomotion =
      line.kind === 'move' || line.kind === 'action' || line.kind === 'act';
    const text = locomotion ? body || who : `${who} ${body}`.trim();
    return {
      id: line.id || `talk-${i}`,
      kind: line.kind,
      agentKey: line.agentKey ?? line.agentId ?? null,
      createdAtMs: line.createdAtMs ?? now - (talks.length - i),
      text,
      degraded: line.degraded,
      neutral: line.neutral,
    };
  });
}

function evidenceOptionPredicates(
  options: readonly CourseEvidenceOption[],
  boardKind?: string,
): ReadonlyArray<{ readonly id: string; readonly predicate: CoursePredicate }> {
  const inferred =
    boardKind === 'binary' ? inferredPresenceBoard(options.map((opt) => ({
      id: opt.id,
      predicate: opt.predicateType === 'agent_presence'
        ? {
            type: 'agent_presence' as const,
            agentKey: opt.agentKey,
            name: opt.agentName ?? opt.label,
            present: opt.present,
          }
        : {
            type: 'event_needle' as const,
            needles: opt.needles ?? needlesFromLine(opt.label),
            agentKey: opt.agentKey,
            name: opt.agentName ?? opt.label,
          },
    }))) : null;

  return options.map((opt) => {
    if (opt.predicateType === 'agent_presence') {
      return {
        id: opt.id,
        predicate: {
          type: 'agent_presence' as const,
          agentKey: opt.agentKey,
          name: opt.agentName ?? opt.label,
          present: opt.present,
        },
      };
    }
    if (inferred && opt.agentKey && inferred.agentKey === opt.agentKey) {
      return {
        id: opt.id,
        predicate: {
          type: 'agent_presence' as const,
          agentKey: inferred.agentKey,
          name: inferred.name ?? opt.agentName ?? opt.label,
          present: opt.id === inferred.stayId,
        },
      };
    }
    return {
      id: opt.id,
      predicate: {
        type: 'event_needle' as const,
        needles:
          opt.needles && opt.needles.length > 0
            ? opt.needles
            : needlesFromLine(opt.label),
        ...(opt.agentKey ? { agentKey: opt.agentKey } : {}),
        ...(opt.agentName ? { name: opt.agentName } : {}),
      },
    };
  });
}

/** Live preview of which sides settlement would credit — mirrors judgeCourseWindow. */
export function previewCourseEvidenceHits(input: {
  readonly options: readonly CourseEvidenceOption[];
  readonly talks: readonly CourseEvidenceTalk[];
  readonly boardKind?: string;
  readonly windowStartMs?: number;
  readonly windowEndMs?: number;
}): ReadonlyArray<{
  readonly optionId: string;
  readonly label: string;
  readonly hits: number;
  readonly leading: boolean;
}> {
  const start = input.windowStartMs ?? 0;
  const end = input.windowEndMs ?? Number.MAX_SAFE_INTEGER;
  const facts = talksToCourseFacts(input.talks).filter(
    (event) => event.createdAtMs >= start && event.createdAtMs < end,
  );
  const predicates = evidenceOptionPredicates(input.options, input.boardKind);
  const judged = judgeCourseWindow({
    events: facts,
    options: predicates,
    windowStartMs: start,
    windowEndMs: end,
  });
  const leadingId = judged.winningOptionId;
  return input.options.map((option) => ({
    optionId: option.id,
    label: option.label,
    hits: judged.matches[option.id] ?? 0,
    leading: Boolean(leadingId && option.id === leadingId),
  }));
}

/** 2–4 named places as options. One place alone cannot be judged. */
export function suggestCourseFromPlaces(
  places: readonly { readonly id?: string; readonly name: string }[],
  locale: 'zh-CN' | 'en' = 'zh-CN',
): {
  readonly prompt: string;
  readonly options: ReadonlyArray<{
    readonly label: string;
    readonly needles: readonly string[];
  }>;
} | null {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const place of places) {
    const name = place.name.trim().slice(0, 24);
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(name);
    if (labels.length >= 4) break;
  }
  if (labels.length < 2) return null;
  return {
    prompt:
      locale === 'en'
        ? 'Which named place came up in talk tonight'
        : '今夜对白点到了哪一处',
    options: labels.map((label) => {
      const extra = needlesFromLine(label);
      const needles = [label, ...extra].filter(
        (row, i, arr) => row.length >= 2 && arr.indexOf(row) === i,
      );
      return { label, needles };
    }),
  };
}

export function placesFromWorldSpec(spec: unknown): ReadonlyArray<{
  readonly id: string;
  readonly name: string;
}> {
  if (!spec || typeof spec !== 'object') return [];
  const space = (spec as { space?: { regions?: unknown } }).space;
  const regions = space?.regions;
  if (!Array.isArray(regions)) return [];
  const out: Array<{ id: string; name: string }> = [];
  for (const row of regions) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { id?: unknown; name?: unknown };
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    const id =
      typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : name;
    if (name.length < 2) continue;
    out.push({ id, name });
  }
  return out.slice(0, 12);
}

export type CourseReachability = 'high' | 'medium' | 'low';
export type CourseEvidenceHealth = 'none' | 'living' | 'muted';
export type CourseSeedSource =
  | 'talks'
  | 'binary'
  | 'places'
  | 'beats'
  | 'night_market'
  | 'custom'
  | 'auto';

export type CourseSteeringHint = {
  readonly prompt: string;
  readonly labels: readonly string[];
  readonly phase: 'betting' | 'evidence';
};

function beatsFromWorldSpec(spec: unknown): ReadonlyArray<{ readonly text: string }> {
  if (!spec || typeof spec !== 'object') return [];
  const narrative = (spec as { narrative?: { beats?: unknown } }).narrative;
  if (!narrative || !Array.isArray(narrative.beats)) return [];
  const out: Array<{ text: string }> = [];
  for (const raw of narrative.beats) {
    if (!raw || typeof raw !== 'object') continue;
    const text =
      typeof (raw as { text?: unknown }).text === 'string'
        ? String((raw as { text: string }).text).trim()
        : '';
    if (text.length < 2) continue;
    out.push({ text });
    if (out.length >= 4) break;
  }
  return out;
}

export function recentTalkHaystack(lines: readonly CourseTalkHint[]): string {
  return lines
    .filter(
      (line) =>
        !line.degraded &&
        (line.kind == null ||
          line.kind === 'dialogue' ||
          line.kind === 'intervene'),
    )
    .map((line) => `${line.who ?? ''} ${line.text}`.trim())
    .join(' ')
    .toLowerCase();
}

/** Beats may seed a board only when their needles already appear in town voice. */
export function beatsEligibleForCourse(
  spec: unknown,
  recentTalks: readonly CourseTalkHint[],
): boolean {
  const beats = beatsFromWorldSpec(spec);
  if (beats.length < 2) return false;
  const presentation = (spec as { presentation?: Record<string, unknown> })
    .presentation;
  const rumor =
    typeof presentation?.openingRumor === 'string'
      ? presentation.openingRumor
      : '';
  const seed =
    typeof presentation?.narrativeSeed === 'string'
      ? presentation.narrativeSeed
      : '';
  const hay = `${rumor} ${seed} ${recentTalkHaystack(recentTalks)}`.toLowerCase();
  return beats.some((beat) =>
    needlesFromLine(beat.text).some((needle) => hay.includes(needle.toLowerCase())),
  );
}

export function courseBoardReachability(input: {
  readonly seedKind: string;
  readonly options: ReadonlyArray<{ readonly needles?: readonly string[] }>;
  readonly recentTalks: readonly CourseTalkHint[];
}): CourseReachability {
  const kind = input.seedKind;
  if (kind === 'talks') return 'high';
  if (kind === 'binary') return 'medium';
  if (kind === 'places' || kind === 'beats' || kind === 'night_market') {
    return 'medium';
  }
  const hay = recentTalkHaystack(input.recentTalks);
  if (!hay.trim()) return 'low';
  const needles = input.options.flatMap((row) => row.needles ?? []);
  const hit = needles.some((needle) =>
    hay.includes(needle.trim().toLowerCase()),
  );
  return hit ? 'medium' : 'low';
}

export function validateCourseSeedReachability(input: {
  readonly seedPick: 'talks' | 'resident' | 'places' | 'custom' | 'auto' | 'village';
  readonly options: ReadonlyArray<{
    readonly label: string;
    readonly needles?: readonly string[];
  }>;
  readonly recentTalks: readonly CourseTalkHint[];
}): { readonly ok: boolean; readonly reachability: CourseReachability } {
  if (input.seedPick === 'talks') {
    return { ok: true, reachability: 'high' };
  }
  if (input.seedPick === 'resident') {
    return { ok: true, reachability: 'medium' };
  }
  if (input.seedPick === 'places') {
    return { ok: true, reachability: 'medium' };
  }
  const reachability = courseBoardReachability({
    seedKind: 'custom',
    options: input.options,
    recentTalks: input.recentTalks,
  });
  return { ok: reachability !== 'low', reachability };
}

export function courseEvidenceHealthOf(input: {
  readonly hasLivingEvidence: boolean;
  readonly mutedHint: boolean;
}): CourseEvidenceHealth {
  if (input.hasLivingEvidence) return 'living';
  if (input.mutedHint) return 'muted';
  return 'none';
}

/** Live-first auto-seed attempt order (see world-betting.md §2). */
export const WORLD_COURSE_SEED_ATTEMPTS = [
  'talks',
  'binary',
  'places',
  'beats',
  'night_market',
] as const satisfies readonly CourseSeedSource[];

/**
 * Whether a town may auto-open a course board (funded + watched + not paused).
 * Budget/key checks are optimistic here — seeding does not call the model.
 */
export function courseTownReadyForSeed(input: {
  readonly lightUntilMs?: number | null;
  readonly clockPaused?: boolean;
  readonly heartbeatUntil?: Date | string | null;
  readonly authorWatchUntil?: Date | string | null;
  readonly townTimeUntil?: Date | string | null;
  readonly now?: number;
  /** Demo open world: lamp is not required. Presence still is. */
  readonly openWorld?: boolean;
}): boolean {
  const now = input.now ?? Date.now();
  if (input.clockPaused) return false;
  if (!input.openWorld && (!input.lightUntilMs || input.lightUntilMs <= now)) {
    return false;
  }
  return (
    societyTalkMuteReason({
      presenceUntil: input.heartbeatUntil,
      authorWatchUntil: input.authorWatchUntil,
      townTimeUntil: input.townTimeUntil,
      clockPaused: input.clockPaused,
      budgetOpen: true,
      hasLlm: true,
      now,
    }) === null
  );
}

/** Soft steering block for live converse prompts during the evidence window. */
export function courseSteeringWindowOpen(input: {
  readonly status: string;
  readonly bettingClosesAtMs: number;
  readonly nowMs: number;
}): boolean {
  if (input.status !== 'open' && input.status !== 'closed') return false;
  return input.nowMs >= input.bettingClosesAtMs;
}

export function courseSteeringPromptBlock(
  hint: Pick<CourseSteeringHint, 'prompt' | 'labels'>,
  ascii: boolean,
): string {
  const labels = hint.labels
    .map((row) => row.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(ascii ? ', ' : '、');
  if (!labels) return '';
  const prompt = hint.prompt.trim().slice(0, 80);
  return ascii
    ? `\nBackdrop: the town is debating "${prompt}". Sides often heard: ${labels}. Touch these naturally; do not quote the betting board.`
    : `\n背景：镇上今晚在争「${prompt.slice(0, 40)}」，常见说法是${labels}。可自然触及这些方向，不要生硬复读盘口用语。`;
}

export const COURSE_VOID_REASONS = [
  'muted',
  'unclear',
  'paused',
  'takedown',
  'no_winner',
  'uncontested',
  'author_replace',
] as const;

export type CourseVoidReason = (typeof COURSE_VOID_REASONS)[number];

export function courseVoidReasonKey(reason: string | null | undefined): string {
  if (reason && (COURSE_VOID_REASONS as readonly string[]).includes(reason)) {
    return `product.obs.course.void.${reason}`;
  }
  return 'product.obs.course.voided';
}

export type CourseClockPhase = 'betting' | 'evidence' | 'due' | 'done';

/**
 * When the board must leave open/closed. Betting still open + one-sided
 * is *not* due — the first chip may still withdraw. After the betting
 * clock (or status=closed), a one-sided pile voids immediately. A real
 * contest waits until settlesAt.
 */
export function courseShouldSettleNow(input: {
  readonly status: string;
  readonly settlesAtMs: number;
  readonly bettingClosesAtMs: number;
  readonly contested: boolean;
  readonly nowMs: number;
}): boolean {
  if (input.status === 'settled' || input.status === 'void') return false;
  if (input.nowMs >= input.settlesAtMs) return true;
  const bettingOver =
    input.status === 'closed' || input.nowMs >= input.bettingClosesAtMs;
  return bettingOver && !input.contested;
}

/** Auto-void reason once {@link courseShouldSettleNow} is true; else undefined. */
export function courseSettleForceVoid(input: {
  readonly status: string;
  readonly settlesAtMs: number;
  readonly bettingClosesAtMs: number;
  readonly contested: boolean;
  readonly sides: number;
  readonly nowMs: number;
}): string | undefined {
  if (!courseShouldSettleNow(input)) return undefined;
  const bettingOver =
    input.status === 'closed' || input.nowMs >= input.bettingClosesAtMs;
  if (bettingOver && !input.contested) {
    return input.sides > 0 ? 'uncontested' : 'no_winner';
  }
  return undefined;
}

/**
 * Three clocks the board must show. Remaining time only — never “等到整点”.
 */
export function coursePhaseClock(input: {
  readonly status: string;
  readonly bettingClosesAtMs: number;
  readonly settlesAtMs: number;
  readonly nowMs: number;
}): {
  readonly phase: CourseClockPhase;
  readonly remainMs: number;
  readonly remainMinutes: number;
} {
  if (input.status === 'settled' || input.status === 'void') {
    return { phase: 'done', remainMs: 0, remainMinutes: 0 };
  }
  if (input.nowMs < input.bettingClosesAtMs) {
    const remainMs = input.bettingClosesAtMs - input.nowMs;
    return {
      phase: 'betting',
      remainMs,
      remainMinutes: Math.max(1, Math.round(remainMs / 60_000)),
    };
  }
  if (input.nowMs < input.settlesAtMs) {
    const remainMs = input.settlesAtMs - input.nowMs;
    return {
      phase: 'evidence',
      remainMs,
      remainMinutes: Math.max(1, Math.round(remainMs / 60_000)),
    };
  }
  return { phase: 'due', remainMs: 0, remainMinutes: 0 };
}

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** China tonight (UTC+8) wall parts for the board clock. */
export function chinaWallClock(
  iso: string,
  nowMs = Date.now(),
): {
  readonly hour: number;
  readonly minute: number;
  readonly clock: string;
  readonly day: 'tonight' | 'tomorrow' | 'later';
} | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const china = new Date(at + CHINA_OFFSET_MS);
  const hour = china.getUTCHours();
  const minute = china.getUTCMinutes();
  const ymd = china.toISOString().slice(0, 10);
  const nowYmd = new Date(nowMs + CHINA_OFFSET_MS).toISOString().slice(0, 10);
  const tomorrowYmd = new Date(nowMs + CHINA_OFFSET_MS + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const day =
    ymd === nowYmd ? 'tonight' : ymd === tomorrowYmd ? 'tomorrow' : 'later';
  return {
    hour,
    minute,
    clock: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    day,
  };
}
