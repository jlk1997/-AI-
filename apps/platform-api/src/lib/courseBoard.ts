/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Living-town 走向盘: lock points, settle by predicates, never fake talks.
 */

import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import {
  agentMemories,
  agentRelations,
  communityGames,
  deployments,
  kaiTransfers,
  projects,
  societyEvents,
  users,
  worldAgents,
  worldWhispers,
  worldCourseNodes,
  worldCourseOptions,
  worldCourseStakes,
  worlds,
} from '@opengame/platform-db';
import {
  BINARY_STAY_COURSE,
  COURSE,
  NIGHT_MARKET_COURSE_OPTIONS,
  NIGHT_MARKET_COURSE_PROMPT,
  alleyCourseOverlapsChinaDay,
  authorCourseRake,
  beatsEligibleForCourse,
  canAddStake,
  canWithdrawCourseStake,
  courseBoardReachability,
  courseCanonLine,
  courseEvidenceHealthOf,
  courseWinLine,
  coursePromptLocale,
  courseVoidCanonLine,
  worldCoursePrefersNightMarket,
  nextWorldCourseSeedKind,
  courseContest,
  courseSettlementTelemetry,
  courseRake,
  courseSettleForceVoid,
  courseShouldSettleNow,
  courseStakeSteps,
  decideCourseOutcome,
  isCourseStakeStep,
  isLivingCourseEvidence,
  maxAdditionalStake,
  judgeCourseWindow,
  matchCourseOptionKey,
  needlesFromLine,
  parseCoursePredicate,
  placesFromWorldSpec,
  suggestCourseFromPlaces,
  suggestCourseFromTalks,
  settlePariMutuel,
  buildAwayPoseCourseFacts,
  courseLocationLooksAway,
  type CourseEventFact,
  type CourseEvidenceHealth,
  type CoursePredicate,
  type CourseReachability,
  type CourseSeedSource,
  type CourseSteeringHint,
  type CourseTalkHint,
  courseActIndex,
  courseActLabelKey,
  courseTownReadyForSeed,
  courseSteeringWindowOpen,
  courseRoundMs,
  parseCourseRoundPreset,
} from '@opengame/platform-shared';

import {
  notifyCourseClosedPush,
  notifyCourseContestedPush,
  notifyCourseSettlePush,
} from './coursePush.js';
import {
  isCourseGameWatched,
  notifyCourseFollowOpenPush,
  notifyCourseWatchPush,
} from './courseWatch.js';

import { chinaDayStart } from './kaiMarket.js';

import { lockOrgCommerce } from './commerce.js';
import { creditPoints, debitPoints } from './wallet.js';
import {
  publishSocietyPatron,
  societyCoursePulsePayload,
} from './societyPatrons.js';

export type CourseViewOption = {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly points: number;
  readonly share: number;
  readonly needles?: readonly string[];
  readonly predicateType?: CoursePredicate['type'];
  readonly agentKey?: string;
  readonly agentName?: string;
  readonly present?: boolean;
  readonly winHint?: string;
};

export type CourseEvidencePreview = {
  readonly muted: boolean;
  readonly leadingOptionId: string | null;
  readonly matches: Readonly<Record<string, number>>;
};

export type CourseView = {
  readonly id: string;
  readonly worldId: string;
  readonly gameId: string | null;
  readonly prompt: string;
  readonly kind: string;
  readonly status: string;
  readonly opensAt: string;
  readonly bettingClosesAt: string;
  readonly settlesAt: string;
  readonly mutedHint: boolean;
  readonly evidenceHealth: CourseEvidenceHealth;
  readonly seedSource: CourseSeedSource;
  readonly reachability: CourseReachability;
  readonly evidencePreview: CourseEvidencePreview | null;
  readonly pool: number;
  readonly minStake: number;
  readonly myPoints: number;
  readonly myOptionId: string | null;
  readonly options: readonly CourseViewOption[];
  readonly winningOptionId: string | null;
  readonly voidReason: string | null;
  readonly transcriptHash: string | null;
  readonly canon: string | null;
  readonly maxAdd: number;
  readonly addSteps: readonly number[];
  readonly hangs: readonly CourseHang[];
  readonly contested: boolean;
  readonly authorRakeIfSettled: number;
  readonly canWithdraw: boolean;
};

export type CourseHang = {
  readonly optionId: string;
  readonly label: string;
  readonly text: string;
  readonly authorName: string;
  readonly paid: boolean;
};

export type CourseSeedKind =
  | 'night_market'
  | 'binary'
  | 'beats'
  | 'talks'
  | 'places'
  | 'custom'
  | 'auto';

export type CourseSeedError =
  | 'no_agents'
  | 'no_beats'
  | 'bad_options'
  | 'replace_blocked_contested'
  | 'replace_blocked_settled'
  | 'queue_full'
  | 'queue_replace_conflict'
  | 'queue_empty';

export type CourseSeedBody = {
  readonly kind?: CourseSeedKind;
  readonly agentKey?: string;
  readonly prompt?: string;
  readonly options?: ReadonlyArray<{
    readonly key?: string;
    readonly label?: string;
    readonly needles?: readonly string[];
  }>;
  readonly replace?: boolean;
  readonly queue?: boolean;
  readonly cancelQueue?: boolean;
};

type CoursePulseRedis = {
  publish(channel: string, message: string): Promise<unknown>;
};

let coursePulseRedis: CoursePulseRedis | null = null;

export function bindCoursePulseRedis(redis: CoursePulseRedis | null): void {
  coursePulseRedis = redis;
}

export async function emitCoursePulse(
  worldId: string,
  view: (Pick<
    CourseView,
    'id' | 'status' | 'pool' | 'contested' | 'winningOptionId' | 'voidReason'
  > & {
    readonly options?: ReadonlyArray<{ readonly id: string; readonly points: number }>;
    readonly canon?: string | null;
  }) | null,
): Promise<void> {
  if (!coursePulseRedis) return;
  await publishSocietyPatron(
    coursePulseRedis,
    worldId,
    societyCoursePulsePayload({
      nodeId: view?.id ?? null,
      status: view?.status ?? 'none',
      pool: view?.pool ?? 0,
      contested: Boolean(view?.contested),
      winningOptionId: view?.winningOptionId ?? null,
      voidReason: view?.voidReason ?? null,
      options: view?.options?.map((row) => ({ id: row.id, points: row.points })),
      canon: view?.canon ?? null,
    }),
  ).catch(() => undefined);
}

function eventDegraded(payload: unknown): boolean {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      (payload as { degraded?: unknown }).degraded === true,
  );
}

function eventNeutral(payload: unknown): boolean {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      (payload as { courseNeutral?: unknown }).courseNeutral === true,
  );
}

function eventText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const row = payload as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['text', 'line', 'content', 'stimulus', 'utterance', 'rumor', 'summary']) {
    if (typeof row[key] === 'string' && row[key].trim()) parts.push(row[key]);
  }
  for (const key of [
    'locationName',
    'areaName',
    'goalPlace',
    'toRegionId',
    'regionId',
    'regionName',
    'toRegionName',
    'placeName',
  ]) {
    if (typeof row[key] === 'string' && row[key].trim()) parts.push(row[key]);
  }
  return parts.join(' ');
}

function regionNamesFromSpec(spec: unknown): Map<string, string> {
  const regions = (
    spec as {
      space?: { regions?: ReadonlyArray<{ id?: unknown; name?: unknown }> };
    } | null
  )?.space?.regions;
  const out = new Map<string, string>();
  if (!Array.isArray(regions)) return out;
  for (const region of regions) {
    if (!region || typeof region.id !== 'string') continue;
    out.set(
      region.id,
      typeof region.name === 'string' && region.name.trim()
        ? region.name
        : region.id,
    );
  }
  return out;
}

/**
 * Lock order (never invert — deadlock):
 *   1. course-world:{worldId}  — seed / ensure only
 *   2. course-node:{nodeId}    — stake / withdraw / settle
 *   3. course:{orgId}          — wallet debit/credit on stake / withdraw
 * Settle never takes the org lock. Seed never takes a node lock.
 * World and node keys are different namespaces; do not nest a global
 * settle sweep under a world lock.
 */
async function lockWorldCourse(db: DrizzleDb, worldId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`course-world:${worldId}`}))`);
}

async function lockCourseNode(db: DrizzleDb, nodeId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`course-node:${nodeId}`}))`);
}

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 4 && current && typeof current === 'object'; i += 1) {
    const row = current as { code?: unknown; cause?: unknown };
    if (row.code === '23505') return true;
    current = row.cause;
  }
  return false;
}

async function bindCourseGameId(
  db: DrizzleDb,
  node: typeof worldCourseNodes.$inferSelect,
  gameId?: string | null,
): Promise<typeof worldCourseNodes.$inferSelect> {
  if (!gameId || node.communityGameId) return node;
  const [next] = await db
    .update(worldCourseNodes)
    .set({ communityGameId: gameId })
    .where(
      and(eq(worldCourseNodes.id, node.id), sql`${worldCourseNodes.communityGameId} is null`),
    )
    .returning();
  return next ?? { ...node, communityGameId: gameId };
}

async function hasLivingEvidence(
  db: DrizzleDb,
  worldId: string,
  start: Date,
  end: Date,
): Promise<boolean> {
  const rows = await db
    .select({
      kind: societyEvents.kind,
      payloadJson: societyEvents.payloadJson,
    })
    .from(societyEvents)
    .where(
      and(
        eq(societyEvents.worldId, worldId),
        eq(societyEvents.invalidated, 0),
        inArray(societyEvents.kind, ['dialogue', 'intervene']),
        gte(societyEvents.createdAt, start),
        lt(societyEvents.createdAt, end),
      ),
    )
    .limit(24);
  return rows.some((row) =>
    isLivingCourseEvidence({
      id: 'peek',
      kind: row.kind,
      agentKey: null,
      createdAtMs: start.getTime(),
      text: eventText(row.payloadJson),
      degraded: eventDegraded(row.payloadJson),
    }),
  );
}

async function loadFacts(
  db: DrizzleDb,
  worldId: string,
  start: Date,
  end: Date,
): Promise<CourseEventFact[]> {
  const [eventRows, memoryRows, relationRows] = await Promise.all([
    db
      .select({
        id: societyEvents.id,
        kind: societyEvents.kind,
        agentKey: societyEvents.agentKey,
        createdAt: societyEvents.createdAt,
        payloadJson: societyEvents.payloadJson,
        invalidated: societyEvents.invalidated,
      })
      .from(societyEvents)
      .where(
        and(
          eq(societyEvents.worldId, worldId),
          eq(societyEvents.invalidated, 0),
          gte(societyEvents.createdAt, start),
          lt(societyEvents.createdAt, end),
        ),
      )
      .orderBy(desc(societyEvents.createdAt))
      .limit(800),
    db
      .select({
        id: agentMemories.id,
        agentKey: agentMemories.agentKey,
        text: agentMemories.text,
        createdAt: agentMemories.createdAt,
      })
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.worldId, worldId),
          gte(agentMemories.createdAt, start),
          lt(agentMemories.createdAt, end),
        ),
      )
      .orderBy(desc(agentMemories.createdAt))
      .limit(400),
    db
      .select({
        id: agentRelations.id,
        fromAgentKey: agentRelations.fromAgentKey,
        summary: agentRelations.summary,
        affinity: agentRelations.affinity,
        updatedAt: agentRelations.updatedAt,
      })
      .from(agentRelations)
      .where(
        and(
          eq(agentRelations.worldId, worldId),
          gte(agentRelations.updatedAt, start),
          lt(agentRelations.updatedAt, end),
        ),
      )
      .orderBy(desc(agentRelations.updatedAt))
      .limit(200),
  ]);
  const events = eventRows
    .filter((row) => {
      const payload = row.payloadJson;
      if (
        row.kind === 'observation' &&
        payload &&
        typeof payload === 'object' &&
        (payload as { course?: unknown }).course === true
      ) {
        return false;
      }
      return true;
    })
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      agentKey: row.agentKey,
      createdAtMs: row.createdAt.getTime(),
      text: eventText(row.payloadJson),
      degraded: eventDegraded(row.payloadJson),
      neutral: eventNeutral(row.payloadJson),
    }));
  const memories = memoryRows
    .filter((row) => row.createdAt >= start && row.createdAt < end)
    .map((row) => ({
      id: `memory:${row.id}`,
      kind: 'memory',
      agentKey: row.agentKey,
      createdAtMs: row.createdAt.getTime(),
      text: row.text,
    }));
  const relations = relationRows
    .filter((row) => row.updatedAt >= start && row.updatedAt < end)
    .map((row) => ({
      id: `relation:${row.id}`,
      kind: 'relation',
      agentKey: row.fromAgentKey,
      createdAtMs: row.updatedAt.getTime(),
      text: `${row.summary} ${row.affinity}`,
    }));
  return [...events, ...memories, ...relations];
}

async function stakesOf(
  db: DrizzleDb,
  nodeId: string,
): Promise<
  Array<{
    organizationId: string;
    optionId: string;
    points: number;
  }>
> {
  return db
    .select({
      organizationId: worldCourseStakes.organizationId,
      optionId: worldCourseStakes.optionId,
      points: worldCourseStakes.points,
    })
    .from(worldCourseStakes)
    .where(eq(worldCourseStakes.nodeId, nodeId));
}

/** Flip open → closed when the betting clock is up. Does not pay anyone. */
export async function closeExpiredBetting(
  db: DrizzleDb,
  now = new Date(),
  worldId?: string,
): Promise<number> {
  const filters = [
    eq(worldCourseNodes.status, 'open'),
    lte(worldCourseNodes.bettingClosesAt, now),
  ];
  if (worldId) filters.push(eq(worldCourseNodes.worldId, worldId));
  const rows = await db
    .update(worldCourseNodes)
    .set({ status: 'closed' })
    .where(and(...filters))
    .returning({ id: worldCourseNodes.id, worldId: worldCourseNodes.worldId });
  for (const row of rows) {
    const [node] = await db
      .select()
      .from(worldCourseNodes)
      .where(eq(worldCourseNodes.id, row.id))
      .limit(1);
    if (node) {
      void emitCoursePulse(row.worldId, await toView(db, node, null));
      void notifyCourseClosedPush(db, {
        nodeId: node.id,
        gameId: node.communityGameId,
        webBaseUrl: process.env['PLATFORM_WEB_BASE_URL'] ?? null,
      }).catch(() => undefined);
      if (node.communityGameId) {
        const stakeUsers = await db
          .select({ userId: worldCourseStakes.userId })
          .from(worldCourseStakes)
          .where(eq(worldCourseStakes.nodeId, node.id));
        const excludeUserIds = stakeUsers
          .map((row) => row.userId)
          .filter((id): id is string => Boolean(id));
        void notifyCourseWatchPush(db, {
          gameId: node.communityGameId,
          nodeId: node.id,
          kind: 'closed',
          prompt: node.prompt,
          excludeUserIds,
          webBaseUrl: process.env['PLATFORM_WEB_BASE_URL'] ?? null,
        }).catch(() => undefined);
      }
    }
  }
  return rows.length;
}

async function closeExpiredNode(
  db: DrizzleDb,
  nodeId: string,
  now = new Date(),
): Promise<void> {
  await db
    .update(worldCourseNodes)
    .set({ status: 'closed' })
    .where(
      and(
        eq(worldCourseNodes.id, nodeId),
        eq(worldCourseNodes.status, 'open'),
        lte(worldCourseNodes.bettingClosesAt, now),
      ),
    );
}

async function hangsOf(
  db: DrizzleDb,
  nodeId: string,
): Promise<CourseHang[]> {
  const rows = await db
    .select({
      optionId: worldWhispers.courseOptionId,
      text: worldWhispers.text,
      paid: worldWhispers.paid,
      displayName: users.displayName,
      handle: users.handle,
      label: worldCourseOptions.label,
    })
    .from(worldWhispers)
    .innerJoin(users, eq(users.id, worldWhispers.userId))
    .leftJoin(
      worldCourseOptions,
      eq(worldCourseOptions.id, worldWhispers.courseOptionId),
    )
    .where(eq(worldWhispers.courseNodeId, nodeId))
    .orderBy(desc(worldWhispers.createdAt))
    .limit(8);
  const out: CourseHang[] = [];
  for (const row of rows) {
    if (!row.optionId || !row.label) continue;
    out.push({
      optionId: row.optionId,
      label: row.label,
      text: row.text,
      authorName: (row.handle || row.displayName || '访客').trim(),
      paid: Boolean(row.paid),
    });
  }
  return out;
}

async function loadRecentTalkHints(
  db: DrizzleDb,
  worldId: string,
): Promise<readonly CourseTalkHint[]> {
  const [agents, spoken] = await Promise.all([
    db
      .select({ key: worldAgents.agentKey, name: worldAgents.name })
      .from(worldAgents)
      .where(eq(worldAgents.worldId, worldId))
      .limit(40),
    db
      .select({
        kind: societyEvents.kind,
        payloadJson: societyEvents.payloadJson,
        agentKey: societyEvents.agentKey,
      })
      .from(societyEvents)
      .where(
        and(
          eq(societyEvents.worldId, worldId),
          eq(societyEvents.invalidated, 0),
          inArray(societyEvents.kind, ['dialogue', 'intervene']),
        ),
      )
      .orderBy(desc(societyEvents.createdAt))
      .limit(12),
  ]);
  const byKey = new Map(agents.map((row) => [row.key, row.name]));
  const talks: CourseTalkHint[] = [];
  for (const row of spoken) {
    const text = eventText(row.payloadJson).trim();
    if (text.length < 2) continue;
    const who = row.agentKey ? byKey.get(row.agentKey) : undefined;
    talks.push({
      ...(who ? { who } : {}),
      text,
      kind: row.kind,
      degraded: eventDegraded(row.payloadJson),
    });
  }
  talks.reverse();
  return talks;
}

async function buildEvidencePreview(
  db: DrizzleDb,
  node: typeof worldCourseNodes.$inferSelect,
  options: ReadonlyArray<typeof worldCourseOptions.$inferSelect>,
): Promise<CourseEvidencePreview | null> {
  if (node.status !== 'open' && node.status !== 'closed') return null;
  const facts = await loadFacts(db, node.worldId, node.opensAt, node.settlesAt);
  const judged = judgeCourseWindow({
    events: facts,
    options: options.map((option) => ({
      id: option.id,
      predicate: parseCoursePredicate(option.predicateJson) as CoursePredicate,
    })),
    windowStartMs: node.opensAt.getTime(),
    windowEndMs: node.settlesAt.getTime(),
  });
  return {
    muted: judged.muted,
    leadingOptionId: judged.winningOptionId,
    matches: judged.matches,
  };
}

export async function courseSeedGateAllowed(
  db: DrizzleDb,
  worldId: string,
  now = Date.now(),
): Promise<boolean> {
  const [world] = await db
    .select({
      lightUntil: worlds.lightUntil,
      clockPaused: worlds.clockPaused,
      heartbeatUntil: worlds.heartbeatUntil,
      authorWatchUntil: worlds.authorWatchUntil,
      townTimeUntil: worlds.townTimeUntil,
    })
    .from(worlds)
    .where(eq(worlds.id, worldId))
    .limit(1);
  if (!world || world.clockPaused) return false;
  return courseTownReadyForSeed({
    lightUntilMs: world.lightUntil?.getTime() ?? null,
    clockPaused: world.clockPaused,
    heartbeatUntil: world.heartbeatUntil,
    authorWatchUntil: world.authorWatchUntil,
    townTimeUntil: world.townTimeUntil,
    now,
    openWorld: process.env['PLATFORM_DEMO_OPEN_WORLD'] === '1',
  });
}

export async function loadCourseSteeringHint(
  db: DrizzleDb,
  worldId: string,
  now = new Date(),
): Promise<CourseSteeringHint | null> {
  const node = await loadActiveCourseNode(db, worldId);
  if (!node || (node.status !== 'open' && node.status !== 'closed')) return null;
  if (
    !courseSteeringWindowOpen({
      status: node.status,
      bettingClosesAtMs: node.bettingClosesAt.getTime(),
      nowMs: now.getTime(),
    })
  ) {
    return null;
  }
  const options = await db
    .select({ label: worldCourseOptions.label })
    .from(worldCourseOptions)
    .where(eq(worldCourseOptions.nodeId, node.id))
    .orderBy(worldCourseOptions.sortOrder);
  const labels = options.map((row) => row.label).filter(Boolean);
  if (!labels.length) return null;
  return {
    prompt: node.prompt,
    labels,
    phase: 'evidence',
  };
}

async function toView(
  db: DrizzleDb,
  node: typeof worldCourseNodes.$inferSelect,
  viewerOrgId?: string | null,
  locale: 'zh-CN' | 'en' = 'zh-CN',
): Promise<CourseView> {
  const [options, stakes, hangs] = await Promise.all([
    db
      .select()
      .from(worldCourseOptions)
      .where(eq(worldCourseOptions.nodeId, node.id))
      .orderBy(worldCourseOptions.sortOrder),
    stakesOf(db, node.id),
    hangsOf(db, node.id),
  ]);
  const pool = stakes.reduce((sum, row) => sum + row.points, 0);
  const mine = viewerOrgId
    ? stakes.find((row) => row.organizationId === viewerOrgId)
    : undefined;
  const winning = options.find((row) => row.id === node.winningOptionId);
  const maxAdd = maxAdditionalStake(pool, mine?.points ?? 0);
  const contest = courseContest(stakes);
  const live =
    node.status === 'open' || node.status === 'closed'
      ? await hasLivingEvidence(db, node.worldId, node.opensAt, node.settlesAt)
      : true;
  const mutedHint = (node.status === 'open' || node.status === 'closed') && !live;
  const recentTalks = await loadRecentTalkHints(db, node.worldId);
  const optionRows = options.map((option) => {
    const points = stakes
      .filter((row) => row.optionId === option.id)
      .reduce((sum, row) => sum + row.points, 0);
    const predicate = parseCoursePredicate(option.predicateJson);
    return {
      id: option.id,
      key: option.key,
      label: option.label,
      points,
      share: pool > 0 ? points / pool : 0,
      needles: predicate.needles ?? [],
      predicateType: predicate.type,
      ...(predicate.agentKey ? { agentKey: predicate.agentKey } : {}),
      ...(predicate.name ? { agentName: predicate.name } : {}),
      ...(typeof predicate.present === 'boolean'
        ? { present: predicate.present }
        : {}),
      winHint: courseWinLine({ locale, predicate, label: option.label }),
    };
  });
  const seedSource = (node.kind || 'custom') as CourseSeedSource;
  const reachability = courseBoardReachability({
    seedKind: seedSource,
    options: optionRows,
    recentTalks,
  });
  const evidencePreview = await buildEvidencePreview(db, node, options);
  return {
    id: node.id,
    worldId: node.worldId,
    gameId: node.communityGameId,
    prompt: node.prompt,
    kind: node.kind,
    status: node.status,
    opensAt: node.opensAt.toISOString(),
    bettingClosesAt: node.bettingClosesAt.toISOString(),
    settlesAt: node.settlesAt.toISOString(),
    mutedHint,
    evidenceHealth: courseEvidenceHealthOf({ hasLivingEvidence: live, mutedHint }),
    seedSource,
    reachability,
    evidencePreview,
    pool,
    minStake: COURSE.minStake,
    myPoints: mine?.points ?? 0,
    myOptionId: mine?.optionId ?? null,
    options: optionRows,
    winningOptionId: node.winningOptionId,
    voidReason: node.voidReason,
    transcriptHash: node.transcriptHash,
    canon:
      node.status === 'settled' && winning
        ? courseCanonLine({
            locale,
            prompt: node.prompt,
            winningLabel: winning.label,
          })
        : null,
    maxAdd,
    addSteps: courseStakeSteps(maxAdd),
    hangs,
    contested: contest.contested,
    authorRakeIfSettled: contest.contested
      ? authorCourseRake(courseRake(pool))
      : 0,
    canWithdraw: canWithdrawCourseStake({
      status: node.status,
      contested: contest.contested,
      myPoints: mine?.points ?? 0,
    }),
  };
}

export async function listCourseHistory(
  db: DrizzleDb,
  worldId: string,
  locale: 'zh-CN' | 'en' = 'zh-CN',
): Promise<CourseView[]> {
  const rows = await db
    .select()
    .from(worldCourseNodes)
    .where(
      and(
        eq(worldCourseNodes.worldId, worldId),
        inArray(worldCourseNodes.status, ['settled', 'void']),
      ),
    )
    .orderBy(desc(worldCourseNodes.settledAt), desc(worldCourseNodes.createdAt))
    .limit(5);
  const views: CourseView[] = [];
  for (const row of rows) {
    views.push(await toView(db, row, null, locale));
  }
  return views;
}

export async function loadActiveCourseNode(
  db: DrizzleDb,
  worldId: string,
): Promise<typeof worldCourseNodes.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(worldCourseNodes)
    .where(
      and(
        eq(worldCourseNodes.worldId, worldId),
        inArray(worldCourseNodes.status, ['open', 'closed']),
      ),
    )
    .orderBy(desc(worldCourseNodes.createdAt))
    .limit(1);
  return row ?? null;
}

export async function loadQueuedCourseNode(
  db: DrizzleDb,
  worldId: string,
): Promise<typeof worldCourseNodes.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(worldCourseNodes)
    .where(
      and(
        eq(worldCourseNodes.worldId, worldId),
        eq(worldCourseNodes.status, 'queued'),
      ),
    )
    .orderBy(asc(worldCourseNodes.createdAt))
    .limit(1);
  return row ?? null;
}

/** Open the next queued board after the active one finishes. */
export async function promoteQueuedCourseNode(
  db: DrizzleDb,
  worldId: string,
  now = new Date(),
): Promise<typeof worldCourseNodes.$inferSelect | null> {
  const active = await loadActiveCourseNode(db, worldId);
  if (active) return null;
  const queued = await loadQueuedCourseNode(db, worldId);
  if (!queued) return null;
  const times = insertNodeTimes(now);
  const [promoted] = await db
    .update(worldCourseNodes)
    .set({
      status: 'open',
      opensAt: times.opensAt,
      bettingClosesAt: times.bettingClosesAt,
      settlesAt: times.settlesAt,
    })
    .where(eq(worldCourseNodes.id, queued.id))
    .returning();
  if (!promoted) return null;
  console.log(
    '[course-queue]',
    JSON.stringify({ kind: 'promote', worldId, nodeId: promoted.id }),
  );
  void emitCoursePulse(worldId, await toView(db, promoted, null));
  if (promoted.communityGameId) {
    const webBaseUrl = process.env['PLATFORM_WEB_BASE_URL'] ?? null;
    void notifyCourseWatchPush(db, {
      gameId: promoted.communityGameId,
      nodeId: promoted.id,
      kind: 'open',
      prompt: promoted.prompt,
      webBaseUrl,
    }).catch(() => undefined);
    void notifyCourseFollowOpenPush(db, {
      gameId: promoted.communityGameId,
      nodeId: promoted.id,
      prompt: promoted.prompt,
      webBaseUrl,
    }).catch(() => undefined);
  }
  return promoted;
}

export async function cancelQueuedCourseNode(
  db: DrizzleDb,
  worldId: string,
): Promise<boolean> {
  const queued = await loadQueuedCourseNode(db, worldId);
  if (!queued) return false;
  await db
    .delete(worldCourseOptions)
    .where(eq(worldCourseOptions.nodeId, queued.id));
  await db
    .delete(worldCourseNodes)
    .where(eq(worldCourseNodes.id, queued.id));
  console.log(
    '[course-queue]',
    JSON.stringify({ kind: 'cancel', worldId, nodeId: queued.id }),
  );
  return true;
}

function courseRoundMsNow(): { readonly bettingMs: number; readonly evidenceMs: number } {
  return courseRoundMs(
    parseCourseRoundPreset(process.env['PLATFORM_COURSE_ROUND_PRESET']),
  );
}

export async function seedNightMarketCourse(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly gameId?: string | null;
    readonly userId?: string | null;
    readonly locale?: 'zh-CN' | 'en';
    readonly now?: Date;
    readonly initialStatus?: CourseNodeLifecycle;
  },
): Promise<typeof worldCourseNodes.$inferSelect> {
  const now = input.now ?? new Date();
  const locale = input.locale ?? 'zh-CN';
  const [node] = await db
    .insert(worldCourseNodes)
    .values({
      worldId: input.worldId,
      communityGameId: input.gameId ?? null,
      prompt:
        locale === 'en'
          ? NIGHT_MARKET_COURSE_PROMPT.en
          : NIGHT_MARKET_COURSE_PROMPT.zh,
      kind: 'night_market',
      ...courseNodeSchedule(now, input.initialStatus ?? 'open'),
      createdByUserId: input.userId ?? null,
    })
    .returning();
  if (!node) throw new Error('course node insert failed');
  await db.insert(worldCourseOptions).values(
    NIGHT_MARKET_COURSE_OPTIONS.map((option, index) => ({
      nodeId: node.id,
      key: option.key,
      label: locale === 'en' ? option.labelEn : option.labelZh,
      predicateJson: option.predicate,
      sortOrder: index,
    })),
  );
  return node;
}

function insertNodeTimes(now: Date) {
  const { bettingMs, evidenceMs } = courseRoundMsNow();
  return {
    opensAt: now,
    bettingClosesAt: new Date(now.getTime() + bettingMs),
    settlesAt: new Date(now.getTime() + bettingMs + evidenceMs),
  };
}

type CourseNodeLifecycle = 'open' | 'queued';

function courseNodeSchedule(
  now: Date,
  lifecycle: CourseNodeLifecycle = 'open',
): {
  readonly status: CourseNodeLifecycle;
  readonly opensAt: Date;
  readonly bettingClosesAt: Date;
  readonly settlesAt: Date;
} {
  if (lifecycle === 'queued') {
    return {
      status: 'queued',
      opensAt: now,
      bettingClosesAt: now,
      settlesAt: now,
    };
  }
  return { status: 'open', ...insertNodeTimes(now) };
}

async function insertOptions(
  db: DrizzleDb,
  nodeId: string,
  options: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly predicate: CoursePredicate;
  }>,
): Promise<void> {
  await db.insert(worldCourseOptions).values(
    options.map((option, index) => ({
      nodeId,
      key: option.key,
      label: option.label,
      predicateJson: option.predicate,
      sortOrder: index,
    })),
  );
}

async function pickStayCourseAgent(
  db: DrizzleDb,
  worldId: string,
  preferred?: string,
): Promise<{ agentKey: string; name: string; regionId: string } | null> {
  if (preferred) {
    const [hit] = await db
      .select({
        agentKey: worldAgents.agentKey,
        name: worldAgents.name,
        regionId: worldAgents.regionId,
      })
      .from(worldAgents)
      .where(
        and(eq(worldAgents.worldId, worldId), eq(worldAgents.agentKey, preferred)),
      )
      .limit(1);
    if (hit) return hit;
  }
  const [spoken, agents] = await Promise.all([
    db
      .select({ agentKey: societyEvents.agentKey })
      .from(societyEvents)
      .where(
        and(
          eq(societyEvents.worldId, worldId),
          eq(societyEvents.invalidated, 0),
          inArray(societyEvents.kind, ['dialogue', 'intervene']),
        ),
      )
      .orderBy(desc(societyEvents.createdAt))
      .limit(40),
    db
      .select({
        agentKey: worldAgents.agentKey,
        name: worldAgents.name,
        regionId: worldAgents.regionId,
      })
      .from(worldAgents)
      .where(eq(worldAgents.worldId, worldId)),
  ]);
  const byKey = new Map(agents.map((row) => [row.agentKey, row]));
  for (const row of spoken) {
    if (!row.agentKey) continue;
    const agent = byKey.get(row.agentKey);
    if (agent && !courseLocationLooksAway(agent.regionId)) return agent;
  }
  return (
    agents.find((row) => !courseLocationLooksAway(row.regionId)) ??
    agents[0] ??
    null
  );
}

async function seedTalksCourse(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly gameId?: string | null;
    readonly userId?: string | null;
    readonly locale?: 'zh-CN' | 'en';
    readonly now?: Date;
    readonly initialStatus?: CourseNodeLifecycle;
  },
  talks: readonly CourseTalkHint[],
): Promise<typeof worldCourseNodes.$inferSelect | null> {
  const locale = input.locale ?? 'zh-CN';
  const suggest = suggestCourseFromTalks(talks, locale);
  if (!suggest) return null;
  return seedCustomCourse(db, {
    ...input,
    kind: 'talks',
    prompt: suggest.prompt,
    options: suggest.options.map((row, i) => ({
      key: `t${i + 1}`,
      label: row.label,
      needles: [...row.needles],
    })),
  });
}

async function seedWorldBoundCourse(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly gameId?: string | null;
    readonly userId?: string | null;
    readonly locale?: 'zh-CN' | 'en';
    readonly now?: Date;
    readonly initialStatus?: CourseNodeLifecycle;
  },
): Promise<typeof worldCourseNodes.$inferSelect | null> {
  const talks = await loadRecentTalkHints(db, input.worldId);
  const fromTalks = await seedTalksCourse(db, input, talks);
  if (fromTalks) return fromTalks;
  const binary = await seedBinaryStayCourse(db, input);
  if (binary) return binary;
  const [world] = await db
    .select({ specJson: worlds.specJson })
    .from(worlds)
    .where(eq(worlds.id, input.worldId))
    .limit(1);
  const spec = world?.specJson;
  const places = await seedPlacesCourse(db, input, spec);
  if (places) return places;
  if (beatsEligibleForCourse(spec, talks)) {
    const beats = await seedBeatsCourse(db, input);
    if (beats) return beats;
  }
  if (worldCoursePrefersNightMarket(spec)) {
    return seedNightMarketCourse(db, input);
  }
  return null;
}

async function seedPlacesCourse(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly gameId?: string | null;
    readonly userId?: string | null;
    readonly locale?: 'zh-CN' | 'en';
    readonly now?: Date;
    readonly initialStatus?: CourseNodeLifecycle;
  },
  spec: unknown,
): Promise<typeof worldCourseNodes.$inferSelect | null> {
  const locale = input.locale ?? 'zh-CN';
  const suggest = suggestCourseFromPlaces(placesFromWorldSpec(spec), locale);
  if (!suggest) return null;
  return seedCustomCourse(db, {
    ...input,
    kind: 'places',
    prompt: suggest.prompt,
    options: suggest.options.map((row, i) => ({
      key: `c${i + 1}`,
      label: row.label,
      needles: [...row.needles],
    })),
  });
}

export async function seedBinaryStayCourse(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly gameId?: string | null;
    readonly userId?: string | null;
    readonly locale?: 'zh-CN' | 'en';
    readonly agentKey?: string;
    readonly now?: Date;
    readonly initialStatus?: CourseNodeLifecycle;
  },
): Promise<typeof worldCourseNodes.$inferSelect | null> {
  const locale = input.locale ?? 'zh-CN';
  const agent = await pickStayCourseAgent(db, input.worldId, input.agentKey);
  if (!agent) return null;
  const now = input.now ?? new Date();
  const prompt =
    locale === 'en'
      ? `Is ${agent.name} still in town tonight`
      : `${agent.name} 今夜是否还在镇上`;
  const [node] = await db
    .insert(worldCourseNodes)
    .values({
      worldId: input.worldId,
      communityGameId: input.gameId ?? null,
      prompt,
      kind: 'binary',
      ...courseNodeSchedule(now, input.initialStatus ?? 'open'),
      createdByUserId: input.userId ?? null,
    })
    .returning();
  if (!node) throw new Error('course node insert failed');
  await insertOptions(db, node.id, [
    {
      key: 'stay',
      label: locale === 'en' ? 'Still here' : '还在',
      predicate: {
        type: 'agent_presence',
        agentKey: agent.agentKey,
        name: agent.name,
        present: true,
        needles: BINARY_STAY_COURSE.stayNeedles,
      },
    },
    {
      key: 'leave',
      label: locale === 'en' ? 'Left town' : '离开',
      predicate: {
        type: 'agent_presence',
        agentKey: agent.agentKey,
        name: agent.name,
        present: false,
        needles: BINARY_STAY_COURSE.leaveNeedles,
      },
    },
  ]);
  return node;
}

function beatsFromSpec(specJson: unknown): Array<{ id: string; text: string }> {
  if (!specJson || typeof specJson !== 'object') return [];
  const narrative = (specJson as { narrative?: { beats?: unknown } }).narrative;
  if (!narrative || !Array.isArray(narrative.beats)) return [];
  const out: Array<{ id: string; text: string }> = [];
  for (const raw of narrative.beats) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as { id?: unknown; text?: unknown };
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (!text) continue;
    const id =
      typeof row.id === 'string' && row.id.trim()
        ? row.id.trim()
        : `beat_${out.length + 1}`;
    out.push({ id, text });
    if (out.length >= 4) break;
  }
  return out;
}

export async function seedBeatsCourse(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly gameId?: string | null;
    readonly userId?: string | null;
    readonly locale?: 'zh-CN' | 'en';
    readonly now?: Date;
    readonly initialStatus?: CourseNodeLifecycle;
  },
): Promise<typeof worldCourseNodes.$inferSelect | null> {
  const [world] = await db
    .select({ specJson: worlds.specJson })
    .from(worlds)
    .where(eq(worlds.id, input.worldId))
    .limit(1);
  const beats = beatsFromSpec(world?.specJson);
  const options = beats
    .map((beat) => ({
      key: beat.id.slice(0, 40),
      label: beat.text.slice(0, 24),
      predicate: {
        type: 'event_needle' as const,
        needles: needlesFromLine(beat.text),
      },
    }))
    .filter((option) => option.predicate.needles.length > 0);
  if (options.length < 2) return null;
  const locale = input.locale ?? 'zh-CN';
  const now = input.now ?? new Date();
  const [node] = await db
    .insert(worldCourseNodes)
    .values({
      worldId: input.worldId,
      communityGameId: input.gameId ?? null,
      prompt: locale === 'en' ? 'Which beat becomes canon' : '哪一条节拍会成为正史',
      kind: 'beats',
      ...courseNodeSchedule(now, input.initialStatus ?? 'open'),
      createdByUserId: input.userId ?? null,
    })
    .returning();
  if (!node) throw new Error('course node insert failed');
  await insertOptions(db, node.id, options.slice(0, 4));
  return node;
}

function parseCustomOptions(
  raw: CourseSeedBody['options'],
): Array<{ key: string; label: string; predicate: CoursePredicate }> | null {
  if (!raw || raw.length < 2 || raw.length > 4) return null;
  const options: Array<{ key: string; label: string; predicate: CoursePredicate }> = [];
  const keys = new Set<string>();
  for (const row of raw) {
    const key = (row.key ?? '').trim().slice(0, 40);
    const label = (row.label ?? '').trim().slice(0, 24);
    const needles = (row.needles ?? [])
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length >= 1 && item.length <= 16)
      .slice(0, 8);
    if (!key || !label || needles.length === 0 || keys.has(key)) return null;
    keys.add(key);
    options.push({
      key,
      label,
      predicate: { type: 'event_needle', needles },
    });
  }
  return options;
}

export async function seedCustomCourse(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly gameId?: string | null;
    readonly userId?: string | null;
    readonly locale?: 'zh-CN' | 'en';
    readonly prompt?: string;
    readonly options: CourseSeedBody['options'];
    readonly kind?: 'custom' | 'talks' | 'places';
    readonly now?: Date;
    readonly initialStatus?: CourseNodeLifecycle;
  },
): Promise<typeof worldCourseNodes.$inferSelect | null> {
  const options = parseCustomOptions(input.options);
  if (!options) return null;
  const locale = input.locale ?? 'zh-CN';
  const prompt = (input.prompt ?? '').trim().slice(0, 80)
    || (locale === 'en' ? 'What becomes canon tonight' : '今夜哪件事会成为正史');
  const now = input.now ?? new Date();
  const kind = input.kind ?? 'custom';
  const [node] = await db
    .insert(worldCourseNodes)
    .values({
      worldId: input.worldId,
      communityGameId: input.gameId ?? null,
      prompt,
      kind,
      ...courseNodeSchedule(now, input.initialStatus ?? 'open'),
      createdByUserId: input.userId ?? null,
    })
    .returning();
  if (!node) throw new Error('course node insert failed');
  await insertOptions(db, node.id, options);
  return node;
}

async function withWorldCourseLock<T>(
  db: DrizzleDb,
  worldId: string,
  now: Date | undefined,
  fn: (scoped: DrizzleDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    await lockWorldCourse(scoped, worldId);
    await closeExpiredBetting(scoped, now ?? new Date(), worldId);
    return fn(scoped);
  });
}

async function recoverActiveCourseNode(
  db: DrizzleDb,
  worldId: string,
  gameId?: string | null,
): Promise<typeof worldCourseNodes.$inferSelect | null> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    await lockWorldCourse(scoped, worldId);
    const existing = await loadActiveCourseNode(scoped, worldId);
    if (!existing) return null;
    return bindCourseGameId(scoped, existing, gameId);
  });
}

export async function seedCourseNode(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly gameId?: string | null;
    readonly userId?: string | null;
    readonly locale?: 'zh-CN' | 'en';
    readonly body?: CourseSeedBody;
    readonly now?: Date;
  },
): Promise<{
  readonly node: typeof worldCourseNodes.$inferSelect | null;
  readonly error: CourseSeedError | null;
}> {
  const kind = input.body?.kind ?? 'auto';
  const fail = (error: CourseSeedError) => ({ node: null, error });
  const replace = Boolean(input.body?.replace);
  const queue = Boolean(input.body?.queue);
  const cancelQueue = Boolean(input.body?.cancelQueue);
  try {
    if (cancelQueue) {
      const ok = await cancelQueuedCourseNode(db, input.worldId);
      return ok ? { node: null, error: null } : fail('queue_empty');
    }
    if (queue && replace) return fail('queue_replace_conflict');
    if (replace) {
      const existing = await loadActiveCourseNode(db, input.worldId);
      if (existing) {
        const contest = courseContest(await stakesOf(db, existing.id));
        if (contest.contested) {
          return fail('replace_blocked_contested');
        }
        const voided = await settleOneNode(db, existing, 'author_replace');
        if (!voided) {
          return fail('replace_blocked_settled');
        }
        console.log(
          '[course-replace]',
          JSON.stringify({
            worldId: input.worldId,
            nodeId: existing.id,
            contested: contest.contested,
            kind,
          }),
        );
      }
    }
    const seedWithStatus = async (
      scoped: DrizzleDb,
      initialStatus: CourseNodeLifecycle,
    ) => {
      const seedInput = { ...input, initialStatus };
      return kind === 'binary'
        ? await seedBinaryStayCourse(scoped, {
            ...seedInput,
            agentKey: input.body?.agentKey,
          })
        : kind === 'talks'
          ? await seedTalksCourse(
              scoped,
              seedInput,
              await loadRecentTalkHints(scoped, input.worldId),
            )
          : kind === 'places'
            ? await (async () => {
                if (input.body?.prompt && input.body?.options?.length) {
                  return seedCustomCourse(scoped, {
                    ...seedInput,
                    kind: 'places',
                    prompt: input.body.prompt,
                    options: input.body.options,
                  });
                }
                const [row] = await scoped
                  .select({ specJson: worlds.specJson })
                  .from(worlds)
                  .where(eq(worlds.id, input.worldId))
                  .limit(1);
                return seedPlacesCourse(scoped, seedInput, row?.specJson);
              })()
            : kind === 'beats'
              ? await seedBeatsCourse(scoped, seedInput)
              : kind === 'custom'
                ? await seedCustomCourse(scoped, {
                    ...seedInput,
                    prompt: input.body?.prompt,
                    options: input.body?.options,
                  })
                : kind === 'night_market'
                  ? await seedNightMarketCourse(scoped, seedInput)
                  : await seedWorldBoundCourse(scoped, seedInput);
    };
    const node = await withWorldCourseLock(db, input.worldId, input.now, async (scoped) => {
      const existing = await loadActiveCourseNode(scoped, input.worldId);
      if (queue && existing) {
        if (await loadQueuedCourseNode(scoped, input.worldId)) {
          return null;
        }
        return seedWithStatus(scoped, 'queued');
      }
      if (existing && !replace) return bindCourseGameId(scoped, existing, input.gameId);
      return seedWithStatus(scoped, 'open');
    });
    if (!node && queue) {
      const active = await loadActiveCourseNode(db, input.worldId);
      if (active && (await loadQueuedCourseNode(db, input.worldId))) {
        return fail('queue_full');
      }
    }
    if (node) {
      if (node.status === 'queued') {
        console.log(
          '[course-queue]',
          JSON.stringify({
            kind: 'seed',
            worldId: input.worldId,
            nodeId: node.id,
            prompt: node.prompt,
          }),
        );
      } else {
        const view = await toView(db, node, null, input.locale ?? 'zh-CN');
        void emitCoursePulse(input.worldId, view);
        if (node.communityGameId && node.status === 'open') {
          const webBaseUrl = process.env['PLATFORM_WEB_BASE_URL'] ?? null;
          void notifyCourseWatchPush(db, {
            gameId: node.communityGameId,
            nodeId: node.id,
            kind: 'open',
            prompt: node.prompt,
            webBaseUrl,
          }).catch(() => undefined);
          void notifyCourseFollowOpenPush(db, {
            gameId: node.communityGameId,
            nodeId: node.id,
            prompt: node.prompt,
            webBaseUrl,
          }).catch(() => undefined);
        }
      }
      return { node, error: null };
    }
    if (kind === 'binary') return fail('no_agents');
    if (kind === 'beats') return fail('no_beats');
    return fail('bad_options');
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const recovered = await recoverActiveCourseNode(db, input.worldId, input.gameId);
    if (recovered) return { node: recovered, error: null };
    throw err;
  }
}

export async function ensureOpenCourse(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly gameId?: string | null;
    readonly locale?: 'zh-CN' | 'en';
  },
): Promise<typeof worldCourseNodes.$inferSelect | null> {
  try {
    return await withWorldCourseLock(db, input.worldId, undefined, async (scoped) => {
      const existing = await loadActiveCourseNode(scoped, input.worldId);
      if (existing) return bindCourseGameId(scoped, existing, input.gameId);
      if (!(await courseSeedGateAllowed(scoped, input.worldId))) return null;
      return await seedWorldBoundCourse(scoped, input);
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const recovered = await recoverActiveCourseNode(db, input.worldId, input.gameId);
    if (recovered) return recovered;
    throw err;
  }
}

export async function loadCourseSeedHints(
  db: DrizzleDb,
  worldId: string,
): Promise<{
  readonly residents: Array<{ key: string; name: string }>;
  readonly places: Array<{ id: string; name: string }>;
  readonly talks: Array<{ who?: string; text: string; kind?: string }>;
  readonly villagePack: boolean;
  readonly genreId?: string;
  readonly packId?: string;
}> {
  const [agents, world, talks] = await Promise.all([
    db
      .select({ key: worldAgents.agentKey, name: worldAgents.name })
      .from(worldAgents)
      .where(eq(worldAgents.worldId, worldId))
      .limit(40),
    db
      .select({ specJson: worlds.specJson })
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1),
    loadRecentTalkHints(db, worldId),
  ]);
  const spec = world[0]?.specJson;
  const specTyped = spec as {
    presentation?: { genreProfile?: { id?: string } };
    society?: { id?: string };
    id?: string;
  } | null;
  const genreId = specTyped?.presentation?.genreProfile?.id;
  const packId = specTyped?.society?.id ?? specTyped?.id;
  return {
    residents: agents.map((row) => ({ key: row.key, name: row.name })),
    places: [...placesFromWorldSpec(spec)],
    talks: talks.map((row) => ({
      ...(row.who ? { who: row.who } : {}),
      text: row.text,
      ...(row.kind ? { kind: row.kind } : {}),
    })),
    villagePack: worldCoursePrefersNightMarket(spec),
    ...(genreId ? { genreId } : {}),
    ...(packId ? { packId } : {}),
  };
}

export type CourseRecommendPreview = {
  readonly kind: CourseSeedKind;
  readonly prompt: string;
  readonly options: ReadonlyArray<{ readonly label: string }>;
  readonly seedSource: CourseSeedSource;
  readonly reachability: CourseReachability;
};

function packRecommendPreview(
  seedSource: CourseSeedSource,
  prompt: string,
  options: ReadonlyArray<{ readonly label: string; readonly needles?: readonly string[] }>,
  talks: readonly CourseTalkHint[],
): CourseRecommendPreview {
  return {
    kind: seedSource,
    prompt,
    options: options.map((row) => ({ label: row.label })),
    seedSource,
    reachability: courseBoardReachability({
      seedKind: seedSource,
      options: options.map((row) => ({
        label: row.label,
        needles: row.needles ?? needlesFromLine(row.label),
      })),
      recentTalks: talks,
    }),
  };
}

async function previewWorldBoundCourse(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly locale?: 'zh-CN' | 'en';
    readonly agentKey?: string;
  },
): Promise<CourseRecommendPreview | null> {
  const locale = input.locale ?? 'zh-CN';
  const talks = await loadRecentTalkHints(db, input.worldId);
  const suggest = suggestCourseFromTalks(talks, locale);
  if (suggest) {
    return packRecommendPreview(
      'talks',
      suggest.prompt,
      suggest.options.map((row) => ({ label: row.label, needles: [...row.needles] })),
      talks,
    );
  }
  const agent = await pickStayCourseAgent(db, input.worldId, input.agentKey);
  if (agent) {
    const prompt =
      locale === 'en'
        ? `Is ${agent.name} still in town tonight`
        : `${agent.name} 今夜是否还在镇上`;
    return packRecommendPreview(
      'binary',
      prompt,
      [
        {
          label: locale === 'en' ? 'Still here' : '还在',
          needles: [...BINARY_STAY_COURSE.stayNeedles],
        },
        {
          label: locale === 'en' ? 'Left town' : '离开',
          needles: [...BINARY_STAY_COURSE.leaveNeedles],
        },
      ],
      talks,
    );
  }
  const [world] = await db
    .select({ specJson: worlds.specJson })
    .from(worlds)
    .where(eq(worlds.id, input.worldId))
    .limit(1);
  const spec = world?.specJson;
  const places = suggestCourseFromPlaces(placesFromWorldSpec(spec), locale);
  if (places) {
    return packRecommendPreview(
      'places',
      places.prompt,
      places.options.map((row) => ({ label: row.label, needles: [...row.needles] })),
      talks,
    );
  }
  if (beatsEligibleForCourse(spec, talks)) {
    const beats = beatsFromSpec(spec);
    const options = beats
      .map((beat) => ({
        label: beat.text.slice(0, 24),
        needles: needlesFromLine(beat.text),
      }))
      .filter((option) => option.needles.length > 0);
    if (options.length >= 2) {
      return packRecommendPreview(
        'beats',
        locale === 'en' ? 'Which beat becomes canon' : '哪一条节拍会成为正史',
        options,
        talks,
      );
    }
  }
  if (worldCoursePrefersNightMarket(spec)) {
    return packRecommendPreview(
      'night_market',
      locale === 'en' ? NIGHT_MARKET_COURSE_PROMPT.en : NIGHT_MARKET_COURSE_PROMPT.zh,
      NIGHT_MARKET_COURSE_OPTIONS.map((option) => ({
        label: locale === 'en' ? option.labelEn : option.labelZh,
        needles: option.predicate.needles ?? [],
      })),
      talks,
    );
  }
  return null;
}

/** Dry-run author recommend — mirrors seed selection without inserting a node. */
export async function previewCourseRecommend(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly locale?: 'zh-CN' | 'en';
    readonly body?: Pick<CourseSeedBody, 'kind' | 'agentKey' | 'prompt' | 'options'>;
  },
): Promise<CourseRecommendPreview | null> {
  const locale = input.locale ?? 'zh-CN';
  const kind = input.body?.kind ?? 'auto';
  const talks = await loadRecentTalkHints(db, input.worldId);

  if (kind === 'custom' && input.body?.prompt && input.body?.options?.length) {
    const parsed = parseCustomOptions(input.body.options);
    if (!parsed) return null;
    return packRecommendPreview(
      'custom',
      input.body.prompt,
      parsed.map((row) => ({
        label: row.label,
        needles: row.predicate.needles,
      })),
      talks,
    );
  }

  if (kind === 'talks') {
    const suggest = suggestCourseFromTalks(talks, locale);
    if (!suggest) return null;
    return packRecommendPreview(
      'talks',
      suggest.prompt,
      suggest.options.map((row) => ({ label: row.label, needles: [...row.needles] })),
      talks,
    );
  }

  if (kind === 'binary') {
    const agent = await pickStayCourseAgent(db, input.worldId, input.body?.agentKey);
    if (!agent) return null;
    const prompt =
      locale === 'en'
        ? `Is ${agent.name} still in town tonight`
        : `${agent.name} 今夜是否还在镇上`;
    return packRecommendPreview(
      'binary',
      prompt,
      [
        {
          label: locale === 'en' ? 'Still here' : '还在',
          needles: [...BINARY_STAY_COURSE.stayNeedles],
        },
        {
          label: locale === 'en' ? 'Left town' : '离开',
          needles: [...BINARY_STAY_COURSE.leaveNeedles],
        },
      ],
      talks,
    );
  }

  if (kind === 'places') {
    if (input.body?.prompt && input.body?.options?.length) {
      const parsed = parseCustomOptions(input.body.options);
      if (!parsed) return null;
      return packRecommendPreview(
        'places',
        input.body.prompt,
        parsed.map((row) => ({
          label: row.label,
          needles: row.predicate.needles,
        })),
        talks,
      );
    }
    const [world] = await db
      .select({ specJson: worlds.specJson })
      .from(worlds)
      .where(eq(worlds.id, input.worldId))
      .limit(1);
    const suggest = suggestCourseFromPlaces(placesFromWorldSpec(world?.specJson), locale);
    if (!suggest) return null;
    return packRecommendPreview(
      'places',
      suggest.prompt,
      suggest.options.map((row) => ({ label: row.label, needles: [...row.needles] })),
      talks,
    );
  }

  if (kind === 'beats') {
    const [world] = await db
      .select({ specJson: worlds.specJson })
      .from(worlds)
      .where(eq(worlds.id, input.worldId))
      .limit(1);
    const spec = world?.specJson;
    if (!beatsEligibleForCourse(spec, talks)) return null;
    const beats = beatsFromSpec(spec);
    const options = beats
      .map((beat) => ({
        label: beat.text.slice(0, 24),
        needles: needlesFromLine(beat.text),
      }))
      .filter((option) => option.needles.length > 0);
    if (options.length < 2) return null;
    return packRecommendPreview(
      'beats',
      locale === 'en' ? 'Which beat becomes canon' : '哪一条节拍会成为正史',
      options,
      talks,
    );
  }

  if (kind === 'night_market') {
    return packRecommendPreview(
      'night_market',
      locale === 'en' ? NIGHT_MARKET_COURSE_PROMPT.en : NIGHT_MARKET_COURSE_PROMPT.zh,
      NIGHT_MARKET_COURSE_OPTIONS.map((option) => ({
        label: locale === 'en' ? option.labelEn : option.labelZh,
        needles: option.predicate.needles ?? [],
      })),
      talks,
    );
  }

  return previewWorldBoundCourse(db, input);
}

export type CourseBoardSkipReason = 'unfunded';

type CourseSettlePushSnap = {
  readonly nodeId: string;
  readonly gameId: string | null;
  readonly voided: boolean;
  readonly voidReason: string | null;
  readonly winningOptionId: string | null;
  readonly canon: string | null;
  readonly payouts: ReadonlyArray<{
    readonly organizationId: string;
    readonly kind: string;
    readonly points: number;
  }>;
  readonly stakes: ReadonlyArray<{
    readonly organizationId: string;
    readonly userId: string | null;
    readonly optionId: string;
  }>;
  readonly webBaseUrl?: string | null;
};

function dispatchSettlePush(db: DrizzleDb, snap: CourseSettlePushSnap | null): void {
  if (!snap) return;
  void notifyCourseWatchPush(db, {
    gameId: snap.gameId,
    nodeId: snap.nodeId,
    kind: 'settled',
    prompt: null,
    canon: snap.canon,
    excludeUserIds: snap.stakes
      .map((row) => row.userId)
      .filter((id): id is string => Boolean(id)),
    webBaseUrl: snap.webBaseUrl ?? null,
  }).catch(() => undefined);
  void notifyCourseSettlePush(db, snap).catch(() => undefined);
}

export async function loadCourseBoard(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly gameId?: string | null;
    readonly viewerOrgId?: string | null;
    readonly viewerUserId?: string | null;
    readonly locale?: 'zh-CN' | 'en';
    readonly ensure?: boolean;
  },
): Promise<{
  readonly current: CourseView | null;
  readonly queued: CourseView | null;
  readonly history: readonly CourseView[];
  readonly skipReason?: CourseBoardSkipReason;
  readonly watching?: boolean;
}> {
  await settleWorldCourseNodes(db, input.worldId).catch(() => 0);
  let node = await loadActiveCourseNode(db, input.worldId);
  let skipReason: CourseBoardSkipReason | undefined;
  if (!node && input.ensure) {
    if (await courseSeedGateAllowed(db, input.worldId)) {
      try {
        node = await ensureOpenCourse(db, {
          worldId: input.worldId,
          gameId: input.gameId,
          locale: input.locale,
        });
      } catch {
        node = await loadActiveCourseNode(db, input.worldId);
      }
    } else {
      skipReason = 'unfunded';
    }
  }
  if (node) {
    node = await bindCourseGameId(db, node, input.gameId);
  }
  const queuedNode = await loadQueuedCourseNode(db, input.worldId);
  const watching =
    input.viewerUserId && input.gameId
      ? await isCourseGameWatched(db, input.viewerUserId, input.gameId)
      : undefined;
  return {
    current: node ? await toView(db, node, input.viewerOrgId, input.locale) : null,
    queued: queuedNode
      ? await toView(db, queuedNode, input.viewerOrgId, input.locale)
      : null,
    history: await listCourseHistory(db, input.worldId, input.locale ?? 'zh-CN'),
    ...(skipReason ? { skipReason } : {}),
    ...(watching !== undefined ? { watching } : {}),
  };
}

export async function latestCanonForWorlds(
  db: DrizzleDb,
  worldIds: readonly string[],
  locale: 'zh-CN' | 'en' = 'zh-CN',
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (worldIds.length === 0) return out;
  const nodes = await db
    .select()
    .from(worldCourseNodes)
    .where(
      and(
        inArray(worldCourseNodes.worldId, [...worldIds]),
        eq(worldCourseNodes.status, 'settled'),
      ),
    )
    .orderBy(desc(worldCourseNodes.settledAt));
  const optionIds = nodes
    .map((row) => row.winningOptionId)
    .filter((id): id is string => Boolean(id));
  const options =
    optionIds.length > 0
      ? await db
          .select()
          .from(worldCourseOptions)
          .where(inArray(worldCourseOptions.id, optionIds))
      : [];
  const labelOf = new Map(options.map((row) => [row.id, row.label]));
  for (const node of nodes) {
    if (out.has(node.worldId) || !node.winningOptionId) continue;
    const label = labelOf.get(node.winningOptionId);
    if (!label) continue;
    out.set(
      node.worldId,
      courseCanonLine({ locale, prompt: node.prompt, winningLabel: label }),
    );
  }
  return out;
}

export type CourseReturnHint = {
  readonly nodeId?: string | null;
  readonly prompt: string;
  readonly status: string;
  readonly pool: number;
  readonly canon: string | null;
  readonly bettingClosesAt?: string | null;
  readonly settlesAt?: string | null;
  readonly contested?: boolean;
};

/** Open stake or the last canon — a reason to open a followed town again. */
export async function courseReturnHintsByDeployment(
  db: DrizzleDb,
  deploymentIds: readonly string[],
  locale: 'zh-CN' | 'en' = 'zh-CN',
): Promise<Map<string, CourseReturnHint>> {
  const out = new Map<string, CourseReturnHint>();
  if (deploymentIds.length === 0) return out;
  const worldLinks = await db
    .select({
      deploymentId: deployments.id,
      worldId: worlds.id,
    })
    .from(deployments)
    .innerJoin(worlds, eq(worlds.projectId, deployments.projectId))
    .where(inArray(deployments.id, [...deploymentIds]));
  const hints = await courseReturnHintsForWorlds(
    db,
    worldLinks.map((row) => row.worldId),
    locale,
  );
  for (const row of worldLinks) {
    const hint = hints.get(row.worldId);
    if (hint) out.set(row.deploymentId, hint);
  }
  return out;
}

/** Stamp a discovery row with the open board or last canon for that town. */
export function mergeCourseHints<T extends { deploymentId: string }>(
  items: readonly T[],
  hints: ReadonlyMap<string, CourseReturnHint>,
): Array<T & { course: CourseReturnHint | null }> {
  return items.map((item) => ({
    ...item,
    course: hints.get(item.deploymentId) ?? null,
  }));
}

/** Open stake or the last canon — a reason to open a followed town again. */
export async function courseReturnHintsForWorlds(
  db: DrizzleDb,
  worldIds: readonly string[],
  locale: 'zh-CN' | 'en' = 'zh-CN',
): Promise<Map<string, CourseReturnHint>> {
  const out = new Map<string, CourseReturnHint>();
  if (worldIds.length === 0) return out;
  const ids = [...worldIds];
  const active = await db
    .select()
    .from(worldCourseNodes)
    .where(
      and(
        inArray(worldCourseNodes.worldId, ids),
        inArray(worldCourseNodes.status, ['open', 'closed']),
      ),
    );
  for (const node of active) {
    if (out.has(node.worldId)) continue;
    const stakes = await stakesOf(db, node.id);
    const contest = courseContest(stakes);
    out.set(node.worldId, {
      nodeId: node.id,
      prompt: node.prompt,
      status: node.status,
      pool: stakes.reduce((sum, row) => sum + row.points, 0),
      canon: null,
      bettingClosesAt: node.bettingClosesAt.toISOString(),
      settlesAt: node.settlesAt.toISOString(),
      contested: contest.contested,
    });
  }
  const missing = ids.filter((id) => !out.has(id));
  const canons = await latestCanonForWorlds(db, missing, locale);
  for (const [worldId, line] of canons) {
    out.set(worldId, {
      prompt: line,
      status: 'settled',
      pool: 0,
      canon: line,
    });
  }
  return out;
}

/** Open stake or last canon — keyed by community game id (watch / discovery lists). */
export async function courseReturnHintsForCommunityGames(
  db: DrizzleDb,
  gameIds: readonly string[],
  locale: 'zh-CN' | 'en' = 'zh-CN',
): Promise<Map<string, CourseReturnHint>> {
  const out = new Map<string, CourseReturnHint>();
  if (gameIds.length === 0) return out;
  const ids = [...gameIds];
  const active = await db
    .select()
    .from(worldCourseNodes)
    .where(
      and(
        inArray(worldCourseNodes.communityGameId, ids),
        inArray(worldCourseNodes.status, ['open', 'closed']),
      ),
    );
  for (const node of active) {
    const gameId = node.communityGameId;
    if (!gameId || out.has(gameId)) continue;
    const stakes = await stakesOf(db, node.id);
    const contest = courseContest(stakes);
    out.set(gameId, {
      nodeId: node.id,
      prompt: node.prompt,
      status: node.status,
      pool: stakes.reduce((sum, row) => sum + row.points, 0),
      canon: null,
      bettingClosesAt: node.bettingClosesAt.toISOString(),
      settlesAt: node.settlesAt.toISOString(),
      contested: contest.contested,
    });
  }
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length === 0) return out;
  const settledNodes = await db
    .select()
    .from(worldCourseNodes)
    .where(
      and(
        inArray(worldCourseNodes.communityGameId, missing),
        eq(worldCourseNodes.status, 'settled'),
      ),
    )
    .orderBy(desc(worldCourseNodes.settledAt));
  const settledOptionIds = settledNodes
    .map((row) => row.winningOptionId)
    .filter((id): id is string => Boolean(id));
  const settledOptions =
    settledOptionIds.length > 0
      ? await db
          .select()
          .from(worldCourseOptions)
          .where(inArray(worldCourseOptions.id, settledOptionIds))
      : [];
  const settledLabelOf = new Map(settledOptions.map((row) => [row.id, row.label]));
  for (const node of settledNodes) {
    const gameId = node.communityGameId;
    if (!gameId || out.has(gameId) || !node.winningOptionId) continue;
    const label = settledLabelOf.get(node.winningOptionId);
    if (!label) continue;
    const canon = courseCanonLine({
      locale,
      prompt: node.prompt,
      winningLabel: label,
    });
    out.set(gameId, {
      nodeId: node.id,
      prompt: node.prompt,
      status: 'settled',
      pool: 0,
      canon,
      bettingClosesAt: node.bettingClosesAt.toISOString(),
      settlesAt: node.settlesAt.toISOString(),
    });
  }
  const stillMissing = missing.filter((id) => !out.has(id));
  if (stillMissing.length === 0) return out;
  const gameWorlds = await db
    .select({
      gameId: communityGames.id,
      worldId: worlds.id,
    })
    .from(communityGames)
    .innerJoin(deployments, eq(communityGames.deploymentId, deployments.id))
    .innerJoin(worlds, eq(worlds.projectId, deployments.projectId))
    .where(inArray(communityGames.id, stillMissing));
  const worldIds = [...new Set(gameWorlds.map((row) => row.worldId))];
  const canons = await latestCanonForWorlds(db, worldIds, locale);
  for (const row of gameWorlds) {
    const canon = canons.get(row.worldId);
    if (!canon || out.has(row.gameId)) continue;
    out.set(row.gameId, {
      prompt: canon,
      status: 'settled',
      pool: 0,
      canon,
    });
  }
  return out;
}

export async function stakeCourse(
  db: DrizzleDb,
  input: {
    readonly nodeId: string;
    readonly optionId: string;
    readonly organizationId: string;
    readonly userId: string;
    readonly authorOrgId: string;
    readonly gameId: string | null;
    readonly points: number;
  },
): Promise<
  | { readonly ok: true; readonly board: CourseView; readonly balance: number }
  | { readonly ok: false; readonly error: string; readonly need?: number }
> {
  const result = await db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    await lockCourseNode(scoped, input.nodeId);
    await lockOrgCommerce(scoped, input.organizationId, 'course');
    await closeExpiredNode(scoped, input.nodeId);
    const [raw] = await tx
      .select()
      .from(worldCourseNodes)
      .where(eq(worldCourseNodes.id, input.nodeId))
      .limit(1);
    if (!raw) return { ok: false as const, error: 'not_found' };
    const node = await bindCourseGameId(scoped, raw, input.gameId);
    if (node.status !== 'open' || node.bettingClosesAt.getTime() <= Date.now()) {
      return { ok: false as const, error: 'closed' };
    }
    if (!isCourseStakeStep(input.points)) {
      return { ok: false as const, error: 'min_stake' };
    }
    if (input.organizationId === input.authorOrgId) {
      return { ok: false as const, error: 'author_forbidden' };
    }
    const [option] = await tx
      .select()
      .from(worldCourseOptions)
      .where(
        and(
          eq(worldCourseOptions.id, input.optionId),
          eq(worldCourseOptions.nodeId, node.id),
        ),
      )
      .limit(1);
    if (!option) return { ok: false as const, error: 'bad_option' };
    const stakes = await stakesOf(scoped, node.id);
    const pool = stakes.reduce((sum, row) => sum + row.points, 0);
    const mine = stakes.find((row) => row.organizationId === input.organizationId);
    if (mine && mine.optionId !== input.optionId) {
      return { ok: false as const, error: 'side_locked' };
    }
    const gate = canAddStake({
      points: input.points,
      poolBefore: pool,
      already: mine?.points ?? 0,
    });
    if (!gate.ok) return { ok: false as const, error: gate.reason };
    let paid: Awaited<ReturnType<typeof debitPoints>>;
    try {
      paid = await debitPoints(scoped, input.organizationId, input.points, 'course_stake', {
        communityGameId: input.gameId,
        note: '今夜压盘',
        meta: { sku: 'course', nodeId: node.id, optionId: option.id },
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: string }).code ?? '')
          : '';
      if (code === '23514' || /23514|ledger_entries_kind/i.test(raw)) {
        return { ok: false as const, error: 'ledger' };
      }
      throw err;
    }
    if (!paid.ok) {
      return { ok: false as const, error: 'need_points', need: paid.need };
    }
    if (mine) {
      await tx
        .update(worldCourseStakes)
        .set({
          points: mine.points + input.points,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(worldCourseStakes.nodeId, node.id),
            eq(worldCourseStakes.organizationId, input.organizationId),
          ),
        );
    } else {
      await tx.insert(worldCourseStakes).values({
        nodeId: node.id,
        optionId: option.id,
        organizationId: input.organizationId,
        userId: input.userId,
        points: input.points,
      });
    }
    await tx.insert(kaiTransfers).values({
      communityGameId: input.gameId,
      fromOrganizationId: input.organizationId,
      toOrganizationId: input.authorOrgId,
      userId: input.userId,
      kind: 'course',
      points: input.points,
      authorPoints: 0,
      meta: { sku: 'course_stake', nodeId: node.id, optionId: option.id },
    });
    const wasContested = courseContest(stakes).contested;
    const fresh = await toView(scoped, node, input.organizationId);
    return {
      ok: true as const,
      board: fresh,
      balance: paid.balance,
      becameContested: !wasContested && fresh.contested,
      nodeId: node.id,
      gameId: node.communityGameId,
    };
  });
  if (result.ok) {
    void emitCoursePulse(result.board.worldId, result.board);
    if (result.becameContested) {
      void notifyCourseContestedPush(db, {
        nodeId: result.nodeId,
        gameId: result.gameId,
        webBaseUrl: process.env['PLATFORM_WEB_BASE_URL'] ?? null,
      }).catch(() => undefined);
    }
    return { ok: true, board: result.board, balance: result.balance };
  }
  return result;
}

function emitStakePulse(
  result:
    | { readonly ok: true; readonly board: CourseView; readonly balance: number }
    | { readonly ok: false; readonly error: string; readonly need?: number },
): typeof result {
  if (result.ok) void emitCoursePulse(result.board.worldId, result.board);
  return result;
}

export async function withdrawCourseStake(
  db: DrizzleDb,
  input: {
    readonly nodeId: string;
    readonly organizationId: string;
    readonly gameId: string | null;
  },
): Promise<
  | { readonly ok: true; readonly board: CourseView; readonly balance: number }
  | { readonly ok: false; readonly error: string }
> {
  return emitStakePulse(
    await db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    await lockCourseNode(scoped, input.nodeId);
    await lockOrgCommerce(scoped, input.organizationId, 'course');
    await closeExpiredNode(scoped, input.nodeId);
    const [node] = await tx
      .select()
      .from(worldCourseNodes)
      .where(eq(worldCourseNodes.id, input.nodeId))
      .limit(1);
    if (!node) return { ok: false as const, error: 'not_found' };
    if (node.status !== 'open' || node.bettingClosesAt.getTime() <= Date.now()) {
      return { ok: false as const, error: 'closed' };
    }
    const stakes = await stakesOf(scoped, node.id);
    const contest = courseContest(stakes);
    const mine = stakes.find((row) => row.organizationId === input.organizationId);
    if (!mine || mine.points <= 0) {
      return { ok: false as const, error: 'empty' };
    }
    if (contest.contested) {
      return { ok: false as const, error: 'contested' };
    }
    const balance = await creditPoints(
      scoped,
      input.organizationId,
      mine.points,
      'course_void',
      {
        communityGameId: input.gameId,
        note: '今夜压盘收回',
        meta: { sku: 'course_withdraw', nodeId: node.id },
      },
    );
    await tx
      .delete(worldCourseStakes)
      .where(
        and(
          eq(worldCourseStakes.nodeId, node.id),
          eq(worldCourseStakes.organizationId, input.organizationId),
        ),
      );
    const fresh = await toView(scoped, node, input.organizationId);
    return { ok: true as const, board: fresh, balance };
    }),
  );
}

async function settleWorldCourseNodes(
  db: DrizzleDb,
  worldId: string,
  now = new Date(),
): Promise<number> {
  await closeExpiredBetting(db, now, worldId);
  const rows = await db
    .select()
    .from(worldCourseNodes)
    .where(
      and(
        eq(worldCourseNodes.worldId, worldId),
        inArray(worldCourseNodes.status, ['open', 'closed']),
      ),
    );
  let n = 0;
  for (const node of rows) {
    const contest = courseContest(await stakesOf(db, node.id));
    if (
      !courseShouldSettleNow({
        status: node.status,
        settlesAtMs: node.settlesAt.getTime(),
        bettingClosesAtMs: node.bettingClosesAt.getTime(),
        contested: contest.contested,
        nowMs: now.getTime(),
      })
    ) {
      continue;
    }
    if (await settleOneNode(db, node)) n += 1;
  }
  return n;
}

async function appendAwayPoseFacts(
  db: DrizzleDb,
  worldId: string,
  options: ReadonlyArray<{ predicateJson: unknown }>,
  settlesAt: Date,
  facts: CourseEventFact[],
): Promise<CourseEventFact[]> {
  const keys = new Set<string>();
  for (const option of options) {
    const pred = parseCoursePredicate(option.predicateJson) as CoursePredicate | null;
    if (pred?.agentKey) keys.add(pred.agentKey);
  }
  if (keys.size === 0) return facts;
  const [world, agents] = await Promise.all([
    db
      .select({ specJson: worlds.specJson })
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        agentKey: worldAgents.agentKey,
        regionId: worldAgents.regionId,
      })
      .from(worldAgents)
      .where(eq(worldAgents.worldId, worldId)),
  ]);
  const names = regionNamesFromSpec(world?.specJson);
  const moveRows =
    keys.size > 0
      ? await db
          .select({
            agentKey: societyEvents.agentKey,
            payloadJson: societyEvents.payloadJson,
          })
          .from(societyEvents)
          .where(
            and(
              eq(societyEvents.worldId, worldId),
              inArray(societyEvents.agentKey, [...keys]),
              eq(societyEvents.kind, 'move'),
              eq(societyEvents.invalidated, 0),
            ),
          )
          .orderBy(desc(societyEvents.createdAt))
      : [];
  const lastMoveText = new Map<string, string>();
  for (const row of moveRows) {
    if (!row.agentKey || lastMoveText.has(row.agentKey)) continue;
    lastMoveText.set(row.agentKey, eventText(row.payloadJson));
  }
  const extra = buildAwayPoseCourseFacts({
    agents: agents.map((agent) => ({
      agentKey: agent.agentKey,
      regionId: agent.regionId,
      regionName: names.get(agent.regionId) ?? '',
      lastMoveText: lastMoveText.get(agent.agentKey),
    })),
    agentKeys: [...keys],
    settlesAtMs: settlesAt.getTime(),
    looksAway: courseLocationLooksAway,
  });
  return extra.length === 0 ? facts : [...facts, ...extra];
}

async function settleOneNode(
  db: DrizzleDb,
  node: typeof worldCourseNodes.$inferSelect,
  forceVoidReason?: string,
): Promise<boolean> {
  if (node.status === 'settled' || node.status === 'void') return false;
  let applied = false;
  let pulseSnap: Parameters<typeof emitCoursePulse>[1] = null;
  let pushSnap: CourseSettlePushSnap | null = null;
  await db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    await lockCourseNode(scoped, node.id);
    const [fresh] = await tx
      .select()
      .from(worldCourseNodes)
      .where(eq(worldCourseNodes.id, node.id))
      .limit(1);
    if (!fresh || fresh.status === 'settled' || fresh.status === 'void') return;
    await closeExpiredNode(scoped, fresh.id);
    const [live] = await tx
      .select()
      .from(worldCourseNodes)
      .where(eq(worldCourseNodes.id, fresh.id))
      .limit(1);
    if (!live || live.status === 'settled' || live.status === 'void') return;

    const stakes = await stakesOf(scoped, live.id);
    const contest = courseContest(stakes);
    const nowMs = Date.now();
    const due = courseShouldSettleNow({
      status: live.status,
      settlesAtMs: live.settlesAt.getTime(),
      bettingClosesAtMs: live.bettingClosesAt.getTime(),
      contested: contest.contested,
      nowMs,
    });
    if (!forceVoidReason && !due) return;
    const autoForce = courseSettleForceVoid({
      status: live.status,
      settlesAtMs: live.settlesAt.getTime(),
      bettingClosesAtMs: live.bettingClosesAt.getTime(),
      contested: contest.contested,
      sides: contest.sides,
      nowMs,
    });
    const effectiveForce = forceVoidReason ?? autoForce;
    const options = await tx
      .select()
      .from(worldCourseOptions)
      .where(eq(worldCourseOptions.nodeId, live.id));
    const facts = effectiveForce
      ? []
      : await appendAwayPoseFacts(
          scoped,
          live.worldId,
          options,
          live.settlesAt,
          await loadFacts(scoped, live.worldId, live.opensAt, live.settlesAt),
        );
    const judged = effectiveForce
      ? {
          muted: false,
          unclear: true,
          winningOptionId: null as string | null,
          fingerprint: live.transcriptHash ?? 'forced-void',
        }
      : judgeCourseWindow({
          events: facts,
          options: options.map((option) => ({
            id: option.id,
            predicate: parseCoursePredicate(option.predicateJson) as CoursePredicate,
          })),
          windowStartMs: live.opensAt.getTime(),
          windowEndMs: live.settlesAt.getTime(),
        });
    const [world] = await tx
      .select({ clockPaused: worlds.clockPaused })
      .from(worlds)
      .where(eq(worlds.id, live.worldId))
      .limit(1);
    const [listed] = live.communityGameId
      ? await tx
          .select({ takenDownAt: communityGames.takenDownAt })
          .from(communityGames)
          .where(eq(communityGames.id, live.communityGameId))
          .limit(1)
      : [undefined];
    const outcome = decideCourseOutcome({
      judged,
      clockPaused: Boolean(world?.clockPaused),
      takenDown: Boolean(listed?.takenDownAt),
      uncontested: contest.sides > 0 && !contest.contested,
      forceVoidReason: effectiveForce,
    });
    const settled = settlePariMutuel({
      stakes,
      winningOptionId: outcome.winningOptionId,
      voided: outcome.voided,
    });

    const [locked] = await tx
      .update(worldCourseNodes)
      .set({
        status: outcome.voided ? 'void' : 'settled',
        transcriptHash: outcome.transcriptHash,
        winningOptionId: outcome.winningOptionId,
        voidReason: outcome.voidReason,
        settledAt: new Date(),
      })
      .where(
        and(
          eq(worldCourseNodes.id, live.id),
          inArray(worldCourseNodes.status, ['open', 'closed']),
        ),
      )
      .returning({ id: worldCourseNodes.id });
    if (!locked) return;
    applied = true;
    console.log(
      '[course-settle]',
      JSON.stringify(
        courseSettlementTelemetry({
          nodeId: live.id,
          worldId: live.worldId,
          seedKind: live.kind || 'custom',
          pool: settled.pool,
          contested: contest.contested,
          judged: {
            muted: judged.muted,
            unclear: judged.unclear,
            winningOptionId: judged.winningOptionId,
          },
          outcome: {
            voided: outcome.voided,
            voidReason: outcome.voidReason,
            winningOptionId: outcome.winningOptionId,
          },
        }),
      ),
    );

    for (const payout of settled.payouts) {
      await creditPoints(
        scoped,
        payout.organizationId,
        payout.points,
        payout.kind === 'void' ? 'course_void' : 'course_payout',
        {
          communityGameId: live.communityGameId,
          note: payout.kind === 'void' ? '今夜压盘退回' : '今夜压盘分彩',
          meta: {
            sku: payout.kind === 'void' ? 'course_void' : 'course_payout',
            nodeId: live.id,
          },
        },
      );
    }
    if (!outcome.voided && settled.authorRake > 0 && live.communityGameId) {
      const [game] = await tx
        .select({ deploymentId: communityGames.deploymentId })
        .from(communityGames)
        .where(eq(communityGames.id, live.communityGameId))
        .limit(1);
      if (game) {
        const [dep] = await tx
          .select({ projectId: deployments.projectId })
          .from(deployments)
          .where(eq(deployments.id, game.deploymentId))
          .limit(1);
        const [project] = dep
          ? await tx
              .select({ organizationId: projects.organizationId })
              .from(projects)
              .where(eq(projects.id, dep.projectId))
              .limit(1)
          : [];
        if (project) {
          await creditPoints(scoped, project.organizationId, settled.authorRake, 'course_rake', {
            communityGameId: live.communityGameId,
            note: '今夜压盘抽成',
            meta: { sku: 'course_rake', nodeId: live.id },
          });
          await tx.insert(kaiTransfers).values({
            communityGameId: live.communityGameId,
            fromOrganizationId: project.organizationId,
            toOrganizationId: project.organizationId,
            kind: 'course',
            points: 0,
            authorPoints: settled.authorRake,
            meta: {
              sku: 'course_rake',
              nodeId: live.id,
              pool: settled.pool,
              leftover: settled.leftover,
            },
          });
        }
      }
    }
    const winning = options.find((row) => row.id === outcome.winningOptionId);
    const canonLocale = coursePromptLocale(live.prompt);
    const canon = outcome.voided
      ? courseVoidCanonLine({ locale: canonLocale, prompt: live.prompt })
      : courseCanonLine({
          locale: canonLocale,
          prompt: live.prompt,
          winningLabel: winning?.label ?? '',
        });
    const [clock] = await tx
      .select({
        simTime: sql<string>`coalesce(max(${societyEvents.simTime})::text, '0')`,
      })
      .from(societyEvents)
      .where(eq(societyEvents.worldId, live.worldId));
    await tx
      .insert(societyEvents)
      .values({
        worldId: live.worldId,
        eventKey: `course-settle:${live.id}`,
        simTime: clock?.simTime ?? '0',
        kind: 'observation',
        payloadJson: {
          text: canon,
          course: true,
          degraded: true,
          nodeId: live.id,
          voidReason: outcome.voidReason,
        },
      })
      .onConflictDoNothing();
    pulseSnap = {
      id: live.id,
      status: outcome.voided ? 'void' : 'settled',
      pool: settled.pool,
      contested: contest.contested,
      winningOptionId: outcome.winningOptionId,
      voidReason: outcome.voidReason,
      canon,
      options: options.map((option) => ({
        id: option.id,
        points: stakes
          .filter((row) => row.optionId === option.id)
          .reduce((sum, row) => sum + row.points, 0),
      })),
    };
    const stakeUsers = await tx
      .select({
        organizationId: worldCourseStakes.organizationId,
        userId: worldCourseStakes.userId,
        optionId: worldCourseStakes.optionId,
      })
      .from(worldCourseStakes)
      .where(eq(worldCourseStakes.nodeId, live.id));
    pushSnap = {
      nodeId: live.id,
      gameId: live.communityGameId,
      voided: outcome.voided,
      voidReason: outcome.voidReason,
      winningOptionId: outcome.winningOptionId,
      canon,
      payouts: settled.payouts.map((row) => ({
        organizationId: row.organizationId,
        kind: row.kind,
        points: row.points,
      })),
      stakes: stakeUsers,
      webBaseUrl: process.env['PLATFORM_WEB_BASE_URL'] ?? null,
    };
  });
  if (pulseSnap) {
    void emitCoursePulse(node.worldId, pulseSnap);
    void promoteQueuedCourseNode(db, node.worldId).catch(() => undefined);
  }
  dispatchSettlePush(db, pushSnap);
  return applied;
}

export async function settleDueCourseNodes(
  db: DrizzleDb,
  now = new Date(),
): Promise<number> {
  await closeExpiredBetting(db, now);
  const due = await db
    .select()
    .from(worldCourseNodes)
    .where(
      and(
        inArray(worldCourseNodes.status, ['open', 'closed']),
        lte(worldCourseNodes.settlesAt, now),
      ),
    )
    .limit(20);
  const lonely = await db
    .select()
    .from(worldCourseNodes)
    .where(
      and(
        eq(worldCourseNodes.status, 'closed'),
        gt(worldCourseNodes.settlesAt, now),
        sql`(select count(distinct option_id) from world_course_stakes s where s.node_id = ${worldCourseNodes.id}) < 2`,
      ),
    )
    .limit(20);
  const seen = new Set<string>();
  let n = 0;
  for (const node of [...due, ...lonely]) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    if (await settleOneNode(db, node)) n += 1;
  }
  return n;
}

export async function voidCourseNodesForWorld(
  db: DrizzleDb,
  worldId: string,
  reason = 'paused',
): Promise<number> {
  const nodes = await db
    .select()
    .from(worldCourseNodes)
    .where(
      and(
        eq(worldCourseNodes.worldId, worldId),
        inArray(worldCourseNodes.status, ['open', 'closed']),
      ),
    );
  let n = 0;
  for (const node of nodes) {
    if (await settleOneNode(db, node, reason)) n += 1;
  }
  return n;
}

export async function voidCourseNodesForGame(
  db: DrizzleDb,
  communityGameId: string,
  reason = 'takedown',
): Promise<number> {
  const byGame = await db
    .select()
    .from(worldCourseNodes)
    .where(
      and(
        eq(worldCourseNodes.communityGameId, communityGameId),
        inArray(worldCourseNodes.status, ['open', 'closed']),
      ),
    );
  let worldId = byGame[0]?.worldId ?? null;
  if (!worldId) {
    const [game] = await db
      .select({ deploymentId: communityGames.deploymentId })
      .from(communityGames)
      .where(eq(communityGames.id, communityGameId))
      .limit(1);
    const [dep] = game
      ? await db
          .select({ projectId: deployments.projectId })
          .from(deployments)
          .where(eq(deployments.id, game.deploymentId))
          .limit(1)
      : [];
    const [world] = dep
      ? await db
          .select({ id: worlds.id })
          .from(worlds)
          .where(eq(worlds.projectId, dep.projectId))
          .limit(1)
      : [];
    worldId = world?.id ?? null;
  }
  const orphans = worldId
    ? await db
        .select()
        .from(worldCourseNodes)
        .where(
          and(
            eq(worldCourseNodes.worldId, worldId),
            inArray(worldCourseNodes.status, ['open', 'closed']),
          ),
        )
    : [];
  const seen = new Set<string>();
  let n = 0;
  for (const node of [...byGame, ...orphans]) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    if (await settleOneNode(db, node, reason)) n += 1;
  }
  return n;
}

export function startCourseSettleLoop(
  db: DrizzleDb,
  intervalMs = 60_000,
): () => void {
  let stopped = false;
  const tick = (): void => {
    if (stopped) return;
    void settleDueCourseNodes(db).catch((err) => {
      console.error('[course] settle loop failed', err);
    });
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export async function listAlleyCourseBoards(
  db: DrizzleDb,
  locale: 'zh-CN' | 'en' = 'zh-CN',
  now = new Date(),
): Promise<
  Array<{
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly thumbnail: string | null;
    readonly category: string;
    readonly playCount: number;
    readonly remixCount: number;
    readonly publishedAt: Date;
    readonly prompt: string;
    readonly pool: number;
    readonly status: string;
  }>
> {
  await closeExpiredBetting(db);
  const rows = await db
    .select({
      node: worldCourseNodes,
      game: communityGames,
    })
    .from(worldCourseNodes)
    .innerJoin(communityGames, eq(communityGames.id, worldCourseNodes.communityGameId))
    .where(
      and(
        eq(worldCourseNodes.status, 'open'),
        eq(communityGames.isPublic, true),
        sql`${communityGames.takenDownAt} is null`,
      ),
    )
    .orderBy(desc(worldCourseNodes.opensAt))
    .limit(24);
  const dayStartMs = chinaDayStart(now).getTime();
  const out: Array<{
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly thumbnail: string | null;
    readonly category: string;
    readonly playCount: number;
    readonly remixCount: number;
    readonly publishedAt: Date;
    readonly prompt: string;
    readonly pool: number;
    readonly status: string;
  }> = [];
  for (const row of rows) {
    if (
      !alleyCourseOverlapsChinaDay({
        opensAtMs: row.node.opensAt.getTime(),
        settlesAtMs: row.node.settlesAt.getTime(),
        dayStartMs,
      })
    ) {
      continue;
    }
    const stakes = await stakesOf(db, row.node.id);
    const pool = stakes.reduce((sum, item) => sum + item.points, 0);
    out.push({
      id: row.game.id,
      slug: row.game.slug,
      title: row.game.title,
      thumbnail: row.game.thumbnail,
      category: row.game.category,
      playCount: row.game.playCount ?? 0,
      remixCount: row.game.remixCount ?? 0,
      publishedAt: row.game.publishedAt,
      prompt: locale === 'en' && row.node.prompt === NIGHT_MARKET_COURSE_PROMPT.zh
        ? NIGHT_MARKET_COURSE_PROMPT.en
        : row.node.prompt,
      pool,
      status: row.node.status,
    });
  }
  return out.sort((a, b) => b.pool - a.pool).slice(0, 6);
}

export async function hangTownEventOnCourse(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly deploymentId: string;
    readonly userId: string;
    readonly eventId: string;
    readonly label: string;
    readonly stimulus: string;
  },
): Promise<{ nodeId: string; optionId: string | null } | null> {
  const active = await loadActiveCourseNode(db, input.worldId);
  if (!active) return null;
  const options = await db
    .select({ id: worldCourseOptions.id, key: worldCourseOptions.key })
    .from(worldCourseOptions)
    .where(eq(worldCourseOptions.nodeId, active.id));
  const key = matchCourseOptionKey(
    input.eventId,
    options.map((row) => row.key),
  );
  const optionId = key
    ? (options.find((row) => row.key.toLowerCase() === key)?.id ?? null)
    : null;
  if (!optionId) return { nodeId: active.id, optionId: null };
  const hung = await db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    await lockCourseNode(scoped, active.id);
    const live = await loadActiveCourseNode(scoped, input.worldId);
    if (!live || live.id !== active.id) return null;
    const [dup] = await tx
      .select({ id: worldWhispers.id })
      .from(worldWhispers)
      .where(
        and(
          eq(worldWhispers.userId, input.userId),
          eq(worldWhispers.courseNodeId, live.id),
          eq(worldWhispers.courseOptionId, optionId),
        ),
      )
      .limit(1);
    if (dup) return { nodeId: live.id, optionId };
    const line = `夜市 · ${input.label}`.trim();
    const text = (line.length >= 2 ? line : input.stimulus).slice(0, 200);
    await tx.insert(worldWhispers).values({
      worldId: input.worldId,
      deploymentId: input.deploymentId,
      userId: input.userId,
      text,
      paid: true,
      weight: 3,
      courseNodeId: live.id,
      courseOptionId: optionId,
    });
    return { nodeId: live.id, optionId };
  });
  if (hung) {
    const view = await toView(db, active, null);
    void emitCoursePulse(input.worldId, view);
  }
  return hung;
}

export async function resolveCourseHang(
  db: DrizzleDb,
  input: {
    readonly worldId: string;
    readonly nodeId?: string | null;
    readonly optionId?: string | null;
    readonly organizationId?: string | null;
  },
): Promise<{ nodeId: string; optionId: string | null } | null> {
  const active = await loadActiveCourseNode(db, input.worldId);
  if (!active) return null;
  if (input.nodeId && input.nodeId !== active.id) return null;
  if (input.optionId) {
    const [option] = await db
      .select({ id: worldCourseOptions.id })
      .from(worldCourseOptions)
      .where(
        and(
          eq(worldCourseOptions.id, input.optionId),
          eq(worldCourseOptions.nodeId, active.id),
        ),
      )
      .limit(1);
    return { nodeId: active.id, optionId: option?.id ?? null };
  }
  if (input.organizationId) {
    const [mine] = await db
      .select({ optionId: worldCourseStakes.optionId })
      .from(worldCourseStakes)
      .where(
        and(
          eq(worldCourseStakes.nodeId, active.id),
          eq(worldCourseStakes.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    return { nodeId: active.id, optionId: mine?.optionId ?? null };
  }
  return { nodeId: active.id, optionId: null };
}

export type CourseAuthorStats = {
  readonly seeds: number;
  readonly finished: number;
  readonly settled: number;
  readonly voided: number;
  readonly contested: number;
  readonly voidRate: number | null;
  readonly contestedRate: number | null;
  readonly window: number;
};

/** Rolling author metrics from recent nodes (no log scraping). */
export async function loadCourseAuthorStats(
  db: DrizzleDb,
  worldId: string,
  window = 40,
): Promise<CourseAuthorStats> {
  const nodes = await db
    .select({
      id: worldCourseNodes.id,
      status: worldCourseNodes.status,
    })
    .from(worldCourseNodes)
    .where(eq(worldCourseNodes.worldId, worldId))
    .orderBy(desc(worldCourseNodes.createdAt))
    .limit(window);

  const finishedNodes = nodes.filter(
    (row) => row.status === 'settled' || row.status === 'void',
  );
  const nodeIds = finishedNodes.map((row) => row.id);
  const stakeRows =
    nodeIds.length > 0
      ? await db
          .select({
            nodeId: worldCourseStakes.nodeId,
            optionId: worldCourseStakes.optionId,
          })
          .from(worldCourseStakes)
          .where(inArray(worldCourseStakes.nodeId, nodeIds))
      : [];

  const sidesByNode = new Map<string, Set<string>>();
  for (const row of stakeRows) {
    const set = sidesByNode.get(row.nodeId) ?? new Set<string>();
    set.add(row.optionId);
    sidesByNode.set(row.nodeId, set);
  }

  let settled = 0;
  let voided = 0;
  let contested = 0;
  for (const node of finishedNodes) {
    if (node.status === 'void') voided += 1;
    else settled += 1;
    if ((sidesByNode.get(node.id)?.size ?? 0) >= 2) contested += 1;
  }
  const finished = finishedNodes.length;
  return {
    seeds: nodes.length,
    finished,
    settled,
    voided,
    contested,
    voidRate: finished > 0 ? voided / finished : null,
    contestedRate: finished > 0 ? contested / finished : null,
    window,
  };
}

export type MyCourseStakeRow = {
  readonly gameId: string;
  readonly slug: string;
  readonly title: string;
  readonly nodeId: string;
  readonly prompt: string;
  readonly status: string;
  readonly myPoints: number;
  readonly myOptionLabel: string;
  readonly pool: number;
  readonly contested: boolean;
  readonly bettingClosesAt: string;
  readonly settlesAt: string;
  readonly actKey: string | null;
};

/** Active stakes for the signed-in org across all towns (open or in evidence). */
export async function loadMyCourseStakes(
  db: DrizzleDb,
  organizationId: string,
): Promise<MyCourseStakeRow[]> {
  const rows = await db
    .select({
      stakePoints: worldCourseStakes.points,
      optionLabel: worldCourseOptions.label,
      node: worldCourseNodes,
      gameSlug: communityGames.slug,
      gameTitle: communityGames.title,
      gameId: communityGames.id,
    })
    .from(worldCourseStakes)
    .innerJoin(worldCourseNodes, eq(worldCourseStakes.nodeId, worldCourseNodes.id))
    .innerJoin(worldCourseOptions, eq(worldCourseStakes.optionId, worldCourseOptions.id))
    .leftJoin(communityGames, eq(worldCourseNodes.communityGameId, communityGames.id))
    .where(
      and(
        eq(worldCourseStakes.organizationId, organizationId),
        inArray(worldCourseNodes.status, ['open', 'closed']),
      ),
    )
    .orderBy(asc(worldCourseNodes.bettingClosesAt));

  const poolCache = new Map<string, number>();
  const contestCache = new Map<string, boolean>();
  const out: MyCourseStakeRow[] = [];

  for (const row of rows) {
    if (!row.gameId) continue;
    const nodeId = row.node.id;
    let pool = poolCache.get(nodeId);
    let contested = contestCache.get(nodeId);
    if (pool === undefined || contested === undefined) {
      const stakes = await stakesOf(db, nodeId);
      pool = stakes.reduce((sum, stake) => sum + stake.points, 0);
      contested = courseContest(stakes).contested;
      poolCache.set(nodeId, pool);
      contestCache.set(nodeId, contested);
    }
    const act = courseActIndex({
      status: row.node.status,
      bettingClosesAt: row.node.bettingClosesAt.toISOString(),
    });
    out.push({
      gameId: row.gameId,
      slug: row.gameSlug || row.gameId,
      title: row.gameTitle || row.gameSlug || 'Town',
      nodeId,
      prompt: row.node.prompt,
      status: row.node.status,
      myPoints: row.stakePoints,
      myOptionLabel: row.optionLabel,
      pool,
      contested,
      bettingClosesAt: row.node.bettingClosesAt.toISOString(),
      settlesAt: row.node.settlesAt.toISOString(),
      actKey: act ? courseActLabelKey(act) : null,
    });
  }
  return out;
}

export type CourseTonightDiscoveryItem = {
  readonly gameId: string;
  readonly slug: string;
  readonly title: string;
  readonly course: CourseReturnHint;
};

export type CourseTonightDiscovery = {
  readonly summary: {
    readonly townCount: number;
    readonly totalPool: number;
    readonly contestedCount: number;
    readonly soonestBettingClosesAt: string | null;
  };
  readonly items: readonly CourseTonightDiscoveryItem[];
};

/** All open betting windows across published towns — discovery「今夜套餐」. */
export async function loadCourseTonightDiscovery(
  db: DrizzleDb,
  limit = 12,
): Promise<CourseTonightDiscovery> {
  const nodes = await db
    .select({
      node: worldCourseNodes,
      gameId: communityGames.id,
      slug: communityGames.slug,
      title: communityGames.title,
    })
    .from(worldCourseNodes)
    .innerJoin(
      communityGames,
      eq(worldCourseNodes.communityGameId, communityGames.id),
    )
    .where(
      and(
        eq(worldCourseNodes.status, 'open'),
        isNull(communityGames.takenDownAt),
      ),
    );

  const items: CourseTonightDiscoveryItem[] = [];
  for (const row of nodes) {
    if (!row.gameId) continue;
    const stakes = await stakesOf(db, row.node.id);
    const pool = stakes.reduce((sum, stake) => sum + stake.points, 0);
    const contested = courseContest(stakes).contested;
    items.push({
      gameId: row.gameId,
      slug: row.slug || row.gameId,
      title: row.title || row.slug || 'Town',
      course: {
        prompt: row.node.prompt,
        status: row.node.status,
        pool,
        canon: null,
        bettingClosesAt: row.node.bettingClosesAt.toISOString(),
        settlesAt: row.node.settlesAt.toISOString(),
        contested,
      },
    });
  }
  items.sort((a, b) => {
    const poolDiff = (b.course.pool ?? 0) - (a.course.pool ?? 0);
    if (poolDiff !== 0) return poolDiff;
    return a.title.localeCompare(b.title);
  });
  let soonestBettingClosesAt: string | null = null;
  for (const item of items) {
    const at = item.course.bettingClosesAt;
    if (!at) continue;
    if (
      !soonestBettingClosesAt
      || Date.parse(at) < Date.parse(soonestBettingClosesAt)
    ) {
      soonestBettingClosesAt = at;
    }
  }
  return {
    summary: {
      townCount: items.length,
      totalPool: items.reduce((sum, row) => sum + (row.course.pool ?? 0), 0),
      contestedCount: items.filter((row) => row.course.contested).length,
      soonestBettingClosesAt,
    },
    items: items.slice(0, limit),
  };
}
