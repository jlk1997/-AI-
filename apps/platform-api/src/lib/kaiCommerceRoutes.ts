/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Visitor-facing 开镇 spend: 喝彩, 加戏, 今夜压盘. World visitor pages do
 * not sell 镇时 / 点亮 / 认养. Generation is not sold here.
 */

import type { S3Client } from '@aws-sdk/client-s3';
import { and, desc, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Context, Hono } from 'hono';

import type { DrizzleDb } from '@opengame/platform-db';
import { tipExtendsLightMs } from '@opengame/platform-shared';
import {
  communityGames,
  loadRecentSocietyEvents,
  organizationMembers,
  pluginPackages,
  projectPlugins,
  projectTemplates,
  projects,
  sandboxRuns,
  templateEntitlements,
  users,
  weeklyChallenges,
  worldAgents,
  worlds,
} from '@opengame/platform-db';

import type { PlatformEnv } from '../env.js';
import { assertHourlyCap, HOURLY_CAPS } from './actionGate.js';
import { apiError, ErrorCode } from './errorCodes.js';
import { writeAudit } from './audit.js';
import { findTemplateBySlugVersion } from './templateCatalog.js';
import { isDeploymentMember, isPlatformAdmin } from './identity.js';
import { ensureWallet, hasPluginEntitlement } from './wallet.js';
import { peekOptionalJwt, type JwtPayload } from './jwt.js';
import {
  alreadyEnteredChallenge,
  COMMERCE,
  enterWeeklyChallenge,
  extendTownTime,
  findCommunityByProject,
  consumeLatestJiaxi,
  jiaxiDeckForPublishedGame,
  jiaxiHostMessages,
  jiaxiReceiptActionable,
  jiaxiRunBundle,
  loadPublishedWork,
  lockOrgCommerce,
  COURSE,
  refundVisitorTransfer,
  resolveJiaxiCard,
  scaleJiaxiPoints,
  publicCommerceView,
  worldVisitorSkuBlocked,
  recordSandboxRun,
  resolveEventMenu,
  tonightKaiCounts,
  townTimeCost,
  townTimeMs,
  transferToAuthor,
  applyWorldLightDurationMs,
  applyWorldLightSku,
  parsePaidWorldLightSku,
  worldLightCost,
  buildSandboxReport,
} from './commerce.js';
import {
  activeCampaigns,
  authorTonightBreakdown,
  authorWeekEarned,
  claimDailyLogin,
  claimInvite,
  countJiaxiTodayOnGame,
  hasSpentKind,
  listAdoptions,
  listTownResidents,
  markDailyMission,
  MARKET,
  paywallDetails,
  quoteVisitorPrice,
  redeemTipCoupon,
  settleEndedChallenges,
  upsertAdoption,
} from './kaiMarket.js';
import {
  hangTownEventOnCourse,
  loadCourseAuthorStats,
  loadCourseBoard,
  loadCourseSeedHints,
  loadMyCourseStakes,
  previewCourseRecommend,
  seedCourseNode,
  settleDueCourseNodes,
  stakeCourse,
  withdrawCourseStake,
  type CourseSeedBody,
  type CourseSeedKind,
} from './courseBoard.js';
import {
  coursePushPublicKey,
  removeCoursePushSubscription,
  upsertCoursePushSubscription,
  type CoursePushSubscriptionBody,
} from './coursePush.js';
import {
  loadMyCourseWatches,
  removeCourseGameWatch,
  upsertCourseGameWatch,
} from './courseWatch.js';
import {
  isSocietyBusyError,
  isSocietyTickTimeoutError,
  stampPaidSocietyTrace,
} from './societyLive.js';
import { landTownStimulus } from './societyTalkGate.js';
import {
  grantHourLightBonus,
  peekSocietyTalkBudget,
  talkBudgetOptsFromWorld,
} from './societyTalkBudget.js';
import { countSocietyWatchers } from './societyWatchers.js';
import {
  loadTownContributors,
  loadTownLamp,
  loadUserPublicName,
  publishSocietyPatron,
  societyPatronPayload,
} from './societyPatrons.js';

type Variables = { jwt: JwtPayload };
type AuthedEnv = { Variables: Variables };

async function isWorldVisitorBuyer(
  db: DrizzleDb,
  work: { readonly game: { readonly category: string; readonly deploymentId: string } },
  userId: string,
): Promise<boolean> {
  if (work.game.category !== 'world') return false;
  const author = await isDeploymentMember(db, work.game.deploymentId, userId);
  return worldVisitorSkuBlocked({
    category: work.game.category,
    viewerIsAuthor: author,
  });
}

async function assertProjectOrgMember(
  db: DrizzleDb,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const [project] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return false;
  const [mem] = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, project.organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(mem);
}

export function registerKaiCommerce(opts: {
  readonly v1: Hono<AuthedEnv>;
  readonly authed: Hono<AuthedEnv>;
  readonly db: DrizzleDb;
  readonly env: PlatformEnv;
  readonly s3: S3Client;
  readonly redis: Redis;
  readonly requireOrgAccess: (c: Context<AuthedEnv>) => Promise<string | Response>;
}): void {
  const { v1, authed, db, env, s3, redis, requireOrgAccess } = opts;

  v1.get('/public/kai/offers', async (c) => {
    void settleEndedChallenges(db).catch(() => 0);
    void settleDueCourseNodes(db).catch(() => 0);
    return c.json({
      campaigns: activeCampaigns(),
      dailyLogin: MARKET.dailyLogin,
      dailyBonus: MARKET.dailyBonus,
      welcome: MARKET.welcome,
      streak3: MARKET.streak3,
      streak7: MARKET.streak7,
      adopt: COMMERCE.adopt,
      townTimeMonth: COMMERCE.townTimeMonth,
      firstJiaxiRate: MARKET.firstJiaxiRate,
      firstXiangyiRate: MARKET.firstXiangyiRate,
      firstTopupRate: MARKET.firstTopupRate,
      inviteeGrant: MARKET.inviteeGrant,
      inviterGrant: MARKET.inviterGrant,
      weekendEventRate: MARKET.weekendEventRate,
    });
  });

  authed.get('/billing/market', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const jwt = c.get('jwt');
    const gameId = c.req.query('gameId')?.trim() || '';
    const [daily, tonight, week, firstJiaxi, firstXiangyi, me, jiaxiStackToday] = await Promise.all([
      claimDailyLogin(db, organizationId),
      authorTonightBreakdown(db, organizationId),
      authorWeekEarned(db, organizationId),
      hasSpentKind(db, organizationId, 'jiaxi').then((v) => !v),
      hasSpentKind(db, organizationId, 'xiangyi').then((v) => !v),
      db
        .select({ handle: users.handle })
        .from(users)
        .where(eq(users.id, jwt.sub))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      gameId ? countJiaxiTodayOnGame(db, organizationId, gameId) : Promise.resolve(0),
    ]);
    return c.json({
      campaigns: activeCampaigns(),
      daily,
      authorTonight: tonight.points,
      authorTonightByKind: {
        tip: tonight.tip,
        jiaxi: tonight.jiaxi,
        xiangyi: tonight.xiangyi,
        event: tonight.event,
        townTime: tonight.townTime,
        worldLight: tonight.worldLight,
      },
      jiaxiByCardTonight: tonight.jiaxiByCard,
      authorWeek: week,
      firstJiaxi,
      firstXiangyi,
      jiaxiStackToday,
      firstTopupAvailable: !(await ensureWallet(db, organizationId)).firstTopupGranted,
      welcomeJustGranted: daily.welcomeJustGranted,
      loginStreak: daily.streak,
      welcomePoints: MARKET.welcome,
      inviteHandle: me?.handle ?? null,
      steps: {
        welcome: daily.loginGranted,
        play: daily.missions.play,
        town: daily.missions.town,
      },
    });
  });

  authed.post('/billing/invite', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const body = (await c.req.json().catch(() => ({}))) as { handle?: string };
    const handle = (body.handle ?? '').trim();
    if (!handle) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'invite handle required'), 400);
    }
    const result = await claimInvite(db, {
      organizationId,
      userId: jwt.sub,
      handle,
    });
    if (!result.ok) {
      const status = result.reason === 'already' ? 200 : 400;
      return c.json({ ok: false, reason: result.reason }, status);
    }
    return c.json({ ok: true, invited: result.invited, inviter: result.inviter });
  });

  authed.get('/billing/adoptions', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    return c.json({ adoptions: await listAdoptions(db, organizationId) });
  });

  authed.get('/projects/:projectId/community-game', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    if (!(await assertProjectOrgMember(db, projectId, jwt.sub))) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a member of this project'), 403);
    }
    const game = await findCommunityByProject(db, projectId);
    return c.json({ gameId: game?.id ?? null, category: game?.category ?? null });
  });

  v1.get('/community/games/:gameId/commerce', async (c) => {
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    const jwt = await peekOptionalJwt(env.jwtSecret, c.req.header('authorization'));
    const viewerIsAuthor = jwt
      ? await isDeploymentMember(db, work.game.deploymentId, jwt.sub)
      : false;
    return c.json({
      ...publicCommerceView(work.game, {
        hideWorldVisitorSkus: work.game.category === 'world' && !viewerIsAuthor,
      }),
      category: work.game.category,
      challengeId: work.game.challengeId,
    });
  });

  authed.patch('/community/games/:gameId/commerce', async (c) => {
    const jwt = c.get('jwt');
    const gameId = c.req.param('gameId');
    const [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.id, gameId))
      .limit(1);
    if (!game) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    if (!(await isDeploymentMember(db, game.deploymentId, jwt.sub))) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not the author'), 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      jiaxiEnabled?: boolean;
      xiangyiEnabled?: boolean;
      jiaxiCost?: number;
      xiangyiCost?: number;
      eventMenu?: unknown;
    };
    const [row] = await db
      .update(communityGames)
      .set({
        ...(typeof body.jiaxiEnabled === 'boolean' ? { jiaxiEnabled: body.jiaxiEnabled } : {}),
        ...(typeof body.xiangyiEnabled === 'boolean'
          ? { xiangyiEnabled: body.xiangyiEnabled }
          : {}),
        ...(typeof body.jiaxiCost === 'number' && body.jiaxiCost > 0
          ? { jiaxiCost: Math.round(body.jiaxiCost) }
          : {}),
        ...(typeof body.xiangyiCost === 'number' && body.xiangyiCost > 0
          ? { xiangyiCost: Math.round(body.xiangyiCost) }
          : {}),
        ...(body.eventMenu !== undefined ? { eventMenu: resolveEventMenu(body.eventMenu) } : {}),
      })
      .where(eq(communityGames.id, gameId))
      .returning();
    return c.json({ ok: true, commerce: row ? publicCommerceView(row) : publicCommerceView(game) });
  });

  authed.patch('/community/games/:gameId/official', async (c) => {
    const jwt = c.get('jwt');
    if (!isPlatformAdmin(env, jwt)) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a curator'), 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as { official?: boolean };
    if (typeof body.official !== 'boolean') {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'official must be a boolean'), 400);
    }
    const [row] = await db
      .update(communityGames)
      .set({ isOfficial: body.official })
      .where(eq(communityGames.id, c.req.param('gameId')))
      .returning({ isOfficial: communityGames.isOfficial });
    if (!row) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    return c.json({ ok: true, isOfficial: row.isOfficial });
  });

  authed.get('/community/games/:gameId/kai-tonight', async (c) => {
    const jwt = c.get('jwt');
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    if (!(await isDeploymentMember(db, work.game.deploymentId, jwt.sub))) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not the author'), 403);
    }
    return c.json({ tonight: await tonightKaiCounts(db, work.game.id) });
  });

  authed.post('/community/games/:gameId/tip', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    if (!(await assertHourlyCap(redis, `tip:${jwt.sub}`, HOURLY_CAPS.tip))) {
      return c.json(apiError(ErrorCode.RATE_LIMITED, 'too many cheers this hour'), 429);
    }
    const body = (await c.req.json().catch(() => ({}))) as { points?: number; coupon?: boolean };
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    if (body.coupon) {
      const redeemed = await redeemTipCoupon(db, {
        fromOrgId: organizationId,
        toOrgId: work.authorOrgId,
        userId: jwt.sub,
        gameId: work.game.id,
      });
      if (!redeemed.ok) {
        return c.json(apiError(ErrorCode.INVALID_INPUT, 'no cheer coupon today'), 400);
      }
      await markDailyMission(db, organizationId, 'play');
      const wallet = await ensureWallet(db, organizationId);
      if (!work.worldId) {
        return c.json({
          ok: true,
          charged: 0,
          authorPoints: redeemed.authorPoints,
          coupon: true,
          balance: wallet.balance,
        });
      }
      const stacked = await applyWorldLightDurationMs(
        db,
        work.worldId,
        tipExtendsLightMs(redeemed.points),
      );
      return c.json({
        ok: true,
        charged: 0,
        authorPoints: redeemed.authorPoints,
        coupon: true,
        balance: wallet.balance,
        lightUntil: stacked?.lightUntil?.toISOString() ?? null,
      });
    }
    const points = Math.round(body.points ?? COMMERCE.tipPresets[0]);
    if (!COMMERCE.tipPresets.includes(points as (typeof COMMERCE.tipPresets)[number])) {
      if (points < 1 || points > 200) {
        return c.json(apiError(ErrorCode.INVALID_INPUT, 'tip is 1–200 points'), 400);
      }
    }
    const paid = await transferToAuthor(db, {
      fromOrgId: organizationId,
      toOrgId: work.authorOrgId,
      userId: jwt.sub,
      gameId: work.game.id,
      kind: 'tip',
      points,
      note: '喝彩',
    });
    if (!paid.ok) {
      return c.json(
        apiError(ErrorCode.QUOTA_EXCEEDED, 'not enough points', paywallDetails( paid.need)),
        402,
      );
    }
    await markDailyMission(db, organizationId, 'play');
    if (!work.worldId) return c.json(paid);
    const stacked = await applyWorldLightDurationMs(
      db,
      work.worldId,
      tipExtendsLightMs(points),
    );
    return c.json({
      ...paid,
      lightUntil: stacked?.lightUntil?.toISOString() ?? null,
    });
  });

  authed.post('/community/games/:gameId/jiaxi', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    if (!(await assertHourlyCap(redis, `jiaxi:${jwt.sub}`, HOURLY_CAPS.jiaxi))) {
      return c.json(
        apiError(ErrorCode.RATE_LIMITED, 'too many 加戏 this hour — play one first'),
        429,
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      cardId?: string;
      bundle?: 'run';
    };
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    if (work.game.category === 'world') {
      return c.json(apiError(ErrorCode.INVALID_INPUT, '加戏 is for games'), 400);
    }
    if (!work.game.jiaxiEnabled) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'the author closed 加戏'), 403);
    }
    const deck = jiaxiDeckForPublishedGame(work.game);
    const cards =
      body.bundle === 'run'
        ? jiaxiRunBundle(deck)
        : (() => {
            const one = resolveJiaxiCard(deck, body.cardId);
            return one ? [one] : [];
          })();
    const card = cards[0];
    if (!card) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'no 加戏 card on this run'), 400);
    }
    const list = cards.reduce(
      (sum, row) => sum + scaleJiaxiPoints(row.points, work.game.jiaxiCost),
      0,
    );
    const hostMessages = jiaxiHostMessages(cards);
    if (!jiaxiReceiptActionable(hostMessages)) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'this card has no host effect'), 400);
    }
    const priced = await db.transaction(async (tx) => {
      const scoped = tx as unknown as typeof db;
      await lockOrgCommerce(scoped, organizationId, 'jiaxi');
      const firstJiaxi = !(await hasSpentKind(scoped, organizationId, 'jiaxi'));
      const stackToday = await countJiaxiTodayOnGame(scoped, organizationId, work.game.id);
      const quote = quoteVisitorPrice({
        kind: 'jiaxi',
        list,
        firstJiaxi,
        stackToday,
      });
      const paid = await transferToAuthor(scoped, {
        fromOrgId: organizationId,
        toOrgId: work.authorOrgId,
        userId: jwt.sub,
        gameId: work.game.id,
        kind: 'jiaxi',
        points: quote.pay,
        note:
          cards.length > 1
            ? `加戏套票 ${cards.map((row) => row.label).join('+')}`
            : `加戏 ${card.label}`,
        meta: {
          cardId: card.id,
          cardIds: cards.map((row) => row.id),
          effect: card.effect,
          loopId: card.loopId,
          bundle: body.bundle === 'run' ? 'run' : undefined,
          quote,
        },
      });
      return { paid, quote, stackToday };
    });
    if (!priced.paid.ok) {
      return c.json(
        apiError(ErrorCode.QUOTA_EXCEEDED, 'not enough points', paywallDetails( priced.paid.need)),
        402,
      );
    }
    const paid = priced.paid;
    const quote = priced.quote;
    const stackToday = priced.stackToday;
    await markDailyMission(db, organizationId, 'play');
    return c.json({
      ...paid,
      card,
      cards,
      quote,
      applied: { effect: card.effect, loopId: card.loopId ?? null },
      appliedAll: cards.map((row) => ({ effect: row.effect, loopId: row.loopId ?? null })),
      hostMessages,
      bundle: body.bundle === 'run' ? 'run' : undefined,
      stackToday: stackToday + 1,
    });
  });

  authed.post('/community/games/:gameId/jiaxi/consume', async (c) => {
    const jwt = c.get('jwt');
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    const consumed = await consumeLatestJiaxi(db, {
      userId: jwt.sub,
      gameId: work.game.id,
    });
    if (!consumed.ok) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'no jiaxi receipt to consume'), 404);
    }
    return c.json(consumed);
  });

  authed.post('/community/games/:gameId/town-time', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const body = (await c.req.json().catch(() => ({}))) as { sku?: 'day' | 'week' | 'month' };
    const sku = body.sku === 'week' ? 'week' : body.sku === 'month' ? 'month' : 'day';
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    if (await isWorldVisitorBuyer(db, work, jwt.sub)) {
      return c.json(
        apiError(ErrorCode.FORBIDDEN, 'visitors only stake or tip', {
          reason: 'visitor_sku',
        }),
        403,
      );
    }
    const points = townTimeCost(sku);
    const paid = await transferToAuthor(db, {
      fromOrgId: organizationId,
      toOrgId: work.authorOrgId,
      userId: jwt.sub,
      gameId: work.game.id,
      kind: 'town_time',
      points,
      note: sku === 'month' ? '镇时月卡' : sku === 'week' ? '镇时周卡' : '镇时日卡',
      meta: { sku },
    });
    if (!paid.ok) {
      return c.json(
        apiError(ErrorCode.QUOTA_EXCEEDED, 'not enough points', paywallDetails( paid.need)),
        402,
      );
    }
    const until = await extendTownTime(db, work.worldId, townTimeMs(sku));
    if (!until) {
      await refundVisitorTransfer(db, {
        fromOrgId: organizationId,
        toOrgId: work.authorOrgId,
        gameId: work.game.id,
        kind: 'town_time',
        charged: paid.charged,
        authorPoints: paid.authorPoints,
        note: '镇时未落到心跳',
      });
      return c.json(apiError(ErrorCode.INTERNAL, 'town time did not apply'), 500);
    }
    await markDailyMission(db, organizationId, 'town');
    const [contributors, lamp, watcherCount] = await Promise.all([
      loadTownContributors(db, work.game.id),
      loadTownLamp(db, work.game.id, until),
      countSocietyWatchers(redis, work.worldId).catch(() => 0),
    ]);
    if (lamp) {
      await publishSocietyPatron(
        redis,
        work.worldId,
        societyPatronPayload({ lamp, contributors, watcherCount }),
      ).catch(() => undefined);
    }
    return c.json({
      ...paid,
      townTimeUntil: until.toISOString(),
      lamp,
      contributors,
      watcherCount,
    });
  });

  authed.post('/community/games/:gameId/world-light', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const body = (await c.req.json().catch(() => ({}))) as { sku?: string };
    const sku = parsePaidWorldLightSku(body.sku);
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    if (await isWorldVisitorBuyer(db, work, jwt.sub)) {
      return c.json(
        apiError(ErrorCode.FORBIDDEN, 'visitors only stake or tip', {
          reason: 'visitor_sku',
        }),
        403,
      );
    }
    const points = worldLightCost(sku);
    const paid = await transferToAuthor(db, {
      fromOrgId: organizationId,
      toOrgId: work.authorOrgId,
      userId: jwt.sub,
      gameId: work.game.id,
      kind: 'world_light',
      points,
      note:
        sku === 'week' ? '点亮本周' : sku === 'day' ? '点亮今日' : '点亮本小时',
      meta: { sku },
    });
    if (!paid.ok) {
      return c.json(
        apiError(ErrorCode.QUOTA_EXCEEDED, 'not enough points', paywallDetails(paid.need)),
        402,
      );
    }
    const applied = await applyWorldLightSku(db, work.worldId, sku);
    if (!applied) {
      await refundVisitorTransfer(db, {
        fromOrgId: organizationId,
        toOrgId: work.authorOrgId,
        gameId: work.game.id,
        kind: 'world_light',
        charged: paid.charged,
        authorPoints: paid.authorPoints,
        note: '点亮未落到世界',
      });
      return c.json(apiError(ErrorCode.INTERNAL, 'world light did not apply'), 500);
    }
    if (applied.hourPackBonus > 0) {
      const granted = await grantHourLightBonus(
        redis,
        work.worldId,
        applied.hourPackBonus,
      );
      if (granted <= 0) {
        await refundVisitorTransfer(db, {
          fromOrgId: organizationId,
          toOrgId: work.authorOrgId,
          gameId: work.game.id,
          kind: 'world_light',
          charged: paid.charged,
          authorPoints: paid.authorPoints,
          note: '点亮本小时未落到额度',
        });
        return c.json(apiError(ErrorCode.INTERNAL, 'world light did not apply'), 500);
      }
    }
    await markDailyMission(db, organizationId, 'town');
    const [contributors, watcherCount, talkBudget] = await Promise.all([
      loadTownContributors(db, work.game.id),
      countSocietyWatchers(redis, work.worldId).catch(() => 0),
      peekSocietyTalkBudget(
        redis,
        work.worldId,
        Date.now(),
        talkBudgetOptsFromWorld(applied),
      ),
    ]);
    const bonus =
      talkBudget?.litBonus || applied.hourPackBonus || applied.lightBonusPerHour;
    const displayName = await loadUserPublicName(db, jwt.sub).catch(() => '有人');
    await publishSocietyPatron(redis, work.worldId, {
      og: 'world-light',
      displayName,
      bonus,
      lightUntil: applied.lightUntil?.toISOString() ?? null,
      talkBudget,
      contributors,
      watcherCount,
    }).catch(() => undefined);
    return c.json({
      ...paid,
      sku,
      lightUntil: applied.lightUntil?.toISOString() ?? null,
      lightBonusPerHour: applied.lightBonusPerHour,
      talkBudget,
      contributors,
      watcherCount,
    });
  });

  authed.post('/community/games/:gameId/events', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const body = (await c.req.json().catch(() => ({}))) as { eventId?: string };
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    if (await isWorldVisitorBuyer(db, work, jwt.sub)) {
      return c.json(
        apiError(ErrorCode.FORBIDDEN, 'visitors only stake or tip', {
          reason: 'visitor_sku',
        }),
        403,
      );
    }
    if (!work.game.xiangyiEnabled) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'the author closed 巷议'), 403);
    }
    const menu = resolveEventMenu(work.game.eventMenu);
    const offer = menu.find((item) => item.id === body.eventId) ?? menu[0];
    if (!offer) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'no event on the menu'), 400);
    }
    const quote = quoteVisitorPrice({
      kind: 'event',
      list: offer.points,
      firstJiaxi: false,
    });
    const paid = await transferToAuthor(db, {
      fromOrgId: organizationId,
      toOrgId: work.authorOrgId,
      userId: jwt.sub,
      gameId: work.game.id,
      kind: 'event',
      points: quote.pay,
      note: `夜市 ${offer.label}`,
      meta: { eventId: offer.id, quote },
    });
    if (!paid.ok) {
      return c.json(
        apiError(ErrorCode.QUOTA_EXCEEDED, 'not enough points', paywallDetails( paid.need)),
        402,
      );
    }
    const [worldRow] = await db.select().from(worlds).where(eq(worlds.id, work.worldId)).limit(1);
    let injected: { simTime: number; events: unknown[]; rumor: boolean } | null = null;
    if (worldRow) {
      try {
        const live = await landTownStimulus({
          db,
          redis,
          world: worldRow,
          text: offer.stimulus,
          forceTown: true,
          importance: 14,
          courseNeutral: true,
        });
        injected = { simTime: live.simTime, events: live.events, rumor: live.rumor };
        try {
          const { scheduleSocietyReplayPublish } = await import('./societyReplayExport.js');
          scheduleSocietyReplayPublish({
            db,
            s3,
            env,
            projectId: work.projectId,
            worldId: worldRow.id,
            events: live.events,
          });
        } catch {
          /* non-fatal */
        }
      } catch (err) {
        try {
          const stamped = await stampPaidSocietyTrace({
            db,
            worldId: worldRow.id,
            specJson: worldRow.specJson,
            text: offer.stimulus,
            forceTown: true,
            importance: 14,
            courseNeutral: true,
          });
          injected = {
            simTime: stamped.simTime,
            events: stamped.events,
            rumor: stamped.rumor,
          };
        } catch {
          if (isSocietyBusyError(err) || isSocietyTickTimeoutError(err)) {
            await refundVisitorTransfer(db, {
              fromOrgId: organizationId,
              toOrgId: work.authorOrgId,
              gameId: work.game.id,
              kind: 'event',
              charged: paid.charged,
              authorPoints: paid.authorPoints,
              note: '夜市未进镇',
            });
            if (isSocietyBusyError(err)) {
              return c.json({ error: 'society busy', code: 'society_busy' }, 423);
            }
            return c.json({ error: 'society tick timeout', code: 'society_tick_timeout' }, 503);
          }
          injected = null;
        }
      }
    }
    if (!injected) {
      await refundVisitorTransfer(db, {
        fromOrgId: organizationId,
        toOrgId: work.authorOrgId,
        gameId: work.game.id,
        kind: 'event',
        charged: paid.charged,
        authorPoints: paid.authorPoints,
        note: '夜市未进镇',
      });
      return c.json(apiError(ErrorCode.INTERNAL, 'event did not land in the town'), 503);
    }
    await markDailyMission(db, organizationId, 'town');
    const hang = work.worldId
      ? await hangTownEventOnCourse(db, {
          worldId: work.worldId,
          deploymentId: work.game.deploymentId,
          userId: jwt.sub,
          eventId: offer.id,
          label: offer.label,
          stimulus: offer.stimulus,
        }).catch(() => null)
      : null;
    return c.json({ ...paid, event: offer, injected, quote, hang });
  });

  v1.get('/community/games/:gameId/residents', async (c) => {
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    return c.json(await loadCourseSeedHints(db, work.worldId));
  });

  authed.get('/community/games/:gameId/adoptions', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    return c.json({
      adoptions: await listAdoptions(db, organizationId, c.req.param('gameId')),
    });
  });

  authed.post('/community/games/:gameId/adopt', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const body = (await c.req.json().catch(() => ({}))) as {
      agentKey?: string;
    };
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || !work.worldId || work.game.category !== 'world') {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'adopt needs a living town'), 404);
    }
    if (await isWorldVisitorBuyer(db, work, jwt.sub)) {
      return c.json(
        apiError(ErrorCode.FORBIDDEN, 'visitors only stake or tip', {
          reason: 'visitor_sku',
        }),
        403,
      );
    }
    if (!work.game.xiangyiEnabled) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'the author closed 巷议'), 403);
    }
    const residents = await listTownResidents(db, work.worldId);
    const resident =
      residents.find((r) => r.key === body.agentKey) ?? residents[0];
    if (!resident) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'no resident to adopt'), 400);
    }
    let paid: Awaited<ReturnType<typeof transferToAuthor>>;
    let adopted: Awaited<ReturnType<typeof upsertAdoption>>;
    try {
      const landed = await db.transaction(async (tx) => {
        const scoped = tx as unknown as DrizzleDb;
        const transfer = await transferToAuthor(scoped, {
          fromOrgId: organizationId,
          toOrgId: work.authorOrgId,
          userId: jwt.sub,
          gameId: work.game.id,
          kind: 'adopt',
          points: COMMERCE.adopt,
          note: `认养 ${resident.name}`,
          meta: { agentKey: resident.key },
        });
        if (!transfer.ok) return { transfer, adoption: null };
        const adoption = await upsertAdoption(scoped, {
          gameId: work.game.id,
          organizationId,
          userId: jwt.sub,
          agentKey: resident.key,
          agentName: resident.name,
          points: COMMERCE.adopt,
        });
        return { transfer, adoption };
      });
      paid = landed.transfer;
      if (!landed.adoption) {
        return c.json(
          apiError(ErrorCode.QUOTA_EXCEEDED, 'not enough points', paywallDetails( paid.need)),
          402,
        );
      }
      adopted = landed.adoption;
    } catch {
      return c.json(apiError(ErrorCode.INTERNAL, 'adoption did not land'), 500);
    }
    const [worldRow] = await db.select().from(worlds).where(eq(worlds.id, work.worldId)).limit(1);
    if (worldRow) {
      try {
        await landTownStimulus({
          db,
          redis,
          world: worldRow,
          agentKey: resident.key,
          text: `${resident.name}被人认养了，从今天起多记得自己的日子。`,
          importance: 13,
          adopt: true,
          timeoutMs: 12_000,
        });
      } catch {
        try {
          await stampPaidSocietyTrace({
            db,
            worldId: worldRow.id,
            specJson: worldRow.specJson,
            agentKey: resident.key,
            text: `${resident.name}被人认养了，从今天起多记得自己的日子。`,
            importance: 13,
            adopt: true,
          });
        } catch {
          /* order stands; next tick may still miss the trace */
        }
      }
    }
    await markDailyMission(db, organizationId, 'town');
    return c.json({
      ...paid,
      agentKey: resident.key,
      agentName: resident.name,
      until: adopted.until.toISOString(),
      extended: adopted.extended,
    });
  });

  authed.post('/community/challenges/:challengeId/enter', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const challengeId = c.req.param('challengeId');
    const body = (await c.req.json().catch(() => ({}))) as { gameId?: string };
    const [challenge] = await db
      .select()
      .from(weeklyChallenges)
      .where(eq(weeklyChallenges.id, challengeId))
      .limit(1);
    if (!challenge) return c.json(apiError(ErrorCode.NOT_FOUND, 'challenge not found'), 404);
    const now = Date.now();
    if (challenge.startsAt.getTime() > now || challenge.endsAt.getTime() < now) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'challenge is not open'), 400);
    }
    if (await alreadyEnteredChallenge(db, challengeId, organizationId)) {
      return c.json({ ok: true, already: true, poolPoints: challenge.poolPoints });
    }
    const points = challenge.entryPoints > 0 ? challenge.entryPoints : COMMERCE.challengeEntry;
    const paid = await enterWeeklyChallenge(db, {
      challengeId,
      organizationId,
      userId: jwt.sub,
      communityGameId: body.gameId ?? null,
      points,
    });
    if (!paid.ok) {
      return c.json(
        apiError(ErrorCode.QUOTA_EXCEEDED, 'not enough points', paywallDetails( paid.need)),
        402,
      );
    }
    if (body.gameId) {
      await db
        .update(communityGames)
        .set({ challengeId })
        .where(eq(communityGames.id, body.gameId));
    }
    return c.json({ ok: true, poolPoints: paid.poolPoints, charged: paid.charged });
  });

  authed.post('/community/games/:gameId/sandbox', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const body = (await c.req.json().catch(() => ({}))) as {
      stimulus?: string;
      contrast?: boolean;
    };
    const stimulus = (body.stimulus ?? '').trim();
    if (stimulus.length < 2 || stimulus.length > 400) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'stimulus is 2–400 characters'), 400);
    }
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || !work.worldId || work.game.category !== 'world') {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'sandbox needs a living town'), 404);
    }
    const paid = await transferToAuthor(db, {
      fromOrgId: organizationId,
      toOrgId: work.authorOrgId,
      userId: jwt.sub,
      gameId: work.game.id,
      kind: 'sandbox',
      points: COMMERCE.sandbox,
      note: '巷议·沙盘',
      meta: { contrast: Boolean(body.contrast) },
    });
    if (!paid.ok) {
      return c.json(
        apiError(ErrorCode.QUOTA_EXCEEDED, 'not enough points', paywallDetails( paid.need)),
        402,
      );
    }
    const [worldRow] = await db.select().from(worlds).where(eq(worlds.id, work.worldId)).limit(1);
    if (worldRow) {
      try {
        await landTownStimulus({
          db,
          redis,
          world: worldRow,
          text: stimulus,
          forceTown: true,
          importance: 15,
        });
      } catch {
        try {
          await stampPaidSocietyTrace({
            db,
            worldId: worldRow.id,
            specJson: worldRow.specJson,
            text: stimulus,
            forceTown: true,
            importance: 15,
          });
        } catch {
          /* report still synthesizes from whatever the town already logged */
        }
      }
    }
    const recent = await loadRecentSocietyEvents(db, work.worldId, { limit: 80 });
    const agents = await db
      .select({ name: worldAgents.name })
      .from(worldAgents)
      .where(eq(worldAgents.worldId, work.worldId))
      .limit(8);
    const rumorCount = recent.filter((e) => e.kind === 'intervene' || e.kind === 'rumor').length;
    const talkCount = recent.filter((e) => e.kind === 'talk' || e.kind === 'converse').length;
    const report = buildSandboxReport({
      stimulus,
      contrast: Boolean(body.contrast),
      residentNames: agents.map((a) => a.name).filter(Boolean),
      rumorCount,
      talkCount,
      simHours: recent[0]?.simTime ?? 0,
    });
    let runId = '';
    try {
      runId = await recordSandboxRun(db, {
        gameId: work.game.id,
        organizationId,
        userId: jwt.sub,
        stimulus,
        contrast: Boolean(body.contrast),
        report,
        points: COMMERCE.sandbox,
      });
    } catch {
      runId = '';
    }
    if (!runId) {
      await refundVisitorTransfer(db, {
        fromOrgId: organizationId,
        toOrgId: work.authorOrgId,
        gameId: work.game.id,
        kind: 'sandbox',
        charged: paid.charged,
        authorPoints: paid.authorPoints,
        note: '沙盘未落档',
      });
      return c.json(apiError(ErrorCode.INTERNAL, 'sandbox did not record'), 500);
    }
    return c.json({ ...paid, runId, report });
  });

  authed.get('/community/games/:gameId/sandbox', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const gameId = c.req.param('gameId');
    const work = await loadPublishedWork(db, gameId);
    if (!work) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    const isAuthor = await isDeploymentMember(db, work.game.deploymentId, jwt.sub);
    const rows = await db
      .select()
      .from(sandboxRuns)
      .where(
        isAuthor
          ? eq(sandboxRuns.communityGameId, gameId)
          : and(
              eq(sandboxRuns.communityGameId, gameId),
              eq(sandboxRuns.organizationId, organizationId),
            ),
      )
      .orderBy(desc(sandboxRuns.createdAt))
      .limit(12);
    return c.json({
      runs: rows.map((r) => ({
        id: r.id,
        stimulus: r.stimulus,
        contrast: r.contrast,
        report: r.report,
        pointsPaid: r.pointsPaid,
        createdAt: r.createdAt,
      })),
    });
  });

  authed.post('/templates/:slug/apply', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const body = (await c.req.json().catch(() => ({}))) as {
      projectId?: string;
      version?: string;
    };
    const projectId = body.projectId?.trim();
    if (!projectId) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'projectId required'), 400);
    }
    const pkg = await findTemplateBySlugVersion(
      db,
      c.req.param('slug'),
      body.version,
    );
    if (!pkg || !pkg.isPublic) return c.json(apiError(ErrorCode.NOT_FOUND, 'not found'), 404);
    if (!(await assertProjectOrgMember(db, projectId, jwt.sub))) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a project member'), 403);
    }
    if (pkg.pricePoints > 0) {
      const [owned] = await db
        .select({ templateId: templateEntitlements.templateId })
        .from(templateEntitlements)
        .where(
          and(
            eq(templateEntitlements.organizationId, organizationId),
            eq(templateEntitlements.templateId, pkg.id),
          ),
        )
        .limit(1);
      if (!owned) {
        return c.json(apiError(ErrorCode.FORBIDDEN, 'buy this template first'), 403);
      }
    }
    await db.delete(projectTemplates).where(eq(projectTemplates.projectId, projectId));
    await db.insert(projectTemplates).values({
      projectId,
      templateId: pkg.id,
      appliedByUserId: jwt.sub,
    });
    await db
      .update(projects)
      .set({ templateVersion: `${pkg.slug}@${pkg.version}` })
      .where(eq(projects.id, projectId));
    await writeAudit(db, {
      action: 'template.apply',
      actorUserId: jwt.sub,
      organizationId,
      target: projectId,
      meta: { slug: pkg.slug, version: pkg.version, templateId: pkg.id },
    });
    return c.json({
      ok: true,
      projectId,
      templateId: pkg.id,
      slug: pkg.slug,
      version: pkg.version,
      takesEffectOnEmptyWorkspace: true,
    });
  });

  authed.post('/plugins/:slug/apply', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const body = (await c.req.json().catch(() => ({}))) as { projectId?: string };
    const projectId = body.projectId?.trim();
    if (!projectId) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'projectId required'), 400);
    }
    const [pkg] = await db
      .select()
      .from(pluginPackages)
      .where(eq(pluginPackages.slug, c.req.param('slug')))
      .limit(1);
    if (!pkg) return c.json(apiError(ErrorCode.NOT_FOUND, 'not found'), 404);
    if (!(await assertProjectOrgMember(db, projectId, jwt.sub))) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a project member'), 403);
    }
    if (pkg.pricePoints > 0 && pkg.organizationId !== organizationId) {
      const owned = await hasPluginEntitlement(db, organizationId, pkg.id);
      if (!owned) {
        return c.json(apiError(ErrorCode.FORBIDDEN, 'buy this plugin first'), 403);
      }
    }
    await db
      .insert(projectPlugins)
      .values({
        projectId,
        pluginId: pkg.id,
        installedByUserId: jwt.sub,
      })
      .onConflictDoNothing();
    return c.json({ ok: true, projectId, pluginId: pkg.id });
  });

  const courseLocale = (c: Context<AuthedEnv>): 'zh-CN' | 'en' =>
    (c.req.header('accept-language') ?? '').toLowerCase().startsWith('en')
      ? 'en'
      : 'zh-CN';

  const parseCourseRecommendKind = (kindRaw: string | undefined): CourseSeedKind => {
    if (
      kindRaw === 'night_market' ||
      kindRaw === 'binary' ||
      kindRaw === 'beats' ||
      kindRaw === 'talks' ||
      kindRaw === 'places' ||
      kindRaw === 'custom'
    ) {
      return kindRaw;
    }
    return 'auto';
  };

  const respondCourseRecommend = async (
    c: Context<AuthedEnv>,
    worldId: string,
    body: Pick<CourseSeedBody, 'kind' | 'agentKey' | 'prompt' | 'options'>,
  ) => {
    const preview = await previewCourseRecommend(db, {
      worldId,
      locale: courseLocale(c),
      body: {
        kind: body.kind ?? 'auto',
        ...(body.agentKey ? { agentKey: body.agentKey } : {}),
        ...(body.prompt ? { prompt: body.prompt } : {}),
        ...(body.options ? { options: body.options } : {}),
      },
    });
    if (!preview) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'cannot_preview'), 404);
    }
    return c.json(preview);
  };

  v1.get('/community/games/:gameId/course', async (c) => {
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || work.game.category !== 'world' || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    const jwt = await peekOptionalJwt(env.jwtSecret, c.req.header('authorization'));
    const board = await loadCourseBoard(db, {
      worldId: work.worldId,
      gameId: work.game.id,
      viewerOrgId: jwt?.organizationId ?? null,
      viewerUserId: jwt?.sub ?? null,
      locale: courseLocale(c),
      ensure: c.req.query('ensure') === '1',
    });
    return c.json(board);
  });

  authed.post('/community/games/:gameId/course', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || work.game.category !== 'world' || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    if (organizationId !== work.authorOrgId) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not the author'), 403);
    }
    const existing = await loadCourseBoard(db, {
      worldId: work.worldId,
      gameId: work.game.id,
      locale: courseLocale(c),
    });
    const body = (await c.req.json().catch(() => ({}))) as CourseSeedBody;
    if (existing.current && !body.replace && !body.queue && !body.cancelQueue) {
      return c.json(existing);
    }
    const seeded = await seedCourseNode(db, {
      worldId: work.worldId,
      gameId: work.game.id,
      userId: jwt.sub,
      locale: courseLocale(c),
      body,
    });
    if (!seeded.node && seeded.error) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, seeded.error ?? 'cannot_seed'), 400);
    }
    return c.json(
      await loadCourseBoard(db, {
        worldId: work.worldId,
        gameId: work.game.id,
        viewerOrgId: organizationId,
        locale: courseLocale(c),
      }),
    );
  });

  authed.post('/community/games/:gameId/course/stake', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || work.game.category !== 'world' || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      optionId?: string;
      points?: number;
      nodeId?: string;
    };
    const board = await loadCourseBoard(db, {
      worldId: work.worldId,
      gameId: work.game.id,
      viewerOrgId: organizationId,
      locale: courseLocale(c),
    });
    if (!board.current) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'no open course'), 404);
    }
    if (body.nodeId && body.nodeId !== board.current.id) {
      return c.json(apiError(ErrorCode.CONFLICT, 'that node is not current'), 409);
    }
    const points = Math.round(Number(body.points ?? COURSE.minStake));
    const landed = await stakeCourse(db, {
      nodeId: board.current.id,
      optionId: body.optionId ?? '',
      organizationId,
      userId: jwt.sub,
      authorOrgId: work.authorOrgId,
      gameId: work.game.id,
      points,
    });
    if (!landed.ok) {
      if (landed.error === 'need_points') {
        return c.json(
          apiError(ErrorCode.QUOTA_EXCEEDED, 'not enough points', paywallDetails(landed.need)),
          402,
        );
      }
      if (landed.error === 'author_forbidden') {
        return c.json(apiError(ErrorCode.FORBIDDEN, 'author_forbidden'), 403);
      }
      if (landed.error === 'closed') {
        return c.json(apiError(ErrorCode.CONFLICT, 'closed'), 409);
      }
      if (landed.error === 'side_locked') {
        return c.json(apiError(ErrorCode.CONFLICT, 'side_locked'), 409);
      }
      return c.json(apiError(ErrorCode.INVALID_INPUT, landed.error), 400);
    }
    return c.json({
      ok: true,
      balance: landed.balance,
      current: landed.board,
      history: board.history,
    });
  });

  authed.post('/community/games/:gameId/course/withdraw', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || work.game.category !== 'world' || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as { nodeId?: string };
    const board = await loadCourseBoard(db, {
      worldId: work.worldId,
      gameId: work.game.id,
      viewerOrgId: organizationId,
      locale: courseLocale(c),
    });
    if (!board.current) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'no open course'), 404);
    }
    if (body.nodeId && body.nodeId !== board.current.id) {
      return c.json(apiError(ErrorCode.CONFLICT, 'that node is not current'), 409);
    }
    const landed = await withdrawCourseStake(db, {
      nodeId: board.current.id,
      organizationId,
      gameId: work.game.id,
    });
    if (!landed.ok) {
      if (landed.error === 'closed' || landed.error === 'contested') {
        return c.json(apiError(ErrorCode.CONFLICT, landed.error), 409);
      }
      return c.json(apiError(ErrorCode.INVALID_INPUT, landed.error), 400);
    }
    return c.json({
      ok: true,
      balance: landed.balance,
      current: landed.board,
      history: board.history,
    });
  });

  authed.get('/community/games/:gameId/course/stats', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || work.game.category !== 'world' || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    if (organizationId !== work.authorOrgId) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not the author'), 403);
    }
    return c.json(await loadCourseAuthorStats(db, work.worldId));
  });

  authed.get('/community/games/:gameId/course/recommend', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || work.game.category !== 'world' || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    if (organizationId !== work.authorOrgId) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not the author'), 403);
    }
    const kindRaw = c.req.query('kind');
    const agentKey = c.req.query('agentKey')?.trim() || undefined;
    return respondCourseRecommend(c, work.worldId, {
      kind: parseCourseRecommendKind(kindRaw),
      ...(agentKey ? { agentKey } : {}),
    });
  });

  authed.post('/community/games/:gameId/course/recommend', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || work.game.category !== 'world' || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    if (organizationId !== work.authorOrgId) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not the author'), 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as CourseSeedBody;
    return respondCourseRecommend(c, work.worldId, {
      kind: parseCourseRecommendKind(body.kind),
      ...(body.agentKey ? { agentKey: body.agentKey } : {}),
      ...(body.prompt ? { prompt: body.prompt } : {}),
      ...(body.options ? { options: body.options } : {}),
    });
  });

  authed.get('/projects/:projectId/world/residents', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    if (!(await assertProjectOrgMember(db, projectId, jwt.sub))) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a project member'), 403);
    }
    const [world] = await db
      .select({ id: worlds.id })
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!world) return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    return c.json(await loadCourseSeedHints(db, world.id));
  });

  authed.get('/projects/:projectId/world/course', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    if (!(await assertProjectOrgMember(db, projectId, jwt.sub))) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a project member'), 403);
    }
    const [world] = await db
      .select({ id: worlds.id })
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!world) return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    const published = await findCommunityByProject(db, projectId);
    const organizationId = await requireOrgAccess(c);
    const viewerOrg = typeof organizationId === 'string' ? organizationId : null;
    return c.json(
      await loadCourseBoard(db, {
        worldId: world.id,
        gameId: published?.id ?? null,
        viewerOrgId: viewerOrg,
        locale: courseLocale(c),
        ensure: c.req.query('ensure') === '1',
      }),
    );
  });

  authed.post('/projects/:projectId/world/course', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    if (!(await assertProjectOrgMember(db, projectId, jwt.sub))) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a project member'), 403);
    }
    const [world] = await db
      .select({ id: worlds.id })
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!world) return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    const published = await findCommunityByProject(db, projectId);
    const body = (await c.req.json().catch(() => ({}))) as CourseSeedBody;
    const existing = await loadCourseBoard(db, {
      worldId: world.id,
      gameId: published?.id ?? null,
      locale: courseLocale(c),
    });
    if (!existing.current || body.replace || body.queue || body.cancelQueue) {
      const seeded = await seedCourseNode(db, {
        worldId: world.id,
        gameId: published?.id ?? null,
        userId: jwt.sub,
        locale: courseLocale(c),
        body,
      });
      if (!seeded.node && seeded.error) {
        return c.json(apiError(ErrorCode.INVALID_INPUT, seeded.error ?? 'cannot_seed'), 400);
      }
    }
    return c.json(
      await loadCourseBoard(db, {
        worldId: world.id,
        gameId: published?.id ?? null,
        locale: courseLocale(c),
      }),
    );
  });

  authed.get('/projects/:projectId/world/course/stats', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    if (!(await assertProjectOrgMember(db, projectId, jwt.sub))) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a project member'), 403);
    }
    const [world] = await db
      .select({ id: worlds.id })
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!world) return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    return c.json(await loadCourseAuthorStats(db, world.id));
  });

  authed.get('/projects/:projectId/world/course/recommend', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    if (!(await assertProjectOrgMember(db, projectId, jwt.sub))) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a project member'), 403);
    }
    const [world] = await db
      .select({ id: worlds.id })
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!world) return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    const kindRaw = c.req.query('kind');
    const agentKey = c.req.query('agentKey')?.trim() || undefined;
    return respondCourseRecommend(c, world.id, {
      kind: parseCourseRecommendKind(kindRaw),
      ...(agentKey ? { agentKey } : {}),
    });
  });

  authed.post('/projects/:projectId/world/course/recommend', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    if (!(await assertProjectOrgMember(db, projectId, jwt.sub))) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a project member'), 403);
    }
    const [world] = await db
      .select({ id: worlds.id })
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!world) return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    const body = (await c.req.json().catch(() => ({}))) as CourseSeedBody;
    return respondCourseRecommend(c, world.id, {
      kind: parseCourseRecommendKind(body.kind),
      ...(body.agentKey ? { agentKey: body.agentKey } : {}),
      ...(body.prompt ? { prompt: body.prompt } : {}),
      ...(body.options ? { options: body.options } : {}),
    });
  });

  v1.get('/me/course-push/vapid-public', (c) =>
    c.json({ publicKey: coursePushPublicKey() }),
  );

  authed.get('/me/course-stakes', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    return c.json({ stakes: await loadMyCourseStakes(db, organizationId) });
  });

  authed.get('/me/course-watches', async (c) => {
    const jwt = c.get('jwt');
    return c.json({ watches: await loadMyCourseWatches(db, jwt.sub, courseLocale(c)) });
  });

  authed.put('/me/course-push/subscribe', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json().catch(() => ({}))) as CoursePushSubscriptionBody;
    await upsertCoursePushSubscription(db, jwt.sub, body);
    return c.json({ ok: true });
  });

  authed.delete('/me/course-push/subscribe', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json().catch(() => ({}))) as { endpoint?: string };
    if (!body.endpoint?.trim()) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'endpoint required'), 400);
    }
    await removeCoursePushSubscription(db, jwt.sub, body.endpoint);
    return c.json({ ok: true });
  });

  authed.put('/me/course-watch/:gameId', async (c) => {
    const jwt = c.get('jwt');
    const gameId = c.req.param('gameId').trim();
    if (!gameId) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'gameId required'), 400);
    }
    const work = await loadPublishedWork(db, gameId);
    if (!work || work.game.category !== 'world') {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    await upsertCourseGameWatch(db, jwt.sub, work.game.id);
    return c.json({ ok: true, watching: true });
  });

  authed.delete('/me/course-watch/:gameId', async (c) => {
    const jwt = c.get('jwt');
    const gameId = c.req.param('gameId').trim();
    if (!gameId) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'gameId required'), 400);
    }
    const work = await loadPublishedWork(db, gameId);
    if (!work || work.game.category !== 'world') {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    await removeCourseGameWatch(db, jwt.sub, work.game.id);
    return c.json({ ok: true, watching: false });
  });
}
