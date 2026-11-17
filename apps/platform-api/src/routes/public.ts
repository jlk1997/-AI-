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
import { assertHourlyCap, HOURLY_CAPS } from '../lib/actionGate.js';
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
import { bumpPlayCountOnce, playHitKeys } from '../lib/communityCounters.js';
import { isPubliclyPlayable } from '../lib/communityPlayability.js';
import {
  consumePhoneRequestLimit,
  consumePhoneVerifyLimit,
} from '../lib/magicAbuse.js';
import { listCommunityGamesPage } from '../lib/communityList.js';
import { subscribeSocietyFrames } from '../lib/societyFanout.js';
import { assertPublishableCopy } from '../lib/ugcPolicy.js';
import { rememberPayNotify } from '../lib/payNotifyStore.js';
import { ensureOfficialTemplatePackages } from '../lib/templateCatalog.js';
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
  ensureWallet,
  hasPluginEntitlement,
  listLedger,
  purchasePluginSeat,
  purchaseTemplateSeat,
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
import { publicWorldEmbed } from '../lib/publicWorldEmbed.js';
import {
  isOriginAllowed,
  isRemixAllowed,
  normalizeLicense,
  resolveEmbedOrigins,
} from '../lib/license.js';
import {
  buildShareMeta,
  ogMetaTags,
  renderShareCardHtml,
  shareCardLocaleFromRequest,
} from '../lib/shareCard.js';
import { latestCanonForWorlds } from '../lib/courseBoard.js';
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
import { recordAuthEvent } from '../lib/authEvents.js';
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

export function registerPublicRoutes(
  v1: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  authed: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  ctx: V1RouteCtx,
): void {
  const { db, env, queue, s3 } = ctx;
  const deps = { redis: ctx.redis };
  const requireOrgAccess = ctx.requireOrgAccess;
  const optionalUserId = ctx.optionalUserId;
  const openProviderCheckout = ctx.openProviderCheckout;

  v1.get('/public/bench', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
    const rows = await db
      .select({
        id: benchRuns.id,
        projectId: benchRuns.projectId,
        publicLabel: benchRuns.publicLabel,
        scores: benchRuns.scores,
        createdAt: benchRuns.createdAt,
      })
      .from(benchRuns)
      .where(eq(benchRuns.isPublic, true))
      .orderBy(desc(benchRuns.createdAt))
      .limit(limit)
      .offset(offset);
    c.header('Cache-Control', 'public, max-age=60, s-maxage=300');
    return c.json({ runs: rows, limit, offset });
  });

  /** Bench-run detail: scores + project handle + linked job for reproducibility. */
  v1.get('/public/bench/runs/:id', async (c) => {
    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(benchRuns)
      .where(and(eq(benchRuns.id, id), eq(benchRuns.isPublic, true)))
      .limit(1);
    if (!row) return c.json({ error: 'not found' }, 404);
    const [proj] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, row.projectId))
      .limit(1);
    c.header('Cache-Control', 'public, max-age=60, s-maxage=300');
    return c.json({
      id: row.id,
      label: row.publicLabel,
      status: row.status,
      scores: row.scores,
      jobId: row.jobId,
      project: proj ?? null,
      createdAt: row.createdAt,
    });
  });

  /**
   * WeChat JS-SDK config so a shared work arrives with its own card (title,
   * cover, author) instead of the SPA's generic `<title>`. Inside WeChat that
   * card is the whole difference between a link that gets forwarded and one
   * that does not.
   *
   * Signing is restricted to our own origins — an open signing endpoint would
   * let anyone put their page under our Official Account.
   */
  v1.get('/public/wechat/jssdk-config', async (c) => {
    if (!env.wechatAppId || !env.wechatAppSecret) {
      return c.json({ enabled: false });
    }
    const url = c.req.query('url');
    if (!url || !isAllowedShareUrl(url, env.wechatShareOrigins)) {
      return c.json({ enabled: false });
    }
    try {
      const ticket = await getJsApiTicket(deps.redis, {
        appId: env.wechatAppId,
        appSecret: env.wechatAppSecret,
      });
      const signed = signJsSdk({ ticket, url, appId: env.wechatAppId });
      // Signatures are URL-bound and short-lived; never let a CDN hold them.
      c.header('Cache-Control', 'no-store');
      return c.json({ enabled: true, ...signed });
    } catch (err) {
      console.error('wechat jssdk-config', err);
      return c.json({ enabled: false });
    }
  });

  const loadShareWork = async (slugOrId: string) => {
    let [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.slug, slugOrId))
      .limit(1);
    if (!game && UUID_RE.test(slugOrId)) {
      [game] = await db
        .select()
        .from(communityGames)
        .where(eq(communityGames.id, slugOrId))
        .limit(1);
    }
    if (!game || !isPubliclyPlayable(game)) return null;
    const author = await authorForDeployment(db, game.deploymentId);
    return { game, author };
  };

  const shareCanonFor = async (
    game: { id: string; category: string },
    locale: 'zh-CN' | 'en',
  ): Promise<string | null> => {
    if (game.category !== 'world') return null;
    const work = await loadPublishedWork(db, game.id);
    if (!work?.worldId) return null;
    const map = await latestCanonForWorlds(db, [work.worldId], locale);
    return map.get(work.worldId) ?? null;
  };

  /** JSON the Vite plugin (and any crawler helper) uses to stamp OG tags. */
  v1.get('/public/games/:slugOrId/share-card', async (c) => {
    const hit = await loadShareWork(c.req.param('slugOrId'));
    if (!hit) return c.json({ error: 'not found' }, 404);
    const origin = (env.webBaseUrl || env.publicBaseUrl || '').replace(/\/$/, '');
    const locale = shareCardLocaleFromRequest(
      c.req.header('accept-language'),
      c.req.query('lang'),
    );
    const canon = await shareCanonFor(hit.game, locale);
    const meta = buildShareMeta(
      {
        slug: hit.game.slug,
        title: hit.game.title,
        description: hit.game.description,
        thumbnail: hit.game.thumbnail,
        category: hit.game.category,
        authorName: hit.author?.handle ?? hit.author?.displayName ?? null,
        remixCount: hit.game.remixCount,
        canon,
      },
      origin,
      locale,
    );
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ ...meta, locale, tags: ogMetaTags(meta) });
  });

  /** HTML WeChat's crawler can scrape when the SPA origin is not yet injecting. */
  v1.get('/public/games/:slugOrId/share.html', async (c) => {
    const hit = await loadShareWork(c.req.param('slugOrId'));
    if (!hit) return c.text('not found', 404);
    const origin = (env.webBaseUrl || env.publicBaseUrl || '').replace(/\/$/, '');
    const locale = shareCardLocaleFromRequest(
      c.req.header('accept-language'),
      c.req.query('lang'),
    );
    const canon = await shareCanonFor(hit.game, locale);
    const meta = buildShareMeta(
      {
        slug: hit.game.slug,
        title: hit.game.title,
        description: hit.game.description,
        thumbnail: hit.game.thumbnail,
        category: hit.game.category,
        authorName: hit.author?.handle ?? hit.author?.displayName ?? null,
        remixCount: hit.game.remixCount,
        canon,
      },
      origin,
      locale,
    );
    return c.html(renderShareCardHtml(meta, locale));
  });

  v1.get('/public/challenges/current', async (c) => {
    const { settleEndedChallenges } = await import('../lib/kaiMarket.js');
    void settleEndedChallenges(db).catch(() => 0);
    const now = new Date();
    const [row] = await db
      .select()
      .from(weeklyChallenges)
      .where(and(lte(weeklyChallenges.startsAt, now), gte(weeklyChallenges.endsAt, now)))
      .orderBy(desc(weeklyChallenges.startsAt))
      .limit(1);
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ challenge: row ?? null });
  });

  v1.get('/public/templates', async (c) => {
    await ensureOfficialTemplatePackages(db);
    const channel = (c.req.query('channel') ?? 'all').trim().toLowerCase();
    const rows = await db
      .select()
      .from(templatePackages)
      .where(
        channel === 'official'
          ? and(eq(templatePackages.isPublic, true), isNull(templatePackages.organizationId))
          : channel === 'community'
            ? and(
                eq(templatePackages.isPublic, true),
                sql`${templatePackages.organizationId} is not null`,
              )
            : eq(templatePackages.isPublic, true),
      )
      .orderBy(desc(templatePackages.createdAt))
      .limit(80);
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({
      channel: channel === 'official' || channel === 'community' ? channel : 'all',
      templates: rows.map((row) => ({
        ...row,
        official: row.organizationId == null,
      })),
    });
  });

  v1.post('/public/auth/phone/request', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { phone?: string };
    const phone = body.phone ? normalizePhone(body.phone) : '';
    if (!isValidCnPhone(phone)) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'invalid phone'), 400);
    }
    const echo =
      !env.productionRuntime &&
      (env.allowDevAuth || process.env['PLATFORM_PHONE_OTP_ECHO'] === 'true');
    if (!echo && env.phoneSmsProvider === 'none') {
      return c.json(
        apiError(ErrorCode.UNAVAILABLE, 'phone login is not configured'),
        503,
      );
    }
    try {
      const limited = await consumePhoneRequestLimit(deps.redis, {
        phone,
        ip: clientIpOf(c),
      });
      if (!limited.ok) {
        return c.json(
          apiError(ErrorCode.RATE_LIMITED, 'Too many codes requested. Try again later.'),
          429,
        );
      }
    } catch {
      return c.json(
        apiError(ErrorCode.UNAVAILABLE, 'Sign-in store unavailable'),
        503,
      );
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await deps.redis.set(`phone:otp:${phone}`, code, 'EX', 300);
    return c.json({
      ok: true,
      expiresInSeconds: 300,
      code: echo ? code : null,
      delivery: echo ? 'echo' : 'sms',
    });
  });

  v1.post('/public/auth/phone/verify', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { phone?: string; code?: string };
    const phone = body.phone ? normalizePhone(body.phone) : '';
    const code = (body.code ?? '').trim();
    if (!isValidCnPhone(phone) || !/^\d{6}$/.test(code)) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'invalid phone or code'), 400);
    }
    try {
      const limited = await consumePhoneVerifyLimit(deps.redis, {
        phone,
        ip: clientIpOf(c),
      });
      if (!limited.ok) {
        return c.json(
          apiError(ErrorCode.RATE_LIMITED, 'Too many code checks. Try again later.'),
          429,
        );
      }
    } catch {
      return c.json(
        apiError(ErrorCode.UNAVAILABLE, 'Sign-in store unavailable'),
        503,
      );
    }
    const expected = await deps.redis.getdel(`phone:otp:${phone}`);
    if (!expected || expected !== code) {
      return c.json(apiError(ErrorCode.UNAUTHORIZED, 'code expired or wrong'), 401);
    }
    const ident = await ensureUserWithPhone(db, phone);
    const token = await signSessionJwt(
      env.jwtSecret,
      {
        sub: ident.userId,
        email: '',
        organizationId: ident.organizationId,
        phone,
      },
      60 * 60 * 24 * 14,
    );
    await recordAuthEvent(db, {
      userId: ident.userId,
      method: 'phone',
      ip: clientIpOf(c),
      userAgent: c.req.header('user-agent') ?? null,
    });
    return c.json({
      token,
      userId: ident.userId,
      organizationId: ident.organizationId,
      created: ident.created,
    });
  });

  /*
   * WeChat web sign-in.
   *
   * Step 1 hands back an authorize URL rather than redirecting, because the
   * caller is a single-page app that needs to stash where the user was before
   * WeChat takes over the tab. The `state` is a signed, short-lived nonce held
   * in Redis — WeChat echoes it back and we refuse anything we did not mint,
   * which is what stops a login-CSRF.
   */
  v1.get('/public/auth/wechat/url', async (c) => {
    if (!env.wechatAppId || !env.wechatAppSecret) {
      return c.json({ enabled: false });
    }
    const redirectUri = c.req.query('redirect');
    if (!redirectUri || !isAllowedShareUrl(redirectUri, env.wechatShareOrigins)) {
      return c.json(
        apiError(ErrorCode.INVALID_INPUT, 'redirect must be one of our own origins'),
        400,
      );
    }
    const state = crypto.randomUUID();
    await deps.redis.set(`wechat:oauth:${state}`, redirectUri, 'EX', 600);
    c.header('Cache-Control', 'no-store');
    return c.json({
      enabled: true,
      url: buildAuthorizeUrl({
        appId: env.wechatAppId,
        redirectUri,
        state,
        scope: 'snsapi_userinfo',
      }),
      state,
    });
  });

  v1.post('/public/auth/wechat/callback', async (c) => {
    if (!env.wechatAppId || !env.wechatAppSecret) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'WeChat sign-in is not configured'), 400);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      code?: string;
      state?: string;
    };
    if (!body.code || !body.state) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'code and state are required'), 400);
    }
    // Single-use: a replayed state must not mint a second session.
    const claimed = await deps.redis.getdel(`wechat:oauth:${body.state}`);
    if (!claimed) {
      return c.json(apiError(ErrorCode.UNAUTHORIZED, 'This sign-in link expired'), 401);
    }
    try {
      const cfg = { appId: env.wechatAppId, appSecret: env.wechatAppSecret };
      const token = await exchangeOAuthCode(cfg, body.code);
      let profile = {
        openid: token.openid,
        unionid: token.unionid,
        nickname: null as string | null,
        avatarUrl: null as string | null,
      };
      if (token.scope.includes('snsapi_userinfo')) {
        const info = await fetchOAuthUserInfo(token.accessToken, token.openid).catch(
          () => null,
        );
        if (info) {
          profile = {
            openid: token.openid,
            unionid: info.unionid ?? token.unionid,
            nickname: info.nickname,
            avatarUrl: info.avatarUrl,
          };
        }
      }
      const identity = await ensureUserWithWeChat(db, profile);
      const jwt = await signSessionJwt(
        env.jwtSecret,
        { sub: identity.userId, email: '', organizationId: identity.organizationId },
        60 * 60 * 24 * 14,
      );
      await recordAuthEvent(db, {
        userId: identity.userId,
        method: 'wechat',
        ip: clientIpOf(c),
        userAgent: c.req.header('user-agent') ?? null,
      });
      return c.json({
        token: jwt,
        userId: identity.userId,
        organizationId: identity.organizationId,
        created: identity.created,
      });
    } catch (err) {
      console.error('wechat oauth callback', err);
      return c.json(apiError(ErrorCode.UNAUTHORIZED, 'WeChat sign-in failed'), 401);
    }
  });

  /** Prices and point costs. Public so the pricing page works signed out. */
  v1.get('/public/billing/catalog', (c) => c.json(buildCatalog(env)));

  /*
   * Payment callbacks.
   *
   * Both providers retry until they get a success body, so both handlers are
   * written to be safely repeatable and to answer 200 even for orders we have
   * already settled — anything else turns a duplicate into an endless retry
   * loop on the provider's side.
   */
  v1.post('/public/pay/wechat/notify', async (c) => {
    if (!env.wechatPayApiV3Key) return c.json({ code: 'FAIL', message: 'not configured' }, 400);
    try {
      const payload = (await c.req.json()) as {
        resource?: {
          ciphertext: string;
          nonce: string;
          associated_data?: string;
          algorithm?: string;
        };
      };
      if (!payload.resource) throw new Error('missing resource');
      const notify = decryptNotify(env.wechatPayApiV3Key, payload.resource);
      if (notify.tradeState !== 'SUCCESS') {
        return c.json({ code: 'SUCCESS', message: 'ignored' });
      }
      const settleInput = {
        outTradeNo: notify.outTradeNo,
        transactionId: notify.transactionId,
        amountCents: notify.amountCents,
        raw: notify.raw,
      };
      await rememberPayNotify(deps.redis, settleInput).catch((err) => {
        console.error('wechat pay notify store', err);
      });
      const result = await settleOrder(db, env, settleInput);
      if (result.status === 'amount-mismatch') {
        console.error('wechat pay amount mismatch', notify.outTradeNo);
      }
      return c.json({ code: 'SUCCESS', message: result.status });
    } catch (err) {
      console.error('wechat pay notify', err);
      return c.json({ code: 'FAIL', message: 'could not process' }, 400);
    }
  });

  v1.post('/public/pay/alipay/notify', async (c) => {
    if (!env.alipayPublicKey) return c.text('failure', 400);
    try {
      const form = await c.req.parseBody();
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(form)) {
        if (typeof v === 'string') params[k] = v;
      }
      if (!verifyNotify(env.alipayPublicKey, params)) {
        return c.text('failure', 400);
      }
      const notify = parseAlipayNotify(params);
      if (notify.tradeStatus !== 'TRADE_SUCCESS' && notify.tradeStatus !== 'TRADE_FINISHED') {
        return c.text('success');
      }
      const settleInput = {
        outTradeNo: notify.outTradeNo,
        transactionId: notify.tradeNo,
        amountCents: notify.amountCents,
        raw: params,
      };
      await rememberPayNotify(deps.redis, settleInput).catch((err) => {
        console.error('alipay pay notify store', err);
      });
      await settleOrder(db, env, settleInput);
      return c.text('success');
    } catch (err) {
      console.error('alipay notify', err);
      return c.text('failure', 400);
    }
  });

  /** Public game embed: returns metadata + a CDN/public URL the host can iframe. */
  v1.get('/public/games/:slugOrId/embed', async (c) => {
    const slugOrId = c.req.param('slugOrId');
    const [game] = await db
      .select()
      .from(communityGames)
      .where(
        slugOrId.includes('-')
          ? eq(communityGames.slug, slugOrId)
          : eq(communityGames.id, slugOrId),
      )
      .limit(1);
    if (!isPubliclyPlayable(game)) return c.json({ error: 'not found' }, 404);
    const worldEmbed = publicWorldEmbed({
      category: game.category,
      slug: game.slug,
      webBaseUrl: env.webBaseUrl ?? env.publicBaseUrl,
    });
    if (worldEmbed) {
      const allowedOrigins = resolveEmbedOrigins(game.embedOrigins, [
        ...(env.publicBaseUrl ? [env.publicBaseUrl] : []),
        ...(env.webBaseUrl ? [env.webBaseUrl] : []),
      ]);
      c.header('Cache-Control', 'no-store');
      return c.json({
        slug: game.slug,
        title: game.title,
        thumbnail: game.thumbnail,
        ...worldEmbed,
        allowedOrigins,
      });
    }
    const [dep] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, game.deploymentId))
      .limit(1);
    if (!dep) return c.json({ error: 'deployment not found' }, 404);

    /*
     * A third-party page gets a play session, not a copy of the build. The
     * author's `embedOrigins` decides who may frame it at all — without that
     * check, "embeddable" would mean any site can rehost someone's game under
     * its own brand and ads.
     */
    const allowedOrigins = resolveEmbedOrigins(game.embedOrigins, [
      ...(env.publicBaseUrl ? [env.publicBaseUrl] : []),
      ...(env.webBaseUrl ? [env.webBaseUrl] : []),
    ]);
    const requestOrigin = c.req.header('origin') ?? originOfHeader(c.req.header('referer'));

    let embedUrl: string | null = null;
    let embedDenied: string | null = null;
    if (env.allowPublicPlayUrls && dep.cdnUrl && dep.customDomainVerified) {
      embedUrl = `${dep.cdnUrl}${dep.cdnUrl.includes('?') ? '&' : '?'}embed=1`;
    } else if (requestOrigin && !isOriginAllowed(requestOrigin, allowedOrigins)) {
      embedDenied = 'origin_not_allowed';
    } else {
      const embedVisitor =
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
        c.req.header('cf-connecting-ip') ??
        'anon';
      if (!(await assertHourlyCap(deps.redis, `play-session:${embedVisitor}`, HOURLY_CAPS.playSession))) {
        return c.json(apiError(ErrorCode.RATE_LIMITED, 'too many play sessions this hour'), 429);
      }
      const issued = await issuePlaySession({
        db,
        env,
        deploymentId: dep.id,
        communityGameId: game.id,
        userId: null,
        userAgent: c.req.header('user-agent'),
        clientIp: embedVisitor,
        refererOrigin: requestOrigin,
        ttlSeconds: PLAY_SESSION_TTL_SECONDS,
      });
      if (issued) embedUrl = `${issued.url}${issued.url.includes('?') ? '&' : '?'}embed=1`;
    }

    // Session URLs are per-visitor; caching one would serve it to everyone.
    c.header('Cache-Control', 'no-store');
    return c.json({
      slug: game.slug,
      title: game.title,
      thumbnail: game.thumbnail,
      embedUrl,
      embedDenied,
      allowedOrigins,
    });
  });

  /**
   * Guest play URL for a *public* community work. `/embed` only answers when a
   * CDN or public object base exists, which is not the self-host default — and
   * "you must sign in to play someone else's game" kills the visitor loop. The
   * published row is the authorization here; the signed token is short-lived.
   */
  v1.get('/public/games/:slugOrId/play-url', async (c) => {
    const slugOrId = c.req.param('slugOrId');
    let [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.slug, slugOrId))
      .limit(1);
    if (!game && UUID_RE.test(slugOrId)) {
      [game] = await db
        .select()
        .from(communityGames)
        .where(eq(communityGames.id, slugOrId))
        .limit(1);
    }
    if (!isPubliclyPlayable(game)) return c.json({ error: 'not found' }, 404);
    const [dep] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, game.deploymentId))
      .limit(1);
    if (!dep?.previewUrl) return c.json({ error: 'not playable yet' }, 404);

    /*
     * Hosted playback is the default. A CDN or public-object URL is a permanent,
     * unauthenticated link to the whole build — convenient, but it makes the
     * work trivially mirrorable and takes it outside anything we can revoke. We
     * only fall back to one when an operator has explicitly opted in.
     */
    const visitor =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('cf-connecting-ip') ??
      'anon';
    const viewerId = await optionalUserId(c);
    const countPlay = () =>
      bumpPlayCountOnce(db, deps.redis, game.id, playHitKeys(viewerId, visitor));

    if (env.allowPublicPlayUrls) {
      if (dep.cdnUrl && dep.customDomainVerified) {
        await countPlay();
        return c.json({ url: dep.cdnUrl, expiresIn: null, source: 'cdn' });
      }
      if (env.publicObjectBaseUrl) {
        const url = `${env.publicObjectBaseUrl.replace(/\/$/, '')}/${dep.previewUrl}`;
        await countPlay();
        return c.json({ url, expiresIn: null, source: 'public-object' });
      }
    }

    if (!(await assertHourlyCap(deps.redis, `play-session:${visitor}`, HOURLY_CAPS.playSession))) {
      return c.json(apiError(ErrorCode.RATE_LIMITED, 'too many play sessions this hour'), 429);
    }
    const issued = await issuePlaySession({
      db,
      env,
      deploymentId: dep.id,
      communityGameId: game.id,
      userId: viewerId,
      userAgent: c.req.header('user-agent'),
      clientIp: visitor,
      refererOrigin: originOfHeader(c.req.header('referer')),
    });
    if (!issued) return c.json({ error: 'not playable yet' }, 404);
    await countPlay();
    // A play URL is per-visitor and expiring; a shared cache must never keep it.
    c.header('Cache-Control', 'no-store');
    return c.json({
      url: issued.url,
      expiresIn: issued.expiresIn,
      source: 'play-session',
    });
  });

  /** Public plugin marketplace — list / search. */
  v1.get('/public/plugins', async (c) => {
    const q = c.req.query('q')?.trim() ?? '';
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
    const where = q
      ? and(
          eq(pluginPackages.isPublic, true),
          sql`(${pluginPackages.slug} ILIKE ${`%${q}%`} OR ${pluginPackages.name} ILIKE ${`%${q}%`})`,
        )
      : eq(pluginPackages.isPublic, true);
    const rows = await db
      .select()
      .from(pluginPackages)
      .where(where)
      .orderBy(desc(pluginPackages.installCount), desc(pluginPackages.updatedAt))
      .limit(limit)
      .offset(offset);
    c.header('Cache-Control', 'public, max-age=60, s-maxage=300');
    return c.json({ plugins: rows, limit, offset });
  });

  v1.get('/public/plugins/:slug', async (c) => {
    const slug = c.req.param('slug');
    const [pkg] = await db
      .select()
      .from(pluginPackages)
      .where(and(eq(pluginPackages.slug, slug), eq(pluginPackages.isPublic, true)))
      .limit(1);
    if (!pkg) return c.json({ error: 'not found' }, 404);
    const versions = await db
      .select()
      .from(pluginVersions)
      .where(eq(pluginVersions.pluginId, pkg.id))
      .orderBy(desc(pluginVersions.publishedAt))
      .limit(50);
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ plugin: pkg, versions });
  });

  // -----------------------------------------------------------
  // Authed plugin publishing endpoints (P5).
  // -----------------------------------------------------------
  authed.post('/plugins', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json().catch(() => ({}))) as {
      slug?: string;
      name?: string;
      description?: string;
      tags?: string[];
    };
    const slug = body.slug?.trim().toLowerCase();
    const name = body.name?.trim();
    if (!slug || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
      return c.json({ error: 'slug must be 2-41 chars, lowercase, alnum or dash' }, 400);
    }
    if (!name) return c.json({ error: 'name required' }, 400);
    const [existing] = await db
      .select()
      .from(pluginPackages)
      .where(eq(pluginPackages.slug, slug))
      .limit(1);
    if (existing) return c.json({ error: 'slug taken' }, 409);
    const [pkg] = await db
      .insert(pluginPackages)
      .values({
        slug,
        name,
        description: body.description ?? null,
        organizationId: jwt.organizationId,
        authorUserId: jwt.sub,
        tags: body.tags ?? [],
        isPublic: true,
      })
      .returning();
    return c.json({ plugin: pkg });
  });

  /**
   * Publish a new version of a plugin. The tarball is expected to already be
   * uploaded via an out-of-band presigned PUT to `storageKey` (which is what
   * the IDE's "publish plugin" wizard does). We persist the manifest + sha256
   * for downstream integrity checks.
   */
  authed.post('/plugins/:slug/versions', async (c) => {
    const jwt = c.get('jwt');
    const slug = c.req.param('slug');
    const body = (await c.req.json().catch(() => ({}))) as {
      version?: string;
      storageKey?: string;
      sha256?: string;
      manifest?: Record<string, unknown>;
      runtimePeerRange?: string;
    };
    const version = body.version?.trim();
    const storageKey = body.storageKey?.trim();
    const sha256 = body.sha256?.trim();
    if (!version || !storageKey || !sha256) {
      return c.json({ error: 'version, storageKey, sha256 required' }, 400);
    }
    const [pkg] = await db
      .select()
      .from(pluginPackages)
      .where(eq(pluginPackages.slug, slug))
      .limit(1);
    if (!pkg) return c.json({ error: 'plugin not found' }, 404);
    if (pkg.organizationId !== jwt.organizationId) {
      return c.json({ error: 'forbidden' }, 403);
    }
    try {
      const [ver] = await db
        .insert(pluginVersions)
        .values({
          pluginId: pkg.id,
          version,
          storageKey,
          sha256,
          manifest: body.manifest ?? {},
          runtimePeerRange: body.runtimePeerRange ?? null,
        })
        .returning();
      await db
        .update(pluginPackages)
        .set({ latestVersion: version, updatedAt: new Date() })
        .where(eq(pluginPackages.id, pkg.id));
      return c.json({ version: ver });
    } catch (err) {
      // Unique violation on (plugin_id, version)
      if ((err as { code?: string }).code === '23505') {
        return c.json({ error: 'version already published' }, 409);
      }
      throw err;
    }
  });

  authed.post('/plugins/:slug/install', async (c) => {
    const jwt = c.get('jwt');
    const slug = c.req.param('slug');
    const body = (await c.req.json().catch(() => ({}))) as { projectId?: string };
    const [pkg] = await db
      .select()
      .from(pluginPackages)
      .where(eq(pluginPackages.slug, slug))
      .limit(1);
    if (!pkg) return c.json({ error: 'not found' }, 404);

    // A paid plugin installs only for an org that owns it. Its own author's org
    // always does, otherwise nobody could test what they are selling.
    if (pkg.pricePoints > 0 && pkg.organizationId !== jwt.organizationId) {
      const owned = await hasPluginEntitlement(db, jwt.organizationId, pkg.id);
      if (!owned) {
        return c.json(
          apiError(ErrorCode.FORBIDDEN, 'This plugin has to be bought first', {
            pricePoints: pkg.pricePoints,
          }),
          403,
        );
      }
    }

    const projectId = body.projectId?.trim();
    if (projectId) {
      const [project] = await db
        .select({ organizationId: projects.organizationId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      const [member] = project
        ? await db
            .select({ userId: organizationMembers.userId })
            .from(organizationMembers)
            .where(
              and(
                eq(organizationMembers.organizationId, project.organizationId),
                eq(organizationMembers.userId, jwt.sub),
              ),
            )
            .limit(1)
        : [];
      if (!member) {
        return c.json(apiError(ErrorCode.FORBIDDEN, 'not a project member'), 403);
      }
      const [installed] = await db
        .insert(projectPlugins)
        .values({
          projectId,
          pluginId: pkg.id,
          installedByUserId: jwt.sub,
        })
        .onConflictDoNothing()
        .returning({ pluginId: projectPlugins.pluginId });
      if (!installed) {
        return c.json({
          ok: true,
          installCount: pkg.installCount,
          projectId,
          already: true,
        });
      }
    }

    const [updated] = await db
      .update(pluginPackages)
      .set({ installCount: sql`${pluginPackages.installCount} + 1` })
      .where(eq(pluginPackages.id, pkg.id))
      .returning({ installCount: pluginPackages.installCount });
    return c.json({
      ok: true,
      installCount: updated?.installCount ?? pkg.installCount + 1,
      projectId: projectId ?? null,
    });
  });

  /**
   * Buying a plugin moves points from the buyer's wallet to the author's. Points
   * rather than money on purpose: the buyer already holds them, the author
   * already has a wallet, and a sale is one ledger transfer instead of a second
   * payment integration with its own refunds and disputes.
   */
  authed.post('/plugins/:slug/purchase', async (c) => {
    const jwt = c.get('jwt');
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const [pkg] = await db
      .select()
      .from(pluginPackages)
      .where(eq(pluginPackages.slug, c.req.param('slug')))
      .limit(1);
    if (!pkg || !pkg.isPublic) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'plugin not found'), 404);
    }
    if (pkg.organizationId === organizationId) {
      return c.json({ ok: true, owned: true, pointsPaid: 0 });
    }
    if (await hasPluginEntitlement(db, organizationId, pkg.id)) {
      return c.json({ ok: true, owned: true, pointsPaid: 0 });
    }
    if (pkg.pricePoints > 0) {
      await refreshPlanGrant(db, env, organizationId);
    }
    const bought = await purchasePluginSeat(db, {
      organizationId,
      pluginId: pkg.id,
      sellerOrgId: pkg.organizationId,
      userId: jwt.sub,
      slug: pkg.slug,
      pricePoints: pkg.pricePoints,
    });
    if ('unpaid' in bought) {
      return c.json(
        apiError(ErrorCode.QUOTA_EXCEEDED, 'Not enough points to buy this', {
          ...paywallDetails(bought.need),
          balance: bought.balance,
        }),
        429,
      );
    }
    return c.json({ ok: true, owned: true, pointsPaid: bought.pointsPaid });
  });

  /** Which plugins this org can already use. */
  authed.post('/templates/:slug/purchase', async (c) => {
    const jwt = c.get('jwt');
    const slug = c.req.param('slug');
    const [pkg] = await db
      .select()
      .from(templatePackages)
      .where(eq(templatePackages.slug, slug))
      .limit(1);
    if (!pkg || !pkg.isPublic) return c.json({ error: 'not found' }, 404);
    const bought = await purchaseTemplateSeat(db, {
      organizationId: jwt.organizationId,
      templateId: pkg.id,
      sellerOrgId: pkg.organizationId,
      userId: jwt.sub,
      slug: pkg.slug,
      pricePoints: pkg.pricePoints,
    });
    if ('unpaid' in bought) {
      return c.json(
        apiError(ErrorCode.QUOTA_EXCEEDED, 'not enough points', {
          ...paywallDetails(bought.need),
        }),
        402,
      );
    }
    return c.json({ ok: true, owned: true, pointsPaid: bought.pointsPaid });
  });

  authed.get('/templates/entitlements', async (c) => {
    const jwt = c.get('jwt');
    const rows = await db
      .select({
        templateId: templateEntitlements.templateId,
        pointsPaid: templateEntitlements.pointsPaid,
      })
      .from(templateEntitlements)
      .where(eq(templateEntitlements.organizationId, jwt.organizationId));
    return c.json({ entitlements: rows });
  });

  authed.get('/plugins/entitlements', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (typeof organizationId !== 'string') return organizationId;
    const rows = await db
      .select({
        pluginId: pluginEntitlements.pluginId,
        slug: pluginPackages.slug,
        name: pluginPackages.name,
        pointsPaid: pluginEntitlements.pointsPaid,
        createdAt: pluginEntitlements.createdAt,
      })
      .from(pluginEntitlements)
      .innerJoin(pluginPackages, eq(pluginPackages.id, pluginEntitlements.pluginId))
      .where(eq(pluginEntitlements.organizationId, organizationId))
      .orderBy(desc(pluginEntitlements.createdAt));
    return c.json({ entitlements: rows });
  });

  /** Set (or clear) the price of a plugin the caller's org publishes. */
  authed.patch('/plugins/:slug/price', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json().catch(() => ({}))) as { pricePoints?: number };
    const price = Math.max(0, Math.min(100_000, Math.round(body.pricePoints ?? 0)));
    const [pkg] = await db
      .select()
      .from(pluginPackages)
      .where(eq(pluginPackages.slug, c.req.param('slug')))
      .limit(1);
    if (!pkg) return c.json(apiError(ErrorCode.NOT_FOUND, 'plugin not found'), 404);
    if (pkg.organizationId !== jwt.organizationId) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not yours'), 403);
    }
    await db
      .update(pluginPackages)
      .set({ pricePoints: price, updatedAt: new Date() })
      .where(eq(pluginPackages.id, pkg.id));
    return c.json({ ok: true, pricePoints: price });
  });

  /** List all plugins owned by the caller's org (for the Developer Hub UI). */
  authed.get('/plugins/mine', async (c) => {
    const jwt = c.get('jwt');
    const rows = await db
      .select()
      .from(pluginPackages)
      .where(eq(pluginPackages.organizationId, jwt.organizationId))
      .orderBy(desc(pluginPackages.updatedAt));
    return c.json({ plugins: rows });
  });

  /**
   * Hand the caller the canonical `storageKey` for a new (slug, version) pair.
   * The actual upload is out-of-band (S3 PUT via worker creds), then the CI
   * script registers the version via `/plugins/:slug/versions`.
   */
  authed.post('/plugins/:slug/upload', async (c) => {
    const jwt = c.get('jwt');
    const slug = c.req.param('slug');
    const body = (await c.req.json().catch(() => ({}))) as { version?: string };
    const version = body.version?.trim();
    if (!version || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
      return c.json({ error: 'version must be semver (e.g. 1.2.3)' }, 400);
    }
    const [pkg] = await db
      .select()
      .from(pluginPackages)
      .where(eq(pluginPackages.slug, slug))
      .limit(1);
    if (!pkg) return c.json({ error: 'plugin not found' }, 404);
    if (pkg.organizationId !== jwt.organizationId) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const [existing] = await db
      .select()
      .from(pluginVersions)
      .where(and(eq(pluginVersions.pluginId, pkg.id), eq(pluginVersions.version, version)))
      .limit(1);
    if (existing) {
      return c.json({ error: 'version already exists; bump the patch number' }, 409);
    }
    const storageKey = `plugins/${pkg.slug}/${version}.tgz`;
    return c.json({
      storageKey,
      bucket: env.s3Bucket,
      uploadInstructions: `PUT the gzipped tarball to s3://${env.s3Bucket}/${storageKey}, then POST /plugins/${slug}/versions with sha256 + manifest.`,
    });
  });

  /** Soft-delete: flips isPublic=false so the slug stays reserved. */
  authed.delete('/plugins/:slug', async (c) => {
    const jwt = c.get('jwt');
    const slug = c.req.param('slug');
    const [pkg] = await db
      .select()
      .from(pluginPackages)
      .where(eq(pluginPackages.slug, slug))
      .limit(1);
    if (!pkg) return c.json({ error: 'not found' }, 404);
    if (pkg.organizationId !== jwt.organizationId) {
      return c.json({ error: 'forbidden' }, 403);
    }
    await db
      .update(pluginPackages)
      .set({ isPublic: false, updatedAt: new Date() })
      .where(eq(pluginPackages.id, pkg.id));
    return c.json({ ok: true });
  });

  /** Toggle a bench run's public-leaderboard visibility (author-only). */
  authed.post('/bench-runs/:id/publish', async (c) => {
    const jwt = c.get('jwt');
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      isPublic?: boolean;
      publicLabel?: string;
    };
    const [run] = await db.select().from(benchRuns).where(eq(benchRuns.id, id)).limit(1);
    if (!run) return c.json({ error: 'not found' }, 404);
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, run.projectId))
      .limit(1);
    if (!proj || proj.organizationId !== jwt.organizationId) {
      return c.json({ error: 'forbidden' }, 403);
    }
    await db
      .update(benchRuns)
      .set({
        isPublic: body.isPublic ?? true,
        publicLabel: body.publicLabel ?? run.publicLabel ?? null,
      })
      .where(eq(benchRuns.id, id));
    return c.json({ ok: true });
  });

  authed.onError((err, c) => {
    console.error('v1 authed error', err);
    const expose =
      env.allowDevAuth && err instanceof Error ? { message: err.message } : {};
    return c.json({ error: 'internal_error', ...expose }, 500);
  });

}
