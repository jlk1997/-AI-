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
  jobAllowsEmergencyModel,
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
  JobCancelledError,
  assertJobNotCancelled,
  assertWorkspacePersistenceConfigured,
  assetPhaseParallelWithCodeEnabled,
  buildGenerateAttemptLogBody,
  checkGameDsl,
  earlySkeletonPreviewEnabled,
  ensureLinkedOpenGameRuntimeBuilt,
  ensureScaffold,
  envOff,
  failGenerateWithLog,
  invokeOpenGameCli,
  logJobStep,
  mergeChildEnv,
  readCliApprovalMode,
  readMaxFixIterations,
  startJobHeartbeat,
  summarizeBuildFailure,
  throwIfCliQuotaFailure,
  uploadJobLog,
  validateBuild,
  withProgressHeartbeat,
  writeWorkerTsconfigOverlay,
  type ValidateBuildResult,
} from './processJobHelpers.js';
import {
  publishGeneratedDist,
  publishSkeletonPreview,
  type PublishedPreview,
} from './publishDist.js';
import { emitJobMetric } from './jobMetrics.js';
import { cliStdoutStreamingEnabled, createCliStdoutTap } from './cliStdoutTap.js';

export async function runGenerateFsm(
  db: DrizzleDb,
  s3: S3Client,
  env: WorkerEnv,
  _queue: Queue,
  job: {
    id: string;
    sessionId: string | null;
    payload: unknown;
    buildCacheKey?: string | null;
  },
  _proj: { id: string; organizationId: string },
  stream: AgentEventStream,
  organizationId: string,
  projectId: string,
  jobId: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const fsmStart = Date.now();

  try {
    runOpenGameProviderPreflightIfConfigured();
  } catch (preErr) {
    throw new Error(formatProviderPreflightError(preErr));
  }

  const paths = readGenerationPaths();
  const payload = (job.payload ?? {}) as {
    prompt?: string;
    gameParams?: {
      theme?: string;
      variant?: string;
      difficulty?: number;
      musicStyle?: string;
      gameSpeed?: number;
      timeLimit?: number;
      preferredArchetype?: string;
      designBrief?: string;
      artTone?: string;
      artStyleId?: string;
      winFeel?: string;
    };
    images?: string[];
  };
  const prompt = payload.prompt?.trim();
  if (!prompt) {
    throw new Error('generate job requires payload.prompt');
  }

  assertWorkspacePersistenceConfigured(env);

  const workspace = projectWorkspaceRoot(paths.workRoot, projectId);
  logJobStep(jobId, 'ensure workspace dir');
  await ensureProjectWorkspaceDir(workspace);

  let isIteration = workspaceHasPlayableGame(workspace);
  const earlyIntent = extractIterationDelta(prompt, isIteration);
  const wantsReset = earlyIntent.intent === 'reset';
  if (wantsReset && isIteration) {
    const wiped = await prepareWorkspaceForReset(workspace);
    await stream.emit('planner', 'PLAN', {
      summary: '用户要求重做：已清空可玩产物，按首轮重新规划',
      details: { removed: wiped.removed.slice(0, 20) },
    });
    isIteration = false;
  }
  const workspaceSummary = await summarizeWorkspaceGame(workspace);
  const { turns: conversationTurns, summaryTurns } =
    await loadConversationForContext(db, job.sessionId, 3);

  const gameParamsText = payload.gameParams
    ? JSON.stringify(payload.gameParams, null, 2)
    : undefined;

  // After reset wipe, force rescaffold even if package.json remains
  const needsFreshScaffold =
    !fs.existsSync(path.join(workspace, 'package.json')) || wantsReset;

  await stream.emit('planner', 'INTENT', {
    summary: '解析用户意图与项目上下文',
    details: {
      isIteration,
      wantsReset,
      historyTurns: conversationTurns.length,
    },
  });

  let pipelineCtx = null as Awaited<
    ReturnType<typeof runGenerationPipeline>
  > | null;
  if (!isIteration) {
    pipelineCtx = await withProgressHeartbeat(
      stream,
      jobId,
      '生成流水classify+GDD',
      () =>
        runGenerationPipeline({
          userPrompt: prompt,
          workspace,
          isFirstGeneration: true,
          stream,
          preferredArchetype: (payload.gameParams?.preferredArchetype ??
            null) as
            | 'platformer'
            | 'top_down'
            | 'grid_logic'
            | 'tower_defense'
            | 'ui_heavy'
            | null,
          designBrief: payload.gameParams?.designBrief ?? null,
          artStyleId: payload.gameParams?.artStyleId ?? null,
          variant: payload.gameParams?.variant ?? null,
        }),
      'INTENT',
    );
  } else {
    pipelineCtx = await withProgressHeartbeat(
      stream,
      jobId,
      '迭代规格 / GameOps',
      () =>
        runGenerationPipeline({
          userPrompt: prompt,
          workspace,
          isFirstGeneration: false,
          stream,
          designBrief: payload.gameParams?.designBrief ?? null,
          variant: payload.gameParams?.variant ?? null,
        }),
      'INTENT',
    );
  }

  const projectWorld = await loadProjectWorld(db, projectId);
  const worldStyleTip = projectWorld?.tip ?? null;
  if (pipelineCtx && worldStyleTip) {
    pipelineCtx = { ...pipelineCtx, worldStyleTip };
  }

  const pipelineArchetype =
    pipelineCtx?.archetype ?? (await readWorkspaceArchetype(workspace)) ?? undefined;

  const agentCtx = await withProgressHeartbeat(
    stream,
    jobId,
    '构建 Agent 上下文',
    () =>
      buildAgentContext({
        db,
        projectId,
        organizationId,
        sessionId: job.sessionId,
        userPrompt: prompt,
        isIteration,
        workspaceSummary,
        conversationTurns,
        gameParamsText,
        gameDocsDir: paths.gameDocsDir,
        templatesParentDir: paths.gameTemplatesParentDir,
      archetype: pipelineArchetype,
      workspace,
    }),
    'PLAN',
  );

  await stream.emit('system', 'PLAN', {
    summary: 'Agent 上下文已就绪（含 archetype 文档检索）',
    details: { archetype: pipelineArchetype ?? null },
  });

  isIteration = agentCtx.effectiveIteration && !wantsReset;

  const persistedRefs = await persistChatReferenceImages(
    workspace,
    payload.images,
  );

  let changePlan: ChangePlan | null = null;
  if (isIteration || agentCtx.intent === 'iterate' || wantsReset || agentCtx.intent === 'reset') {
    changePlan = parseChangePlan({
      userPrompt: prompt,
      sessionSummary: agentCtx.sessionSummary,
      gameParams: payload.gameParams ?? null,
      imagesCount: payload.images?.length,
      imageHints: persistedRefs.length
        ? persistedRefs
        : (payload.images ?? [])
            .filter(
              (h) =>
                /^https?:\/\//i.test(h) ||
                (!h.startsWith('data:') && h.length >= 8 && h.length <= 400),
            )
            .slice(0, 2),
      intent: wantsReset || agentCtx.intent === 'reset' ? 'reset' : 'iterate',
      sceneIds: workspaceSummary.sceneIds,
      entityIds: workspaceSummary.entityIds,
    });
    await writeChangePlan(workspace, changePlan);
    await applyChangePlanToGdd(workspace, changePlan);
    const artifactPatches = await applyChangePlanToGameArtifacts(
      workspace,
      changePlan,
    );
    const confirmLabel = formatChangePlanConfirmLabel(changePlan);
    await stream.emit('planner', 'PLAN', {
      summary: confirmLabel,
      details: {
        confirmBar: true,
        confirmLabel,
        difficulty: changePlan.difficulty,
        addBoss: changePlan.addBoss,
        artStyle: changePlan.artStyle,
        addScene: changePlan.addScene,
        addDialogue: changePlan.addDialogue,
        editLevel: changePlan.editLevel,
        targetSceneId: changePlan.targetSceneId,
        targetNpcId: changePlan.targetNpcId,
        forceAssetRegen: changePlan.forceAssetRegen,
        intent: changePlan.intent,
        artifactPatches: artifactPatches.patches.slice(0, 12),
      },
    });
    if (changePlan.forceAssetRegen) {
      process.env['PLATFORM_ALLOW_ASSET_FIX'] = 'true';
    }
  }

  await stream.emit('planner', 'PLAN', {
    summary: isIteration
      ? '增量迭代：在现有游戏上应用新需求'
      : agentCtx.intent === 'reset'
        ? '用户要求重做：规划新游戏'
        : '首次生成：规划场景、规则与资产',
    details: {
      isIteration,
      intent: agentCtx.intent,
      historyTurns: conversationTurns.length,
      hasBrief: Boolean(agentCtx.briefText),
      archetype: pipelineArchetype ?? null,
      gddSceneKeys: pipelineCtx?.gddSceneKeys ?? [],
      changePlan: changePlan?.summary ?? null,
    },
  });

  const useArchetypeLegacy =
    !isIteration &&
    pipelineCtx &&
    readScaffoldMode() === 'legacy-template' &&
    process.env['PLATFORM_USE_ARCHETYPE_SCAFFOLD'] !== 'false' &&
    !fs.existsSync(path.join(workspace, 'package.json'));

  if ((needsFreshScaffold || wantsReset) && !isIteration && pipelineCtx) {
    let mode = readScaffoldMode();
    if (
      mode === 'skeleton' &&
      (pipelineCtx.archetype === 'grid_logic' ||
        COMPLEX_ARCHETYPES.has(pipelineCtx.archetype))
    ) {
      mode = 'engine';
      await stream.emit('system', 'PLAN', {
        summary:
          pipelineCtx.archetype === 'grid_logic'
            ? `grid_logic 升级 engine + 按规格播种载体（街机或棋盘，不是成品店）`
            : `复杂 archetype=${pipelineCtx.archetype} 自动升级engine 脚手架（注入 module + Scene 桩）`,
        details: { requestedMode: 'skeleton', effectiveMode: 'engine' },
      });
    }
    if (mode === 'engine') {
      await stream.emit('system', 'PLAN', {
        summary: `引擎脚手架（archetype=${pipelineCtx.archetype}' Scene '+ module 依赖`,
        details: {
          archetype: pipelineCtx.archetype,
          gddSceneKeys: pipelineCtx.gddSceneKeys,
        },
      });
      await withProgressHeartbeat(
        stream,
        jobId,
        'engine 脚手架',
        async () => {
          const scaffolded = await ensureEngineScaffold(
            workspace,
            pipelineCtx!.archetype,
            readSkeletonOptionsFromEnv(),
            pipelineCtx!.gddSceneKeys,
            {
              userPrompt: prompt,
              mechanic: pipelineCtx!.mechanic ?? null,
            },
          );
          if (scaffolded.arcade) {
            await stream.emit('artist', 'ASSET', {
              summary: '已播种街juice 内核',
              details: scaffolded.arcade as Record<string, unknown>,
            });
          }
        },
        'PLAN',
      );
    } else if (mode === 'skeleton') {
      await withProgressHeartbeat(
        stream,
        jobId,
        'skeleton 脚手架',
        () => ensureScaffold(workspace, paths, stream, s3, env, projectId, db),
        'PLAN',
      );
    } else if (useArchetypeLegacy) {
      await stream.emit('system', 'PLAN', {
        summary: '警告：legacy-template 会拷贝预制模板，降低创作自由度，建议改用 engine 模式',
        details: { mode: 'legacy-template' },
      });
      const arch = await ensureArchetypeWorkspace(
        workspace,
        paths.gameTemplateDir,
        paths.gameTemplatesParentDir,
        pipelineCtx.archetype,
      );
      if (arch.created) {
        await ensureLegacyTemplateRuntimePackage(workspace, paths.gameTemplateDir);
        await stream.emit('system', 'PLAN', {
          summary: `已脚手架 archetype 模板: ${pipelineCtx.archetype}`,
          details: {
            scaffoldReady: true,
            archetype: pipelineCtx.archetype,
          },
        });
      }
    } else {
      await withProgressHeartbeat(
        stream,
        jobId,
        'legacy 脚手架',
        () => ensureScaffold(workspace, paths, stream, s3, env, projectId, db),
        'PLAN',
      );
    }
  } else if (needsFreshScaffold && isIteration) {
    await withProgressHeartbeat(
      stream,
      jobId,
      '补全脚手架',
      () => ensureScaffold(workspace, paths, stream, s3, env, projectId, db),
      'PLAN',
    );
  }

  if (isIteration && pipelineCtx?.mechanic?.modules?.length) {
    await ensureMechanicModuleDeps(workspace, pipelineCtx.mechanic.modules);
  }
  if (pipelineCtx?.mechanic) {
    const { ensureBoundCapabilities } = await import('./boundCapabilities.js');
    await ensureBoundCapabilities(workspace, pipelineCtx.mechanic);
  }

  await ensureWorkspaceChatCompression(workspace);

  // World 'game compile. Runs before the asset phase so MiniMax wires sprites
  // onto the world's own entities, and before the CLI so the Agent only has to
  // add feel on top of a structure that is already playable.
  let worldSeedBlock: string | null = null;
  if (projectWorld) {
    const seeded = await runWorldGameSeedPhase({
      workspace,
      world: projectWorld.world,
      isIteration,
    });
    if (seeded.applied && seeded.seed) {
      worldSeedBlock = formatWorldSeedForCoder(seeded.seed);
      if (pipelineCtx && seeded.gamePrefilled) {
        pipelineCtx = { ...pipelineCtx, worldSeedApplied: true };
      }
      await stream.emit('planner', 'WORLD', {
        summary: seeded.seed.summaryLines[0] ?? '世界已编译进游戏',
        tool: 'world-game-compiler',
        details: {
          worldTitle:
            (projectWorld.world as { title?: string } | null)?.title ??
            (projectWorld.world as { name?: string } | null)?.name ??
            null,
          gamePrefilled: seeded.gamePrefilled,
          files: seeded.files,
          stats: seeded.seed.stats,
          initialSceneId: seeded.seed.lineage.initialSceneId,
          scenes: seeded.seed.scenePlan.map((p) => p.sceneId),
          tunables: seeded.seed.tunables,
          tunablesSource: seeded.seed.tunablesSource,
          summaryLines: seeded.seed.summaryLines,
        },
      });
    } else {
      await stream.emit('planner', 'WORLD', {
        summary: `世界编译跳过${seeded.reason ?? '未知原因'}`,
        tool: 'world-game-compiler',
        details: { reason: seeded.reason },
      });
    }
  } else {
    const autoSeeded = await tryAutoRpgWorldSeed({
      workspace,
      archetype: pipelineArchetype,
      userPrompt: prompt,
      isIteration,
      hasProjectWorld: false,
    });
    if (autoSeeded?.applied && autoSeeded.seed) {
      worldSeedBlock = formatWorldSeedForCoder(autoSeeded.seed);
      if (pipelineCtx && autoSeeded.gamePrefilled) {
        pipelineCtx = { ...pipelineCtx, worldSeedApplied: true };
      }
      await stream.emit('planner', 'WORLD', {
        summary:
          'RPG used an auto town template (createEmptyTownWorld) — not your Society World. Layout/NPCs came from the stock town seed.',
        tool: 'auto-rpg-world-seed',
        details: {
          gamePrefilled: autoSeeded.gamePrefilled,
          files: autoSeeded.files,
          stats: autoSeeded.seed.stats,
          source: 'createEmptyTownWorld',
        },
      });
    }
  }

  let childEnv = mergeChildEnv(
    process.env,
    paths.gameTemplatesParentDir,
    paths.gameDocsDir,
  );
  // Reasoning key pool for the Agent. Apply the best candidate up front so the
  // plural OPENGAME_REASONING_API_KEYS / OPENAI_API_KEYS forms actually take
  // effect (not only the ambient singular OPENAI_API_KEY). After a park we
  // stay on the replacement for the rest of the job.
  const agentKeyCandidates = resolveAgentKeyCandidates(process.env);
  const usedAgentKeyIds = new Set<string>();
  const allowEmergency = jobAllowsEmergencyModel({ jobType: 'generate' });
  const initialAgentKey = pickNextAgentKey(
    agentKeyCandidates,
    usedAgentKeyIds,
    Date.now(),
    { allowEmergency },
  );
  let agentKeyId = initialAgentKey?.id ?? null;
  if (initialAgentKey) {
    usedAgentKeyIds.add(initialAgentKey.id);
    childEnv = applyAgentKeyCandidate(childEnv, initialAgentKey);
    await stream.emit('planner', 'PLAN', {
      summary:
        agentKeyCandidates.length > 1
          ? `Agent Key '${agentKeyCandidates.length} 'MiniMax（当${initialAgentKey.keyHint}，额度满自动切备路）`
          : `Agent Key ${initialAgentKey.keyHint}（仅 1 路，建议配置 FALLBACK）`,
      details: {
        provider: initialAgentKey.provider,
        model: initialAgentKey.model,
        keyHint: initialAgentKey.keyHint,
        poolSize: agentKeyCandidates.length,
        tier: initialAgentKey.tier,
      },
    });
  }
  let agentKeyRotations = 0;
  const maxAgentKeyRotations = agentKeyMaxRotations(process.env);
  const agentKeyTrail: AgentKeyAttemptFailure[] = [];
  let reclaimedPrimaryAfterBilling = false;

  const cliResumeId = await resolveCliResumeSessionId(
    workspace,
    job.sessionId,
  );

  const cliTap = cliStdoutStreamingEnabled()
    ? createCliStdoutTap({
        emit: (summary, details) => {
          void stream.emit('coder', 'CODE', {
            summary,
            details,
          });
        },
      })
    : null;
  const invokeCliBound = async (p: string) => {
    try {
      return await invokeOpenGameCli({
        prompt: p,
        workspace,
        childEnv,
        cliJs: paths.openGameCliJs,
        resumeSessionId: cliResumeId,
        abortSignal,
        onStdoutChunk: cliTap ? (chunk) => cliTap.onChunk(chunk) : undefined,
      });
    } finally {
      cliTap?.flush();
    }
  };

  // Playable shell first: build/publish the scaffold before art and CODE, while
  // public/ is still quiet (the parallel art phase below writes into it).
  // Iterations already have a preview live and must not be reset to a shell.
  if (earlySkeletonPreviewEnabled() && !isIteration) {
    await withProgressHeartbeat(
      stream,
      jobId,
      '骨架预览构建（先给可玩壳）',
      () =>
        publishSkeletonPreview({
          db,
          s3,
          env,
          projectId,
          jobId,
          workspace,
          gameParams: payload.gameParams,
          childEnv,
          stream,
        }),
      'BUILD',
    );
  }

  // Converge ASSET dual-track: MiniMax seed is default; CLI generate_game_assets
  // only when explicitly enabled (PLATFORM_ENABLE_CLI_ASSET=true) to avoid double spend.
  const cliAssetEnabled =
    process.env['PLATFORM_ENABLE_CLI_ASSET'] === 'true' ||
    process.env['PLATFORM_ENABLE_CLI_ASSET'] === '1' ||
    (process.env['PLATFORM_ENABLE_ASSET_PHASE'] !== 'false' &&
      process.env['PLATFORM_GAME_MINIMAX_ASSETS'] !== 'true' &&
      !requireRealAssets());
  if (pipelineCtx?.assetPhasePrompt && cliAssetEnabled) {
    await runAssetPhase({
      prompt: pipelineCtx.assetPhasePrompt,
      stream,
      invokeCli: invokeCliBound,
    });
  } else if (pipelineCtx?.assetPhasePrompt) {
    await stream.emit('artist', 'ASSET', {
      summary:
        '跳过 CLI ASSET（已由 MiniMax 确定性阶段负责；设 PLATFORM_ENABLE_CLI_ASSET=true 可加跑）',
      tool: 'minimax-game-asset-phase',
    });
  }

  // Deterministic MiniMax seed — does not rely on CLI calling generate_game_assets
  const seedGameAssets = async (deferPatch: boolean): Promise<void> => {
    try {
      const seeded = await runGameAssetPhase(workspace, {
        // requireRealAssets 'force-all: only regen missing/bad slots unless
        // style change or explicit forceAssetRegen.
        force:
          Boolean(changePlan?.forceAssetRegen) ||
          Boolean(changePlan?.artStyle),
        deferPatch,
        styleOverride: changePlan?.artStyle ?? undefined,
        keepBackground:
          process.env['PLATFORM_ASSET_KEEP_BACKGROUND'] === 'true' ||
          process.env['PLATFORM_ASSET_KEEP_BACKGROUND'] === '1',
        referenceImageHints: [
          ...(changePlan?.referenceImageHints ?? []),
          ...persistedRefs,
        ],
      });
      await stream.emit('artist', 'ASSET', {
        summary:
          seeded.files.length > 0
            ? seeded.failoverEvents.length > 0
              ? `游戏资产完成${seeded.files.length} 项；Key 池已耗尽部分模态）`
              : `MiniMax 游戏资产完成${seeded.files.length} 项）`
            : 'MiniMax 游戏资产跳过（无密钥且未开启真资产策略）',
        details: {
          files: seeded.files,
          imageFiles: seeded.files.filter((f) =>
            /\.(png|jpe?g|webp|gif)$/i.test(f),
          ),
          audioFiles: seeded.files.filter((f) =>
            /\.(mp3|ogg|wav|m4a)$/i.test(f),
          ),
          patchedGameJson: seeded.patchedGameJson,
          quality: seeded.quality,
          // Only user-visible pool-exhausted notes (silent key rotate stays off UI)
          failoverEvents: seeded.failoverEvents,
          softSkipAudio: seeded.failoverEvents.some((e) =>
            /音效已跳过|all keys exhausted|'*全部/i.test(e),
          ),
          // Never mark silent mid-pool rotate as imageFailover for the product UI
          imageFailover: false,
          assetPoolExhausted: seeded.failoverEvents.some((e) =>
            /全部|池已|exhausted/i.test(e),
          ),
          parallelWithCode: deferPatch,
        },
      });
    } catch (err) {
      await stream.emit('artist', 'ASSET', {
        summary: 'MiniMax 游戏资产失败（禁止占位图）',
        details: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  };

  // Art is minutes of MiniMax round-trips and the Agent only needs the agreed
  // asset keys, not the bytes — overlap it with the first CODE round and wire
  // game.json once CODE is done writing it.
  const assetParallel = assetPhaseParallelWithCodeEnabled();
  let pendingAssetSeed: {
    readonly promise: Promise<void>;
    readonly state: { failed: boolean; error: unknown; joined: boolean };
  } | null = null;
  await stream.emit('artist', 'ASSET', {
    summary: assetParallel
      ? 'MiniMax 真资产与首轮 CODE 并行落盘（角色 idle/run /背景/敌人/道具/BGM/SFX；sprite 自动抠图）'
      : 'MiniMax 真资产落盘（角色 idle/run /背景/敌人/道具/BGM/SFX；sprite 自动抠图）',
    tool: 'minimax-game-asset-phase',
    details: { parallelWithCode: assetParallel },
  });
  if (assetParallel) {
    const state = { failed: false, error: null as unknown, joined: false };
    // Absorb the rejection here: nobody awaits this promise until CODE returns,
    // and an unhandled rejection would take the worker down. It is rethrown at
    // the join point so the fail-hard-on-fake-assets policy is unchanged.
    const promise = seedGameAssets(true).catch((err: unknown) => {
      state.failed = true;
      state.error = err;
    });
    pendingAssetSeed = { promise, state };
  } else {
    await seedGameAssets(false);
  }

  const worldTipLine = worldSeedBlock
    ? `\n${worldSeedBlock}\n`
    : !pipelineCtx && worldStyleTip?.artStyle
      ? `\n【世界美术锚点】artStyle=${worldStyleTip.artStyle}; palette=${(worldStyleTip.palette ?? []).join(',')}\n`
      : '';
  const changePlanBlock = changePlan
    ? `\n\n${formatChangePlanForPrompt(changePlan)}\n`
    : '';
  let targetSceneSlice = '';
  if (changePlan?.targetSceneId) {
    try {
      const { readTargetSceneSlice } = await import('./workspaceContext.js');
      targetSceneSlice = await readTargetSceneSlice(
        workspace,
        changePlan.targetSceneId,
      );
      if (targetSceneSlice) {
        targetSceneSlice = `\n\n【目Scene 源码切片 / 只改这里】\n\`\`\`ts\n${targetSceneSlice}\n\`\`\`\n`;
      }
    } catch {
      /* optional */
    }
  }

  // The durable half of the contract goes on disk as CLI system context; the
  // prompt then only carries what changes round to round.
  let contractInWorkspace = false;
  if (cliContextFileEnabled()) {
    try {
      const ctxFile = await ensureCliContextFile(workspace, {
        archetype: pipelineCtx?.archetype ?? pipelineArchetype ?? null,
        isIteration,
      });
      contractInWorkspace = true;
      await stream.emit('planner', 'PLAN', {
        summary: `平台硬约定写入 ${path.basename(ctxFile.path)}（${ctxFile.chars} 字），首轮提示不再复述`,
        details: {
          contextFile: path.basename(ctxFile.path),
          chars: ctxFile.chars,
          refreshed: ctxFile.written,
        },
      });
    } catch (err) {
      console.warn('[processJob] cli context file failed', err);
    }
  }

  const escalationMode = readGateEscalationMode();
  const targetTier = resolveTargetGateTier();
  // Progressive: first CODE must not bake BEYOND/MULTI_ROLE (env beyond=true is
  // for *gates* after playable). strict-first may include beyond contracts.
  const enhancedPrompt = buildEnhancedPrompt({
    contractInWorkspace,
    basePrompt: `${agentCtx.promptPrefix}${worldTipLine}${changePlanBlock}${targetSceneSlice}\n\n${prompt}`,
    gameParams: payload.gameParams,
    imagesCount: payload.images?.length,
    isIteration,
    workspaceSummary,
    conversationTurns: [],
    pipelineContext: pipelineCtx
      ? formatPipelineContextForCoder(pipelineCtx)
      : undefined,
    archetype: pipelineCtx?.archetype,
    includeBeyond:
      escalationMode === 'strict-first' && targetTier.beyondBaseline,
  });

  /** Every FIX round carries the same context; only the error block differs. */
  const leanFix = (errorBlock: string): string =>
    buildLeanFixPrompt({
      userPrompt: prompt,
      errorBlock,
      workspaceSummaryText: workspaceSummary.summaryText,
      briefSnippet: agentCtx.briefText,
      contractInWorkspace,
    });

  let currentPrompt = enhancedPrompt;
  let lastCliResult: RunProcessResult | null = null;
  let lastValidate: ValidateBuildResult | null = null;
  let lastQuality: Awaited<ReturnType<typeof runGameQualityGate>> | null = null;
  let lastSmoke: PlayabilitySmokeResult | null = null;
  let success = false;
  let attempt = 0;
  let lastQualityIssueKey: string | null = null;
  const maxFixIterations = readMaxFixIterations(
    changePlan,
    pipelineCtx?.archetype ?? pipelineArchetype ?? null,
  );

  const twoTier =
    escalationMode === 'progressive' && !gateTiersEqual(targetTier, BASELINE_TIER);
  /** Preview already live — later rounds can only add, never take away. */
  let deliveredPlayable = false;
  let lastPublish: PublishedPreview | null = null;
  let deliveredTier: GateTier | null = null;
  const timeBudgetMs = readGenerationTimeBudgetMs();
  let budgetExhausted = false;
  let consecutiveHardTimeouts = 0;
  /** First CODE hard-timeout → next round retries full CODE, not a short FIX. */
  let retryFullCodeAfterTimeout = false;
  let stoppedForConsecutiveTimeouts = false;
  // Budget covers the CLI/FIX/smoke self-heal loop only — MiniMax art / world
  // seed / scaffold before this point must not steal FIX rounds (artStyle
  // iterate was burning 1200s before CODE even finished).
  const cliLoopStart = Date.now();

  await stream.emit('planner', 'PLAN', {
    summary: twoTier
      ? `门禁分级：先过「${BASELINE_TIER.label}」即交付可玩预览，再冲「${targetTier.label}」`
      : `门禁模式「${targetTier.label}」（未分级）`,
    details: {
      escalationMode,
      targetTier: targetTier.id,
      maxFixIterations,
      timeBudgetMs,
    },
  });

  while (attempt < maxFixIterations) {
    await assertJobNotCancelled(db, jobId);
    if (abortSignal?.aborted) {
      throw new JobCancelledError(jobId);
    }
    const elapsedMsSoFar = Date.now() - cliLoopStart;
    const remainingBudgetMs = timeBudgetMs - elapsedMsSoFar;
    if (attempt >= 1 && !hasUsefulCliBudget(remainingBudgetMs)) {
      budgetExhausted = true;
      await stream.emit('planner', 'PLAN', {
        summary: `已达生成时间预算（${Math.round(timeBudgetMs / 1000)}s），停止开新一轮 Agent`,
        details: {
          attempt,
          deliveredPlayable,
          timeBudgetMs,
          elapsedMs: elapsedMsSoFar,
          remainingBudgetMs,
          budgetScope: 'cli-self-heal-loop',
        },
      });
      break;
    }
    attempt += 1;
    const forceFullTimeout = retryFullCodeAfterTimeout;
    const treatAsCode =
      attempt === 1 || forceFullTimeout || (isIteration && attempt === 1);
    retryFullCodeAfterTimeout = false;
    const gateTier = resolveGateTierForAttempt({
      mode: escalationMode,
      target: targetTier,
      deliveredPlayable,
    });
    const tierEnvSnapshot = applyGateTierEnv(gateTier);
    try {
    const role = treatAsCode ? 'coder' : 'fixer';
    const phaseLabel = treatAsCode
      ? isIteration
        ? 'ITERATE'
        : 'CODE'
      : 'FIX';
    const cliTimeoutMs = resolveCliTimeoutForAttempt({
      attempt,
      remainingBudgetMs,
      forceFullTimeout: treatAsCode,
    });
    await stream.emit(role, phaseLabel, {
      tool: 'opengame-cli',
      summary:
        treatAsCode
          ? forceFullTimeout && attempt > 1
            ? '首轮 CLI 硬超时，用剩余预算整轮重试生成（非整短 FIX）'
            : isIteration
              ? '调用 OpenGame CLI 增量修改现有游戏'
              : '调用 OpenGame CLI 生成游戏代码'
          : deliveredPlayable
            ? `提质第 ${attempt - 1} 轮：可玩版已交付，仅做增量增强`
            : `Agent 自愈第 ${attempt - 1} 轮：确定性修复未覆盖，交给模型修`,
      details: {
        attempt,
        isIteration,
        resume: Boolean(cliResumeId),
        gateTier: gateTier.id,
        cliTimeoutMs,
        deliveredPlayable,
        forceFullTimeout: treatAsCode && attempt > 1,
        provider: agentKeyCandidates.find((c) => c.id === agentKeyId)?.provider,
        model: agentKeyCandidates.find((c) => c.id === agentKeyId)?.model,
        keyHint: agentKeyCandidates.find((c) => c.id === agentKeyId)?.keyHint,
        poolSize: agentKeyCandidates.length,
      },
    });
    const cliStart = Date.now();
    logJobStep(
      jobId,
      `CLI attempt ${attempt}/${maxFixIterations} tier=${gateTier.id} timeout=${Math.round(cliTimeoutMs / 1000)}s`,
    );
    const stopCliHeartbeat = startJobHeartbeat(
      stream,
      'OpenGame CLI 生成代码',
      30_000,
      phaseLabel === 'FIX' || phaseLabel === 'ITERATE' ? phaseLabel : 'CODE',
      {
        attempt,
        maxAttempts: maxFixIterations,
        cliTimeoutMs,
        gateTier: gateTier.id,
        keyHint: agentKeyCandidates.find((c) => c.id === agentKeyId)?.keyHint,
        provider: agentKeyCandidates.find((c) => c.id === agentKeyId)?.provider,
        model: agentKeyCandidates.find((c) => c.id === agentKeyId)?.model,
        poolSize: agentKeyCandidates.length,
      },
    );
    lastCliResult = await invokeOpenGameCli({
      prompt: currentPrompt,
      workspace,
      childEnv,
      cliJs: paths.openGameCliJs,
      // Default: only CODE may --resume. FIX re-sending full CLI history
      // multiplies tokens; set PLATFORM_CLI_RESUME_ON_FIX=true to restore old behaviour.
      resumeSessionId:
        cliResumeId &&
        (process.env['PLATFORM_CLI_RESUME_ON_FIX'] === 'true' ||
          (treatAsCode && phaseLabel !== 'FIX' && attempt === 1))
          ? cliResumeId
          : undefined,
      timeoutMs: cliTimeoutMs,
      abortSignal,
    });
    stopCliHeartbeat();
    let cliElapsed = Date.now() - cliStart;
    let timedOut = lastCliResult.exitCode === 124;
    if (lastCliResult.exitCode === 130 || abortSignal?.aborted) {
      throw new JobCancelledError(jobId);
    }
    if (timedOut) {
      consecutiveHardTimeouts += 1;
    } else {
      consecutiveHardTimeouts = 0;
    }
    await stream.emit(role, phaseLabel, {
      tool: 'opengame-cli',
      summary: timedOut
        ? `OpenGame CLI 硬超时（${Math.round(cliElapsed / 1000)}s）—已终止，可重试`
        : `CLI 退出码 ${lastCliResult.exitCode}`,
      details: {
        exitCode: lastCliResult.exitCode,
        timedOut,
        consecutiveHardTimeouts,
        stdoutChars: lastCliResult.stdout.length,
        stderrChars: lastCliResult.stderr.length,
        stderrTail: lastCliResult.stderr.slice(-400),
        filesChanged:
          lastCliResult.exitCode === 0
            ? parseCodeChangesFromOutput(lastCliResult.stdout)
                .map((c) => c.filename)
                .slice(0, 40)
            : [],
        attempt,
        maxAttempts: maxFixIterations,
        cliTimeoutMs,
      },
      elapsedMs: cliElapsed,
    });

    // Join the parallel art phase: CODE is done touching public/game.json, so
    // the deferred DSL wiring can land before any gate looks at it.
    const assetSeed = pendingAssetSeed;
    if (assetSeed && !assetSeed.state.joined) {
      assetSeed.state.joined = true;
      const joinStart = Date.now();
      await withProgressHeartbeat(
        stream,
        jobId,
        'MiniMax 资产收尾（与 CODE 并行）',
        () => assetSeed.promise,
        'ASSET',
      );
      if (assetSeed.state.failed) {
        throw assetSeed.state.error;
      }
      const wired = await runGameAssetPhase(workspace, { patchOnly: true });
      recordAssetTopUp(workspace);
      await stream.emit('artist', 'ASSET', {
        tool: 'minimax-game-asset-phase',
        summary: wired.patchedGameJson
          ? 'game.json 已接线并行生成的真资产'
          : 'game.json 无需接线（CODE 已引用真资产）',
        details: { patchedGameJson: wired.patchedGameJson },
        elapsedMs: Date.now() - joinStart,
      });
    }

    // Agent key pool: a quota / arrears / auth failure parks the current key and the
    // attempt is replayed on the next healthy MiniMax candidate. Non-key
    // failures never rotate 'those are code errors the FIX loop handles.
    // Fallback billing reclaims a primary that only hit a short rate-limit so
    // a spare MiniMax arrears alone cannot hard-fail a job while the primary
    // may already have recovered.
    while (lastCliResult.exitCode !== 0 && agentKeyRotations < maxAgentKeyRotations) {
      const cliOutput = `${lastCliResult.stdout}\n${lastCliResult.stderr}`;
      const quotaHit = detectLlmQuotaError(cliOutput);
      const authHit = quotaHit ? null : detectLlmAuthError(cliOutput);
      if (!quotaHit && !authHit) break;

      const currentCandidate = agentKeyId
        ? agentKeyCandidates.find((c) => c.id === agentKeyId)
        : undefined;
      const failKind = pushAgentKeyFailure(
        agentKeyTrail,
        currentCandidate,
        cliOutput,
        process.env,
      );

      let next =
        failKind === 'billing' &&
        currentCandidate?.tier === 'fallback' &&
        !reclaimedPrimaryAfterBilling
          ? reclaimPrimaryAfterFallbackBilling(
              agentKeyCandidates,
              usedAgentKeyIds,
              agentKeyTrail,
            )
          : null;
      const usedReclaim = Boolean(next);
      if (next) {
        reclaimedPrimaryAfterBilling = true;
      } else {
        next = pickNextAgentKey(
          agentKeyCandidates,
          usedAgentKeyIds,
          Date.now(),
          { allowEmergency },
        );
      }
      if (!next) break;

      agentKeyRotations += 1;
      agentKeyId = next.id;
      usedAgentKeyIds.add(next.id);
      childEnv = applyAgentKeyCandidate(childEnv, next);
      await stream.emit(role, phaseLabel === 'FIX' || phaseLabel === 'ITERATE' ? phaseLabel : 'CODE', {
        // Quiet operator breadcrumb 'product UI must not treat this as a warning.
        summary: `OpenGame CLI 继续（${next.keyHint}）`,
        details: {
          provider: next.provider,
          model: next.model,
          baseUrl: next.baseUrl,
          keyHint: next.keyHint,
          tier: next.tier,
          poolSize: agentKeyCandidates.length,
          quotaKind: quotaHit?.kind ?? (authHit ? 'auth' : 'quota'),
          reclaimedPrimary: usedReclaim,
          // Internal only 'do not set providerFailover (avoids user-facing "已切换备')
          keyPoolSilentRotate: true,
          trail: agentKeyTrail,
        },
      });
      const fbStart = Date.now();
      const stopFb = startJobHeartbeat(
        stream,
        `OpenGame CLI（Key '${next.provider}）`,
        30_000,
        phaseLabel === 'FIX' || phaseLabel === 'ITERATE' ? phaseLabel : 'CODE',
        {
          attempt,
          maxAttempts: maxFixIterations,
          cliTimeoutMs,
          provider: next.provider,
          model: next.model,
          keyHint: next.keyHint,
          providerFailover: true,
        },
      );
      lastCliResult = await invokeOpenGameCli({
        prompt: currentPrompt,
        workspace,
        childEnv,
        cliJs: paths.openGameCliJs,
        resumeSessionId: undefined,
        timeoutMs: cliTimeoutMs,
        abortSignal,
      });
      stopFb();
      cliElapsed = Date.now() - fbStart;
      timedOut = lastCliResult.exitCode === 124;
      if (timedOut) {
        consecutiveHardTimeouts += 1;
      } else if (lastCliResult.exitCode === 0) {
        consecutiveHardTimeouts = 0;
      }
      if (lastCliResult.exitCode === 130 || abortSignal?.aborted) {
        throw new JobCancelledError(jobId);
      }
      await stream.emit(role, phaseLabel, {
        tool: 'opengame-cli',
        summary: timedOut
          ? `备路 CLI 硬超时（${Math.round(cliElapsed / 1000)}s${next.provider}）`
          : `备路 CLI 退出码 ${lastCliResult.exitCode}${next.provider} ${next.model}）`,
        details: {
          exitCode: lastCliResult.exitCode,
          timedOut,
          providerFailover: true,
          provider: next.provider,
          model: next.model,
          keyHint: next.keyHint,
          stderrTail: lastCliResult.stderr.slice(-800),
          stdoutTail: lastCliResult.stdout.slice(-800),
        },
        elapsedMs: cliElapsed,
      });
    }
    if (lastCliResult.exitCode === 0 && agentKeyId) {
      recordAgentKeySuccess(agentKeyId);
    }
    if (lastCliResult.exitCode !== 0 && agentKeyTrail.length > 0) {
      const finalOutput = `${lastCliResult.stdout}\n${lastCliResult.stderr}`;
      // Only hard-fail the job when the *last* attempt is still quota/billing.
      // A non-quota error after reclaim should fall through into the FIX loop.
      if (detectLlmQuotaError(finalOutput)) {
        const lastCand = agentKeyCandidates.find((c) => c.id === agentKeyId);
        const lastTrail = agentKeyTrail[agentKeyTrail.length - 1];
        if (lastCand && lastTrail?.id !== lastCand.id) {
          pushAgentKeyFailure(agentKeyTrail, lastCand, finalOutput, process.env);
        }
        const partialLog = buildGenerateAttemptLogBody({
          attempt,
          maxAttempts: maxFixIterations,
          success: false,
          lastQuality,
          lastCliResult,
          lastValidate,
        });
        await throwIfCliQuotaFailure(
          lastCliResult,
          s3,
          env,
          projectId,
          jobId,
          partialLog,
          { rotationTrail: agentKeyTrail },
        );
      }
    }

    if (lastCliResult.exitCode !== 0) {
      const partialLog = buildGenerateAttemptLogBody({
        attempt,
        maxAttempts: maxFixIterations,
        success: false,
        lastQuality,
        lastCliResult,
        lastValidate,
      });
      await throwIfCliQuotaFailure(
        lastCliResult,
        s3,
        env,
        projectId,
        jobId,
        partialLog,
      );
      if (
        timedOut &&
        consecutiveHardTimeouts >= MAX_CONSECUTIVE_CLI_HARD_TIMEOUTS &&
        !deliveredPlayable
      ) {
        stoppedForConsecutiveTimeouts = true;
        await stream.emit('planner', 'PLAN', {
          summary: `连续 ${consecutiveHardTimeouts} 轮 CLI 硬超时，停止空转（避免短 FIX 继续烧预算）`,
          details: {
            attempt,
            consecutiveHardTimeouts,
            timeBudgetMs,
            elapsedMs: Date.now() - cliLoopStart,
          },
        });
        break;
      }
      if (timedOut && treatAsCode && !deliveredPlayable) {
        // Hung CODE rarely recovers via a 2–5 minute FIX — retry full CODE once
        // with whatever wall-clock remains, then circuit-break if that also hangs.
        retryFullCodeAfterTimeout = true;
        currentPrompt = enhancedPrompt;
        continue;
      }
      currentPrompt = leanFix(
        timedOut
          ? `【OpenGame CLI 硬超时已终止】\n${lastCliResult.stderr.slice(-800)}`
          : `【上一轮 CLI 异常退出，请重试且尽量减少破坏性改动】\n${lastCliResult.stderr.slice(-800)}`,
      );
      continue;
    }

    // 先做轻量 DSL 校验，避免在 game.json 损坏时白跑一次构建
    const dslCheck = checkGameDsl(workspace);
    if (dslCheck.errors.length > 0) {
      await stream.emit('qa', 'QA', {
        tool: 'game.json validator',
        summary: 'game.json 校验失败',
        details: { path: dslCheck.path, errors: dslCheck.errors },
      });
      currentPrompt = leanFix(
        `【game.json 校验失败，请按以下错误修复（保持其他文件不动）】\n` +
          dslCheck.errors.map((e) => `- ${e}`).join('\n'),
      );
      continue;
    } else {
      await stream.emit('qa', 'QA', {
        tool: 'game.json validator',
        summary: 'game.json 校验通过',
        details: { path: dslCheck.path },
      });
    }

    // Baseline-tier world lineage check 'deterministic, <100ms, and the only
    // gate that proves the world model actually shaped the game.
    const lineage = await runWorldLineageGate(workspace);
    if (lineage.enforced) {
      await stream.emit('qa', 'WORLD', {
        tool: 'world-lineage-gate',
        summary: formatWorldLineageSummary(lineage),
        details: {
          ok: lineage.ok,
          issues: lineage.issues,
          worldTitle: lineage.worldTitle,
          coverage: {
            scenes: lineage.scenes,
            entities: lineage.entities,
            quests: lineage.quests,
            portals: lineage.portals,
          },
        },
      });
      if (!lineage.ok) {
        currentPrompt = leanFix(formatWorldLineageFailureForPrompt(lineage));
        continue;
      }
    }

    await stream.emit('qa', 'BUILD', {
      tool: 'tsc (entry overlay) + vite build',
      summary: '运行 typecheck + 构建验证',
    });
    const buildStart = Date.now();
    lastValidate = await validateBuild(workspace, childEnv);
    const buildElapsed = Date.now() - buildStart;
    await stream.emit('qa', 'BUILD', {
      tool: 'tsc overlay + vite build',
      summary: !lastValidate.ok
        ? '构建失败'
        : lastValidate.cached === 'all'
          ? '构建通过（命中指纹缓存，源码与 public 未变）'
          : lastValidate.cached === 'typecheck'
            ? '构建通过（typecheck 命中缓存）'
            : '构建通过',
      details: {
        typecheckExit: lastValidate.typecheck.exitCode,
        buildExit: lastValidate.build.exitCode,
        cached: lastValidate.cached ?? null,
      },
      elapsedMs: buildElapsed,
    });

    // Deterministic codemods before burning another Agent round: TS2554
    // lineStyle arity, TS2779 optional-chain assignment, TS18047 null guards.
    for (let dfixPass = 0; dfixPass < 2 && !lastValidate.ok; dfixPass += 1) {
      const dfix = await runDeterministicFix(
        workspace,
        `${lastValidate.typecheck.stdout}\n${lastValidate.typecheck.stderr}`,
      );
      if (!dfix.ok) {
        if (dfixPass === 0 && dfix.skipped.length > 0) {
          await stream.emit('fixer', 'FIX', {
            tool: 'deterministic-codemod',
            summary: '确定性修复：无可用规则，转交 Agent 修复',
            details: { skipped: dfix.skipped.slice(0, 8) },
          });
        }
        break;
      }
      await stream.emit('fixer', 'FIX', {
        tool: 'deterministic-codemod',
        summary: formatDeterministicFixSummary(dfix),
        details: {
          pass: dfixPass + 1,
          applied: dfix.applied.slice(0, 12),
          files: dfix.files,
          skipped: dfix.skipped.slice(0, 8),
        },
      });
      const reStart = Date.now();
      lastValidate = await validateBuild(workspace, childEnv);
      await stream.emit('qa', 'BUILD', {
        tool: 'tsc overlay + vite build（确定性修复后重验）',
        summary: lastValidate.ok
          ? '确定性修复后构建通过（省下一Agent 轮）'
          : '确定性修复后仍失败',
        details: {
          typecheckExit: lastValidate.typecheck.exitCode,
          buildExit: lastValidate.build.exitCode,
          deterministicPass: dfixPass + 1,
        },
        elapsedMs: Date.now() - reStart,
      });
    }

    if (lastValidate.ok) {
      const qaMode = gateTier.qaMode;
      const gateArchetype =
        pipelineCtx?.archetype ?? (await readWorkspaceArchetype(workspace));
      const sceneCount = await countCustomSceneFiles(workspace);

      // CODE may overwrite DSL / strip Boss spawn 're-land ChangePlan before smoke/gate
      if (changePlan) {
        try {
          const reseed = await applyChangePlanToGameArtifacts(
            workspace,
            changePlan,
          );
          const contracts = await ensureChangePlanSceneContracts(
            workspace,
            changePlan,
          );
          if (reseed.patches.length || contracts.patches.length) {
            await stream.emit('planner', 'PLAN', {
              summary: 'ChangePlan：CODE 后重种 + Scene 意图契约',
              details: {
                dslPatches: reseed.patches.slice(0, 8),
                sceneContracts: contracts.patches.slice(0, 8),
              },
            });
          }
        } catch {
          // non-fatal; gates still catch misses
        }
      }

      // Phase-36: restore juice from baseline before gate (mute color-block guard)
      try {
        const { restoreJuiceFromBaseline } = await import('./juiceBaseline.js');
        const juiceRestore = await restoreJuiceFromBaseline(workspace);
        if (juiceRestore.patches.length) {
          await stream.emit('planner', 'PLAN', {
            summary: `Juice 基线恢复${juiceRestore.restored.length} Scene）`,
            details: {
              restored: juiceRestore.restored,
              patches: juiceRestore.patches,
            },
          });
        }
      } catch {
        // non-fatal
      }

      // Fill missing MiniMax slots + wire entities into game.json/dist before smoke
      try {
        let needStyleForce = Boolean(changePlan?.artStyle);
        if (changePlan?.artStyle) {
          try {
            const { readAssetFingerprint } = await import(
              './assetFingerprint.js'
            );
            const fp = readAssetFingerprint(workspace);
            const token = changePlan.artStyle
              .toLowerCase()
              .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, ' ')
              .trim()
              .split(/\s+/)
              .find((t) => t.length >= 3);
            if (
              fp?.artStyle &&
              token &&
              String(fp.artStyle).toLowerCase().includes(token)
            ) {
              needStyleForce = false;
            }
          } catch {
            /* force when unsure */
          }
        }
        const assetForce =
          Boolean(changePlan?.forceAssetRegen) || needStyleForce;
        const assetKey = assetTopUpFingerprint(workspace);
        if (!assetForce && assetTopUpIsFresh(workspace, assetKey)) {
          // Nothing on disk or in the DSL moved since the last top-up 'only
          // re-wire game.json instead of re-probing/rewriting every asset.
          await runGameAssetPhase(workspace, { patchOnly: true });
        } else {
          await runGameAssetPhase(workspace, {
            force: assetForce,
            styleOverride: changePlan?.artStyle ?? undefined,
            referenceImageHints: [
              ...(changePlan?.referenceImageHints ?? []),
              ...persistedRefs,
            ],
          });
          recordAssetTopUp(workspace);
        }
        await syncPublicAssetsToDist(workspace);
      } catch (err) {
        if (requireRealAssets()) {
          await stream.emit('artist', 'ASSET', {
            summary: '冒烟前资产接线失败',
            details: {
              error: err instanceof Error ? err.message : String(err),
            },
          });
          throw err;
        }
      }

      // Agent often rewrites game.json to world-region DSL stubs without
      // customModule while main.ts still registers Title/World extraScenes '      // heal that wiring before Playwright smoke (deterministic, no LLM).
      try {
        const { healExtraScenesGameJsonWiring } = await import(
          './gameQualityArchetype.js'
        );
        const wireHeal = await healExtraScenesGameJsonWiring(workspace);
        if (wireHeal.healed) {
          await syncPublicAssetsToDist(workspace);
          await stream.emit('planner', 'PLAN', {
            summary: `extraScenes↔game.json 确定性接线（${wireHeal.scenes.join(', ')}）`,
            details: wireHeal as unknown as Record<string, unknown>,
          });
        }
      } catch {
        /* non-fatal — gate/smoke still catch */
      }

      // Same dist bytes + same gate tier 'same smoke verdict; skip Playwright.
      const smokeKey = smokeCacheKey(workspace, gateTier.id);
      const cachedSmoke = readCachedSmoke(workspace, smokeKey);
      if (cachedSmoke) {
        await stream.emit('qa', 'QA', {
          tool: 'playability-smoke',
          summary: cachedSmoke.ok
            ? '运行时冒烟复用缓存结果（dist 未变）'
            : '运行时冒烟复用缓存结果：仍未通过（dist 未变）',
          details: {
            cached: true,
            gateTier: gateTier.id,
            issues: cachedSmoke.issues.slice(0, 6),
          },
        });
      } else {
        await stream.emit('qa', 'QA', {
          tool: 'playability-smoke',
          summary: '运行时冒烟（headless 浏览器）',
          details: { sceneCount, archetype: gateArchetype, gateTier: gateTier.id },
        });
      }
      const smoke: PlayabilitySmokeResult = cachedSmoke
        ? {
            ok: cachedSmoke.ok,
            issues: cachedSmoke.issues,
            consoleErrors: [],
            pageErrors: [],
          }
        : await runPlayabilitySmoke(workspace);
      if (!cachedSmoke) {
        writeCachedSmoke(workspace, smokeKey, smoke);
      }
      if (!smoke.ok) {
        lastSmoke = smoke;
        const softContinueEscalation =
          deliveredPlayable && attempt >= maxFixIterations;
        await stream.emit('qa', 'QA', {
          tool: 'playability-smoke',
          summary: softContinueEscalation
            ? '运行时冒烟未通过 — 已有可玩预览，提质轮软继续（不撤销预览）'
            : attempt >= maxFixIterations
              ? '运行时冒烟未通过 — 首次交付拒绝软标可玩'
              : '运行时冒烟未通过',
          details: {
            issues: smoke.issues,
            sceneCount,
            smokeOk: false,
            pageErrors: smoke.pageErrors.slice(0, 2),
            progress: smoke.progress ?? null,
            lastAttemptSoftContinue: softContinueEscalation,
          },
        });
        if (attempt < maxFixIterations) {
          currentPrompt = leanFix(formatPlayabilityFailureForPrompt(smoke));
          continue;
        }
        if (!softContinueEscalation) {
          // First delivery + smoke fail on last attempt: do not publish as playable.
          break;
        }
        // Escalation only: fall through to quality/publish without claiming a new playable.
      } else {
        lastSmoke = smoke;
        await stream.emit('qa', 'QA', {
          tool: 'playability-smoke',
          summary: '运行时冒烟通过',
          details: {
            sceneCount,
            smokeOk: true,
            archetype: gateArchetype,
            progress: smoke.progress ?? null,
          },
        });
      }
      const quality = await runGameQualityGate(workspace, qaMode, {
        archetype: gateArchetype,
      });
      lastQuality = quality;

      // Forge first so vision QA can see atlas/tilemap artifacts
      try {
        await writeAssetForgeArtifacts(workspace, {
          styleProfile: artStyleProfile(payload.gameParams?.artStyleId),
        });
        await syncPublicAssetsToDist(workspace).catch(() => undefined);
      } catch {
        /* forge optional */
      }

      // Vision QA (heuristic / optional VLM) — feeds FIX prompt when failing
      let visionBlock = '';
      try {
        const vision = await runVisionQaGate(workspace, {
          screenshotBase64: lastSmoke?.screenshotBase64,
        });
        await stream.emit('qa', 'QA', {
          tool: 'vision-qa',
          summary: `视觉 QA ${vision.ok ? '通过' : '未过'} avg=${vision.average} (${vision.mode})`,
          details: vision as unknown as Record<string, unknown>,
        });
        try {
          await fsp.mkdir(path.join(workspace, 'public'), { recursive: true });
          await fsp.writeFile(
            path.join(workspace, 'public', 'VISION_QA.json'),
            JSON.stringify(vision, null, 2),
            'utf8',
          );
        } catch {
          /* report persist optional */
        }
        visionBlock = visionQaFixBlock(vision);
        if (!vision.ok && quality.ok) {
          lastQuality = {
            ok: false,
            issues: [
              ...quality.issues,
              `视觉QA未过 avg=${vision.average}: ${vision.issues.slice(0, 3).join('; ')}`,
            ],
          };
        }
      } catch (err) {
        await stream.emit('qa', 'QA', {
          tool: 'vision-qa',
          summary: `视觉 QA 跳过: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Requirement fit — the only gate that compares the delivered game with
      // what the user asked for, rather than with generic playability rules.
      let requirementBlock = '';
      try {
        const req = await runRequirementGate(workspace);
        if (req.checks.length > 0) {
          await stream.emit('qa', 'QA', {
            tool: 'requirement-gate',
            summary: `需求贴合 ${req.checks.length - req.missing.length}/${req.checks.length} 项已落地${req.ok ? '' : ` — 缺: ${req.missing.map((m) => m.label).join('、')}`}`,
            details: {
              satisfied: req.checks.filter((c) => c.satisfied).map((c) => c.label),
              missing: req.missing.map((m) => ({ label: m.label, hint: m.hint })),
            },
          });
        }
        if (!req.ok) {
          requirementBlock = formatRequirementFixPrompt(req);
          if (lastQuality.ok) {
            lastQuality = {
              ok: false,
              issues: [...lastQuality.issues, ...req.issues],
            };
          }
        }
      } catch (err) {
        await stream.emit('qa', 'QA', {
          tool: 'requirement-gate',
          summary: `需求贴合门禁跳过: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Design compiler datasets (SYSTEMS.json / CONTENT.json)
      try {
        const gddPath = path.join(workspace, 'GAME_DESIGN.md');
        const biblePath = path.join(workspace, 'public', 'STORY_BIBLE.json');
        const gdd = fs.existsSync(gddPath)
          ? await fsp.readFile(gddPath, 'utf8')
          : '';
        let bible: Record<string, unknown> = {};
        if (fs.existsSync(biblePath)) {
          bible = JSON.parse(await fsp.readFile(biblePath, 'utf8')) as Record<
            string,
            unknown
          >;
        }
        const compiled = compileDesign({
          gddMarkdown: gdd,
          storyBible: bible as {
            npcs?: Array<{ id?: string; name?: string }>;
            quests?: Array<{
              id?: string;
              title?: string;
              description?: string;
              requires?: string[];
            }>;
          },
          targetMinutes: 30,
        });
        await fsp.mkdir(path.join(workspace, 'public'), { recursive: true });
        await fsp.writeFile(
          path.join(workspace, 'public', 'SYSTEMS.json'),
          JSON.stringify(compiled.systems, null, 2),
          'utf8',
        );
        await fsp.writeFile(
          path.join(workspace, 'public', 'CONTENT.json'),
          JSON.stringify(compiled.content, null, 2),
          'utf8',
        );
        await syncPublicAssetsToDist(workspace).catch(() => undefined);
        await stream.emit('planner', 'PLAN', {
          summary: `Design Compiler · quests=${compiled.content.quests.length} · ~${compiled.content.estimatedMinutes}m`,
          details: { issues: compiled.issues, ok: compiled.ok },
        });
        if (!compiled.ok && lastQuality.ok) {
          lastQuality = {
            ok: false,
            issues: [
              ...lastQuality.issues,
              ...compiled.issues
                .filter((i) => i.level === 'error')
                .map((i) => `DesignCompiler: ${i.message}`),
            ],
          };
        }
      } catch (err) {
        await stream.emit('planner', 'PLAN', {
          summary: `Design Compiler skipped: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Playtest agent (policy over probe) 'soft signal
      if (process.env['PLATFORM_PLAYTEST_AGENT'] !== 'false') {
        try {
          let contentMinutes = 0;
          try {
            const contentPath = path.join(workspace, 'public', 'CONTENT.json');
            if (fs.existsSync(contentPath)) {
              const cj = JSON.parse(
                await fsp.readFile(contentPath, 'utf8'),
              ) as {
                estimatedMinutes?: number;
                quests?: unknown[];
                chapters?: unknown[];
                dialogues?: unknown[];
                encounters?: unknown[];
              };
              const { estimateContentDepthMinutes } = await import(
                './playtestAgent.js'
              );
              contentMinutes = estimateContentDepthMinutes(cj);
            }
          } catch {
            contentMinutes = 0;
          }
          let playtestLlm:
            | ((prompt: string) => Promise<string>)
            | undefined;
          try {
            const apiKey =
              process.env['OPENGAME_REASONING_API_KEY']?.trim() ||
              process.env['OPENAI_API_KEY']?.trim() ||
              '';
            const base =
              process.env['OPENGAME_REASONING_BASE_URL']?.trim() ||
              process.env['OPENAI_BASE_URL']?.trim() ||
              'https://api.openai.com/v1';
            const model =
              process.env['OPENGAME_REASONING_MODEL']?.trim() ||
              process.env['OPENAI_MODEL']?.trim() ||
              'gpt-4o-mini';
            if (apiKey) {
              playtestLlm = async (prompt: string) => {
                const res = await fetch(
                  `${base.replace(/\/$/, '')}/chat/completions`,
                  {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${apiKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      model,
                      messages: [{ role: 'user', content: prompt }],
                      temperature: 0.2,
                    }),
                  },
                );
                if (!res.ok) return 'ArrowRight';
                const data = (await res.json()) as {
                  choices?: Array<{ message?: { content?: string } }>;
                };
                return data.choices?.[0]?.message?.content ?? 'ArrowRight';
              };
            }
          } catch {
            playtestLlm = undefined;
          }
          const play = await runPlaytestAgent({
            distDir: path.join(workspace, 'dist'),
            maxSteps: 32,
            contentMinutes,
            llm: playtestLlm,
            runBrowser: async ({ distDir, actions }) => {
              const { runPlaytestBrowser } = await import('./playtestBrowser.js');
              return runPlaytestBrowser({ distDir, actions });
            },
          });
          await stream.emit('qa', 'QA', {
            tool: 'playtest-agent',
            summary: play.summary,
            details: play as unknown as Record<string, unknown>,
          });
          try {
            await fsp.mkdir(path.join(workspace, 'public'), { recursive: true });
            await fsp.writeFile(
              path.join(workspace, 'public', 'PLAYTEST_REPORT.json'),
              JSON.stringify(play, null, 2),
              'utf8',
            );
          } catch {
            /* report persist optional */
          }
          if (!play.ok && lastQuality.ok) {
            const softBaseline = gateTier.id === 'baseline';
            lastQuality = {
              ok: false,
              issues: [
                ...lastQuality.issues,
                softBaseline
                  ? `试玩 soft-fail (baseline): ending=${play.reachedEnding} depth≈${play.estimatedMinutes}m`
                  : `试玩智能体未达标: ending=${play.reachedEnding} ~${play.estimatedMinutes}m`,
              ],
            };
            await stream.emit('qa', 'QA', {
              tool: 'playtest-agent',
              summary: softBaseline
                ? `试玩 soft-fail（baseline 亦上报） ending=${play.reachedEnding} depth≈${contentMinutes}m`
                : `试玩未达标 ending=${play.reachedEnding}`,
              details: {
                ok: false,
                softFail: softBaseline,
                reachedEnding: play.reachedEnding,
                estimatedMinutes: play.estimatedMinutes,
                contentDepthMinutes: contentMinutes,
                stuckPoints: play.stuckPoints,
              },
            });
          }
        } catch (err) {
          await stream.emit('qa', 'QA', {
            tool: 'playtest-agent',
            summary: `playtest skipped: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // stash vision block for FIX 'attach via env-like closure
      (globalThis as { __ogVisionFix?: string }).__ogVisionFix = [
        visionBlock,
        requirementBlock,
      ]
        .filter(Boolean)
        .join('\n\n');

      if (!quality.ok) {
        const maybeNarrative = quality.issues.some((i) =>
          /叙事门禁|体验门禁|STORY_BIBLE|CONTENT_GRAPH|chapter_01|DialogueManager|ContentDirector/i.test(
            i,
          ),
        );
        if (maybeNarrative) {
          try {
            const { healNarrativeArtifacts, narrativeHealChanged } =
              await import('./narrativeHeal.js');
            const heal = await healNarrativeArtifacts(workspace, {
              archetype: gateArchetype ? String(gateArchetype) : undefined,
            });
            if (narrativeHealChanged(heal)) {
              await syncPublicAssetsToDist(workspace);
              await stream.emit('planner', 'PLAN', {
                summary: `叙事确定性治愈（${heal.healedFiles.length} 章${heal.graphRewritten ? ' + CONTENT_GRAPH' : ''}${heal.directorRewritten ? ' + ContentDirector' : ''}）`,
                details: heal,
              });
              const healedQuality = await runGameQualityGate(workspace, qaMode, {
                archetype: gateArchetype,
              });
              lastQuality = healedQuality;
              if (healedQuality.ok) {
                await stream.emit('qa', 'QA', {
                  tool: 'game-quality-gate',
                  summary: '内容质量门禁通过（叙事确定性治愈后）',
                  details: {
                    issues: [],
                    archetype: gateArchetype,
                    healed: true,
                  },
                });
              }
            }
          } catch {
            /* best-effort heal */
          }
        }
      }
      if (!lastQuality.ok) {
        const quality = lastQuality;
        await stream.emit('qa', 'QA', {
          tool: 'game-quality-gate',
          summary: '内容质量门禁未通过',
          details: { issues: quality.issues, archetype: gateArchetype },
        });
        const issueKey = quality.issues.slice().sort().join('|');
        const repeatIssues =
          lastQualityIssueKey !== null && lastQualityIssueKey === issueKey;
        lastQualityIssueKey = issueKey;

        const intentStuck = quality.issues.some((i) =>
          i.includes('ChangePlan'),
        );
        const narrativeStuck = quality.issues.some((i) =>
          /叙事门禁|体验门禁|STORY_BIBLE|CONTENT_GRAPH|chapter_01|DialogueManager|ContentDirector/i.test(
            i,
          ),
        );
        const assetHeavy = issuesNeedAssetRegen(quality.issues);
        const artStyleStuck = quality.issues.some((i) =>
          /ChangePlan artStyle|ASSET_FINGERPRINT|指纹|哈希/i.test(i),
        );
        const juiceStuck = quality.issues.some((i) => /Juice/i.test(i));
        // Requested mechanics live in Scene code, so they patch like scenes.
        const requirementStuck = quality.issues.some((i) =>
          i.startsWith('需求未落地'),
        );
        const sceneHeavy =
          requirementStuck ||
          quality.issues.some(
            (i) =>
              /ChangePlan addBoss|ChangePlan harder|ChangePlan addDialogue|ChangePlan editLevel|ChangePlan targetScene|scene|Scene|Boss|scene-contract|dialogue|Dialogue/i.test(
                i,
              ) && !/artStyle|disk|ArtDirector|authenticity|指纹|哈希/i.test(i),
          );

        let fixStrategy: 'asset-only' | 'scene-patch' | 'abort' | 'full' =
          'full';
        if (repeatIssues && intentStuck && attempt >= 2) {
          fixStrategy = 'abort';
        } else if (repeatIssues && requirementStuck && attempt >= 3) {
          // Two rounds have failed to land the mechanic the same way. Keep the
          // playable draft and tell the user, rather than spending the rest of
          // the budget on an ask the coder cannot seem to satisfy.
          fixStrategy = 'abort';
        } else if (
          repeatIssues &&
          narrativeStuck &&
          attempt >= Math.max(4, Math.min(maxFixIterations, 5))
        ) {
          // Give narrative jobs more heal rounds before aborting (budget exists).
          fixStrategy = 'abort';
        } else if (artStyleStuck || (repeatIssues && assetHeavy && !sceneHeavy)) {
          fixStrategy = 'asset-only';
        } else if (
          changePlan?.addDialogue ||
          changePlan?.editLevel ||
          changePlan?.targetSceneId
        ) {
          fixStrategy = 'scene-patch';
        } else if (repeatIssues && (sceneHeavy || juiceStuck)) {
          fixStrategy = 'scene-patch';
        } else if (narrativeStuck) {
          fixStrategy = 'full';
        } else if (assetHeavy || artStyleStuck) {
          fixStrategy = 'asset-only';
        } else if (sceneHeavy || juiceStuck) {
          fixStrategy = 'scene-patch';
        }

        if (fixStrategy === 'abort') {
          const {
            buildChangePlanAbortRecovery,
            buildNarrativeQualityRecovery,
            buildRequirementGapRecovery,
            formatRecoveryLogMessage,
            writeJobRecovery,
          } = await import('./jobRecovery.js');
          const recovery =
            requirementStuck && !intentStuck
              ? buildRequirementGapRecovery(quality.issues)
              : narrativeStuck && !intentStuck
                ? buildNarrativeQualityRecovery(quality.issues)
                : buildChangePlanAbortRecovery(changePlan, quality.issues);
          try {
            await writeJobRecovery(workspace, recovery);
            await syncPublicAssetsToDist(workspace);
          } catch {
            /* best-effort */
          }
          const userMsg = formatRecoveryLogMessage(recovery);
          // Soft-ship: if a playable draft is already live, stop empty FIX loops
          // without failing the whole job 'keep the draft, surface recovery tips.
          if (deliveredPlayable) {
            await stream.emit('qa', 'QA', {
              tool: 'game-quality-gate',
              summary: narrativeStuck && !intentStuck
                ? '叙事门禁未完全收敛 — 保留已交付可玩草稿，停止空转 FIX'
                : 'ChangePlan 未完全收敛 — 保留已交付可玩草稿，停止空转 FIX',
              details: {
                issues: quality.issues,
                changePlan: changePlan?.summary,
                fixStrategy: 'soft-ship',
                recovery,
                deliveredPlayable: true,
              },
            });
            await stream.emit('planner', 'PLAN', {
              summary:
                '提质软停：可玩草稿继续可用；可按建议提示继续对话迭代',
              details: {
                suggestedPrompts: recovery.suggestedPrompts?.slice(0, 4),
                kind: recovery.kind,
              },
            });
            break;
          }
          await stream.emit('qa', 'QA', {
            tool: 'game-quality-gate',
            summary: narrativeStuck && !intentStuck
              ? '叙事门禁连续未满足，停止空转 FIX'
              : 'ChangePlan 连续未满足，停止空转 FIX',
            details: {
              issues: quality.issues,
              changePlan: changePlan?.summary,
              fixStrategy,
              recovery,
            },
          });
          await stream.emit('system', 'FAIL', {
            summary: recovery.userSummary.slice(0, 280),
            details: {
              suggestedPrompts: recovery.suggestedPrompts,
              kind: recovery.kind,
            },
          });
          throw new Error(userMsg);
        }

        // Deterministic scene contracts before asking LLM again
        if (
          changePlan &&
          (fixStrategy === 'scene-patch' || sceneHeavy || juiceStuck)
        ) {
          const contracts = await ensureChangePlanSceneContracts(
            workspace,
            changePlan,
          );
          if (contracts.patches.length) {
            await stream.emit('planner', 'PLAN', {
              summary: `FIX 策略：Scene 意图契约补丁（${contracts.patches.length}）`,
              details: { patches: contracts.patches, fixStrategy },
            });
          }
        }

        // Phase-36: juice restore from baseline on FIX (even without ChangePlan)
        if (juiceStuck || fixStrategy === 'scene-patch') {
          try {
            const { restoreJuiceFromBaseline } = await import(
              './juiceBaseline.js'
            );
            const juiceRestore = await restoreJuiceFromBaseline(workspace);
            if (juiceRestore.patches.length) {
              await stream.emit('planner', 'PLAN', {
                summary: `FIX 策略：Juice 基线恢复（${juiceRestore.restored.length}）`,
                details: {
                  restored: juiceRestore.restored,
                  patches: juiceRestore.patches,
                  fixStrategy,
                },
              });
            }
          } catch {
            // non-fatal; LLM FIX hint still applies
          }
        }

        if (fixStrategy === 'asset-only' || assetHeavy || artStyleStuck) {
          await stream.emit('artist', 'ASSET', {
            summary:
              fixStrategy === 'asset-only' && repeatIssues
                ? 'FIX 策略：仅重生资产'
                : '质量门禁触发资产重生（ALLOW_ASSET_FIX)',
            details: {
              fixStrategy,
              issues: quality.issues.filter(
                (i) =>
                  i.includes('disk') ||
                  i.includes('ArtDirector') ||
                  /authenticity/i.test(i) ||
                  /ChangePlan artStyle/i.test(i),
              ),
            },
          });
          // Default: MiniMax deterministic pack only. CLI ASSET doubles token spend.
          const cliAsset =
            process.env['PLATFORM_ENABLE_CLI_ASSET'] === 'true' ||
            process.env['PLATFORM_ENABLE_CLI_ASSET'] === '1';
          if (cliAsset) {
            await runAssetPhase({
              prompt: buildAssetRepairPrompt(prompt, quality.issues),
              stream,
              invokeCli: invokeCliBound,
            });
          }
          await runGameAssetPhase(workspace, {
            force: true,
            styleOverride: changePlan?.artStyle ?? undefined,
            referenceImageHints: [
              ...(changePlan?.referenceImageHints ?? []),
              ...persistedRefs,
            ],
          });
          await syncPublicAssetsToDist(workspace);
        }

        if (attempt >= 2) {
          const qualityFix = await buildQualityFixPrompt({
            baseUserPrompt: prompt,
            issues: quality.issues,
            workspace,
            repeatIssues,
            preferScenePatch: fixStrategy === 'scene-patch',
          });
          currentPrompt = leanFix(qualityFix);
        } else {
          currentPrompt = leanFix(formatQualityFailureForPrompt(quality));
        }
        continue;
      }
      // CODE 之后再挂一次 game.json（CLI 可能覆盖了早期 assets[]）
      try {
        const wired = await runGameAssetPhase(workspace, { patchOnly: true });
        if (!wired.patchedGameJson) {
          // Fill missing slots only — never blanket-force under requireRealAssets.
          await runGameAssetPhase(workspace, {});
        }
        // Preview uploads dist/ — sync public assets after late patch
        const synced = await syncPublicAssetsToDist(workspace);
        if (synced.length > 0) {
          await stream.emit('artist', 'ASSET', {
            summary: `已同步真资产到 dist（${synced.length}）`,
            details: { files: synced.slice(0, 24) },
          });
        }
      } catch (err) {
        if (requireRealAssets()) throw err;
      }
      await stream.emit('qa', 'QA', {
        tool: 'game-quality-gate',
        summary: `内容质量门禁通过（${gateTier.label}）`,
        details: {
          ok: true,
          issues: [],
          archetype: gateArchetype,
          gateTier: gateTier.id,
        },
      });
      try {
        const { writeJuiceBaseline } = await import('./juiceBaseline.js');
        const baseline = await writeJuiceBaseline(workspace);
        if (baseline) {
          await stream.emit('qa', 'QA', {
            tool: 'juice-baseline',
            summary: `Juice 基线已锁定（${baseline.scenes.length} Scene）`,
            details: { scenes: baseline.scenes },
          });
        }
      } catch {
        // optional
      }

      // Ship now. Escalation rounds publish again; a failed escalation can
      // never revoke a preview the user is already playing.
      const smokeOk = lastSmoke?.ok !== false;
      const firstDelivery = !deliveredPlayable;
      // Never claim first-delivery playable when smoke failed.
      const claimPlayable = smokeOk || deliveredPlayable;
      lastPublish = await publishGeneratedDist({
        db,
        s3,
        env,
        projectId,
        jobId,
        workspace,
        gameParams: payload.gameParams,
        cliStdout: lastCliResult.stdout,
        fsmAttempts: attempt,
        gateTier,
      });
      if (claimPlayable) {
        deliveredTier = gateTier;
        deliveredPlayable = true;
      }
      const tierReached = gateTiersEqual(gateTier, targetTier);
      await stream.emit('system', 'PREVIEW', {
        summary: !claimPlayable
          ? '预览已部署，但冒烟未通过 — 可能不可玩'
          : firstDelivery
            ? tierReached
              ? '可玩预览已部署'
              : '可玩预览已部署 — 现在继续提质（不影响你先玩）'
            : `提质版预览已更新（${gateTier.label}）`,
        details: {
          deploymentId: lastPublish.deploymentId,
          artifactId: lastPublish.artifactId,
          entryKey: lastPublish.entryKey,
          gateTier: gateTier.id,
          playable: claimPlayable,
          smokeOk,
          escalating: claimPlayable && !tierReached,
          attempt,
        },
      });
      if (tierReached && claimPlayable) {
        success = true;
        break;
      }
      if (!claimPlayable) {
        break;
      }
      lastQualityIssueKey = null;
      currentPrompt = leanFix(
        formatQualityEscalationPrompt({
          userPrompt: prompt,
          tier: targetTier,
          issues: [],
        }),
      );
      continue;
    }
    currentPrompt = leanFix(summarizeBuildFailure(lastValidate));
    } finally {
      restoreGateTierEnv(tierEnvSnapshot);
    }
  }

  // Progressive delivery: an already-published playable build is a success even
  // if the escalation rounds ran out of attempts or wall-clock budget.
  const deliveredWithoutTargetTier =
    !success && deliveredPlayable && lastPublish !== null;
  if (deliveredWithoutTargetTier) {
    success = true;
    await stream.emit('planner', 'PLAN', {
      summary: budgetExhausted
        ? `已达时间预算 '交付基线可玩版（未达${targetTier.label}」，可继续对话提质）`
        : `自愈轮次用尽 '交付基线可玩版（未达${targetTier.label}」，可继续对话提质）`,
      details: {
        deliveredTier: deliveredTier?.id ?? null,
        targetTier: targetTier.id,
        attempts: attempt,
        budgetExhausted,
      },
    });
  }

  if (success && lastCliResult?.exitCode === 0) {
    await captureCliSessionAfterRun(workspace, job.sessionId);
    try {
      const assetCount = await syncWorkspaceAssetsToDb({
        db,
        s3,
        env,
        projectId,
        jobId,
        workspace,
      });
      if (assetCount > 0) {
        await stream.emit('artist', 'DONE', {
          summary: `已登${assetCount} 个资产到项目画廊`,
          details: { assetCount },
        });
      }
    } catch (err) {
      await stream.emit('artist', 'DONE', {
        summary: '资产登记失败（非致命）',
        details: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // 把最后一轮 CLI + 构建日志合并写到 S3，作为 job.logKey
  const logBody = buildGenerateAttemptLogBody({
    attempt,
    maxAttempts: maxFixIterations,
    success,
    lastQuality,
    lastCliResult,
    lastValidate,
  });
  const logKey = await uploadJobLog(s3, env, projectId, jobId, logBody);
  await db.update(jobs).set({ logKey, updatedAt: new Date() }).where(eq(jobs.id, jobId));

  if (!success || !lastValidate || !lastCliResult) {
    const cliText = lastCliResult
      ? `${lastCliResult.stdout}\n${lastCliResult.stderr}`
      : '';
    const quotaErr = detectLlmQuotaError(cliText);
    if (quotaErr) {
      await failGenerateWithLog(
        s3,
        env,
        projectId,
        jobId,
        formatLlmQuotaErrorSummary(quotaErr),
        logBody,
      );
      return;
    }
    const budgetNote = budgetExhausted
      ? `已达生成时间预算 ${Math.round(timeBudgetMs / 1000)}s；`
      : stoppedForConsecutiveTimeouts
        ? `连续 ${consecutiveHardTimeouts} 轮 CLI 硬超时已中止；`
        : '';
    const reason =
      lastCliResult?.exitCode === 124
        ? `OpenGame CLI 硬超时已终止（本轮上限见 PLATFORM_CLI_TIMEOUT_MS；首轮超时后会整轮重试 CODE，不再用短 FIX 空转）`
        : lastSmoke && !lastSmoke.ok && (!lastQuality || lastQuality.ok)
          ? `运行时冒烟未通过：${lastSmoke.issues.slice(0, 3).join('; ') || '见完整日志'}`
          : lastValidate?.ok && lastQuality && !lastQuality.ok
            ? `内容门禁未通过：${lastQuality.issues.slice(0, 3).join('; ')}`
            : lastValidate && !lastValidate.ok
              ? 'TypeScript 编译 / Vite 构建未通过'
              : lastValidate?.ok && !lastQuality
                ? '构建已通过但未完成门禁/交付（见完整日志）'
                : 'CLI 或验证未完成';
    const summary = `生成失败（已尝试 ${attempt}/${maxFixIterations} 轮）。${budgetNote}${reason}`;
    if (lastQuality && !lastQuality.ok) {
      try {
        const {
          buildNarrativeQualityRecovery,
          buildChangePlanAbortRecovery,
          writeJobRecovery,
        } = await import('./jobRecovery.js');
        const narrative = lastQuality.issues.some((i) =>
          /叙事门禁|STORY_BIBLE|chapter_01/i.test(i),
        );
        const recovery = narrative
          ? buildNarrativeQualityRecovery(lastQuality.issues)
          : buildChangePlanAbortRecovery(changePlan, lastQuality.issues);
        await writeJobRecovery(workspace, recovery);
        await stream.emit('system', 'FAIL', {
          summary: recovery.userSummary.slice(0, 280),
          details: {
            suggestedPrompts: recovery.suggestedPrompts,
            kind: recovery.kind,
            message: summary,
          },
        });
      } catch {
        /* best-effort */
      }
    }
    await failGenerateWithLog(s3, env, projectId, jobId, summary, logBody);
    return;
  }

  if (!lastPublish) {
    await failGenerateWithLog(
      s3,
      env,
      projectId,
      jobId,
      '生成结束但未产出可部署预览（内部状态异常）',
      logBody,
    );
    return;
  }

  await stream.emit('qa', 'QA', {
    summary: '基础 QA 通过：dist/ 存在，构建退出码 0',
  });

  const { entryKey, buildCacheKey, codeChanges } = lastPublish;
  const jobResult = {
    codeChanges,
    fileCount: codeChanges.length,
    fsmAttempts: attempt,
    generatedAt: new Date().toISOString(),
    isIteration,
    workspaceSummary: workspaceSummary.summaryText,
    pipelineArchetype: pipelineCtx?.archetype ?? null,
    contentHash: buildCacheKey,
    gateTier: deliveredTier?.id ?? null,
    targetGateTier: targetTier.id,
    reachedTargetGateTier: deliveredTier
      ? gateTiersEqual(deliveredTier, targetTier)
      : false,
  };
  await db
    .update(jobs)
    .set({
      status: 'succeeded',
      updatedAt: new Date(),
      buildCacheKey,
      result: jobResult,
    })
    .where(eq(jobs.id, jobId));
  await db.insert(usageEvents).values({
    organizationId,
    jobId,
    modality: 'generate',
    units: '1',
    meta: {
      jobType: 'generate',
      contentHash: buildCacheKey ?? null,
      fsmAttempts: attempt,
      ms: Date.now() - fsmStart,
    },
  });
  await stream.emit('system', 'CURATE', {
    summary: '更新项目简报与会话摘要',
  });
  await finalizeAgentContext(db, {
    jobId,
    projectId,
    organizationId,
    sessionId: job.sessionId,
    userPrompt: prompt,
    success: true,
    conversationTurns,
    summaryTurns,
    workspaceSummary: workspaceSummary.summaryText,
    pipelineArchetype: pipelineCtx?.archetype ?? null,
    layers: agentCtx.layers,
  });
  await appendSessionTimeline(
    db,
    job.sessionId,
    changePlan
      ? `本轮已应用：${changePlan.summary}。预览已更新，可继续用自然语言改难Boss/画风。`
      : `生成完成，预览已更新。可用自然语言继续改玩法或画风。`,
  );

  // P4: snapshot the workspace so the next job for this project can be picked
  // up by *any* worker in the pool. Best-effort; failure here doesn't fail the
  // generate job because the user already has a working preview.
  if (env.workspaceArchiveKeyPrefix) {
    try {
      const archiveResult = await saveWorkspaceToS3(s3, env, projectId, workspace);
      if (archiveResult) {
        await stream.emit('system', 'DONE', {
          summary: '工作区快照已上传S3',
          details: archiveResult,
        });
      }
    } catch (err) {
      await stream.emit('system', 'DONE', {
        summary: '工作区快照上传失败（非致命，下次将从骨架重建',
        details: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  await stream.emit('system', 'DONE', {
    summary: `生成成功（共 ${attempt} 次尝试），耗时 ${Date.now() - fsmStart}ms`,
    details: { attempts: attempt, entryKey },
    elapsedMs: Date.now() - fsmStart,
  });
}

