/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pricing campaigns, daily 开镇礼, resident adoption, challenge payout.
 * All clocks are China (UTC+8). Synthetic towns only — no real-person scrape.
 */

import { and, count, desc, eq, gt, gte, isNull, lt, sql, sum } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import {
  challengeEntries,
  communityGames,
  dailyStamps,
  gameLeaderboards,
  kaiTransfers,
  ledgerEntries,
  organizationMembers,
  residentAdoptions,
  users,
  wallets,
  weeklyChallenges,
  worldAgents,
} from '@opengame/platform-db';

import { quoteJiaxiStack } from '@opengame/game-planner';

import {
  authorSharePoints,
  COMMERCE,
  lockOrgCommerce,
  type CommerceKind,
} from './commerce.js';
import { creditPoints, ensureWallet } from './wallet.js';

export const MARKET = {
  dailyLogin: 8,
  dailyBonus: 6,
  welcome: 20,
  streak3: 4,
  streak7: 12,
  adoptMonth: 25,
  firstJiaxiRate: 0.5,
  firstXiangyiRate: 0.5,
  firstTopupRate: 0.2,
  inviteeGrant: 12,
  inviterGrant: 8,
  inviteDailyCap: 5,
  weekendEventRate: 0.8,
  jiaxiStackRate: 1.5,
} as const;

export function inviterGrantAllowed(
  alreadyToday: number,
  cap = MARKET.inviteDailyCap,
): boolean {
  return alreadyToday < cap;
}

export function chinaDayKey(now = new Date()): string {
  const cst = new Date(now.getTime() + 8 * 3_600_000);
  return cst.toISOString().slice(0, 10);
}

/** 00:00 China (UTC+8) as an absolute Date. Stack / tonight use this, not host local midnight. */
export function chinaDayStart(now = new Date()): Date {
  return new Date(`${chinaDayKey(now)}T00:00:00+08:00`);
}

export function prevChinaDay(day: string): string {
  const noon = new Date(`${day}T12:00:00+08:00`);
  return chinaDayKey(new Date(noon.getTime() - 24 * 3_600_000));
}

export function nextLoginStreak(
  lastDay: string | null | undefined,
  today: string,
  current: number,
): number {
  if (lastDay === today) return Math.max(1, current);
  if (lastDay === prevChinaDay(today)) return current + 1;
  return 1;
}

export function streakBonusPoints(streak: number): number {
  if (streak > 0 && streak % 7 === 0) return MARKET.streak7;
  if (streak === 3) return MARKET.streak3;
  return 0;
}

export function isChinaWeekend(now = new Date()): boolean {
  const cst = new Date(now.getTime() + 8 * 3_600_000);
  const day = cst.getUTCDay();
  return day === 0 || day === 6;
}

export interface PriceQuote {
  readonly list: number;
  readonly pay: number;
  readonly reason: 'newbie' | 'weekend' | 'stack' | null;
}

export function quoteVisitorPrice(input: {
  readonly kind: CommerceKind;
  readonly list: number;
  readonly firstJiaxi: boolean;
  readonly firstXiangyi?: boolean;
  readonly weekend?: boolean;
  readonly stackToday?: number;
}): PriceQuote {
  const list = Math.max(0, Math.round(input.list));
  if (input.kind === 'jiaxi' && list > 0) {
    const stacked = quoteJiaxiStack({
      list,
      firstJiaxi: input.firstJiaxi,
      stackToday: input.stackToday ?? 0,
      stackRate: MARKET.jiaxiStackRate,
    });
    return { list: stacked.list, pay: stacked.pay, reason: stacked.reason };
  }
  if (input.kind === 'xiangyi' && input.firstXiangyi && list > 0) {
    return {
      list,
      pay: Math.max(1, Math.floor(list * MARKET.firstXiangyiRate)),
      reason: 'newbie',
    };
  }
  if (input.kind === 'event' && (input.weekend ?? isChinaWeekend()) && list > 0) {
    return {
      list,
      pay: Math.max(1, Math.floor(list * MARKET.weekendEventRate)),
      reason: 'weekend',
    };
  }
  return { list, pay: list, reason: null };
}

export function firstTopupBonus(points: number, rate = MARKET.firstTopupRate): number {
  if (points <= 0) return 0;
  return Math.max(1, Math.floor(points * rate));
}

/** How many more points a wallet still needs for this spend. */
export function pointsShortfall(cost: number, balance: number): number {
  const c = Math.max(0, Math.round(Number(cost) || 0));
  const b = Math.max(0, Math.round(Number(balance) || 0));
  return Math.max(0, c - b);
}

export function paywallDetails(
  need?: number,
  balance?: number,
): { needPoints?: number; recommendSku: string } {
  const shortfall =
    need == null
      ? undefined
      : balance == null
        ? Math.max(0, Math.round(need))
        : pointsShortfall(need, balance);
  return {
    ...(shortfall != null ? { needPoints: shortfall } : {}),
    recommendSku: recommendPackSku(shortfall ?? need),
  };
}

export interface CampaignOffer {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly lane: 'jiaxi' | 'xiangyi' | 'general';
}

export function activeCampaigns(now = new Date()): CampaignOffer[] {
  const out: CampaignOffer[] = [
    {
      id: 'welcome',
      title: '见面礼 20 点',
      detail: '第一次打开钱包送一袋开镇礼。点数生成、加戏、镇时都能花。',
      lane: 'general',
    },
    {
      id: 'newbie-jiaxi',
      title: '新客首张加戏半价',
      detail: '第一次往别人的局里扔卡（含本局套票），按半价入账。作者仍拿七成。',
      lane: 'jiaxi',
    },
    {
      id: 'jiaxi-run',
      title: '本局套票',
      detail: '点名循环卡加一张加难，一口价。只计一次半价或今日加码，不拆两次结账。生成仍不是商品。',
      lane: 'jiaxi',
    },
    {
      id: 'jiaxi-stack',
      title: '同局今日加码',
      detail: '同一中国日再往同一局里扔卡，按一点五倍入账。作者仍拿七成。',
      lane: 'jiaxi',
    },
    {
      id: 'streak',
      title: '连签加码',
      detail: '连来三天再送 4 点，满七天送 12 点。断一天重计。',
      lane: 'general',
    },
    {
      id: 'town-month',
      title: '镇时月卡',
      detail: '一座镇续三十天，比连买四周更便宜。用点数付。',
      lane: 'xiangyi',
    },
    {
      id: 'first-topup',
      title: '首充加赠 20%',
      detail: '第一次买点数包，当场多送两成，进同一笔余额。',
      lane: 'general',
    },
    {
      id: 'first-xiangyi',
      title: '首条巷议半价',
      detail: '第一次花钱让一句话进镇里的舆论，按半价入账。作者仍拿七成。',
      lane: 'xiangyi',
    },
    {
      id: 'invite',
      title: '带朋友进镇',
      detail: '朋友用你的短名注册，对方得 12 点开镇礼，你得 8 点。每天最多 5 位。',
      lane: 'general',
    },
    {
      id: 'tip-coupon',
      title: '任务奖喝彩券',
      detail: '每日两项任务完成后，送一张免费喝彩。作者照样拿到分成。',
      lane: 'jiaxi',
    },
  ];
  if (isChinaWeekend(now)) {
    out.unshift({
      id: 'weekend-night-market',
      title: '周末夜市',
      detail: '丰收、失火、贵客到访今晚八折。镇还在过日子才有热闹。',
      lane: 'xiangyi',
    });
  }
  return out;
}

export async function hasSpentKind(
  db: DrizzleDb,
  organizationId: string,
  kind: CommerceKind,
): Promise<boolean> {
  const [row] = await db
    .select({ id: kaiTransfers.id })
    .from(kaiTransfers)
    .where(
      and(eq(kaiTransfers.fromOrganizationId, organizationId), eq(kaiTransfers.kind, kind)),
    )
    .limit(1);
  return Boolean(row);
}

export async function countJiaxiTodayOnGame(
  db: DrizzleDb,
  organizationId: string,
  gameId: string,
): Promise<number> {
  const since = chinaDayStart();
  const [row] = await db
    .select({ n: count() })
    .from(kaiTransfers)
    .where(
      and(
        eq(kaiTransfers.fromOrganizationId, organizationId),
        eq(kaiTransfers.communityGameId, gameId),
        eq(kaiTransfers.kind, 'jiaxi'),
        gte(kaiTransfers.createdAt, since),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function authorTonightEarned(
  db: DrizzleDb,
  organizationId: string,
): Promise<number> {
  const since = chinaDayStart();
  const [row] = await db
    .select({ total: sum(kaiTransfers.authorPoints) })
    .from(kaiTransfers)
    .where(
      and(
        eq(kaiTransfers.toOrganizationId, organizationId),
        gte(kaiTransfers.createdAt, since),
      ),
    );
  return Number(row?.total ?? 0);
}

/** Studio tonight: counts + which 加戏 cards landed on the author's works. */
export async function authorTonightBreakdown(
  db: DrizzleDb,
  organizationId: string,
): Promise<{
  points: number;
  tip: number;
  jiaxi: number;
  xiangyi: number;
  event: number;
  townTime: number;
  worldLight: number;
  jiaxiByCard: Record<string, number>;
}> {
  const since = chinaDayStart();
  const rows = await db
    .select({
      kind: kaiTransfers.kind,
      n: count(),
      points: sum(kaiTransfers.authorPoints),
    })
    .from(kaiTransfers)
    .where(
      and(
        eq(kaiTransfers.toOrganizationId, organizationId),
        gte(kaiTransfers.createdAt, since),
      ),
    )
    .groupBy(kaiTransfers.kind);
  const bag = {
    points: 0,
    tip: 0,
    jiaxi: 0,
    xiangyi: 0,
    event: 0,
    townTime: 0,
    worldLight: 0,
    jiaxiByCard: {} as Record<string, number>,
  };
  for (const row of rows) {
    const n = Number(row.n ?? 0);
    bag.points += Number(row.points ?? 0);
    if (row.kind === 'tip') bag.tip = n;
    if (row.kind === 'jiaxi') bag.jiaxi = n;
    if (row.kind === 'xiangyi') bag.xiangyi = n;
    if (row.kind === 'event') bag.event = n;
    if (row.kind === 'town_time') bag.townTime = n;
    if (row.kind === 'world_light') bag.worldLight = n;
  }
  const jiaxiRows = await db
    .select({ meta: kaiTransfers.meta })
    .from(kaiTransfers)
    .where(
      and(
        eq(kaiTransfers.toOrganizationId, organizationId),
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

export async function authorWeekEarned(
  db: DrizzleDb,
  organizationId: string,
): Promise<number> {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [row] = await db
    .select({ total: sum(kaiTransfers.authorPoints) })
    .from(kaiTransfers)
    .where(
      and(
        eq(kaiTransfers.toOrganizationId, organizationId),
        gt(kaiTransfers.createdAt, since),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function grantFirstTopupBonus(
  db: DrizzleDb,
  organizationId: string,
  points: number,
  orderId: string,
): Promise<number> {
  const extra = firstTopupBonus(points);
  if (extra <= 0) return 0;
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    const [claimed] = await tx
      .update(wallets)
      .set({ firstTopupGranted: true, updatedAt: new Date() })
      .where(and(eq(wallets.organizationId, organizationId), eq(wallets.firstTopupGranted, false)))
      .returning({ organizationId: wallets.organizationId });
    if (!claimed) return 0;
    await creditPoints(scoped, organizationId, extra, 'grant', {
      orderId,
      note: '首充加赠',
      meta: { sku: 'first_topup' },
    });
    return extra;
  });
}

export async function consumeTipCoupon(
  db: DrizzleDb,
  organizationId: string,
): Promise<boolean> {
  const day = chinaDayKey();
  const [claimed] = await db
    .update(dailyStamps)
    .set({ tipCoupon: false })
    .where(
      and(
        eq(dailyStamps.organizationId, organizationId),
        eq(dailyStamps.day, day),
        eq(dailyStamps.tipCoupon, true),
      ),
    )
    .returning({ organizationId: dailyStamps.organizationId });
  return Boolean(claimed);
}

/** Consume the day's cheer coupon and credit the author in one transaction. */
export async function redeemTipCoupon(
  db: DrizzleDb,
  params: {
    readonly fromOrgId: string;
    readonly toOrgId: string;
    readonly userId: string;
    readonly gameId: string;
  },
): Promise<
  | { readonly ok: false; readonly reason: 'no-coupon' }
  | { readonly ok: true; readonly points: number; readonly authorPoints: number }
> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    const used = await consumeTipCoupon(scoped, params.fromOrgId);
    if (!used) return { ok: false as const, reason: 'no-coupon' as const };
    const points = COMMERCE.tipPresets[0];
    const authorPoints =
      params.fromOrgId === params.toOrgId ? 0 : authorSharePoints(points);
    if (authorPoints > 0) {
      await creditPoints(scoped, params.toOrgId, authorPoints, 'tip', {
        communityGameId: params.gameId,
        sourceOrganizationId: params.fromOrgId,
        note: '喝彩券',
        meta: { sku: 'tip_coupon' },
      });
    }
    await tx.insert(kaiTransfers).values({
      communityGameId: params.gameId,
      fromOrganizationId: params.fromOrgId,
      toOrganizationId: params.toOrgId,
      userId: params.userId,
      kind: 'tip',
      points,
      authorPoints,
      meta: { coupon: true },
    });
    return { ok: true as const, points, authorPoints };
  });
}

export async function claimInvite(
  db: DrizzleDb,
  params: {
    readonly organizationId: string;
    readonly userId: string;
    readonly handle: string;
  },
): Promise<{ ok: boolean; invited?: number; inviter?: number; reason?: string }> {
  const handle = params.handle.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
    return { ok: false, reason: 'bad-handle' };
  }
  await ensureWallet(db, params.organizationId);
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.organizationId, params.organizationId))
    .limit(1);
  if (wallet?.inviteClaimed) return { ok: false, reason: 'already' };
  const [inviter] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.handle, handle))
    .limit(1);
  if (!inviter) return { ok: false, reason: 'unknown' };
  if (inviter.id === params.userId) return { ok: false, reason: 'self' };
  const [inviterMem] = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, inviter.id))
    .limit(1);
  if (!inviterMem) return { ok: false, reason: 'unknown' };
  if (inviterMem.organizationId === params.organizationId) {
    return { ok: false, reason: 'self' };
  }
  const since = new Date(`${chinaDayKey()}T00:00:00+08:00`);
  const today = await db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.organizationId, inviterMem.organizationId),
        eq(ledgerEntries.kind, 'grant'),
        gte(ledgerEntries.createdAt, since),
        sql`${ledgerEntries.meta} ->> 'sku' = 'invite_inviter'`,
      ),
    );
  if (today.length >= MARKET.inviteDailyCap) {
    return { ok: false, reason: 'cap' };
  }
  const claimed = await db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    const [row] = await tx
      .update(wallets)
      .set({
        inviteClaimed: true,
        invitedByUserId: inviter.id,
        updatedAt: new Date(),
      })
      .where(
        and(eq(wallets.organizationId, params.organizationId), eq(wallets.inviteClaimed, false)),
      )
      .returning({ organizationId: wallets.organizationId });
    if (!row) return false;
    await creditPoints(scoped, params.organizationId, MARKET.inviteeGrant, 'grant', {
      note: `邀请见面 · ${handle}`,
      meta: { sku: 'invite_invitee', handle },
    });
    return true;
  });
  if (!claimed) return { ok: false, reason: 'already' };
  const inviterPaid = await db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    await lockOrgCommerce(scoped, inviterMem.organizationId, 'invite');
    const lockedToday = await tx
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.organizationId, inviterMem.organizationId),
          eq(ledgerEntries.kind, 'grant'),
          gte(ledgerEntries.createdAt, since),
          sql`${ledgerEntries.meta} ->> 'sku' = 'invite_inviter'`,
        ),
      );
    if (!inviterGrantAllowed(lockedToday.length)) return 0;
    await creditPoints(scoped, inviterMem.organizationId, MARKET.inviterGrant, 'grant', {
      sourceOrganizationId: params.organizationId,
      note: '带朋友进镇',
      meta: { sku: 'invite_inviter', handle },
    });
    return MARKET.inviterGrant;
  });
  return { ok: true, invited: MARKET.inviteeGrant, inviter: inviterPaid };
}

export interface DailyState {
  readonly day: string;
  readonly loginGranted: boolean;
  readonly loginPoints: number;
  readonly missions: {
    readonly play: boolean;
    readonly town: boolean;
    readonly visit: boolean;
  };
  readonly bonusGranted: boolean;
  readonly bonusPoints: number;
  readonly streak: number;
  readonly streakBonus: number;
  readonly welcomeJustGranted: number;
  readonly welcomePoints: number;
  readonly tipCoupon: boolean;
}

async function loadStamp(db: DrizzleDb, organizationId: string, day: string) {
  await db
    .insert(dailyStamps)
    .values({ organizationId, day })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(dailyStamps)
    .where(and(eq(dailyStamps.organizationId, organizationId), eq(dailyStamps.day, day)))
    .limit(1);
  return row;
}

export async function claimDailyLogin(
  db: DrizzleDb,
  organizationId: string,
): Promise<DailyState & { readonly justGranted: number }> {
  const day = chinaDayKey();
  await db.insert(wallets).values({ organizationId }).onConflictDoNothing();
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.organizationId, organizationId))
    .limit(1);

  let welcomeJustGranted = 0;
  if (wallet && !wallet.welcomeGranted) {
    welcomeJustGranted = await db.transaction(async (tx) => {
      const scoped = tx as unknown as DrizzleDb;
      const [claimedWelcome] = await tx
        .update(wallets)
        .set({ welcomeGranted: true, updatedAt: new Date() })
        .where(and(eq(wallets.organizationId, organizationId), eq(wallets.welcomeGranted, false)))
        .returning({ organizationId: wallets.organizationId });
      if (!claimedWelcome) return 0;
      await creditPoints(scoped, organizationId, MARKET.welcome, 'grant', {
        note: '见面礼',
        meta: { sku: 'welcome' },
      });
      return MARKET.welcome;
    });
  }

  const lastDay =
    typeof wallet?.lastLoginDay === 'string'
      ? wallet.lastLoginDay.slice(0, 10)
      : wallet?.lastLoginDay
        ? String(wallet.lastLoginDay).slice(0, 10)
        : null;
  let streak = wallet?.loginStreak ?? 0;
  const row = await loadStamp(db, organizationId, day);
  let justGranted = 0;
  if (row && !row.loginGranted) {
    streak = nextLoginStreak(lastDay, day, streak);
    const extra = streakBonusPoints(streak);
    const total = MARKET.dailyLogin + extra;
    const claimedLogin = await db.transaction(async (tx) => {
      const scoped = tx as unknown as DrizzleDb;
      const [claimed] = await tx
        .update(dailyStamps)
        .set({ loginGranted: true })
        .where(
          and(
            eq(dailyStamps.organizationId, organizationId),
            eq(dailyStamps.day, day),
            eq(dailyStamps.loginGranted, false),
          ),
        )
        .returning({ organizationId: dailyStamps.organizationId });
      if (!claimed) return 0;
      await creditPoints(scoped, organizationId, total, 'grant', {
        note: extra > 0 ? `每日开镇礼 · 连签${streak}` : '每日开镇礼',
        meta: { sku: 'daily_login', streak, extra },
      });
      await tx
        .update(wallets)
        .set({ loginStreak: streak, lastLoginDay: day, updatedAt: new Date() })
        .where(eq(wallets.organizationId, organizationId));
      return total;
    });
    justGranted = claimedLogin;
  }
  const fresh = await loadStamp(db, organizationId, day);
  const [freshWallet] = await db
    .select({ loginStreak: wallets.loginStreak })
    .from(wallets)
    .where(eq(wallets.organizationId, organizationId))
    .limit(1);
  streak = freshWallet?.loginStreak ?? streak;
  return {
    day,
    loginGranted: Boolean(fresh?.loginGranted || justGranted),
    loginPoints: MARKET.dailyLogin,
    missions: {
      play: Boolean(fresh?.missionPlay),
      town: Boolean(fresh?.missionTown),
      visit: Boolean(fresh?.missionVisit),
    },
    bonusGranted: Boolean(fresh?.bonusGranted),
    bonusPoints: MARKET.dailyBonus,
    justGranted,
    streak,
    streakBonus: streakBonusPoints(streak),
    welcomeJustGranted,
    welcomePoints: MARKET.welcome,
    tipCoupon: Boolean(fresh?.tipCoupon),
  };
}

export async function markDailyMission(
  db: DrizzleDb,
  organizationId: string,
  mission: 'play' | 'town' | 'visit',
): Promise<void> {
  const day = chinaDayKey();
  await loadStamp(db, organizationId, day);
  const patch =
    mission === 'play'
      ? { missionPlay: true }
      : mission === 'town'
        ? { missionTown: true }
        : { missionVisit: true };
  await db
    .update(dailyStamps)
    .set(patch)
    .where(and(eq(dailyStamps.organizationId, organizationId), eq(dailyStamps.day, day)));
  await db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    const [claimedBonus] = await tx
      .update(dailyStamps)
      .set({ bonusGranted: true, tipCoupon: true })
      .where(
        and(
          eq(dailyStamps.organizationId, organizationId),
          eq(dailyStamps.day, day),
          eq(dailyStamps.bonusGranted, false),
          sql`(
            CASE WHEN ${dailyStamps.missionPlay} THEN 1 ELSE 0 END +
            CASE WHEN ${dailyStamps.missionTown} THEN 1 ELSE 0 END +
            CASE WHEN ${dailyStamps.missionVisit} THEN 1 ELSE 0 END
          ) >= 2`,
        ),
      )
      .returning({ organizationId: dailyStamps.organizationId });
    if (!claimedBonus) return;
    await creditPoints(scoped, organizationId, MARKET.dailyBonus, 'grant', {
      note: '每日任务奖',
      meta: { sku: 'daily_bonus' },
    });
  });
}

export async function listTownResidents(
  db: DrizzleDb,
  worldId: string,
): Promise<Array<{ key: string; name: string }>> {
  const rows = await db
    .select({ key: worldAgents.agentKey, name: worldAgents.name })
    .from(worldAgents)
    .where(eq(worldAgents.worldId, worldId))
    .limit(40);
  return rows.map((r) => ({ key: r.key, name: r.name }));
}

export async function listAdoptions(
  db: DrizzleDb,
  organizationId: string,
  gameId?: string,
): Promise<
  Array<{
    id: string;
    gameId: string;
    agentKey: string;
    agentName: string;
    until: string;
  }>
> {
  const now = new Date();
  const rows = await db
    .select()
    .from(residentAdoptions)
    .where(
      gameId
        ? and(
            eq(residentAdoptions.organizationId, organizationId),
            eq(residentAdoptions.communityGameId, gameId),
            gt(residentAdoptions.until, now),
          )
        : and(
            eq(residentAdoptions.organizationId, organizationId),
            gt(residentAdoptions.until, now),
          ),
    )
    .orderBy(desc(residentAdoptions.until))
    .limit(20);
  return rows.map((r) => ({
    id: r.id,
    gameId: r.communityGameId,
    agentKey: r.agentKey,
    agentName: r.agentName,
    until: r.until.toISOString(),
  }));
}

export async function upsertAdoption(
  db: DrizzleDb,
  params: {
    readonly gameId: string;
    readonly organizationId: string;
    readonly userId: string;
    readonly agentKey: string;
    readonly agentName: string;
    readonly points: number;
  },
): Promise<{ until: Date; extended: boolean }> {
  const [row] = await db
    .insert(residentAdoptions)
    .values({
      communityGameId: params.gameId,
      organizationId: params.organizationId,
      userId: params.userId,
      agentKey: params.agentKey,
      agentName: params.agentName,
      until: sql`now() + interval '30 days'`,
      pointsPaid: params.points,
    })
    .onConflictDoUpdate({
      target: [
        residentAdoptions.communityGameId,
        residentAdoptions.organizationId,
        residentAdoptions.agentKey,
      ],
      set: {
        agentName: params.agentName,
        userId: params.userId,
        pointsPaid: sql`${residentAdoptions.pointsPaid} + ${params.points}`,
        until: sql`GREATEST(COALESCE(${residentAdoptions.until}, now()), now()) + interval '30 days'`,
      },
    })
    .returning({ until: residentAdoptions.until, createdAt: residentAdoptions.createdAt });
  const until = row?.until ?? new Date(Date.now() + 30 * 86_400_000);
  const extended = Boolean(row && row.createdAt.getTime() < until.getTime() - 20 * 86_400_000);
  return { until, extended };
}

export async function settleEndedChallenges(db: DrizzleDb): Promise<number> {
  const now = new Date();
  const ended = await db
    .select()
    .from(weeklyChallenges)
    .where(and(lt(weeklyChallenges.endsAt, now), isNull(weeklyChallenges.settledAt)))
    .limit(8);
  let settled = 0;
  for (const challenge of ended) {
    const entries = await db
      .select()
      .from(challengeEntries)
      .where(eq(challengeEntries.challengeId, challenge.id));
    let winnerOrg: string | null = null;
    let best = -1;
    for (const entry of entries) {
      if (!entry.communityGameId) continue;
      const [game] = await db
        .select({ deploymentId: communityGames.deploymentId })
        .from(communityGames)
        .where(eq(communityGames.id, entry.communityGameId))
        .limit(1);
      if (!game) continue;
      const [top] = await db
        .select({ score: gameLeaderboards.score })
        .from(gameLeaderboards)
        .where(eq(gameLeaderboards.deploymentId, game.deploymentId))
        .orderBy(desc(gameLeaderboards.score))
        .limit(1);
      const score = top?.score ?? 0;
      if (score > best) {
        best = score;
        winnerOrg = entry.organizationId;
      }
    }
    try {
      const claimed = await db.transaction(async (tx) => {
        const scoped = tx as unknown as DrizzleDb;
        const [row] = await tx
          .update(weeklyChallenges)
          .set({ settledAt: now })
          .where(and(eq(weeklyChallenges.id, challenge.id), isNull(weeklyChallenges.settledAt)))
          .returning({ id: weeklyChallenges.id });
        if (!row) return false;
        if (winnerOrg && challenge.poolPoints > 0) {
          await creditPoints(scoped, winnerOrg, challenge.poolPoints, 'grant', {
            note: `周课题奖池 ${challenge.slug}`,
            meta: { sku: 'challenge_pool', challengeId: challenge.id },
          });
        }
        return true;
      });
      if (!claimed) continue;
    } catch {
      continue;
    }
    settled += 1;
  }
  return settled;
}

export function recommendPackSku(need?: number): string {
  const n = need ?? 0;
  if (n > 120) return 'pack_plus';
  if (n > 80) return 'pack_small';
  return 'pack_kai';
}
