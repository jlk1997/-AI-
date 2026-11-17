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
import { applyPinnedTemplateToWorkspace } from './templatePackageApply.js';
import { honorRescaffoldRequest } from './workspaceRescaffold.js';
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

export function readMaxFixIterations(
  changePlan?: {
    addDialogue?: boolean;
    editLevel?: boolean;
    targetSceneId?: string | null;
  } | null,
  archetype?: string | null,
): number {
  const raw = process.env['PLATFORM_MAX_FIX_ITERATIONS'];
  if (raw?.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1 && n <= 12) {
      const base = Math.floor(n);
      // Narrative jobs get +1 over env when budget allows.
      if (
        (archetype === 'ui_heavy' || archetype === 'top_down' || changePlan?.addDialogue) &&
        base < 12
      ) {
        return Math.min(12, base + 1);
      }
      return base;
    }
  }
  // Narrative / scene-targeted edits need a slightly longer FIX budget.
  if (
    archetype === 'ui_heavy' ||
    archetype === 'top_down' ||
    changePlan?.addDialogue ||
    changePlan?.editLevel ||
    changePlan?.targetSceneId
  ) {
    return 5;
  }
  return 2;
}

export function envOff(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === 'false' || v === '0';
}

/**
 * Publish the freshly scaffolded workspace before the Agent writes a line, so a
 * job that later burns its whole budget on CODE/FIX still leaves the user with
 * something they can open and move around in.
 */
export function earlySkeletonPreviewEnabled(): boolean {
  return !envOff('PLATFORM_EARLY_SKELETON_PREVIEW');
}

/**
 * Run the MiniMax asset phase alongside the first CODE round instead of ahead of
 * it. The art takes minutes and the Agent does not need the PNGs on disk to
 * write scenes — it only needs the agreed asset keys, which the contract fixes.
 */
export function assetPhaseParallelWithCodeEnabled(): boolean {
  return !envOff('PLATFORM_ASSET_PARALLEL_CODE');
}

/** Non-interactive CLI must allow shell in yolo; auto-edit blocks run_shell_command. */
export function readCliApprovalMode(): 'yolo' | 'auto-edit' | 'default' | 'plan' {
  const v = process.env['PLATFORM_CLI_APPROVAL_MODE']?.trim().toLowerCase();
  if (v === 'auto-edit' || v === 'default' || v === 'plan' || v === 'yolo') {
    return v;
  }
  return 'yolo';
}

/**
 * Bench commands can stream arbitrary logs to stdout but must conclude with a
 * single JSON object summarizing the scores. We scan from the end so that
 * upstream loggers don't pollute the parse 'the contract is "last line that
 * starts with '{' wins".
 */
export function parseBenchScores(stdout: string): Record<string, unknown> {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]?.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore and keep scanning earlier lines
    }
  }
  return {};
}

export interface ProcessJobOptions {
  readonly publisher?: Redis;
}

export function mergeChildEnv(
  base: NodeJS.ProcessEnv,
  gameTemplatesDir: string,
  gameDocsDir: string,
): NodeJS.ProcessEnv {
  return {
    ...base,
    GEMINI_SANDBOX: base['GEMINI_SANDBOX'] ?? 'false',
    GAME_TEMPLATES_DIR: gameTemplatesDir,
    GAME_DOCS_DIR: gameDocsDir,
  };
}

export async function uploadJobLog(
  client: S3Client,
  env: WorkerEnv,
  projectId: string,
  jobId: string,
  body: string,
): Promise<string> {
  const key = `projects/${projectId}/jobs/${jobId}/log.txt`;
  await putObjectUtf8(client, env, key, body, 'text/plain; charset=utf-8');
  return key;
}

export interface GenerateAttemptLogInput {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly success: boolean;
  readonly lastQuality: Awaited<ReturnType<typeof runGameQualityGate>> | null;
  readonly lastCliResult: RunProcessResult | null;
  readonly lastValidate: ValidateBuildResult | null;
}

export function buildGenerateAttemptLogBody(input: GenerateAttemptLogInput): string {
  const { attempt, maxAttempts, success, lastQuality, lastCliResult, lastValidate } = input;
  return [
    `attempts=${attempt}`,
    `maxAttempts=${maxAttempts}`,
    `success=${success}`,
    '--- last quality gate ---',
    lastQuality
      ? `ok=${lastQuality.ok}\n${lastQuality.issues.map((i) => `- ${i}`).join('\n')}`
      : '<not run>',
    '--- last CLI stdout ---',
    lastCliResult?.stdout ?? '',
    '--- last CLI stderr ---',
    lastCliResult?.stderr ?? '',
    '--- last typecheck ---',
    `exit=${lastValidate?.typecheck.exitCode ?? 'n/a'}`,
    lastValidate?.typecheck.stdout ?? '',
    lastValidate?.typecheck.stderr ?? '',
    '--- last build ---',
    `exit=${lastValidate?.build.exitCode ?? 'n/a'}`,
    lastValidate?.build.stdout ?? '',
    lastValidate?.build.stderr ?? '',
  ].join('\n');
}

export async function failGenerateWithLog(
  s3: S3Client,
  env: WorkerEnv,
  projectId: string,
  jobId: string,
  summary: string,
  logBody: string,
): Promise<never> {
  const s3Key = await uploadJobLog(s3, env, projectId, jobId, logBody);
  throw new Error(composeJobLogKey(summary, s3Key));
}

export async function throwIfCliQuotaFailure(
  cliResult: RunProcessResult,
  s3: S3Client,
  env: WorkerEnv,
  projectId: string,
  jobId: string,
  logBody: string,
  options?: {
    readonly rotationTrail?: readonly AgentKeyAttemptFailure[];
  },
): Promise<void> {
  const trail = options?.rotationTrail ?? [];
  if (trail.length > 0) {
    await failGenerateWithLog(
      s3,
      env,
      projectId,
      jobId,
      formatAgentKeyRotationSummary(trail),
      logBody,
    );
  }
  const quotaErr = detectLlmQuotaError(`${cliResult.stdout}\n${cliResult.stderr}`);
  if (!quotaErr) return;
  await failGenerateWithLog(
    s3,
    env,
    projectId,
    jobId,
    formatLlmQuotaErrorSummary(quotaErr),
    logBody,
  );
}

/** Binds chat UI to platform jobs without re-parsing OpenGame stdout (full transcript stays in S3 logs). */
// appendSessionTimeline lives in ./sessionTimeline.js

export interface ValidateBuildResult {
  readonly ok: boolean;
  readonly typecheck: RunProcessResult;
  readonly build: RunProcessResult;
  /** Which steps the fingerprint cache served instead of running. */
  readonly cached?: 'typecheck' | 'all';
}

export interface GameDslCheck {
  readonly path: string;
  readonly present: boolean;
  readonly errors: string[];
}

/**
 * Soft-validates `public/game.json` (or `game.json` at the root) after a CODE
 * pass. Failure here doesn't immediately abort 'we feed the errors back into
 * the next FIX iteration so the AI can repair the DSL itself.
 *
 * The validator is intentionally inlined rather than imported from
 * `@opengame/runtime` to keep the worker decoupled from runtime release
 * tagging (the worker may run against several runtime versions at once).
 */
export function checkGameDsl(workspace: string): GameDslCheck {
  const candidates = [
    path.join(workspace, 'public', 'game.json'),
    path.join(workspace, 'game.json'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    return {
      path: candidates[0]!,
      present: false,
      errors: ['game.json missing (expected at public/game.json)'],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(found, 'utf8'));
  } catch (e) {
    return {
      path: found,
      present: true,
      errors: [`game.json is not valid JSON: ${(e as Error).message}`],
    };
  }
  const errors: string[] = [];
  const obj = parsed as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') {
    return { path: found, present: true, errors: ['game.json must be a JSON object'] };
  }
  if (typeof obj['dslVersion'] !== 'string') errors.push('dslVersion missing');
  const meta = obj['meta'] as Record<string, unknown> | undefined;
  if (!meta || typeof meta['title'] !== 'string') errors.push('meta.title required');
  const scenes = obj['scenes'];
  if (!Array.isArray(scenes) || scenes.length === 0) {
    errors.push('scenes must be a non-empty array');
  }
  return { path: found, present: true, errors };
}

export function getGameWorkspaceRuntimeSpec(workspace: string): string | null {
  try {
    const pkgPath = path.join(workspace, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const v = pkg.dependencies?.['@opengame/runtime']?.trim();
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Resolves `file:` dependency specs (including `file:../../packages/runtime`). */
export function resolveFileDependencyDir(spec: string, baseDir: string): string | null {
  const s = spec.trim();
  if (!s.startsWith('file:')) return null;
  try {
    const base = pathToFileURL(path.join(baseDir, 'package.json')).href;
    const u = new URL(s, base);
    if (u.protocol !== 'file:') return null;
    return fileURLToPath(u);
  } catch {
    return null;
  }
}

/**
 * Busts standalone-build cache when linked runtime dist changes (mtime/size).
 * Uses `dist/bootstrap.js` because that file always changes when bootstrap logic ships.
 */
export function runtimeDistBootstrapFingerprint(workspace: string): string {
  const spec = getGameWorkspaceRuntimeSpec(workspace);
  const nmBootstrap = path.join(
    workspace,
    'node_modules',
    '@opengame',
    'runtime',
    'dist',
    'bootstrap.js',
  );
  let target = nmBootstrap;
  if (spec) {
    const linked = resolveFileDependencyDir(spec, workspace);
    if (linked) {
      const p = path.join(linked, 'dist', 'bootstrap.js');
      if (fs.existsSync(p)) target = p;
    }
  }
  try {
    const st = fs.statSync(target);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return 'missing';
  }
}

/**
 * `file:`-linked `@opengame/runtime` points `types` at `dist/index.d.ts`. A fresh
 * monorepo checkout often has no `dist/` until `npm run build` inside the
 * runtime package 'without it, `tsc` reports "Cannot find module".
 *
 * When the game depends on a **local `file:` runtime** (typical monorepo dev),
 * we **always** run `npm run build` in that package before typecheck/vite so the
 * preview bundle picks up the latest `bootstrap` / DSL fixes. Otherwise devs can
 * rebuild `@opengame/runtime` at the repo root but still ship an old `index-*.js`
 * from a previous vite pass. Opt out: `PLATFORM_RUNTIME_SKIP_EAGER_BUILD=1`.
 */
export async function ensureLinkedOpenGameRuntimeBuilt(
  workspace: string,
  childEnv: NodeJS.ProcessEnv,
): Promise<RunProcessResult | null> {
  const skipEager = process.env['PLATFORM_RUNTIME_SKIP_EAGER_BUILD']?.trim() === '1';
  const spec = getGameWorkspaceRuntimeSpec(workspace);
  const linkedDir =
    spec && spec.startsWith('file:') ? resolveFileDependencyDir(spec, workspace) : null;
  if (!skipEager && linkedDir && fs.existsSync(path.join(linkedDir, 'package.json'))) {
    // The linked runtime is a monorepo package that does not change between FIX
    // rounds 'rebuilding it every validate was ~30s of pure repetition.
    if (linkedRuntimeBuildIsFresh(linkedDir)) {
      return null;
    }
    const built = await runShellCommand('npm run build', {
      cwd: linkedDir,
      env: childEnv,
    });
    if (built.exitCode === 0) {
      recordLinkedRuntimeBuild(linkedDir);
    }
    return built;
  }

  const runtimeNm = path.join(workspace, 'node_modules', '@opengame', 'runtime');
  const pkgJson = path.join(runtimeNm, 'package.json');
  const distTypes = path.join(runtimeNm, 'dist', 'index.d.ts');
  if (!fs.existsSync(pkgJson) || fs.existsSync(distTypes)) {
    return null;
  }
  let cwd = runtimeNm;
  try {
    cwd = fs.realpathSync(runtimeNm);
  } catch {
    // keep runtimeNm
  }
  const install = await runShellCommand('npm install --no-audit --no-fund', {
    cwd,
    env: childEnv,
  });
  if (install.exitCode !== 0) {
    return install;
  }
  return runShellCommand('npm run build', { cwd, env: childEnv });
}

/** Written on each validate so Coder edits to tsconfig.json cannot widen `include` to stale src files. */
const WORKER_TSCONFIG_NAME = 'tsconfig.opengame-worker.json';

export function resolveGameEntryTsForOverlay(workspace: string): string {
  if (fs.existsSync(path.join(workspace, 'src', 'main.ts'))) {
    return 'src/main.ts';
  }
  if (fs.existsSync(path.join(workspace, 'main.ts'))) {
    return 'main.ts';
  }
  return 'src/main.ts';
}

export async function writeWorkerTsconfigOverlay(workspace: string): Promise<void> {
  const entry = resolveGameEntryTsForOverlay(workspace);
  const overlayPath = path.join(workspace, WORKER_TSCONFIG_NAME);
  const basePath = path.join(workspace, 'tsconfig.json');
  if (!fs.existsSync(basePath)) {
    await fsp.writeFile(
      overlayPath,
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: false,
            skipLibCheck: true,
            noEmit: true,
          },
          include: [entry],
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    return;
  }
  await fsp.writeFile(
    overlayPath,
    JSON.stringify(
      {
        extends: './tsconfig.json',
        include: [entry],
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

export async function runGameWorkspaceTypecheck(
  workspace: string,
  childEnv: NodeJS.ProcessEnv,
): Promise<RunProcessResult> {
  await writeWorkerTsconfigOverlay(workspace);
  const tscJs = path.join(workspace, 'node_modules', 'typescript', 'lib', 'tsc.js');
  if (!fs.existsSync(tscJs)) {
    return runShellCommand('npm run typecheck --if-present', {
      cwd: workspace,
      env: childEnv,
    });
  }
  return runArgv(
    [process.execPath, tscJs, '--noEmit', '-p', WORKER_TSCONFIG_NAME],
    { cwd: workspace, env: childEnv },
  );
}

/** `npm run build` often runs a second full-project `tsc` that ignores our overlay — call Vite directly after overlay typecheck. */
export async function runGameWorkspaceViteBuild(
  workspace: string,
  childEnv: NodeJS.ProcessEnv,
): Promise<RunProcessResult> {
  const viteJs = path.join(workspace, 'node_modules', 'vite', 'bin', 'vite.js');
  if (fs.existsSync(viteJs)) {
    return runArgv([process.execPath, viteJs, 'build'], {
      cwd: workspace,
      env: childEnv,
    });
  }
  return runShellCommand('npm run build', { cwd: workspace, env: childEnv });
}

/**
 * Runs `npm install` when node_modules is missing or critical deps are absent,
 * then **entry-only** `tsc` (via `tsconfig.opengame-worker.json`) + `vite build`.
 * The aggregated result is what the Self-Healer Agent inspects to decide on a FIX iteration.
 */
export async function validateBuild(
  workspace: string,
  childEnv: NodeJS.ProcessEnv,
): Promise<ValidateBuildResult> {
  const runInstall = async () =>
    runShellCommand('npm install --no-audit --no-fund', {
      cwd: workspace,
      env: childEnv,
    });

  const workspaceNeedsNpmInstall = (): boolean => {
    const nodeModules = path.join(workspace, 'node_modules');
    if (!fs.existsSync(nodeModules)) {
      return true;
    }
    if (!fs.existsSync(path.join(nodeModules, 'phaser'))) {
      return true;
    }
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const all = { ...pkg.dependencies, ...pkg.devDependencies };
      if (all['@opengame/runtime']) {
        const rt = path.join(nodeModules, '@opengame', 'runtime');
        if (!fs.existsSync(rt)) {
          return true;
        }
      }
    } catch {
      return true;
    }
    return false;
  };

  if (workspaceNeedsNpmInstall()) {
    const install = await runInstall();
    if (install.exitCode !== 0) {
      return {
        ok: false,
        typecheck: install,
        build: { exitCode: null, stdout: '', stderr: 'skipped' },
      };
    }
  }

  const runtimeBuild = await ensureLinkedOpenGameRuntimeBuilt(workspace, childEnv);
  if (runtimeBuild && runtimeBuild.exitCode !== 0) {
    return {
      ok: false,
      typecheck: runtimeBuild,
      build: { exitCode: null, stdout: '', stderr: 'skipped (runtime build)' },
    };
  }

  // A round that changed nothing (hard timeout, or a gate rejecting an edit the
  // CLI reverted) must not spend budget reproducing a byte-identical dist/.
  const buildKey = workspaceBuildKey(workspace);
  const skip = buildSkipDecision(workspace, buildKey);
  if (skip.skipBuild) {
    const note = 'cached: src/ + public/ unchanged since last green build';
    return {
      ok: true,
      typecheck: { exitCode: 0, stdout: note, stderr: '' },
      build: { exitCode: 0, stdout: note, stderr: '' },
      cached: 'all',
    };
  }

  let typecheck = skip.skipTypecheck
    ? {
        exitCode: 0,
        stdout: 'cached: src/ unchanged since last green typecheck',
        stderr: '',
      }
    : await runGameWorkspaceTypecheck(workspace, childEnv);

  if (typecheck.exitCode !== 0) {
    const combined = `${typecheck.stdout}\n${typecheck.stderr}`;
    const recoverable =
      combined.includes("Cannot find module 'phaser'") ||
      combined.includes('Cannot find module "phaser"') ||
      combined.includes("Cannot find module '@opengame/runtime'") ||
      combined.includes('Cannot find module "@opengame/runtime"');
    if (recoverable) {
      const reinstall = await runInstall();
      if (reinstall.exitCode === 0) {
        const rb = await ensureLinkedOpenGameRuntimeBuilt(workspace, childEnv);
        if (rb && rb.exitCode !== 0) {
          return {
            ok: false,
            typecheck: rb,
            build: { exitCode: null, stdout: '', stderr: 'skipped (runtime build)' },
          };
        }
        typecheck = await runGameWorkspaceTypecheck(workspace, childEnv);
      }
    }
  }

  if (typecheck.exitCode !== 0) {
    clearWorkspaceBuildCache(workspace);
    return {
      ok: false,
      typecheck,
      build: { exitCode: null, stdout: '', stderr: 'skipped' },
    };
  }
  const build = await runGameWorkspaceViteBuild(workspace, childEnv);
  const ok = build.exitCode === 0 && fs.existsSync(path.join(workspace, 'dist'));
  if (ok) {
    // Store the pre-build key: vite only writes into dist/, which the key
    // ignores, so re-reading it here would be the same hash for more IO.
    recordWorkspaceBuild(workspace, buildKey);
  } else {
    clearWorkspaceBuildCache(workspace);
  }
  return {
    ok,
    typecheck,
    build,
    ...(skip.skipTypecheck ? { cached: 'typecheck' as const } : {}),
  };
}

export function summarizeBuildFailure(result: ValidateBuildResult): string {
  // Tighter tails — the AI doesn't need 4KB of stack traces; the last 1.5KB
  // per stream is enough to localize most TS/vite errors and saves tokens.
  const tcTail = (result.typecheck.stderr.slice(-1500) + result.typecheck.stdout.slice(-1500)).trim();
  const buildTail = (result.build.stderr.slice(-1500) + result.build.stdout.slice(-1500)).trim();
  const tsArgHint =
    /TS2554/.test(tcTail) || /Expected \d+-\d+ arguments/.test(tcTail)
      ? '6. 若出现 TS2554「参数个数不对」：优先检查 Graphics.lineStyle 是否误写成只传颜色（应为 lineStyle(线宽, 颜色)）'
      : '';
  const tsOptionalAssignHint = /TS2779/.test(tcTail)
    ? '7. 若出现 TS2779「不能对 optional chaining 左侧赋值」：禁止 this.body?.checkCollision.down = true；改为 const body = this.body; if (body) body.checkCollision.down = true'
    : '';
  const tsNullHint =
    /TS2532/.test(tcTail) || /TS2531/.test(tcTail)
      ? '8. 若出现 TS2531/TS2532「可能为 null/undefined」：在使用前写 if (!x) return; 或非空断言'
      : '';
  const tsPluginHint =
    /TS2339/.test(tcTail) && /Plugin|plugins\.get/.test(tcTail)
      ? '9. 若 plugins.get 报 TS2339：不要依赖未注册 AttackPlugin；改为类内直接实现 attack/dash'
      : '';
  const tsVectorHint =
    /TS2741/.test(tcTail) && /Vector2Like/.test(tcTail)
      ? '10. Vector2Like 需要 x 与 y：例如 { x: 0, y: 0 }，不要只写 { y: ... }'
      : '';
  const lines = [
    '【自愈循环 / Self-heal】上一次构建失败，请遵循以下原则修复：',
    '1. 只改导致错误的最少文件；不要重写整个项目',
    '2. 保持 main.ts / vite.config.ts / tsconfig.json 与最小骨架一致；若出现 Cannot find module phaser / @opengame/runtime：先确认 game 工作区已 npm install',
    '2b. 若 public/game.json 有 scenes[].customModule：检查 src/main.ts 是否 static import 对应 Scene 类，并在 bootstrap 传入 extraScenes',
    '3. 优先调用 @opengame/runtime 暴露的能力（HUD / ChoicePanel / Behaviors / SkillChain）',
    '4. 修复后再次输出 public/game.json 全文（确保 DSL 合法）',
    '5. 平台 Worker 使用 tsconfig.opengame-worker.json：仅对 src/main.ts 做类型检查',
  ];
  if (tsArgHint) lines.push(tsArgHint);
  if (tsOptionalAssignHint) lines.push(tsOptionalAssignHint);
  if (tsNullHint) lines.push(tsNullHint);
  if (tsPluginHint) lines.push(tsPluginHint);
  if (tsVectorHint) lines.push(tsVectorHint);
  lines.push(
    '',
    '--- typecheck (tail) ---',
    tcTail || '<empty>',
    '--- build (tail) ---',
    buildTail || '<empty>',
  );
  return lines.join('\n');
}

export interface GenerateInvocation {
  readonly prompt: string;
  readonly workspace: string;
  readonly childEnv: NodeJS.ProcessEnv;
  readonly cliJs: string;
  readonly resumeSessionId?: string;
  readonly onStdoutChunk?: (chunk: string) => void;
  /** Overrides `PLATFORM_CLI_TIMEOUT_MS` (FIX rounds get a shorter leash). */
  readonly timeoutMs?: number;
  readonly abortSignal?: AbortSignal;
}

export class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`用户已中止任务（${jobId})`);
    this.name = 'JobCancelledError';
  }
}

export async function readJobStatus(
  db: DrizzleDb,
  jobId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  return row?.status ?? null;
}

export async function assertJobNotCancelled(db: DrizzleDb, jobId: string): Promise<void> {
  const status = await readJobStatus(db, jobId);
  if (status === 'cancelled') {
    throw new JobCancelledError(jobId);
  }
}

/** Poll DB so user cancel aborts an in-flight CLI; bump updatedAt as a liveness beat. */
export function startJobCancelWatch(
  db: DrizzleDb,
  jobId: string,
  abort: AbortController,
  intervalMs = 2000,
): () => void {
  let stopped = false;
  let lastBeatAt = 0;
  const tick = async () => {
    if (stopped || abort.signal.aborted) return;
    try {
      const status = await readJobStatus(db, jobId);
      if (status === 'cancelled') {
        abort.abort();
        return;
      }
      if (status === 'running' && Date.now() - lastBeatAt >= 15_000) {
        lastBeatAt = Date.now();
        await db
          .update(jobs)
          .set({ updatedAt: new Date() })
          .where(eq(jobs.id, jobId));
      }
    } catch {
      // ignore transient DB errors
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export async function invokeOpenGameCli(
  inv: GenerateInvocation,
): Promise<RunProcessResult> {
  const approvalMode = readCliApprovalMode();
  const argv: string[] = [
    process.execPath,
    inv.cliJs,
    '--approval-mode',
    approvalMode,
    '--chat-recording',
    'true',
  ];
  if (inv.resumeSessionId) {
    argv.push('--resume', inv.resumeSessionId);
  }
  argv.push('--prompt', inv.prompt);
  const timeoutMs =
    inv.timeoutMs && inv.timeoutMs > 0 ? inv.timeoutMs : readBaseCliTimeoutMs();
  return runArgv(argv, {
    cwd: inv.workspace,
    env: inv.childEnv,
    onStdoutChunk: inv.onStdoutChunk,
    timeoutMs,
    abortSignal: inv.abortSignal,
  });
}

export function assertWorkspacePersistenceConfigured(env: WorkerEnv): void {
  if (process.env['PLATFORM_REQUIRE_WORKSPACE_ARCHIVE'] !== 'true') return;
  if (!env.workspaceArchiveKeyPrefix?.trim()) {
    throw new Error(
      'PLATFORM_REQUIRE_WORKSPACE_ARCHIVE=true but workspaceArchiveKeyPrefix is unset; multi-worker pools need S3 workspace snapshots',
    );
  }
}

export function logJobStep(jobId: string, step: string): void {
  console.log(`[processJob] ${jobId.slice(0, 8)} ${step}`);
}

export function startJobHeartbeat(
  stream: AgentEventStream,
  label: string,
  intervalMs = 25_000,
  activePhase: AgentPhase = 'PLAN',
  extraDetails: Record<string, unknown> = {},
): () => void {
  const started = Date.now();
  const timer = setInterval(() => {
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(`[processJob] heartbeat ${label} ${secs}s`);
    void stream.emit('system', activePhase, {
      summary: `${label}…（${secs} 秒）`,
      details: {
        heartbeat: true,
        elapsedSec: secs,
        activePhase,
        ...extraDetails,
      },
    });
  }, intervalMs);
  return () => clearInterval(timer);
}

export async function withProgressHeartbeat<T>(
  stream: AgentEventStream,
  jobId: string,
  label: string,
  fn: () => Promise<T>,
  activePhase: AgentPhase = 'PLAN',
): Promise<T> {
  logJobStep(jobId, `${label}`);
  const stopHeartbeat = startJobHeartbeat(stream, label, 25_000, activePhase);
  try {
    return await fn();
  } finally {
    stopHeartbeat();
    logJobStep(jobId, `${label}`);
  }
}

export async function ensureScaffold(
  workspace: string,
  paths: ReturnType<typeof readGenerationPaths>,
  stream: AgentEventStream,
  s3: S3Client,
  env: WorkerEnv,
  projectId: string,
  db?: DrizzleDb,
): Promise<{ scaffoldMode: 'skeleton' | 'legacy-template'; runtimeSpec: string | null }> {
  if (db) {
    await honorRescaffoldRequest({
      db,
      s3,
      env,
      projectId,
      workspaceDir: workspace,
      gameTemplateDir: paths.gameTemplateDir,
      skeletonDir: process.env['PLATFORM_RUNTIME_SKELETON_DIR']?.trim(),
      stream,
    });
  }

  // P4: pool support 'when the worker can't guarantee node-affinity, try to
  // restore a previously-archived workspace from S3 before scaffolding.
  if (env.workspaceArchiveKeyPrefix && !fs.existsSync(path.join(workspace, 'package.json'))) {
    try {
      const restored = await restoreWorkspaceFromS3(s3, env, projectId, workspace);
      if (restored) {
        await stream.emit('system', 'PLAN', {
          summary: 'S3 恢复工作区快照',
          details: {
            manifestKey: restored.manifestKey,
            fileCount: restored.fileCount,
            restored: restored.restored,
          },
        });
      }
    } catch (err) {
      await stream.emit('system', 'PLAN', {
        summary: '工作区快照恢复失败，回退到全新脚手架',
        details: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  if (db && !fs.existsSync(path.join(workspace, 'package.json'))) {
    try {
      const pinned = await applyPinnedTemplateToWorkspace({
        db,
        s3,
        env,
        projectId,
        workspaceDir: workspace,
        gameTemplateDir: paths.gameTemplateDir,
        skeletonDir: process.env['PLATFORM_RUNTIME_SKELETON_DIR']?.trim(),
      });
      if (pinned.applied) {
        await stream.emit('system', 'PLAN', {
          summary: `已按模板包脚手架 ${pinned.slug}@${pinned.version}`,
          details: {
            slug: pinned.slug,
            version: pinned.version,
            source: pinned.source,
            official: pinned.official,
          },
        });
      }
    } catch (err) {
      await stream.emit('system', 'PLAN', {
        summary: '模板包脚手架失败，回退到环境脚手架',
        details: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  const mode = readScaffoldMode();
  if (mode === 'legacy-template') {
    await ensureTemplateWorkspace(workspace, paths.gameTemplateDir);
    await stream.emit('system', 'PLAN', {
      summary: '使用 legacy 模板脚手架（环境变量回退）',
      details: { template: paths.gameTemplateDir },
    });
    const runtimePatch = await ensureLegacyTemplateRuntimePackage(
      workspace,
      paths.gameTemplateDir,
    );
    if (runtimePatch.runtimeSpec) {
      await stream.emit('system', 'PLAN', {
        summary: runtimePatch.patched
          ? '已写入 @opengame/runtime 依赖 (package.json)'
          : '已确认 @opengame/runtime 依赖',
        details: { runtimeSpec: runtimePatch.runtimeSpec, patched: runtimePatch.patched },
      });
    } else {
      await stream.emit('system', 'PLAN', {
        summary:
          '未能解析 @opengame/runtime：请设置 PLATFORM_RUNTIME_PACKAGE_SPEC，或保持 monorepo packages/runtime 存在',
        details: { template: paths.gameTemplateDir },
      });
    }
    return { scaffoldMode: 'legacy-template', runtimeSpec: runtimePatch.runtimeSpec };
  }
  const opts = readSkeletonOptionsFromEnv();
  const res = await generateMinimalSkeleton(workspace, opts);
  await stream.emit('system', 'PLAN', {
    summary: res.created
      ? '生成最小骨架（template-free），等待 Agent 填充'
      : '工作区已存在，跳过骨架重建',
    details: {
      runtimeSpec: res.runtimeSpec,
      runtimeVersion: res.runtimeVersion,
      created: res.created,
    },
  });
  return { scaffoldMode: 'skeleton', runtimeSpec: res.runtimeSpec };
}

