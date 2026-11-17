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
import type { PlatformEnv } from './env.js';
import { signSessionJwt, verifySessionJwt, type JwtPayload } from './lib/jwt.js';
import {
  authedRateLimitSpec,
  isTightAuthedRequest,
  shouldRateLimitAnonymousV1,
} from './lib/authedPathPolicy.js';
import { resolveV1CorsOrigin } from './lib/corsOrigins.js';
import { mintSseTicket, readSseTicket } from './lib/sseTicket.js';
import {
  buildPreviewProxyUrl,
  resolveDistPrefix,
  servePreviewDistAsset,
  signPreviewDistToken,
} from './lib/previewDist.js';
import { presignGetObject, putObjectBytes } from './lib/s3.js';
import {
  assertCanEnqueueJob,
  tryChargeQueuedJob,
  refundJobPoints,
  resolveOrgQuota,
  type QuotaResult,
} from './lib/quota.js';
import { enqueuePlatformJob } from './lib/queue.js';
import {
  loadDynamicsWeights,
  saveDynamicsWeights,
} from './lib/worldDynamicsStore.js';
import {
  verifyStripeSignature,
  type StripeWebhookEvent,
} from './lib/stripe.js';
import { consumeRateLimit, mintApiKey } from './lib/apiKey.js';
import { isUserSessionRevoked } from './lib/sessionRevoke.js';
import { apiError, ErrorCode } from './lib/errorCodes.js';
import {
  buildAuthorizeUrl,
  exchangeOAuthCode,
  fetchOAuthUserInfo,
  getJsApiTicket,
  isAllowedShareUrl,
  signJsSdk,
} from './lib/wechat.js';
import {
  buildCatalog,
  newOutTradeNo,
  resolveSku,
  settleOrder,
  type ResolvedSku,
} from './lib/billing.js';
import { listCommunityGamesPage } from './lib/communityList.js';
import { subscribeSocietyFrames } from './lib/societyFanout.js';
import { assertPublishableCopy } from './lib/ugcPolicy.js';
import { handleStripeEvent } from './routes/stripeWebhook.js';
import {
  COMMERCE,
  loadPublishedWork,
  publicCommerceView,
  snapshotMechanicForPublish,
  tonightKaiCounts,
  transferToAuthor,
} from './lib/commerce.js';
import { registerKaiCommerce } from './lib/kaiCommerceRoutes.js';
import { hasSpentKind, paywallDetails, quoteVisitorPrice } from './lib/kaiMarket.js';
import { createH5Prepay, createJsapiPrepay, decryptNotify } from './lib/pay/wechatPay.js';
import {
  buildWapPayUrl,
  parseNotify as parseAlipayNotify,
  verifyNotify,
} from './lib/pay/alipay.js';
import {
  creditPoints,
  debitPoints,
  ensureWallet,
  grantPluginEntitlement,
  hasPluginEntitlement,
  listLedger,
  refreshPlanGrant,
} from './lib/wallet.js';
import {
  followAuthor,
  followCounts,
  listFollowers,
  listFollowing,
  listFollowingFeed,
  suggestedAuthors,
  unfollowAuthor,
} from './lib/social.js';
import {
  countOpenReports,
  isReportReason,
  isReportTarget,
  listReports,
  normalizeDetail,
  resolveReportsFor,
  restoreGame,
  takedownGame,
} from './lib/moderation.js';
import {
  PLAY_SESSION_TTL_SECONDS,
  issuePlaySession,
  servePlaySessionAsset,
} from './lib/playSession.js';
import { workFingerprint } from './lib/fingerprint.js';
import {
  isOriginAllowed,
  isRemixAllowed,
  normalizeLicense,
  resolveEmbedOrigins,
} from './lib/license.js';
import { buildShareMeta, ogMetaTags, renderShareCardHtml } from './lib/shareCard.js';
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
} from './lib/identity.js';
import {
  latestHeadlineForDeployment,
  listWorldActivity,
  remixParentByDeployment,
} from './lib/worldActivity.js';
import {
  MAGIC_LINK_TTL_SECONDS,
  buildMagicLinkUrl,
  isEmailish,
  normalizeEmail,
  signMagicLinkToken,
  verifyMagicLinkToken,
} from './lib/magicLink.js';
import {
  isMailerConfigured,
  magicLinkEmail,
  sendMail,
  type MailerConfig,
} from './lib/mailer.js';
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
} from './lib/societyLive.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerCommunityRoutes } from './routes/community.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerDeepSocietyRoutes } from './routes/deepSociety.js';
import { registerWorldRoutes } from './routes/world.js';
import type { V1RouteCtx } from './routes/v1Context.js';

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

export function createV1Router(deps: V1Deps): Hono<{ Variables: Variables }> {
  const { db, env, queue, s3 } = deps;
  const v1 = new Hono<{ Variables: Variables }>();

  /**
   * Turns a resolved SKU into whatever the chosen provider needs the client to
   * do next. Keeping the branch here means the order row, the ledger and the
   * settlement path stay identical across providers.
   */
  async function openProviderCheckout(params: {
    readonly provider: string;
    readonly channel: string;
    readonly resolved: ResolvedSku;
    readonly outTradeNo: string;
    readonly openid?: string | undefined;
    readonly returnUrl?: string | undefined;
    readonly clientIp: string;
  }): Promise<Record<string, unknown>> {
    if (params.provider === 'mock') {
      if (!env.allowMockPayments) throw new Error('mock payments are disabled');
      return { kind: 'mock', settleWith: 'POST /v1/billing/orders/:id/mock-pay' };
    }
    if (params.provider === 'wechat') {
      if (
        !env.wechatAppId ||
        !env.wechatPayMchId ||
        !env.wechatPayCertSerial ||
        !env.wechatPayPrivateKey ||
        !env.wechatPayApiV3Key ||
        !env.wechatPayNotifyUrl
      ) {
        throw new Error('WeChat Pay is not configured');
      }
      const cfg = {
        appId: env.wechatAppId,
        mchId: env.wechatPayMchId,
        certSerial: env.wechatPayCertSerial,
        privateKey: env.wechatPayPrivateKey,
        apiV3Key: env.wechatPayApiV3Key,
        notifyUrl: env.wechatPayNotifyUrl,
      };
      const req = {
        description: params.resolved.description,
        outTradeNo: params.outTradeNo,
        amountCents: params.resolved.cents,
        openid: params.openid,
        returnUrl: params.returnUrl,
        clientIp: params.clientIp,
      };
      const prepay =
        params.channel === 'jsapi'
          ? await createJsapiPrepay(cfg, req)
          : await createH5Prepay(cfg, req);
      return prepay as unknown as Record<string, unknown>;
    }
    if (params.provider === 'alipay') {
      if (!env.alipayAppId || !env.alipayPrivateKey || !env.alipayNotifyUrl) {
        throw new Error('Alipay is not configured');
      }
      const url = buildWapPayUrl(
        {
          appId: env.alipayAppId,
          privateKey: env.alipayPrivateKey,
          publicKey: env.alipayPublicKey ?? '',
          gateway: env.alipayGateway,
          notifyUrl: env.alipayNotifyUrl,
        },
        {
          outTradeNo: params.outTradeNo,
          subject: params.resolved.description,
          amountCents: params.resolved.cents,
          ...(params.returnUrl ? { returnUrl: params.returnUrl } : {}),
        },
      );
      return { kind: 'redirect', url };
    }
    if (params.provider === 'stripe') {
      throw new Error('stripe checkout is opened via POST /v1/billing/checkout/stripe');
    }
    throw new Error(`Unsupported payment provider ${params.provider}`);
  }

  v1.use(
    '*',
    cors({
      origin: (origin) => resolveV1CorsOrigin(origin, env),
      allowHeaders: ['Authorization', 'Content-Type', 'X-Organization-Id'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  v1.use('*', async (c, next) => {
    if (
      c.req.header('Authorization') ||
      c.req.query('sse_ticket') ||
      (env.allowDevAuth && c.req.query('access_token'))
    ) {
      await next();
      return;
    }
    if (!shouldRateLimitAnonymousV1(c.req.path)) {
      await next();
      return;
    }
    try {
      const rl = await consumeRateLimit(
        deps.redis,
        `v1pub:${clientIpOf(c)}`,
        60,
      );
      if (!rl.ok) {
        return c.json(
          apiError(ErrorCode.RATE_LIMITED, 'Too many requests. Try again shortly.'),
          429,
        );
      }
    } catch {
      /* Public alley stays up if Redis blips. */
    }
    await next();
    return;
  });

  const authed = new Hono<{ Variables: Variables }>();
  authed.use('*', async (c, next) => {
    const header = c.req.header('Authorization');
    const fromHeader = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    const sseTicket = c.req.query('sse_ticket')?.trim();
    const legacyQueryRaw = c.req.query('access_token');
    const legacyQuery =
      env.allowDevAuth && legacyQueryRaw
        ? legacyQueryRaw.replace(/^Bearer\s+/i, '').trim()
        : undefined;
    if (fromHeader) {
      try {
        c.set('jwt', await verifySessionJwt(env.jwtSecret, fromHeader));
        await next();
        return;
      } catch {
        return c.json({ error: 'invalid token' }, 401);
      }
    }
    if (sseTicket) {
      try {
        const claims = await readSseTicket(deps.redis, sseTicket);
        if (!claims) {
          return c.json({ error: 'invalid or expired sse ticket' }, 401);
        }
        c.set('jwt', {
          ...claims,
          exp: Math.floor(Date.now() / 1000) + 60,
        });
        await next();
        return;
      } catch {
        return c.json({ error: 'sse ticket store unavailable' }, 503);
      }
    }
    if (legacyQuery) {
      try {
        c.set('jwt', await verifySessionJwt(env.jwtSecret, legacyQuery));
        await next();
        return;
      } catch {
        return c.json({ error: 'invalid token' }, 401);
      }
    }
    return c.json({ error: 'missing bearer token' }, 401);
  });

  authed.use('*', async (c, next) => {
    const jwt = c.get('jwt');
    const tight = isTightAuthedRequest(c.req.method, c.req.path);
    try {
      if (await isUserSessionRevoked(deps.redis, jwt.sub)) {
        return c.json({ error: 'session revoked' }, 401);
      }
    } catch {
      if (tight) {
        return c.json(
          apiError(ErrorCode.UNAVAILABLE, 'Session store unavailable'),
          503,
        );
      }
    }
    try {
      const spec = authedRateLimitSpec(
        c.req.method,
        c.req.path,
        jwt.sub,
        clientIpOf(c),
      );
      const [userRl, ipRl] = await Promise.all([
        consumeRateLimit(deps.redis, spec.userKey, spec.userLimit),
        consumeRateLimit(deps.redis, spec.ipKey, spec.ipLimit),
      ]);
      if (!userRl.ok || !ipRl.ok) {
        const blocked = !userRl.ok ? userRl : ipRl;
        c.header('Retry-After', String(blocked.resetSeconds));
        c.header('X-RateLimit-Limit', String(blocked.limit));
        c.header('X-RateLimit-Remaining', '0');
        c.header('X-RateLimit-Reset', String(blocked.resetSeconds));
        return c.json(
          apiError(ErrorCode.RATE_LIMITED, 'Too many requests. Try again shortly.', {
            retryAfter: blocked.resetSeconds,
          }),
          429,
        );
      }
    } catch {
      if (tight) {
        return c.json(
          apiError(ErrorCode.UNAVAILABLE, 'Rate-limit store unavailable'),
          503,
        );
      }
    }
    await next();
    return;
  });

  async function optionalUserId(c: Context): Promise<string | null> {
    const header = c.req.header('Authorization');
    const token =
      header?.match(/^Bearer\s+(.+)$/i)?.[1] ??
      (env.allowDevAuth
        ? c.req.query('access_token')?.replace(/^Bearer\s+/i, '').trim()
        : undefined);
    if (!token) return null;
    try {
      return (await verifySessionJwt(env.jwtSecret, token)).sub;
    } catch {
      return null;
    }
  }

  /**
   * Resolves the org this request is acting for and proves membership.
   * Returns the id, or the `Response` the caller should return as-is.
   */
  async function requireOrgAccess(
    c: Context<{ Variables: Variables }>,
  ): Promise<string | Response> {
    const jwt = c.get('jwt');
    const orgId = resolveOrganizationId(
      c.req.query('organizationId') ?? c.req.header('X-Organization-Id'),
      jwt.organizationId,
    );
    if (!isOrganizationUuid(orgId)) {
      return c.json({ error: 'invalid organization id' }, 400);
    }
    const [mem] = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, jwt.sub),
        ),
      )
      .limit(1);
    if (!mem) return c.json({ error: 'forbidden' }, 403);
    return orgId;
  }

  const ctx: V1RouteCtx = {
    db,
    env,
    queue,
    s3,
    redis: deps.redis,
    requireOrgAccess,
    optionalUserId,
    openProviderCheckout,
  };

  registerAuthRoutes(v1, authed, ctx);
  registerBillingRoutes(v1, authed, ctx);
  registerProjectRoutes(v1, authed, ctx);
  registerWorldRoutes(v1, authed, ctx);
  registerDeepSocietyRoutes(authed, ctx.db);
  registerJobRoutes(v1, authed, ctx);
  registerCommunityRoutes(v1, authed, ctx);
  registerPublicRoutes(v1, authed, ctx);

  v1.get('/preview-dist/:deploymentId/:token/:path{.+}', async (c) => {
    const deploymentId = c.req.param('deploymentId');
    const token = c.req.param('token');
    const objectPath = c.req.param('path');
    return servePreviewDistAsset(db, s3, env, deploymentId, token, objectPath);
  });
  v1.get('/preview-dist/:deploymentId/:token', async (c) => {
    const deploymentId = c.req.param('deploymentId');
    const token = c.req.param('token');
    return servePreviewDistAsset(db, s3, env, deploymentId, token, 'index.html');
  });

  /**
   * Hosted play surface. Everything a published work loads is served through
   * here under a signed, expiring session, so there is no durable URL to the
   * build for anyone to mirror.
   */
  v1.get('/play/:token/:path{.+}', async (c) =>
    servePlaySessionAsset({
      db,
      s3,
      env,
      token: c.req.param('token'),
      relPath: c.req.param('path'),
      userAgent: c.req.header('user-agent'),
    }),
  );
  v1.get('/play/:token', async (c) =>
    servePlaySessionAsset({
      db,
      s3,
      env,
      token: c.req.param('token'),
      relPath: 'index.html',
      userAgent: c.req.header('user-agent'),
    }),
  );

  registerKaiCommerce({
    v1,
    authed,
    db,
    env,
    s3,
    redis: deps.redis,
    requireOrgAccess,
  });

  v1.route('/', authed);

  return v1;
}

