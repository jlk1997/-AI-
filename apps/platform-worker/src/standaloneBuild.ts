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
import { eq, and, or, sql, desc } from 'drizzle-orm';
import { UnrecoverableError, type Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { S3Client } from '@aws-sdk/client-s3';
import type { DrizzleDb } from '@opengame/platform-db';
import {
  artifacts,
  benchRuns,
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
import { runArgv, runShellCommand, type RunProcessResult } from './runProcess.js';
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
import {
  ensureLinkedOpenGameRuntimeBuilt,
  mergeChildEnv,
  runtimeDistBootstrapFingerprint,
  runGameWorkspaceTypecheck,
  runGameWorkspaceViteBuild,
  uploadJobLog,
} from './processJobHelpers.js';

export async function runStandaloneBuild(
  db: DrizzleDb,
  s3: S3Client,
  env: WorkerEnv,
  job: {
    id: string;
    sessionId: string | null;
    payload: unknown;
    buildCacheKey?: string | null;
  },
  organizationId: string,
  projectId: string,
  jobId: string,
  stream: AgentEventStream,
): Promise<void> {
  const workRoot = readWorkRoot();
  const workspace = projectWorkspaceRoot(workRoot, projectId);
  const pkg = path.join(workspace, 'package.json');
  if (!fs.existsSync(pkg) && env.workspaceArchiveKeyPrefix) {
    try {
      await restoreWorkspaceFromS3(s3, env, projectId, workspace);
    } catch {
      /* fall through to the missing-scaffold error */
    }
  }
  if (!fs.existsSync(pkg)) {
    throw new Error(
      'Project workspace has no package.json; run a successful generate job first',
    );
  }
  const payload = job.payload as { gameParams?: Record<string, unknown> } | null;
  const gameParams = payload?.gameParams;
  const packageJsonContent = fs.readFileSync(pkg, 'utf-8');
  const runtimeFp = runtimeDistBootstrapFingerprint(workspace);
  const buildCacheInput = JSON.stringify({
    packageJson: packageJsonContent,
    gameParams: gameParams || {},
    runtimeDistBootstrap: runtimeFp,
  });
  const buildCacheKey = crypto
    .createHash('sha256')
    .update(buildCacheInput)
    .digest('hex')
    .slice(0, 16);

  const cachedArtifacts = await db
    .select()
    .from(artifacts)
    .innerJoin(jobs, eq(artifacts.jobId, jobs.id))
    .where(
      and(
        eq(jobs.status, 'succeeded'),
        or(eq(jobs.buildCacheKey, buildCacheKey), eq(artifacts.contentHash, buildCacheKey)),
      ),
    )
    .limit(1);
  if (cachedArtifacts.length > 0) {
    const cached = cachedArtifacts[0]!;
    const cachedArtifactId = cached.artifacts.id;
    const cachedEntryKey = cached.artifacts.storagePrefix;
    await db
      .update(jobs)
      .set({ buildCacheKey, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
    await db.insert(deployments).values({
      projectId,
      artifactId: cachedArtifactId,
      channel: 'preview',
      previewUrl: cachedEntryKey,
      status: 'active',
    });
    await db
      .update(jobs)
      .set({
        status: 'succeeded',
        updatedAt: new Date(),
        result: {
          cacheHit: true,
          contentHash: buildCacheKey,
          cachedArtifactId,
          entryKey: cachedEntryKey,
        },
      })
      .where(eq(jobs.id, jobId));
    await db.insert(usageEvents).values({
      organizationId,
      jobId,
      modality: 'build',
      units: '1',
      meta: {
        jobType: 'build',
        contentHash: buildCacheKey,
        ms: 0,
        cacheHit: true,
      },
    });
    await appendSessionTimeline(
      db,
      job.sessionId,
      `Build cache hit ${buildCacheKey}; preview reused. Entry key: ${cachedEntryKey}`,
    );
    await stream.emit('system', 'DONE', {
      summary: '命中构建缓存，复用已有预览',
      details: { buildCacheKey, cachedArtifactId, cacheHit: true },
    });
    return;
  }

  const docEnv = readOptionalGameDocEnv();
  const childEnv = docEnv
    ? mergeChildEnv(
        process.env,
        docEnv.gameTemplatesParentDir,
        docEnv.gameDocsDir,
      )
    : { ...process.env, GEMINI_SANDBOX: process.env['GEMINI_SANDBOX'] ?? 'false' };
  const buildStartTime = Date.now();
  await stream.emit('qa', 'BUILD', {
    tool: 'tsc (entry overlay) + vite build',
    summary: '执行独立 build job（无缓存',
  });
  const ci = await runShellCommand('npm ci', { cwd: workspace, env: childEnv });
  let log = `=== npm ci ===\nexit=${ci.exitCode}\n${ci.stdout}\n${ci.stderr}\n`;
  if (ci.exitCode !== 0) {
    const logKey = await uploadJobLog(s3, env, projectId, jobId, log);
    await db.update(jobs).set({ logKey, updatedAt: new Date() }).where(eq(jobs.id, jobId));
    throw new Error(`npm ci failed (exit ${ci.exitCode}); log: ${logKey}`);
  }
  const rtBuild = await ensureLinkedOpenGameRuntimeBuilt(workspace, childEnv);
  if (rtBuild && rtBuild.exitCode !== 0) {
    log += `=== @opengame/runtime build ===\nexit=${rtBuild.exitCode}\n${rtBuild.stdout}\n${rtBuild.stderr}\n`;
    const logKey = await uploadJobLog(s3, env, projectId, jobId, log);
    await db.update(jobs).set({ logKey, updatedAt: new Date() }).where(eq(jobs.id, jobId));
    throw new Error(`@opengame/runtime dist build failed (exit ${rtBuild.exitCode}); log: ${logKey}`);
  }
  const tc = await runGameWorkspaceTypecheck(workspace, childEnv);
  log += `=== tsc (tsconfig.opengame-worker.json) ===\nexit=${tc.exitCode}\n${tc.stdout}\n${tc.stderr}\n`;
  if (tc.exitCode !== 0) {
    const logKey = await uploadJobLog(s3, env, projectId, jobId, log);
    await db.update(jobs).set({ logKey, updatedAt: new Date() }).where(eq(jobs.id, jobId));
    throw new Error(`typecheck failed (exit ${tc.exitCode}); log: ${logKey}`);
  }
  const build = await runGameWorkspaceViteBuild(workspace, childEnv);
  log += `=== vite build ===\nexit=${build.exitCode}\n${build.stdout}\n${build.stderr}\n`;
  const logKey = await uploadJobLog(s3, env, projectId, jobId, log);
  await db.update(jobs).set({ logKey, updatedAt: new Date() }).where(eq(jobs.id, jobId));
  if (build.exitCode !== 0) {
    throw new Error(`vite build failed (exit ${build.exitCode}); log: ${logKey}`);
  }
  const distDir = path.join(workspace, 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error('vite build did not create dist/');
  }
  const buildTimeMs = Date.now() - buildStartTime;
  const artifactId = randomUUID();
  const s3Prefix = playBundlePrefix(projectId, artifactId);
  const { entryKey } = await uploadDirectoryToS3(s3, env, s3Prefix, distDir);
  const [art] = await db
    .insert(artifacts)
    .values({
      jobId,
      storagePrefix: entryKey,
      contentHash: buildCacheKey,
      manifest: {
        kind: 'vite-dist',
        distPrefix: s3Prefix,
        entryKey,
        buildTimeMs,
      },
    })
    .returning();
  if (!art) {
    throw new Error('artifact insert failed');
  }
  await db.insert(deployments).values({
    projectId,
    artifactId: art.id,
    channel: 'preview',
    previewUrl: entryKey,
    status: 'active',
  });
  await db
    .update(jobs)
    .set({
      buildCacheKey,
      status: 'succeeded',
      updatedAt: new Date(),
      result: { cacheHit: false, contentHash: buildCacheKey, entryKey },
    })
    .where(eq(jobs.id, jobId));
  await db.insert(usageEvents).values({
    organizationId,
    jobId,
    modality: 'build',
    units: '1',
    meta: { jobType: 'build', contentHash: buildCacheKey, ms: buildTimeMs },
  });
  await appendSessionTimeline(
    db,
    job.sessionId,
    `Build finished in ${buildTimeMs}ms; preview artifact uploaded. Entry key: ${entryKey}`,
  );
  await stream.emit('system', 'DONE', {
    summary: `独立构建完成 ${buildTimeMs}ms`,
    details: { entryKey, buildCacheKey },
    elapsedMs: buildTimeMs,
  });
}

