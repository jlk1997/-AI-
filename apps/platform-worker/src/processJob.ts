/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bounded inner self-heal cycle inside a `generate` job. Each iteration is
 * (CLI + BUILD + QA). Default 2 keeps token spend tight; raise via
 * PLATFORM_MAX_FIX_ITERATIONS when debugging stubborn Phaser/TS errors.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eq, and, sql, desc } from 'drizzle-orm';
import { UnrecoverableError, type Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { S3Client } from '@aws-sdk/client-s3';
import type { DrizzleDb } from '@opengame/platform-db';
import {
  artifacts,
  deployments,
  jobs,
  projects,
  usageEvents,
  worlds,
} from '@opengame/platform-db';
import {
  composeJobLogKey,
  detectLlmAuthError,
  detectLlmQuotaError,
  formatLlmQuotaErrorSummary,
} from '@opengame/platform-shared';
import { extractIterationDelta } from '@opengame/platform-agent';
import { artStyleProfile } from '@opengame/world-spec';
import {
  AgentEventJobMissingError,
  AgentEventStream,
  type AgentPhase,
} from './agentEvents.js';
import {
  applyChangePlanToGdd,
  applyChangePlanToGameArtifacts,
  ensureChangePlanSceneContracts,
  formatChangePlanConfirmLabel,
  formatChangePlanForPrompt,
  parseChangePlan,
  writeChangePlan,
  type ChangePlan,
} from './changePlan.js';
import { parseCodeChangesFromOutput } from './parseCodeChanges.js';
import {
  readGenerationPaths,
  readOptionalGameDocEnv,
  readWorkRoot,
} from './generationEnv.js';
import {
  formatProviderPreflightError,
  runOpenGameProviderPreflightIfConfigured,
} from './openGameProviderPreflight.js';
import { putObjectUtf8 } from './s3.js';
import type { WorkerEnv } from './env.js';
import { appendSessionTimeline } from './sessionTimeline.js';
import {
  ensureArchetypeWorkspace,
  ensureTemplateWorkspace,
  ensureLegacyTemplateRuntimePackage,
  ensureProjectWorkspaceDir,
  ensureEngineScaffold,
  ensureMechanicModuleDeps,
  generateMinimalSkeleton,
  projectWorkspaceRoot,
  readScaffoldMode,
  readSkeletonOptionsFromEnv,
} from './workspace.js';
import { loadConversationForContext } from './conversationHistory.js';
import { buildAgentContext, finalizeAgentContext } from './agentContext.js';
import { ensureWorkspaceChatCompression } from './chatCompressionSettings.js';
import {
  cliContextFileEnabled,
  ensureCliContextFile,
} from './cliContextFile.js';
import {
  captureCliSessionAfterRun,
  resolveCliResumeSessionId,
} from './cliSession.js';
import { buildEnhancedPrompt, buildLeanFixPrompt } from './promptContracts.js';
import {
  formatPipelineContextForCoder,
  runAssetPhase,
  runGenerationPipeline,
  buildAssetRepairPrompt,
  issuesNeedAssetRegen,
} from './generationPipeline.js';
import {
  runGameAssetPhase,
  syncPublicAssetsToDist,
  persistChatReferenceImages,
} from './gameAssetPhase.js';
import { requireRealAssets } from './assetAuthenticity.js';
import {
  formatPlayabilityFailureForPrompt,
  runPlayabilitySmoke,
  type PlayabilitySmokeResult,
} from './playabilitySmoke.js';
import {
  formatQualityFailureForPrompt,
  buildQualityFixPrompt,
  runGameQualityGate,
} from './gameQualityGate.js';
import { readWorkspaceArchetype, countCustomSceneFiles, COMPLEX_ARCHETYPES } from './gameQualityArchetype.js';
import { syncWorkspaceAssetsToDb } from './assetRegistry.js';
import {
  summarizeWorkspaceGame,
  workspaceHasPlayableGame,
  prepareWorkspaceForReset,
} from './workspaceContext.js';
import { playBundlePrefix } from './storageLayout.js';
import { uploadDirectoryToS3 } from './uploadDirectory.js';
import { restoreWorkspaceFromS3, saveWorkspaceToS3 } from './workspaceArchive.js';
import {
  runWorldEditJob,
  runWorldGenerateJob,
  runWorldTrainJob,
} from './worldPipeline.js';
import { runWorldSocietyJob } from './societyRunner.js';
import { withGenerationBusy } from './generationBusy.js';
import { runVisionQaGate, visionQaFixBlock } from './visionQaGate.js';
import {
  formatRequirementFixPrompt,
  runRequirementGate,
} from './requirementGate.js';
import { runPlaytestAgent } from './playtestAgent.js';
import { compileDesign } from '@opengame/design-compiler';
import { writeAssetForgeArtifacts } from './assetForgePhase.js';
import { loadProjectWorld } from './projectWorldTip.js';
import {
  formatWorldSeedForCoder,
  runWorldGameSeedPhase,
  tryAutoRpgWorldSeed,
} from './worldGameSeedPhase.js';
import {
  formatWorldLineageFailureForPrompt,
  formatWorldLineageSummary,
  runWorldLineageGate,
} from './worldLineageGate.js';
import {
  formatDeterministicFixSummary,
  runDeterministicFix,
} from './deterministicFix.js';
import {
  MAX_CONSECUTIVE_CLI_HARD_TIMEOUTS,
  hasUsefulCliBudget,
  readBaseCliTimeoutMs,
  readGenerationTimeBudgetMs,
  resolveCliTimeoutForAttempt,
} from './generationBudget.js';
import {
  assetTopUpFingerprint,
  assetTopUpIsFresh,
  buildSkipDecision,
  clearWorkspaceBuildCache,
  linkedRuntimeBuildIsFresh,
  readCachedSmoke,
  recordAssetTopUp,
  recordDistUpload,
  recordLinkedRuntimeBuild,
  recordWorkspaceBuild,
  reusableDistUpload,
  smokeCacheKey,
  workspaceBuildKey,
  writeCachedSmoke,
} from './buildCache.js';
import {
  agentKeyMaxRotations,
  applyAgentKeyCandidate,
  formatAgentKeyRotationSummary,
  pickNextAgentKey,
  pushAgentKeyFailure,
  reclaimPrimaryAfterFallbackBilling,
  recordAgentKeySuccess,
  resolveAgentKeyCandidates,
  type AgentKeyAttemptFailure,
} from './agentKeyPool.js';
import {
  applyGateTierEnv,
  BASELINE_TIER,
  formatQualityEscalationPrompt,
  gateTiersEqual,
  readGateEscalationMode,
  resolveGateTierForAttempt,
  resolveTargetGateTier,
  restoreGateTierEnv,
  type GateTier,
} from './gateEscalation.js';
import { JobCancelledError, logJobStep, readJobStatus, startJobCancelWatch } from './processJobHelpers.js';
import type { ProcessJobOptions } from './processJobHelpers.js';
import { runGenerateFsm } from './generateFsm.js';
import { runStandaloneBuild } from './standaloneBuild.js';
import { runBenchJob } from './benchJob.js';
import { emitJobMetric } from './jobMetrics.js';
export { JobCancelledError, type ProcessJobOptions } from './processJobHelpers.js';

export async function processPlatformJob(
  db: DrizzleDb,
  s3: S3Client,
  env: WorkerEnv,
  queue: Queue,
  jobId: string,
  options: ProcessJobOptions = {},
): Promise<void> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) {
    const msg = `[processJob] job ${jobId} not found in database — discarding orphaned BullMQ payload`;
    console.error(msg);
    // Permanent: Redis still holds a job_id after DB wipe / cascade delete.
    throw new UnrecoverableError(msg);
  }
  if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
    console.log(`[processJob] skip terminal job ${jobId} status=${job.status}`);
    return;
  }
  const claimed = await db
    .update(jobs)
    .set({ status: 'running', updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued')))
    .returning({ id: jobs.id });
  const resumedAfterStall = claimed.length === 0;
  if (resumedAfterStall) {
    const status = await readJobStatus(db, jobId);
    if (status === 'cancelled') {
      console.log(`[processJob] skip cancelled job ${jobId}`);
      return;
    }
    if (status !== 'running') {
      console.log(`[processJob] skip job ${jobId} status=${status}`);
      return;
    }
  }

  const cancelAbort = new AbortController();
  const stopCancelWatch = startJobCancelWatch(db, jobId, cancelAbort);

  const [proj] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, job.projectId))
    .limit(1);
  if (!proj) {
    stopCancelWatch();
    await db
      .update(jobs)
      .set({ status: 'failed', updatedAt: new Date(), logKey: 'missing_project' })
      .where(eq(jobs.id, jobId));
    return;
  }
  const organizationId = proj.organizationId;
  const projectId = job.projectId;
  const stream = new AgentEventStream({
    db,
    publisher: options.publisher ?? null,
    jobId,
    projectId,
    sessionId: job.sessionId,
  });
  // Stalled BullMQ retries re-enter here with agent_events already written —
  // hydrate seq counters so we don't collide on agent_events_job_seq_uq.
  await stream.prepare();

  await stream.emit('system', 'PLAN', {
    summary: resumedAfterStall
      ? 'Worker 已重新接手任务（进程重启后续跑），继续生成…'
      : 'Worker 已接手任务，正在初始化…',
    details: { jobType: job.type, resumedAfterStall },
  });
  logJobStep(
    jobId,
    resumedAfterStall
      ? `resume type=${job.type}`
      : `active type=${job.type}`,
  );
  emitJobMetric({
    name: 'job.start',
    jobId,
    projectId,
    extra: { type: job.type, resumedAfterStall },
  });
  const startedAt = Date.now();

  try {
    switch (job.type) {
      case 'generate': {
        await withGenerationBusy(() =>
          runGenerateFsm(
            db,
            s3,
            env,
            queue,
            job,
            proj,
            stream,
            organizationId,
            projectId,
            jobId,
            cancelAbort.signal,
          ),
        );
        break;
      }
      case 'world_generate': {
        const payload = (job.payload ?? {}) as {
          prompt?: string;
          gameParams?: {
            artStyleId?: string;
            worldPopulation?: number;
            societySeedHours?: number;
            worldBrief?: {
              packId?: string;
              useCase?: string;
              venues?: string[];
              scale?: string;
              livedIn?: string;
              note?: string;
            };
          };
        };
        const prompt = payload.prompt?.trim() || 'Create a cozy persistent town world';
        await withGenerationBusy(() =>
          Promise.race([
            runWorldGenerateJob({
              db,
              s3,
              env,
              stream,
              organizationId,
              projectId,
              jobId,
              prompt,
              sessionId: job.sessionId,
              redis: options.publisher,
              artStyleId: payload.gameParams?.artStyleId ?? null,
              worldPopulation: payload.gameParams?.worldPopulation ?? null,
              societySeedHours: payload.gameParams?.societySeedHours ?? null,
              worldBrief: payload.gameParams?.worldBrief ?? null,
            }),
            new Promise<never>((_, reject) => {
              if (cancelAbort.signal.aborted) {
                reject(new JobCancelledError(jobId));
                return;
              }
              cancelAbort.signal.addEventListener(
                'abort',
                () => reject(new JobCancelledError(jobId)),
                { once: true },
              );
            }),
          ]),
        );
        break;
      }
      case 'world_edit': {
        const payload = (job.payload ?? {}) as {
          prompt?: string;
          op?: unknown;
          rebuildOnly?: boolean;
        };
        const prompt = payload.prompt?.trim() || 'edit world';
        await Promise.race([
          runWorldEditJob({
            db,
            s3,
            env,
            stream,
            organizationId,
            projectId,
            jobId,
            prompt,
            op: payload.op,
            sessionId: job.sessionId,
            rebuildOnly: Boolean(payload.rebuildOnly),
          }),
          new Promise<never>((_, reject) => {
            if (cancelAbort.signal.aborted) {
              reject(new JobCancelledError(jobId));
              return;
            }
            cancelAbort.signal.addEventListener(
              'abort',
              () => reject(new JobCancelledError(jobId)),
              { once: true },
            );
          }),
        ]);
        break;
      }
      case 'world_train': {
        const payload = (job.payload ?? {}) as {
          episodes?: number;
          epochs?: number;
        };
        await runWorldTrainJob({
          db,
          stream,
          organizationId,
          projectId,
          jobId,
          episodes: payload.episodes,
          epochs: payload.epochs,
        });
        break;
      }
      case 'world_society_run': {
        const payload = (job.payload ?? {}) as {
          hours?: number;
          seedText?: string;
          invitationText?: string;
        };
        await runWorldSocietyJob({
          db,
          stream,
          projectId,
          jobId,
          hours: payload.hours,
          seedText: payload.seedText,
          invitationText: payload.invitationText,
          redis: options.publisher,
        });
        try {
          const { writeSocietyReplayArtifact } = await import(
            './societyReplayExport.js'
          );
          const { projectWorkspaceRoot } = await import('./workspace.js');
          const [worldRow] = await db
            .select()
            .from(worlds)
            .where(eq(worlds.projectId, projectId))
            .limit(1);
          if (worldRow) {
            const workspace = projectWorkspaceRoot(readWorkRoot(), projectId);
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
              const manifest = art?.manifest as { distPrefix?: string } | null;
              distPrefix = manifest?.distPrefix ?? art?.storagePrefix ?? undefined;
            }
            await writeSocietyReplayArtifact({
              db,
              worldId: worldRow.id,
              projectId,
              workspace,
              s3,
              env,
              distPrefix,
            });
          }
        } catch {
          // non-fatal — Observatory API still works
        }
        break;
      }
      case 'build': {
        await runStandaloneBuild(db, s3, env, job, organizationId, projectId, jobId, stream);
        break;
      }
      case 'publish': {
        const payload = job.payload as {
          deploymentId?: string;
          artifactId?: string;
        } | null;
        const deploymentId = payload?.deploymentId;
        if (!deploymentId) {
          throw new Error('deploymentId required in publish payload');
        }
        const [dep] = await db
          .select()
          .from(deployments)
          .where(eq(deployments.id, deploymentId))
          .limit(1);
        if (!dep?.previewUrl) {
          throw new Error('deployment not found');
        }
        const artifactId = payload?.artifactId ?? dep.artifactId;
        await db
          .update(deployments)
          .set({
            channel: 'production',
            productionUrl: dep.previewUrl,
            artifactId: artifactId ?? null,
          })
          .where(eq(deployments.id, deploymentId));
        await db
          .update(jobs)
          .set({ status: 'succeeded', updatedAt: new Date() })
          .where(eq(jobs.id, jobId));
        await db.insert(usageEvents).values({
          organizationId,
          jobId,
          modality: 'publish',
          units: '1',
          meta: { jobType: 'publish' },
        });
        await appendSessionTimeline(
          db,
          job.sessionId,
          `Publish completed; deployment ${deploymentId} is now on the production channel.`,
        );
        await stream.emit('system', 'DONE', {
          summary: `发布完成：deployment ${deploymentId} → production`,
        });
        break;
      }
      case 'bench': {
        await runBenchJob(db, s3, env, job, organizationId, projectId, jobId, stream);
        break;
      }
      default: {
        throw new Error(`unknown job type: ${job.type}`);
      }
    }
    emitJobMetric({
      name: 'job.success',
      jobId,
      projectId,
      ms: Date.now() - startedAt,
      extra: { type: job.type },
    });
    try {
      const counts = await queue.getJobCounts('wait', 'active', 'delayed');
      emitJobMetric({
        name: 'job.queue',
        extra: {
          wait: counts.wait ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
        },
      });
    } catch {
      /* metrics must never fail a succeeded job */
    }
  } catch (err) {
    const jobMissing = err instanceof AgentEventJobMissingError;
    const msg = err instanceof Error ? err.message : String(err);
    const cancelled =
      !jobMissing &&
      (err instanceof JobCancelledError ||
        (await readJobStatus(db, jobId)) === 'cancelled' ||
        /用户已中止|job cancelled|job_cancelled/i.test(msg));
    emitJobMetric({
      name: cancelled ? 'job.cancelled' : 'job.fail',
      jobId,
      projectId,
      extra: { type: job.type, error: msg.slice(0, 200) },
    });
    await appendSessionTimeline(
      db,
      job.sessionId,
      cancelled
        ? `Job ${job.type} cancelled by user.`
        : jobMissing
          ? `Job ${job.type} aborted: jobs row missing (orphaned queue payload).`
          : `Job ${job.type} failed: ${msg}`,
    );
    if (!jobMissing) {
      try {
        await stream.emit('system', 'FAIL', {
          summary: cancelled ? '用户已中止任务' : msg.slice(0, 300),
        });
      } catch (emitErr) {
        if (!(emitErr instanceof AgentEventJobMissingError)) throw emitErr;
      }
    } else {
      console.error(
        `[processJob] aborting orphaned BullMQ job ${jobId}: missing jobs row`,
      );
    }
    await db
      .update(jobs)
      .set({
        status: cancelled ? 'cancelled' : 'failed',
        updatedAt: new Date(),
        logKey: cancelled
          ? 'user_cancelled: 用户中止任务'
          : msg.slice(0, 2000),
        ...(cancelled
          ? {}
          : { retryCount: sql`${jobs.retryCount} + 1` }),
      })
      .where(
        and(
          eq(jobs.id, jobId),
          // Don't clobber succeeded if a race finished cleanly.
          sql`${jobs.status} not in ('succeeded')`,
        ),
      );
    if (jobMissing) {
      throw new UnrecoverableError(
        `job ${jobId} missing from database (agent_events FK)`,
      );
    }
  } finally {
    stopCancelWatch();
  }
}

