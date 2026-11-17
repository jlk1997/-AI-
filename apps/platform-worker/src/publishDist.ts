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
  runtimeDistBootstrapFingerprint,
  uploadJobLog,
  validateBuild,
  type ValidateBuildResult,
} from './processJobHelpers.js';

export interface PublishedPreview {
  readonly artifactId: string;
  readonly deploymentId: string;
  readonly entryKey: string;
  readonly buildCacheKey: string;
  readonly distPrefix: string;
  readonly codeChanges: ReturnType<typeof parseCodeChangesFromOutput>;
}

/**
 * Uploads `dist/` and registers artifact + preview deployment.
 *
 * Called as soon as a build clears the baseline gate tier so the user can play
 * while later rounds keep polishing; a successful escalation round simply
 * publishes again and the preview channel points at the newer artifact.
 */
export async function publishGeneratedDist(options: {
  readonly db: DrizzleDb;
  readonly s3: S3Client;
  readonly env: WorkerEnv;
  readonly projectId: string;
  readonly jobId: string;
  readonly workspace: string;
  readonly gameParams: unknown;
  readonly cliStdout: string;
  readonly fsmAttempts: number;
  readonly gateTier: GateTier;
  /** Scaffold-only shell published before CODE; a later round replaces it. */
  readonly skeleton?: boolean;
}): Promise<PublishedPreview> {
  const { workspace } = options;
  const distDir = path.join(workspace, 'dist');
  const artifactId = randomUUID();
  // Escalation rounds frequently leave dist/ byte-identical; point the new
  // artifact at the bytes already uploaded instead of pushing them again. The
  // artifact and deployment rows are still written so the manifest keeps an
  // honest record of the round that produced them.
  const reusable = reusableDistUpload(workspace, options.jobId);
  let distPrefix: string;
  let entryKey: string;
  if (reusable) {
    distPrefix = reusable.distPrefix;
    entryKey = reusable.entryKey;
  } else {
    distPrefix = playBundlePrefix(options.projectId, artifactId);
    entryKey = (
      await uploadDirectoryToS3(options.s3, options.env, distPrefix, distDir)
    ).entryKey;
    recordDistUpload(workspace, {
      jobId: options.jobId,
      distPrefix,
      entryKey,
    });
  }
  const pkgJsonContent = fs.existsSync(path.join(workspace, 'package.json'))
    ? fs.readFileSync(path.join(workspace, 'package.json'), 'utf-8')
    : '';
  const buildCacheKey = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        pkg: pkgJsonContent,
        gameParams: options.gameParams ?? {},
        runtimeDistBootstrap: runtimeDistBootstrapFingerprint(workspace),
      }),
    )
    .digest('hex')
    .slice(0, 16);
  const codeChanges = parseCodeChangesFromOutput(options.cliStdout);
  const [art] = await options.db
    .insert(artifacts)
    .values({
      jobId: options.jobId,
      storagePrefix: entryKey,
      contentHash: buildCacheKey,
      manifest: {
        kind: 'vite-dist',
        distPrefix,
        entryKey,
        fsmAttempts: options.fsmAttempts,
        gateTier: options.gateTier.id,
        codeChanges,
        ...(options.skeleton ? { skeleton: true } : {}),
        ...(reusable ? { uploadReused: true } : {}),
      },
    })
    .returning();
  if (!art) {
    throw new Error('artifact insert failed');
  }
  const [dep] = await options.db
    .insert(deployments)
    .values({
      projectId: options.projectId,
      artifactId: art.id,
      channel: 'preview',
      previewUrl: entryKey,
      status: 'active',
    })
    .returning();
  if (!dep) {
    throw new Error('deployment insert failed');
  }
  return {
    artifactId: art.id,
    deploymentId: dep.id,
    entryKey,
    buildCacheKey,
    distPrefix,
    codeChanges,
  };
}

/**
 * Ship the scaffold as a preview before the Agent starts writing.
 *
 * The user used to wait for art + CODE + FIX + gates — minutes at best, and a
 * job that spent its whole budget on hard timeouts handed back nothing at all.
 * The skeleton already boots, renders and takes input, so publishing it costs
 * one extra vite build (which also warms node_modules for the FIX loop) and
 * guarantees there is always something to open. Never fails the job: a broken
 * scaffold is CODE's problem to fix a minute later.
 */
export async function publishSkeletonPreview(options: {
  readonly db: DrizzleDb;
  readonly s3: S3Client;
  readonly env: WorkerEnv;
  readonly projectId: string;
  readonly jobId: string;
  readonly workspace: string;
  readonly gameParams: unknown;
  readonly childEnv: NodeJS.ProcessEnv;
  readonly stream: AgentEventStream;
}): Promise<PublishedPreview | null> {
  const { stream, workspace } = options;
  if (!fs.existsSync(path.join(workspace, 'package.json'))) {
    return null;
  }
  try {
    const validate = await validateBuild(workspace, options.childEnv);
    if (!validate.ok) {
      await stream.emit('qa', 'BUILD', {
        summary: '骨架预览跳过：脚手架未通过构建，交由 CODE 轮修复',
        details: {
          typecheckExit: validate.typecheck.exitCode,
          buildExit: validate.build.exitCode,
        },
      });
      return null;
    }
    const published = await publishGeneratedDist({
      db: options.db,
      s3: options.s3,
      env: options.env,
      projectId: options.projectId,
      jobId: options.jobId,
      workspace,
      gameParams: options.gameParams,
      cliStdout: '',
      fsmAttempts: 0,
      gateTier: BASELINE_TIER,
      skeleton: true,
    });
    await stream.emit('system', 'PREVIEW', {
      summary: '骨架预览已部署 — 可以先打开试玩，正式版本生成后会自动替换',
      details: {
        deploymentId: published.deploymentId,
        artifactId: published.artifactId,
        entryKey: published.entryKey,
        skeleton: true,
        playable: true,
      },
    });
    return published;
  } catch (err) {
    await stream.emit('qa', 'BUILD', {
      summary: '骨架预览跳过（非致命）',
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
}

