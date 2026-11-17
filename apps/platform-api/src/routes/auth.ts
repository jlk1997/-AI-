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
  AccountClosedError,
} from '../lib/identity.js';
import {
  consumeMagicRequestLimit,
  hashEmailForLog,
} from '../lib/magicAbuse.js';
import {
  closeAccount,
  exportAccountBundle,
  loadLegalProfile,
  recordLegalAcceptance,
} from '../lib/accountPrivacy.js';
import { revokeUserSessions } from '../lib/sessionRevoke.js';
import { fileContentAppeal, listAuthorAppeals } from '../lib/contentAppeals.js';
import {
  latestHeadlineForDeployment,
  listWorldActivity,
  remixParentByDeployment,
} from '../lib/worldActivity.js';
import {
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
} from '../lib/mailer.js';
import { authMethodFlags, devTokenAllowed, mailerFromAuthEnv } from '../lib/authMethods.js';
import { requestEmailCode, verifyEmailCode } from '../lib/emailOtp.js';
import { listAuthEvents, recordAuthEvent } from '../lib/authEvents.js';
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

export function registerAuthRoutes(
  v1: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  authed: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  ctx: V1RouteCtx,
): void {
  const { db, env, queue, s3 } = ctx;
  const deps = { redis: ctx.redis };
  const requireOrgAccess = ctx.requireOrgAccess;
  const optionalUserId = ctx.optionalUserId;
  const openProviderCheckout = ctx.openProviderCheckout;

  v1.post('/auth/dev-token', async (c) => {
    if (!devTokenAllowed(env)) {
      return c.json({ error: 'Dev auth disabled' }, 403);
    }
    const body = (await c.req.json()) as { email?: string };
    const email = body.email?.trim();
    if (!email) {
      return c.json({ error: 'email required' }, 400);
    }
    const { userId, organizationId } = await ensureUserWithPersonalOrg(db, email);
    const token = await signSessionJwt(
      env.jwtSecret,
      { sub: userId, email, organizationId },
      60 * 60 * 24 * 14,
    );
    return c.json({ token, userId, organizationId });
  });

  /**
   * Magic link, step 1. Deliberately always answers `ok` so the endpoint can't
   * be used to enumerate which addresses have accounts. Without a mail service
   * configured we hand the link back (self-host) and log it (operator).
   */
  v1.post('/auth/magic/request', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string };
    const raw = typeof body.email === 'string' ? body.email : '';
    if (!isEmailish(raw)) {
      return c.json(
        apiError(ErrorCode.INVALID_INPUT, 'A valid email is required'),
        400,
      );
    }
    const email = normalizeEmail(raw);
    if (env.authWechatOnly && !env.allowDevAuth) {
      return c.json(
        apiError(ErrorCode.UNAVAILABLE, 'Sign in with WeChat on this deployment'),
        503,
      );
    }

    try {
      const limited = await consumeMagicRequestLimit(deps.redis, {
        email,
        ip: clientIpOf(c),
      });
      if (!limited.ok) {
        return c.json(
          apiError(
            ErrorCode.RATE_LIMITED,
            'Too many sign-in links requested. Try again later.',
          ),
          429,
        );
      }
    } catch {
      return c.json(
        apiError(ErrorCode.UNAVAILABLE, 'Sign-in store unavailable'),
        503,
      );
    }

    const minted = await signMagicLinkToken(env.jwtSecret, email);
    const link = buildMagicLinkUrl(env.webBaseUrl, minted.token);
    const minutes = Math.max(1, Math.round(minted.expiresInSeconds / 60));

    const mailer = mailerFromAuthEnv(env);
    let delivery: 'email' | 'echo' | 'server-log' | 'failed' = 'server-log';
    if (isMailerConfigured(mailer)) {
      const result = await sendMail(mailer, { ...magicLinkEmail(link, minutes), to: email });
      if (result.delivered) {
        delivery = 'email';
      } else {
        delivery = env.magicLinkEcho ? 'echo' : 'failed';
      }
    } else if (env.magicLinkEcho) {
      delivery = 'echo';
    } else {
      delivery = env.allowDevAuth ? 'server-log' : 'failed';
    }
    console.info(
      `[auth] magic hash=${hashEmailForLog(email)} delivery=${delivery === 'echo' ? 'echo' : delivery}`,
    );
    if (delivery === 'failed') {
      return c.json(
        apiError(
          ErrorCode.UNAVAILABLE,
          'Sign-in mail is down. Try WeChat or try again shortly.',
        ),
        503,
      );
    }

    return c.json({
      ok: true,
      expiresInSeconds: minted.expiresInSeconds,
      link: delivery === 'echo' ? link : null,
      delivery: delivery === 'server-log' ? 'server-log' : delivery === 'echo' ? 'echo' : 'email',
    });
  });

  /** Magic link, step 2: burn the token, mint the session. */
  v1.post('/auth/magic/verify', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: string };
    const linkToken = typeof body.token === 'string' ? body.token.trim() : '';
    if (!linkToken) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'token required'), 400);
    }
    let claims: Awaited<ReturnType<typeof verifyMagicLinkToken>>;
    try {
      claims = await verifyMagicLinkToken(env.jwtSecret, linkToken);
    } catch {
      return c.json(
        apiError(ErrorCode.UNAUTHORIZED, 'This link is invalid or expired'),
        401,
      );
    }
    // Single use. NX makes the first click the only one that works.
    try {
      const ttl = Math.max(60, claims.exp - Math.floor(Date.now() / 1000));
      const claimed = await deps.redis.set(
        `magic:used:${claims.jti}`,
        '1',
        'EX',
        ttl,
        'NX',
      );
      if (claimed === null) {
        return c.json(
          apiError(ErrorCode.UNAUTHORIZED, 'This link was already used'),
          401,
        );
      }
    } catch {
      if (!env.allowDevAuth) {
        return c.json(
          apiError(ErrorCode.UNAVAILABLE, 'Sign-in store unavailable'),
          503,
        );
      }
      // Dev only: fall back to expiry-only protection when Redis is down.
    }
    let session: Awaited<ReturnType<typeof ensureUserWithPersonalOrg>>;
    try {
      session = await ensureUserWithPersonalOrg(db, claims.email);
    } catch (err) {
      if (err instanceof AccountClosedError) {
        return c.json(apiError(ErrorCode.FORBIDDEN, err.message), 403);
      }
      throw err;
    }
    const { userId, organizationId } = session;
    const token = await signSessionJwt(
      env.jwtSecret,
      { sub: userId, email: claims.email, organizationId },
      60 * 60 * 24 * 14,
    );
    await recordAuthEvent(db, {
      userId,
      method: 'magic',
      ip: clientIpOf(c),
      userAgent: c.req.header('user-agent') ?? null,
    });
    return c.json({ token, userId, organizationId });
  });

  v1.post('/auth/email/request', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string };
    const raw = typeof body.email === 'string' ? body.email : '';
    if (!isEmailish(raw)) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'A valid email is required'), 400);
    }
    const email = normalizeEmail(raw);
    const result = await requestEmailCode({
      redis: deps.redis,
      email,
      ip: clientIpOf(c),
      mailer: mailerFromAuthEnv(env),
      echo: env.emailOtpEcho,
    });
    if (!result.ok) {
      const errorCode =
        result.status === 429 ? ErrorCode.RATE_LIMITED : ErrorCode.UNAVAILABLE;
      return c.json(apiError(errorCode, result.message), result.status);
    }
    console.info(
      `[auth] email-code hash=${hashEmailForLog(email)} delivery=${result.delivery}`,
    );
    return c.json({
      ok: true,
      expiresInSeconds: result.expiresInSeconds,
      code: result.code,
      delivery: result.delivery,
    });
  });

  v1.post('/auth/email/verify', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string };
    const raw = typeof body.email === 'string' ? body.email : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!isEmailish(raw)) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'A valid email is required'), 400);
    }
    const email = normalizeEmail(raw);
    const checked = await verifyEmailCode({
      redis: deps.redis,
      email,
      code,
      ip: clientIpOf(c),
    });
    if (!checked.ok) {
      const errorCode =
        checked.status === 429
          ? ErrorCode.RATE_LIMITED
          : checked.status === 401
            ? ErrorCode.UNAUTHORIZED
            : checked.status === 400
              ? ErrorCode.INVALID_INPUT
              : ErrorCode.UNAVAILABLE;
      return c.json(apiError(errorCode, checked.message), checked.status);
    }
    let session: Awaited<ReturnType<typeof ensureUserWithPersonalOrg>>;
    try {
      session = await ensureUserWithPersonalOrg(db, checked.email);
    } catch (err) {
      if (err instanceof AccountClosedError) {
        return c.json(apiError(ErrorCode.FORBIDDEN, err.message), 403);
      }
      throw err;
    }
    const token = await signSessionJwt(
      env.jwtSecret,
      { sub: session.userId, email: checked.email, organizationId: session.organizationId },
      60 * 60 * 24 * 14,
    );
    await recordAuthEvent(db, {
      userId: session.userId,
      method: 'email_code',
      ip: clientIpOf(c),
      userAgent: c.req.header('user-agent') ?? null,
    });
    return c.json({
      token,
      userId: session.userId,
      organizationId: session.organizationId,
    });
  });

  v1.post('/webhooks/stripe', async (c) => {
    const raw = await c.req.text();
    const sig = c.req.header('stripe-signature');
    if (!env.stripeWebhookSecret) {
      if (env.allowDevAuth) {
        return c.json({ received: true, dryRun: true });
      }
      return c.json(
        { error: 'stripe webhook is not configured', code: 'UNAVAILABLE' },
        503,
      );
    }
    if (!sig) {
      return c.json({ error: 'missing signature' }, 400);
    }
    const verify = verifyStripeSignature({
      rawBody: raw,
      signatureHeader: sig,
      secret: env.stripeWebhookSecret,
    });
    if (!verify.ok) {
      return c.json({ error: `signature: ${verify.reason}` }, 400);
    }
    let event: StripeWebhookEvent;
    try {
      event = JSON.parse(raw) as StripeWebhookEvent;
    } catch {
      return c.json({ error: 'invalid json' }, 400);
    }
    try {
      await handleStripeEvent(db, env, event);
    } catch (err) {
      console.error('stripe webhook handler failed', err);
      return c.json({ error: 'handler failed' }, 500);
    }
    return c.json({ received: true, type: event.type });
  });

  authed.post('/sse-tickets', async (c) => {
    const jwt = c.get('jwt');
    try {
      const minted = await mintSseTicket(deps.redis, jwt);
      return c.json(minted);
    } catch {
      return c.json(apiError(ErrorCode.UNAVAILABLE, 'ticket store unavailable'), 503);
    }
  });

  v1.get('/auth/methods', (c) => {
    return c.json(authMethodFlags(env));
  });

  authed.get('/me/logins', async (c) => {
    const jwt = c.get('jwt');
    const events = await listAuthEvents(db, jwt.sub);
    return c.json({ events });
  });

  authed.get('/me', async (c) => {
    const jwt = c.get('jwt');
    const legal = await loadLegalProfile(db, jwt.sub);
    if (legal.deletedAt) {
      return c.json(apiError(ErrorCode.UNAUTHORIZED, 'account closed'), 401);
    }
    return c.json({
      userId: jwt.sub,
      email: jwt.email,
      organizationId: jwt.organizationId,
      birthYear: legal.birthYear,
      acceptedLegalAt: legal.acceptedLegalAt?.toISOString() ?? null,
      minAge: env.minAge,
    });
  });

  authed.post('/me/legal', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json().catch(() => ({}))) as {
      birthYear?: number;
      acceptedLegal?: boolean;
    };
    await recordLegalAcceptance(db, jwt.sub, body);
    return c.json({ ok: true });
  });

  authed.post('/me/export', async (c) => {
    const jwt = c.get('jwt');
    try {
      return c.json(await exportAccountBundle(db, jwt.sub));
    } catch {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'account not found'), 404);
    }
  });

  authed.post('/me/delete', async (c) => {
    const jwt = c.get('jwt');
    await revokeUserSessions(deps.redis, jwt.sub);
    const result = await closeAccount(db, jwt.sub);
    return c.json(result);
  });

  authed.get('/me/appeals', async (c) => {
    const jwt = c.get('jwt');
    const appeals = await listAuthorAppeals(db, jwt.sub);
    return c.json({
      appeals: appeals.map((row) => ({
        id: row.id,
        communityGameId: row.communityGameId,
        status: row.status,
        message: row.message,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  });

  authed.post('/me/appeals', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json().catch(() => ({}))) as {
      communityGameId?: string;
      message?: string;
    };
    if (!body.communityGameId || !body.message?.trim()) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'game and message required'), 400);
    }
    const filed = await fileContentAppeal(db, {
      userId: jwt.sub,
      communityGameId: body.communityGameId,
      message: body.message.trim(),
    });
    if ('error' in filed) {
      return c.json(
        apiError(
          filed.error === 'not-author' ? ErrorCode.FORBIDDEN : ErrorCode.NOT_FOUND,
          filed.error,
        ),
        filed.error === 'not-author' ? 403 : 404,
      );
    }
    return c.json({ ok: true, id: filed.id });
  });
}
