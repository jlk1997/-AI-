/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 开镇 dual-track commerce. Generation is a soft anti-abuse cost.
 * Visitors pay to add drama to a run (加戏) or to move a town (巷议).
 */

import { and, count, desc, eq, gte, sql } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import {
  challengeEntries,
  communityGames,
  deployments,
  kaiTransfers,
  projects,
  sandboxRuns,
  weeklyChallenges,
  worlds,
} from '@opengame/platform-db';

import {
  featuredJiaxiCard,
  inferMechanicSpec,
  JIAXI_STACK_RATE,
  jiaxiDeckForMechanic,
  jiaxiRunBundle,
  resolveJiaxiCard,
  type JiaxiCardOffer,
  type MechanicHint,
} from '@opengame/game-planner';

import * as fs from 'node:fs';
import * as path from 'node:path';

import { COURSE, SOCIETY_WORLD_LIGHT, stackWorldLight } from '@opengame/platform-shared';

import { creditPoints, debitPoints } from './wallet.js';

export type CommerceKind =
  | 'tip'
  | 'jiaxi'
  | 'xiangyi'
  | 'town_time'
  | 'world_light'
  | 'event'
  | 'challenge'
  | 'remix_branch'
  | 'sandbox'
  | 'adopt'
  | 'course';

export const COMMERCE = {
  tipPresets: [5, 12, 30] as const,
  jiaxi: 8,
  xiangyi: 6,
  townTimeDay: 20,
  townTimeWeek: 80,
  /** 30 days. Cheaper than four week cards — the bundle that keeps a town living. */
  townTimeMonth: 240,
  worldLightHour: 15,
  worldLightDay: 40,
  worldLightWeek: 160,
  eventDefault: 15,
  challengeEntry: 10,
  remixBranch: 8,
  sandbox: 40,
  adopt: 25,
  authorShare: 0.7,
} as const;

export { COURSE };

export const DEFAULT_TOWN_EVENTS = [
  { id: 'harvest', label: '丰收', points: 15, stimulus: '今年收成好得不像话，粮仓都堆满了。' },
  { id: 'rumor', label: '谣言', points: 12, stimulus: '客栈后窗昨夜亮过，天亮前又黑了。' },
  { id: 'fire', label: '失火', points: 18, stimulus: '马厩夜里走了水，火光照亮半条街。' },
  { id: 'guest', label: '贵客', points: 15, stimulus: '一位外地贵客进了镇，人人都想看一眼。' },
] as const;

/** Fallback when a published game has no MechanicSpec snapshot. */
export const JIAXI_CARDS: readonly JiaxiCardOffer[] = [
  { id: 'harder', label: '加难', effect: 'next_wave_harder', points: 8 },
  { id: 'gravity', label: '反重力', effect: 'gravity_flip', points: 10 },
  { id: 'betray', label: '反水', effect: 'npc_betray', points: 8 },
  { id: 'double', label: '双倍分', effect: 'score_double', points: 8 },
];

export function asMechanicHint(raw: unknown): MechanicHint | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (row.schema !== 'opengame-mechanic-v1' && !Array.isArray(row.modules)) {
    return null;
  }
  return {
    modules: Array.isArray(row.modules)
      ? row.modules.filter((m): m is string => typeof m === 'string')
      : [],
    loops: Array.isArray(row.loops)
      ? row.loops
          .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === 'object')
          .map((l) => ({
            id: typeof l.id === 'string' ? l.id : '',
            label: typeof l.label === 'string' ? l.label : String(l.id ?? ''),
            source: typeof l.source === 'string' ? l.source : undefined,
          }))
          .filter((l) => l.id)
      : [],
    arcadeVariant: typeof row.arcadeVariant === 'string' ? row.arcadeVariant : undefined,
    boardKind: typeof row.boardKind === 'string' ? row.boardKind : undefined,
    space: typeof row.space === 'string' ? row.space : undefined,
    extraScenes: Array.isArray(row.extraScenes)
      ? row.extraScenes.filter((s): s is string => typeof s === 'string')
      : [],
  };
}

/** 加戏 deck follows this work's loops. Towns get none. Generation is not sold. */
export function jiaxiDeckForPublishedGame(game: {
  readonly category: string;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly mechanicJson?: unknown;
}): JiaxiCardOffer[] {
  if (game.category === 'world') return [];
  const hint = asMechanicHint(game.mechanicJson);
  if (hint) return jiaxiDeckForMechanic(hint);
  const title = `${game.title ?? ''}\n${game.description ?? ''}`.trim();
  if (title.length >= 2) {
    return jiaxiDeckForMechanic(inferMechanicSpec(title));
  }
  return [...JIAXI_CARDS];
}

/** Read workspace MechanicSpec, else synthesize from the publish title. */
export function snapshotMechanicForPublish(input: {
  readonly projectId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly category?: string | null;
}): MechanicHint | Record<string, unknown> | null {
  if (input.category === 'world') return null;
  const root = process.env['PLATFORM_WORK_ROOT']?.trim();
  if (root) {
    for (const rel of [
      path.join('public', 'MECHANIC.json'),
      '.opengame-mechanic.json',
    ]) {
      const file = path.join(root, 'projects', input.projectId, 'repo', rel);
      if (!fs.existsSync(file)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        if (parsed?.schema === 'opengame-mechanic-v1') return parsed;
      } catch {
        /* next */
      }
    }
  }
  const text = `${input.title}\n${input.description ?? ''}`.trim();
  if (text.length < 2) return null;
  return inferMechanicSpec(text);
}

export function scaleJiaxiPoints(cardPoints: number, authorJiaxiCost: number): number {
  const base = COMMERCE.jiaxi;
  const author = authorJiaxiCost > 0 ? authorJiaxiCost : base;
  return Math.max(1, Math.round(cardPoints * (author / base)));
}

export { jiaxiRunBundle, resolveJiaxiCard };

/** Serialize quote + spend for one org rail so first-play discounts cannot stack. */
export async function lockOrgCommerce(
  db: DrizzleDb,
  organizationId: string,
  gate: string,
): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${gate}:${organizationId}`}))`);
}

export function authorSharePoints(points: number, rate = COMMERCE.authorShare): number {
  if (points <= 0) return 0;
  return Math.max(1, Math.floor(points * rate));
}

export type TownTimeSku = 'day' | 'week' | 'month';

export function townTimeMs(sku: TownTimeSku): number {
  if (sku === 'month') return 30 * 86_400_000;
  if (sku === 'week') return 7 * 86_400_000;
  return 86_400_000;
}

export function townTimeCost(sku: TownTimeSku): number {
  if (sku === 'month') return COMMERCE.townTimeMonth;
  if (sku === 'week') return COMMERCE.townTimeWeek;
  return COMMERCE.townTimeDay;
}

export type WorldLightSku = 'hour' | 'day' | 'week';

export function worldLightCost(sku: WorldLightSku): number {
  if (sku === 'week') return COMMERCE.worldLightWeek;
  if (sku === 'day') return COMMERCE.worldLightDay;
  return COMMERCE.worldLightHour;
}

export function parsePaidWorldLightSku(raw: unknown): WorldLightSku {
  if (raw === 'week' || raw === 'day' || raw === 'hour') return raw;
  return 'hour';
}

export interface TownEventOffer {
  readonly id: string;
  readonly label: string;
  readonly points: number;
  readonly stimulus: string;
}

export function resolveEventMenu(raw: unknown): TownEventOffer[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_TOWN_EVENTS.map((e) => ({ ...e }));
  }
  const out: TownEventOffer[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.stimulus !== 'string') continue;
    out.push({
      id: row.id,
      label: typeof row.label === 'string' ? row.label : row.id,
      points:
        typeof row.points === 'number' && row.points > 0
          ? Math.round(row.points)
          : COMMERCE.eventDefault,
      stimulus: row.stimulus,
    });
  }
  return out.length > 0 ? out : DEFAULT_TOWN_EVENTS.map((e) => ({ ...e }));
}

export interface SandboxReport {
  readonly stimulus: string;
  readonly contrast: boolean;
  readonly headline: string;
  readonly opinionLeaders: string[];
  readonly firstCrack: string;
  readonly recoveryHours: number;
  readonly spread: ReadonlyArray<{ readonly place: string; readonly heat: number }>;
  readonly control?: { readonly headline: string; readonly heat: number };
}

export function buildSandboxReport(input: {
  readonly stimulus: string;
  readonly contrast: boolean;
  readonly residentNames: readonly string[];
  readonly rumorCount: number;
  readonly talkCount: number;
  readonly simHours: number;
}): SandboxReport {
  const names = input.residentNames.slice(0, 3);
  const heat = Math.min(100, 20 + input.rumorCount * 12 + input.talkCount * 2);
  const first = names[1] ?? names[0] ?? '十字街口';
  return {
    stimulus: input.stimulus,
    contrast: input.contrast,
    headline: input.rumorCount > 0
      ? `刺激已进巷议，热度 ${heat}`
      : `刺激刚落下，镇里还在消化`,
    opinionLeaders: names,
    firstCrack: `${first}最先把话传开`,
    recoveryHours: Math.max(6, 36 - input.rumorCount * 4),
    spread: [
      { place: '十字街', heat },
      { place: '酒馆', heat: Math.max(10, heat - 15) },
      { place: '田埂', heat: Math.max(8, heat - 28) },
    ],
    ...(input.contrast
      ? {
          control: {
            headline: '对照镇未注入同样刺激，热度更低',
            heat: Math.max(8, Math.round(heat * 0.35)),
          },
        }
      : {}),
  };
}

const GAME_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function looksLikeGameId(value: string): boolean {
  return GAME_ID_RE.test(value);
}

export async function loadPublishedWork(
  db: DrizzleDb,
  gameId: string,
): Promise<{
  game: typeof communityGames.$inferSelect;
  projectId: string;
  authorOrgId: string;
  worldId: string | null;
} | null> {
  const [bySlug] = await db
    .select()
    .from(communityGames)
    .where(eq(communityGames.slug, gameId))
    .limit(1);
  const [byId] =
    !bySlug && looksLikeGameId(gameId)
      ? await db
          .select()
          .from(communityGames)
          .where(eq(communityGames.id, gameId))
          .limit(1)
      : [undefined];
  const game = bySlug ?? byId;
  if (!game) return null;
  const [dep] = await db
    .select({ projectId: deployments.projectId })
    .from(deployments)
    .where(eq(deployments.id, game.deploymentId))
    .limit(1);
  if (!dep) return null;
  const [project] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, dep.projectId))
    .limit(1);
  if (!project) return null;
  const [world] = await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.projectId, dep.projectId))
    .limit(1);
  return {
    game,
    projectId: dep.projectId,
    authorOrgId: project.organizationId,
    worldId: world?.id ?? null,
  };
}

export async function findCommunityByProject(
  db: DrizzleDb,
  projectId: string,
): Promise<{ id: string; category: string; license: string } | null> {
  const [row] = await db
    .select({
      id: communityGames.id,
      category: communityGames.category,
      license: communityGames.license,
    })
    .from(communityGames)
    .innerJoin(deployments, eq(communityGames.deploymentId, deployments.id))
    .where(eq(deployments.projectId, projectId))
    .orderBy(desc(communityGames.publishedAt))
    .limit(1);
  return row ?? null;
}

export interface TransferResult {
  readonly ok: boolean;
  readonly balance: number;
  readonly charged: number;
  readonly authorPoints: number;
  readonly need?: number;
}

export async function transferToAuthor(
  db: DrizzleDb,
  params: {
    readonly fromOrgId: string;
    readonly toOrgId: string;
    readonly userId: string;
    readonly gameId?: string | null;
    readonly kind: CommerceKind;
    readonly points: number;
    readonly note: string;
    readonly meta?: Record<string, unknown>;
    readonly share?: boolean;
  },
): Promise<TransferResult> {
  const points = Math.max(0, Math.round(params.points));
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    const paid = await debitPoints(scoped, params.fromOrgId, points, 'purchase', {
      communityGameId: params.gameId ?? null,
      note: params.note,
      meta: { sku: params.kind, ...(params.meta ?? {}) },
    });
    if (!paid.ok) {
      return {
        ok: false,
        balance: paid.balance,
        charged: 0,
        authorPoints: 0,
        need: paid.need ?? Math.max(0, points - paid.balance),
      };
    }
    const sameWallet = params.fromOrgId === params.toOrgId;
    const authorPoints =
      params.share !== false && !sameWallet ? authorSharePoints(points) : 0;
    if (authorPoints > 0) {
      await creditPoints(scoped, params.toOrgId, authorPoints, 'tip', {
        communityGameId: params.gameId ?? null,
        sourceOrganizationId: params.fromOrgId,
        note: params.note,
        meta: { sku: params.kind },
      });
    }
    await tx.insert(kaiTransfers).values({
      communityGameId: params.gameId ?? null,
      fromOrganizationId: params.fromOrgId,
      toOrganizationId: params.toOrgId,
      userId: params.userId,
      kind: params.kind,
      points,
      authorPoints,
      meta: params.meta ?? null,
    });
    return {
      ok: true,
      balance: paid.balance,
      charged: points,
      authorPoints,
    };
  });
}

/** Buyer always gets the points back; author clawback is best-effort. */
export async function refundVisitorTransfer(
  db: DrizzleDb,
  params: {
    readonly fromOrgId: string;
    readonly toOrgId: string;
    readonly gameId?: string | null;
    readonly kind: CommerceKind;
    readonly charged: number;
    readonly authorPoints: number;
    readonly note: string;
  },
): Promise<void> {
  if (params.charged <= 0) return;
  await creditPoints(db, params.fromOrgId, params.charged, 'refund', {
    communityGameId: params.gameId ?? null,
    note: params.note,
    meta: { sku: params.kind, refund: true },
  });
  if (params.authorPoints > 0 && params.fromOrgId !== params.toOrgId) {
    await debitPoints(db, params.toOrgId, params.authorPoints, 'adjust', {
      communityGameId: params.gameId ?? null,
      note: `${params.note} · 回退分成`,
      meta: { sku: params.kind, refund: true },
    });
  }
}

export async function enterWeeklyChallenge(
  db: DrizzleDb,
  params: {
    readonly challengeId: string;
    readonly organizationId: string;
    readonly userId: string;
    readonly communityGameId?: string | null;
    readonly points: number;
  },
): Promise<TransferResult & { readonly poolPoints?: number; readonly already?: boolean }> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    const inserted = await tx
      .insert(challengeEntries)
      .values({
        challengeId: params.challengeId,
        organizationId: params.organizationId,
        userId: params.userId,
        communityGameId: params.communityGameId ?? null,
        pointsPaid: params.points,
      })
      .onConflictDoNothing()
      .returning({ organizationId: challengeEntries.organizationId });
    if (!inserted[0]) {
      return {
        ok: true,
        balance: 0,
        charged: 0,
        authorPoints: 0,
        already: true,
      };
    }
    const paid = await debitPoints(scoped, params.organizationId, params.points, 'purchase', {
      note: 'weekly challenge entry',
      meta: { sku: 'challenge' },
    });
    if (!paid.ok) {
      throw new Error('challenge_entry_unpaid');
    }
    const [row] = await tx
      .update(weeklyChallenges)
      .set({ poolPoints: sql`${weeklyChallenges.poolPoints} + ${params.points}` })
      .where(eq(weeklyChallenges.id, params.challengeId))
      .returning({ poolPoints: weeklyChallenges.poolPoints });
    return {
      ok: true,
      balance: paid.balance,
      charged: params.points,
      authorPoints: 0,
      poolPoints: row?.poolPoints ?? params.points,
    };
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message === 'challenge_entry_unpaid') {
      return {
        ok: false,
        balance: 0,
        charged: 0,
        authorPoints: 0,
        need: params.points,
      };
    }
    throw err;
  });
}

export async function extendTownTime(
  db: DrizzleDb,
  worldId: string,
  durationMs: number,
): Promise<Date | null> {
  const ms = Math.max(0, Math.round(durationMs));
  const [row] = await db
    .update(worlds)
    .set({
      heartbeatEnabled: true,
      townTimeUntil: sql`GREATEST(COALESCE(${worlds.townTimeUntil}, now()), now()) + (${ms}::double precision * interval '1 millisecond')`,
      updatedAt: new Date(),
    })
    .where(eq(worlds.id, worldId))
    .returning({ townTimeUntil: worlds.townTimeUntil });
  return row?.townTimeUntil ?? null;
}

export async function applyWorldLightLease(
  db: DrizzleDb,
  worldId: string,
  input: {
    readonly until: Date | null;
    readonly bonusPerHour: number;
  },
): Promise<{
  readonly lightUntil: Date | null;
  readonly lightBonusPerHour: number;
} | null> {
  const [row] = await db
    .update(worlds)
    .set({
      heartbeatEnabled: true,
      lightUntil: input.until,
      lightBonusPerHour: Math.max(0, Math.floor(input.bonusPerHour)),
      updatedAt: new Date(),
    })
    .where(eq(worlds.id, worldId))
    .returning({
      lightUntil: worlds.lightUntil,
      lightBonusPerHour: worlds.lightBonusPerHour,
    });
  return row ?? null;
}

/**
 * Stack a paid SKU in one UPDATE so two concurrent 日卡/周卡 cannot
 * both read the same until and write the same GREATEST (lost duration).
 * Hour pack does not touch the lease — only the Redis hour bucket.
 */
export async function applyWorldLightSku(
  db: DrizzleDb,
  worldId: string,
  sku: WorldLightSku,
  now = Date.now(),
): Promise<{
  readonly lightUntil: Date | null;
  readonly lightBonusPerHour: number;
  readonly hourPackBonus: number;
} | null> {
  const offer = SOCIETY_WORLD_LIGHT[sku];
  const bonus = Math.max(0, Math.floor(offer.bonus));
  const durationMs = Math.max(0, Math.round(offer.durationMs));
  const touched = new Date(now);
  if (durationMs <= 0) {
    const [row] = await db
      .update(worlds)
      .set({
        heartbeatEnabled: true,
        updatedAt: touched,
      })
      .where(eq(worlds.id, worldId))
      .returning({
        lightUntil: worlds.lightUntil,
        lightBonusPerHour: worlds.lightBonusPerHour,
      });
    return row
      ? { ...row, hourPackBonus: bonus }
      : null;
  }
  const [row] = await db
    .update(worlds)
    .set({
      heartbeatEnabled: true,
      lightUntil: sql`GREATEST(COALESCE(${worlds.lightUntil}, now()), now()) + (${durationMs}::double precision * interval '1 millisecond')`,
      lightBonusPerHour: sql`GREATEST(COALESCE(${worlds.lightBonusPerHour}, 0), ${bonus})`,
      updatedAt: touched,
    })
    .where(eq(worlds.id, worldId))
    .returning({
      lightUntil: worlds.lightUntil,
      lightBonusPerHour: worlds.lightBonusPerHour,
    });
  return row ? { ...row, hourPackBonus: 0 } : null;
}

/** Visitor 打赏 / custom duration stacks the same `lightUntil` as a day/week SKU. */
export async function applyWorldLightDurationMs(
  db: DrizzleDb,
  worldId: string,
  durationMs: number,
  now = Date.now(),
): Promise<{
  readonly lightUntil: Date | null;
  readonly lightBonusPerHour: number;
} | null> {
  const ms = Math.max(0, Math.round(durationMs));
  const touched = new Date(now);
  if (ms <= 0) {
    const [row] = await db
      .select({
        lightUntil: worlds.lightUntil,
        lightBonusPerHour: worlds.lightBonusPerHour,
      })
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);
    return row ?? null;
  }
  const [row] = await db
    .update(worlds)
    .set({
      heartbeatEnabled: true,
      lightUntil: sql`GREATEST(COALESCE(${worlds.lightUntil}, now()), now()) + (${ms}::double precision * interval '1 millisecond')`,
      updatedAt: touched,
    })
    .where(eq(worlds.id, worldId))
    .returning({
      lightUntil: worlds.lightUntil,
      lightBonusPerHour: worlds.lightBonusPerHour,
    });
  return row ?? null;
}

export async function nextWorldLightState(
  db: DrizzleDb,
  worldId: string,
  sku: WorldLightSku,
  now = Date.now(),
): Promise<{
  readonly until: Date | null;
  readonly bonusPerHour: number;
  readonly hourPackBonus: number;
} | null> {
  const [row] = await db
    .select({
      lightUntil: worlds.lightUntil,
      lightBonusPerHour: worlds.lightBonusPerHour,
    })
    .from(worlds)
    .where(eq(worlds.id, worldId))
    .limit(1);
  if (!row) return null;
  return stackWorldLight({
    sku,
    currentUntil: row.lightUntil,
    currentBonus: row.lightBonusPerHour,
    now,
  });
}

export async function recordSandboxRun(
  db: DrizzleDb,
  params: {
    readonly gameId: string;
    readonly organizationId: string;
    readonly userId: string;
    readonly stimulus: string;
    readonly contrast: boolean;
    readonly report: SandboxReport;
    readonly points: number;
  },
): Promise<string> {
  const [row] = await db
    .insert(sandboxRuns)
    .values({
      communityGameId: params.gameId,
      organizationId: params.organizationId,
      userId: params.userId,
      stimulus: params.stimulus,
      contrast: params.contrast,
      report: params.report,
      pointsPaid: params.points,
    })
    .returning({ id: sandboxRuns.id });
  return row?.id ?? '';
}

/** Visitors may tip and stake. They cannot buy leftover 镇时 / 点亮 / 认养 / 巷议. */
export function worldVisitorSkuBlocked(input: {
  readonly category?: string | null;
  readonly viewerIsAuthor?: boolean;
}): boolean {
  return input.category === 'world' && !input.viewerIsAuthor;
}

export function publicCommerceView(
  game: typeof communityGames.$inferSelect,
  opts?: { readonly hideWorldVisitorSkus?: boolean },
): {
  readonly jiaxiEnabled: boolean;
  readonly xiangyiEnabled: boolean;
  readonly isOfficial: boolean;
  readonly jiaxiCost: number;
  readonly xiangyiCost: number;
  readonly events: TownEventOffer[];
  readonly cards: readonly JiaxiCardOffer[];
  readonly featuredCardId: string | null;
  readonly jiaxiStackRate: number;
  readonly runBundle: { readonly cardIds: readonly string[]; readonly list: number } | null;
  readonly tipPresets: readonly number[];
  readonly townTimeDay: number;
  readonly townTimeWeek: number;
  readonly townTimeMonth: number;
  readonly worldLightHour: number;
  readonly worldLightDay: number;
  readonly worldLightWeek: number;
  readonly remixBranch: number;
  readonly sandbox: number;
  readonly challengeEntry: number;
  readonly adopt: number;
  readonly courseMinStake: number;
} {
  const authorCost = game.jiaxiCost > 0 ? game.jiaxiCost : COMMERCE.jiaxi;
  const raw = jiaxiDeckForPublishedGame(game);
  const cards = raw.map((card) => ({
    ...card,
    points: scaleJiaxiPoints(card.points, authorCost),
  }));
  const bundle = jiaxiRunBundle(cards);
  const hideWorldSkus = Boolean(opts?.hideWorldVisitorSkus);
  return {
    jiaxiEnabled: game.jiaxiEnabled,
    xiangyiEnabled: hideWorldSkus ? false : game.xiangyiEnabled,
    isOfficial: game.isOfficial,
    jiaxiCost: authorCost,
    xiangyiCost: game.xiangyiCost > 0 ? game.xiangyiCost : COMMERCE.xiangyi,
    events: resolveEventMenu(game.eventMenu),
    cards,
    featuredCardId: featuredJiaxiCard(cards)?.id ?? null,
    jiaxiStackRate: JIAXI_STACK_RATE,
    runBundle:
      bundle.length > 0
        ? { cardIds: bundle.map((c) => c.id), list: bundle.reduce((s, c) => s + c.points, 0) }
        : null,
    tipPresets: COMMERCE.tipPresets,
    townTimeDay: hideWorldSkus ? 0 : COMMERCE.townTimeDay,
    townTimeWeek: hideWorldSkus ? 0 : COMMERCE.townTimeWeek,
    townTimeMonth: hideWorldSkus ? 0 : COMMERCE.townTimeMonth,
    worldLightHour: hideWorldSkus ? 0 : COMMERCE.worldLightHour,
    worldLightDay: hideWorldSkus ? 0 : COMMERCE.worldLightDay,
    worldLightWeek: hideWorldSkus ? 0 : COMMERCE.worldLightWeek,
    remixBranch: COMMERCE.remixBranch,
    sandbox: COMMERCE.sandbox,
    challengeEntry: COMMERCE.challengeEntry,
    adopt: hideWorldSkus ? 0 : COMMERCE.adopt,
    courseMinStake: COURSE.minStake,
  };
}

export async function tonightKaiCounts(
  db: DrizzleDb,
  gameId: string,
): Promise<{
  tip: number;
  jiaxi: number;
  xiangyi: number;
  event: number;
  townTime: number;
  worldLight: number;
  jiaxiByCard: Record<string, number>;
}> {
  const since = new Date(`${chinaDayKeyNow()}T00:00:00+08:00`);
  const rows = await db
    .select({ kind: kaiTransfers.kind, n: count() })
    .from(kaiTransfers)
    .where(
      and(eq(kaiTransfers.communityGameId, gameId), gte(kaiTransfers.createdAt, since)),
    )
    .groupBy(kaiTransfers.kind);
  const bag = {
    tip: 0,
    jiaxi: 0,
    xiangyi: 0,
    event: 0,
    townTime: 0,
    worldLight: 0,
    jiaxiByCard: {} as Record<string, number>,
  };
  for (const row of rows) {
    if (row.kind === 'tip') bag.tip = Number(row.n);
    if (row.kind === 'jiaxi') bag.jiaxi = Number(row.n);
    if (row.kind === 'xiangyi') bag.xiangyi = Number(row.n);
    if (row.kind === 'event') bag.event = Number(row.n);
    if (row.kind === 'town_time') bag.townTime = Number(row.n);
    if (row.kind === 'world_light') bag.worldLight = Number(row.n);
  }
  const jiaxiRows = await db
    .select({ meta: kaiTransfers.meta })
    .from(kaiTransfers)
    .where(
      and(
        eq(kaiTransfers.communityGameId, gameId),
        eq(kaiTransfers.kind, 'jiaxi'),
        gte(kaiTransfers.createdAt, since),
      ),
    )
    .limit(80);
  for (const row of jiaxiRows) {
    const meta = row.meta as { cardId?: string; cardIds?: unknown } | null;
    const many = Array.isArray(meta?.cardIds)
      ? meta.cardIds.filter((id): id is string => typeof id === 'string')
      : [];
    const ids = many.length > 0 ? many : [typeof meta?.cardId === 'string' ? meta.cardId : 'harder'];
    for (const id of ids) {
      bag.jiaxiByCard[id] = (bag.jiaxiByCard[id] ?? 0) + 1;
    }
  }
  return bag;
}

function chinaDayKeyNow(now = new Date()): string {
  const cst = new Date(now.getTime() + 8 * 3_600_000);
  return cst.toISOString().slice(0, 10);
}

export async function alreadyEnteredChallenge(
  db: DrizzleDb,
  challengeId: string,
  organizationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ challengeId: challengeEntries.challengeId })
    .from(challengeEntries)
    .where(
      and(
        eq(challengeEntries.challengeId, challengeId),
        eq(challengeEntries.organizationId, organizationId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export type JiaxiHostMessage = {
  readonly type: 'opengame:jiaxi';
  readonly effect: string;
  readonly loopId?: string;
  readonly label?: string;
};

/** Host must post these onto the play iframe; empty effect = paid with no drama. */
export function jiaxiHostMessages(
  cards: readonly { effect: string; loopId?: string; label?: string }[],
): JiaxiHostMessage[] {
  return cards
    .filter((card) => Boolean(card.effect))
    .map((card) => ({
      type: 'opengame:jiaxi',
      effect: card.effect,
      ...(card.loopId ? { loopId: card.loopId } : {}),
      ...(card.label ? { label: card.label } : {}),
    }));
}

export function jiaxiReceiptActionable(
  messages: readonly JiaxiHostMessage[],
): boolean {
  return messages.length > 0 && messages.every((m) => Boolean(m.effect));
}

export async function consumeLatestJiaxi(
  db: DrizzleDb,
  params: { readonly userId: string; readonly gameId: string },
): Promise<{ ok: true; transferId: string; already?: boolean } | { ok: false }> {
  const [row] = await db
    .select()
    .from(kaiTransfers)
    .where(
      and(
        eq(kaiTransfers.userId, params.userId),
        eq(kaiTransfers.communityGameId, params.gameId),
        eq(kaiTransfers.kind, 'jiaxi'),
      ),
    )
    .orderBy(desc(kaiTransfers.createdAt))
    .limit(1);
  if (!row) return { ok: false };
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  if (typeof meta['consumedAt'] === 'string') {
    return { ok: true, transferId: row.id, already: true };
  }
  const [claimed] = await db
    .update(kaiTransfers)
    .set({
      meta: { ...meta, consumedAt: new Date().toISOString() },
    })
    .where(
      and(
        eq(kaiTransfers.id, row.id),
        sql`(${kaiTransfers.meta}->>'consumedAt') IS NULL`,
      ),
    )
    .returning({ id: kaiTransfers.id });
  if (!claimed) {
    return { ok: true, transferId: row.id, already: true };
  }
  return { ok: true, transferId: row.id };
}
