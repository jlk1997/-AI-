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
  projectTemplates,
  jobDeadLetters,
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
import { getObjectUtf8, presignGetObject, putObjectBytes } from '../lib/s3.js';
import {
  parseWorkspaceManifest,
  readBuildCacheHit,
  workspaceArchiveManifestKey,
} from '../lib/workspaceArchiveStatus.js';
import { canRequeueJobStatus, insertRequeuedJob, isRequeueQuotaDenied } from '../lib/requeueJob.js';
import {
  assertCanEnqueueJob,
  insertChargedJob,
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
import { assertHourlyCap } from '../lib/actionGate.js';
import { bumpRemixCount } from '../lib/communityCounters.js';
import { listCommunityGamesPage } from '../lib/communityList.js';
import { subscribeSocietyFrames } from '../lib/societyFanout.js';
import { assertGeneratePrompt, assertPublishableCopy } from '../lib/ugcPolicy.js';
import { writeAudit } from '../lib/audit.js';
import {
  maskEmailForPeer,
  resolveInviteOrgRole,
  wantsAllMembershipProjects,
} from '../lib/orgAccess.js';
import { ensureOfficialTemplatePackages } from '../lib/templateCatalog.js';
import { handleStripeEvent } from './stripeWebhook.js';
import {
  COMMERCE,
  findCommunityByProject,
  loadPublishedWork,
  publicCommerceView,
  refundVisitorTransfer,
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
import { courseReturnHintsByDeployment } from '../lib/courseBoard.js';
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

export function registerProjectRoutes(
  v1: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  authed: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  ctx: V1RouteCtx,
): void {
  const { db, env, queue, s3 } = ctx;
  const deps = { redis: ctx.redis };
  const requireOrgAccess = ctx.requireOrgAccess;
  const optionalUserId = ctx.optionalUserId;
  const openProviderCheckout = ctx.openProviderCheckout;

  authed.get('/orgs', async (c) => {
    const jwt = c.get('jwt');
    const rows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
      .where(eq(organizationMembers.userId, jwt.sub));
    return c.json({ orgs: rows });
  });

  authed.post('/orgs', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json()) as { name?: string };
    const name = body.name?.trim();
    if (!name) {
      return c.json({ error: 'name required' }, 400);
    }
    const [org] = await db.insert(organizations).values({ name }).returning();
    if (!org) {
      return c.json({ error: 'failed' }, 500);
    }
    await db.insert(organizationMembers).values({
      organizationId: org.id,
      userId: jwt.sub,
      role: 'owner',
    });
    await db.insert(subscriptions).values({ organizationId: org.id }).onConflictDoNothing();
    return c.json({ id: org.id, name: org.name });
  });

  authed.get('/orgs/:orgId', async (c) => {
    const jwt = c.get('jwt');
    const orgId = c.req.param('orgId');
    const [m] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, jwt.sub),
        ),
      )
      .limit(1);
    if (!m) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    return org ? c.json(org) : c.json({ error: 'not found' }, 404);
  });

  authed.post('/projects', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json()) as {
      organizationId?: string;
      name?: string;
      archetype?: string;
    };
    const organizationId = resolveOrganizationId(body.organizationId, jwt.organizationId);
    if (!isOrganizationUuid(organizationId)) {
      return c.json({ error: 'invalid organization id' }, 400);
    }
    const name = body.name?.trim();
    if (!name) {
      return c.json({ error: 'name required' }, 400);
    }
    const [mem] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, jwt.sub),
        ),
      )
      .limit(1);
    if (!mem) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const [proj] = await db
      .insert(projects)
      .values({
        organizationId,
        name,
        archetype: body.archetype ?? 'platformer',
      })
      .returning();
    return proj ? c.json(proj) : c.json({ error: 'failed' }, 500);
  });

  authed.delete('/projects/:projectId', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const [pm] = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, jwt.sub),
        ),
      )
      .limit(1);
    if (!mem && !pm) {
      return c.json({ error: 'forbidden' }, 403);
    }
    try {
      await db.delete(projects).where(eq(projects.id, projectId));
    } catch (err) {
      console.error('delete project failed', projectId, err);
      return c.json({ error: 'failed to delete project' }, 500);
    }
    return c.json({ ok: true, projectId });
  });

  authed.get('/projects', async (c) => {
    const jwt = c.get('jwt');
    const rawOrg = c.req.query('organizationId');
    if (wantsAllMembershipProjects(rawOrg)) {
      const memberships = await db
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, jwt.sub));
      const orgIds = memberships.map((row) => row.organizationId);
      if (orgIds.length === 0) {
        return c.json({ projects: [] });
      }
      const list = await db
        .select()
        .from(projects)
        .where(inArray(projects.organizationId, orgIds))
        .orderBy(desc(projects.createdAt));
      return c.json({ projects: list });
    }
    const orgId = resolveOrganizationId(rawOrg, jwt.organizationId);
    if (!isOrganizationUuid(orgId)) {
      return c.json({ error: 'invalid organization id' }, 400);
    }
    const [mem] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, jwt.sub),
        ),
      )
      .limit(1);
    if (!mem) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const list = await db
      .select()
      .from(projects)
      .where(eq(projects.organizationId, orgId))
      .orderBy(desc(projects.createdAt));
    return c.json({ projects: list });
  });

  authed.get('/projects/:projectId', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const [pm] = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, jwt.sub),
        ),
      )
      .limit(1);
    if (!mem && !pm) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const [applied] = await db
      .select({
        templateId: projectTemplates.templateId,
        slug: templatePackages.slug,
        version: templatePackages.version,
        official: sql<boolean>`${templatePackages.organizationId} is null`,
        appliedAt: projectTemplates.createdAt,
      })
      .from(projectTemplates)
      .innerJoin(templatePackages, eq(projectTemplates.templateId, templatePackages.id))
      .where(eq(projectTemplates.projectId, projectId))
      .orderBy(desc(projectTemplates.createdAt))
      .limit(1);
    return c.json({
      ...proj,
      appliedTemplate: applied
        ? {
            templateId: applied.templateId,
            slug: applied.slug,
            version: applied.version,
            official: Boolean(applied.official),
            appliedAt: applied.appliedAt,
          }
        : null,
    });
  });

  authed.post('/projects/:projectId/messages', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = (await c.req.json()) as {
      content?: string;
      sessionId?: string;
      gameParams?: {
        theme?: string;
        variant?: string;
        /** Picked art style profile id (see world-spec `ArtStyleId`). */
        artStyleId?: string;
        worldPopulation?: number;
        societySeedHours?: number;
        worldBrief?: {
          packId?: 'society.town' | 'society.crew' | 'society.cloister';
          useCase?: string;
          venues?: string[];
          scale?: string;
          livedIn?: string;
          note?: string;
        };
        difficulty?: number;
        musicStyle?: string;
        effectsVolume?: number;
        gameSpeed?: number;
        lives?: number;
        timeLimit?: number;
      };
      images?: string[]; // base64 编码的图片
      /** game (default) | world | world_edit — world-model pipeline */
      mode?: 'game' | 'world' | 'world_edit';
      /** Structured world op for world_edit jobs */
      worldOp?: unknown;
    };
    const content = body.content?.trim();
    const hasImages = body.images && body.images.length > 0;
    if (!content && !hasImages) {
      return c.json({ error: 'content or images required' }, 400);
    }
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const ugc = assertGeneratePrompt(content);
    if (!ugc.ok) {
      await writeAudit(db, {
        action: 'generate.ugc_block',
        actorUserId: jwt.sub,
        organizationId: proj.organizationId,
        target: projectId,
        meta: { brand: ugc.brand },
      });
      return c.json(
        apiError(
          ErrorCode.INVALID_INPUT,
          `prompt looks like a licensed franchise (${ugc.brand})`,
          { brand: ugc.brand },
        ),
        400,
      );
    }
    // Resolved before the quota check because a world costs more than a game.
    const mode = body.mode ?? 'game';
    const looksLikeWorld =
      /\b(world model|persistent world|世界模型|生成世界|扩世界)\b/i.test(
        content ?? '',
      );
    let jobType = 'generate';
    if (mode === 'world') {
      jobType = 'world_generate';
    } else if (mode === 'world_edit') {
      jobType = 'world_edit';
    } else if (mode === 'game') {
      jobType = 'generate';
    } else if (looksLikeWorld) {
      jobType = 'world_generate';
    }

    const quota = await assertCanEnqueueJob(db, env, proj.organizationId, jobType);
    if (!quota.ok) {
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
    let sessionId = body.sessionId;
    let finalSessionId: string;
    if (!sessionId) {
      const [sess] = await db
        .insert(chatSessions)
        .values({ projectId, title: 'Chat' })
        .returning();
      if (!sess) {
        return c.json({ error: 'failed to create session' }, 500);
      }
      finalSessionId = sess.id;
    } else {
      const [sess] = await db
        .select()
        .from(chatSessions)
        .where(
          and(eq(chatSessions.id, sessionId), eq(chatSessions.projectId, projectId)),
        )
        .limit(1);
      if (!sess) {
        return c.json(
          {
            error: 'invalid session',
            code: 'INVALID_INPUT',
            details: { reason: 'session_not_found', sessionId },
          },
          400,
        );
      }
      finalSessionId = sessionId as string;
    }
    // 确保 finalSessionId 有值
    const insertSessionId: string = finalSessionId as string;
    await db.insert(chatMessages).values({
      sessionId: insertSessionId,
      role: 'user',
      content: content ?? (hasImages ? '[image]' : ''),
    } as any);
    const traceId = crypto.randomUUID();

    // 构建带游戏参数的 payload
    const jobPayload: Record<string, any> = { prompt: content };
    if (body.gameParams) {
      jobPayload.gameParams = body.gameParams;
    }
    // 添加图片到 payload
    if (body.images && body.images.length > 0) {
      jobPayload.images = body.images;
    }
    if (body.worldOp) {
      jobPayload.op = body.worldOp;
    }

    const charged = await insertChargedJob(
      db,
      env,
      {
        projectId,
        sessionId: finalSessionId,
        type: jobType,
        payload: jobPayload,
        traceId,
      },
      {
        organizationId: proj.organizationId,
        projectId,
        jobType,
      },
    );
    if (!charged.ok) {
      return c.json(apiError(ErrorCode.QUOTA_EXCEEDED, charged.message), 402);
    }
    const job = charged.job;
    await enqueuePlatformJob(queue, job.id);
    return c.json({ sessionId: finalSessionId, jobId: job.id, traceId, jobType });
  });

  authed.get('/projects/:projectId/chat-sessions', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.projectId, projectId))
      .orderBy(desc(chatSessions.createdAt));
    return c.json({ sessions });
  });

  authed.post('/projects/:projectId/chat-sessions', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = (await c.req.json().catch(() => ({}))) as { title?: string };
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const title = body.title?.trim() || 'Chat';
    const [sess] = await db.insert(chatSessions).values({ projectId, title }).returning();
    if (!sess) {
      return c.json({ error: 'failed' }, 500);
    }
    return c.json(sess);
  });

  authed.get('/projects/:projectId/chat-sessions/:sessionId/messages', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const [sess] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.projectId, projectId)))
      .limit(1);
    if (!sess) {
      return c.json({ error: 'not found' }, 404);
    }
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdAt));
    return c.json({ session: sess, messages });
  });

  authed.post('/projects/:projectId/chat-sessions/:sessionId/fork', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const sourceSessionId = c.req.param('sessionId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const [source] = await db
      .select()
      .from(chatSessions)
      .where(
        and(eq(chatSessions.id, sourceSessionId), eq(chatSessions.projectId, projectId)),
      )
      .limit(1);
    if (!source) {
      return c.json({ error: 'not found' }, 404);
    }
    const [newSess] = await db
      .insert(chatSessions)
      .values({
        projectId,
        parentId: source.id,
        title: `Fork · ${source.title ?? 'Chat'}`,
      })
      .returning();
    if (!newSess) {
      return c.json({ error: 'failed' }, 500);
    }
    const oldMsgs = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sourceSessionId))
      .orderBy(asc(chatMessages.createdAt));
    if (oldMsgs.length > 0) {
      await db.insert(chatMessages).values(
        oldMsgs.map((m) => ({
          sessionId: newSess.id,
          role: m.role,
          content: m.content,
        })),
      );
    }
    return c.json({ sessionId: newSess.id, session: newSess });
  });

  // 删除会话
  authed.delete('/projects/:projectId/chat-sessions/:sessionId', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');

    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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

    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.projectId, projectId)))
      .limit(1);
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }

    // 删除会话（级联删除消息）
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));

    return c.json({ ok: true });
  });

  authed.get('/projects/:projectId/deployments', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const list = await db
      .select()
      .from(deployments)
      .where(eq(deployments.projectId, projectId))
      .orderBy(desc(deployments.createdAt));
    return c.json({ deployments: list });
  });

  // -------- CDN / custom domain (ACME) --------
  authed.get('/deployments/:deploymentId/domain', async (c) => {
    const jwt = c.get('jwt');
    const deploymentId = c.req.param('deploymentId');
    const [dep] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .limit(1);
    if (!dep) {
      return c.json({ error: 'not found' }, 404);
    }
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, dep.projectId))
      .limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    return c.json({
      deploymentId,
      customDomain: dep.customDomain,
      verified: dep.customDomainVerified,
      acmeChallenge:
        dep.acmeChallengeName && dep.acmeChallengeValue
          ? {
              recordName: dep.acmeChallengeName,
              recordValue: dep.acmeChallengeValue,
              recordType: 'TXT',
            }
          : null,
      cdnUrl: dep.cdnUrl,
    });
  });

  /**
   * Step 1 of custom-domain onboarding: user enters a hostname; we issue a
   * DNS-01 challenge token (placeholder for the ACME `dns-01` order). The
   * actual ACME order is provisioned by an out-of-band worker reading
   * `acmeChallengeName/Value`; this endpoint just records the intent.
   */
  authed.post('/deployments/:deploymentId/domain/acme-init', async (c) => {
    const jwt = c.get('jwt');
    const deploymentId = c.req.param('deploymentId');
    const body = (await c.req.json()) as { customDomain?: string };
    const domain = body.customDomain?.trim().toLowerCase();
    if (!domain || !/^[a-z0-9][a-z0-9.-]{0,253}[a-z0-9]$/.test(domain) || !domain.includes('.')) {
      return c.json({ error: 'invalid customDomain' }, 400);
    }
    const [dep] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .limit(1);
    if (!dep) {
      return c.json({ error: 'not found' }, 404);
    }
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, dep.projectId))
      .limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    // 16-byte challenge token; user copies the TXT record into their DNS.
    const token = randomBytes(16).toString('base64url');
    const recordName = `_acme-challenge.${domain}`;
    await db
      .update(deployments)
      .set({
        customDomain: domain,
        customDomainVerified: false,
        acmeChallengeName: recordName,
        acmeChallengeValue: token,
      })
      .where(eq(deployments.id, deploymentId));
    return c.json({
      deploymentId,
      customDomain: domain,
      challenge: {
        recordName,
        recordValue: token,
        recordType: 'TXT',
        instructions:
          'Create a DNS TXT record with the above name and value, then call POST /deployments/:id/domain/verify to complete onboarding.',
      },
    });
  });

  /**
   * Step 2: we resolve the TXT record and, on match, flip
   * `customDomainVerified` and seed `cdnUrl`. CDN provisioning is delegated to
   * the deployment edge (Cloudflare / AWS) via `PLATFORM_CDN_BASE_URL` —
   * verification only proves the user controls the domain.
   */
  authed.post('/deployments/:deploymentId/domain/verify', async (c) => {
    const jwt = c.get('jwt');
    const deploymentId = c.req.param('deploymentId');
    const [dep] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .limit(1);
    if (!dep || !dep.customDomain || !dep.acmeChallengeName || !dep.acmeChallengeValue) {
      return c.json({ error: 'no pending challenge' }, 400);
    }
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, dep.projectId))
      .limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    let txt: string[][] = [];
    try {
      const dns = await import('node:dns/promises');
      txt = await dns.resolveTxt(dep.acmeChallengeName);
    } catch (err) {
      return c.json({
        ok: false,
        verified: false,
        reason: `DNS lookup failed: ${(err as Error).message}`,
      });
    }
    const flat = txt.map((parts) => parts.join('')).flat();
    const matched = flat.includes(dep.acmeChallengeValue);
    if (!matched) {
      return c.json({
        ok: false,
        verified: false,
        reason: 'TXT record not found or value mismatch',
        observed: flat.slice(0, 4),
      });
    }
    const cdnBase = process.env['PLATFORM_CDN_BASE_URL']?.trim();
    const cdnUrl = cdnBase
      ? `${cdnBase.replace(/\/$/, '')}/${dep.previewUrl ?? ''}`
      : `https://${dep.customDomain}/${(dep.previewUrl ?? '').split('/').pop() ?? ''}`;
    await db
      .update(deployments)
      .set({
        customDomainVerified: true,
        cdnUrl,
      })
      .where(eq(deployments.id, deploymentId));
    return c.json({ ok: true, verified: true, cdnUrl });
  });

  authed.get('/deployments/:deploymentId/preview-url', async (c) => {
    const jwt = c.get('jwt');
    const deploymentId = c.req.param('deploymentId');
    const [dep] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .limit(1);
    if (!dep?.previewUrl) {
      return c.json({ error: 'not found' }, 404);
    }
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, dep.projectId))
      .limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    // Prefer the user-configured CDN URL once the custom domain is verified.
    if (dep.cdnUrl && dep.customDomainVerified) {
      return c.json({
        url: dep.cdnUrl,
        expiresIn: null,
        source: 'cdn',
        projectId: dep.projectId,
      });
    }
    if (env.publicObjectBaseUrl) {
      const url = `${env.publicObjectBaseUrl.replace(/\/$/, '')}/${dep.previewUrl}`;
      return c.json({
        url,
        expiresIn: null,
        source: 'public-object',
        projectId: dep.projectId,
      });
    }
    let manifest: unknown;
    let storagePrefix: string | null = null;
    if (dep.artifactId) {
      const [art] = await db
        .select()
        .from(artifacts)
        .where(eq(artifacts.id, dep.artifactId))
        .limit(1);
      manifest = art?.manifest;
      storagePrefix = art?.storagePrefix ?? null;
    }
    const distPrefix = resolveDistPrefix(dep.previewUrl, manifest, storagePrefix);
    if (distPrefix) {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = signPreviewDistToken(env.jwtSecret, {
        v: 1,
        deploymentId,
        exp,
        distPrefix,
      });
      const url = buildPreviewProxyUrl(env, deploymentId, token);
      return c.json({
        url,
        expiresIn: 3600,
        source: 'preview-proxy',
        projectId: dep.projectId,
      });
    }
    const url = await presignGetObject(s3, env, dep.previewUrl, 3600);
    return c.json({
      url,
      expiresIn: 3600,
      source: 'presigned',
      projectId: dep.projectId,
    });
  });

  authed.post('/projects/:projectId/build', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const quota = await assertCanEnqueueJob(db, env, proj.organizationId, 'build');
    if (!quota.ok) return quotaDenied(c, quota);
    const traceId = crypto.randomUUID();
    const body = (await c.req.json().catch(() => ({}))) as { cacheKey?: string };
    const charged = await insertChargedJob(
      db,
      env,
      {
        projectId,
        type: 'build',
        payload: {},
        traceId,
        buildCacheKey: body.cacheKey ?? null,
      },
      {
        organizationId: proj.organizationId,
        projectId,
        jobType: 'build',
      },
    );
    if (!charged.ok) {
      return c.json(apiError(ErrorCode.QUOTA_EXCEEDED, charged.message), 402);
    }
    await enqueuePlatformJob(queue, charged.job.id);
    return c.json({ jobId: charged.job.id });
  });

  authed.post('/projects/:projectId/publish', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = (await c.req.json()) as { deploymentId?: string; artifactId?: string };
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const quota = await assertCanEnqueueJob(db, env, proj.organizationId, 'publish');
    if (!quota.ok) return quotaDenied(c, quota);
    const traceId = crypto.randomUUID();
    const charged = await insertChargedJob(
      db,
      env,
      {
        projectId,
        type: 'publish',
        payload: {
          deploymentId: body.deploymentId,
          artifactId: body.artifactId,
        },
        traceId,
      },
      {
        organizationId: proj.organizationId,
        projectId,
        jobType: 'publish',
      },
    );
    if (!charged.ok) {
      return c.json(apiError(ErrorCode.QUOTA_EXCEEDED, charged.message), 429);
    }
    await enqueuePlatformJob(queue, charged.job.id);
    return c.json({ jobId: charged.job.id });
  });

  authed.patch('/deployments/:deploymentId/domain', async (c) => {
    const jwt = c.get('jwt');
    const deploymentId = c.req.param('deploymentId');
    const body = (await c.req.json()) as {
      customDomain?: string;
      acmeChallengeName?: string;
      acmeChallengeValue?: string;
    };
    const domain = body.customDomain?.trim();
    if (!domain) {
      return c.json({ error: 'customDomain required' }, 400);
    }
    const [dep] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .limit(1);
    if (!dep) {
      return c.json({ error: 'not found' }, 404);
    }
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, dep.projectId))
      .limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    await db
      .update(deployments)
      .set({
        customDomain: domain,
        acmeChallengeName: body.acmeChallengeName ?? null,
        acmeChallengeValue: body.acmeChallengeValue ?? null,
        customDomainVerified: false,
      })
      .where(eq(deployments.id, deploymentId));
    await writeAudit(db, {
      action: 'deployment.domain',
      actorUserId: jwt.sub,
      organizationId: proj.organizationId,
      target: deploymentId,
      meta: { domain },
    });
    return c.json({ ok: true, deploymentId });
  });

  authed.post('/deployments/:deploymentId/rollback', async (c) => {
    const jwt = c.get('jwt');
    const deploymentId = c.req.param('deploymentId');
    const body = (await c.req.json()) as { artifactId?: string };
    const artifactId = body.artifactId?.trim();
    if (!artifactId) {
      return c.json({ error: 'artifactId required' }, 400);
    }
    const [dep] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .limit(1);
    if (!dep) {
      return c.json({ error: 'not found' }, 404);
    }
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, dep.projectId))
      .limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const [art] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, artifactId))
      .limit(1);
    if (!art) {
      return c.json({ error: 'artifact not found' }, 404);
    }
    await db
      .update(deployments)
      .set({
        artifactId,
        productionUrl: art.storagePrefix,
      })
      .where(eq(deployments.id, deploymentId));
    return c.json({ ok: true });
  });

  authed.get('/templates', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (organizationId instanceof Response) return organizationId;
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
            : or(
                eq(templatePackages.isPublic, true),
                eq(templatePackages.organizationId, organizationId),
              ),
      )
      .orderBy(desc(templatePackages.createdAt))
      .limit(80);
    return c.json({
      channel: channel === 'official' || channel === 'community' ? channel : 'all',
      templates: rows.map((row) => ({
        ...row,
        official: row.organizationId == null,
      })),
    });
  });

  authed.get('/projects/:projectId/templates', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) return c.json({ error: 'not found' }, 404);
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
    if (!mem) return c.json({ error: 'forbidden' }, 403);
    const applied = await db
      .select({
        templateId: projectTemplates.templateId,
        slug: templatePackages.slug,
        version: templatePackages.version,
        official: sql<boolean>`${templatePackages.organizationId} is null`,
        appliedAt: projectTemplates.createdAt,
      })
      .from(projectTemplates)
      .innerJoin(templatePackages, eq(projectTemplates.templateId, templatePackages.id))
      .where(eq(projectTemplates.projectId, projectId))
      .orderBy(desc(projectTemplates.createdAt));
    const active = applied[0] ?? null;
    const versions = active
      ? await db
          .select({
            id: templatePackages.id,
            version: templatePackages.version,
            createdAt: templatePackages.createdAt,
          })
          .from(templatePackages)
          .where(eq(templatePackages.slug, active.slug))
          .orderBy(desc(templatePackages.createdAt))
      : [];
    return c.json({
      applied: active,
      versions,
      rescaffoldRequestedAt: proj.rescaffoldRequestedAt,
    });
  });

  authed.post('/projects/:projectId/templates/rescaffold', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = (await c.req.json().catch(() => ({}))) as { cancel?: boolean };
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) return c.json(apiError(ErrorCode.NOT_FOUND, 'not found'), 404);
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
    if (!mem) return c.json(apiError(ErrorCode.FORBIDDEN, 'forbidden'), 403);
    if (!orgRoleAtLeast(mem.role, 'admin')) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'owner or admin role required'), 403);
    }
    if (body.cancel) {
      await db
        .update(projects)
        .set({ rescaffoldRequestedAt: null })
        .where(eq(projects.id, projectId));
      await writeAudit(db, {
        action: 'template.rescaffold.cancel',
        actorUserId: jwt.sub,
        organizationId: proj.organizationId,
        target: projectId,
      });
      return c.json({
        ok: true,
        cancelled: true,
        previewPreserved: true,
        rescaffoldRequestedAt: null,
      });
    }
    const [pin] = await db
      .select({ templateId: projectTemplates.templateId })
      .from(projectTemplates)
      .where(eq(projectTemplates.projectId, projectId))
      .limit(1);
    if (!pin) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'pin a template first'), 400);
    }
    const [busy] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.projectId, projectId), inArray(jobs.status, ['queued', 'running'])))
      .limit(1);
    if (busy) {
      return c.json(apiError(ErrorCode.CONFLICT, 'wait for the running job to finish'), 409);
    }
    const stamp = new Date();
    await db
      .update(projects)
      .set({ rescaffoldRequestedAt: stamp })
      .where(eq(projects.id, projectId));
    await writeAudit(db, {
      action: 'template.rescaffold',
      actorUserId: jwt.sub,
      organizationId: proj.organizationId,
      target: projectId,
      meta: { templateId: pin.templateId },
    });
    return c.json({
      ok: true,
      cancelled: false,
      previewPreserved: true,
      takesEffectOnNextGenerate: true,
      rescaffoldRequestedAt: stamp.toISOString(),
    });
  });

  authed.get('/projects/:projectId/bench-runs', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) return c.json({ error: 'not found' }, 404);
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
    if (!mem) return c.json({ error: 'forbidden' }, 403);
    const runs = await db
      .select()
      .from(benchRuns)
      .where(eq(benchRuns.projectId, projectId))
      .orderBy(desc(benchRuns.createdAt))
      .limit(20);
    return c.json({ runs });
  });

  authed.get('/projects/:projectId/dead-letters', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) return c.json({ error: 'not found' }, 404);
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
    if (!mem) return c.json({ error: 'forbidden' }, 403);
    const letters = await db
      .select()
      .from(jobDeadLetters)
      .where(eq(jobDeadLetters.projectId, projectId))
      .orderBy(desc(jobDeadLetters.createdAt))
      .limit(30);
    return c.json({ letters });
  });

  authed.post('/projects/:projectId/dead-letters/:letterId/requeue', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const letterId = c.req.param('letterId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) return c.json(apiError(ErrorCode.NOT_FOUND, 'not found'), 404);
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
    if (!mem) return c.json(apiError(ErrorCode.FORBIDDEN, 'forbidden'), 403);
    const [letter] = await db
      .select()
      .from(jobDeadLetters)
      .where(and(eq(jobDeadLetters.id, letterId), eq(jobDeadLetters.projectId, projectId)))
      .limit(1);
    if (!letter) return c.json(apiError(ErrorCode.NOT_FOUND, 'not found'), 404);
    if (!letter.jobId) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'dead letter has no source job'), 400);
    }
    const [oldJob] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, letter.jobId), eq(jobs.projectId, projectId)))
      .limit(1);
    if (!oldJob) return c.json(apiError(ErrorCode.NOT_FOUND, 'source job missing'), 404);
    if (!canRequeueJobStatus(oldJob.status)) {
      return c.json(apiError(ErrorCode.CONFLICT, 'source job is still running'), 409);
    }
    const quota = await assertCanEnqueueJob(db, env, proj.organizationId);
    if (!quota.ok) return quotaDenied(c, quota);
    const queued = await insertRequeuedJob(db, queue, oldJob, {
      deadLetterId: letterId,
      quota: { env, organizationId: proj.organizationId, jobType: oldJob.type },
    });
    if (isRequeueQuotaDenied(queued)) return quotaDenied(c, { ok: false, ...queued });
    if (queued.already) {
      return c.json(apiError(ErrorCode.CONFLICT, 'already requeued', { jobId: queued.jobId }), 409);
    }
    await writeAudit(db, {
      action: 'job.dead_letter.requeue',
      actorUserId: jwt.sub,
      organizationId: proj.organizationId,
      target: projectId,
      meta: { letterId, fromJobId: oldJob.id, jobId: queued.jobId },
    });
    return c.json({ ...queued, letterId, previewPreserved: true });
  });

  authed.get('/projects/:projectId/build-cache', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) return c.json(apiError(ErrorCode.NOT_FOUND, 'not found'), 404);
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
    if (!mem) return c.json(apiError(ErrorCode.FORBIDDEN, 'forbidden'), 403);
    const rows = await db
      .select({
        id: jobs.id,
        status: jobs.status,
        buildCacheKey: jobs.buildCacheKey,
        result: jobs.result,
        createdAt: jobs.createdAt,
      })
      .from(jobs)
      .where(and(eq(jobs.projectId, projectId), eq(jobs.type, 'build')))
      .orderBy(desc(jobs.createdAt))
      .limit(8);
    return c.json({
      builds: rows.map((row) => ({
        jobId: row.id,
        status: row.status,
        contentHash: row.buildCacheKey,
        cacheHit: readBuildCacheHit(row.result),
        createdAt: row.createdAt,
      })),
    });
  });

  authed.get('/projects/:projectId/workspace-archive', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) return c.json(apiError(ErrorCode.NOT_FOUND, 'not found'), 404);
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
    if (!mem) return c.json(apiError(ErrorCode.FORBIDDEN, 'forbidden'), 403);
    const key = workspaceArchiveManifestKey(env.workspaceArchiveKeyPrefix, projectId);
    if (!key) {
      return c.json({
        enabled: false,
        savedAt: null,
        fileCount: 0,
        key: null,
      });
    }
    let raw: string | null = null;
    try {
      raw = await getObjectUtf8(s3, env, key);
    } catch (err) {
      console.error('[workspace-archive] S3 get failed', projectId, err);
    }
    if (!raw) {
      return c.json({
        enabled: true,
        savedAt: null,
        fileCount: 0,
        key,
      });
    }
    const parsed = parseWorkspaceManifest(raw);
    return c.json({
      enabled: true,
      savedAt: parsed.savedAt,
      fileCount: parsed.fileCount,
      key,
    });
  });

  authed.get('/projects/:projectId/members', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const [pm] = await db
      .select()
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, jwt.sub)),
      )
      .limit(1);
    if (!mem && !pm) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const canInvite = Boolean(mem && orgRoleAtLeast(mem.role, 'admin'));
    const rows = await db
      .select({
        userId: users.id,
        email: users.email,
        handle: users.handle,
        displayName: users.displayName,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, proj.organizationId),
          isNull(users.deletedAt),
        ),
      );
    return c.json({
      organizationId: proj.organizationId,
      canInvite,
      members: rows.map((row) => ({
        userId: row.userId,
        email: maskEmailForPeer(row.email, canInvite),
        handle: row.handle,
        displayName: row.displayName,
        role: row.role,
      })),
    });
  });

  authed.post('/projects/:projectId/members', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = (await c.req.json()) as { email?: string; role?: string };
    const email = normalizeEmail(body.email ?? '');
    if (!email || !isEmailish(email)) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'A valid email is required'), 400);
    }
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const requested = resolveInviteOrgRole(body.role);
    if (requested === 'admin' && !orgRoleAtLeast(mem.role, 'owner')) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'only the owner can invite an admin'), 403);
    }
    const [target] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    if (!target) {
      return c.json(
        apiError(ErrorCode.NOT_FOUND, 'user not found; they must sign in once first'),
        404,
      );
    }
    const [existing] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, proj.organizationId),
          eq(organizationMembers.userId, target.id),
        ),
      )
      .limit(1);
    if (existing && orgRoleAtLeast(existing.role, 'owner')) {
      // Never demote the org owner through invite.
    } else if (existing && existing.role === 'admin' && requested === 'member') {
      // Keep a higher seat unless an owner is explicitly promoting/demoting later.
    } else if (!existing) {
      await db
        .insert(organizationMembers)
        .values({
          organizationId: proj.organizationId,
          userId: target.id,
          role: requested,
        })
        .onConflictDoNothing();
    } else if (requested === 'admin' && existing.role !== 'admin') {
      await db
        .update(organizationMembers)
        .set({ role: 'admin' })
        .where(
          and(
            eq(organizationMembers.organizationId, proj.organizationId),
            eq(organizationMembers.userId, target.id),
          ),
        );
    }
    await db
      .insert(projectMembers)
      .values({
        projectId,
        userId: target.id,
        role: body.role === 'viewer' ? 'viewer' : 'editor',
      })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: { role: body.role === 'viewer' ? 'viewer' : 'editor' },
      });
    const [after] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, proj.organizationId),
          eq(organizationMembers.userId, target.id),
        ),
      )
      .limit(1);
    await writeAudit(db, {
      action: 'org.invite',
      actorUserId: jwt.sub,
      organizationId: proj.organizationId,
      target: target.id,
      meta: { projectId, email, role: after?.role ?? requested },
    });
    return c.json({
      ok: true,
      userId: target.id,
      organizationId: proj.organizationId,
      role: after?.role ?? requested,
    });
  });

  authed.post('/projects/:projectId/bench', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) {
      return c.json({ error: 'not found' }, 404);
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
    const quota = await assertCanEnqueueJob(db, env, proj.organizationId, 'bench');
    if (!quota.ok) return quotaDenied(c, quota);
    const traceId = crypto.randomUUID();
    const body = (await c.req.json().catch(() => ({}))) as {
      publish?: boolean;
      label?: string;
    };
    const charged = await insertChargedJob(
      db,
      env,
      {
        projectId,
        type: 'bench',
        payload: {
          publish: Boolean(body.publish),
          label: body.label?.trim() || undefined,
        },
        traceId,
      },
      {
        organizationId: proj.organizationId,
        projectId,
        jobType: 'bench',
      },
    );
    if (!charged.ok) {
      return c.json(apiError(ErrorCode.QUOTA_EXCEEDED, charged.message), 402);
    }
    await enqueuePlatformJob(queue, charged.job.id);
    return c.json({ jobId: charged.job.id });
  });

  // ============================================
  // 社区 API
  // ============================================

  // 发布游戏到社区
  /**
   * Remix/Fork：一键克隆一个社区游戏到当前用户的组织。
   * 步骤：
   *   1. 解析源 deployment 与其 project
   *   2. 在调用方的默认组织里创建新 project，写入 parent_project_id
   *   3. 复制源 artifact 的 storage_prefix 引用为新 deployment（即时可玩）
   *   4. 在 project_remixes 中记录一条 fork 记录
   *
   * 注意：本端点不复制源工作区源码（那需要更复杂的 worker 跑批），只为
   * 调用方建立一个"基于父项目继续生成"的新会话起点。后续用户的对话生成
   * 会按正常 FSM 跑，但已经携带 parent_project_id 作为上下文。
   */
  authed.post('/projects/:projectId/fork', async (c) => {
    const jwt = c.get('jwt');
    const sourceProjectId = c.req.param('projectId');
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      note?: string;
      sourceDeploymentId?: string;
    };
    const [source] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, sourceProjectId))
      .limit(1);
    if (!source) {
      return c.json({ error: 'source project not found' }, 404);
    }
    const userOrgs = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, jwt.sub));
    const targetOrg = userOrgs[0];
    if (!targetOrg) {
      return c.json({ error: 'no organization membership' }, 403);
    }
    const published = await findCommunityByProject(db, source.id);
    const sourceMember = userOrgs.some((row) => row.organizationId === source.organizationId);
    if (published) {
      if (!isRemixAllowed(published.license)) {
        return c.json(
          apiError(ErrorCode.FORBIDDEN, 'the author has not opened this work to remixes', {
            license: normalizeLicense(published.license),
          }),
          403,
        );
      }
      if (!(await assertHourlyCap(deps.redis, `fork:${jwt.sub}`, 8))) {
        return c.json(
          apiError(ErrorCode.RATE_LIMITED, 'too many remixes this hour — play one first'),
          429,
        );
      }
    } else if (!sourceMember) {
      return c.json({ error: 'source project not found' }, 404);
    }
    const [newProject] = await db
      .insert(projects)
      .values({
        organizationId: targetOrg.organizationId,
        name: body.name?.trim() ?? `${source.name} (fork)`,
        archetype: source.archetype,
        templateVersion: source.templateVersion,
        runtimeVersion: source.runtimeVersion,
        parentProjectId: source.id,
      })
      .returning();
    if (!newProject) {
      return c.json({ error: 'failed to create project' }, 500);
    }
    // 找最新可用 deployment 作为 fork 起点
    const sourceDeploymentId = body.sourceDeploymentId?.trim();
    let sourceDep:
      | (typeof deployments.$inferSelect | undefined) = undefined;
    if (sourceDeploymentId) {
      const [dep] = await db
        .select()
        .from(deployments)
        .where(eq(deployments.id, sourceDeploymentId))
        .limit(1);
      sourceDep = dep;
    }
    if (!sourceDep) {
      const [dep] = await db
        .select()
        .from(deployments)
        .where(eq(deployments.projectId, source.id))
        .orderBy(desc(deployments.createdAt))
        .limit(1);
      sourceDep = dep;
    }
    let newDeploymentId: string | null = null;
    if (sourceDep?.previewUrl) {
      const [newDep] = await db
        .insert(deployments)
        .values({
          projectId: newProject.id,
          artifactId: sourceDep.artifactId ?? null,
          channel: 'preview',
          previewUrl: sourceDep.previewUrl,
          status: 'active',
        })
        .returning();
      newDeploymentId = newDep?.id ?? null;
    }
    await db.insert(projectRemixes).values({
      childProjectId: newProject.id,
      parentProjectId: source.id,
      sourceDeploymentId: sourceDep?.id ?? null,
      forkedByUserId: jwt.sub,
      note: body.note ?? null,
    });
    return c.json({
      project: newProject,
      deploymentId: newDeploymentId,
      sourceProjectId: source.id,
      sourceDeploymentId: sourceDep?.id ?? null,
    });
  });

  /**
   * Convenience: fork by community-game slug rather than internal projectId.
   * Used by the Community → Game Detail page's "Remix" button.
   */
  /**
   * "Change one line, make it yours." The optional `line` is stored as the
   * remix note and echoed back so the studio can prefill the chat with it.
   * For worlds we copy the Spec too — a fork with no world could not answer a
   * `world_edit`, which is the whole point of remixing a town.
   */
  authed.post('/community/games/:slugOrId/fork', async (c) => {
    const jwt = c.get('jwt');
    const slugOrId = c.req.param('slugOrId');
    const body = (await c.req.json().catch(() => ({}))) as {
      line?: string;
      branch?: boolean;
    };
    const line = body.line?.trim().slice(0, 400) || null;
    let [game] = await db
      .select()
      .from(communityGames)
      .where(eq(communityGames.slug, slugOrId))
      .limit(1);
    if (!game) {
      [game] = await db
        .select()
        .from(communityGames)
        .where(eq(communityGames.id, slugOrId))
        .limit(1);
    }
    if (!game) {
      return c.json({ error: 'community game not found' }, 404);
    }
    /*
     * The licence gate. Visitors never receive the source, so a fork is the
     * only way one person's work becomes another's — which makes this the
     * single place where the author's choice has to hold.
     */
    if (!isRemixAllowed(game.license)) {
      return c.json(
        apiError(ErrorCode.FORBIDDEN, 'the author has not opened this work to remixes', {
          license: normalizeLicense(game.license),
        }),
        403,
      );
    }
    const forkOk = await assertHourlyCap(deps.redis, `fork:${jwt.sub}`, 8);
    if (!forkOk) {
      return c.json(
        apiError(ErrorCode.RATE_LIMITED, 'too many remixes this hour — play one first'),
        429,
      );
    }
    let branchPaid:
      | (Awaited<ReturnType<typeof transferToAuthor>> & {
          readonly fromOrgId: string;
          readonly toOrgId: string;
        })
      | null = null;
    if (body.branch) {
      const organizationId = await requireOrgAccess(c);
      if (typeof organizationId !== 'string') return organizationId;
      const work = await loadPublishedWork(db, game.id);
      if (!work) {
        return c.json(apiError(ErrorCode.NOT_FOUND, 'community game not found'), 404);
      }
      const paid = await transferToAuthor(db, {
        fromOrgId: organizationId,
        toOrgId: work.authorOrgId,
        userId: jwt.sub,
        gameId: game.id,
        kind: 'remix_branch',
        points: COMMERCE.remixBranch,
        note: '残局续写',
        meta: { line },
      });
      if (!paid.ok) {
        return c.json(
          apiError(ErrorCode.QUOTA_EXCEEDED, 'not enough points', paywallDetails(paid.need)),
          402,
        );
      }
      branchPaid = { ...paid, fromOrgId: organizationId, toOrgId: work.authorOrgId };
    }
    const refundRemixBranch = async (note: string) => {
      if (!branchPaid?.ok) return;
      await refundVisitorTransfer(db, {
        fromOrgId: branchPaid.fromOrgId,
        toOrgId: branchPaid.toOrgId,
        gameId: game.id,
        kind: 'remix_branch',
        charged: branchPaid.charged,
        authorPoints: branchPaid.authorPoints,
        note,
      });
    };
    const [dep] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, game.deploymentId))
      .limit(1);
    if (!dep) {
      await refundRemixBranch('残局续写未落到部署');
      return c.json({ error: 'deployment not found' }, 404);
    }
    const userOrgs = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, jwt.sub));
    const targetOrg = userOrgs[0];
    if (!targetOrg) {
      await refundRemixBranch('残局续写未落到组织');
      return c.json({ error: 'no organization membership' }, 403);
    }
    const [source] = await db.select().from(projects).where(eq(projects.id, dep.projectId)).limit(1);
    if (!source) {
      await refundRemixBranch('残局续写未落到源项目');
      return c.json({ error: 'source project not found' }, 404);
    }
    const [newProject] = await db
      .insert(projects)
      .values({
        organizationId: targetOrg.organizationId,
        name: `${game.title} (Remix)`,
        archetype: source.archetype,
        templateVersion: source.templateVersion,
        runtimeVersion: source.runtimeVersion,
        parentProjectId: source.id,
      })
      .returning();
    if (!newProject) {
      await refundRemixBranch('残局续写未落到项目');
      return c.json({ error: 'failed to create project' }, 500);
    }
    const [newDep] = await db
      .insert(deployments)
      .values({
        projectId: newProject.id,
        artifactId: dep.artifactId ?? null,
        channel: 'preview',
        previewUrl: dep.previewUrl ?? null,
        status: 'active',
      })
      .returning();
    await db.insert(projectRemixes).values({
      childProjectId: newProject.id,
      parentProjectId: source.id,
      sourceDeploymentId: dep.id,
      forkedByUserId: jwt.sub,
      note: line
        ? `Remix of ${game.slug}: ${line}`
        : `Remix of community game ${game.slug}`,
    });

    // Copy the world document so the fork can answer a `world_edit` right away.
    const [sourceWorld] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, source.id))
      .limit(1);
    let worldCopied = false;
    if (sourceWorld) {
      const [copied] = await db
        .insert(worlds)
        .values({
          projectId: newProject.id,
          title: sourceWorld.title,
          tipRevision: 1,
          specJson: sourceWorld.specJson,
          memoryJson: sourceWorld.memoryJson,
        })
        .returning();
      if (copied) {
        await db.insert(worldRevisions).values({
          worldId: copied.id,
          revision: 1,
          parentRevision: null,
          opJson: { op: 'fork', from: game.slug, line },
          specJson: sourceWorld.specJson,
          summary: line ? `fork: ${line}` : `fork of ${game.slug}`,
        });
        worldCopied = true;
      }
    }

    // Shown on the parent's work page: being remixed is a credential, not a loss.
    await bumpRemixCount(db, game.id);

    return c.json({
      project: newProject,
      deploymentId: newDep?.id ?? null,
      sourceProjectId: source.id,
      sourceDeploymentId: dep.id,
      kind: game.category === 'world' ? 'world' : 'game',
      worldCopied,
      line,
      license: normalizeLicense(game.license),
      creditRequired: normalizeLicense(game.license) === 'remix-credit',
    });
  });

  // --------- Player Saves / Achievements / Profile ---------

  /** Upsert one save slot for the calling user on a published deployment. */
  authed.put('/deployments/:deploymentId/saves/:slot', async (c) => {
    const jwt = c.get('jwt');
    const deploymentId = c.req.param('deploymentId');
    const slot = c.req.param('slot');
    const body = (await c.req.json().catch(() => ({}))) as { payload?: unknown };
    if (body.payload === undefined) {
      return c.json({ error: 'payload required' }, 400);
    }
    const [dep] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .limit(1);
    if (!dep) {
      return c.json({ error: 'deployment not found' }, 404);
    }
    // Try update first; if no row, insert.
    const [existing] = await db
      .select()
      .from(playerSaves)
      .where(
        and(
          eq(playerSaves.deploymentId, deploymentId),
          eq(playerSaves.userId, jwt.sub),
          eq(playerSaves.slot, slot),
        ),
      )
      .limit(1);
    if (existing) {
      await db
        .update(playerSaves)
        .set({ payload: body.payload as never, updatedAt: new Date() })
        .where(eq(playerSaves.id, existing.id));
      return c.json({ ok: true, id: existing.id, updated: true });
    }
    const [inserted] = await db
      .insert(playerSaves)
      .values({
        deploymentId,
        userId: jwt.sub,
        slot,
        payload: body.payload as never,
      })
      .returning();
    return c.json({ ok: true, id: inserted?.id, created: true });
  });

  authed.get('/deployments/:deploymentId/saves/:slot', async (c) => {
    const jwt = c.get('jwt');
    const deploymentId = c.req.param('deploymentId');
    const slot = c.req.param('slot');
    const [row] = await db
      .select()
      .from(playerSaves)
      .where(
        and(
          eq(playerSaves.deploymentId, deploymentId),
          eq(playerSaves.userId, jwt.sub),
          eq(playerSaves.slot, slot),
        ),
      )
      .limit(1);
    if (!row) {
      return c.json({ payload: null, found: false });
    }
    return c.json({ payload: row.payload, found: true, updatedAt: row.updatedAt });
  });

  authed.delete('/deployments/:deploymentId/saves/:slot', async (c) => {
    const jwt = c.get('jwt');
    const deploymentId = c.req.param('deploymentId');
    const slot = c.req.param('slot');
    await db
      .delete(playerSaves)
      .where(
        and(
          eq(playerSaves.deploymentId, deploymentId),
          eq(playerSaves.userId, jwt.sub),
          eq(playerSaves.slot, slot),
        ),
      );
    return c.json({ ok: true });
  });

  /** Award an achievement (idempotent on user+deployment+key). */
  authed.post('/deployments/:deploymentId/achievements', async (c) => {
    const jwt = c.get('jwt');
    const deploymentId = c.req.param('deploymentId');
    const body = (await c.req.json().catch(() => ({}))) as {
      achievementKey?: string;
      title?: string;
      description?: string;
      iconUrl?: string;
      progress?: number;
    };
    const key = body.achievementKey?.trim();
    const title = body.title?.trim();
    if (!key || !title) {
      return c.json({ error: 'achievementKey and title required' }, 400);
    }
    const [existing] = await db
      .select()
      .from(achievements)
      .where(
        and(
          eq(achievements.userId, jwt.sub),
          eq(achievements.deploymentId, deploymentId),
          eq(achievements.achievementKey, key),
        ),
      )
      .limit(1);
    if (existing) {
      const nextProgress = Math.max(existing.progress, body.progress ?? existing.progress);
      await db
        .update(achievements)
        .set({ progress: nextProgress })
        .where(eq(achievements.id, existing.id));
      return c.json({ ok: true, awarded: false, id: existing.id, progress: nextProgress });
    }
    const [inserted] = await db
      .insert(achievements)
      .values({
        userId: jwt.sub,
        deploymentId,
        achievementKey: key,
        title,
        description: body.description ?? null,
        iconUrl: body.iconUrl ?? null,
        progress: body.progress ?? 1,
      })
      .returning();
    return c.json({ ok: true, awarded: true, id: inserted?.id });
  });

  /** Aggregated player profile: identity, saves count, achievements, recent games. */
  authed.get('/me/profile', async (c) => {
    const jwt = c.get('jwt');
    const [savesCountRow] = await db
      .select({ value: count() })
      .from(playerSaves)
      .where(eq(playerSaves.userId, jwt.sub));
    const achievementsList = await db
      .select()
      .from(achievements)
      .where(eq(achievements.userId, jwt.sub))
      .orderBy(desc(achievements.awardedAt))
      .limit(50);
    const recentSaves = await db
      .select()
      .from(playerSaves)
      .where(eq(playerSaves.userId, jwt.sub))
      .orderBy(desc(playerSaves.updatedAt))
      .limit(20);
    const [me] = await db.select().from(users).where(eq(users.id, jwt.sub)).limit(1);
    return c.json({
      userId: jwt.sub,
      savesCount: savesCountRow?.value ?? 0,
      achievements: achievementsList,
      recentSaves,
      profile: me
        ? {
            userId: me.id,
            email: me.email,
            handle: me.handle,
            displayName: publicAuthorOf(me).displayName,
            avatarUrl: me.avatarUrl,
            bio: me.bio,
            createdAt: me.createdAt,
          }
        : null,
    });
  });

  /** Editable public identity. Handle is the address of `/u/:handle`. */
  authed.patch('/me/profile', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json().catch(() => ({}))) as {
      handle?: string | null;
      displayName?: string | null;
      avatarUrl?: string | null;
      bio?: string | null;
    };
    const patch: Record<string, string | null> = {};
    if (body.handle !== undefined) {
      const raw = body.handle?.trim() ?? '';
      if (raw.length === 0) {
        patch['handle'] = null;
      } else if (!isValidHandle(raw)) {
        return c.json({ error: 'invalid handle' }, 400);
      } else {
        patch['handle'] = normalizeHandle(raw);
      }
    }
    if (body.displayName !== undefined) {
      const raw = body.displayName?.trim() ?? '';
      if (raw.length > 40) return c.json({ error: 'displayName too long' }, 400);
      patch['displayName'] = raw.length > 0 ? raw : null;
    }
    if (body.avatarUrl !== undefined) {
      const raw = body.avatarUrl?.trim() ?? '';
      if (raw.length === 0) {
        patch['avatarUrl'] = null;
      } else if (!/^https?:\/\//i.test(raw) || raw.length > 500) {
        return c.json({ error: 'avatarUrl must be a http(s) url' }, 400);
      } else {
        patch['avatarUrl'] = raw;
      }
    }
    if (body.bio !== undefined) {
      const raw = body.bio?.trim() ?? '';
      if (raw.length > 280) return c.json({ error: 'bio too long' }, 400);
      patch['bio'] = raw.length > 0 ? raw : null;
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ error: 'nothing to update' }, 400);
    }
    try {
      const [row] = await db
        .update(users)
        .set(patch)
        .where(eq(users.id, jwt.sub))
        .returning();
      if (!row) return c.json({ error: 'user not found' }, 404);
      return c.json({
        profile: {
          userId: row.id,
          email: row.email,
          handle: row.handle,
          displayName: publicAuthorOf(row).displayName,
          avatarUrl: row.avatarUrl,
          bio: row.bio,
          createdAt: row.createdAt,
        },
      });
    } catch (err) {
      // Unique index on users.handle — surface it as "taken", not a 500.
      const text = err instanceof Error ? err.message : String(err);
      if (/users_handle_uq|duplicate key/i.test(text)) {
        return c.json({ error: 'handle taken' }, 409);
      }
      throw err;
    }
  });

  /** My library: published games / published worlds / unpublished / remixes. */
  authed.get('/me/works', async (c) => {
    const jwt = c.get('jwt');
    const works = await listMyWorks(db, jwt.sub);
    return c.json(works);
  });

  /** What I opened in Community (games played, towns watched). */
  authed.get('/me/history', async (c) => {
    const jwt = c.get('jwt');
    const history = await listPlayHistory(db, jwt.sub, 24);
    return c.json({ history });
  });

  /** Public author page. Unauthenticated on purpose — it is a shareable page. */
  v1.get('/users/:handle', async (c) => {
    const profile = await publicProfileByHandle(db, c.req.param('handle'));
    if (!profile) return c.json({ error: 'profile not found' }, 404);
    const viewerId = await optionalUserId(c);
    const counts = await followCounts(db, profile.userId, viewerId);
    return c.json({ ...profile, ...counts });
  });

  // --------- Following a person ---------
  //
  // Following a town says "tell me what happened here"; following an author
  // says "tell me what they make next". The second is what survives a work
  // being finished, so it is what the feed below is built on.

  authed.post('/users/:handle/follow', async (c) => {
    const jwt = c.get('jwt');
    const profile = await publicProfileByHandle(db, c.req.param('handle'));
    if (!profile) return c.json(apiError(ErrorCode.NOT_FOUND, 'profile not found'), 404);
    if (profile.userId === jwt.sub) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'You already know your work'), 400);
    }
    await followAuthor(db, jwt.sub, profile.userId);
    // `viewerFollows` inside the counts is the answer; a second boolean here
    // would just be a chance for the two to disagree.
    return c.json({ ok: true, ...(await followCounts(db, profile.userId, jwt.sub)) });
  });

  authed.delete('/users/:handle/follow', async (c) => {
    const jwt = c.get('jwt');
    const profile = await publicProfileByHandle(db, c.req.param('handle'));
    if (!profile) return c.json(apiError(ErrorCode.NOT_FOUND, 'profile not found'), 404);
    await unfollowAuthor(db, jwt.sub, profile.userId);
    return c.json({ ok: true, ...(await followCounts(db, profile.userId, jwt.sub)) });
  });

  v1.get('/users/:handle/followers', async (c) => {
    const profile = await publicProfileByHandle(db, c.req.param('handle'));
    if (!profile) return c.json(apiError(ErrorCode.NOT_FOUND, 'profile not found'), 404);
    const [followers, following] = await Promise.all([
      listFollowers(db, profile.userId, 60),
      listFollowing(db, profile.userId, 60),
    ]);
    return c.json({ followers, following });
  });

  /** Everything the people and towns I follow have been up to. */
  authed.get('/me/feed', async (c) => {
    const jwt = c.get('jwt');
    const limit = Number(c.req.query('limit') ?? '24');
    const items = await listFollowingFeed(db, jwt.sub, limit);
    const locale = (c.req.header('accept-language') ?? '').toLowerCase().startsWith('en')
      ? 'en'
      : 'zh-CN';
    const worldDepIds = [
      ...new Set(
        items
          .filter((item): item is Extract<(typeof items)[number], { kind: 'world' }> =>
            item.kind === 'world',
          )
          .map((item) => item.beat.deploymentId),
      ),
    ];
    const hints = await courseReturnHintsByDeployment(db, worldDepIds, locale);
    const withCourse = items.map((item) =>
      item.kind === 'world'
        ? {
            ...item,
            beat: {
              ...item.beat,
              course: hints.get(item.beat.deploymentId) ?? null,
            },
          }
        : item,
    );
    // An empty feed is the one state that kills the habit, so it always comes
    // back with somewhere to go.
    const suggested = withCourse.length === 0 ? await suggestedAuthors(db, jwt.sub, 8) : [];
    return c.json({ items: withCourse, suggested });
  });

  v1.get('/community/authors/suggested', async (c) => {
    const viewerId = await optionalUserId(c);
    const authors = await suggestedAuthors(db, viewerId, 8);
    return c.json({ authors });
  });

  // --------- API Keys (P5) ---------
  authed.get('/api-keys', async (c) => {
    const jwt = c.get('jwt');
    const rows = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        rateLimitPerMinute: apiKeys.rateLimitPerMinute,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.organizationId, jwt.organizationId))
      .orderBy(desc(apiKeys.createdAt));
    return c.json({ apiKeys: rows });
  });

  authed.post('/api-keys', async (c) => {
    const jwt = c.get('jwt');
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      scopes?: string[];
      rateLimitPerMinute?: number;
    };
    const name = body.name?.trim();
    if (!name) {
      return c.json({ error: 'name required' }, 400);
    }
    const allowedScopes = new Set([
      '*',
      'embed:read',
      'leaderboard:write',
      'plugins:read',
      'bench:read',
    ]);
    const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s) => allowedScopes.has(s)) : [];
    const minted = mintApiKey();
    const [row] = await db
      .insert(apiKeys)
      .values({
        organizationId: jwt.organizationId,
        createdBy: jwt.sub,
        name,
        keyPrefix: minted.keyPrefix,
        keyHash: minted.keyHash,
        scopes,
        rateLimitPerMinute: body.rateLimitPerMinute ?? null,
      })
      .returning();
    if (!row) return c.json({ error: 'insert failed' }, 500);
    // The raw key is shown ONCE, immediately after creation. We never store it.
    return c.json({
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      rawKey: minted.rawKey,
      scopes: row.scopes,
      createdAt: row.createdAt,
    });
  });

  authed.delete('/api-keys/:keyId', async (c) => {
    const jwt = c.get('jwt');
    const keyId = c.req.param('keyId');
    const [row] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.organizationId, jwt.organizationId)))
      .limit(1);
    if (!row) return c.json({ error: 'not found' }, 404);
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, keyId));
    return c.json({ ok: true });
  });

}
