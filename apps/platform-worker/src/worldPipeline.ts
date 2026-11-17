/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * World-first generation: prompt → LLM/heuristic World Spec → validate → scaffold → spatial.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { S3Client } from '@aws-sdk/client-s3';
import type { DrizzleDb } from '@opengame/platform-db';
import {
  jobs,
  worlds,
  worldRevisions,
  usageEvents,
  artifacts,
  deployments,
  clearSocietyDayPlans,
  pruneSocietyAgentsNotIn,
  restartSocietyLivingState,
  societyEditSyncMode,
} from '@opengame/platform-db';
import {
  parseWorldSpec,
  resolveGenreProfile,
  genreProfileWithPopulation,
  summarizeWorldSpec,
  validateWorldSpec,
  toGameplayManifest,
  gatheringInvitationText,
  openingRumorFromSpec,
  isGenericGatheringLine,
  anonymousLeadName,
  evaluateEmergenceGate,
  evaluateSocietySeedGate,
  societySeedSoftEnabled,
  diffWorldSpecs,
  resolveArtStyle,
  type GenreProfile,
  type WorldSpec,
} from '@opengame/world-spec';
import { lintSpecFields } from '@opengame/world-spec';
import { applyWorldOp, type WorldOp } from '@opengame/world-ops';
// Planner-only fact bag for generate/edit prompts. Live society brains are
// MemoryStream in world-agents — never hydrate this store into a tick.
import {
  createMemoryStore,
  extractFactsFromWorld,
  formatWorldContextForPrompt,
  type WorldMemoryEntry,
} from '@opengame/world-memory';
import {
  generateWorldPresenterScaffold,
  maybeMinimaxRegionSeed,
  resolveSpatialBackend,
} from '@opengame/world-runtime';
import { WorldSimulator } from '@opengame/world-sim';
import {
  planWorldFromPrompt,
  planWorldFromPromptStaged,
  planWorldOps,
  runAgenticHarness,
  ensureWorldDepth,
  parseIntentFromPrompt,
  fulfillSocietyPromises,
  SocietyLlmKeysExhaustedError,
} from '@opengame/world-planner';
import {
  collectTrajectories,
  trainMlp,
  serializeWeights,
  HybridWorldModel,
  type WorldDifficultyProposal,
} from '@opengame/world-neural';
import type { RedisLikeForLock } from '@opengame/platform-shared';

import type { AgentEventStream } from './agentEvents.js';
import type { WorkerEnv } from './env.js';
import { readWorkRoot } from './generationEnv.js';
import { projectWorkspaceRoot } from './workspace.js';
import { putObjectUtf8 } from './s3.js';
import { playBundlePrefix } from './storageLayout.js';
import { uploadDirectoryToS3 } from './uploadDirectory.js';
import { runArgv, runShellCommand, type RunProcessResult } from './runProcess.js';
import {
  buildSkipDecision,
  clearWorkspaceBuildCache,
  recordDistUpload,
  recordWorkspaceBuild,
  reusableDistUpload,
  workspaceBuildKey,
} from './buildCache.js';
import { appendSessionTimeline } from './sessionTimeline.js';
import {
  formatWorldQualityFailureForPrompt,
  regionIdsRequiringL3Slots,
  runWorldAssetDiskGate,
  runWorldQualityGate,
} from './worldQualityGate.js';
import { assertWorldL3Playable } from './worldL3Gate.js';
import {
  runWorldAssetPhase,
  writeSpatialPosterPng,
} from './worldAssetPhase.js';
import { writeAssetForgeArtifacts } from './assetForgePhase.js';
import { isPlayableSpatialUrl, spatialSlotPlayable } from './spatialMedia.js';
import { probePngBuffer, requireRealAssets } from './assetAuthenticity.js';
import {
  normalizeWorldBrief,
  type SocietyPackId,
  type WorldBriefInput,
} from './worldBrief.js';

export type { WorldBriefInput } from './worldBrief.js';
export { normalizeWorldBrief } from './worldBrief.js';

function clampWorldPopulation(value: number | null | undefined): number | undefined {
  if (value == null) return undefined;
  const cap = Number(process.env['OPENGAME_MAX_NAMED_RESIDENTS'] ?? 80);
  const max = Number.isFinite(cap) ? Math.min(500, Math.max(2, Math.floor(cap))) : 80;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 2 || n > max) return undefined;
  return n;
}

function resolveSocietySeedHours(value: number | null | undefined): number {
  const fromPayload = Number(value);
  if (Number.isFinite(fromPayload) && fromPayload > 0) {
    return Math.max(1, Math.min(48, fromPayload));
  }
  const fromEnv = Number(process.env['PLATFORM_SOCIETY_SEED_HOURS'] ?? 16);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 16;
}

function livingSocietyProfile(
  world: WorldSpec,
  prompt?: string,
  populationHint?: number | null,
  brief?: WorldBriefInput | null,
): {
  readonly profile: GenreProfile;
  readonly populationHint?: number;
  readonly placePromises?: readonly string[];
  readonly occupationPromises?: readonly string[];
  readonly residentPromises?: readonly { readonly name: string }[];
  readonly allowScaffoldTown?: boolean;
  readonly briefPlaces?: readonly string[];
  readonly briefPackId?: SocietyPackId;
} {
  const normalized = normalizeWorldBrief(brief);
  const ir = prompt
    ? parseIntentFromPrompt(prompt, {
        ...(populationHint != null ? { populationHint } : {}),
        ...(normalized.packId ? { packId: normalized.packId } : {}),
        ...(normalized.places.length ? { places: normalized.places } : {}),
      })
    : undefined;
  const fromWorld = resolveGenreProfile(world);
  let profile = fromWorld;
  if (ir) {
    if (normalized.packId) {
      profile = ir.profile;
    } else if (!ir.classicTown && ir.packId !== fromWorld.id) {
      profile = ir.profile;
    }
  }
  const hint = ir?.populationHint ?? clampWorldPopulation(populationHint);
  if (hint != null) {
    profile = genreProfileWithPopulation(profile, hint);
  }
  const places = ir?.places?.length ? ir.places : normalized.places;
  return {
    profile,
    ...(hint != null ? { populationHint: hint } : {}),
    ...(places.length ? { placePromises: places } : {}),
    ...(ir?.occupations?.length
      ? { occupationPromises: ir.occupations }
      : {}),
    ...(ir?.residents?.length ? { residentPromises: ir.residents } : {}),
    ...(ir?.classicTown ? { allowScaffoldTown: true } : {}),
    ...(normalized.places.length ? { briefPlaces: normalized.places } : {}),
    ...(normalized.packId ? { briefPackId: normalized.packId } : {}),
  };
}

function societyQualityGateOptions(
  world: WorldSpec,
  prompt?: string,
  populationHint?: number | null,
  brief?: WorldBriefInput | null,
): Parameters<typeof runWorldQualityGate>[1] {
  const pack = livingSocietyProfile(world, prompt, populationHint, brief);
  return {
    profile: pack.profile,
    placePromises: pack.placePromises,
    occupationPromises: pack.occupationPromises,
    residentPromises: pack.residentPromises,
    populationHint: pack.populationHint,
    allowScaffoldTown: pack.allowScaffoldTown,
    briefPlaces: pack.briefPlaces,
    briefPackId: pack.briefPackId,
    checkL3: false,
  };
}

/** Write society_replay.json into public/ before vite (emptyOutDir would wipe dist-only copies). */
async function ensureSocietyReplayBeforeBuild(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly projectId: string;
  readonly workspace: string;
  readonly stream?: AgentEventStream;
}): Promise<void> {
  try {
    const { writeSocietyReplayArtifact } = await import(
      './societyReplayExport.js'
    );
    const written = await writeSocietyReplayArtifact({
      db: input.db,
      worldId: input.worldId,
      projectId: input.projectId,
      workspace: input.workspace,
    });
    await input.stream?.emit('qa', 'WORLD', {
      summary: `society_replay.json → public（${written.eventCount} 事件，构建前）`,
      details: written,
    });
  } catch (err) {
    await input.stream?.emit('qa', 'WORLD', {
      summary: `society_replay 构建前写入跳过：${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/**
 * The presenter workspace is reused across regenerations of the same project, so
 * an unconditional `npm install` re-resolved Phaser/Vite on every world — the
 * game track has skipped that for a while via the same node_modules probe.
 */
function worldWorkspaceNeedsNpmInstall(workspace: string): boolean {
  const nodeModules = path.join(workspace, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    return true;
  }
  if (!fs.existsSync(path.join(nodeModules, 'vite', 'bin', 'vite.js'))) {
    return true;
  }
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!fs.existsSync(path.join(nodeModules, dep))) {
        return true;
      }
    }
  } catch {
    return true;
  }
  return false;
}

async function npmInstallAndBuild(
  workspace: string,
  env: NodeJS.ProcessEnv,
  options?: { readonly forceBuild?: boolean },
): Promise<RunProcessResult & { buildOk: boolean }> {
  // Windows: `npm` is npm.cmd — spawn without shell → ENOENT. Use shell install,
  // then invoke Vite via node (same pattern as processJob.validateBuild).
  try {
    let installOut = '';
    let installErr = '';
    if (worldWorkspaceNeedsNpmInstall(workspace)) {
      const install = await runShellCommand('npm install --no-fund --no-audit', {
        cwd: workspace,
        env,
      });
      if (install.exitCode !== 0) {
        return { ...install, buildOk: false };
      }
      installOut = install.stdout;
      installErr = install.stderr;
    } else {
      installOut = 'npm install skipped (node_modules satisfies package.json)';
    }

    const buildKey = workspaceBuildKey(workspace);
    if (!options?.forceBuild && buildSkipDecision(workspace, buildKey).skipBuild) {
      const note = 'vite build skipped (src/ + public/ unchanged, dist/ present)';
      return {
        exitCode: 0,
        stdout: `${installOut}\n${note}`,
        stderr: installErr,
        buildOk: true,
      };
    }

    const viteJs = path.join(workspace, 'node_modules', 'vite', 'bin', 'vite.js');
    const build = fs.existsSync(viteJs)
      ? await runArgv([process.execPath, viteJs, 'build'], {
          cwd: workspace,
          env,
        })
      : await runShellCommand('npx vite build', { cwd: workspace, env });

    const buildOk =
      build.exitCode === 0 && fs.existsSync(path.join(workspace, 'dist'));
    if (buildOk) {
      recordWorkspaceBuild(workspace, buildKey);
    } else {
      clearWorkspaceBuildCache(workspace);
    }
    return {
      ...build,
      stdout: `${installOut}\n${build.stdout}`,
      stderr: `${installErr}\n${build.stderr}`,
      buildOk,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: null,
      stdout: '',
      stderr: msg,
      buildOk: false,
    };
  }
}

interface PublishedWorldPreview {
  readonly artifactId: string;
  readonly deploymentId: string;
  readonly previewUrl: string;
  readonly distPrefix: string;
}

/** Upload `dist/` and register the artifact + preview deployment for a world. */
async function publishWorldPreviewDist(options: {
  readonly db: DrizzleDb;
  readonly s3: S3Client;
  readonly env: WorkerEnv;
  readonly projectId: string;
  readonly jobId: string;
  readonly workspace: string;
  readonly worldId: string;
  readonly planner: string;
  /** Presenter without art or replay yet; a later publish replaces it. */
  readonly skeleton?: boolean;
}): Promise<PublishedWorldPreview> {
  const artifactId = randomUUID();
  // The skeleton and final presenter usually differ, but a run whose rebuild the
  // build cache skipped leaves dist/ identical — reuse the uploaded bytes then.
  const reusable = reusableDistUpload(options.workspace, options.jobId);
  let distPrefix: string;
  let entryKey: string;
  if (reusable) {
    distPrefix = reusable.distPrefix;
    entryKey = reusable.entryKey;
  } else {
    distPrefix = playBundlePrefix(options.projectId, artifactId);
    entryKey = (
      await uploadDirectoryToS3(
        options.s3,
        options.env,
        distPrefix,
        path.join(options.workspace, 'dist'),
      )
    ).entryKey;
    recordDistUpload(options.workspace, {
      jobId: options.jobId,
      distPrefix,
      entryKey,
    });
  }
  await options.db.insert(artifacts).values({
    id: artifactId,
    jobId: options.jobId,
    storagePrefix: distPrefix,
    manifest: {
      kind: 'vite-dist',
      distPrefix,
      entryKey,
      worldId: options.worldId,
      planner: options.planner,
      ...(options.skeleton ? { skeleton: true } : {}),
      ...(reusable ? { uploadReused: true } : {}),
    },
    contentHash: null,
  });
  const deploymentId = randomUUID();
  await options.db.insert(deployments).values({
    id: deploymentId,
    projectId: options.projectId,
    artifactId,
    channel: 'preview',
    previewUrl: entryKey,
  });
  return { artifactId, deploymentId, previewUrl: entryKey, distPrefix };
}

/**
 * Bake the resolved art style onto `presentation` so the Phaser scaffold — which
 * cannot import `@opengame/world-spec` — gets the renderer knobs and tile size
 * without re-deriving them from free text.
 */
function withResolvedPresentation(world: WorldSpec): WorldSpec {
  const profile = resolveArtStyle({
    id: world.styleAnchor.artStyleId,
    text: world.styleAnchor.artStyle,
  });
  return parseWorldSpec({
    ...world,
    styleAnchor: { ...world.styleAnchor, artStyleId: profile.id },
    presentation: {
      ...world.presentation,
      artStyleId: profile.id,
      pixelPerfect: profile.pixelPerfect,
      tileSourceSize: profile.tileSize,
    },
  });
}

/**
 * Rewriting a byte-identical file still bumps its mtime, which is what the build
 * fingerprint reads — keep unchanged scaffold files untouched so a regenerated
 * world with the same spec can reuse `dist/`.
 */
async function writeFileIfChanged(full: string, content: string): Promise<void> {
  try {
    if ((await fsp.readFile(full, 'utf8')) === content) return;
  } catch {
    // absent or unreadable — fall through to the write
  }
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, 'utf8');
}

async function writePresenterWorkspace(
  workspace: string,
  worldInput: WorldSpec,
  options?: {
    readonly onAssetProgress?: (summary: string) => void;
    /**
     * Runs once the presenter is complete but before the art phase, which is the
     * slow part — the hook is where an early playable shell gets published.
     */
    readonly onScaffoldReady?: () => Promise<void>;
  },
): Promise<void> {
  const world = withResolvedPresentation(worldInput);
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.mkdir(path.join(workspace, 'public'), { recursive: true });
  await fsp.mkdir(path.join(workspace, 'src', 'scenes'), { recursive: true });

  const mode = world.presentation.mode === 'three3d' ? 'three3d' : 'phaser2d';
  const deps =
    mode === 'three3d' ? { three: '^0.170.0' } : { phaser: '3.90.0' };

  const pkg = {
    name: 'opengame-world',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      typecheck: 'tsc --noEmit',
    },
    dependencies: deps,
    devDependencies: {
      typescript: '^5.8.3',
      vite: '^6.0.0',
      ...(mode === 'three3d' ? { '@types/three': '^0.170.0' } : {}),
    },
  };
  await writeFileIfChanged(
    path.join(workspace, 'package.json'),
    JSON.stringify(pkg, null, 2),
  );
  await writeFileIfChanged(
    path.join(workspace, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ),
  );
  await writeFileIfChanged(
    path.join(workspace, 'vite.config.ts'),
    `import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  publicDir: 'public',
  // Source maps would let anyone reconstruct the author's TypeScript from the
  // hosted bundle, so the presenter build never emits them.
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
`,
  );

  const scaffold = generateWorldPresenterScaffold({
    title: world.meta.title,
    mode,
  });
  for (const [rel, content] of Object.entries(scaffold.files)) {
    await writeFileIfChanged(path.join(workspace, rel), content);
  }
  await writeFileIfChanged(
    path.join(workspace, 'public', 'world.json'),
    JSON.stringify(world, null, 2),
  );
  await writeFileIfChanged(
    path.join(workspace, 'public', 'gameplay.json'),
    JSON.stringify(toGameplayManifest(world), null, 2),
  );
  // World ASSET phase artifact — style coupling for MiniMax / art directors
  await writeFileIfChanged(
    path.join(workspace, 'public', 'style_anchor.json'),
    JSON.stringify(
      {
        schema: 'opengame-world-style-v1',
        ...world.styleAnchor,
        narrativeSeed: world.presentation.narrativeSeed ?? world.meta.id,
        agenticDiff: world.presentation.agenticDiff ?? null,
      },
      null,
      2,
    ),
  );

  if (options?.onScaffoldReady) {
    await options.onScaffoldReady();
  }

  try {
    const worldAssets = await runWorldAssetPhase(workspace, world, {
      allowImageFallback: true,
      onProgress: (summary) => {
        console.log(`[world-asset] ${summary}`);
        options?.onAssetProgress?.(summary);
      },
    });
    if (worldAssets.failoverEvents.length > 0) {
      console.warn(
        `[world-asset] failover/soft-skip: ${worldAssets.failoverEvents.join('; ')}`,
      );
    }
    const startRegion = world.space.regions.find(
      (r) => r.id === world.space.startRegionId,
    );
    try {
      await writeAssetForgeArtifacts(workspace, {
        layoutAscii: startRegion?.layoutAscii,
        styleProfile: resolveArtStyle({
          id: world.styleAnchor.artStyleId,
          text: world.styleAnchor.artStyle,
        }),
      });
    } catch (err) {
      console.warn('[world-asset] tilemap artifacts failed', err);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`World ASSET phase failed: ${msg}`);
  }
  // L3 presenter config — Spec-driven; CinematicLayer prefers this over Vite env
  if (
    world.presentation.spatialBackend === 'lingbot' ||
    world.presentation.cinematicEnabled
  ) {
    await fsp.writeFile(
      path.join(workspace, 'public', 'lingbot.json'),
      JSON.stringify(
        {
          schema: 'opengame-lingbot-presenter-v1',
          spatialBackend: world.presentation.spatialBackend ?? null,
          lingbotMode: world.presentation.lingbotMode ?? 'mock',
          cinematicEnabled: Boolean(world.presentation.cinematicEnabled),
          sidecarUrl:
            process.env['LINGBOT_PUBLIC_BASE'] ??
            process.env['LINGBOT_SIDECAR_URL'] ??
            'http://127.0.0.1:8091',
          startRegionId: world.space.startRegionId,
        },
        null,
        2,
      ),
      'utf8',
    );
  }
  const spatialAssets = world.presentation.spatialAssets ?? {};
  if (Object.keys(spatialAssets).length > 0) {
    const spatialDir = path.join(workspace, 'public', 'spatial');
    await fsp.mkdir(spatialDir, { recursive: true });
    await fsp.writeFile(
      path.join(spatialDir, 'manifest.json'),
      JSON.stringify(
        {
          schema: 'opengame-spatial-manifest-v1',
          cinematicEnabled: world.presentation.cinematicEnabled,
          backend: world.presentation.spatialBackend ?? null,
          lingbotMode: world.presentation.lingbotMode ?? null,
          regions: spatialAssets,
        },
        null,
        2,
      ),
      'utf8',
    );
  }
}

/** Persist L3 spatial/video results onto Spec + public/spatial. */
async function applySpatialResults(
  workspace: string,
  world: WorldSpec,
  stream: AgentEventStream,
  options?: { readonly regionIds?: readonly string[] },
): Promise<WorldSpec> {
  const societyObserve =
    world.presentation.narrativeSeed === 'society-gathering-observe';
  const spatial = resolveSpatialBackend(
    societyObserve ? 'null' : world.presentation.spatialBackend,
    process.env['WORLD_SPATIAL_API_KEY'],
  );
  const assets: Record<
    string,
    {
      backend?: string;
      assetUrl?: string;
      videoUrl?: string;
      prompt?: string;
      licenseNote?: string;
    }
  > = { ...(world.presentation.spatialAssets ?? {}) };

  const spatialDir = path.join(workspace, 'public', 'spatial');
  await fsp.mkdir(spatialDir, { recursive: true });

  const allRegions =
    process.env['LINGBOT_ALL_REGIONS'] === 'true' ||
    spatial.id === 'null' ||
    spatial.id === 'three';
  let regions = allRegions
    ? world.space.regions
    : world.space.regions.filter(
        (r) => r.id === world.space.startRegionId,
      );
  if (options?.regionIds?.length) {
    const want = new Set(options.regionIds);
    regions = world.space.regions.filter((r) => want.has(r.id));
  }
  const targets = regions.length ? regions : world.space.regions.slice(0, 1);

  for (const region of targets) {
    let seedImageUrl: string | undefined;
    if (spatial.id === 'lingbot') {
      const seed = await maybeMinimaxRegionSeed({
        prompt: `${world.meta.title} — ${region.name}: ${region.description ?? ''}`,
        styleHint: world.styleAnchor?.artStyle,
      });
      seedImageUrl = seed.url;
      await stream.emit('artist', 'ASSET', {
        summary: seed.message,
        details: { regionId: region.id, hasSeed: Boolean(seed.url) },
      });
    }
    const result = await spatial.generateRegion({
      world,
      regionId: region.id,
      seedImageUrl,
    });
    await stream.emit('artist', 'ASSET', {
      summary: result.message,
      details: {
        backend: result.backend,
        regionId: region.id,
        ok: result.ok,
        hasVideo: Boolean(result.videoUrl),
      },
    });
    if (!result.ok && !result.assetUrl && !result.videoUrl) continue;

    let assetUrl = result.assetUrl;
    let videoUrl = result.videoUrl;
    // Persist local sidecar mp4 / file:// into public/spatial (browser-safe relative URL)
    const localPath = result.localPath;
    if (localPath) {
      try {
        const src = path.resolve(localPath);
        await fsp.access(src);
        const dest = path.join(spatialDir, `${region.id}.mp4`);
        await fsp.copyFile(src, dest);
        videoUrl = `./spatial/${region.id}.mp4`;
      } catch {
        // fall through to data URI / http handling
      }
    } else if (videoUrl?.startsWith('file:')) {
      try {
        const { fileURLToPath } = await import('node:url');
        const src = fileURLToPath(videoUrl);
        const dest = path.join(spatialDir, `${region.id}.mp4`);
        await fsp.copyFile(src, dest);
        videoUrl = `./spatial/${region.id}.mp4`;
      } catch {
        videoUrl = undefined;
      }
    }
    // Persist data-URI / JSON blobs as files when possible
    if (assetUrl?.startsWith('data:application/json')) {
      const raw = decodeURIComponent(
        assetUrl.replace(/^data:application\/json,?/, ''),
      );
      const metaFile = path.join(spatialDir, `${region.id}.json`);
      await fsp.writeFile(metaFile, raw, 'utf8');
      // JSON is not browser-playable — stamp a PNG poster for CinematicLayer
      assetUrl = await writeSpatialPosterPng(workspace, region.id, undefined, {
        prompt: `${world.meta.title} — ${region.name}: ${region.description ?? 'game region'}`,
        styleHint: world.styleAnchor?.artStyle,
      });
    }
    if (assetUrl?.startsWith('data:image/png') || assetUrl?.startsWith('data:image/webp')) {
      const m = /^data:image\/(png|webp);base64,(.+)$/s.exec(assetUrl);
      if (m) {
        const ext = m[1]!;
        const buf = Buffer.from(m[2]!, 'base64');
        // Reject 1×1 / solid offline mocks — replace with MiniMax poster
        if (ext === 'png' && !probePngBuffer(buf).ok) {
          assetUrl = await writeSpatialPosterPng(workspace, region.id, undefined, {
            prompt: `${world.meta.title} — ${region.name}: ${region.description ?? 'game region'}`,
            styleHint: world.styleAnchor?.artStyle,
          });
        } else {
          const file = path.join(spatialDir, `${region.id}.${ext}`);
          await fsp.writeFile(file, buf);
          assetUrl = `./spatial/${region.id}.${ext}`;
        }
      }
    }
    if (assetUrl?.startsWith('data:image/svg')) {
      const file = path.join(spatialDir, `${region.id}.svg.txt`);
      await fsp.writeFile(file, assetUrl, 'utf8');
      // SVG data URI kept for TitleScene; also stamp PNG for L3 gate
      if (!isPlayableSpatialUrl(videoUrl)) {
        assetUrl = await writeSpatialPosterPng(workspace, region.id, undefined, {
        prompt: `${world.meta.title} — ${region.name}: ${region.description ?? 'game region'}`,
        styleHint: world.styleAnchor?.artStyle,
      });
      }
    }
    if (videoUrl?.startsWith('data:video/')) {
      const m = /^data:([^;,]+);base64,(.+)$/s.exec(videoUrl);
      if (m) {
        const ext = m[1]?.includes('webm') ? 'webm' : 'mp4';
        const file = path.join(spatialDir, `${region.id}.${ext}`);
        await fsp.writeFile(file, Buffer.from(m[2]!, 'base64'));
        videoUrl = `./spatial/${region.id}.${ext}`;
      }
    }
    // Reject leftover file:// so preview never 404s with opaque local URIs
    if (videoUrl?.startsWith('file:')) videoUrl = undefined;
    assets[region.id] = {
      backend: result.backend,
      assetUrl,
      videoUrl,
      licenseNote: result.licenseNote,
    };
  }

  // L3 harden: every gated region needs a playable poster, not only startRegion.
  // LingBot sidecar frequently returns ok:false without URLs; MiniMax fills the slot.
  const cinematic =
    world.presentation.cinematicEnabled ||
    world.presentation.spatialBackend === 'lingbot' ||
    societyObserve ||
    Object.values(assets).some((a) => spatialSlotPlayable(a));
  if (cinematic) {
    for (const regionId of regionIdsRequiringL3Slots(world)) {
      if (spatialSlotPlayable(assets[regionId])) continue;
      const region = world.space.regions.find((r) => r.id === regionId);
      const poster = await writeSpatialPosterPng(workspace, regionId, undefined, {
        prompt: `${world.meta.title} — ${region?.name ?? regionId}: ${region?.description ?? 'game region'}`,
        styleHint: world.styleAnchor?.artStyle,
      });
      assets[regionId] = {
        ...(assets[regionId] ?? {}),
        backend: assets[regionId]?.backend ?? spatial.id,
        assetUrl: poster,
        licenseNote:
          assets[regionId]?.licenseNote ?? 'L3 MiniMax poster fallback',
      };
      await stream.emit('artist', 'ASSET', {
        summary: `L3 补海报 ${region?.name ?? regionId}`,
        details: { regionId, assetUrl: poster },
      });
    }
  }

  // Replace on-disk tiny/solid spatial PNGs (e.g. legacy 1×1 mock files)
  if (requireRealAssets()) {
    for (const [regionId, slot] of Object.entries(assets)) {
      const url = slot.assetUrl;
      if (!url || !/\.png(\?|$)/i.test(url) || url.startsWith('data:')) continue;
      const rel = url.replace(/^\.\//, '');
      const full = path.join(workspace, 'public', rel);
      if (!fs.existsSync(full)) continue;
      try {
        const probe = probePngBuffer(await fsp.readFile(full));
        if (probe.ok) continue;
      } catch {
        // rewrite
      }
      const region = world.space.regions.find((r) => r.id === regionId);
      const poster = await writeSpatialPosterPng(workspace, regionId, undefined, {
        prompt: `${world.meta.title} — ${region?.name ?? regionId}: ${region?.description ?? 'game region'}`,
        styleHint: world.styleAnchor?.artStyle,
      });
      assets[regionId] = {
        ...slot,
        assetUrl: poster,
        licenseNote: `${slot.licenseNote ?? ''} · MiniMax replaced fake spatial PNG`.trim(),
      };
    }
  }

  const next: WorldSpec = {
    ...world,
    presentation: {
      ...world.presentation,
      cinematicEnabled: societyObserve
        ? false
        : world.presentation.cinematicEnabled ||
          Object.values(assets).some((a) => spatialSlotPlayable(a)),
      spatialAssets: assets,
      spatialBackend: societyObserve
        ? 'null'
        : (world.presentation.spatialBackend ?? spatial.id),
    },
  };

  await fsp.writeFile(
    path.join(spatialDir, 'manifest.json'),
    JSON.stringify(
      {
        schema: 'opengame-spatial-manifest-v1',
        cinematicEnabled: next.presentation.cinematicEnabled,
        backend: next.presentation.spatialBackend ?? null,
        regions: assets,
      },
      null,
      2,
    ),
    'utf8',
  );
  await fsp.writeFile(
    path.join(workspace, 'public', 'world.json'),
    JSON.stringify(next, null, 2),
    'utf8',
  );
  return next;
}

/** Regions the L3 gate will reject — need refresh after pad/expand. */
function regionIdsMissingSpatial(world: WorldSpec): string[] {
  const assets = world.presentation.spatialAssets ?? {};
  return regionIdsRequiringL3Slots(world).filter(
    (id) => !spatialSlotPlayable(assets[id]),
  );
}

/** Map Op dirty keys → region ids that need cinematic/poster refresh. */
function regionIdsFromDirtyKeys(
  world: WorldSpec,
  dirty: readonly string[],
): string[] {
  const ids = new Set<string>();
  for (const key of dirty) {
    if (key.startsWith('region:')) {
      ids.add(key.slice('region:'.length));
    } else if (key.startsWith('entity:')) {
      const eid = key.slice('entity:'.length);
      const ent = world.entities.find((e) => e.id === eid);
      if (ent?.regionId) ids.add(ent.regionId);
    }
  }
  return [...ids];
}

function regionIdsFromOps(world: WorldSpec, ops: readonly WorldOp[]): string[] {
  const dirty: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'expand_region':
      case 'add_region':
        dirty.push(`region:${op.region.id}`);
        break;
      case 'edit_region':
      case 'reshape_layout':
        dirty.push(`region:${op.regionId}`);
        break;
      case 'edit_entity':
      case 'remove_entity':
        dirty.push(`entity:${op.entityId}`);
        break;
      case 'add_entity':
        dirty.push(`entity:${op.entity.id}`);
        break;
      default:
        break;
    }
  }
  return regionIdsFromDirtyKeys(world, dirty);
}

function maybeTrainInlineDynamics(world: WorldSpec): string | null {
  if (process.env['WORLD_NEURAL_INLINE_TRAIN'] === 'false') return null;
  try {
    const traj = collectTrajectories({
      episodes: Number(process.env['WORLD_NEURAL_EPISODES'] ?? 8),
      stepsPerEpisode: Number(process.env['WORLD_NEURAL_STEPS'] ?? 24),
      policy: 'scripted',
      seedWorld: world,
    });
    const samples = traj.map((t) => ({
      x: [...t.obs, ...t.actionVec],
      y: t.nextObs,
    }));
    const result = trainMlp(samples, {
      epochs: Number(process.env['WORLD_NEURAL_EPOCHS'] ?? 12),
      lr: 0.03,
      batchSize: 32,
    });
    return serializeWeights(result.weights);
  } catch {
    return null;
  }
}

/**
 * Stamps L2-proposed difficulty knobs onto `presentation.difficultyTunables` so
 * the game compiler (and therefore `game.json`) consumes them. Falls back to the
 * untouched world whenever the model has nothing trustworthy to say.
 */
function applyNeuralDifficultyTunables(
  world: WorldSpec,
  weightsJson: string,
): { world: WorldSpec; proposal: WorldDifficultyProposal | null } {
  try {
    const hybrid = new HybridWorldModel(world, weightsJson);
    const proposal = hybrid.proposeDifficultyTunables();
    if (!proposal) return { world, proposal: null };
    const next = parseWorldSpec({
      ...world,
      presentation: {
        ...world.presentation,
        difficultyTunables: proposal.tunables,
        difficultyTunablesSource: proposal.source,
      },
    });
    return { world: next, proposal };
  } catch {
    return { world, proposal: null };
  }
}

export async function runWorldGenerateJob(options: {
  readonly db: DrizzleDb;
  readonly s3: S3Client;
  readonly env: WorkerEnv;
  readonly stream: AgentEventStream;
  readonly organizationId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly prompt: string;
  readonly sessionId: string | null;
  readonly redis?: RedisLikeForLock | null;
  /** Art style picked in the UI; overrides whatever the planner LLM suggests. */
  readonly artStyleId?: string | null;
  /** Named-resident target from the world create guide. */
  readonly worldPopulation?: number | null;
  /** Generate-time society seed hours from the world create guide. */
  readonly societySeedHours?: number | null;
  /** Structured create brief — pack and venues win over prompt keywords. */
  readonly worldBrief?: WorldBriefInput | null;
}): Promise<void> {
  const { db, s3, env, stream, projectId, jobId, prompt, organizationId } =
    options;
  const pickedPopulation = clampWorldPopulation(options.worldPopulation);
  const worldBrief = options.worldBrief ?? null;
  const briefIntent = normalizeWorldBrief(worldBrief);

  await stream.emit('planner', 'PLAN', {
    summary: 'World Planner：推理密钥池生成 Spec（密钥无效会失败，不会静默降级）',
  });

  let planned: Awaited<ReturnType<typeof planWorldFromPrompt>>;
  try {
    // 批次 4：通过 OPENGAME_STAGED_PLANNER=1 启用 3 步 planner；任何一步失败
    // 都回退到 planWorldFromPrompt，绝不静默破坏现有业务。
    if (process.env['OPENGAME_STAGED_PLANNER'] === '1') {
      const staged = await planWorldFromPromptStaged(prompt, {
        ...(options.artStyleId ? { artStyleId: options.artStyleId } : {}),
        ...(pickedPopulation != null ? { worldPopulation: pickedPopulation } : {}),
      });
      planned = {
        world: staged.world,
        source: staged.source,
        issues: [],
      };
    } else {
      planned = await planWorldFromPrompt(prompt, {
        ...(options.artStyleId ? { artStyleId: options.artStyleId } : {}),
        ...(pickedPopulation != null ? { worldPopulation: pickedPopulation } : {}),
        ...(briefIntent.packId ? { packId: briefIntent.packId } : {}),
        ...(briefIntent.places.length ? { places: briefIntent.places } : {}),
        ...(worldBrief?.useCase ? { useCase: String(worldBrief.useCase) } : {}),
        ...(worldBrief?.scale ? { scale: String(worldBrief.scale) } : {}),
        ...(worldBrief?.livedIn ? { livedIn: String(worldBrief.livedIn) } : {}),
        ...(worldBrief?.note
          ? { note: String(worldBrief.note).trim().slice(0, 200) }
          : {}),
      });
    }
  } catch (err) {
    if (err instanceof SocietyLlmKeysExhaustedError) {
      await stream.emit('system', 'FAIL', {
        summary: err.message,
      });
    }
    throw err;
  }
  let world = planned.world;
  await stream.emit('planner', 'PLAN', {
    summary: `Planner source=${planned.source} · ${summarizeWorldSpec(world, 360)}`,
    details: {
      source: planned.source,
      issues: planned.issues.slice(0, 5),
      regions: world.space.regions.length,
      entities: world.entities.length,
    },
  });
  // 批次 4：当世界叙事明显偏模板化（meta.summary 过短 / openingRumor 含通用模板词）
  // 推一条 heal 事件给前端，便于前端展示「再润色一次」入口。
  if (process.env['OPENGAME_EMIT_HEAL_EVENTS'] === '1') {
    const summary = world.meta?.summary?.trim() ?? '';
    const rumor = world.presentation?.openingRumor?.trim() ?? '';
    const rumorIsTpl =
      /^(有人在|镇上|今晚|the town is|someone is)/i.test(rumor) && rumor.length < 30;
    // 批次 11：先用基础规则判断；进一步用 specLint 跑多字段静态检查。
    const lintFields = [
      { path: 'meta.summary', text: summary || null },
      { path: 'presentation.openingRumor', text: rumor || null },
      ...(world.space.regions ?? [])
        .slice(0, 5)
        .map((r, i) => ({
          path: `space.regions[${i}].description`,
          text: r.description ?? null,
        })),
      ...(world.entities ?? [])
        .slice(0, 5)
        .map((e, i) => ({
          path: `entities[${i}].name`,
          text: e.name ?? null,
        })),
    ];
    const lintIssues = lintSpecFields(lintFields);
    const lintError = lintIssues.find((i) => i.severity === 'error');
    if (summary.length < 40 || rumorIsTpl || lintError) {
      await stream.emit('system', 'HEAL', {
        summary:
          '世界文案偏模板化：建议在 WorldPanel 里点「再润色一次」刷新 meta.summary / openingRumor',
        details: {
          metaSummaryLen: summary.length,
          rumorLen: rumor.length,
          rumorIsTpl,
          lint: lintIssues.slice(0, 6).map((i) => ({
            code: i.code,
            path: i.path,
            detail: i.detail,
            hit: i.hit ?? null,
          })),
        },
      });
    }
  }

  const validated = validateWorldSpec(world);
  if (!validated.ok || !validated.world) {
    throw new Error(
      `World Spec invalid: ${validated.issues.map((i) => i.message).join('; ')}`,
    );
  }
  world = validated.world;

  if (
    process.env['WORLD_PRESENTATION_MODE'] === 'three3d' ||
    /\b(presenter:?\s*three3d|three\.?js\s*presenter|三维演示)\b/i.test(prompt)
  ) {
    world = parseWorldSpec({
      ...world,
      presentation: { ...world.presentation, mode: 'three3d' },
    });
  }
  // LingBot is an optional cinematic layer that never drives dialogue, behaviour
  // or simulation, so it stays OFF unless something explicitly asks for it:
  //   WORLD_SPATIAL_BACKEND=lingbot  -> on for every world
  //   prompt keyword                 -> on for this world (research template)
  //   anything else, including unset -> off (2D presentation)
  // A prompt request still wins over an `off` env value: the operator clicked the
  // research template on purpose, and an unreachable sidecar now degrades to a
  // MiniMax poster after a single probe (see markSidecarUnreachable).
  const envSpatial = (process.env['WORLD_SPATIAL_BACKEND'] || '').toLowerCase();
  const lingbotHardOff = ['null', 'none', 'off', '0', 'false'].includes(
    envSpatial,
  );
  const societyObserve =
    world.presentation.narrativeSeed === 'society-gathering-observe';
  const promptAsksLingbot =
    /\b(lingbot|视频世界|交互视频|world.?model.?v2|档\s*b)\b/i.test(prompt);
  const wantLingbot =
    !societyObserve && (envSpatial === 'lingbot' || promptAsksLingbot);
  const narrativeSeed =
    world.presentation.narrativeSeed ||
    `seed_${Buffer.from(prompt.slice(0, 48)).toString('base64url').slice(0, 16)}`;

  // Game↔world coupling: pull artStyle from project brief when present
  try {
    const { loadLatestBrief, saveBrief } = await import(
      '@opengame/platform-agent'
    );
    const brief = await loadLatestBrief(db, projectId);
    if (brief?.artStyle && !world.styleAnchor?.artStyle) {
      world = parseWorldSpec({
        ...world,
        styleAnchor: {
          ...world.styleAnchor,
          artStyle: brief.artStyle,
          mood: world.styleAnchor?.mood ?? brief.story?.slice(0, 80),
          palette: world.styleAnchor?.palette ?? ['#2d6a4f', '#d8f3dc', '#f4a261'],
        },
      });
    } else if (world.styleAnchor?.artStyle && brief && !brief.artStyle) {
      const { version: _v, ...rest } = brief;
      await saveBrief(db, projectId, {
        ...rest,
        artStyle: world.styleAnchor.artStyle,
        story: brief.story ?? world.meta.summary,
      });
    }
  } catch {
    // brief optional
  }

  if (wantLingbot) {
    const startId = world.space.startRegionId;
    const prevAssets = { ...(world.presentation.spatialAssets ?? {}) };
    // Real MiniMax poster (never 1×1 placeholder) so L3 slots are playable
    if (!spatialSlotPlayable(prevAssets[startId])) {
      try {
        const workRootEarly = readWorkRoot();
        const wsEarly = projectWorkspaceRoot(workRootEarly, projectId);
        const posterRel = await writeSpatialPosterPng(
          wsEarly,
          startId,
          undefined,
          {
            prompt: `${world.meta.title} · ${world.space.regions.find((r) => r.id === startId)?.name ?? startId}`,
            styleHint: world.styleAnchor?.artStyle,
          },
        );
        prevAssets[startId] = {
          ...(prevAssets[startId] ?? {}),
          backend: 'lingbot',
          assetUrl: posterRel,
          prompt: `${world.meta.title} · start`,
          licenseNote: 'CC BY-NC-SA 4.0',
        };
      } catch (err) {
        throw new Error(
          `L3 startRegion MiniMax poster failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (process.env['LINGBOT_ALL_REGIONS'] === 'true') {
      const workRootEarly = readWorkRoot();
      const wsEarly = projectWorkspaceRoot(workRootEarly, projectId);
      for (const r of world.space.regions) {
        if (spatialSlotPlayable(prevAssets[r.id])) continue;
        const posterRel = await writeSpatialPosterPng(wsEarly, r.id, undefined, {
          prompt: `${world.meta.title} · ${r.name}`,
          styleHint: world.styleAnchor?.artStyle,
        });
        prevAssets[r.id] = {
          ...(prevAssets[r.id] ?? {}),
          backend: 'lingbot',
          assetUrl: posterRel,
          prompt: `${world.meta.title} · ${r.name}`,
          licenseNote: 'CC BY-NC-SA 4.0',
        };
      }
    }
    world = parseWorldSpec({
      ...world,
      presentation: {
        ...world.presentation,
        spatialBackend: 'lingbot',
        cinematicEnabled: true,
        lingbotMode:
          (process.env['LINGBOT_MODE'] as 'mock' | 'real' | undefined) ?? 'mock',
        narrativeSeed,
        spatialAssets: prevAssets,
      },
    });
  } else if (envSpatial && !lingbotHardOff && !societyObserve) {
    world = parseWorldSpec({
      ...world,
      presentation: {
        ...world.presentation,
        spatialBackend: envSpatial,
        narrativeSeed,
      },
    });
  } else if (societyObserve) {
    world = parseWorldSpec({
      ...world,
      presentation: {
        ...world.presentation,
        spatialBackend: 'null',
        cinematicEnabled: false,
        narrativeSeed,
      },
    });
  } else if (!world.presentation.narrativeSeed) {
    world = parseWorldSpec({
      ...world,
      presentation: { ...world.presentation, narrativeSeed },
    });
  }
  if (societyObserve && world.presentation.cinematicEnabled) {
    world = parseWorldSpec({
      ...world,
      presentation: { ...world.presentation, cinematicEnabled: false },
    });
  }

  // Optional LingBot-style Pilot+Director pass before sim (WORLD_AGENTIC_ON_GENERATE=true or prompt)
  const beforeAgentic = {
    regions: world.space.regions.length,
    quests: world.narrative.quests.length,
    rules: world.rules.length,
  };
  if (
    !societyObserve &&
    (process.env['WORLD_AGENTIC_ON_GENERATE'] === 'true' ||
      /\b(agentic|pilot|director|智能体编排)\b/i.test(prompt))
  ) {
    await stream.emit('planner', 'PLAN', {
      summary: 'Generate-time Agentic harness（Pilot + Director）',
    });
    const harness = await runAgenticHarness({ world, intent: prompt });
    world = harness.world;
    world = parseWorldSpec({
      ...world,
      presentation: {
        ...world.presentation,
        agenticDiff: {
          beforeRegions: beforeAgentic.regions,
          afterRegions: world.space.regions.length,
          beforeQuests: beforeAgentic.quests,
          afterQuests: world.narrative.quests.length,
          beforeRules: beforeAgentic.rules,
          afterRules: world.rules.length,
          opsApplied: harness.applied.length,
        },
      },
    });
    await stream.emit('planner', 'PLAN', {
      summary: `Agentic pre-pass · ${harness.applied.length} ops · L2 diff visible in Spec`,
      details: {
        issues: harness.issues.slice(0, 5),
        roles: harness.proposals.map((p) => p.role),
        agenticDiff: world.presentation.agenticDiff,
      },
    });
  } else if (
    societyObserve &&
    (process.env['WORLD_AGENTIC_ON_GENERATE'] === 'true' ||
      process.env['WORLD_AGENTIC_ON_GENERATE'] === '1') &&
    !world.presentation.agenticDiff
  ) {
    world = parseWorldSpec({
      ...world,
      presentation: {
        ...world.presentation,
        agenticDiff: {
          beforeRegions: beforeAgentic.regions,
          afterRegions: world.space.regions.length,
          beforeQuests: beforeAgentic.quests,
          afterQuests: world.narrative.quests.length,
          beforeRules: beforeAgentic.rules,
          afterRules: world.rules.length,
          opsApplied: 0,
        },
      },
    });
    await stream.emit('planner', 'PLAN', {
      summary: '社会镇跳过 generate-time Agentic harness',
    });
  }

  // Product depth pad + quality gate (genre profile from Spec / prompt)
  const societyPack = livingSocietyProfile(
    world,
    prompt,
    pickedPopulation,
    worldBrief,
  );
  const depth = ensureWorldDepth(world, {
    mode: 'society',
    profile: societyPack.profile,
    populationHint: societyPack.populationHint,
  });
  world = depth.world;
  world = fulfillSocietyPromises(world, prompt, {
    ...(pickedPopulation != null ? { populationHint: pickedPopulation } : {}),
    ...(briefIntent.packId ? { packId: briefIntent.packId } : {}),
    ...(briefIntent.places.length ? { places: briefIntent.places } : {}),
  });
  if (
    briefIntent.packId ||
    briefIntent.places.length ||
    worldBrief?.useCase ||
    worldBrief?.note
  ) {
    world = parseWorldSpec({
      ...world,
      presentation: {
        ...world.presentation,
        worldBrief: {
          ...(briefIntent.packId ? { packId: briefIntent.packId } : {}),
          ...(worldBrief?.useCase
            ? { useCase: String(worldBrief.useCase) }
            : {}),
          ...(briefIntent.places.length
            ? { venues: [...briefIntent.places] }
            : {}),
          ...(worldBrief?.scale ? { scale: String(worldBrief.scale) } : {}),
          ...(worldBrief?.livedIn
            ? { livedIn: String(worldBrief.livedIn) }
            : {}),
          ...(worldBrief?.note
            ? { note: String(worldBrief.note).trim().slice(0, 200) }
            : {}),
        },
      },
    });
  }
  if (depth.padded) {
    await stream.emit('planner', 'PLAN', {
      summary: `World depth pad · regions ${depth.before.regions}→${depth.after.regions}, npcs ${depth.before.npcs}→${depth.after.npcs}`,
      details: {
        before: depth.before,
        after: depth.after,
        addedRegionIds: depth.addedRegionIds,
        mode: 'society',
        pack: societyPack.profile.id,
      },
    });
  }
  const openingLine = openingRumorFromSpec(
    world.entities.find((e) => e.kind === 'npc')?.name ??
      anonymousLeadName(world),
    world,
  );
  if (!isGenericGatheringLine(openingLine)) {
    await stream.emit('planner', 'PLAN', {
      summary: `开场传闻：${openingLine.slice(0, 80)}`,
      details: { openingRumor: openingLine },
    });
  }

  const qualityGateOn = process.env['WORLD_QUALITY_GATE'] !== 'false';
  if (qualityGateOn) {
    const maxFix = Math.max(
      1,
      Number.parseInt(process.env['WORLD_MAX_FIX_ITERATIONS'] || '3', 10) || 3,
    );
    // checkL3=false: posters are minted by the ASSET phase below; assertWorldL3Playable re-checks
    let gate = runWorldQualityGate(
      world,
      societyQualityGateOptions(world, prompt, pickedPopulation, worldBrief),
    );
    let fixAttempt = 0;
    while (!gate.ok && fixAttempt < maxFix) {
      fixAttempt += 1;
      await stream.emit('qa', 'FIX', {
        tool: 'world-quality-gate',
        summary: societyObserve
          ? `社会 FIX ${fixAttempt}/${maxFix}（只补人/地点，不加战斗）`
          : `World FIX ${fixAttempt}/${maxFix}`,
        details: { issues: gate.issues, metrics: gate.metrics },
      });
      if (societyObserve) {
        world = fulfillSocietyPromises(
          ensureWorldDepth(world, {
            mode: 'society',
            profile: livingSocietyProfile(
              world,
              prompt,
              pickedPopulation,
              worldBrief,
            ).profile,
            populationHint: societyPack.populationHint,
          }).world,
          prompt,
          {
            ...(societyPack.populationHint != null
              ? { populationHint: societyPack.populationHint }
              : {}),
            ...(briefIntent.packId ? { packId: briefIntent.packId } : {}),
            ...(briefIntent.places.length ? { places: briefIntent.places } : {}),
          },
        );
        gate = runWorldQualityGate(
          world,
          societyQualityGateOptions(world, prompt, pickedPopulation, worldBrief),
        );
        continue;
      }
      const retryHarness = await runAgenticHarness({
        world,
        intent: `${prompt}\n\n${formatWorldQualityFailureForPrompt(gate)}\n\nPrefer a concrete opening rumor, disagreeing secrets, and object states with facts — do NOT pad NPC count or add combat quests unless required.`,
      });
      world = ensureWorldDepth(retryHarness.world, {
        mode: 'society',
        profile: livingSocietyProfile(
          retryHarness.world,
          prompt,
          pickedPopulation,
          worldBrief,
        ).profile,
        populationHint: societyPack.populationHint,
      }).world;
      if (retryHarness.applied.length > 0) {
        const prev = world.presentation.agenticDiff;
        world = parseWorldSpec({
          ...world,
          presentation: {
            ...world.presentation,
            agenticDiff: {
              beforeRegions: prev?.beforeRegions ?? gate.metrics.regions,
              afterRegions: world.space.regions.length,
              beforeQuests: prev?.beforeQuests ?? gate.metrics.quests,
              afterQuests: world.narrative.quests.length,
              beforeRules: prev?.beforeRules ?? gate.metrics.rules,
              afterRules: world.rules.length,
              opsApplied:
                (prev?.opsApplied ?? 0) + retryHarness.applied.length,
            },
          },
        });
      }
      gate = runWorldQualityGate(
        world,
        societyQualityGateOptions(world, prompt, pickedPopulation, worldBrief),
      );
    }
    if (!gate.ok) {
      await stream.emit('qa', 'QA', {
        tool: 'world-quality-gate',
        summary: `World quality gate failed after ${fixAttempt} FIX: ${gate.issues.slice(0, 3).join('; ')}`,
        details: { issues: gate.issues, metrics: gate.metrics },
      });
      // WORLD_QUALITY_GATE=true means hard-fail (STRICT also accepted)
      const soft =
        process.env['WORLD_QUALITY_GATE_STRICT'] === 'false' ||
        process.env['WORLD_QUALITY_GATE'] === 'soft';
      if (!soft) {
        throw new Error(`World quality gate: ${gate.issues.join('; ')}`);
      }
    } else {
      await stream.emit('qa', 'QA', {
        tool: 'world-quality-gate',
        summary:
          fixAttempt > 0
            ? `World quality gate passed after ${fixAttempt} FIX`
            : 'World quality gate passed',
        details: { metrics: gate.metrics },
      });
    }
  }

  const sim = new WorldSimulator(world);
  world = sim.tick(0).world;

  const livingTown =
    world.presentation.narrativeSeed === 'society-gathering-observe' ||
    (world.entities.filter((e) => e.kind === 'npc').length >= 8 &&
      !world.entities.some((e) => e.kind === 'enemy'));
  const dynamicsWeights = livingTown
    ? undefined
    : maybeTrainInlineDynamics(world);
  if (dynamicsWeights) {
    const stamped = applyNeuralDifficultyTunables(world, dynamicsWeights);
    world = stamped.world;
    if (stamped.proposal) {
      await stream.emit('planner', 'WORLD', {
        tool: 'l2-hybrid-world-model',
        summary: `L2 神经模型调参：敌人速度 ${stamped.proposal.tunables.enemySpeed} · 血量系数 ${stamped.proposal.tunables.enemyHpScale}（preferAction=${stamped.proposal.preferredAction}）`,
        details: {
          weightsChars: dynamicsWeights.length,
          tunables: stamped.proposal.tunables,
          confidence: stamped.proposal.confidence,
          meanSurprise: stamped.proposal.meanSurprise,
          combatPressure: stamped.proposal.combatPressure,
          rationale: stamped.proposal.rationale,
        },
      });
    } else {
      await stream.emit('planner', 'PLAN', {
        summary: 'Neural dynamics warmed（未产出可用调参，游戏沿用默认难度）',
        details: { weightsChars: dynamicsWeights.length },
      });
    }
  }

  const facts = extractFactsFromWorld(world);
  const memory = facts.map((f, i) => ({
    id: `fact_${i}`,
    kind: 'fact' as const,
    text: f,
    tags: ['world'],
    createdAt: new Date().toISOString(),
    importance: 1,
  }));

  const [existing] = await db
    .select()
    .from(worlds)
    .where(eq(worlds.projectId, projectId))
    .limit(1);

  if (existing) {
    world = parseWorldSpec({
      ...world,
      meta: { ...world.meta, version: existing.tipRevision + 1 },
    });
  }

  let worldId: string;
  if (existing) {
    worldId = existing.id;
    await db
      .update(worlds)
      .set({
        title: world.meta.title,
        tipRevision: world.meta.version,
        specJson: world,
        memoryJson: memory,
        updatedAt: new Date(),
      })
      .where(eq(worlds.id, worldId));
  } else {
    worldId = randomUUID();
    await db.insert(worlds).values({
      id: worldId,
      projectId,
      title: world.meta.title,
      tipRevision: world.meta.version,
      specJson: world,
      memoryJson: memory,
    });
  }

  await db.insert(worldRevisions).values({
    worldId,
    revision: world.meta.version,
    parentRevision: existing ? existing.tipRevision : null,
    opJson: {
      op: 'create',
      prompt: prompt.slice(0, 500),
      planner: planned.source,
      dynamics: Boolean(dynamicsWeights),
    },
    specJson: world,
    summary: `world_generate:${planned.source}`,
  });

  const workRoot = readWorkRoot();
  const workspace = projectWorkspaceRoot(workRoot, projectId);
  await stream.emit('coder', 'CODE', {
    summary: `写入 ${world.presentation.mode} Presenter（零业务逻辑 TS）`,
  });
  await stream.emit('artist', 'ASSET', {
    summary: '小镇出图：地砖 + 居民立绘（不做四向走路片）',
  });
  await writePresenterWorkspace(workspace, world, {
    onAssetProgress: (summary) => {
      void stream.emit('artist', 'ASSET', { summary });
    },
    // The art phase is 25–90 MiniMax images; ship the walkable presenter first so
    // the user is exploring their world while the pictures are still rendering.
    onScaffoldReady: async () => {
      if (process.env['WORLD_EARLY_SKELETON_PREVIEW'] === 'false') return;
      try {
        const shell = await npmInstallAndBuild(workspace, {
          ...process.env,
          GEMINI_SANDBOX: process.env['GEMINI_SANDBOX'] ?? 'false',
        });
        if (!shell.buildOk) {
          await stream.emit('qa', 'BUILD', {
            summary: '骨架世界预览跳过：脚手架未通过构建',
            details: { stderr: shell.stderr.slice(-400) },
          });
          return;
        }
        const published = await publishWorldPreviewDist({
          db,
          s3,
          env,
          projectId,
          jobId,
          workspace,
          worldId,
          planner: planned.source,
          skeleton: true,
        });
        await stream.emit('system', 'PREVIEW', {
          summary: '骨架世界预览已部署 — 可以先进去走走，出图与社会种子完成后自动替换',
          details: {
            deploymentId: published.deploymentId,
            artifactId: published.artifactId,
            previewUrl: published.previewUrl,
            skeleton: true,
            worldId,
          },
        });
      } catch (err) {
        await stream.emit('qa', 'BUILD', {
          summary: '骨架世界预览跳过（非致命）',
          details: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    },
  });
  let lastWorldAssetFailover: string[] = [];
  try {
    const briefRaw = await fsp.readFile(
      path.join(workspace, 'public', 'ASSET_BRIEF.json'),
      'utf8',
    );
    const brief = JSON.parse(briefRaw) as {
      failoverEvents?: string[];
      assetQuality?: string;
    };
    lastWorldAssetFailover = brief.failoverEvents ?? [];
    await stream.emit('artist', 'ASSET', {
      summary:
        lastWorldAssetFailover.length > 0
          ? `World 资产完成（含提供商 failover/软跳过；quality=${brief.assetQuality ?? 'mixed-failover'}）`
          : 'World MiniMax assets written',
      details: {
        quality: brief.assetQuality ?? 'minimax',
        failoverEvents: lastWorldAssetFailover,
      },
    });
  } catch {
    await stream.emit('artist', 'ASSET', {
      summary: 'World MiniMax assets written',
    });
  }

  const assetDisk = runWorldAssetDiskGate(workspace);
  if (!assetDisk.ok) {
    const onlyRpgSlots = assetDisk.issues.every((i) =>
      /缺少世界美术 (enemy|item)\.png/.test(i),
    );
    if (onlyRpgSlots) {
      const npcPng = path.join(workspace, 'public', 'assets', 'npc.png');
      if (fs.existsSync(npcPng)) {
        for (const name of ['enemy.png', 'item.png'] as const) {
          const dest = path.join(workspace, 'public', 'assets', name);
          if (!fs.existsSync(dest)) await fsp.copyFile(npcPng, dest);
        }
      }
    }
  }
  const assetDiskAfterAlias = runWorldAssetDiskGate(workspace);
  if (!assetDiskAfterAlias.ok) {
    await stream.emit('qa', 'QA', {
      tool: 'world-asset-disk-gate',
      summary: `World asset disk gate failed: ${assetDiskAfterAlias.issues.slice(0, 3).join('; ')}`,
      details: { issues: assetDiskAfterAlias.issues },
    });
    // One MiniMax retry
    try {
      const retry = await runWorldAssetPhase(workspace, world, {
        allowImageFallback: true,
        onProgress: (summary) => {
          console.log(`[world-asset] ${summary}`);
          void stream.emit('artist', 'ASSET', { summary });
        },
      });
      lastWorldAssetFailover = retry.failoverEvents;
      if (retry.failoverEvents.length > 0) {
        await stream.emit('artist', 'ASSET', {
          summary: 'World ASSET 重试完成（含 failover/软跳过）',
          details: {
            quality: retry.quality,
            failoverEvents: retry.failoverEvents,
          },
        });
      }
      const again = runWorldAssetDiskGate(workspace);
      if (!again.ok) {
        throw new Error(again.issues.join('; '));
      }
    } catch (err) {
      throw new Error(
        `World real assets required: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } else {
    await stream.emit('qa', 'QA', {
      tool: 'world-asset-disk-gate',
      summary: 'World MiniMax assets on disk verified',
      details:
        lastWorldAssetFailover.length > 0
          ? { failoverEvents: lastWorldAssetFailover }
          : undefined,
    });
  }

  if (dynamicsWeights) {
    await fsp.writeFile(
      path.join(workspace, 'public', 'dynamics.json'),
      JSON.stringify({
        format: 'opengame-world-mlp-v1',
        weights: JSON.parse(dynamicsWeights),
      }),
      'utf8',
    );
  }

  world = await applySpatialResults(workspace, world, stream);
  {
    const missing = regionIdsMissingSpatial(world);
    if (missing.length > 0) {
      await stream.emit('artist', 'ASSET', {
        summary: '补刷缺海报区域（depth pad / 非 startRegion）',
        details: { regionIds: missing },
      });
      world = await applySpatialResults(workspace, world, stream, {
        regionIds: missing,
      });
    }
  }
  assertWorldL3Playable(world, stream);

  await db
    .update(worlds)
    .set({
      specJson: world,
      tipRevision: world.meta.version,
      updatedAt: new Date(),
    })
    .where(eq(worlds.id, worldId));

  // Seed society BEFORE vite build so public/society_replay.json lands in dist
  const npcCount = world.entities.filter((e) => e.kind === 'npc').length;
  let societySeed: {
    events: number;
    simTime: number;
    dialogues: number;
    degraded?: boolean;
    gateFailed?: boolean;
    retrievalDegraded?: boolean;
    report: { summary: string; informationSpread: { rate: number } };
  } | null = null;
  if (npcCount >= 2 && process.env['PLATFORM_SKIP_SOCIETY_SEED'] !== 'true') {
    const seedHours = resolveSocietySeedHours(options.societySeedHours);
    const softSeed = societySeedSoftEnabled();
    try {
      const { runWorldSocietyJob } = await import('./societyRunner.js');
      await stream.emit('planner', 'WORLD', {
        summary: `社会种子快进 ${seedHours}h（${npcCount} agents，短时真对白）— 观测台主路径`,
      });
      societySeed = await runWorldSocietyJob({
        db,
        stream,
        projectId,
        jobId,
        hours: seedHours,
        seedText: openingRumorFromSpec(
          world.entities.find((e) => e.kind === 'npc')?.name ??
            anonymousLeadName(world),
          world,
        ),
        invitationText: gatheringInvitationText(world),
        redis: options.redis ?? undefined,
        useLlm: process.env['PLATFORM_SOCIETY_SEED_LLM'] !== '0',
      });
      const seedGate = evaluateSocietySeedGate({
        hours: seedHours,
        spreadRate: societySeed.report.informationSpread.rate,
        dialogues: societySeed.dialogues ?? 0,
        profile: resolveGenreProfile(world),
        citesMemory: (
          societySeed.report as {
            dialogueQuality?: { citesMemory?: number };
          }
        ).dialogueQuality?.citesMemory,
        followsLast: (
          societySeed.report as {
            dialogueQuality?: { followsLast?: number };
          }
        ).dialogueQuality?.followsLast,
      });
      const gateFailed = seedGate.gateFailed && !softSeed;
      societySeed = { ...societySeed, gateFailed };
      await stream.emit('qa', 'WORLD', {
        tool: 'society-emergence',
        summary:
          (societySeed.dialogues ?? 0) > 0
            ? `社会种子完成 · ${societySeed.dialogues} 句真对白 · spread=${(societySeed.report.informationSpread.rate * 100).toFixed(0)}% · ${societySeed.report.summary}`
            : `社会种子完成 · 钟已打响，尚无真对白 · spread=${(societySeed.report.informationSpread.rate * 100).toFixed(0)}% · ${societySeed.report.summary}`,
        details: {
          report: societySeed.report,
          hours: seedHours,
          dialogues: societySeed.dialogues,
          degraded: societySeed.degraded,
          spreadOk: seedGate.spreadOk,
          gateFailed,
          seed: true,
        },
      });
      if (gateFailed) {
        throw new Error(
          seedGate.reason === 'dialogue'
            ? `社会种子门禁失败：0 句真对白（${seedHours}h）`
            : seedGate.reason === 'judge'
              ? `社会种子门禁失败：对白只在复读，没有引用记忆`
              : `社会种子门禁失败：传播率 ${(societySeed.report.informationSpread.rate * 100).toFixed(0)}% < ${(seedGate.minSpread * 100).toFixed(0)}%`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : '';
      const keysDead =
        err instanceof SocietyLlmKeysExhaustedError ||
        name === 'SocietyLlmKeysExhaustedError' ||
        /全部无效|keys_exhausted|401/.test(msg);
      const seedDead =
        name === 'SocietySeedGateError' ||
        /社会种子门禁|emergence gate/.test(msg) ||
        keysDead;
      await stream.emit('qa', 'WORLD', {
        tool: 'society-emergence',
        summary: keysDead
          ? `社会种子失败：推理密钥无效，未降级。${msg}`
          : `社会种子失败：${msg}`,
        details: {
          seed: true,
          spreadOk: false,
          gateFailed: !softSeed,
          dialogues: societySeed?.dialogues ?? 0,
          error: msg,
        },
      });
      if (!softSeed && seedDead) {
        await db
          .update(jobs)
          .set({
            status: 'failed',
            updatedAt: new Date(),
            result: {
              error: msg,
              societySeed: {
                gateFailed: true,
                dialogues: societySeed?.dialogues ?? 0,
                spread: societySeed?.report.informationSpread.rate ?? 0,
              },
            },
            logKey: msg.slice(0, 1500),
          })
          .where(eq(jobs.id, jobId));
        await stream.emit('system', 'FAIL', {
          summary: `社会种子失败：${msg.slice(0, 280)}`,
        });
        return;
      }
    }
  }

  await ensureSocietyReplayBeforeBuild({
    db,
    worldId,
    projectId,
    workspace,
    stream,
  });

  await stream.emit('qa', 'BUILD', { summary: 'npm install + vite build' });
  const buildStartedAt = Date.now();
  const build = await npmInstallAndBuild(workspace, {
    ...process.env,
    GEMINI_SANDBOX: process.env['GEMINI_SANDBOX'] ?? 'false',
  });
  if (build.buildOk) {
    const skipped = ['npm install', 'vite build'].filter((step) =>
      build.stdout.includes(`${step} skipped`),
    );
    await stream.emit('qa', 'BUILD', {
      summary:
        skipped.length > 0
          ? `World presenter 构建通过（跳过 ${skipped.join(' / ')}）`
          : 'World presenter 构建通过',
      details: { skipped },
      elapsedMs: Date.now() - buildStartedAt,
    });
  }
  if (!build.buildOk) {
    await db
      .update(jobs)
      .set({
        status: 'failed',
        updatedAt: new Date(),
        result: {
          error: 'world presenter build failed',
          stderr: build.stderr.slice(-2000),
        },
        logKey: build.stderr.slice(-1500) || 'world presenter build failed',
      })
      .where(eq(jobs.id, jobId));
    await stream.emit('system', 'FAIL', {
      summary: `World presenter 构建失败: ${build.stderr.slice(-280) || 'unknown'}`,
      details: { stderr: build.stderr.slice(-500) },
    });
    return;
  }

  const { deploymentId, previewUrl, distPrefix: s3Prefix } =
    await publishWorldPreviewDist({
      db,
      s3,
      env,
      projectId,
      jobId,
      workspace,
      worldId,
      planner: planned.source,
    });
  await enableResidentClockAfterPreview(db, worldId, world);

  await db.insert(usageEvents).values({
    organizationId,
    jobId,
    modality: 'world_generate',
    units: '1',
    meta: { jobType: 'world_generate', planner: planned.source },
  });

  // Mirror replay to S3 again (dist upload may race / public copy may be empty on seed fail)
  try {
    const { writeSocietyReplayArtifact } = await import(
      './societyReplayExport.js'
    );
    const written = await writeSocietyReplayArtifact({
      db,
      worldId,
      projectId,
      workspace,
      s3,
      env,
      distPrefix: s3Prefix,
    });
    await stream.emit('qa', 'WORLD', {
      summary: `小镇回放包已同步 society_replay.json（${written.eventCount} 事件）`,
      details: written,
    });
  } catch (exportErr) {
    await stream.emit('qa', 'WORLD', {
      summary: `society_replay.json 导出失败（观测台仍可用）：${exportErr instanceof Error ? exportErr.message : String(exportErr)}`,
    });
  }

  await db
    .update(jobs)
    .set({
      status: 'succeeded',
      updatedAt: new Date(),
      result: {
        worldId,
        deploymentId,
        previewUrl,
        planner: planned.source,
        dynamicsTrained: Boolean(dynamicsWeights),
        summary: summarizeWorldSpec(world, 300),
        gameplay: toGameplayManifest(world),
        societySeed: societySeed
          ? {
              events: societySeed.events,
              simTime: societySeed.simTime,
              hours: resolveSocietySeedHours(options.societySeedHours),
              spread: societySeed.report.informationSpread.rate,
              dialogues: societySeed.dialogues,
              degraded: societySeed.degraded ?? false,
              gateFailed: societySeed.gateFailed ?? false,
              retrievalDegraded: societySeed.retrievalDegraded ?? false,
            }
          : null,
      },
    })
    .where(eq(jobs.id, jobId));

  await stream.emit('system', 'DONE', {
    summary: societySeed
      ? `世界已生成：${world.meta.title} · 社会已种子化（观察/干预）`
      : `世界已生成：${world.meta.title} (${planned.source})`,
    details: { worldId, deploymentId, previewUrl, societySeed },
  });

  await appendSessionTimeline(
    db,
    options.sessionId,
    `World ready: ${world.meta.title}. Town observe stage plays society_replay (not RPG quests).`,
  );

  try {
    await putObjectUtf8(
      s3,
      env,
      `projects/${projectId}/worlds/${worldId}/tip.json`,
      JSON.stringify(world),
      'application/json',
    );
  } catch {
    // non-fatal
  }
}

export async function runWorldEditJob(options: {
  readonly db: DrizzleDb;
  readonly s3: S3Client;
  readonly env: WorkerEnv;
  readonly stream: AgentEventStream;
  readonly organizationId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly prompt: string;
  readonly op?: unknown;
  readonly sessionId?: string | null;
  /** Tip Spec already updated (e.g. API agentic) — only rebuild presenter + deploy. */
  readonly rebuildOnly?: boolean;
}): Promise<void> {
  const { db, s3, env, stream, projectId, jobId, prompt, organizationId } =
    options;

  const [row] = await db
    .select()
    .from(worlds)
    .where(eq(worlds.projectId, projectId))
    .limit(1);
  if (!row) {
    throw new Error('No world for project — run world_generate first');
  }

  if (options.rebuildOnly) {
    const tipWorld = parseWorldSpec(row.specJson);
    assertWorldL3Playable(tipWorld, stream);
    const workRoot = readWorkRoot();
    const workspace = projectWorkspaceRoot(workRoot, projectId);
    await writePresenterWorkspace(workspace, tipWorld);
    await ensureSocietyReplayBeforeBuild({
      db,
      worldId: row.id,
      projectId,
      workspace,
      stream,
    });
    await stream.emit('qa', 'BUILD', {
      summary: 'Rebuild presenter from tip Spec (post-agentic)',
    });
    // The observatory button is "rebuild the picture". A src-fingerprint skip
    // would re-upload yesterday's dist and the names-over-bubbles bug stays.
    clearWorkspaceBuildCache(workspace);
    const build = await npmInstallAndBuild(
      workspace,
      {
        ...process.env,
        GEMINI_SANDBOX: process.env['GEMINI_SANDBOX'] ?? 'false',
      },
      { forceBuild: true },
    );
    if (!build.buildOk) {
      await db
        .update(jobs)
        .set({
          status: 'failed',
          updatedAt: new Date(),
          result: {
            error: 'presenter rebuild failed',
            stderr: build.stderr.slice(-2000),
          },
          logKey: build.stderr.slice(-1500) || 'presenter rebuild failed',
        })
        .where(eq(jobs.id, jobId));
      await stream.emit('system', 'FAIL', {
        summary: `Presenter rebuild 失败: ${build.stderr.slice(-280) || 'unknown'}`,
      });
      return;
    }
    const artifactId = randomUUID();
    const s3Prefix = playBundlePrefix(projectId, artifactId);
    const distDir = path.join(workspace, 'dist');
    const { entryKey } = await uploadDirectoryToS3(s3, env, s3Prefix, distDir);
    try {
      const { writeSocietyReplayArtifact } = await import(
        './societyReplayExport.js'
      );
      await writeSocietyReplayArtifact({
        db,
        worldId: row.id,
        projectId,
        workspace,
        s3,
        env,
        distPrefix: s3Prefix,
      });
    } catch {
      // non-fatal
    }
    await db.insert(artifacts).values({
      id: artifactId,
      jobId,
      storagePrefix: s3Prefix,
      manifest: {
        kind: 'vite-dist',
        distPrefix: s3Prefix,
        entryKey,
        worldId: row.id,
        rebuildOnly: true,
        tipRevision: row.tipRevision,
      },
      contentHash: null,
    });
    const deploymentId = randomUUID();
    const previewUrl = entryKey;
    await db.insert(deployments).values({
      id: deploymentId,
      projectId,
      artifactId,
      channel: 'preview',
      previewUrl,
    });
    await db
      .update(jobs)
      .set({
        status: 'succeeded',
        updatedAt: new Date(),
        result: {
          rebuildOnly: true,
          tipRevision: row.tipRevision,
          artifactId,
          deploymentId,
          previewUrl,
        },
      })
      .where(eq(jobs.id, jobId));
    await stream.emit('system', 'DONE', {
      summary: `Presenter rebuilt · r${row.tipRevision}`,
      details: { previewUrl },
    });
    return;
  }

  const world = parseWorldSpec(row.specJson);
  const store = createMemoryStore(
    (row.memoryJson as WorldMemoryEntry[] | null) ?? [],
  );
  const sparse = formatWorldContextForPrompt(world, store, prompt, 3000);

  await stream.emit('planner', 'PLAN', {
    summary: 'World edit（稀疏上下文 + LLM Op）',
    details: { chars: sparse.length },
  });

  const op = options.op;
  let opSource = 'structured';

  if (
    !op &&
    /\b(agentic|pilot|director|智能体编排|导演|领航)\b/i.test(prompt)
  ) {
    await stream.emit('planner', 'PLAN', {
      summary: 'Agentic harness（Pilot + Director，借鉴 LingBot-World-v2）',
    });
    const harness = await runAgenticHarness({ world, intent: prompt });
    opSource = `agentic:${harness.proposals.map((p) => p.source).join('+')}`;
    await stream.emit('planner', 'PLAN', {
      summary: `Agentic applied ${harness.applied.length} ops`,
      details: {
        issues: harness.issues.slice(0, 5),
        roles: harness.proposals.map((p) => ({
          role: p.role,
          rationale: p.rationale.slice(0, 120),
          source: p.source,
        })),
      },
    });
    const nextVersion = Math.max(row.tipRevision + 1, harness.world.meta.version);
    const nextWorld = parseWorldSpec({
      ...harness.world,
      meta: { ...harness.world.meta, version: nextVersion },
    });
    await db
      .update(worlds)
      .set({
        tipRevision: nextVersion,
        specJson: nextWorld,
        title: nextWorld.meta.title,
        updatedAt: new Date(),
      })
      .where(eq(worlds.id, row.id));
    await db.insert(worldRevisions).values({
      worldId: row.id,
      revision: nextVersion,
      parentRevision: row.tipRevision,
      opJson: {
        op: 'agentic_harness',
        intent: prompt.slice(0, 400),
        applied: harness.applied,
        planner: opSource,
      },
      specJson: nextWorld,
      summary: `agentic:${harness.applied.length}ops`,
    });
    const workRoot = readWorkRoot();
    const workspace = projectWorkspaceRoot(workRoot, projectId);
    let refreshedWorld = nextWorld;
    const dirtyRegions = regionIdsFromOps(nextWorld, harness.applied);
    if (dirtyRegions.length > 0 || harness.applied.length > 0) {
      await stream.emit('artist', 'ASSET', {
        summary: 'Agentic 后刷新 dirty 区域 L3/空间资产',
        details: { regionIds: dirtyRegions },
      });
      refreshedWorld = await applySpatialResults(
        workspace,
        nextWorld,
        stream,
        dirtyRegions.length ? { regionIds: dirtyRegions } : undefined,
      );
      await db
        .update(worlds)
        .set({
          specJson: refreshedWorld,
          updatedAt: new Date(),
        })
        .where(eq(worlds.id, row.id));
    }
    assertWorldL3Playable(refreshedWorld, stream);
    const softGate = runWorldQualityGate(refreshedWorld, {
      profile: resolveGenreProfile(refreshedWorld),
    });
    if (!softGate.ok) {
      await stream.emit('qa', 'QA', {
        tool: 'world-quality-gate',
        summary: `Agentic 后软门禁提示: ${softGate.issues.slice(0, 3).join('; ')}`,
        details: { issues: softGate.issues, metrics: softGate.metrics },
      });
    }
    await writePresenterWorkspace(workspace, refreshedWorld);
    await ensureSocietyReplayBeforeBuild({
      db,
      worldId: row.id,
      projectId,
      workspace,
      stream,
    });
    await stream.emit('qa', 'BUILD', { summary: 'Rebuild presenter after agentic' });
    const build = await npmInstallAndBuild(workspace, {
      ...process.env,
      GEMINI_SANDBOX: process.env['GEMINI_SANDBOX'] ?? 'false',
    });
    if (!build.buildOk) {
      await db
        .update(jobs)
        .set({
          status: 'failed',
          updatedAt: new Date(),
          result: { error: 'presenter rebuild failed', stderr: build.stderr.slice(-2000) },
          logKey: build.stderr.slice(-1500) || 'presenter rebuild failed',
        })
        .where(eq(jobs.id, jobId));
      await stream.emit('system', 'FAIL', {
        summary: `Presenter rebuild 失败: ${build.stderr.slice(-280) || 'unknown'}`,
        details: { stderr: build.stderr.slice(-500) },
      });
      return;
    }
    const artifactId = randomUUID();
    const s3Prefix = playBundlePrefix(projectId, artifactId);
    const distDir = path.join(workspace, 'dist');
    const { entryKey } = await uploadDirectoryToS3(s3, env, s3Prefix, distDir);
    try {
      const { writeSocietyReplayArtifact } = await import(
        './societyReplayExport.js'
      );
      await writeSocietyReplayArtifact({
        db,
        worldId: row.id,
        projectId,
        workspace,
        s3,
        env,
        distPrefix: s3Prefix,
      });
    } catch {
      // non-fatal
    }
    await db.insert(artifacts).values({
      id: artifactId,
      jobId,
      storagePrefix: s3Prefix,
      manifest: {
        kind: 'vite-dist',
        distPrefix: s3Prefix,
        entryKey,
        worldId: row.id,
        planner: opSource,
        dirtyRegions,
      },
      contentHash: null,
    });
    const deploymentId = randomUUID();
    const previewUrl = entryKey;
    await db.insert(deployments).values({
      id: deploymentId,
      projectId,
      artifactId,
      channel: 'preview',
      previewUrl,
    });
    await db
      .update(jobs)
      .set({
        status: 'succeeded',
        updatedAt: new Date(),
        result: {
          worldId: row.id,
          deploymentId,
          previewUrl,
          planner: opSource,
          dirtyRegions,
          summary: summarizeWorldSpec(refreshedWorld, 300),
        },
      })
      .where(eq(jobs.id, jobId));
    await stream.emit('system', 'DONE', {
      summary: 'Agentic world edit 完成',
      details: { previewUrl, revision: nextVersion, dirtyRegions },
    });
    await appendSessionTimeline(
      db,
      options.sessionId,
      `World updated (agentic). Preview refreshed — keep playing on the right.`,
    );
    return;
  }

  let ops: WorldOp[] = [];
  if (options.op) {
    ops = [options.op as WorldOp];
    opSource = 'structured';
  } else {
    const planned = await planWorldOps(prompt, summarizeWorldSpec(world, 1200));
    opSource = planned.source;
    if (!planned.understood || planned.ops.length === 0) {
      await stream.emit('planner', 'PLAN', {
        summary: '未理解该世界编辑指令（拒绝弱 set_flag）',
        details: { issues: planned.issues },
      });
      throw new Error(
        `未理解该世界编辑指令，请更具体地描述要扩区/改 NPC/改布局等。${planned.issues.slice(0, 2).join('; ')}`,
      );
    }
    ops = planned.ops;
    await stream.emit('planner', 'PLAN', {
      summary: `World edit · ${ops.length} Op(s) (${opSource})`,
      details: { ops: ops.map((o) => o.op), issues: planned.issues.slice(0, 3) },
    });
  }

  let current = world;
  let parentRev = row.tipRevision;
  const allDirty: string[] = [];
  const summaries: string[] = [];
  let lastRevision: NonNullable<
    ReturnType<typeof applyWorldOp>['revision']
  > | null = null;

  for (const op of ops) {
    const result = applyWorldOp(current, op, {
      parentRevision: parentRev,
    });
    if (!result.ok || !result.world || !result.revision) {
      throw new Error(result.issues.join('; ') || 'world edit failed');
    }
    current = result.world;
    parentRev = result.world.meta.version;
    allDirty.push(...result.dirtyAssetKeys);
    summaries.push(result.revision.summary);
    lastRevision = result.revision;
  }

  if (!lastRevision) {
    throw new Error('world edit produced no revision');
  }

  // Product depth after multi-op edit (pad thin worlds without pretending they are interesting)
  let paddedRegionIds: string[] = [];
  {
    const depth = ensureWorldDepth(current, {
      mode: 'society',
      profile: resolveGenreProfile(current),
      padPopulation: 'min',
    });
    if (depth.padded) {
      current = depth.world;
      paddedRegionIds = [...depth.addedRegionIds];
      await stream.emit('planner', 'PLAN', {
        summary: `编辑后 depth pad · regions ${depth.before.regions}→${depth.after.regions}, npcs ${depth.before.npcs}→${depth.after.npcs}`,
        details: {
          before: depth.before,
          after: depth.after,
          addedRegionIds: depth.addedRegionIds,
          mode: 'society',
        },
      });
    } else {
      current = depth.world;
    }
  }

  const workRoot = readWorkRoot();
  const workspace = projectWorkspaceRoot(workRoot, projectId);
  let editedWorld = current;
  const dirtyRegions = [
    ...new Set([
      ...regionIdsFromDirtyKeys(editedWorld, allDirty),
      ...paddedRegionIds,
      ...regionIdsMissingSpatial(editedWorld),
    ]),
  ];
  if (dirtyRegions.length > 0) {
    await stream.emit('artist', 'ASSET', {
      summary: '编辑后刷新 dirty/缺海报区域空间资产',
      details: { dirtyAssetKeys: allDirty, regionIds: dirtyRegions },
    });
    editedWorld = await applySpatialResults(workspace, editedWorld, stream, {
      regionIds: dirtyRegions,
    });
  }

  await db
    .update(worlds)
    .set({
      tipRevision: editedWorld.meta.version,
      specJson: editedWorld,
      title: editedWorld.meta.title,
      updatedAt: new Date(),
    })
    .where(eq(worlds.id, row.id));

  await db.insert(worldRevisions).values({
    worldId: row.id,
    revision: lastRevision.revision,
    parentRevision: lastRevision.parentRevision,
    opJson: {
      ...(ops.length === 1
        ? (lastRevision.op as object)
        : { op: 'multi', ops }),
      planner: opSource,
      dirtyAssetKeys: allDirty,
      dirtyRegions,
      diffSummary: diffWorldSpecs(world, editedWorld),
    },
    specJson: editedWorld,
    summary: summaries.join('; ').slice(0, 200),
  });

  const keepNpcIds = editedWorld.entities
    .filter((e) => e.kind === 'npc')
    .map((e) => e.id);
  if (societyEditSyncMode(prompt) === 'restart') {
    await restartSocietyLivingState(db, row.id);
    await stream.emit('planner', 'WORLD', {
      summary:
        '编辑后重开社会生活：日程、传闻与站位按新设定重来（旧日志已清空）',
      details: { sync: 'restart', keepNpcs: keepNpcIds.length },
    });
  } else {
    await pruneSocietyAgentsNotIn(db, row.id, keepNpcIds);
    await clearSocietyDayPlans(db, row.id);
    await stream.emit('planner', 'WORLD', {
      summary: '编辑后丢掉过期日程，下一次心跳按新地图重排；仍在的居民保留传闻',
      details: { sync: 'patch', keepNpcs: keepNpcIds.length },
    });
  }

  assertWorldL3Playable(editedWorld, stream);
  const softGate = runWorldQualityGate(editedWorld, {
    profile: resolveGenreProfile(editedWorld),
  });
  if (!softGate.ok) {
    await stream.emit('qa', 'QA', {
      tool: 'world-quality-gate',
      summary: `编辑后软门禁提示: ${softGate.issues.slice(0, 3).join('; ')}`,
      details: { issues: softGate.issues, metrics: softGate.metrics },
    });
  }
  await writePresenterWorkspace(workspace, editedWorld);
  await ensureSocietyReplayBeforeBuild({
    db,
    worldId: row.id,
    projectId,
    workspace,
    stream,
  });

  await stream.emit('qa', 'BUILD', { summary: 'Rebuild presenter after edit' });
  const build = await npmInstallAndBuild(workspace, {
    ...process.env,
    GEMINI_SANDBOX: process.env['GEMINI_SANDBOX'] ?? 'false',
  });

  let deploymentId: string | undefined;
  let previewUrl: string | undefined;
  if (build.buildOk) {
    const artifactId = randomUUID();
    const s3Prefix = playBundlePrefix(projectId, artifactId);
    const { entryKey } = await uploadDirectoryToS3(
      s3,
      env,
      s3Prefix,
      path.join(workspace, 'dist'),
    );
    try {
      const { writeSocietyReplayArtifact } = await import(
        './societyReplayExport.js'
      );
      await writeSocietyReplayArtifact({
        db,
        worldId: row.id,
        projectId,
        workspace,
        s3,
        env,
        distPrefix: s3Prefix,
      });
    } catch {
      // non-fatal
    }
    await db.insert(artifacts).values({
      id: artifactId,
      jobId,
      storagePrefix: s3Prefix,
      manifest: {
        kind: 'vite-dist',
        distPrefix: s3Prefix,
        entryKey,
        worldId: row.id,
        dirty: allDirty,
        dirtyRegions,
      },
    });
    deploymentId = randomUUID();
    previewUrl = entryKey;
    await db.insert(deployments).values({
      id: deploymentId,
      projectId,
      artifactId,
      channel: 'preview',
      previewUrl,
    });
  }

  await db
    .update(jobs)
    .set({
      status: build.buildOk ? 'succeeded' : 'failed',
      updatedAt: new Date(),
      result: {
        worldId: row.id,
        op: ops.length === 1 ? lastRevision.op : { op: 'multi', ops },
        opSource,
        dirtyAssetKeys: allDirty,
        dirtyRegions,
        deploymentId,
        previewUrl,
        summary: summaries.join('; '),
        ...(build.buildOk
          ? {}
          : { error: 'presenter rebuild failed', stderr: build.stderr.slice(-2000) }),
      },
      ...(build.buildOk
        ? {}
        : { logKey: build.stderr.slice(-1500) || 'presenter rebuild failed' }),
    })
    .where(eq(jobs.id, jobId));

  await db.insert(usageEvents).values({
    organizationId,
    jobId,
    modality: 'world_edit',
    units: '1',
    meta: { jobType: 'world_edit' },
  });

  if (!build.buildOk) {
    await stream.emit('system', 'FAIL', {
      summary: `世界已编辑但 Presenter 构建失败: ${build.stderr.slice(-240) || 'unknown'}`,
      details: { stderr: build.stderr.slice(-500), dirtyAssetKeys: allDirty },
    });
    return;
  }

  await stream.emit('system', 'DONE', {
    summary: `世界已编辑：${summaries.join('; ')} (${opSource})`,
    details: { dirtyAssetKeys: allDirty, dirtyRegions, deploymentId },
  });
  await appendSessionTimeline(
    db,
    options.sessionId,
    dirtyRegions.length > 0
      ? `World edited: ${summaries.join('; ')}. Refreshed posters for regions: ${dirtyRegions.slice(0, 6).join(', ')}. Open preview to verify new areas are not stale.`
      : `World edited: ${summaries.join('; ')}. Preview refreshed.`,
  );
}

/** Collect trajectories + train dynamics MLP for a project's tip world. */
export async function runWorldTrainJob(options: {
  readonly db: DrizzleDb;
  readonly stream: AgentEventStream;
  readonly organizationId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly episodes?: number;
  readonly epochs?: number;
}): Promise<void> {
  const { db, stream, projectId, jobId, organizationId } = options;
  const [row] = await db
    .select()
    .from(worlds)
    .where(eq(worlds.projectId, projectId))
    .limit(1);
  if (!row) throw new Error('No world to train on');

  const world = parseWorldSpec(row.specJson);
  await stream.emit('planner', 'PLAN', {
    summary: 'Neural dynamics: collect trajectories + train MLP',
  });

  const traj = collectTrajectories({
    episodes: options.episodes ?? 24,
    stepsPerEpisode: 32,
    policy: 'scripted',
    seedWorld: world,
  });
  const samples = traj.map((t) => ({
    x: [...t.obs, ...t.actionVec],
    y: t.nextObs,
  }));
  const trained = trainMlp(samples, {
    epochs: options.epochs ?? 40,
    lr: 0.02,
    batchSize: 64,
  });

  const workRoot = readWorkRoot();
  const workspace = projectWorkspaceRoot(workRoot, projectId);
  await fsp.mkdir(path.join(workspace, 'public'), { recursive: true });
  await fsp.writeFile(
    path.join(workspace, 'public', 'dynamics.json'),
    JSON.stringify({
      format: 'opengame-world-mlp-v1',
      finalLoss: trained.finalLoss,
      losses: trained.losses,
      weights: trained.weights,
      steps: traj.length,
      trainedAt: new Date().toISOString(),
    }),
    'utf8',
  );

  const mem = Array.isArray(row.memoryJson)
    ? [...(row.memoryJson as unknown[])]
    : [];
  mem.push({
    id: `dyn_${Date.now().toString(36)}`,
    kind: 'fact',
    text: `dynamics trained loss=${trained.finalLoss.toFixed(5)} steps=${traj.length}`,
    tags: ['neural', 'dynamics'],
    createdAt: new Date().toISOString(),
    importance: 2,
  });
  await db
    .update(worlds)
    .set({ memoryJson: mem, updatedAt: new Date() })
    .where(eq(worlds.id, row.id));

  await db
    .update(jobs)
    .set({
      status: 'succeeded',
      updatedAt: new Date(),
      result: {
        finalLoss: trained.finalLoss,
        steps: traj.length,
        modelPath: 'public/dynamics.json',
      },
    })
    .where(eq(jobs.id, jobId));

  await db.insert(usageEvents).values({
    organizationId,
    jobId,
    modality: 'world_train',
    units: String(traj.length),
    meta: { jobType: 'world_train', steps: traj.length },
  });

  await stream.emit('system', 'DONE', {
    summary: `Dynamics trained · loss=${trained.finalLoss.toFixed(5)}`,
    details: { steps: traj.length },
  });
}

/**
 * Mark the world eligible for a resident clock after a playable preview
 * exists. Do not gift presence or author-watch — empty-page MiniMax is a
 * cost leak. The studio / observatory ping starts the leases.
 */
async function enableResidentClockAfterPreview(
  db: DrizzleDb,
  worldId: string,
  world: WorldSpec,
): Promise<void> {
  const npcs = world.entities.filter((e) => e.kind === 'npc').length;
  if (npcs < 2) return;
  if (
    world.presentation.narrativeSeed !== 'society-gathering-observe' &&
    npcs < 12
  ) {
    return;
  }
  await db
    .update(worlds)
    .set({
      heartbeatEnabled: true,
    })
    .where(eq(worlds.id, worldId));
}
