/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** Query/body may send `organizationId=` (empty); `??` does not replace `''`, which breaks UUID columns. */

import { randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, gt, gte, inArray, lt, lte, ne, or, sql, sum, isNull, avg } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { S3Client } from '@aws-sdk/client-s3';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import type { DrizzleDb } from '@opengame/platform-db';
import { resolveJobLogS3ObjectKey } from '@opengame/platform-shared';
import {
  achievements,
  agentEvents,
  apiKeys,
  artifacts,
  assets,
  benchRuns,
  playerSaves,
  pluginEntitlements,
  pluginPackages,
  pluginVersions,
  projectRemixes,
  chatMessages,
  chatSessions,
  commentLikes,
  communityGames,
  contentReports,
  deployments,
  gameComments,
  gameLeaderboards,
  gameRatings,
  gameTags,
  gameTagMappings,
  jobs,
  orders,
  organizationMembers,
  organizations,
  projectMembers,
  projectPlugins,
  projects,
  projectBriefs,
  projectMemories,
  jobFeedback,
  ragDocumentChunks,
  subscriptions,
  templateEntitlements,
  templatePackages,
  weeklyChallenges,
  usageEvents,
  userFollowedGames,
  userFollows,
  users,
  worlds,
  worldWhispers,
  worldRevisions,
  simCheckpoints,
  societyEvents,
  worldAgents,
  agentMemories,
  agentPlans,
  agentRelations,
  persistSocietyState,
  invalidateSocietyEventsFrom,
  loadSocietyMemoriesBefore,
  loadSocietyReplayBundle,
  loadSocietyRelations,
  loadSocietyAgents,
  loadSocietyPlans,
  persistEmergenceReport,
  loadEmergenceReport,
  deleteSocietyMemoriesFrom,
  loadAgentPosesBefore,
  loadRecentSocietyEvents,
  loadObjectTip,
  loadLatestObjectStateEvents,
} from '@opengame/platform-db';
import { ingestCommunityGame, queryCommunityTemplateHints } from '@opengame/platform-rag';
import { applyWorldOp } from '@opengame/world-ops';
import { parseWorldSpec, summarizeWorldSpec, toGameplayManifest, toL2PresentationManifest, toL3PresentationManifest, diffWorldSpecs, gatheringSeedText, gatheringInvitationText, evaluateEmergenceGate, resolveGenreProfile } from '@opengame/world-spec';
import { WorldSimulator } from '@opengame/world-sim';
import { resolveSpatialBackend } from '@opengame/world-runtime';
import {
  HybridWorldModel,
  collectTrajectories,
  trainMlp,
} from '@opengame/world-neural';
import {
  buildEmergenceReportCard,
  createMemoryEntry,
  overlayPersistedSociety,
  lastConverseAtFromEvents,
  runSocietyHours,
  societyStateFromSpec,
  truncateEventsAfter,
  whisperMemory,
  societyCopyAscii,
  type SocietyEvent,
} from '@opengame/world-agents';
import type { PlatformEnv } from '../env.js';
import { signSessionJwt, verifySessionJwt, type JwtPayload } from '../lib/jwt.js';
import { mintSseTicket, readSseTicket } from '../lib/sseTicket.js';
import {
  buildPreviewProxyUrl,
  resolveDistPrefix,
  servePreviewDistAsset,
  signPreviewDistToken,
} from '../lib/previewDist.js';
import { presignGetObject, putObjectBytes } from '../lib/s3.js';
import {
  assertCanEnqueueJob,
  tryChargeQueuedJob,
  refundJobPoints,
  resolveOrgQuota,
  type QuotaResult,
} from '../lib/quota.js';
import { enqueuePlatformJob } from '../lib/queue.js';
import {
  loadDynamicsWeights,
  saveDynamicsWeights,
} from '../lib/worldDynamicsStore.js';
import {
  verifyStripeSignature,
  type StripeWebhookEvent,
} from '../lib/stripe.js';
import { mintApiKey } from '../lib/apiKey.js';
import { apiError, ErrorCode } from '../lib/errorCodes.js';
import {
  buildAuthorizeUrl,
  exchangeOAuthCode,
  fetchOAuthUserInfo,
  getJsApiTicket,
  isAllowedShareUrl,
  signJsSdk,
} from '../lib/wechat.js';
import {
  buildCatalog,
  newOutTradeNo,
  resolveSku,
  settleOrder,
  type ResolvedSku,
} from '../lib/billing.js';
import {
  createStripeCheckoutSession,
  retrieveStripeCheckoutSession,
  stripeCheckoutFields,
  StripeStorefrontUnavailable,
} from '../lib/stripeCheckout.js';
import { readPayNotify } from '../lib/payNotifyStore.js';
import { listCommunityGamesPage } from '../lib/communityList.js';
import { subscribeSocietyFrames } from '../lib/societyFanout.js';
import { assertPublishableCopy } from '../lib/ugcPolicy.js';
import { handleStripeEvent } from './stripeWebhook.js';
import {
  COMMERCE,
  loadPublishedWork,
  publicCommerceView,
  snapshotMechanicForPublish,
  tonightKaiCounts,
  transferToAuthor,
} from '../lib/commerce.js';
import { registerKaiCommerce } from '../lib/kaiCommerceRoutes.js';
import { hasSpentKind, paywallDetails, quoteVisitorPrice } from '../lib/kaiMarket.js';
import { createH5Prepay, createJsapiPrepay, decryptNotify } from '../lib/pay/wechatPay.js';
import {
  buildWapPayUrl,
  parseNotify as parseAlipayNotify,
  verifyNotify,
} from '../lib/pay/alipay.js';
import {
  creditPoints,
  debitPoints,
  ensureWallet,
  grantPluginEntitlement,
  hasPluginEntitlement,
  listLedger,
  refreshPlanGrant,
} from '../lib/wallet.js';
import {
  followAuthor,
  followCounts,
  listFollowers,
  listFollowing,
  listFollowingFeed,
  suggestedAuthors,
  unfollowAuthor,
} from '../lib/social.js';
import {
  countOpenReports,
  isReportReason,
  isReportTarget,
  listReports,
  normalizeDetail,
  resolveReportsFor,
  restoreGame,
  takedownGame,
} from '../lib/moderation.js';
import {
  PLAY_SESSION_TTL_SECONDS,
  issuePlaySession,
  servePlaySessionAsset,
} from '../lib/playSession.js';
import { workFingerprint } from '../lib/fingerprint.js';
import {
  isOriginAllowed,
  isRemixAllowed,
  normalizeLicense,
  resolveEmbedOrigins,
} from '../lib/license.js';
import {
  authorForDeployment,
  ensureUserWithPersonalOrg,
  ensureUserWithPhone,
  ensureUserWithWeChat,
  isValidCnPhone,
  normalizePhone,
  isDeploymentMember,
  isPlatformAdmin,
  isValidHandle,
  listMyWorks,
  listPlayHistory,
  normalizeHandle,
  publicAuthorOf,
  publicProfileByHandle,
  recordPlay,
  worldStatusByDeployment,
} from '../lib/identity.js';
import {
  latestHeadlineForDeployment,
  listWorldActivity,
  remixParentByDeployment,
} from '../lib/worldActivity.js';
import {
  MAGIC_LINK_TTL_SECONDS,
  buildMagicLinkUrl,
  isEmailish,
  normalizeEmail,
  signMagicLinkToken,
  verifyMagicLinkToken,
} from '../lib/magicLink.js';
import {
  isMailerConfigured,
  magicLinkEmail,
  sendMail,
  type MailerConfig,
} from '../lib/mailer.js';
import {
  continueSocietyHours,
  interviewSocietyAgent,
  isSocietyBusyError,
  isSocietyTickTimeoutError,
  objectSnapshotFromSpec,
  annotateAgentsWithAreas,
  stampSocietyPlansFromSpec,
  slimSocietyEventPayload,
  mergePinnedSocietyEvents,
  societyDtHours,
  tickSocietyOnce,
  whisperSocietyLive,
  setObjectSocietyLive,
  withSocietyWorldLock,
  scheduleSocietyTalkTail,
} from '../lib/societyLive.js';
import type { V1RouteCtx } from './v1Context.js';

function resolveOrganizationId(
  fromClient: string | undefined | null,
  jwtOrganizationId: string,
): string {
  if (typeof fromClient !== 'string') {
    return jwtOrganizationId;
  }
  const trimmed = fromClient.trim();
  return trimmed.length > 0 ? trimmed : jwtOrganizationId;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Referer is attacker-controlled; only ever stored, never trusted for access. */
function originOfHeader(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function isOrganizationUuid(value: string): boolean {
  return UUID_RE.test(value);
}

type Variables = { jwt: JwtPayload };

/**
 * WeChat Pay H5 requires the payer's address, and it is the only place we use
 * it. Trust the proxy headers our own ingress sets, then the socket.
 */
function clientIpOf(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || c.req.header('x-real-ip') || '127.0.0.1';
}

/**
 * One shape for every "you cannot queue this" answer. The client needs to tell
 * a rate limit ("wait") from an empty wallet ("top up"), so the point shortfall
 * travels in the details rather than only in the message.
 */
function quotaDenied(
  c: Context,
  quota: Extract<QuotaResult, { ok: false }>,
): Response {
  return c.json(
    apiError(ErrorCode.QUOTA_EXCEEDED, quota.reason, {
      plan: quota.plan,
      ...(quota.needPoints === undefined
        ? {}
        : {
            ...paywallDetails(quota.needPoints),
            balance: quota.balance ?? 0,
          }),
    }),
    429,
  );
}

export type V1Deps = {
  readonly db: DrizzleDb;
  readonly env: PlatformEnv;
  readonly queue: Queue;
  readonly s3: S3Client;
  readonly redis: Redis;
};

export function registerBillingRoutes(
  v1: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  authed: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  ctx: V1RouteCtx,
): void {
  const { db, env, queue, s3 } = ctx;
  const deps = { redis: ctx.redis };
  const requireOrgAccess = ctx.requireOrgAccess;
  const optionalUserId = ctx.optionalUserId;
  const openProviderCheckout = ctx.openProviderCheckout;

  authed.get('/billing/wallet', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    await refreshPlanGrant(db, env, organizationId);
    const [wallet, quota, entries] = await Promise.all([
      ensureWallet(db, organizationId),
      resolveOrgQuota(db, env, organizationId),
      listLedger(db, organizationId, 30),
    ]);
    return c.json({
      organizationId,
      userId: jwt.sub,
      balance: wallet.balance,
      lifetimeEarned: wallet.lifetimeEarned,
      lifetimeSpent: wallet.lifetimeSpent,
      welcomeGranted: wallet.welcomeGranted,
      loginStreak: wallet.loginStreak,
      plan: quota.plan,
      dailyJobLimit: quota.dailyJobLimit,
      maxConcurrentJobs: quota.maxConcurrent,
      enforced: env.billingEnforcePoints,
      jobCosts: env.jobPointCosts,
      commerce: buildCatalog(env).commerce,
      market: await (async () => {
        const { claimDailyLogin, authorTonightBreakdown, activeCampaigns, hasSpentKind, MARKET } =
          await import('../lib/kaiMarket.js');
        const [daily, tonight] = await Promise.all([
          claimDailyLogin(db, organizationId),
          authorTonightBreakdown(db, organizationId),
        ]);
        return {
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
          firstJiaxi: !(await hasSpentKind(db, organizationId, 'jiaxi')),
          firstXiangyi: !(await hasSpentKind(db, organizationId, 'xiangyi')),
          firstTopupAvailable: !wallet.firstTopupGranted,
          welcomeJustGranted: daily.welcomeJustGranted,
          loginStreak: daily.streak,
          welcomePoints: MARKET.welcome,
        };
      })(),
      entries: entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        points: e.points,
        balanceAfter: e.balanceAfter,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  });

  authed.get('/billing/plans', (c) => {
    const planIds = new Set([
      'free',
      ...Object.keys(env.planDailyJobLimits),
      ...Object.keys(env.planMaxConcurrentJobs),
    ]);
    const plans = Array.from(planIds).map((plan) => ({
      id: plan,
      dailyJobs: env.planDailyJobLimits[plan] ?? env.dailyJobLimitPerOrg,
      maxConcurrent: env.planMaxConcurrentJobs[plan] ?? env.maxConcurrentJobsPerOrg,
    }));
    return c.json({ plans });
  });

  /** Effective quota for the caller's org (resolves plan + overrides). */
  authed.get('/billing/quota', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    await refreshPlanGrant(db, env, organizationId);
    const quota = await resolveOrgQuota(db, env, organizationId);
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, organizationId))
      .limit(1);
    return c.json({
      organizationId,
      plan: quota.plan,
      dailyJobLimit: quota.dailyJobLimit,
      maxConcurrentJobs: quota.maxConcurrent,
      subscription: sub
        ? {
            stripeCustomerId: sub.stripeCustomerId,
            stripeSubscriptionId: sub.stripeSubscriptionId,
            stripePriceId: sub.stripePriceId,
            status: sub.status,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            currentPeriodEnd: sub.currentPeriodEnd,
          }
        : null,
    });
  });

  /**
   * Records a pre-linked Stripe customer id for the caller's org.
   */
  authed.post('/billing/link', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const body = (await c.req.json().catch(() => ({}))) as {
      stripeCustomerId?: string;
    };
    const customerId = body.stripeCustomerId?.trim();
    if (!customerId) {
      return c.json({ error: 'stripeCustomerId required' }, 400);
    }
    await db
      .insert(subscriptions)
      .values({
        organizationId,
        stripeCustomerId: customerId,
        plan: 'free',
        status: 'active',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: subscriptions.organizationId,
        set: { stripeCustomerId: customerId, updatedAt: new Date() },
      });
    return c.json({ ok: true });
  });

  /**
   * Opens a checkout. The response shape depends on the channel: JSAPI hands
   * back parameters for `WeixinJSBridge`, everything else hands back a URL to
   * send the browser to.
   */
  authed.post('/billing/orders', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const body = (await c.req.json().catch(() => ({}))) as {
      sku?: string;
      provider?: string;
      channel?: string;
      openid?: string;
      returnUrl?: string;
    };
    const sku = body.sku?.trim();
    if (!sku) return c.json(apiError(ErrorCode.INVALID_INPUT, 'sku is required'), 400);
    const resolved = resolveSku(env, sku);
    if (!resolved) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, `Unknown sku ${sku}`), 400);
    }
    const provider = body.provider ?? 'wechat';
    const channel = body.channel ?? (provider === 'wechat' ? 'jsapi' : 'wap');
    const outTradeNo = newOutTradeNo();

    const [order] = await db
      .insert(orders)
      .values({
        organizationId,
        userId: jwt.sub,
        provider,
        channel,
        outTradeNo,
        sku,
        kind: resolved.kind,
        amountCents: resolved.cents,
        points: resolved.points,
        plan: resolved.plan,
      })
      .returning();
    if (!order) return c.json({ error: 'failed to open order' }, 500);

    try {
      const origin =
        env.webBaseUrl?.replace(/\/$/, '') ||
        env.publicBaseUrl?.replace(/\/$/, '') ||
        '';
      const prepay =
        provider === 'stripe'
          ? await (async () => {
              if (!env.stripeApiKey) {
                throw new StripeStorefrontUnavailable();
              }
              const session = await createStripeCheckoutSession(
                {
                  apiKey: env.stripeApiKey,
                  successUrl: `${origin}/wallet?cs={CHECKOUT_SESSION_ID}`,
                  cancelUrl: `${origin}/wallet?checkout=cancel`,
                },
                stripeCheckoutFields({
                  sku,
                  resolved,
                  organizationId,
                  userId: jwt.sub,
                  outTradeNo,
                  successUrl: `${origin}/wallet?cs={CHECKOUT_SESSION_ID}`,
                  cancelUrl: `${origin}/wallet?checkout=cancel`,
                }),
              );
              return { kind: 'redirect' as const, url: session.url, sessionId: session.id };
            })()
          : await openProviderCheckout({
              provider,
              channel,
              resolved,
              outTradeNo,
              openid: body.openid,
              returnUrl: body.returnUrl,
              clientIp: clientIpOf(c),
            });
      await db
        .update(orders)
        .set({ prepay, updatedAt: new Date() })
        .where(eq(orders.id, order.id));
      return c.json({
        orderId: order.id,
        outTradeNo,
        amountCents: resolved.cents,
        points: resolved.points,
        plan: resolved.plan,
        provider,
        channel,
        prepay,
      });
    } catch (err) {
      await db
        .update(orders)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(orders.id, order.id));
      console.error('checkout', err);
      return c.json(
        apiError(
          ErrorCode.INTERNAL,
          err instanceof Error ? err.message : 'could not open checkout',
        ),
        502,
      );
    }
  });

  /**
   * Overseas storefront. Same order row as WeChat/Alipay; Stripe keys stay in env.
   */
  authed.post('/billing/checkout/stripe', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    if (!env.stripeApiKey) {
      return c.json(
        apiError(ErrorCode.UNAVAILABLE, 'Stripe Checkout is not configured'),
        503,
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as { sku?: string };
    const sku = body.sku?.trim();
    if (!sku) return c.json(apiError(ErrorCode.INVALID_INPUT, 'sku is required'), 400);
    const resolved = resolveSku(env, sku);
    if (!resolved) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, `Unknown sku ${sku}`), 400);
    }
    const origin =
      env.webBaseUrl?.replace(/\/$/, '') ||
      env.publicBaseUrl?.replace(/\/$/, '') ||
      '';
    const outTradeNo = newOutTradeNo();
    const [order] = await db
      .insert(orders)
      .values({
        organizationId,
        userId: jwt.sub,
        provider: 'stripe',
        channel: 'hosted',
        outTradeNo,
        sku,
        kind: resolved.kind,
        amountCents: resolved.cents,
        points: resolved.points,
        plan: resolved.plan,
      })
      .returning();
    if (!order) return c.json({ error: 'failed to open order' }, 500);
    try {
      const session = await createStripeCheckoutSession(
        {
          apiKey: env.stripeApiKey,
          successUrl: `${origin}/wallet?cs={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${origin}/wallet?checkout=cancel`,
        },
        stripeCheckoutFields({
          sku,
          resolved,
          organizationId,
          userId: jwt.sub,
          outTradeNo,
          successUrl: `${origin}/wallet?cs={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${origin}/wallet?checkout=cancel`,
        }),
      );
      const prepay = { kind: 'redirect', url: session.url, sessionId: session.id };
      await db
        .update(orders)
        .set({ prepay, updatedAt: new Date() })
        .where(eq(orders.id, order.id));
      return c.json({
        orderId: order.id,
        outTradeNo,
        amountCents: resolved.cents,
        points: resolved.points,
        plan: resolved.plan,
        provider: 'stripe',
        channel: 'hosted',
        prepay,
      });
    } catch (err) {
      await db
        .update(orders)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(orders.id, order.id));
      return c.json(
        apiError(
          ErrorCode.UNAVAILABLE,
          err instanceof Error ? err.message : 'Stripe Checkout failed',
        ),
        503,
      );
    }
  });

  /** Wallet return `?cs=` — retrieve the session and settle if Stripe already marked it paid. */
  authed.get('/billing/checkout/stripe', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    if (!env.stripeApiKey) {
      return c.json(
        apiError(ErrorCode.UNAVAILABLE, 'Stripe Checkout is not configured'),
        503,
      );
    }
    const cs = (c.req.query('cs') ?? '').trim();
    if (!cs) return c.json(apiError(ErrorCode.INVALID_INPUT, 'cs required'), 400);
    try {
      const session = await retrieveStripeCheckoutSession(env.stripeApiKey, cs);
      if (!session.outTradeNo || session.paymentStatus === 'unpaid') {
        return c.json({
          status: session.paymentStatus,
          orderId: null,
        });
      }
      const settled = await settleOrder(db, env, {
        outTradeNo: session.outTradeNo,
        transactionId: session.id,
        amountCents: session.amountTotal,
        raw: session,
      });
      return c.json({
        status: settled.status,
        orderId: settled.orderId ?? null,
      });
    } catch (err) {
      return c.json(
        apiError(
          ErrorCode.UNAVAILABLE,
          err instanceof Error ? err.message : 'Stripe session lookup failed',
        ),
        503,
      );
    }
  });

  /** The client polls this after returning from the cashier. */
  authed.get('/billing/orders/:orderId', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const [order] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, c.req.param('orderId')),
          eq(orders.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!order) return c.json({ error: 'not found' }, 404);
    return c.json({
      orderId: order.id,
      status: order.status,
      sku: order.sku,
      points: order.points,
      plan: order.plan,
      amountCents: order.amountCents,
      paidAt: order.paidAt?.toISOString() ?? null,
    });
  });

  /**
   * Dev-only settlement so the checkout flow can be exercised without a
   * merchant account. Gated on dev auth as well as its own flag — it mints
   * money, so it must be impossible to leave on by accident in production.
   */
  authed.post('/billing/orders/:orderId/mock-pay', async (c) => {
    if (!env.allowMockPayments) return c.json({ error: 'not enabled' }, 403);
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const [order] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, c.req.param('orderId')),
          eq(orders.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!order) return c.json({ error: 'not found' }, 404);
    const result = await settleOrder(db, env, {
      outTradeNo: order.outTradeNo,
      transactionId: `mock_${order.outTradeNo}`,
      amountCents: order.amountCents,
      raw: { mock: true },
    });
    return c.json({ status: result.status });
  });

  /**
   * Replay a stored WeChat/Alipay notify when the cashier returned but the
   * credit did not land. Does not invent a payment — no stored notify means
   * still pending.
   */
  authed.post('/billing/orders/:orderId/reconcile', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const [order] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, c.req.param('orderId')),
          eq(orders.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!order) return c.json({ error: 'not found' }, 404);
    if (order.status === 'paid') {
      return c.json({ status: 'already-paid', orderId: order.id });
    }
    const stored = await readPayNotify(ctx.redis, order.outTradeNo);
    if (!stored) {
      return c.json(
        {
          status: 'pending',
          hint: 'wait for wechat/alipay notify, then retry reconcile',
          orderId: order.id,
        },
        409,
      );
    }
    const result = await settleOrder(db, env, stored);
    return c.json({ status: result.status, orderId: result.orderId ?? order.id });
  });

}

