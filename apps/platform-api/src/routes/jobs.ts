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
import { composeJobLogPayload } from '../lib/jobLogRead.js';
import { mapUsageRecent } from '../lib/usageSummary.js';
import { insertRequeuedJob, isRequeueQuotaDenied } from '../lib/requeueJob.js';
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

export function registerJobRoutes(
  v1: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  authed: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  ctx: V1RouteCtx,
): void {
  const { db, env, queue, s3 } = ctx;
  const deps = { redis: ctx.redis };
  const requireOrgAccess = ctx.requireOrgAccess;
  const optionalUserId = ctx.optionalUserId;
  const openProviderCheckout = ctx.openProviderCheckout;

  authed.get('/usage', async (c) => {
    const organizationId = await requireOrgAccess(c);
    if (organizationId instanceof Response) return organizationId;
    const days = 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        modality: usageEvents.modality,
        units: sum(usageEvents.units),
        jobs: count(),
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.organizationId, organizationId),
          gte(usageEvents.createdAt, since),
        ),
      )
      .groupBy(usageEvents.modality);
    const recentRows = await db
      .select({
        modality: usageEvents.modality,
        units: usageEvents.units,
        jobId: usageEvents.jobId,
        createdAt: usageEvents.createdAt,
        meta: usageEvents.meta,
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.organizationId, organizationId),
          gte(usageEvents.createdAt, since),
        ),
      )
      .orderBy(desc(usageEvents.createdAt))
      .limit(12);
    const byModality = rows.map((row) => ({
      modality: row.modality,
      jobType: row.modality,
      units: Number(row.units ?? 0) || 0,
      jobs: Number(row.jobs ?? 0) || 0,
    }));
    return c.json({
      since: since.toISOString(),
      days,
      byModality,
      byJobType: byModality,
      recent: mapUsageRecent(recentRows),
    });
  });

  authed.get('/admin/dead-letters', async (c) => {
    const jwt = c.get('jwt');
    if (!isPlatformAdmin(env, jwt)) {
      return c.json(apiError(ErrorCode.FORBIDDEN, 'not a curator'), 403);
    }
    const letters = await db
      .select()
      .from(jobDeadLetters)
      .orderBy(desc(jobDeadLetters.createdAt))
      .limit(50);
    return c.json({ letters });
  });

  authed.post('/projects/:projectId/jobs/:jobId/retry', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const jobId = c.req.param('jobId');
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
    const [oldJob] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.projectId, projectId)))
      .limit(1);
    if (!oldJob) {
      return c.json({ error: 'not found' }, 404);
    }
    if (oldJob.status !== 'failed') {
      return c.json({ error: 'only failed jobs can be retried' }, 400);
    }
    // Rate limits still apply, but no points: the user already paid for this
    // work once and it is our pipeline that failed, not their prompt.
    const quota = await assertCanEnqueueJob(db, env, proj.organizationId);
    if (!quota.ok) return quotaDenied(c, quota);
    const queued = await insertRequeuedJob(db, queue, oldJob, {
      quota: { env, organizationId: proj.organizationId, jobType: oldJob.type },
    });
    if (isRequeueQuotaDenied(queued)) return quotaDenied(c, { ok: false, ...queued });
    if (queued.already) {
      // Idempotent: the first click already created the child. Hand that id
      // back so the studio can poll / attach preview instead of toasting 409.
      if (queued.jobId) {
        return c.json({ jobId: queued.jobId, already: true });
      }
      return c.json(apiError(ErrorCode.CONFLICT, 'already requeued', { jobId: queued.jobId }), 409);
    }
    return c.json(queued);
  });

  /** Cancel a queued/running job. Worker will stop at the next cancel check / CLI abort. */
  authed.post('/projects/:projectId/jobs/:jobId/cancel', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const jobId = c.req.param('jobId');
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
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.projectId, projectId)))
      .limit(1);
    if (!job) {
      return c.json({ error: 'not found' }, 404);
    }
    if (job.status !== 'queued' && job.status !== 'running') {
      return c.json(
        { error: 'only queued or running jobs can be cancelled', status: job.status },
        400,
      );
    }
    const logKey = 'user_cancelled: 用户中止任务';
    // Cancel queued first, then running. Refund only if the row was still
    // queued at UPDATE time — a stale SELECT would otherwise refund a job
    // the worker already started.
    const queuedCancel = await db
      .update(jobs)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
        logKey,
      })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.projectId, projectId),
          eq(jobs.status, 'queued'),
        ),
      )
      .returning({ id: jobs.id });
    if (queuedCancel.length > 0) {
      await refundJobPoints(db, env, proj.organizationId, job.type, jobId);
      return c.json({ ok: true, jobId, status: 'cancelled' });
    }
    const runningCancel = await db
      .update(jobs)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
        logKey,
      })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.projectId, projectId),
          eq(jobs.status, 'running'),
        ),
      )
      .returning({ id: jobs.id });
    if (runningCancel.length === 0) {
      return c.json(
        { error: 'only queued or running jobs can be cancelled', status: job.status },
        400,
      );
    }

    return c.json({ ok: true, jobId, status: 'cancelled' });
  });

  /** Project members can clear their own frozen jobs. Not a dev-auth door. */
  authed.post('/projects/:projectId/jobs/stale-recover', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = (await c.req.json().catch(() => ({}))) as { staleMinutes?: number };
    // UI "清理卡死" defaults to 5m; allow as low as 1m for local debugging.
    const staleMinutes = Math.min(Math.max(body.staleMinutes ?? 5, 1), 240);

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

    const cutoff = new Date(Date.now() - staleMinutes * 60_000);
    const [busy] = await db
      .select({ n: count() })
      .from(jobs)
      .where(eq(jobs.status, 'running'));
    const runningCount = Number(busy?.n ?? 0);
    // Heartbeats refresh updated_at, so a hung CLI still looks fresh. Age a
    // running job from created_at. Don't fail a queued job that is simply
    // waiting behind that one slot.
    const stale = await db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(
        and(
          eq(jobs.projectId, projectId),
          or(
            and(eq(jobs.status, 'running'), lt(jobs.createdAt, cutoff)),
            ...(runningCount === 0
              ? [and(eq(jobs.status, 'queued'), lt(jobs.updatedAt, cutoff))]
              : []),
          ),
        ),
      );

    if (stale.length === 0) {
      return c.json({
        recovered: 0,
        jobIds: [],
        staleMinutes,
        runningElsewhere: runningCount,
      });
    }

    const ids = stale.map((r) => r.id);
    await db
      .update(jobs)
      .set({
        status: 'failed',
        updatedAt: new Date(),
        logKey: `stale_recover: ${stale.map((s) => s.status).join('|')} idle > ${staleMinutes}m`,
      })
      .where(and(eq(jobs.projectId, projectId), inArray(jobs.id, ids)));

    return c.json({
      recovered: ids.length,
      jobIds: ids,
      staleMinutes,
      runningElsewhere: runningCount,
    });
  });

  authed.get('/jobs/:jobId', async (c) => {
    const jwt = c.get('jwt');
    const jobId = c.req.param('jobId');
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) {
      return c.json({ error: 'not found' }, 404);
    }
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, job.projectId))
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
    return c.json(job);
  });

  // 获取单个 job
  authed.get('/projects/:projectId/jobs/:jobId', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const jobId = c.req.param('jobId');

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

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) {
      return c.json({ error: 'not found' }, 404);
    }

    return c.json(job);
  });

  authed.get('/projects/:projectId/jobs', async (c) => {
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
      .from(jobs)
      .where(eq(jobs.projectId, projectId))
      .orderBy(desc(jobs.createdAt));
    const [busy] = await db
      .select({ n: count() })
      .from(jobs)
      .where(and(eq(jobs.status, 'running'), ne(jobs.projectId, projectId)));
    return c.json({ jobs: list, queue: { runningElsewhere: Number(busy?.n ?? 0) } });
  });

  authed.get('/jobs/:jobId/log-url', async (c) => {
    const jwt = c.get('jwt');
    const jobId = c.req.param('jobId');
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job?.logKey) {
      return c.json({ error: 'no log for this job' }, 404);
    }
    const logObjectKey = resolveJobLogS3ObjectKey(job.logKey);
    if (!logObjectKey) {
      return c.json({ error: 'log is inline only; no object URL' }, 404);
    }
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, job.projectId))
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
    if (env.publicObjectBaseUrl) {
      const url = `${env.publicObjectBaseUrl.replace(/\/$/, '')}/${logObjectKey}`;
      return c.json({ url, expiresIn: null });
    }
    const url = await presignGetObject(s3, env, logObjectKey, 3600);
    return c.json({ url, expiresIn: 3600 });
  });

  /** Full CLI / build log through the API — no S3 CORS required. */
  authed.get('/jobs/:jobId/log', async (c) => {
    const jwt = c.get('jwt');
    const jobId = c.req.param('jobId');
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job?.logKey) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'no log for this job'), 404);
    }
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, job.projectId))
      .limit(1);
    if (!proj) {
      return c.json(apiError(ErrorCode.NOT_FOUND, 'not found'), 404);
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
      return c.json(apiError(ErrorCode.FORBIDDEN, 'forbidden'), 403);
    }
    const logObjectKey = resolveJobLogS3ObjectKey(job.logKey);
    let objectText: string | null = null;
    if (logObjectKey) {
      try {
        objectText = await getObjectUtf8(s3, env, logObjectKey);
      } catch (err) {
        console.error('[job-log] S3 get failed', jobId, err);
      }
    }
    return c.json(
      composeJobLogPayload({
        logKey: job.logKey,
        objectText,
        objectKey: logObjectKey,
      }),
    );
  });

  // 构建进度查询 API
  authed.get('/projects/:projectId/jobs/:jobId/progress', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const jobId = c.req.param('jobId');

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

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) {
      return c.json({ error: 'not found' }, 404);
    }

    // 根据 job 状态和类型计算进度
    let progress = 0;
    let stage: 'queued' | 'installing' | 'building' | 'optimizing' | 'uploading' | 'done' | 'failed' = 'queued';

    if (job.type === 'generate') {
      if (job.status === 'queued') {
        progress = 10;
        stage = 'queued';
      } else if (job.status === 'processing') {
        progress = 50;
        stage = 'building';
      } else if (job.status === 'succeeded') {
        progress = 100;
        stage = 'done';
      } else if (job.status === 'failed') {
        progress = 0;
        stage = 'failed';
      }
    } else if (job.type === 'build') {
      if (job.status === 'queued') {
        progress = 5;
        stage = 'queued';
      } else if (job.status === 'processing') {
        // 根据 job 的 createdAt 和 updatedAt 估算进度
        const createdAt = new Date(job.createdAt).getTime();
        const now = Date.now();
        const elapsed = now - createdAt;
        // 假设完整构建需要 2 分钟
        const estimatedTotal = 120000;
        progress = Math.min(95, Math.floor((elapsed / estimatedTotal) * 100));
        stage = 'installing';
      } else if (job.status === 'succeeded') {
        progress = 100;
        stage = 'done';
      } else if (job.status === 'failed') {
        progress = 0;
        stage = 'failed';
      }
    }

    return c.json({
      jobId: job.id,
      status: job.status,
      type: job.type,
      stage,
      progress,
      buildCacheKey: job.buildCacheKey,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  });

  // 资产画廊：列出项目的多模态生成产物（图/音/视频/音乐）。
  authed.get('/projects/:projectId/assets', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const modality = c.req.query('modality');
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
    const whereExpr = modality
      ? and(eq(assets.projectId, projectId), eq(assets.modality, modality))
      : eq(assets.projectId, projectId);
    const rows = await db
      .select()
      .from(assets)
      .where(whereExpr)
      .orderBy(desc(assets.createdAt))
      .limit(200);
    const baseUrl = env.publicObjectBaseUrl?.replace(/\/$/, '') ?? null;
    return c.json({
      assets: rows.map((r) => ({
        id: r.id,
        modality: r.modality,
        prompt: r.prompt,
        storageKey: r.storageKey,
        thumbnailKey: r.thumbnailKey,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        externalId: r.externalId,
        licenseTag: r.licenseTag,
        costUnits: r.costUnits,
        meta: r.meta,
        createdAt: r.createdAt,
        publicUrl: baseUrl ? `${baseUrl}/${r.storageKey}` : null,
        publicThumbnailUrl:
          baseUrl && r.thumbnailKey ? `${baseUrl}/${r.thumbnailKey}` : null,
      })),
    });
  });

  // --- Agent intelligence: project brief ---
  authed.get('/projects/:projectId/brief', async (c) => {
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
    const [row] = await db
      .select()
      .from(projectBriefs)
      .where(eq(projectBriefs.projectId, projectId))
      .orderBy(desc(projectBriefs.version))
      .limit(1);
    return c.json({
      brief: row?.briefJson ?? null,
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ?? null,
    });
  });

  authed.patch('/projects/:projectId/brief', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = (await c.req.json().catch(() => ({}))) as { brief?: Record<string, unknown> };
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
    if (!body.brief || typeof body.brief !== 'object') {
      return c.json({ error: 'brief object required' }, 400);
    }
    const [latest] = await db
      .select()
      .from(projectBriefs)
      .where(eq(projectBriefs.projectId, projectId))
      .orderBy(desc(projectBriefs.version))
      .limit(1);
    const nextVersion = (latest?.version ?? 0) + 1;
    const briefJson = { ...body.brief, version: nextVersion };
    const [row] = await db
      .insert(projectBriefs)
      .values({ projectId, version: nextVersion, briefJson })
      .returning();
    return c.json({ brief: row?.briefJson, version: nextVersion });
  });

  authed.get('/projects/:projectId/memories', async (c) => {
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
    const rows = await db
      .select()
      .from(projectMemories)
      .where(eq(projectMemories.projectId, projectId))
      .orderBy(desc(projectMemories.createdAt))
      .limit(100);
    return c.json({ memories: rows });
  });

  authed.post('/projects/:projectId/jobs/:jobId/feedback', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const jobId = c.req.param('jobId');
    const body = (await c.req.json().catch(() => ({}))) as {
      rating?: number;
      comment?: string;
    };
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
    await db.insert(jobFeedback).values({
      jobId,
      projectId,
      userId: jwt.sub,
      rating: body.rating ?? null,
      comment: body.comment ?? null,
    });
    if (body.rating !== undefined && body.rating <= 2 && body.comment) {
      await db.insert(projectMemories).values({
        projectId,
        scope: 'negative',
        fact: `用户不满意: ${body.comment.slice(0, 500)}`,
        sourceJobId: jobId,
      });
    }
    return c.json({ ok: true });
  });

  authed.get('/projects/:projectId/agent-metrics', async (c) => {
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
    const [jobStats] = await db
      .select({
        total: count(),
        succeeded: sql<number>`count(*) filter (where ${jobs.status} = 'succeeded')`,
        failed: sql<number>`count(*) filter (where ${jobs.status} = 'failed')`,
      })
      .from(jobs)
      .where(and(eq(jobs.projectId, projectId), eq(jobs.type, 'generate')));
    const [fbStats] = await db
      .select({
        avgRating: avg(jobFeedback.rating),
        count: count(),
      })
      .from(jobFeedback)
      .where(eq(jobFeedback.projectId, projectId));
    const [ragCount] = await db
      .select({ count: count() })
      .from(ragDocumentChunks);
    return c.json({
      generateJobs: jobStats,
      feedback: fbStats,
      ragChunksIndexed: ragCount?.count ?? 0,
    });
  });

  authed.get('/projects/:projectId/session-context', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const sessionId = c.req.query('sessionId');
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
    const [briefRow] = await db
      .select()
      .from(projectBriefs)
      .where(eq(projectBriefs.projectId, projectId))
      .orderBy(desc(projectBriefs.version))
      .limit(1);
    let sessionSummary: string | null = null;
    if (sessionId) {
      const [sess] = await db
        .select({ summary: chatSessions.summary })
        .from(chatSessions)
        .where(eq(chatSessions.id, sessionId))
        .limit(1);
      sessionSummary = sess?.summary ?? null;
    }
    const memories = await db
      .select({ fact: projectMemories.fact, scope: projectMemories.scope })
      .from(projectMemories)
      .where(eq(projectMemories.projectId, projectId))
      .orderBy(desc(projectMemories.createdAt))
      .limit(10);
    return c.json({
      brief: briefRow?.briefJson ?? null,
      sessionSummary,
      memories: memories.map((m) => m.fact),
    });
  });

  // 历史 agent_events：用户重新进入 IDE 时回放思维链
  authed.get('/projects/:projectId/jobs/:jobId/agent-events', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const jobId = c.req.param('jobId');
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
    const rows = await db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.jobId, jobId))
      .orderBy(asc(agentEvents.createdAt));
    return c.json({ events: rows });
  });

  // SSE 实时任务状态推送
  authed.get('/projects/:projectId/events', async (c) => {
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

    // 获取最新的 job 状态作为初始数据
    const latestJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.projectId, projectId))
      .orderBy(desc(jobs.createdAt))
      .limit(10);

    return streamSSE(c, async (stream) => {
      // 每 2 秒发送一次心跳
      const heartbeatInterval = setInterval(() => {
        stream.write(': heartbeat\n\n');
      }, 30000);

      // 获取 Redis URL 并创建订阅连接（用于实时任务更新推送）
      let redisSubscriber: any = null;
      try {
        const { Redis } = await import('ioredis');
        const redisUrl = env.redisUrl;
        redisSubscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
        await redisSubscriber.subscribe(`job:${projectId}:updates`);
        redisSubscriber.on('message', (_channel: string, message: string) => {
          try {
            const data = JSON.parse(message);
            // 路由：agent-event（FSM 思维链）走独立事件类型，方便 IDE 区分渲染
            const eventName =
              data?.kind === 'agent-event' ? 'agent-event' : 'job-update';
            stream.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
          } catch {
            // ignore parse errors
          }
        });
      } catch (redisErr) {
        console.warn(
          '[SSE] Redis subscribe failed — agent-event stream disabled; job-update polling only:',
          redisErr instanceof Error ? redisErr.message : redisErr,
        );
      }

      // 初始发送最新 jobs 状态
      stream.write(`event: initial\ndata: ${JSON.stringify({ jobs: latestJobs })}\n\n`);

      // 轮询模式：每 3 秒检查一次数据库更新
      let lastJobUpdate = latestJobs[0]?.updatedAt || new Date();
      const pollInterval = setInterval(async () => {
        try {
          const updatedJobs = await db
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.projectId, projectId),
                gt(jobs.updatedAt, lastJobUpdate),
              ),
            )
            .orderBy(desc(jobs.createdAt))
            .limit(20);

          if (updatedJobs.length > 0) {
            lastJobUpdate = updatedJobs[0]!.updatedAt;
            stream.write(`event: job-update\ndata: ${JSON.stringify({ jobs: updatedJobs })}\n\n`);
          }
        } catch {
          // 忽略轮询错误
        }
      }, 3000);

      // Keep the SSE stream open until the client disconnects.
      // Returning early from streamSSE closes the response → EventSource reconnect flood.
      await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(heartbeatInterval);
        clearInterval(pollInterval);
        if (redisSubscriber) {
            try {
          redisSubscriber.disconnect();
            } catch {
              /* ignore */
        }
            redisSubscriber = null;
          }
          resolve();
        });
      });
    });
  });

  /**
   * Resident clock leases live on world/society/heartbeat.
   * `always` writes no until, so the worker will not scan an empty page.
   */
}
