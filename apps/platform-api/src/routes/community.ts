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
import {
  guestPresenceDecision,
  guestPresenceWriteGuard,
  leaseActive,
  resolveJobLogS3ObjectKey,
  SOCIETY_PRESENCE_TTL_MS,
  townCatalogHeat,
} from '@opengame/platform-shared';
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
  worldCourseOptions,
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
import { loadAlleyBoard } from '../lib/alleyBoard.js';
import { bumpPlayCountOnce, playHitKeys, requestClientIp } from '../lib/communityCounters.js';
import { listCommunityGamesPage, parseCommunityListSort } from '../lib/communityList.js';
import { emitCachedSocietyFrame, subscribeSocietyFrames } from '../lib/societyFanout.js';
import { loadSocietyInspectorSnapshot } from '../lib/societySnapshot.js';
import { peekSocietyTalkBudget } from '../lib/societyTalkBudget.js';
import {
  countSocietyWatchers,
  leaveSocietyWatcher,
  societyWatcherTicket,
  touchSocietyWatcher,
} from '../lib/societyWatchers.js';
import {
  loadTownCeremony,
  societyStreamEventName,
} from '../lib/societyPatrons.js';
import { landTownStimulus } from '../lib/societyTalkGate.js';
import { assertPublishableCopy } from '../lib/ugcPolicy.js';
import { canPublishPublicly, loadLegalProfile } from '../lib/accountPrivacy.js';
import { writeAudit } from '../lib/audit.js';
import { handleStripeEvent } from './stripeWebhook.js';
import {
  COMMERCE,
  loadPublishedWork,
  publicCommerceView,
  snapshotMechanicForPublish,
  tonightKaiCounts,
  lockOrgCommerce,
  refundVisitorTransfer,
  transferToAuthor,
} from '../lib/commerce.js';
import { registerKaiCommerce } from '../lib/kaiCommerceRoutes.js';
import {
  courseReturnHintsByDeployment,
  courseReturnHintsForWorlds,
  emitCoursePulse,
  ensureOpenCourse,
  mergeCourseHints,
  loadCourseBoard,
  loadCourseTonightDiscovery,
  resolveCourseHang,
} from '../lib/courseBoard.js';
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
  orgRoleAtLeast,
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

export function registerCommunityRoutes(
  v1: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  authed: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  ctx: V1RouteCtx,
): void {
  const { db, env, queue, s3 } = ctx;
  const deps = { redis: ctx.redis };
  const requireOrgAccess = ctx.requireOrgAccess;
  const optionalUserId = ctx.optionalUserId;
  const openProviderCheckout = ctx.openProviderCheckout;

  authed.post('/community/games/publish', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json()) as {
      deploymentId?: string;
      title?: string;
      description?: string;
      thumbnail?: string;
      tags?: string[];
      category?: string;
      isPublic?: boolean;
      license?: string;
      embedOrigins?: string[];
      challengeId?: string | null;
    };

    const deploymentId = body.deploymentId?.trim();
    const title = body.title?.trim();
    if (!deploymentId) {
      return c.json({ error: 'deploymentId required' }, 400);
    }
    if (!title) {
      return c.json({ error: 'title required' }, 400);
    }
    const legal = await loadLegalProfile(db, jwt.sub);
    if (legal.deletedAt) {
      return c.json(apiError(ErrorCode.UNAUTHORIZED, 'account closed'), 401);
    }
    const wantsPublic = body.isPublic !== false;
    if (wantsPublic && !canPublishPublicly(legal, env.minAge)) {
      return c.json(
        apiError(
          ErrorCode.FORBIDDEN,
          `Publishing publicly needs terms, privacy, and a birth year of at least ${env.minAge}`,
          { reason: 'publish_legal', minAge: env.minAge },
        ),
        403,
      );
    }
    const publishable = assertPublishableCopy({
      title,
      description: body.description,
    });
    if (!publishable.ok) {
      return c.json(
        apiError(
          ErrorCode.INVALID_INPUT,
          `title or description looks like a licensed franchise (${publishable.brand})`,
          { brand: publishable.brand },
        ),
        400,
      );
    }

    // 验证 deployment 存在且属于用户
    const [dep] = await db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1);
    if (!dep) {
      return c.json({ error: 'deployment not found' }, 404);
    }
    if (dep.status && dep.status !== 'active') {
      return c.json({ error: 'deployment not active' }, 400);
    }

    const [proj] = await db.select().from(projects).where(eq(projects.id, dep.projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'project not found' }, 404);
    }

    const [mem] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, proj.organizationId),
          eq(organizationMembers.userId, jwt.sub),
        ),
      )
      .limit(1);
    if (!mem) {
      return c.json({ error: 'forbidden' }, 403);
    }
    if (!orgRoleAtLeast(mem.role, 'admin')) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'owner or admin role required'), 403);
    }

    // Public listing needs a live lamp, including “already published” retries.
    if (wantsPublic) {
      const [world] = await db
        .select({ lightUntil: worlds.lightUntil })
        .from(worlds)
        .where(eq(worlds.projectId, proj.id))
        .limit(1);
      if (
        world &&
        !leaseActive(world.lightUntil) &&
        process.env['PLATFORM_DEMO_OPEN_WORLD'] !== '1'
      ) {
        return c.json(
          apiError(
            ErrorCode.FORBIDDEN,
            'light this town before publishing',
            { reason: 'publish_unfunded' },
          ),
          403,
        );
      }
    }

    // Idempotent: same deployment already in community
    const [existing] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.deploymentId, deploymentId))
      .limit(1);
    if (existing) {
      return c.json({
        game: existing,
        slug: existing.slug,
        alreadyPublished: true,
      });
    }

    const allowedCategories = new Set([
      'arcade',
      'puzzle',
      'action',
      'strategy',
      'rpg',
      'story',
      'world',
      'other',
    ]);
    const categoryRaw = (body.category || 'other').trim().toLowerCase();
    const category = allowedCategories.has(categoryRaw) ? categoryRaw : 'other';

    // 生成 slug
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) + '-' + Date.now().toString(36);

    // 创建社区游戏记录
    const [game] = await db
      .insert(communityGames)
      .values({
        deploymentId,
        title,
        slug,
        description: body.description || '',
        thumbnail: body.thumbnail || '',
        category,
        isPublic: body.isPublic !== false,
        license: normalizeLicense(body.license),
        fingerprint: workFingerprint({
          title,
          description: body.description || '',
          category,
          license: normalizeLicense(body.license),
        }),
        challengeId: body.challengeId ?? null,
        mechanicJson: snapshotMechanicForPublish({
          projectId: dep.projectId,
          title,
          description: body.description || '',
          category,
        }),
        embedOrigins: Array.isArray(body.embedOrigins)
          ? (resolveEmbedOrigins(body.embedOrigins, []) as unknown as never)
          : null,
      })
      .returning();

    try {
      await ingestCommunityGame(db, {
        slug: game!.slug,
        title: game!.title,
        description: game!.description ?? '',
        category: game!.category ?? 'other',
        tags: body.tags,
      });
    } catch {
      // RAG ingest is best-effort
    }

    // 处理标签
    if (body.tags && body.tags.length > 0) {
      for (const tagName of body.tags) {
        const tagSlug = tagName.toLowerCase().replace(/\s+/g, '-');
        let [tag] = await db.select().from(gameTags).where(eq(gameTags.slug, tagSlug)).limit(1);
        if (!tag) {
          [tag] = await db.insert(gameTags).values({ name: tagName, slug: tagSlug }).returning();
        }
        await db.insert(gameTagMappings).values({ deploymentId, tagId: tag.id }).onConflictDoNothing();
      }
    }

    await writeAudit(db, {
      action: 'community.publish',
      actorUserId: jwt.sub,
      organizationId: proj.organizationId,
      target: game?.id ?? slug,
      meta: { slug, title, category },
    });
    if (category === 'world' && game) {
      const [world] = await db
        .select({ id: worlds.id })
        .from(worlds)
        .where(eq(worlds.projectId, dep.projectId))
        .limit(1);
      if (world) {
        await ensureOpenCourse(db, {
          worldId: world.id,
          gameId: game.id,
        }).catch(() => undefined);
      }
    }
    return c.json({ game, slug, alreadyPublished: false });
  });

  /** Template market ↔ RAG: keyword hints from indexed community games. */
  v1.get('/community/rag-suggestions', async (c) => {
    const q = c.req.query('q')?.trim() ?? '';
    if (!q) {
      return c.json({ suggestions: [] });
    }
    const suggestions = await queryCommunityTemplateHints(db, q, 8);
    return c.json({ suggestions });
  });

  // 获取社区游戏列表
  v1.get('/community/games', async (c) => {
    const page = Number(c.req.query('page') || '1');
    const pageSize = Math.min(Number(c.req.query('pageSize') || '20'), 50);
    const category = c.req.query('category');
    const sort = parseCommunityListSort(c.req.query('sort'));
    // `kind` is the community's two front doors: games to play vs worlds to
    // watch. Worlds are `category=world`, everything else is a game.
    const kind = c.req.query('kind');

    const offset = (page - 1) * pageSize;

    let allResults = await listCommunityGamesPage(db, {
      kind: kind === 'world' || kind === 'game' ? kind : undefined,
      category: category || undefined,
      sort,
      page,
      pageSize,
    });

    // 排序
    if (sort === 'living' || sort === 'prize') {
      const livingStatuses = await worldStatusByDeployment(
        db,
        allResults.map((row) => (row as { communityGames: { deploymentId: string } }).communityGames.deploymentId),
        ctx.redis,
      );
      if (sort === 'living') {
        allResults.sort((a, b) => {
          const ga = a.communityGames;
          const gb = b.communityGames;
          const official = Number(Boolean(gb.isOfficial)) - Number(Boolean(ga.isOfficial));
          if (official !== 0) return official;
          const liveB = townCatalogHeat(livingStatuses.get(gb.deploymentId));
          const liveA = townCatalogHeat(livingStatuses.get(ga.deploymentId));
          if (liveB !== liveA) return liveB - liveA;
          const watchB = livingStatuses.get(gb.deploymentId)?.watcherCount ?? 0;
          const watchA = livingStatuses.get(ga.deploymentId)?.watcherCount ?? 0;
          if (watchB !== watchA) return watchB - watchA;
          const tb = livingStatuses.get(gb.deploymentId)?.lastAdvancedAt ?? '';
          const ta = livingStatuses.get(ga.deploymentId)?.lastAdvancedAt ?? '';
          return tb.localeCompare(ta);
        });
      } else {
        allResults.sort((a, b) => {
          const prizeA = a.communityGames.challengeId ? 1 : 0;
          const prizeB = b.communityGames.challengeId ? 1 : 0;
          if (prizeB !== prizeA) return prizeB - prizeA;
          return (b.communityGames.playCount || 0) - (a.communityGames.playCount || 0);
        });
      }
    } else if (sort === 'popular' || sort === 'remixed') {
      /* SQL already ordered play_count / remix_count. */
    } else {
      allResults.sort((a, b) => new Date(b.communityGames.publishedAt).getTime() - new Date(a.communityGames.publishedAt).getTime());
    }

    // 分页
    const paginatedResults = allResults.slice(offset, offset + pageSize);

    // World cards need "day N / still living / N residents" in one round-trip.
    const worldDeploymentIds = paginatedResults
      .filter((row) => (row as any).communityGames?.category === 'world')
      .map((row) => (row as any).communityGames.deploymentId as string);
    const worldStatuses = await worldStatusByDeployment(
      db,
      worldDeploymentIds,
      ctx.redis,
    );
    const locale = (c.req.header('accept-language') ?? '').toLowerCase().startsWith('en')
      ? 'en'
      : 'zh-CN';
    const courseHints = await courseReturnHintsByDeployment(db, worldDeploymentIds, locale);

    // 获取标签和评分
    const gamesWithTags = await Promise.all(
      paginatedResults.map(async (row) => {
        const game = (row as any).communityGames;
        const deployment = (row as any).deployments;
        // 获取评分
        const ratingResult = await db
          .select({ avg: avg(gameRatings.rating), count: count(gameRatings.id) })
          .from(gameRatings)
          .where(eq(gameRatings.deploymentId, game.deploymentId));

        // 获取标签
        const tagsResult = await db
          .select({ name: gameTags.name, slug: gameTags.slug, color: gameTags.color })
          .from(gameTagMappings)
          .innerJoin(gameTags, eq(gameTagMappings.tagId, gameTags.id))
          .where(eq(gameTagMappings.deploymentId, game.deploymentId));

        const avgRating = ratingResult[0]?.avg;
        const numericAvg = typeof avgRating === 'number' ? avgRating : parseFloat(String(avgRating || '0'));

        return {
          ...game,
          deployment,
          rating: numericAvg > 0 ? Number(numericAvg.toFixed(1)) : 0,
          ratingCount: Number(ratingResult[0]?.count || 0),
          tags: tagsResult,
          world: worldStatuses.get(game.deploymentId) ?? null,
          course: courseHints.get(game.deploymentId) ?? null,
        };
      }),
    );

    return c.json({ games: gamesWithTags, page, pageSize, total: allResults.length });
  });

  // 今晚巷口榜（必须在 :slugOrId 之前）
  v1.get('/community/alley', async (c) => {
    const board = await loadAlleyBoard(db, ctx.redis);
    c.header('Cache-Control', 'public, max-age=30, s-maxage=60');
    return c.json(board);
  });

  // 精选游戏（必须在 :slugOrId 之前，否则 "featured" 会被当成 uuid）
  v1.get('/community/games/featured', async (c) => {
    const featuredResults = await db
      .select()
      .from(communityGames)
      .innerJoin(deployments, eq(communityGames.deploymentId, deployments.id))
      .where(
        or(eq(communityGames.isFeatured, true), eq(communityGames.isOfficial, true)),
      )
      .orderBy(desc(communityGames.isOfficial), desc(communityGames.publishedAt))
      .limit(10);

    const featured = await Promise.all(
      featuredResults.map(async (row) => {
        const game = (row as any).communityGames;
        const deployment = (row as any).deployments;
        const ratingResult = await db
          .select({ avg: avg(gameRatings.rating) })
          .from(gameRatings)
          .where(eq(gameRatings.deploymentId, game.deploymentId));
        const avgRating = ratingResult[0]?.avg;
        const numericAvg =
          typeof avgRating === 'number'
            ? avgRating
            : parseFloat(String(avgRating || '0'));
        return {
          ...game,
          deployment,
          rating: numericAvg > 0 ? Number(numericAvg.toFixed(1)) : 0,
        };
      }),
    );

    const featuredWorldIds = featured
      .filter((g) => g.category === 'world')
      .map((g) => g.deploymentId as string);
    const worldStatuses = await worldStatusByDeployment(
      db,
      featuredWorldIds,
      ctx.redis,
    );
    const locale = (c.req.header('accept-language') ?? '').toLowerCase().startsWith('en')
      ? 'en'
      : 'zh-CN';
    const courseHints = await courseReturnHintsByDeployment(db, featuredWorldIds, locale);
    const withWorld = featured.map((g) =>
      g.category === 'world'
        ? {
            ...g,
            world: worldStatuses.get(g.deploymentId as string) ?? null,
            course: courseHints.get(g.deploymentId as string) ?? null,
          }
        : g,
    );

    return c.json({ games: withWorld });
  });

  /**
   * Tonight in town: recent spoken beats from published worlds.
   * Listed next to the worlds tab so a visitor has a reason to open one.
   */
  v1.get('/community/worlds/activity', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') || '16'), 24);
    const locale = (c.req.header('accept-language') ?? '').toLowerCase().startsWith('en')
      ? 'en'
      : 'zh-CN';
    const items = await listWorldActivity(db, { limit });
    const hints = await courseReturnHintsByDeployment(
      db,
      items.map((item) => item.deploymentId),
      locale,
    );
    return c.json({ items: mergeCourseHints(items, hints) });
  });

  /** Cross-town open boards for discovery「今夜套餐」. */
  v1.get('/community/course-tonight', async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') || '12'), 1), 24);
    return c.json(await loadCourseTonightDiscovery(db, limit));
  });

  // 获取单个游戏详情
  v1.get('/community/games/:slugOrId', async (c) => {
    const slugOrId = c.req.param('slugOrId');
    const looksLikeUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        slugOrId,
      );

    // 先按 slug 查找；仅当像 UUID 时再按 ID 查（避免 "featured" 等触发 Postgres uuid 报错）
    let [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.slug, slugOrId))
      .limit(1);

    if (!game && looksLikeUuid) {
      [game] = await db
        .select()
        .from(communityGames)
        .where(eq(communityGames.id, slugOrId))
        .limit(1);
    }

    if (!game) {
      return c.json({ error: 'game not found' }, 404);
    }

    const viewerId = await optionalUserId(c);
    const viewerIsAuthor = viewerId
      ? await isDeploymentMember(db, game.deploymentId, viewerId)
      : false;
    // A taken-down work is gone for everyone but its author, who gets the page
    // plus the reason — being told why is the only way an appeal can happen.
    if (game.takenDownAt && !viewerIsAuthor) {
      return c.json({ error: 'game not found' }, 404);
    }

    // 获取部署信息
    const [deployment] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, game.deploymentId))
      .limit(1);

    // 获取评分统计
    const [ratingStats] = await db
      .select({
        avgRating: sql<number>`COALESCE(AVG(${gameRatings.rating})::numeric, 0)`,
        ratingCount: sql<number>`COUNT(*)`,
      })
      .from(gameRatings)
      .where(eq(gameRatings.deploymentId, game.deploymentId));

    // 获取标签
    const tags = await db
      .select({ name: gameTags.name, slug: gameTags.slug, color: gameTags.color })
      .from(gameTagMappings)
      .innerJoin(gameTags, eq(gameTagMappings.tagId, gameTags.id))
      .where(eq(gameTagMappings.deploymentId, game.deploymentId));

    /* Play counts belong on play-url / visit, not on reading the work JSON. */

    const author = await authorForDeployment(db, game.deploymentId);
    const world =
      game.category === 'world'
        ? (await worldStatusByDeployment(db, [game.deploymentId], ctx.redis)).get(game.deploymentId) ?? null
        : null;
    const parent = await remixParentByDeployment(db, game.deploymentId);
    const headline =
      game.category === 'world'
        ? await latestHeadlineForDeployment(db, game.deploymentId)
        : null;
    const locale = (c.req.header('accept-language') ?? '').toLowerCase().startsWith('en')
      ? 'en'
      : 'zh-CN';
    const courseHint =
      game.category === 'world'
        ? (await courseReturnHintsByDeployment(db, [game.deploymentId], locale)).get(
            game.deploymentId,
          ) ?? null
        : null;

    const license = normalizeLicense(game.license);
    const commerce = publicCommerceView(game, {
      hideWorldVisitorSkus: game.category === 'world' && !viewerIsAuthor,
    });
    const tonight = viewerIsAuthor ? await tonightKaiCounts(db, game.id) : null;
    return c.json({
      ...game,
      commerce,
      tonight,
      deployment,
      rating: Number(ratingStats?.avgRating || 0),
      ratingCount: Number(ratingStats?.ratingCount || 0),
      tags,
      author,
      world,
      parent,
      headline,
      course: courseHint,
      license,
      viewerIsAuthor,
      authorProjectId:
        viewerIsAuthor && game.category === 'world'
          ? (deployment?.projectId ?? null)
          : undefined,
      // Pre-resolved so the client never has to know the licence vocabulary to
      // decide whether to offer "change one line".
      remixAllowed: isRemixAllowed(license),
      creditRequired: license === 'remix-credit',
    });
  });

  /** Author-only: change the remix licence on an already published work. */
  authed.patch('/community/games/:gameId/license', async (c) => {
    const jwt = c.get('jwt');
    const gameId = c.req.param('gameId');
    const body = (await c.req.json().catch(() => ({}))) as {
      license?: string;
      watermark?: boolean;
      embedOrigins?: string[];
    };

    const [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.id, gameId))
      .limit(1);
    if (!game) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);

    if (!(await isDeploymentMember(db, game.deploymentId, jwt.sub))) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not the author'), 403);
    }

    if (body.watermark === false) {
      const quota = await resolveOrgQuota(db, env, jwt.organizationId);
      if (quota.plan === 'free') {
        return c.json(
          apiError(ErrorCode.FORBIDDEN, 'paid plan required to turn the watermark off'),
          403,
        );
      }
    }

    const [row] = await db
      .update(communityGames)
      .set({
        license: normalizeLicense(body.license ?? game.license),
        ...(typeof body.watermark === 'boolean' ? { watermark: body.watermark } : {}),
        ...(Array.isArray(body.embedOrigins)
          ? {
              embedOrigins: resolveEmbedOrigins(
                body.embedOrigins,
                [],
              ) as unknown as never,
            }
          : {}),
      })
      .where(eq(communityGames.id, gameId))
      .returning();

    return c.json({
      ok: true,
      license: normalizeLicense(row?.license),
      watermark: row?.watermark ?? true,
      embedOrigins: row?.embedOrigins ?? null,
    });
  });

  /**
   * The whole operations console for release one: whoever is in
   * `PLATFORM_ADMIN_EMAILS` can put a work on the shelf, or take it off.
   */
  authed.patch('/community/games/:gameId/featured', async (c) => {
    const jwt = c.get('jwt');
    if (!isPlatformAdmin(env, jwt)) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a curator'), 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as { featured?: boolean };
    if (typeof body.featured !== 'boolean') {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'featured must be a boolean'), 400);
    }
    const [row] = await db
      .update(communityGames)
      .set({ isFeatured: body.featured })
      .where(eq(communityGames.id, c.req.param('gameId')))
      .returning();
    if (!row) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    return c.json({ ok: true, isFeatured: row.isFeatured });
  });

  /** Lets the web app show curator controls only to curators. */
  authed.get('/me/capabilities', async (c) => {
    const jwt = c.get('jwt');
    const curator = isPlatformAdmin(env, jwt);
    return c.json({
      curator,
      openReports: curator ? await countOpenReports(db) : 0,
    });
  });

  // --------- Reports and takedowns ---------
  //
  // Hosting other people's work means being able to answer "this is stolen"
  // with a decision instead of an email to whoever runs the server. Reports are
  // deliberately cheap to file and always resolved by a named curator.

  authed.post('/community/reports', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json().catch(() => ({}))) as {
      targetKind?: string;
      gameId?: string;
      commentId?: string;
      reason?: string;
      detail?: string;
    };
    if (!isReportTarget(body.targetKind)) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'unknown target'), 400);
    }
    if (!isReportReason(body.reason)) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'unknown reason'), 400);
    }
    if (!(await assertHourlyCap(deps.redis, `report:${jwt.sub}`, HOURLY_CAPS.report))) {
      return c.json(apiError(ErrorCode.RATE_LIMITED, 'too many reports this hour'), 429);
    }

    // The reported id arrives from a client and lands in a uuid column, so a
    // malformed one has to be turned away here rather than as a cast error.
    const targetId = body.targetKind === 'game' ? body.gameId : body.commentId;
    if (!targetId || !UUID_RE.test(targetId)) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'target not found'), 404);
    }
    if (body.targetKind === 'game') {
      const [game] = await db
        .select({ id: communityGames.id })
        .from(communityGames)
        .where(eq(communityGames.id, targetId))
        .limit(1);
      if (!game) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    } else {
      const [comment] = await db
        .select({ id: gameComments.id })
        .from(gameComments)
        .where(eq(gameComments.id, targetId))
        .limit(1);
      if (!comment) return c.json(apiError(ErrorCode.NOT_FOUND, 'comment not found'), 404);
    }

    // Reporting the same thing twice is one report; the unique index makes that
    // true even when the button is tapped twice on a slow connection.
    await db
      .insert(contentReports)
      .values({
        targetKind: body.targetKind,
        communityGameId: body.targetKind === 'game' ? (body.gameId ?? null) : null,
        commentId: body.targetKind === 'comment' ? (body.commentId ?? null) : null,
        reporterUserId: jwt.sub,
        reason: body.reason,
        detail: normalizeDetail(body.detail),
      })
      .onConflictDoNothing();
    return c.json({ ok: true });
  });

  authed.get('/admin/reports', async (c) => {
    const jwt = c.get('jwt');
    if (!isPlatformAdmin(env, jwt)) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a curator'), 403);
    }
    const status = c.req.query('status') ?? 'open';
    const reports = await listReports(db, {
      ...(status === 'all' ? {} : { status }),
      limit: Number(c.req.query('limit') ?? '50'),
    });
    return c.json({ reports, openCount: await countOpenReports(db) });
  });

  /**
   * One decision settles every open report about the same thing. Upholding a
   * report about a game hides it; the author keeps the project and the source,
   * because a takedown has to be reversible when an appeal succeeds.
   */
  authed.post('/admin/reports/:reportId/resolve', async (c) => {
    const jwt = c.get('jwt');
    if (!isPlatformAdmin(env, jwt)) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a curator'), 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      action?: 'uphold' | 'reject';
      note?: string;
    };
    const action = body.action === 'reject' ? 'reject' : 'uphold';
    const reportId = c.req.param('reportId');
    if (!UUID_RE.test(reportId)) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'report not found'), 404);
    }
    const [report] = await db
      .select()
      .from(contentReports)
      .where(eq(contentReports.id, reportId))
      .limit(1);
    if (!report) return c.json(apiError(ErrorCode.NOT_FOUND, 'report not found'), 404);

    const note = normalizeDetail(body.note);
    if (action === 'uphold') {
      if (report.communityGameId) {
        await takedownGame(db, report.communityGameId, note ?? report.reason);
      } else if (report.commentId) {
        await db.delete(gameComments).where(eq(gameComments.id, report.commentId));
      }
    }
    const resolved = await resolveReportsFor(
      db,
      {
        ...(report.communityGameId ? { communityGameId: report.communityGameId } : {}),
        ...(report.commentId ? { commentId: report.commentId } : {}),
      },
      action === 'uphold' ? 'upheld' : 'rejected',
      jwt.sub,
      note,
    );
    await writeAudit(db, {
      action: action === 'uphold' ? 'community.takedown' : 'admin.report.resolve',
      actorUserId: jwt.sub,
      target: report.communityGameId ?? report.commentId ?? reportId,
      meta: { action, reportId, note },
    });
    return c.json({ ok: true, action, resolved });
  });

  /** Puts a taken-down work back on the shelf after an appeal. */
  authed.post('/admin/games/:gameId/restore', async (c) => {
    const jwt = c.get('jwt');
    if (!isPlatformAdmin(env, jwt)) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a curator'), 403);
    }
    const gameId = c.req.param('gameId');
    if (!UUID_RE.test(gameId)) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    }
    const ok = await restoreGame(db, gameId);
    if (!ok) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    await writeAudit(db, {
      action: 'community.restore',
      actorUserId: jwt.sub,
      target: gameId,
    });
    return c.json({ ok: true });
  });

  // 提交游戏评分
  authed.post('/community/games/:gameId/rating', async (c) => {
    const jwt = c.get('jwt');
    if (!(await assertHourlyCap(deps.redis, `rating:${jwt.sub}`, HOURLY_CAPS.rating))) {
      return c.json(apiError(ErrorCode.RATE_LIMITED, 'too many ratings this hour'), 429);
    }
    const gameId = c.req.param('gameId');
    const body = (await c.req.json()) as { rating?: number };
    const rating = Math.round(Number(body.rating));

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return c.json({ error: 'rating must be between 1 and 5' }, 400);
    }

    const [game] = await db.select().from(communityGames).where(eq(communityGames.id, gameId)).limit(1);
    if (!game) {
      return c.json({ error: 'game not found' }, 404);
    }

    await db
      .insert(gameRatings)
      .values({
        deploymentId: game.deploymentId,
        userId: jwt.sub,
        rating,
      })
      .onConflictDoUpdate({
        target: [gameRatings.deploymentId, gameRatings.userId],
        set: { rating, createdAt: new Date() },
      });

    return c.json({ ok: true });
  });

  // 提交游戏评论
  authed.post('/community/games/:gameId/comments', async (c) => {
    const jwt = c.get('jwt');
    if (!(await assertHourlyCap(deps.redis, `comment:${jwt.sub}`, HOURLY_CAPS.comment))) {
      return c.json(apiError(ErrorCode.RATE_LIMITED, 'too many comments this hour'), 429);
    }
    const gameId = c.req.param('gameId');
    const body = (await c.req.json()) as { content?: string; parentId?: string };
    const content = body.content?.trim();

    if (!content) {
      return c.json({ error: 'content required' }, 400);
    }
    if (content.length > 2000) {
      return c.json({ error: 'content too long (max 2000 chars)' }, 400);
    }

    const [game] = await db.select().from(communityGames).where(eq(communityGames.id, gameId)).limit(1);
    if (!game) {
      return c.json({ error: 'game not found' }, 404);
    }

    // Threads here are one level deep. Replying to a reply attaches to the same
    // top-level comment instead of nesting further, because the read path shows
    // a parent and its answers — a deeper reply would simply never be seen.
    let parentId: string | null = null;
    if (body.parentId) {
      // A malformed id would otherwise reach Postgres as a cast error.
      if (!UUID_RE.test(body.parentId)) {
        return c.json({ error: 'parent comment not found' }, 404);
      }
      const [parent] = await db
        .select({ id: gameComments.id, parentId: gameComments.parentId })
        .from(gameComments)
        .where(
          and(
            eq(gameComments.id, body.parentId),
            eq(gameComments.deploymentId, game.deploymentId),
          ),
        )
        .limit(1);
      if (!parent) return c.json({ error: 'parent comment not found' }, 404);
      parentId = parent.parentId ?? parent.id;
    }

    const [comment] = await db
      .insert(gameComments)
      .values({
        deploymentId: game.deploymentId,
        userId: jwt.sub,
        content,
        parentId,
      })
      .returning();

    const [user] = await db.select().from(users).where(eq(users.id, jwt.sub)).limit(1);

    return c.json({
      comment: {
        ...comment,
        user: user ? { id: user.id, ...publicAuthorOf(user) } : null,
      },
    });
  });

  // --------- Follow a world / game (the "come back tomorrow" hook) ---------

  authed.get('/community/games/:gameId/follow', async (c) => {
    const jwt = c.get('jwt');
    const [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.id, c.req.param('gameId')))
      .limit(1);
    if (!game) return c.json({ error: 'game not found' }, 404);
    const [row] = await db
      .select()
      .from(userFollowedGames)
      .where(
        and(
          eq(userFollowedGames.userId, jwt.sub),
          eq(userFollowedGames.deploymentId, game.deploymentId),
        ),
      )
      .limit(1);
    return c.json({
      following: Boolean(row),
      lastSeenSimTime: row?.lastSeenSimTime != null ? Number(row.lastSeenSimTime) : null,
    });
  });

  authed.post('/community/games/:gameId/follow', async (c) => {
    const jwt = c.get('jwt');
    const [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.id, c.req.param('gameId')))
      .limit(1);
    if (!game) return c.json({ error: 'game not found' }, 404);
    // Stamp the current sim clock so the first revisit summary is honest
    // (following now must not immediately claim "3 days went by").
    const status = (await worldStatusByDeployment(db, [game.deploymentId])).get(
      game.deploymentId,
    );
    await db
      .insert(userFollowedGames)
      .values({
        userId: jwt.sub,
        deploymentId: game.deploymentId,
        lastSeenSimTime: status?.simTime != null ? String(status.simTime) : null,
        lastSeenAt: new Date(),
      })
      .onConflictDoNothing();
    return c.json({ ok: true, following: true });
  });

  authed.delete('/community/games/:gameId/follow', async (c) => {
    const jwt = c.get('jwt');
    const [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.id, c.req.param('gameId')))
      .limit(1);
    if (!game) return c.json({ error: 'game not found' }, 404);
    await db
      .delete(userFollowedGames)
      .where(
        and(
          eq(userFollowedGames.userId, jwt.sub),
          eq(userFollowedGames.deploymentId, game.deploymentId),
        ),
      );
    return c.json({ ok: true, following: false });
  });

  /** Mark the sim clock this follower has now watched up to. */
  authed.post('/community/games/:gameId/seen', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json().catch(() => ({}))) as { simTime?: number };
    const simTime = Number(body.simTime);
    if (!Number.isFinite(simTime) || simTime < 0) {
      return c.json({ error: 'simTime required' }, 400);
    }
    const [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.id, c.req.param('gameId')))
      .limit(1);
    if (!game) return c.json({ error: 'game not found' }, 404);
    const [row] = await db
      .update(userFollowedGames)
      .set({ lastSeenSimTime: String(simTime), lastSeenAt: new Date() })
      .where(
        and(
          eq(userFollowedGames.userId, jwt.sub),
          eq(userFollowedGames.deploymentId, game.deploymentId),
        ),
      )
      .returning();
    if (!row) return c.json({ error: 'not following' }, 404);
    return c.json({ ok: true, lastSeenSimTime: simTime });
  });

  /** Followed worlds + how much sim time went by since the last visit. */
  authed.get('/me/follows', async (c) => {
    const jwt = c.get('jwt');
    const rows = await db
      .select({
        follow: userFollowedGames,
        game: communityGames,
      })
      .from(userFollowedGames)
      .innerJoin(
        communityGames,
        eq(communityGames.deploymentId, userFollowedGames.deploymentId),
      )
      .where(eq(userFollowedGames.userId, jwt.sub))
      .orderBy(desc(userFollowedGames.createdAt))
      .limit(50);
    const statuses = await worldStatusByDeployment(
      db,
      rows.map((r) => r.follow.deploymentId),
      ctx.redis,
    );
    const follows = rows.map((r) => {
      const world = statuses.get(r.follow.deploymentId) ?? null;
      const lastSeen =
        r.follow.lastSeenSimTime != null ? Number(r.follow.lastSeenSimTime) : null;
      const newHours =
        world?.simTime != null && lastSeen != null
          ? Math.max(0, world.simTime - lastSeen)
          : null;
      return {
        gameId: r.game.id,
        slug: r.game.slug,
        title: r.game.title,
        thumbnail: r.game.thumbnail,
        deploymentId: r.follow.deploymentId,
        followedAt: r.follow.createdAt,
        lastSeenSimTime: lastSeen,
        lastSeenAt: r.follow.lastSeenAt,
        world,
        newHours,
      };
    });
    if (rows.length === 0) return c.json({ follows: [] });
    const worldLinks = await db
      .select({
        deploymentId: deployments.id,
        worldId: worlds.id,
      })
      .from(deployments)
      .innerJoin(worlds, eq(worlds.projectId, deployments.projectId))
      .where(
        inArray(
          deployments.id,
          rows.map((r) => r.follow.deploymentId),
        ),
      );
    const locale = (c.req.header('accept-language') ?? '').toLowerCase().startsWith('en')
      ? 'en'
      : 'zh-CN';
    const hints = await courseReturnHintsForWorlds(
      db,
      worldLinks.map((row) => row.worldId),
      locale,
    );
    const hintByDeployment = new Map(
      worldLinks.map((row) => [row.deploymentId, hints.get(row.worldId) ?? null]),
    );
    const withCourse = follows.map((row) => ({
      ...row,
      course: hintByDeployment.get(row.deploymentId) ?? null,
    }));
    withCourse.sort((a, b) => (b.newHours ?? -1) - (a.newHours ?? -1));
    return c.json({ follows: withCourse });
  });

  // --------- Whisper into someone else's published town ---------

  /**
   * Publishing a world publishes a stage: anyone signed in may lean in and say
   * one thing to a resident. The society handles it through the same live
   * whisper path the author uses, so the town actually reacts instead of the
   * text landing in a comment list.
   */
  authed.post('/community/games/:gameId/whisper', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json().catch(() => ({}))) as {
      text?: string;
      agentKey?: string;
      paid?: boolean;
      nodeId?: string;
      optionId?: string;
    };
    const text = (body.text ?? '').trim();
    const paidXiangyi = Boolean(body.paid);
    if (text.length < 2 || text.length > 200) {
      return c.json(
        apiError(ErrorCode.INVALID_INPUT, 'A whisper is 2–200 characters'),
        400,
      );
    }
    const [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.id, c.req.param('gameId')))
      .limit(1);
    if (!game) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    if (game.category !== 'world') {
      return c.json(
        apiError(ErrorCode.INVALID_INPUT, 'Only worlds can be whispered to'),
        400,
      );
    }
    if (paidXiangyi && !game.xiangyiEnabled) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'the author closed 巷议'), 403);
    }
    const [dep] = await db
      .select({ projectId: deployments.projectId })
      .from(deployments)
      .where(eq(deployments.id, game.deploymentId))
      .limit(1);
    if (!dep) return c.json(apiError(ErrorCode.NOT_FOUND, 'deployment not found'), 404);
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, dep.projectId))
      .limit(1);
    if (!worldRow) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }

    // A stranger nudges a real simulation, so hold the door: one whisper every
    // 20s and a daily cap per visitor per town. Paid 巷议 skips the daily cap
    // (it already costs points) but still waits a breath. Redis being down
    // must not stop the town from listening, so failures here fall through.
    try {
      const gate = await deps.redis.set(
        `whisper:gate:${jwt.sub}:${worldRow.id}`,
        '1',
        'EX',
        paidXiangyi ? 8 : 20,
        'NX',
      );
      if (gate === null) {
        return c.json(
          apiError(ErrorCode.RATE_LIMITED, 'Let the town breathe for a moment'),
          429,
        );
      }
      if (!paidXiangyi) {
        const dayKey = `whisper:day:${jwt.sub}:${worldRow.id}`;
        const used = await deps.redis.incr(dayKey);
        if (used === 1) await deps.redis.expire(dayKey, 86_400);
        if (used > 12) {
          return c.json(
            apiError(ErrorCode.RATE_LIMITED, 'You have said plenty here today'),
            429,
          );
        }
      }
    } catch {
      // No rate limiter available; attribution below still keeps this accountable.
    }

    let xiangyiCharge: {
      charged: number;
      authorPoints: number;
      balance: number;
      fromOrgId: string;
      toOrgId: string;
    } | null = null;
    if (paidXiangyi) {
      const organizationId = await requireOrgAccess(c);
      if (typeof organizationId !== 'string') return organizationId;
      const work = await loadPublishedWork(db, game.id);
      if (!work) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
      const list = game.xiangyiCost > 0 ? game.xiangyiCost : COMMERCE.xiangyi;
      const priced = await db.transaction(async (tx) => {
        const scoped = tx as unknown as typeof db;
        await lockOrgCommerce(scoped, organizationId, 'xiangyi');
        const firstXiangyi = !(await hasSpentKind(scoped, organizationId, 'xiangyi'));
        const quote = quoteVisitorPrice({
          kind: 'xiangyi',
          list,
          firstJiaxi: false,
          firstXiangyi,
        });
        const paid = await transferToAuthor(scoped, {
          fromOrgId: organizationId,
          toOrgId: work.authorOrgId,
          userId: jwt.sub,
          gameId: game.id,
          kind: 'xiangyi',
          points: quote.pay,
          note: '巷议',
          meta: { agentKey: body.agentKey?.trim() || null, quote },
        });
        return { paid, quote };
      });
      if (!priced.paid.ok) {
        return c.json(
          apiError(ErrorCode.QUOTA_EXCEEDED, 'not enough points', paywallDetails(priced.paid.need)),
          402,
        );
      }
      xiangyiCharge = {
        charged: priced.paid.charged,
        authorPoints: priced.paid.authorPoints,
        balance: priced.paid.balance,
        fromOrgId: organizationId,
        toOrgId: work.authorOrgId,
      };
    }

    let injected: Awaited<ReturnType<typeof whisperSocietyLive>>;
    try {
      injected = await landTownStimulus({
        db,
        redis: ctx.redis,
        world: worldRow,
        agentKey: body.agentKey?.trim() || undefined,
        text,
        forceTown: paidXiangyi,
        importance: paidXiangyi ? 14 : 8,
      });
    } catch (err) {
      if (xiangyiCharge) {
        await refundVisitorTransfer(db, {
          fromOrgId: xiangyiCharge.fromOrgId,
          toOrgId: xiangyiCharge.toOrgId,
          gameId: game.id,
          kind: 'xiangyi',
          charged: xiangyiCharge.charged,
          authorPoints: xiangyiCharge.authorPoints,
          note: '巷议未进镇',
        });
      }
      if (isSocietyBusyError(err)) {
        return c.json({ error: 'society busy', code: 'society_busy' }, 423);
      }
      if (isSocietyTickTimeoutError(err)) {
        return c.json({ error: 'society tick timeout', code: 'society_tick_timeout' }, 503);
      }
      throw err;
    }

    const hang =
      paidXiangyi || body.optionId
        ? await resolveCourseHang(db, {
            worldId: worldRow.id,
            nodeId: body.nodeId,
            optionId: body.optionId,
            organizationId: jwt.organizationId,
          }).catch(() => null)
        : null;
    const [saved] = await db
      .insert(worldWhispers)
      .values({
        worldId: worldRow.id,
        deploymentId: game.deploymentId,
        userId: jwt.sub,
        agentKey: body.agentKey?.trim() || null,
        text,
        simTime: injected.simTime != null ? String(injected.simTime) : null,
        paid: paidXiangyi,
        weight: paidXiangyi ? 3 : 1,
        courseNodeId: hang?.nodeId ?? null,
        courseOptionId: hang?.optionId ?? null,
      })
      .returning();

    if (hang) {
      const board = await loadCourseBoard(db, {
        worldId: worldRow.id,
        gameId: game.id,
      }).catch(() => null);
      if (board?.current) void emitCoursePulse(worldRow.id, board.current);
    }

    // Keep the published replay in step, so the next visitor's deck shows it.
    try {
      const { scheduleSocietyReplayPublish } = await import(
        '../lib/societyReplayExport.js'
      );
      scheduleSocietyReplayPublish({
        db,
        s3,
        env,
        projectId: dep.projectId,
        worldId: worldRow.id,
        events: injected.events,
      });
    } catch {
      // non-fatal
    }

    if (jwt.organizationId) {
      const { markDailyMission } = await import('../lib/kaiMarket.js');
      await markDailyMission(db, jwt.organizationId, 'town').catch(() => undefined);
    }

    return c.json({
      ok: true,
      whisperId: saved?.id ?? null,
      simTime: injected.simTime,
      events: injected.events.length,
      rumor: injected.rumor ?? null,
      focusAgentId: injected.focusAgentId ?? null,
      degraded: injected.degraded ?? false,
      paid: paidXiangyi,
      weight: paidXiangyi ? 3 : 1,
      charge: xiangyiCharge,
    });
  });

  /** Public guestbook: what visitors said to this town, newest first. */
  v1.get('/community/games/:gameId/whispers', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 50);
    const [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.id, c.req.param('gameId')))
      .limit(1);
    if (!game) return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    const rows = await db
      .select({
        whisper: worldWhispers,
        author: users,
        hangLabel: worldCourseOptions.label,
      })
      .from(worldWhispers)
      .innerJoin(users, eq(users.id, worldWhispers.userId))
      .leftJoin(
        worldCourseOptions,
        eq(worldCourseOptions.id, worldWhispers.courseOptionId),
      )
      .where(eq(worldWhispers.deploymentId, game.deploymentId))
      .orderBy(desc(worldWhispers.createdAt))
      .limit(limit);
    return c.json({
      whispers: rows.map((r) => ({
        id: r.whisper.id,
        text: r.whisper.text,
        agentKey: r.whisper.agentKey,
        simTime: r.whisper.simTime != null ? Number(r.whisper.simTime) : null,
        paid: r.whisper.paid,
        weight: r.whisper.weight,
        courseNodeId: r.whisper.courseNodeId,
        courseOptionId: r.whisper.courseOptionId,
        courseHangLabel: r.hangLabel ?? null,
        createdAt: r.whisper.createdAt,
        author: publicAuthorOf(r.author),
      })),
    });
  });

  v1.get('/community/games/:gameId/society/snapshot', async (c) => {
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || work.game.category !== 'world' || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    if (work.game.takenDownAt) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    }
    const snap = await loadSocietyInspectorSnapshot(db, work.worldId);
    if (!snap) return c.json(apiError(ErrorCode.NOT_FOUND, 'no world'), 404);
    const [talkBudget, ceremony, watcherCount] = await Promise.all([
      peekSocietyTalkBudget(ctx.redis, work.worldId, Date.now(), {
        leaseBonus: snap.lightBonusPerHour,
        litUntil: snap.lightUntil,
      }),
      loadTownCeremony(db, work.game.id, snap.townTimeUntil),
      countSocietyWatchers(ctx.redis, work.worldId).catch(() => 0),
    ]);
    return c.json({ ...snap, talkBudget, ...ceremony, watcherCount });
  });

  v1.get('/community/games/:gameId/society/stream', async (c) => {
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || work.game.category !== 'world' || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    if (work.game.takenDownAt) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    }
    const worldId = work.worldId;
    return streamSSE(c, async (stream) => {
      const keepAlive = setInterval(() => {
        stream.write(': heartbeat\n\n');
      }, 25_000);
      let unsubscribe: (() => void) | null = null;
      let receivedLive = false;
      try {
        unsubscribe = subscribeSocietyFrames(env.redisUrl, worldId, (message) => {
          receivedLive = true;
          stream.write(
            `event: ${societyStreamEventName(message)}\ndata: ${message}\n\n`,
          );
        });
      } catch (err) {
        console.warn('[society-stream] community subscribe failed', err);
        stream.write(
          `event: society-error\ndata: ${JSON.stringify({ error: 'subscribe_failed' })}\n\n`,
        );
      }
      await emitCachedSocietyFrame({
        redis: ctx.redis,
        worldId,
        receivedLive: () => receivedLive,
        writeFrame: (message) => {
          stream.write(`event: society-frame\ndata: ${message}\n\n`);
        },
      });
      stream.write(
        `event: society-open\ndata: ${JSON.stringify({ worldId })}\n\n`,
      );
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(keepAlive);
          unsubscribe?.();
          resolve();
        });
      });
    });
  });

  v1.post('/community/games/:gameId/presence', async (c) => {
    const work = await loadPublishedWork(db, c.req.param('gameId'));
    if (!work || work.game.category !== 'world' || !work.worldId) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'this world is not live'), 404);
    }
    if (work.game.takenDownAt) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'game not found'), 404);
    }
    const body = await c.req
      .json<{ leave?: boolean; tab?: string }>()
      .catch(() => ({}) as { leave?: boolean; tab?: string });
    const [row] = await db
      .select({
        clockPaused: worlds.clockPaused,
        heartbeatUntil: worlds.heartbeatUntil,
        authorWatchUntil: worlds.authorWatchUntil,
      })
      .from(worlds)
      .where(eq(worlds.id, work.worldId))
      .limit(1);
    if (!row) return c.json(apiError(ErrorCode.NOT_FOUND, 'no world'), 404);
    const visitor = clientIpOf(c);
    const viewerId = await optionalUserId(c);
    const ticket = societyWatcherTicket({
      userId: viewerId,
      ip: visitor,
      tab: body.tab,
    });
    if (body.leave === true) {
      const remaining = await leaveSocietyWatcher(ctx.redis, work.worldId, ticket).catch(
        () => 0,
      );
      const afterLeave = guestPresenceDecision({
        leave: true,
        clockPaused: row.clockPaused,
        authorWatchUntil: row.authorWatchUntil,
        remainingWatchers: remaining,
      });
      if (afterLeave === 'clear') {
        const now = new Date();
        await db
          .update(worlds)
          .set({
            heartbeatUntil: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(worlds.id, work.worldId),
              or(
                isNull(worlds.authorWatchUntil),
                lte(worlds.authorWatchUntil, now),
              ),
            ),
          );
        return c.json({ ok: true, until: null, watcherCount: remaining });
      }
      return c.json({
        ok: true,
        until: row.heartbeatUntil?.toISOString() ?? null,
        watcherCount: remaining,
      });
    }
    if (
      !(await assertHourlyCap(
        ctx.redis,
        `presence:${work.game.id}:${visitor}`,
        HOURLY_CAPS.presence,
      ))
    ) {
      return c.json({
        ok: true,
        throttled: true,
        paused: Boolean(row.clockPaused),
      });
    }
    const watcherCount = await touchSocietyWatcher(ctx.redis, work.worldId, ticket).catch(
      () => 1,
    );
    if (
      guestPresenceWriteGuard({
        action: 'extend',
        clockPaused: row.clockPaused,
      }) === 'paused'
    ) {
      return c.json({
        ok: true,
        paused: true,
        until: row.heartbeatUntil?.toISOString() ?? null,
        watcherCount,
      });
    }
    const until = new Date(Date.now() + SOCIETY_PRESENCE_TTL_MS);
    const [extended] = await db
      .update(worlds)
      .set({
        heartbeatEnabled: true,
        heartbeatUntil: until,
        lastHeartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(worlds.id, work.worldId), eq(worlds.clockPaused, false)))
      .returning({ id: worlds.id });
    if (!extended) {
      return c.json({
        ok: true,
        paused: true,
        until: row.heartbeatUntil?.toISOString() ?? null,
        watcherCount,
      });
    }
    return c.json({ ok: true, until: until.toISOString(), watcherCount });
  });

  /** "I opened this" — powers the played / watched list on the profile. */
  authed.post('/community/games/:gameId/visit', async (c) => {
    const jwt = c.get('jwt');
    const gameId = c.req.param('gameId');
    const [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.id, gameId))
      .limit(1);
    if (!game) {
      return c.json({ error: 'game not found' }, 404);
    }
    await recordPlay(db, jwt.sub, game.deploymentId);
    const visitor = requestClientIp({
      forwarded: c.req.header('x-forwarded-for'),
      cf: c.req.header('cf-connecting-ip'),
    });
    await bumpPlayCountOnce(db, deps.redis, game.id, playHitKeys(jwt.sub, visitor));
    if (game.category === 'world') {
      const organizationId = await requireOrgAccess(c);
      if (typeof organizationId === 'string') {
        const { markDailyMission } = await import('../lib/kaiMarket.js');
        await markDailyMission(db, organizationId, 'visit').catch(() => undefined);
      }
    }
    return c.json({ ok: true });
  });

  // 获取游戏评论列表
  v1.get('/community/games/:gameId/comments', async (c) => {
    const gameId = c.req.param('gameId');
    const page = Number(c.req.query('page') || '1');
    const pageSize = Math.min(Number(c.req.query('pageSize') || '20'), 50);
    const offset = (page - 1) * pageSize;

    const [game] = await db.select().from(communityGames).where(eq(communityGames.id, gameId)).limit(1);
    if (!game) {
      return c.json({ error: 'game not found' }, 404);
    }

    const authorColumns = {
      id: users.id,
      email: users.email,
      handle: users.handle,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
    };

    const rows = await db
      .select({ comment: gameComments, author: authorColumns })
      .from(gameComments)
      .innerJoin(users, eq(gameComments.userId, users.id))
      .where(and(eq(gameComments.deploymentId, game.deploymentId), isNull(gameComments.parentId)))
      .orderBy(desc(gameComments.createdAt))
      .limit(pageSize)
      .offset(offset);

    // Replies come back attached to their parent rather than as a second
    // request per comment: a thread of three is the normal case here, and
    // paginating inside it would cost more round trips than it saves rows.
    const parentIds = rows.map((r) => r.comment.id);
    const replyRows =
      parentIds.length > 0
        ? await db
            .select({ comment: gameComments, author: authorColumns })
            .from(gameComments)
            .innerJoin(users, eq(gameComments.userId, users.id))
            .where(inArray(gameComments.parentId, parentIds))
            .orderBy(gameComments.createdAt)
            .limit(200)
        : [];

    // Which of these the reader has already liked. Anonymous readers see the
    // counts and an inactive heart.
    const viewerId = await optionalUserId(c);
    const likedIds = new Set<string>();
    if (viewerId) {
      const ids = [...parentIds, ...replyRows.map((r) => r.comment.id)];
      if (ids.length > 0) {
        const liked = await db
          .select({ commentId: commentLikes.commentId })
          .from(commentLikes)
          .where(
            and(
              eq(commentLikes.userId, viewerId),
              inArray(commentLikes.commentId, ids),
            ),
          );
        for (const row of liked) likedIds.add(row.commentId);
      }
    }

    const shape = (row: (typeof rows)[number]) => ({
      ...row.comment,
      likedByMe: likedIds.has(row.comment.id),
      user: { id: row.author.id, ...publicAuthorOf(row.author) },
    });

    const repliesByParent = new Map<string, Array<ReturnType<typeof shape>>>();
    for (const row of replyRows) {
      const parentId = row.comment.parentId;
      if (!parentId) continue;
      const list = repliesByParent.get(parentId) ?? [];
      list.push(shape(row));
      repliesByParent.set(parentId, list);
    }

    const comments = rows.map((row) => ({
      ...shape(row),
      replies: repliesByParent.get(row.comment.id) ?? [],
    }));

    return c.json({ comments, page, pageSize });
  });

  /**
   * Liking is idempotent in both directions: the row is the truth and
   * `likes_count` is recomputed from it, so a double tap or a retried request
   * cannot drift the number.
   */
  authed.post('/community/comments/:commentId/like', async (c) => {
    const jwt = c.get('jwt');
    const commentId = c.req.param('commentId');
    if (!UUID_RE.test(commentId)) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'comment not found'), 404);
    }
    const [comment] = await db
      .select({ id: gameComments.id })
      .from(gameComments)
      .where(eq(gameComments.id, commentId))
      .limit(1);
    if (!comment) return c.json(apiError(ErrorCode.NOT_FOUND, 'comment not found'), 404);

    const liked = c.req.method === 'POST';
    if (liked) {
      await db
        .insert(commentLikes)
        .values({ commentId, userId: jwt.sub })
        .onConflictDoNothing();
    }
    const [row] = await db
      .update(gameComments)
      .set({
        likesCount: sql`(select count(*)::int from ${commentLikes} where ${commentLikes.commentId} = ${commentId})`,
      })
      .where(eq(gameComments.id, commentId))
      .returning({ likesCount: gameComments.likesCount });
    return c.json({ liked: true, likesCount: row?.likesCount ?? 0 });
  });

  authed.delete('/community/comments/:commentId/like', async (c) => {
    const jwt = c.get('jwt');
    const commentId = c.req.param('commentId');
    if (!UUID_RE.test(commentId)) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'comment not found'), 404);
    }
    await db
      .delete(commentLikes)
      .where(
        and(eq(commentLikes.commentId, commentId), eq(commentLikes.userId, jwt.sub)),
      );
    const [row] = await db
      .update(gameComments)
      .set({
        likesCount: sql`(select count(*)::int from ${commentLikes} where ${commentLikes.commentId} = ${commentId})`,
      })
      .where(eq(gameComments.id, commentId))
      .returning({ likesCount: gameComments.likesCount });
    return c.json({ liked: false, likesCount: row?.likesCount ?? 0 });
  });

  /** An author may delete anything in their own work's thread; anyone may delete their own. */
  authed.delete('/community/comments/:commentId', async (c) => {
    const jwt = c.get('jwt');
    const commentId = c.req.param('commentId');
    if (!UUID_RE.test(commentId)) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'comment not found'), 404);
    }
    const [row] = await db
      .select({ comment: gameComments, projectId: deployments.projectId })
      .from(gameComments)
      .innerJoin(deployments, eq(deployments.id, gameComments.deploymentId))
      .where(eq(gameComments.id, commentId))
      .limit(1);
    if (!row) return c.json(apiError(ErrorCode.NOT_FOUND, 'comment not found'), 404);

    let allowed = row.comment.userId === jwt.sub;
    if (!allowed) {
      const [proj] = await db
        .select({ organizationId: projects.organizationId })
        .from(projects)
        .where(eq(projects.id, row.projectId))
        .limit(1);
      if (proj) {
        const [member] = await db
          .select({ role: organizationMembers.role })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, proj.organizationId),
              eq(organizationMembers.userId, jwt.sub),
            ),
          )
          .limit(1);
        allowed = Boolean(member);
      }
    }
    if (!allowed) return c.json(apiError(ErrorCode.FORBIDDEN, 'not yours'), 403);

    await db.delete(gameComments).where(eq(gameComments.id, commentId));
    return c.json({ ok: true });
  });

  // 提交分数到排行榜
  authed.post('/community/games/:gameId/scores', async (c) => {
    const jwt = c.get('jwt');
    const gameId = c.req.param('gameId');
    const body = (await c.req.json()) as {
      score?: number;
      playerName?: string;
      metadata?: Record<string, any>;
    };

    const score = Math.round(Number(body.score));
    const playerName = body.playerName?.trim() || 'Anonymous';

    if (!Number.isFinite(score) || score < 0) {
      return c.json({ error: 'score must be a non-negative number' }, 400);
    }

    const [game] = await db.select().from(communityGames).where(eq(communityGames.id, gameId)).limit(1);
    if (!game) {
      return c.json({ error: 'game not found' }, 404);
    }

    const [entry] = await db
      .insert(gameLeaderboards)
      .values({
        deploymentId: game.deploymentId,
        userId: jwt.sub,
        playerName,
        score,
        metadata: body.metadata || {},
      })
      .returning();

    // 获取排名
    const [rankResult] = await db
      .select({ rank: sql<number>`COUNT(*)::int` })
      .from(gameLeaderboards)
      .where(
        and(
          eq(gameLeaderboards.deploymentId, game.deploymentId),
          sql`${gameLeaderboards.score} > ${score}`,
        ),
      );

    return c.json({ entry, rank: (rankResult?.rank || 0) + 1 });
  });

  // 获取游戏排行榜
  v1.get('/community/games/:gameId/leaderboard', async (c) => {
    const gameId = c.req.param('gameId');
    const limit = Math.min(Number(c.req.query('limit') || '10'), 100);

    const [game] = await db.select().from(communityGames).where(eq(communityGames.id, gameId)).limit(1);
    if (!game) {
      return c.json({ error: 'game not found' }, 404);
    }

    const leaderboard = await db
      .select({
        rank: sql<number>`ROW_NUMBER() OVER (ORDER BY ${gameLeaderboards.score} DESC, ${gameLeaderboards.achievedAt} ASC)`,
        playerName: gameLeaderboards.playerName,
        score: gameLeaderboards.score,
        metadata: gameLeaderboards.metadata,
        achievedAt: gameLeaderboards.achievedAt,
      })
      .from(gameLeaderboards)
      .where(eq(gameLeaderboards.deploymentId, game.deploymentId))
      .orderBy(desc(gameLeaderboards.score))
      .limit(limit);

    return c.json({ leaderboard });
  });

  // 获取所有标签
  v1.get('/community/tags', async (c) => {
    const tags = await db.select().from(gameTags).orderBy(gameTags.name);
    return c.json({ tags });
  });

  // ============================================================
  // P5 — Public ecosystem APIs (no JWT required, CORS-friendly).
  // These endpoints are intended for external embed sites + the upcoming
  // plugin marketplace. They are aggressively cached at the CDN layer (see
  // `Cache-Control` headers below) and never mutate user state.
  // ============================================================

  /** Public bench leaderboard: only rows flagged is_public=true. */
}
