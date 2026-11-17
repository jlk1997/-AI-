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
  clampSocietyPresenceTtlMs,
  pickSocietyLlmLane,
  resolveJobLogS3ObjectKey,
  societyTalkMuteReason,
  townPresenceBadge,
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
  comparePersistedSocietyEvents,
  loadDurableSocietyMind,
  loadLatestSocietyForecast,
  persistSocietyMind,
  saveSocietyForecast,
  upsertSocietyMindTables,
} from '@opengame/platform-db';
import { ingestCommunityGame, queryCommunityTemplateHints } from '@opengame/platform-rag';
import { applyWorldOp } from '@opengame/world-ops';
import { parseWorldSpec, summarizeWorldSpec, toGameplayManifest, toL2PresentationManifest, toL3PresentationManifest, diffWorldSpecs, gatheringSeedText, gatheringInvitationText, evaluateEmergenceGate, resolveGenreProfile, lintSpecFields } from '@opengame/world-spec';
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
  boardView,
  deriveCrowd,
  forecastCrowd,
  forecastScenarios,
  hydrateMind,
  applyAudienceBallot,
  calibrateCrowd,
  cohortsFromDemography,
  disasterEffects,
  electionDecree,
  openSpotlight,
  mayorChoices,
  migrateCohort,
  movePeopleBetweenTowns,
  priceShock,
  quotePrice,
  shiftConfidence,
  tallyElection,
  mindSnapshot,
  publishPolicy,
  type SocietyEvent,
} from '@opengame/world-agents';
import type { PlatformEnv } from '../env.js';
import { signSessionJwt, verifySessionJwt, type JwtPayload } from '../lib/jwt.js';
import { mintSseTicket, readSseTicket } from '../lib/sseTicket.js';
import { voidCourseNodesForWorld } from '../lib/courseBoard.js';
import {
  shouldVoidCourseOnHeartbeat,
  societyHeartbeatWrite,
} from '../lib/societyHeartbeatMode.js';
import {
  buildPreviewProxyUrl,
  resolveDistPrefix,
  servePreviewDistAsset,
  signPreviewDistToken,
} from '../lib/previewDist.js';
import { presignGetObject, putObjectBytes } from '../lib/s3.js';
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
  isWorldTipConflict,
  persistWorldTipRevision,
} from '../lib/worldTipPersist.js';
import { recordNarrativeRefresh } from '../observability/courseMetrics.js';
import {
  guardNarrativeRefreshError,
} from '../observability/alertGuard.js';
import { checkAndIncrementDailyCap, resolvePlanDailyCap, resolvePlanTier } from '../observability/dailyCap.js';
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
import { emitCachedSocietyFrame, subscribeSocietyFrames } from '../lib/societyFanout.js';
import {
  loadTownCeremony,
  loadUserPublicName,
  publishSocietyPatron,
  societyStreamEventName,
} from '../lib/societyPatrons.js';
import {
  leaveSocietyWatcher,
  touchSocietyWatcher,
  countSocietyWatchers,
  societyWatcherTicket,
} from '../lib/societyWatchers.js';
import {
  consumeEmergencySocietyTalk,
  grantHourLightBonus,
  peekSocietyTalkBudget,
  releaseSocietyTalks,
  reserveSocietyTalks,
  settleSocietyTalks,
  societyTalkBudgetOpen,
  talkBudgetOptsFromWorld,
} from '../lib/societyTalkBudget.js';
import { createOptionalSocietyLlm } from '../lib/societyLlm.js';
import { decideSocietyTalks, landTownStimulus } from '../lib/societyTalkGate.js';
import { assertGeneratePrompt, assertPublishableCopy } from '../lib/ugcPolicy.js';
import { writeAudit } from '../lib/audit.js';
import { handleStripeEvent } from './stripeWebhook.js';
import {
  COMMERCE,
  applyWorldLightSku,
  findCommunityByProject,
  loadPublishedWork,
  parsePaidWorldLightSku,
  publicCommerceView,
  refundVisitorTransfer,
  snapshotMechanicForPublish,
  tonightKaiCounts,
  transferToAuthor,
  worldLightCost,
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
  interviewSocietyAgentFromMemories,
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

async function attachTownCeremony(
  db: DrizzleDb,
  redis: Redis,
  projectId: string,
  worldRow: { id: string; townTimeUntil: Date | null },
): Promise<{
  contributors: Awaited<ReturnType<typeof loadTownCeremony>>['contributors'];
  lamp: Awaited<ReturnType<typeof loadTownCeremony>>['lamp'];
  watcherCount: number;
}> {
  const published = await findCommunityByProject(db, projectId);
  const [ceremony, watcherCount] = await Promise.all([
    published
      ? loadTownCeremony(db, published.id, worldRow.townTimeUntil)
      : Promise.resolve({ contributors: [], lamp: null }),
    countSocietyWatchers(redis, worldRow.id).catch(() => 0),
  ]);
  return { ...ceremony, watcherCount };
}

export function registerWorldRoutes(
  v1: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  authed: Hono<{ Variables: { jwt: import('../lib/jwt.js').JwtPayload } }>,
  ctx: V1RouteCtx,
): void {
  const { db, env, queue, s3 } = ctx;
  const deps = { redis: ctx.redis };
  const requireOrgAccess = ctx.requireOrgAccess;
  const optionalUserId = ctx.optionalUserId;
  const openProviderCheckout = ctx.openProviderCheckout;

  /** GET project world tip (World Spec SSOT). */
  authed.get('/projects/:projectId/world', async (c) => {
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
    const [world] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!world) return c.json({ world: null });
    const spec = parseWorldSpec(world.specJson);
    const report = await loadEmergenceReport(db, world.id);
    const [job] = await db
      .select({ result: jobs.result })
      .from(jobs)
      .where(
        and(
          eq(jobs.projectId, projectId),
          eq(jobs.status, 'succeeded'),
          inArray(jobs.type, ['world_generate', 'world_edit']),
        ),
      )
      .orderBy(desc(jobs.updatedAt))
      .limit(1);
    const { societySeedSnapshot, societySeedFromJobResult, worldRosterFromSpec, worldBriefFromSpec } =
      await import('../lib/societyReady.js');
    const roster = worldRosterFromSpec(spec);
    const societySeed = societySeedSnapshot(
      report,
      societySeedFromJobResult(job?.result),
    );
    return c.json({
      world: {
        id: world.id,
        title: world.title,
        tipRevision: world.tipRevision,
        spec: world.specJson,
        memory: world.memoryJson,
        summary: summarizeWorldSpec(spec, 800),
        metaSummary: spec.meta?.summary ?? null,
        openingRumor: spec.presentation?.openingRumor ?? null,
        gameplay: toGameplayManifest(spec),
        l2: toL2PresentationManifest(spec),
        l3: toL3PresentationManifest(spec),
        societySeed,
        authoredNpcs: roster.authoredNpcs,
        paddedNpcs: roster.paddedNpcs,
        authoredNames: roster.authoredNames,
        paddedNames: roster.paddedNames,
        worldBrief: worldBriefFromSpec(spec),
        updatedAt: world.updatedAt,
        lightUntil: world.lightUntil?.toISOString() ?? null,
        cognition: world.cognition ?? 'classic',
        violencePublic: world.violencePublic ?? false,
      },
    });
  });

  /** PATCH presentation fields (spatialBackend / lingbotMode / cinematic) — Spec SSOT. */
  authed.patch('/projects/:projectId/world/presentation', async (c) => {
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const body = await c
      .req.json<{
        spatialBackend?: string | null;
        lingbotMode?: 'mock' | 'real' | null;
        cinematicEnabled?: boolean;
      }>()
      .catch(() => ({} as Record<string, never>));
    const world = parseWorldSpec(worldRow.specJson);
    const nextVersion = Math.max(worldRow.tipRevision + 1, world.meta.version + 1);
    const spatialBackend =
      body.spatialBackend === undefined
        ? world.presentation.spatialBackend
        : body.spatialBackend === 'null' || body.spatialBackend === null
          ? undefined
          : body.spatialBackend;
    const next = parseWorldSpec({
      ...world,
      meta: { ...world.meta, version: nextVersion },
      presentation: {
        ...world.presentation,
        spatialBackend,
        lingbotMode:
          body.lingbotMode === undefined
            ? world.presentation.lingbotMode
            : body.lingbotMode ?? undefined,
        cinematicEnabled:
          body.cinematicEnabled !== undefined
            ? body.cinematicEnabled
            : spatialBackend === 'lingbot'
              ? true
              : world.presentation.cinematicEnabled,
      },
    });
    const moved = await persistWorldTipRevision(db, {
      worldId: worldRow.id,
      expectedTip: worldRow.tipRevision,
      nextVersion,
      specJson: next,
      title: next.meta.title,
      opJson: {
        op: 'presentation_patch',
        spatialBackend: spatialBackend ?? null,
        lingbotMode: next.presentation.lingbotMode ?? null,
      },
      summary: `l3:presentation:${spatialBackend ?? 'null'}`,
    });
    if (!moved) {
      return c.json(apiError(ErrorCode.CONFLICT, 'world tip moved; retry presentation patch'), 409);
    }
    return c.json({
      ok: true,
      tipRevision: nextVersion,
      l2: toL2PresentationManifest(next),
      l3: toL3PresentationManifest(next),
      presentation: next.presentation,
    });
  });

  /** GET world revision history. */
  authed.get('/projects/:projectId/world/revisions', async (c) => {
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
    const [world] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!world) return c.json({ revisions: [] });
    const revs = await db
      .select()
      .from(worldRevisions)
      .where(eq(worldRevisions.worldId, world.id))
      .orderBy(desc(worldRevisions.revision))
      .limit(50);
    return c.json({
      revisions: revs.map((r) => ({
        revision: r.revision,
        parentRevision: r.parentRevision,
        summary: r.summary,
        op: r.opJson,
        createdAt: r.createdAt,
      })),
    });
  });

  /** GET Spec delta between tip and a historical revision (or two revisions). */
  authed.get('/projects/:projectId/world/revisions/:revision/diff', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const revisionNum = Number.parseInt(c.req.param('revision'), 10);
    if (!Number.isFinite(revisionNum)) {
      return c.json({ error: 'invalid revision' }, 400);
    }
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
    const [world] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!world) return c.json({ error: 'no world' }, 404);
    const [rev] = await db
      .select()
      .from(worldRevisions)
      .where(
        and(
          eq(worldRevisions.worldId, world.id),
          eq(worldRevisions.revision, revisionNum),
        ),
      )
      .limit(1);
    if (!rev) return c.json({ error: 'revision not found' }, 404);
    const tip = parseWorldSpec(world.specJson);
    const past = parseWorldSpec(rev.specJson);
    // Diff tip vs past: show what tip gained/lost relative to that revision
    const diff = diffWorldSpecs(past, tip);
    const op =
      rev.opJson && typeof rev.opJson === 'object'
        ? (rev.opJson as Record<string, unknown>)
        : null;
    return c.json({
      fromRevision: revisionNum,
      toRevision: world.tipRevision,
      diff,
      fromSummary: summarizeWorldSpec(past, 600),
      toSummary: summarizeWorldSpec(tip, 600),
      storedDiffSummary: op?.['diffSummary'] ?? null,
      dirtyRegions: op?.['dirtyRegions'] ?? null,
    });
  });

  /** POST restore tip Spec from a historical revision (then rebuild presenter). */
  authed.post('/projects/:projectId/world/revisions/:revision/restore', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const revisionNum = Number.parseInt(c.req.param('revision'), 10);
    if (!Number.isFinite(revisionNum)) {
      return c.json({ error: 'invalid revision' }, 400);
    }
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
    const [world] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!world) return c.json({ error: 'no world' }, 404);
    const [rev] = await db
      .select()
      .from(worldRevisions)
      .where(
        and(
          eq(worldRevisions.worldId, world.id),
          eq(worldRevisions.revision, revisionNum),
        ),
      )
      .limit(1);
    if (!rev) return c.json({ error: 'revision not found' }, 404);
    const quota = await assertCanEnqueueJob(db, env, proj.organizationId, 'world_edit');
    if (!quota.ok) return quotaDenied(c, quota);
    const restored = parseWorldSpec(rev.specJson);
    const expectedTip = world.tipRevision;
    const nextVersion = expectedTip + 1;
    const nextWorld = parseWorldSpec({
      ...restored,
      meta: { ...restored.meta, version: nextVersion },
    });
    const traceId = crypto.randomUUID();
    try {
      const job = await db.transaction(async (tx) => {
        const scoped = tx as unknown as DrizzleDb;
        const moved = await persistWorldTipRevision(scoped, {
          worldId: world.id,
          expectedTip,
          nextVersion,
          specJson: nextWorld,
          title: nextWorld.meta.title,
          opJson: { op: 'restore_revision', fromRevision: revisionNum },
          summary: `restore tip from r${revisionNum}`,
        });
        if (!moved) throw new Error('world_tip_conflict');
        const charged = await insertChargedJob(
          scoped,
          env,
          {
            projectId,
            sessionId: null,
            type: 'world_edit',
            payload: {
              prompt: `restore r${revisionNum}`,
              rebuildOnly: true,
            },
            traceId,
          },
          {
            organizationId: proj.organizationId,
            projectId,
            jobType: 'world_edit',
          },
        );
        if (!charged.ok) throw new Error(charged.message);
        return charged.job;
      });
      await enqueuePlatformJob(queue, job.id);
      return c.json({
        tipRevision: nextVersion,
        fromRevision: revisionNum,
        jobId: job.id,
        traceId,
      });
    } catch (error) {
      if (isWorldTipConflict(error)) {
        return c.json(apiError(ErrorCode.CONFLICT, 'world tip moved; retry restore'), 409);
      }
      const message = error instanceof Error ? error.message : 'restore failed';
      return c.json(apiError(ErrorCode.QUOTA_EXCEEDED, message), 402);
    }
  });

  /** POST refresh narrative fields (meta.summary / presentation.openingRumor). */
  authed.post('/projects/:projectId/world/refresh-narrative', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c.req
      .json<{
        fields?: readonly string[];
        locale?: 'zh' | 'en';
      }>()
      .catch(() => ({} as Record<string, never>));
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);

    // 批次 7+10：单组织每日刷新上限。批次 10 起按 plan 分级（free=1/pro=5/studio=20）。
    // 优先级：每 plan 单独 env > 全局 env > 内置默认。
    const plan = resolvePlanTier({ organizationId: proj.organizationId });
    const cap = resolvePlanDailyCap({
      quotaNamespace: 'narrative-refresh',
      plan,
    });
    const capDecision = await checkAndIncrementDailyCap({
      redis: ctx.redis,
      prefix: 'og.narrative_refresh',
      organizationId: proj.organizationId,
      limit: cap,
      plan,
    });
    if (!capDecision.ok) {
      return c.json(
        apiError(ErrorCode.RATE_LIMITED, 'narrative_refresh_daily_cap_reached', {
          limit: capDecision.limit,
          resetAt: capDecision.resetAt,
          plan: capDecision.plan,
        }),
        429,
      );
    }

    const fields = (body.fields ?? ['meta.summary', 'presentation.openingRumor']).filter(
      (f): f is 'meta.summary' | 'presentation.openingRumor' =>
        f === 'meta.summary' || f === 'presentation.openingRumor',
    );
    if (!fields.length) {
      return c.json(apiError(ErrorCode.INVALID_INPUT, 'fields required'), 400);
    }
    const locale: 'zh' | 'en' = body.locale === 'en' ? 'en' : 'zh';

    const current = parseWorldSpec(worldRow.specJson);
    const { refineNarrative } = await import('@opengame/world-planner');
    const startedAt = Date.now();
    let next: Awaited<ReturnType<typeof refineNarrative>>;
    try {
      next = await refineNarrative(current, { fields, locale });
    } catch (err) {
      recordNarrativeRefresh({
        result: 'error',
        fields: fields.join('+'),
        worldId: worldRow.id,
        organizationId: proj.organizationId,
        ms: Date.now() - startedAt,
        plan,
      });
      guardNarrativeRefreshError();
      throw err;
    }
    const elapsedMs = Date.now() - startedAt;
    // 没有变化（LLM 失败/回退）直接返回，避免无谓 revision
    if (next === current) {
      recordNarrativeRefresh({
        result: 'noop',
        fields: fields.join('+'),
        worldId: worldRow.id,
        organizationId: proj.organizationId,
        ms: elapsedMs,
        plan,
      });
      return c.json({ ok: true, tipRevision: worldRow.tipRevision, changed: false });
    }
    const nextVersion = Math.max(worldRow.tipRevision + 1, current.meta.version + 1);
    const bumped = parseWorldSpec({
      ...next,
      meta: { ...next.meta, version: nextVersion },
    });
    const moved = await persistWorldTipRevision(db, {
      worldId: worldRow.id,
      expectedTip: worldRow.tipRevision,
      nextVersion,
      specJson: bumped,
      title: bumped.meta.title,
      opJson: {
        op: 'narrative_refresh',
        fields,
        locale,
      },
      summary: `narrative-refresh:${fields.join('+')}`,
    });
    if (!moved) {
      return c.json(
        apiError(ErrorCode.CONFLICT, 'world tip moved; retry refresh'),
        409,
      );
    }
    recordNarrativeRefresh({
      result: 'changed',
      fields: fields.join('+'),
      worldId: worldRow.id,
      organizationId: proj.organizationId,
      ms: elapsedMs,
      plan,
    });
    return c.json({
      ok: true,
      tipRevision: nextVersion,
      changed: true,
      summary: bumped.meta.summary,
      openingRumor: bumped.presentation.openingRumor,
      lint: lintSpecFields([
        { path: 'meta.summary', text: bumped.meta.summary ?? null },
        { path: 'presentation.openingRumor', text: bumped.presentation.openingRumor ?? null },
      ]).filter((i) => i.severity !== 'info'),
    });
  });

  /** POST apply structured world op (enqueues world_edit). */
  authed.post('/projects/:projectId/world/edit', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c.req.json<{
      prompt?: string;
      op?: unknown;
      sessionId?: string;
      rebuildOnly?: boolean;
    }>();
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
    const ugc = assertGeneratePrompt(body.prompt);
    if (!ugc.ok) {
      await writeAudit(db, {
        action: 'generate.ugc_block',
        actorUserId: jwt.sub,
        organizationId: proj.organizationId,
        target: projectId,
        meta: { brand: ugc.brand, kind: 'world_edit' },
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
    const quota = await assertCanEnqueueJob(db, env, proj.organizationId, 'world_edit');
    if (!quota.ok) return quotaDenied(c, quota);
    if (body.op) {
      const [world] = await db
        .select()
        .from(worlds)
        .where(eq(worlds.projectId, projectId))
        .limit(1);
      if (world) {
        const dry = applyWorldOp(parseWorldSpec(world.specJson), body.op);
        if (!dry.ok) {
          return c.json({ error: 'invalid op', issues: dry.issues }, 400);
        }
      }
    }
    let sessionId = body.sessionId;
    if (!sessionId && !body.rebuildOnly) {
      const [sess] = await db
        .insert(chatSessions)
        .values({ projectId, title: 'World Edit' })
        .returning();
      sessionId = sess?.id;
    }
    const traceId = crypto.randomUUID();
    const charged = await insertChargedJob(
      db,
      env,
      {
        projectId,
        sessionId: sessionId ?? null,
        type: 'world_edit',
        payload: {
          prompt: body.rebuildOnly
            ? (body.prompt ?? 'rebuild presenter from tip Spec')
            : (body.prompt ?? 'world edit'),
          op: body.op,
          rebuildOnly: Boolean(body.rebuildOnly),
        },
        traceId,
      },
      {
        organizationId: proj.organizationId,
        projectId,
        jobType: 'world_edit',
      },
    );
    if (!charged.ok) {
      return c.json(apiError(ErrorCode.QUOTA_EXCEEDED, charged.message), 402);
    }
    await enqueuePlatformJob(queue, charged.job.id);
    return c.json({ jobId: charged.job.id, traceId, sessionId });
  });

  /** POST simulate N ticks (sync, no job). */
  authed.post('/projects/:projectId/world/simulate', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c.req.json<{ ticks?: number; hoursPerTick?: number }>();
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const world = parseWorldSpec(worldRow.specJson);
    const sim = new WorldSimulator(world);
    const ticks = Math.min(Math.max(body.ticks ?? 1, 1), 48);
    const hours = body.hoursPerTick ?? 1;
    const allEvents: unknown[] = [];
    let last = world;
    for (let i = 0; i < ticks; i++) {
      const r = sim.tick(hours);
      last = r.world;
      allEvents.push(...r.events);
    }
    await db
      .update(worlds)
      .set({ specJson: last, updatedAt: new Date() })
      .where(eq(worlds.id, worldRow.id));
    await db.insert(simCheckpoints).values({
      worldId: worldRow.id,
      revision: last.meta.version,
      timeHours: String(last.timeHours),
      eventsJson: allEvents,
    });
    return c.json({
      world: last,
      events: allEvents,
      summary: summarizeWorldSpec(last, 600),
    });
  });

  /** GET spatial backend probe (Phase 3 plugin). */
  authed.get('/projects/:projectId/world/spatial-probe', async (c) => {
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const world = parseWorldSpec(worldRow.specJson);
    const backendId =
      c.req.query('backend') ?? world.presentation.spatialBackend ?? undefined;
    const backend = resolveSpatialBackend(backendId);
    const regionId =
      c.req.query('regionId') ?? world.space.regions[0]?.id;
    if (!regionId) return c.json({ error: 'no regions' }, 400);
    const result = await backend.generateRegion({ world, regionId });
    return c.json({
      backend: backend.id,
      label: backend.label,
      result,
      licenseNote: result.licenseNote,
    });
  });

  /** POST agentic Pilot+Director turn (LingBot-style harness on Spec). */
  authed.post('/projects/:projectId/world/agentic', async (c) => {
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const body = await c.req.json<{ intent?: string; persist?: boolean }>().catch(
      () => ({} as { intent?: string; persist?: boolean }),
    );
    const intent = body.intent?.trim() || 'ambient director beat';
    const world = parseWorldSpec(worldRow.specJson);
    const { runAgenticHarness } = await import('@opengame/world-planner');
    const harness = await runAgenticHarness({ world, intent });
    if (body.persist) {
      const nextVersion = Math.max(
        worldRow.tipRevision + 1,
        harness.world.meta.version,
      );
      const nextWorld = parseWorldSpec({
        ...harness.world,
        meta: { ...harness.world.meta, version: nextVersion },
      });
      const moved = await persistWorldTipRevision(db, {
        worldId: worldRow.id,
        expectedTip: worldRow.tipRevision,
        nextVersion,
        specJson: nextWorld,
        title: nextWorld.meta.title,
        opJson: { op: 'agentic_harness', intent: intent.slice(0, 400) },
        summary: `agentic:${harness.applied.length}ops`,
      });
      if (!moved) {
        return c.json(apiError(ErrorCode.CONFLICT, 'world tip moved; retry agentic persist'), 409);
      }
      // Enqueue presenter rebuild so iframe matches tip Spec
      let rebuildJobId: string | undefined;
      const quota = await assertCanEnqueueJob(
        db,
        env,
        proj.organizationId,
        'world_edit',
      );
      if (quota.ok) {
        const traceId = crypto.randomUUID();
        const charged = await insertChargedJob(
          db,
          env,
          {
            projectId,
            type: 'world_edit',
            payload: {
              prompt: 'rebuild presenter after agentic',
              rebuildOnly: true,
            },
            traceId,
          },
          {
            organizationId: proj.organizationId,
            projectId,
            jobType: 'world_edit',
          },
        );
        if (charged.ok) {
          rebuildJobId = charged.job.id;
          await enqueuePlatformJob(queue, charged.job.id);
        }
      }
      return c.json({
        persisted: true,
        revision: nextVersion,
        world: nextWorld,
        proposals: harness.proposals,
        applied: harness.applied,
        issues: harness.issues,
        summary: summarizeWorldSpec(nextWorld, 600),
        rebuildJobId,
        l2: toL2PresentationManifest(nextWorld),
        l3: toL3PresentationManifest(nextWorld),
      });
    }
    return c.json({
      persisted: false,
      world: harness.world,
      proposals: harness.proposals,
      applied: harness.applied,
      issues: harness.issues,
      summary: summarizeWorldSpec(harness.world, 600),
    });
  });

  /** LingBot sidecar health + interactive session proxy (L3 presentation). */
  authed.get('/projects/:projectId/world/lingbot/health', async (c) => {
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
    const { LingBotSessionClient } = await import('@opengame/world-runtime');
    const client = new LingBotSessionClient();
    const health = await client.health();
    return c.json({
      ...health,
      sidecarUrl: process.env['LINGBOT_SIDECAR_URL'] ?? 'http://127.0.0.1:8091',
      license: 'CC BY-NC-SA 4.0 (weights)',
      acceptNc: process.env['LINGBOT_ACCEPT_NC_LICENSE'] === 'true',
    });
  });

  authed.post('/projects/:projectId/world/lingbot/session', async (c) => {
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
    if (process.env['LINGBOT_ACCEPT_NC_LICENSE'] !== 'true') {
      return c.json(
        {
          error: 'Set LINGBOT_ACCEPT_NC_LICENSE=true (CC BY-NC-SA non-commercial)',
        },
        400,
      );
    }
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const world = parseWorldSpec(worldRow.specJson);
    const { openWorldVisualSession } = await import('@opengame/world-runtime');
    const session = await openWorldVisualSession(world);
    if (!session) {
      return c.json(
        { error: 'LingBot sidecar unreachable — start services/lingbot-sidecar' },
        503,
      );
    }
    return c.json({ session, summary: summarizeWorldSpec(world, 400) });
  });

  authed.post('/projects/:projectId/world/lingbot/step', async (c) => {
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
    const body = await c
      .req.json<{
        sessionId: string;
        action?: string;
        wasd?: string;
        textEvent?: string;
      }>()
      .catch(() => null);
    if (!body?.sessionId) return c.json({ error: 'sessionId required' }, 400);
    const {
      LingBotSessionClient,
      presentActionOnLingBot,
    } = await import('@opengame/world-runtime');
    const client = new LingBotSessionClient();
    if (body.action) {
      const result = await presentActionOnLingBot(
        { sessionId: body.sessionId, mode: 'session', step: 0 },
        body.action as
          | 'noop'
          | 'move_n'
          | 'move_s'
          | 'move_e'
          | 'move_w'
          | 'talk'
          | 'wait'
          | 'tick'
          | 'give_ore'
          | 'use_portal'
          | 'attack'
          | 'archery'
          | 'spell'
          | 'shoot',
        client,
      );
      return c.json(result);
    }
    const stepped = await client.step(body.sessionId, {
      wasd: body.wasd ?? 'idle',
      textEvent: body.textEvent,
    });
    return c.json({
      action: body.wasd ?? 'idle',
      frameUrl: stepped.frameUrl,
      session: stepped,
      skippedLingBot: false,
    });
  });

  /** Offline clip from LingBot session action_path (档 B research path). */
  authed.post('/projects/:projectId/world/lingbot/clip', async (c) => {
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
    if (process.env['LINGBOT_ACCEPT_NC_LICENSE'] !== 'true') {
      return c.json(
        {
          error: 'Set LINGBOT_ACCEPT_NC_LICENSE=true (CC BY-NC-SA non-commercial)',
        },
        400,
      );
    }
    const body = await c
      .req.json<{
        sessionId?: string;
        mode?: 'mock' | 'real';
        persist?: boolean;
        frameNum?: number;
        regionId?: string;
      }>()
      .catch(
        () =>
          ({} as {
            sessionId?: string;
            mode?: 'mock' | 'real';
            persist?: boolean;
            frameNum?: number;
            regionId?: string;
          }),
      );
    const { LingBotSessionClient, LingBotSpatialBackend } = await import(
      '@opengame/world-runtime'
    );
    const client = new LingBotSessionClient();
    let clip: {
      ok: boolean;
      videoUrl?: string;
      httpUrl?: string;
      localPath?: string;
      message?: string;
      mock?: boolean;
      fallbackFromReal?: boolean;
      realError?: string;
      profile?: string;
    };

    if (body.sessionId) {
      clip = await client.generateClip(body.sessionId, {
        mode: body.mode ?? (process.env['LINGBOT_MODE'] as 'mock' | 'real') ?? 'mock',
        frameNum: body.frameNum,
      });
    } else {
      const [worldRow] = await db
        .select()
        .from(worlds)
        .where(eq(worlds.projectId, projectId))
        .limit(1);
      if (!worldRow) return c.json({ error: 'no world' }, 404);
      const world = parseWorldSpec(worldRow.specJson);
      const backend = new LingBotSpatialBackend();
      const result = await backend.generateRegion({
        world,
        regionId: world.space.startRegionId,
        frameNum: body.frameNum,
        mode: body.mode,
      });
      clip = {
        ok: result.ok,
        videoUrl: result.videoUrl,
        localPath: result.localPath,
        message: result.message,
      };
    }

    if (!clip.ok) {
      return c.json({ error: clip.message ?? 'clip failed', ...clip }, 502);
    }

    let relativeVideoUrl: string | undefined;
    let previewUrl: string | undefined =
      clip.videoUrl && !clip.videoUrl.startsWith('file:')
        ? clip.videoUrl
        : clip.httpUrl;
    let persistedRevision: number | undefined;
    let persistedRegionId: string | undefined;

    // Stamp Spec + tipRevision + rewrite deployment world.json / spatial (L3 SSOT)
    if (body.persist !== false) {
      const [worldRow] = await db
        .select()
        .from(worlds)
        .where(eq(worlds.projectId, projectId))
        .limit(1);
      if (worldRow) {
        const world = parseWorldSpec(worldRow.specJson);
        const regionId =
          (body.regionId &&
          world.space.regions.some((r) => r.id === body.regionId)
            ? body.regionId
            : world.space.startRegionId) ?? world.space.startRegionId;
        persistedRegionId = regionId;
        const { readFile } = await import('node:fs/promises');
        const { putObjectText } = await import('../lib/s3.js');

        const resolveBytes = async (): Promise<Buffer | null> => {
          if (clip.localPath) {
            try {
              return await readFile(clip.localPath);
            } catch {
              // fall through
            }
          }
          const src =
            clip.videoUrl && !clip.videoUrl.startsWith('file:')
              ? clip.videoUrl
              : clip.httpUrl;
          if (!src) return null;
          if (src.startsWith('data:video/')) {
            const m = /^data:([^;,]+);base64,(.+)$/s.exec(src);
            if (m?.[2]) return Buffer.from(m[2], 'base64');
            return null;
          }
          if (src.startsWith('http://') || src.startsWith('https://')) {
            try {
              const res = await fetch(src, {
                signal: AbortSignal.timeout(120_000),
              });
              if (!res.ok) return null;
              return Buffer.from(await res.arrayBuffer());
            } catch {
              return null;
            }
          }
          return null;
        };

        const [dep] = await db
          .select()
          .from(deployments)
          .where(eq(deployments.projectId, projectId))
          .orderBy(desc(deployments.createdAt))
          .limit(1);
        let distPrefix: string | undefined;
        if (dep?.artifactId) {
          const [art] = await db
            .select()
            .from(artifacts)
            .where(eq(artifacts.id, dep.artifactId))
            .limit(1);
          const man = (art?.manifest ?? {}) as {
            distPrefix?: string;
          };
          distPrefix = man.distPrefix;
        }

        const bytes = await resolveBytes();
        if (bytes && bytes.length > 0) {
          const objectKey = distPrefix
            ? `${distPrefix.replace(/\/$/, '')}/spatial/${regionId}.mp4`
            : `projects/${projectId}/world-spatial/${regionId}.mp4`;
          await putObjectBytes(s3, env, objectKey, bytes, 'video/mp4');
          relativeVideoUrl = `./spatial/${regionId}.mp4`;
          try {
            previewUrl = await presignGetObject(s3, env, objectKey, 3600);
          } catch {
            // keep sidecar/data URL for panel
          }
        }

        const videoUrlForSpec =
          relativeVideoUrl ??
          (previewUrl && !previewUrl.startsWith('file:')
            ? previewUrl
            : clip.httpUrl);
        const nextVersion = Math.max(
          worldRow.tipRevision + 1,
          world.meta.version + 1,
        );
        const next = parseWorldSpec({
          ...world,
          meta: { ...world.meta, version: nextVersion },
          presentation: {
            ...world.presentation,
            cinematicEnabled: true,
            spatialBackend: world.presentation.spatialBackend ?? 'lingbot',
            lingbotMode:
              world.presentation.lingbotMode ??
              ((process.env['LINGBOT_MODE'] as 'mock' | 'real' | undefined) ??
                'mock'),
            spatialAssets: {
              ...(world.presentation.spatialAssets ?? {}),
              [regionId]: {
                ...(world.presentation.spatialAssets?.[regionId] ?? {}),
                backend: 'lingbot',
                videoUrl: videoUrlForSpec,
                licenseNote: 'CC BY-NC-SA 4.0',
              },
            },
          },
        });
        const moved = await persistWorldTipRevision(db, {
          worldId: worldRow.id,
          expectedTip: worldRow.tipRevision,
          nextVersion,
          specJson: next,
          title: next.meta.title,
          opJson: {
            op: 'lingbot_clip',
            regionId,
            relativeVideoUrl: relativeVideoUrl ?? null,
          },
          summary: `l3:clip:${regionId}`,
        });
        if (moved) persistedRevision = nextVersion;

        // Keep presenter deployment in sync with Spec tip (iframe remount reads these)
        if (distPrefix && moved) {
          const base = distPrefix.replace(/\/$/, '');
          const spatialAssets = next.presentation.spatialAssets ?? {};
          await putObjectText(
            s3,
            env,
            `${base}/world.json`,
            JSON.stringify(next, null, 2),
            'application/json',
          );
          await putObjectText(
            s3,
            env,
            `${base}/gameplay.json`,
            JSON.stringify(toGameplayManifest(next), null, 2),
            'application/json',
          );
          await putObjectText(
            s3,
            env,
            `${base}/lingbot.json`,
            JSON.stringify(
              {
                schema: 'opengame-lingbot-presenter-v1',
                spatialBackend: next.presentation.spatialBackend ?? 'lingbot',
                lingbotMode: next.presentation.lingbotMode ?? 'mock',
                cinematicEnabled: true,
                sidecarUrl:
                  process.env['LINGBOT_PUBLIC_BASE'] ??
                  process.env['LINGBOT_SIDECAR_URL'] ??
                  'http://127.0.0.1:8091',
                startRegionId: next.space.startRegionId,
              },
              null,
              2,
            ),
            'application/json',
          );
          await putObjectText(
            s3,
            env,
            `${base}/spatial/manifest.json`,
            JSON.stringify(
              {
                schema: 'opengame-spatial-manifest-v1',
                cinematicEnabled: true,
                backend: 'lingbot',
                lingbotMode: next.presentation.lingbotMode ?? null,
                regions: spatialAssets,
              },
              null,
              2,
            ),
            'application/json',
          );
        }
      }
    }

    return c.json({
      ...clip,
      ok: true,
      videoUrl: previewUrl ?? clip.videoUrl,
      previewUrl,
      relativeVideoUrl,
      tipRevision: persistedRevision,
      regionId: persistedRegionId,
      license: 'CC BY-NC-SA 4.0 (weights); research / non-commercial',
      note: 'Offline trajectory→clip. Spec tip + deployment world.json updated when persist=true. Interactive /step frames remain mock until upstream ships realtime serving.',
    });
  });

  /** Close LingBot session (persist action_path on sidecar). */
  authed.delete('/projects/:projectId/world/lingbot/session/:sessionId', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
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
    const { LingBotSessionClient } = await import('@opengame/world-runtime');
    const client = new LingBotSessionClient();
    const closed = await client.close(sessionId);
    return c.json({ ok: true, ...closed });
  });

  /** Convert OpenGame action manifest → sidecar npy/action_path (research). */
  authed.post('/projects/:projectId/world/lingbot/convert', async (c) => {
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
    const body = await c
      .req.json<{ actionManifest: unknown; writeNpy?: boolean }>()
      .catch(() => null);
    if (!body?.actionManifest) {
      return c.json({ error: 'actionManifest required' }, 400);
    }
    const { LingBotSessionClient } = await import('@opengame/world-runtime');
    const client = new LingBotSessionClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await client.convertAction(body.actionManifest as any, body.writeNpy ?? true);
    return c.json(result);
  });

  /** Smoke mock clip via API (no GPU). */
  authed.post('/projects/:projectId/world/lingbot/smoke', async (c) => {
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
    const base = (process.env['LINGBOT_SIDECAR_URL'] ?? 'http://127.0.0.1:8091').replace(
      /\/$/,
      '',
    );
    try {
      const res = await fetch(`${base}/v1/smoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        return c.json({ error: 'smoke failed', ...data }, 502);
      }
      return c.json(data);
    } catch (err) {
      return c.json(
        {
          error: 'sidecar unreachable',
          message: err instanceof Error ? err.message : String(err),
        },
        503,
      );
    }
  });

  /** POST enqueue world_train job (trajectory collect + MLP). */
  authed.post('/projects/:projectId/world/train', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c.req.json<{
      episodes?: number;
      epochs?: number;
      sync?: boolean;
    }>().catch(() => ({} as { episodes?: number; epochs?: number; sync?: boolean }));
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

    // Sync path for quick demos (no queue)
    if (body.sync) {
      const [worldRow] = await db
        .select()
        .from(worlds)
        .where(eq(worlds.projectId, projectId))
        .limit(1);
      if (!worldRow) return c.json({ error: 'no world' }, 404);
      const world = parseWorldSpec(worldRow.specJson);
      const traj = collectTrajectories({
        episodes: body.episodes ?? 12,
        stepsPerEpisode: 24,
        policy: 'scripted',
        seedWorld: world,
      });
      const samples = traj.map((t) => ({
        x: [...t.obs, ...t.actionVec],
        y: t.nextObs,
      }));
      const trained = trainMlp(samples, {
        epochs: body.epochs ?? 20,
        lr: 0.03,
        batchSize: 32,
      });
      const saved = await saveDynamicsWeights(projectId, {
        format: 'opengame-world-mlp-v1',
        finalLoss: trained.finalLoss,
        losses: trained.losses,
        weights: trained.weights,
        steps: traj.length,
        trainedAt: new Date().toISOString(),
        source: 'api-sync-train',
      });
      const mem = Array.isArray(worldRow.memoryJson)
        ? [...(worldRow.memoryJson as unknown[])]
        : [];
      mem.push({
        id: `dyn_${Date.now().toString(36)}`,
        kind: 'fact',
        text: `dynamics trained loss=${trained.finalLoss.toFixed(5)} steps=${traj.length}${saved ? ' · disk' : ''}`,
        tags: ['neural', 'dynamics'],
        createdAt: new Date().toISOString(),
        importance: 2,
      });
      await db
        .update(worlds)
        .set({ memoryJson: mem, updatedAt: new Date() })
        .where(eq(worlds.id, worldRow.id));
      return c.json({
        sync: true,
        steps: traj.length,
        finalLoss: trained.finalLoss,
        losses: trained.losses.slice(-5),
        modelPath: saved ? 'public/dynamics.json' : null,
        persisted: Boolean(saved),
      });
    }

    const quota = await assertCanEnqueueJob(db, env, proj.organizationId, 'world_train');
    if (!quota.ok) return quotaDenied(c, quota);
    const traceId = crypto.randomUUID();
    const charged = await insertChargedJob(
      db,
      env,
      {
        projectId,
        type: 'world_train',
        payload: { episodes: body.episodes, epochs: body.epochs },
        traceId,
      },
      {
        organizationId: proj.organizationId,
        projectId,
        jobType: 'world_train',
      },
    );
    if (!charged.ok) {
      return c.json(apiError(ErrorCode.QUOTA_EXCEEDED, charged.message), 402);
    }
    await enqueuePlatformJob(queue, charged.job.id);
    return c.json({ jobId: charged.job.id, traceId });
  });

  /** POST enqueue generative-agent society fast-forward. */
  authed.post('/projects/:projectId/world/society/run', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c
      .req.json<{
        hours?: number;
        seedText?: string;
        invitationText?: string;
        sync?: boolean;
      }>()
      .catch(
        () =>
          ({} as {
            hours?: number;
            seedText?: string;
            invitationText?: string;
            sync?: boolean;
          }),
      );
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
    const seedUgc =
      assertGeneratePrompt(body.seedText).ok === false
        ? assertGeneratePrompt(body.seedText)
        : assertGeneratePrompt(body.invitationText);
    if (!seedUgc.ok) {
      await writeAudit(db, {
        action: 'generate.ugc_block',
        actorUserId: jwt.sub,
        organizationId: proj.organizationId,
        target: projectId,
        meta: { brand: seedUgc.brand, kind: 'world_society_run' },
      });
      return c.json(
        apiError(
          ErrorCode.INVALID_INPUT,
          `prompt looks like a licensed franchise (${seedUgc.brand})`,
          { brand: seedUgc.brand },
        ),
        400,
      );
    }
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);

    if (body.sync) {
      const spec = parseWorldSpec(worldRow.specJson);
      const npcs = spec.entities.filter((e) => e.kind === 'npc');
      if (npcs.length < 2) {
        return c.json({ error: 'need ≥2 NPCs for society run' }, 400);
      }
      const hours = Math.min(Math.max(body.hours ?? 8, 1), 48);
      const seedText =
        body.seedText ?? gatheringSeedText(npcs[0]!.name, spec);
      const invitationText =
        body.invitationText ?? gatheringInvitationText(spec);
      let continued: Awaited<ReturnType<typeof continueSocietyHours>>;
      try {
        continued = await continueSocietyHours({
          db,
          worldId: worldRow.id,
          specJson: worldRow.specJson,
          hours,
          seedText,
          invitationText,
        });
      } catch (err) {
        if (isSocietyBusyError(err)) {
          return c.json({ error: 'society busy', code: 'society_busy' }, 423);
        }
        if (isSocietyTickTimeoutError(err)) {
          return c.json(
            { error: 'society tick timeout', code: 'society_tick_timeout' },
            503,
          );
        }
        throw err;
      }
      const { events, state, report } = continued;
      const gate = evaluateEmergenceGate(
        hours,
        report.informationSpread.rate,
        resolveGenreProfile(spec),
      );
      const spreadOk = gate.spreadOk;
      const gateFailed =
        gate.gateFailed &&
        process.env['PLATFORM_SOCIETY_SPREAD_SOFT'] !== 'true';
      try {
        const { publishSocietyReplayJson } = await import(
          '../lib/societyReplayExport.js'
        );
        await publishSocietyReplayJson({
          db,
          s3,
          env,
          projectId,
          worldId: worldRow.id,
        });
      } catch {
        // non-fatal — UI still hot-reloads via API + postMessage
      }
      return c.json({
        sync: true,
        events: events.length,
        simTime: state.simTime,
        report,
        spreadOk,
        gateFailed,
        windowHours: gate.windowHours,
        minSpread: gate.minSpread,
        error: gateFailed
          ? `emergence gate failed: spread ${(report.informationSpread.rate * 100).toFixed(0)}% < ${(gate.minSpread * 100).toFixed(0)}% after ${hours}h`
          : undefined,
      });
    }

    const quota = await assertCanEnqueueJob(
      db,
      env,
      proj.organizationId,
      'world_society_run',
    );
    if (!quota.ok) return quotaDenied(c, quota);
    const traceId = crypto.randomUUID();
    const charged = await insertChargedJob(
      db,
      env,
      {
        projectId,
        type: 'world_society_run',
        payload: {
          hours: body.hours,
          seedText: body.seedText,
          invitationText: body.invitationText,
        },
        traceId,
      },
      {
        organizationId: proj.organizationId,
        projectId,
        jobType: 'world_society_run',
      },
    );
    if (!charged.ok) {
      return c.json(apiError(ErrorCode.QUOTA_EXCEEDED, charged.message), 402);
    }
    await enqueuePlatformJob(queue, charged.job.id);
    return c.json({ jobId: charged.job.id, traceId });
  });

  /** POST one live society step (hydrate DB → stepSociety + LLM). */
  authed.post('/projects/:projectId/world/society/tick', async (c) => {
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const spec = parseWorldSpec(worldRow.specJson);
    const npcs = spec.entities.filter((e) => e.kind === 'npc');
    if (npcs.length < 2) {
      return c.json({ error: 'need ≥2 NPCs for society tick' }, 400);
    }
    if (!worldRow.clockPaused) {
      await db
        .update(worlds)
        .set({
          heartbeatEnabled: true,
        })
        .where(eq(worlds.id, worldRow.id))
        .catch(() => undefined);
    }
    const light = talkBudgetOptsFromWorld(worldRow);
    const reservedAt = Date.now();
    let reserved = 0;
    let reservedLane: 'floor' | 'lit' = 'floor';
    let result: Awaited<ReturnType<typeof tickSocietyOnce>>;
    try {
      result = await tickSocietyOnce({
        db,
        worldId: worldRow.id,
        specJson: worldRow.specJson,
        frozen: Boolean(worldRow.clockPaused),
        prepareInsideLock: worldRow.clockPaused
          ? undefined
          : async () => {
              const budgetOpen = await societyTalkBudgetOpen(
                ctx.redis,
                worldRow.id,
                reservedAt,
                light,
              );
              let mute = societyTalkMuteReason({
                presenceUntil: worldRow.heartbeatUntil,
                authorWatchUntil: worldRow.authorWatchUntil,
                townTimeUntil: worldRow.townTimeUntil,
                clockPaused: worldRow.clockPaused,
                budgetOpen,
              });
              if (mute == null) {
                const claimed = await reserveSocietyTalks(
                  ctx.redis,
                  worldRow.id,
                  1,
                  reservedAt,
                  light,
                );
                if (claimed) {
                  reserved = 1;
                  reservedLane = claimed;
                } else mute = 'budget';
              }
              const llm =
                mute == null
                  ? await createOptionalSocietyLlm({
                      timeoutMs: 18_000,
                      lane: pickSocietyLlmLane({
                        reserved: reservedLane,
                        litUntil: worldRow.lightUntil,
                        leaseBonus: worldRow.lightBonusPerHour,
                      }),
                      consumeEmergency: () =>
                        consumeEmergencySocietyTalk(ctx.redis),
                    })
                  : undefined;
              return { llm, ...(mute ? { muteReason: mute } : {}) };
            },
      });
    } catch (err) {
      if (reserved) {
        await releaseSocietyTalks(
          ctx.redis,
          worldRow.id,
          reserved,
          reservedAt,
          reservedLane,
        );
      }
      if (isSocietyBusyError(err)) {
        return c.json({ error: 'society busy', code: 'society_busy' }, 423);
      }
      if (isSocietyTickTimeoutError(err)) {
        return c.json(
          { error: 'society tick timeout', code: 'society_tick_timeout' },
          503,
        );
      }
      throw err;
    }
    await settleSocietyTalks(
      ctx.redis,
      worldRow.id,
      reserved,
      result.talksStarted,
      reservedAt,
      reservedLane,
      light,
    );
    try {
      const { scheduleSocietyReplayPublish } = await import(
        '../lib/societyReplayExport.js'
      );
      scheduleSocietyReplayPublish({
        db,
        s3,
        env,
        projectId,
        worldId: worldRow.id,
        events: result.events,
      });
    } catch {
      // non-fatal
    }
    return c.json({
      ...result,
      talkBudget: await peekSocietyTalkBudget(
        ctx.redis,
        worldRow.id,
        Date.now(),
        light,
      ),
    });
  });

  /** GET society event stream for observatory replay. */
  authed.get('/projects/:projectId/world/society/events', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const from = Number(c.req.query('from') ?? 0);
    const to = Number(c.req.query('to') ?? 1e9);
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    // Live UI only needs a short recent window — large fat payloads used to
    // crash JSON.stringify (RangeError: Invalid string length) and freeze the tab.
    const limitRaw = Number(c.req.query('limit') ?? 120);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(500, Math.max(1, Math.floor(limitRaw)))
      : 120;
    // Latest-first so live UI does not scan thousands of ASC rows on refresh.
    const rowsDesc = await db
      .select()
      .from(societyEvents)
      .where(
        and(
          eq(societyEvents.worldId, worldRow.id),
          eq(societyEvents.invalidated, 0),
          sql`${societyEvents.kind} NOT IN ('emergence_report', 'occupancy_ema', 'object_tip')`,
          sql`${societyEvents.simTime}::float >= ${from}`,
          sql`${societyEvents.simTime}::float <= ${to}`,
        ),
      )
      .orderBy(desc(societyEvents.simTime), desc(societyEvents.createdAt))
      .limit(limit);
    const narrativeDesc = await db
      .select()
      .from(societyEvents)
      .where(
        and(
          eq(societyEvents.worldId, worldRow.id),
          eq(societyEvents.invalidated, 0),
          sql`(${societyEvents.kind} IN ('intervene', 'dialogue') OR (${societyEvents.kind} = 'observation' AND ${societyEvents.payloadJson}->>'course' = 'true'))`,
          sql`${societyEvents.simTime}::float >= ${from}`,
          sql`${societyEvents.simTime}::float <= ${to}`,
        ),
      )
      .orderBy(desc(societyEvents.simTime), desc(societyEvents.createdAt))
      .limit(32);
    const interveneDesc = await db
      .select()
      .from(societyEvents)
      .where(
        and(
          eq(societyEvents.worldId, worldRow.id),
          eq(societyEvents.invalidated, 0),
          eq(societyEvents.kind, 'intervene'),
          sql`${societyEvents.simTime}::float >= ${from}`,
          sql`${societyEvents.simTime}::float <= ${to}`,
        ),
      )
      .orderBy(desc(societyEvents.createdAt))
      .limit(8);
    const toDto = (r: (typeof rowsDesc)[number]) => ({
      id: r.eventKey,
      simTime: Number(r.simTime),
      kind: r.kind,
      agentId: r.agentKey,
      payload: slimSocietyEventPayload(
        r.kind,
        r.payloadJson && typeof r.payloadJson === 'object'
          ? (r.payloadJson as Record<string, unknown>)
          : {},
      ),
      createdAtMs:
        r.createdAt instanceof Date
          ? r.createdAt.getTime()
          : r.createdAt
            ? Date.parse(String(r.createdAt))
            : 0,
    });
    const eventDtos = mergePinnedSocietyEvents(
      [...rowsDesc].reverse().map(toDto),
      [...narrativeDesc, ...interveneDesc].map(toDto),
    ).sort(comparePersistedSocietyEvents);
    const agents = await db
      .select()
      .from(worldAgents)
      .where(eq(worldAgents.worldId, worldRow.id));
    const relations = await db
      .select()
      .from(agentRelations)
      .where(eq(agentRelations.worldId, worldRow.id));
    const tipSim = rowsDesc.length
      ? Number(rowsDesc[0]!.simTime)
      : 0;
    const [objectTip, objectKindRows] = await Promise.all([
      loadObjectTip(db, worldRow.id).catch(() => null),
      loadLatestObjectStateEvents(db, worldRow.id, { limit: 200 }).catch(
        () => [],
      ),
    ]);
    return c.json({
      simTime: tipSim,
      events: eventDtos,
      agents: annotateAgentsWithAreas(
        worldRow.specJson,
        agents.map((a) => {
          const identity =
            a.identityJson && typeof a.identityJson === 'object'
              ? (a.identityJson as { summary?: unknown })
              : null;
          return {
            id: a.agentKey,
            name: a.name,
            regionId: a.regionId,
            x: Number(a.x),
            y: Number(a.y),
            currentAction: a.currentAction,
            identity: {
              summary:
                typeof identity?.summary === 'string'
                  ? identity.summary.slice(0, 240)
                  : '',
            },
          };
        }),
        eventDtos,
      ),
      relations: relations.map((r) => ({
        from: r.fromAgentKey,
        to: r.toAgentKey,
        summary:
          typeof r.summary === 'string' ? r.summary.slice(0, 200) : r.summary,
        affinity: Number(r.affinity),
        kind: (() => {
          const s = typeof r.summary === 'string' ? r.summary : '';
          const m = /^【([^】]+)】/u.exec(s);
          return m?.[1];
        })(),
        lastInteractSimTime:
          r.lastInteractSimTime != null
            ? Number(r.lastInteractSimTime)
            : undefined,
      })),
      objects: objectSnapshotFromSpec(
        worldRow.specJson,
        objectKindRows,
        objectTip,
      ),
      ...townPresenceBadge({
        presenceUntil: worldRow.heartbeatUntil,
        authorWatchUntil: worldRow.authorWatchUntil,
        townTimeUntil: worldRow.townTimeUntil,
        litUntil: worldRow.lightUntil,
      }),
      clockPaused: Boolean(worldRow.clockPaused),
      ...(worldRow.clockPaused ? { living: false, speaking: false } : {}),
      townTimeUntil: worldRow.townTimeUntil?.toISOString() ?? null,
      presenceUntil: worldRow.heartbeatUntil?.toISOString() ?? null,
      talkBudget: await peekSocietyTalkBudget(
        ctx.redis,
        worldRow.id,
        Date.now(),
        talkBudgetOptsFromWorld(worldRow),
      ),
      ...(await attachTownCeremony(db, ctx.redis, projectId, worldRow)),
    });
  });

  /** POST slim society_replay.json to preview dist (fixes fat JSON freezing iframe on open). */
  authed.post('/projects/:projectId/world/society/republish-replay', async (c) => {
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const { publishSocietyReplayJson } = await import('../lib/societyReplayExport.js');
    const result = await publishSocietyReplayJson({
      db,
      s3,
      env,
      projectId,
      worldId: worldRow.id,
    });
    return c.json(result);
  });

  /** GET latest emergence report card (persisted after society run). */
  authed.get('/projects/:projectId/world/society/report', async (c) => {
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const report = await loadEmergenceReport(db, worldRow.id);
    if (!report) return c.json({ report: null });
    return c.json({ report });
  });

  /** GET agent memory stream + plans for inspector. */
  authed.get('/projects/:projectId/world/society/agents/:agentKey', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const agentKey = c.req.param('agentKey');
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const memories = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.worldId, worldRow.id),
          eq(agentMemories.agentKey, agentKey),
        ),
      )
      .orderBy(desc(agentMemories.simTime))
      .limit(80);
    const reflections = await db
      .select()
      .from(agentMemories)
      .where(
        and(
          eq(agentMemories.worldId, worldRow.id),
          eq(agentMemories.agentKey, agentKey),
          eq(agentMemories.kind, 'reflection'),
        ),
      )
      .orderBy(desc(agentMemories.simTime))
      .limit(24);
    const memoryById = new Map<string, (typeof memories)[number]>();
    for (const row of [...reflections, ...memories]) {
      memoryById.set(
        (row as { memoryKey?: string }).memoryKey || row.id,
        row,
      );
    }
    const mergedMemories = [...memoryById.values()].sort(
      (a, b) => Number(b.simTime) - Number(a.simTime),
    );
    const plans = await db
      .select()
      .from(agentPlans)
      .where(
        and(
          eq(agentPlans.worldId, worldRow.id),
          eq(agentPlans.agentKey, agentKey),
        ),
      )
      .orderBy(desc(agentPlans.dayIndex))
      .limit(3);
    const [agent] = await db
      .select()
      .from(worldAgents)
      .where(
        and(
          eq(worldAgents.worldId, worldRow.id),
          eq(worldAgents.agentKey, agentKey),
        ),
      )
      .limit(1);
    const recentEvents = await loadRecentSocietyEvents(db, worldRow.id, {
      limit: 80,
    }).catch(() => []);
    const pose = agent
      ? annotateAgentsWithAreas(
          worldRow.specJson,
          [
            {
              id: agent.agentKey,
              regionId: agent.regionId,
              x: Number(agent.x),
              y: Number(agent.y),
              currentAction: agent.currentAction,
            },
          ],
          recentEvents,
        )[0]
      : undefined;
    const [planEvtRow] = await db
      .select({
        payloadJson: societyEvents.payloadJson,
      })
      .from(societyEvents)
      .where(
        and(
          eq(societyEvents.worldId, worldRow.id),
          eq(societyEvents.agentKey, agentKey),
          eq(societyEvents.kind, 'plan'),
          eq(societyEvents.invalidated, 0),
        ),
      )
      .orderBy(desc(societyEvents.simTime))
      .limit(1);
    const planPayload =
      planEvtRow?.payloadJson && typeof planEvtRow.payloadJson === 'object'
        ? (planEvtRow.payloadJson as Record<string, unknown>)
        : {};
    const planReplan = planPayload['replan'] === true;
    const planReason =
      typeof planPayload['reason'] === 'string'
        ? String(planPayload['reason']).slice(0, 160)
        : undefined;
    const planDay =
      typeof planPayload['dayIndex'] === 'number'
        ? Number(planPayload['dayIndex'])
        : undefined;
    const stampedPlans = stampSocietyPlansFromSpec(
      worldRow.specJson,
      plans.map((p, i) => ({
        dayIndex: p.dayIndex,
        segments: p.segmentsJson,
        ...(planReplan && (planDay == null ? i === 0 : planDay === p.dayIndex)
          ? { replan: true as const, reason: planReason }
          : {}),
      })),
    );
    const specEntity = parseWorldSpec(worldRow.specJson).entities.find(
      (e) => e.id === agentKey || (e.kind === 'npc' && e.name === agent?.name),
    );
    const { identityFromSpecEntity } = await import('../lib/societyReady.js');
    const storedIdent =
      agent?.identityJson && typeof agent.identityJson === 'object'
        ? (agent.identityJson as Record<string, unknown>)
        : {};
    const specIdent = identityFromSpecEntity(specEntity);
    return c.json({
      agent: agent
        ? {
            id: agent.agentKey,
            name: agent.name,
            regionId: agent.regionId,
            x: Number(agent.x),
            y: Number(agent.y),
            currentAction: agent.currentAction,
            identity: {
              ...storedIdent,
              ...specIdent,
            },
            areaId: pose?.areaId,
            areaName: pose?.areaName,
            regionName: pose?.regionName,
            goalX: pose?.goalX,
            goalY: pose?.goalY,
            goalPlace: pose?.goalPlace,
            goalReason: pose?.goalReason,
            drive: pose?.drive,
            needs:
              agent.needsJson && typeof agent.needsJson === 'object'
                ? agent.needsJson
                : undefined,
          }
        : null,
      memories: mergedMemories.map((m) => ({
        id: (m as { memoryKey?: string }).memoryKey || m.id,
        kind: m.kind,
        text: m.text,
        simTime: Number(m.simTime),
        importance: m.importance,
        pointers: m.pointersJson,
      })),
      plans: stampedPlans,
    });
  });

  /** POST 点亮世界 — author pays to raise this town’s hourly talk burn. */
  authed.post('/projects/:projectId/world/light', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = (await c.req.json().catch(() => ({}))) as { sku?: string };
    const sku = parsePaidWorldLightSku(body.sku);
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) return c.json({ error: 'not found', code: 'NOT_FOUND' }, 404);
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
    if (!mem) return c.json({ error: 'forbidden', code: 'FORBIDDEN' }, 403);
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world', code: 'NOT_FOUND' }, 404);
    const points = worldLightCost(sku);
    const published = await findCommunityByProject(db, projectId);
    const paid = await transferToAuthor(db, {
      fromOrgId: proj.organizationId,
      toOrgId: proj.organizationId,
      userId: jwt.sub,
      gameId: published?.id ?? null,
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
    const applied = await applyWorldLightSku(db, worldRow.id, sku);
    if (!applied) {
      await refundVisitorTransfer(db, {
        fromOrgId: proj.organizationId,
        toOrgId: proj.organizationId,
        gameId: published?.id ?? null,
        kind: 'world_light',
        charged: paid.charged,
        authorPoints: paid.authorPoints,
        note: '点亮未落到世界',
      });
      return c.json({ error: 'world light did not apply', code: 'INTERNAL' }, 500);
    }
    if (applied.hourPackBonus > 0) {
      const granted = await grantHourLightBonus(
        ctx.redis,
        worldRow.id,
        applied.hourPackBonus,
      );
      if (granted <= 0) {
        await refundVisitorTransfer(db, {
          fromOrgId: proj.organizationId,
          toOrgId: proj.organizationId,
          gameId: published?.id ?? null,
          kind: 'world_light',
          charged: paid.charged,
          authorPoints: paid.authorPoints,
          note: '点亮本小时未落到额度',
        });
        return c.json({ error: 'world light did not apply', code: 'INTERNAL' }, 500);
      }
    }
    const talkBudget = await peekSocietyTalkBudget(
      ctx.redis,
      worldRow.id,
      Date.now(),
      talkBudgetOptsFromWorld(applied),
    );
    const bonus =
      talkBudget?.litBonus || applied.hourPackBonus || applied.lightBonusPerHour;
    const displayName = await loadUserPublicName(db, jwt.sub).catch(() => '作者');
    await publishSocietyPatron(ctx.redis, worldRow.id, {
      og: 'world-light',
      displayName,
      bonus,
      lightUntil: applied.lightUntil?.toISOString() ?? null,
      talkBudget,
      contributors: [],
      watcherCount: 0,
    }).catch(() => undefined);
    return c.json({
      ...paid,
      sku,
      lightUntil: applied.lightUntil?.toISOString() ?? null,
      lightBonusPerHour: applied.lightBonusPerHour,
      talkBudget,
    });
  });

  authed.post('/projects/:projectId/world/society/interview', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c.req.json<{
      agentKey?: string;
      question?: string;
    }>();
    const agentKey = body.agentKey?.trim() ?? '';
    const question = body.question?.trim() ?? '';
    if (!agentKey || !question) {
      return c.json(
        { error: 'agentKey and question required', code: 'invalid_input' },
        400,
      );
    }
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!proj) return c.json({ error: 'not found', code: 'NOT_FOUND' }, 404);
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
    if (!mem) return c.json({ error: 'forbidden', code: 'FORBIDDEN' }, 403);
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world', code: 'NOT_FOUND' }, 404);
    const reservedAt = Date.now();
    const { mute, reserved, lane } = await decideSocietyTalks(
      ctx.redis,
      worldRow,
      reservedAt,
    );
    if (mute === 'budget' || mute === 'no_key') {
      try {
        const result = await interviewSocietyAgentFromMemories({
          db,
          worldId: worldRow.id,
          specJson: worldRow.specJson,
          agentKey,
          question,
        });
        return c.json({ ...result, source: 'memory', mute });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) {
          return c.json({ error: 'agent not found', code: 'NOT_FOUND' }, 404);
        }
        throw err;
      }
    }
    if (mute) {
      return c.json({ error: mute, code: mute }, 409);
    }
    const llm = await createOptionalSocietyLlm({
      timeoutMs: 18_000,
      lane: pickSocietyLlmLane({
        reserved: lane,
        litUntil: worldRow.lightUntil,
        leaseBonus: worldRow.lightBonusPerHour,
      }),
      consumeEmergency: () => consumeEmergencySocietyTalk(ctx.redis),
    });
    if (!llm) {
      await releaseSocietyTalks(
        ctx.redis,
        worldRow.id,
        reserved,
        reservedAt,
        lane ?? 'floor',
      );
      try {
        const result = await interviewSocietyAgentFromMemories({
          db,
          worldId: worldRow.id,
          specJson: worldRow.specJson,
          agentKey,
          question,
        });
        return c.json({ ...result, source: 'memory', mute: 'no_key' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) {
          return c.json({ error: 'agent not found', code: 'NOT_FOUND' }, 404);
        }
        return c.json({ error: 'no model key', code: 'no_llm' }, 503);
      }
    }
    try {
      const result = await interviewSocietyAgent({
        db,
        worldId: worldRow.id,
        specJson: worldRow.specJson,
        agentKey,
        question,
        llm,
      });
      await settleSocietyTalks(
        ctx.redis,
        worldRow.id,
        reserved,
        1,
        reservedAt,
        lane ?? 'floor',
        talkBudgetOptsFromWorld(worldRow),
      );
      return c.json(result);
    } catch (err) {
      await releaseSocietyTalks(
        ctx.redis,
        worldRow.id,
        reserved,
        reservedAt,
        lane ?? 'floor',
      );
      const msg = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : '';
      if (msg.includes('not found')) {
        return c.json({ error: 'agent not found', code: 'NOT_FOUND' }, 404);
      }
      if (
        name === 'SocietyLlmKeysExhaustedError' ||
        /keys_exhausted|全部无效/.test(msg)
      ) {
        try {
          const result = await interviewSocietyAgentFromMemories({
            db,
            worldId: worldRow.id,
            specJson: worldRow.specJson,
            agentKey,
            question,
          });
          return c.json({ ...result, source: 'memory', mute: 'keys_exhausted' });
        } catch {
          return c.json({ error: 'keys_exhausted', code: 'keys_exhausted' }, 503);
        }
      }
      throw err;
    }
  });

  authed.get('/projects/:projectId/world/society/opinion', async (c) => {
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const mind = hydrateMind(await loadDurableSocietyMind(db, worldRow.id));
    const saved = await loadLatestSocietyForecast(db, worldRow.id).catch(() => null);
    const bands = Array.isArray(saved?.bands) ? saved.bands : [];
    return c.json({ ...boardView(mind), forecastBands: bands });
  });

  authed.post('/projects/:projectId/world/society/forecast', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c.req
      .json<{
        hours?: number;
        mode?: string;
        decision?: string;
        execution?: 'negotiate' | 'disperse' | 'sudden' | 'exercise_live' | 'exercise_notice';
        title?: string;
        population?: number;
        grievance?: number;
        legitimacy?: number;
        noticeHours?: number;
        liveFire?: boolean;
        nearResidents?: boolean;
        windowHours?: number;
        medical?: boolean;
        preset?: 'contested' | 'exercise';
        scenarios?: Array<{ id: string; regionId?: string; delta: number }>;
      }>()
      .catch(
        () =>
          ({
            hours: 8,
            scenarios: [] as Array<{ id: string; regionId?: string; delta: number }>,
          }) as {
            hours?: number;
            mode?: string;
            decision?: string;
            execution?: 'negotiate' | 'disperse' | 'sudden' | 'exercise_live' | 'exercise_notice';
            title?: string;
            population?: number;
            grievance?: number;
            legitimacy?: number;
            noticeHours?: number;
            liveFire?: boolean;
            nearResidents?: boolean;
            windowHours?: number;
            medical?: boolean;
            preset?: 'contested' | 'exercise';
            scenarios?: Array<{ id: string; regionId?: string; delta: number }>;
          },
      );
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    if (body.mode === 'ensemble' || body.decision || body.preset) {
      const { submitEnsembleForecast } = await import('../lib/ensembleForecast.js');
      const queued = await submitEnsembleForecast(db, worldRow.id, body);
      return c.json({ version: 2, method: 'deep-ensemble', ...queued });
    }
    let mind = hydrateMind(await loadDurableSocietyMind(db, worldRow.id));
    if (!mind.crowd.length) {
      const agents = await loadSocietyAgents(db, worldRow.id);
      mind = {
        ...mind,
        crowd: deriveCrowd(
          agents.map((a) => ({
            id: a.id,
            name: a.name,
            regionId: a.regionId,
          })),
        ),
      };
    }
    const hours = Math.max(1, Math.min(48, Math.floor(body.hours ?? 8)));
    const compared = forecastScenarios(
      mind,
      (body.scenarios ?? []).slice(0, 4),
      hours,
      50,
      worldRow.id.length,
    );
    await saveSocietyForecast(db, worldRow.id, 'baseline', hours, compared.baseline).catch(
      () => undefined,
    );
    for (const scenario of compared.scenarios) {
      await saveSocietyForecast(db, worldRow.id, scenario.id, hours, scenario.bands).catch(
        () => undefined,
      );
    }
    return c.json({
      version: 1,
      method: 'bounded-confidence-mc',
      runs: 50,
      hours,
      bands: compared.baseline,
      scenarios: compared.scenarios,
    });
  });

  authed.get('/projects/:projectId/world/society/opinion-report', async (c) => {
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const mind = hydrateMind(await loadDurableSocietyMind(db, worldRow.id));
    const board = boardView(mind);
    const forecast = forecastCrowd(mind, 8, 30, 1);
    return c.json({
      title: worldRow.title,
      mindEnabled: worldRow.mindEnabled === true,
      crowdSize: board.crowdSize,
      policies: board.policies.map((policy) => ({
        id: policy.id,
        title: policy.title,
        pending: policy.pending,
      })),
      history: board.history.slice(-24),
      leaders: board.leaders,
      reasons: board.reasons,
      regions: board.regions,
      quotes: board.quotes,
      forecast: forecast.bands,
      election: tallyElection(mind),
    });
  });

  authed.post('/projects/:projectId/world/society/mind', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c.req.json<{ enabled?: boolean }>().catch(() => ({ enabled: true }));
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    await db
      .update(worlds)
      .set({ mindEnabled: body.enabled !== false, updatedAt: new Date() })
      .where(eq(worlds.id, worldRow.id));
    return c.json({ mindEnabled: body.enabled !== false });
  });

  authed.post('/projects/:projectId/world/society/demography', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c.req.json<{
      total?: number;
      slices: Array<{
        regionId: string;
        occupation: string;
        ageBand?: string;
        income?: string;
        weight: number;
      }>;
    }>();
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const mind = hydrateMind(await loadDurableSocietyMind(db, worldRow.id));
    const next = {
      ...mind,
      crowd: cohortsFromDemography(body.slices ?? [], body.total ?? 1500),
    };
    const snapshot = mindSnapshot(next);
    await persistSocietyMind(db, worldRow.id, 0, snapshot);
    await upsertSocietyMindTables(db, worldRow.id, 0, snapshot).catch(() => undefined);
    return c.json(boardView(next));
  });

  authed.post('/projects/:projectId/world/society/calibrate', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c.req.json<{
      support: number;
      oppose: number;
      regionId?: string;
      trust?: number;
    }>();
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const mind = calibrateCrowd(hydrateMind(await loadDurableSocietyMind(db, worldRow.id)), {
      support: body.support,
      oppose: body.oppose,
      regionId: body.regionId,
      trust: body.trust,
    });
    const snapshot = mindSnapshot(mind);
    await persistSocietyMind(db, worldRow.id, 0, snapshot);
    await upsertSocietyMindTables(db, worldRow.id, 0, snapshot).catch(() => undefined);
    return c.json(boardView(mind));
  });

  authed.post('/projects/:projectId/world/society/link', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c.req.json<{
      targetProjectId: string;
      people?: number;
      fromRegion?: string;
      toRegion?: string;
    }>();
    const targetProjectId = body.targetProjectId?.trim();
    if (!targetProjectId || targetProjectId === projectId) {
      return c.json({ error: 'target required' }, 400);
    }
    const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const [target] = await db.select().from(projects).where(eq(projects.id, targetProjectId)).limit(1);
    if (!proj || !target) return c.json({ error: 'not found' }, 404);
    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, jwt.sub));
    const orgs = new Set(memberships.map((row) => row.organizationId));
    if (!orgs.has(proj.organizationId) || !orgs.has(target.organizationId)) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const [fromWorld] = await db.select().from(worlds).where(eq(worlds.projectId, projectId)).limit(1);
    const [toWorld] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, targetProjectId))
      .limit(1);
    if (!fromWorld || !toWorld) return c.json({ error: 'no world' }, 404);
    const fromMind = hydrateMind(await loadDurableSocietyMind(db, fromWorld.id));
    const toMind = hydrateMind(await loadDurableSocietyMind(db, toWorld.id));
    const moved = movePeopleBetweenTowns({
      from: fromMind,
      to: toMind,
      people: body.people ?? 40,
      fromRegion: body.fromRegion ?? 'market',
      toRegion: body.toRegion ?? 'plaza',
    });
    if (!moved.moved) return c.json({ moved: 0 });
    const fromNext = publishPolicy(moved.from, {
      id: `leave_${Date.now()}`,
      title: '有人迁去邻镇',
      body: `${moved.moved} 人离开了。`,
      at: 0,
    });
    const toNext = publishPolicy(moved.to, {
      id: `arrive_${Date.now()}`,
      title: '邻镇有人迁入',
      body: `${moved.moved} 人到了。`,
      at: 0,
    });
    const fromSnap = mindSnapshot(fromNext);
    const toSnap = mindSnapshot(toNext);
    await persistSocietyMind(db, fromWorld.id, 0, fromSnap);
    await persistSocietyMind(db, toWorld.id, 0, toSnap);
    await upsertSocietyMindTables(db, fromWorld.id, 0, fromSnap).catch(() => undefined);
    await upsertSocietyMindTables(db, toWorld.id, 0, toSnap).catch(() => undefined);
    return c.json({ moved: moved.moved, from: boardView(fromNext), to: boardView(toNext) });
  });

  authed.post('/projects/:projectId/world/society/scenario', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c.req.json<{
      kind: 'election' | 'rumor' | 'price' | 'disaster' | 'mayor' | 'audience' | 'migrate';
      topicId?: string;
      regionId?: string;
      toRegion?: string;
      people?: number;
      delta?: number;
      base?: number;
      stance?: number;
      issue?: string;
      choice?: number;
      support?: number;
      oppose?: number;
      enact?: boolean;
      topic?: string;
    }>();
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    let mind = hydrateMind(await loadDurableSocietyMind(db, worldRow.id));
    if (body.kind === 'election') {
      const tally = tallyElection(mind, body.topicId);
      if (!body.enact) return c.json(tally);
      const decree = electionDecree(tally, body.topic ?? body.topicId ?? '动议');
      mind = publishPolicy(mind, {
        id: `election_${Date.now()}`,
        title: decree.title,
        body: decree.body,
        tags: body.regionId ? [body.regionId] : [],
        at: 0,
        effects: decree.effects,
      });
    } else if (body.kind === 'price') {
      const shock = priceShock({
        base: body.base ?? 10,
        stance: body.stance ?? 0,
        size: mind.crowd.reduce((sum, cohort) => sum + cohort.size, 0),
      });
      if (!body.enact) return c.json({ price: shock.price, title: shock.title });
      mind = publishPolicy(mind, {
        id: `price_${Date.now()}`,
        title: shock.title,
        body: shock.body,
        tags: body.regionId ? [body.regionId] : [],
        at: 0,
        effects: shock.effects,
      });
    } else if (body.kind === 'mayor') {
      const choices = mayorChoices(body.issue ?? '镇务');
      if (body.choice == null) return c.json({ choices });
      const picked = choices[body.choice] ?? choices[0]!;
      mind = publishPolicy(mind, {
        id: `mayor_${Date.now()}`,
        title: picked.title,
        body: picked.body,
        tags: [...picked.tags],
        at: 0,
      });
    } else if (body.kind === 'disaster') {
      const regionId = body.regionId ?? 'market';
      mind = publishPolicy(mind, {
        id: `disaster_${Date.now()}`,
        title: `${regionId}告急`,
        body: `居民离开${regionId}`,
        tags: [regionId],
        at: 0,
        effects: disasterEffects(regionId),
      });
    } else if (body.kind === 'rumor') {
      const line = (body.topic ?? body.topicId ?? '一件传闻').slice(0, 72);
      if (body.topicId) mind = shiftConfidence(mind, body.topicId, body.delta ?? -0.2);
      mind = publishPolicy(mind, {
        id: `rumor_${Date.now()}`,
        title: line,
        body: line,
        channel: 'word',
        at: 0,
      });
      mind = openSpotlight(mind, line, 0);
    } else if (body.kind === 'audience') {
      const topicId = body.topicId ?? mind.policies.at(-1)?.id ?? 'talk';
      mind = applyAudienceBallot(mind, topicId, {
        support: body.support ?? 0,
        oppose: body.oppose ?? 0,
      });
      const lean = (body.support ?? 0) >= (body.oppose ?? 0) ? '观众更支持' : '观众更反对';
      mind = publishPolicy(mind, {
        id: `audience_${Date.now()}`,
        title: lean,
        body: lean,
        channel: 'word',
        at: 0,
      });
      mind = openSpotlight(mind, lean, 0);
    } else if (body.kind === 'migrate') {
      mind = migrateCohort(
        mind,
        body.regionId ?? 'market',
        body.toRegion ?? 'plaza',
        body.people ?? 20,
      );
    } else {
      return c.json({ error: 'unknown scenario' }, 400);
    }
    const snapshot = mindSnapshot(mind);
    await persistSocietyMind(db, worldRow.id, mind.policies.at(-1)?.at ?? 0, snapshot);
    await upsertSocietyMindTables(
      db,
      worldRow.id,
      mind.policies.at(-1)?.at ?? 0,
      snapshot,
    ).catch(() => undefined);
    return c.json({ opinion: boardView(mind) });
  });

  /** POST intervene then locally recompute (hybrid). */
  authed.post('/projects/:projectId/world/society/intervene', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c.req.json<{
      fromSimTime: number;
      kind: 'whisper' | 'set_object' | 'inject_event' | 'policy';
      agentKey?: string;
      text?: string;
      title?: string;
      tags?: string[];
      channel?: 'notice' | 'broadcast' | 'word';
      objectId?: string;
      objectState?: string;
      recomputeHours?: number;
      effects?: {
        objectId?: string;
        objectState?: string;
        regionId?: string;
        urgentActivity?: string;
        needMul?: number;
      };
    }>();
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);

    if (body.kind === 'policy') {
      const title = (body.title || body.text || '').trim();
      const text = (body.text || title).trim();
      if (!title) return c.json({ error: 'title required' }, 400);
      const effects = body.effects ?? (
        body.objectId
          ? { objectId: body.objectId, objectState: body.objectState }
          : undefined
      );
      const mind = publishPolicy(hydrateMind(await loadDurableSocietyMind(db, worldRow.id)), {
        id: `policy_${Date.now()}`,
        title,
        body: text,
        tags: body.tags ?? [],
        channel: body.channel ?? 'notice',
        at: Number(body.fromSimTime) || 0,
        ...(effects ? { effects } : {}),
      });
      const policySnap = mindSnapshot(mind);
      await persistSocietyMind(
        db,
        worldRow.id,
        mind.policies.at(-1)?.at ?? 0,
        policySnap,
      );
      await upsertSocietyMindTables(
        db,
        worldRow.id,
        mind.policies.at(-1)?.at ?? 0,
        policySnap,
      ).catch(() => undefined);
      return c.json({
        live: true,
        policyId: mind.policies.at(-1)?.id,
        opinion: boardView(mind),
      });
    }

    const liveWhisper =
      (body.kind === 'whisper' || body.kind === 'inject_event') &&
      Boolean(body.text?.trim()) &&
      !(typeof body.recomputeHours === 'number' && body.recomputeHours > 0);
    if (liveWhisper) {
      if (body.kind === 'inject_event') {
        const text = body.text!.trim();
        const mind = publishPolicy(hydrateMind(await loadDurableSocietyMind(db, worldRow.id)), {
          id: `event_${Date.now()}`,
          title: (body.title || text).slice(0, 80),
          body: text,
          tags: body.tags ?? [],
          channel: body.channel ?? 'word',
          at: Number(body.fromSimTime) || 0,
        });
        const eventSnap = mindSnapshot(mind);
        await persistSocietyMind(
          db,
          worldRow.id,
          mind.policies.at(-1)?.at ?? 0,
          eventSnap,
        );
        await upsertSocietyMindTables(
          db,
          worldRow.id,
          mind.policies.at(-1)?.at ?? 0,
          eventSnap,
        ).catch(() => undefined);
      }
      let injected: Awaited<ReturnType<typeof whisperSocietyLive>>;
      try {
        injected = await landTownStimulus({
          db,
          redis: ctx.redis,
          world: worldRow,
          agentKey: body.agentKey?.trim() || undefined,
          text: body.text!.trim(),
        });
      } catch (err) {
        if (isSocietyBusyError(err)) {
          return c.json({ error: 'society busy', code: 'society_busy' }, 423);
        }
        if (isSocietyTickTimeoutError(err)) {
          return c.json(
            { error: 'society tick timeout', code: 'society_tick_timeout' },
            503,
          );
        }
        throw err;
      }
      try {
        const { scheduleSocietyReplayPublish } = await import(
          '../lib/societyReplayExport.js'
        );
        scheduleSocietyReplayPublish({
          db,
          s3,
          env,
          projectId,
          worldId: worldRow.id,
          events: injected.events,
        });
      } catch {
        // non-fatal
      }
      return c.json({
        live: true,
        events: injected.events.length,
        simTime: injected.simTime,
        delta: injected.events,
        agents: injected.agents,
        relations: injected.relations,
        objects: injected.objects,
        rumor: injected.rumor,
        focusAgentId: injected.focusAgentId,
        llm: injected.llm,
        degraded: injected.degraded,
      });
    }

    const liveObject =
      body.kind === 'set_object' &&
      Boolean(body.objectId) &&
      !(typeof body.recomputeHours === 'number' && body.recomputeHours > 0);
    if (liveObject) {
      let injected: Awaited<ReturnType<typeof setObjectSocietyLive>>;
      try {
        injected = await setObjectSocietyLive({
          db,
          worldId: worldRow.id,
          specJson: worldRow.specJson,
          objectId: body.objectId!.trim(),
          objectState: (body.objectState ?? 'changed').trim(),
        });
      } catch (err) {
        if (isSocietyBusyError(err)) {
          return c.json({ error: 'society busy', code: 'society_busy' }, 423);
        }
        if (isSocietyTickTimeoutError(err)) {
          return c.json(
            { error: 'society tick timeout', code: 'society_tick_timeout' },
            503,
          );
        }
        throw err;
      }
      return c.json({
        live: true,
        events: injected.events.length,
        simTime: injected.simTime,
        delta: injected.events,
        agents: injected.agents,
        relations: injected.relations,
        objects: injected.objects,
        rumor: false,
        focusAgentId: injected.focusAgentId,
      });
    }

    // Rewind deletes history and rewrites state, so it must not interleave with
    // a live tick or the worker heartbeat advancing the same world.
    let rewound: {
      events: number;
      simTime: number;
      report: unknown;
      pendingTalks: import('@opengame/world-agents').PendingSocietyTalk[];
      llm?: Awaited<ReturnType<typeof createOptionalSocietyLlm>>;
    };
    try {
      rewound = await withSocietyWorldLock(
        worldRow.id,
        () => rewindAndRecompute(),
        { holdMs: 180_000, waitMs: 12_000 },
      );
    } catch (err) {
      if (isSocietyBusyError(err)) {
        return c.json({ error: 'society busy', code: 'society_busy' }, 423);
      }
      if (isSocietyTickTimeoutError(err)) {
        return c.json(
          { error: 'society tick timeout', code: 'society_tick_timeout' },
          503,
        );
      }
      throw err;
    }

    if (rewound.pendingTalks.length && rewound.llm) {
      scheduleSocietyTalkTail({
        db,
        worldId: worldRow.id,
        specJson: worldRow.specJson,
        llm: rewound.llm,
        jobs: rewound.pendingTalks,
      });
    }
    try {
      const { publishSocietyReplayJson } = await import(
        '../lib/societyReplayExport.js'
      );
      await publishSocietyReplayJson({
        db,
        s3,
        env,
        projectId,
        worldId: worldRow.id,
      });
    } catch {
      // non-fatal
    }
    return c.json({
      events: rewound.events,
      simTime: rewound.simTime,
      report: rewound.report,
    });

    async function rewindAndRecompute(): Promise<{
      events: number;
      simTime: number;
      report: unknown;
      pendingTalks: import('@opengame/world-agents').PendingSocietyTalk[];
      llm?: Awaited<ReturnType<typeof createOptionalSocietyLlm>>;
    }> {
    await invalidateSocietyEventsFrom(db, worldRow.id, body.fromSimTime);
    await deleteSocietyMemoriesFrom(db, worldRow.id, body.fromSimTime);

    const spec = parseWorldSpec(worldRow.specJson);
    const state = societyStateFromSpec(spec);
    truncateEventsAfter(state, body.fromSimTime);

    const poses = await loadAgentPosesBefore(db, worldRow.id, body.fromSimTime);
    const priorAgents = await loadSocietyAgents(db, worldRow.id);
    const remaining = await loadSocietyReplayBundle(db, worldRow.id);
    overlayPersistedSociety(state, {
      simTime: body.fromSimTime,
      agents: priorAgents,
      memories: await loadSocietyMemoriesBefore(db, worldRow.id, body.fromSimTime),
      plans: await loadSocietyPlans(db, worldRow.id),
      relations: await loadSocietyRelations(db, worldRow.id),
      lastConverseAt: lastConverseAtFromEvents(
        remaining.events.filter((e) => e.simTime < body.fromSimTime),
      ),
    });
    for (const a of priorAgents) {
      const cur = state.agents.find((x) => x.id === a.id);
      if (!cur) continue;
      const pose = poses.get(a.id);
      if (pose) {
        cur.x = pose.x;
        cur.y = pose.y;
        cur.regionId = pose.regionId;
        cur.currentAction = pose.currentAction;
      }
    }

    if (body.kind === 'whisper' && body.agentKey && body.text) {
      state.stream.add(
        createMemoryEntry({
          id: `whisper_${Date.now()}`,
          agentId: body.agentKey,
          kind: 'observation',
          text: whisperMemory(body.text, societyCopyAscii(state)),
          simTime: body.fromSimTime,
          importance: 8,
        }),
      );
    }
    if (body.kind === 'set_object' && body.objectId) {
      state.objects.push({
        id: body.objectId,
        areaId: 'intervened',
        name: body.objectId,
        state: body.objectState ?? 'changed',
      });
    }
    const hours = Math.min(Math.max(body.recomputeHours ?? 6, 1), 48);
    const events = await runSocietyHours(state, hours, {
      dtHours: societyDtHours(),
      converseOnlyLlm: true,
      skipConversations: false,
      maxPendingTalks: 8,
    });
    if (body.kind === 'whisper' && body.agentKey && body.text) {
      events.push({
        id: `whisper_ev_${Date.now()}`,
        simTime: body.fromSimTime,
        kind: 'intervene',
        agentId: body.agentKey,
        payload: {
          text: body.text,
          summary: body.text,
          kind: 'whisper',
        },
      });
    }
    // Rewind rebuilt the relationship graph, so write it whole.
    await persistSocietyState(db, worldRow.id, state, events, {
      fullRelations: true,
    });
    // An intervention adds a single event; score against the last simulated day
    // so the gathering and route metrics stay meaningful.
    let reportEvents: readonly SocietyEvent[] = events;
    try {
      const recent = await loadRecentSocietyEvents(db, worldRow.id, {
        sinceSimTime: state.simTime - 24,
        limit: 800,
      });
      if (recent.length) reportEvents = recent as readonly SocietyEvent[];
    } catch (err) {
      console.warn('[society-intervene] report window load failed', err);
    }
    const report = buildEmergenceReportCard({
      state,
      events: reportEvents,
      seedText: body.text ?? 'intervened',
      invitationText: gatheringInvitationText(spec),
    });
    await persistEmergenceReport(
      db,
      worldRow.id,
      state.simTime,
      report as unknown as Record<string, unknown>,
    );
    return {
      events: events.length,
      simTime: state.simTime,
      report,
      pendingTalks: [],
    };
    }
  });
  /** POST neural imagination ranking over candidate actions. */
  authed.post('/projects/:projectId/world/imagine', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const body = await c.req.json<{
      actions?: string[];
      weights?: unknown;
    }>().catch(() => ({} as { actions?: string[]; weights?: unknown }));
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);
    const world = parseWorldSpec(worldRow.specJson);

    // Prefer disk dynamics.json (from train job / sync) — never silently hot-train as "neural"
    let weightsJson: string | null = null;
    let weightsSource: 'request' | 'disk' | 'hot_train' = 'hot_train';
    if (body.weights) {
      weightsJson = JSON.stringify(body.weights);
      weightsSource = 'request';
    } else {
      const disk = await loadDynamicsWeights(projectId);
      if (disk?.weights) {
        weightsJson = JSON.stringify(disk.weights);
        weightsSource = 'disk';
      } else {
        const traj = collectTrajectories({
          episodes: 6,
          stepsPerEpisode: 16,
          policy: 'scripted',
          seedWorld: world,
        });
        const samples = traj.map((t) => ({
          x: [...t.obs, ...t.actionVec],
          y: t.nextObs,
        }));
        const trained = trainMlp(samples, { epochs: 8, batchSize: 16 });
        weightsJson = JSON.stringify(trained.weights);
        weightsSource = 'hot_train';
        await saveDynamicsWeights(projectId, {
          format: 'opengame-world-mlp-v1',
          finalLoss: trained.finalLoss,
          losses: trained.losses,
          weights: trained.weights,
          steps: traj.length,
          trainedAt: new Date().toISOString(),
          source: 'api-imagine-hot-train',
        });
      }
    }

    const hybrid = new HybridWorldModel(world, weightsJson);
    const ranked = hybrid.imagine(
      (body.actions as import('@opengame/world-neural').WorldActionKind[] | undefined) ??
        undefined,
    );
    return c.json({
      preferred: ranked[0]?.action ?? null,
      weightsSource,
      persisted: weightsSource !== 'request',
      ranked: ranked.map((r) => ({
        action: r.action,
        surprise: r.surprise,
        events: r.actualEvents,
      })),
    });
  });

  authed.post('/projects/:projectId/world/society/heartbeat', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    type HeartbeatBody = {
      mode?: 'always' | 'watching' | 'off' | 'leave';
      ttlMinutes?: number;
      tab?: string;
      resumeClock?: boolean;
    };
    const body = await c.req
      .json<HeartbeatBody>()
      .catch(() => ({}) as HeartbeatBody);
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) {
      return c.json({
        ok: false,
        reason: 'no_world',
        mode: body.mode ?? 'watching',
        enabled: false,
        until: null,
        lastHeartbeatAt: null,
        watcherCount: 0,
      });
    }

    const mode = body.mode ?? 'watching';
    const ttlMs = clampSocietyPresenceTtlMs(
      (body.ttlMinutes ?? 8) * 60_000,
    );
    const ticket = societyWatcherTicket({ userId: jwt.sub, tab: body.tab });
    let watcherCount = 0;
    if (mode === 'leave') {
      watcherCount = await leaveSocietyWatcher(ctx.redis, worldRow.id, ticket).catch(
        () => 0,
      );
    } else if (mode === 'watching') {
      watcherCount = await touchSocietyWatcher(ctx.redis, worldRow.id, ticket).catch(
        () => 1,
      );
    } else {
      watcherCount = await countSocietyWatchers(ctx.redis, worldRow.id).catch(() => 0);
    }
    await db
      .update(worlds)
      .set(
        societyHeartbeatWrite(mode, ttlMs, Date.now(), {
          keepPresence: mode === 'leave' && watcherCount > 0,
          resumeClock: mode === 'watching' && body.resumeClock === true,
        }),
      )
      .where(eq(worlds.id, worldRow.id));
    if (shouldVoidCourseOnHeartbeat(mode)) {
      await voidCourseNodesForWorld(db, worldRow.id, 'paused').catch(() => 0);
    }
    const [after] = await db
      .select({
        heartbeatEnabled: worlds.heartbeatEnabled,
        heartbeatUntil: worlds.heartbeatUntil,
        lastHeartbeatAt: worlds.lastHeartbeatAt,
      })
      .from(worlds)
      .where(eq(worlds.id, worldRow.id))
      .limit(1);
    return c.json({
      mode,
      enabled: after?.heartbeatEnabled ?? false,
      until: after?.heartbeatUntil ?? null,
      lastHeartbeatAt: after?.lastHeartbeatAt ?? null,
      watcherCount,
    });
  });

  /**
   * Stream the town instead of polling it.
   *
   * The stage used to POST a tick every 2.5s, which meant the world only moved
   * as fast as one browser could ask and every viewer drove their own timeline.
   * The worker now owns the clock and publishes frames here.
   */
  authed.get('/projects/:projectId/world/society/stream', async (c) => {
    const jwt = c.get('jwt');
    const projectId = c.req.param('projectId');
    const [proj] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
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
    const [worldRow] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!worldRow) return c.json({ error: 'no world' }, 404);

    // Opening the stream is itself proof someone is watching.
    await db
      .update(worlds)
      .set({
        heartbeatEnabled: true,
      })
      .where(eq(worlds.id, worldRow.id))
      .catch(() => undefined);

    return streamSSE(c, async (stream) => {
      const keepAlive = setInterval(() => {
        stream.write(': heartbeat\n\n');
      }, 25_000);

      let unsubscribe: (() => void) | null = null;
      let receivedLive = false;
      try {
        unsubscribe = subscribeSocietyFrames(env.redisUrl, worldRow.id, (message) => {
          receivedLive = true;
          stream.write(
            `event: ${societyStreamEventName(message)}\ndata: ${message}\n\n`,
          );
        });
      } catch (err) {
        console.warn('[society-stream] subscribe failed', err);
        stream.write(
          `event: society-error\ndata: ${JSON.stringify({
            error: 'subscribe_failed',
          })}\n\n`,
        );
      }

      await emitCachedSocietyFrame({
        redis: ctx.redis,
        worldId: worldRow.id,
        receivedLive: () => receivedLive,
        writeFrame: (message) => {
          stream.write(`event: society-frame\ndata: ${message}\n\n`);
        },
      });

      stream.write(
        `event: society-open\ndata: ${JSON.stringify({
          worldId: worldRow.id,
        })}\n\n`,
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

}
