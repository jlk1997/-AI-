/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** Scaffolding strategy for a project workspace. */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pickTitleNextScene, renderSceneStub } from './kernels/sceneStubs.js';
export { pickTitleNextScene } from './kernels/sceneStubs.js';

export type ScaffoldMode = 'skeleton' | 'legacy-template' | 'engine';

export function projectWorkspaceRoot(workRoot: string, projectId: string): string {
  return path.join(workRoot, 'projects', projectId, 'repo');
}

/** Ensure the per-project repo directory exists before any tool scans or writes. */
export async function ensureProjectWorkspaceDir(workspaceDir: string): Promise<void> {
  await fsp.mkdir(workspaceDir, { recursive: true });
}

/**
 * Legacy single-directory copy strategy. Retained for backward compatibility
 * with deployments that still set `PLATFORM_GAME_TEMPLATE_DIR` and prefer the
 * archetype-style scaffolding. When `PLATFORM_PROJECT_SCAFFOLD_MODE` is unset
 * and skeleton env vars are missing, `readScaffoldMode()` selects this path.
 */
export async function ensureTemplateWorkspace(
  workspaceDir: string,
  templateDir: string,
): Promise<void> {
  const pkg = path.join(workspaceDir, 'package.json');
  if (fs.existsSync(pkg)) {
    return;
  }
  await fsp.mkdir(path.dirname(workspaceDir), { recursive: true });
  await fsp.cp(templateDir, workspaceDir, { recursive: true, force: true });
}

/**
 * When `PLATFORM_GAME_TEMPLATE_DIR` points at `agent-test/templates/core`,
 * this resolves to `packages/runtime` in a normal OpenGame monorepo checkout.
 */
function monorepoRuntimeFileUrlFromGameTemplate(gameTemplateDir: string): string | null {
  const runtimeDir = path.resolve(gameTemplateDir, '../../..', 'packages', 'runtime');
  if (!fs.existsSync(path.join(runtimeDir, 'package.json'))) {
    return null;
  }
  return pathToFileURL(runtimeDir).href;
}

/**
 * Legacy archetype games import `@opengame/runtime`, but the checked-in template
 * historically omitted it from package.json. Inject a `file:` spec so
 * `npm install` inside the worker workspace can resolve the workspace package.
 *
 * Resolution order: `PLATFORM_RUNTIME_PACKAGE_SPEC` → monorepo auto-detect.
 */
export async function ensureLegacyTemplateRuntimePackage(
  workspaceDir: string,
  gameTemplateDir: string,
): Promise<{ patched: boolean; runtimeSpec: string | null }> {
  const pkgPath = path.join(workspaceDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { patched: false, runtimeSpec: null };
  }
  const envSpec = process.env['PLATFORM_RUNTIME_PACKAGE_SPEC']?.trim();
  const runtimeSpec = envSpec || monorepoRuntimeFileUrlFromGameTemplate(gameTemplateDir);
  if (!runtimeSpec) {
    return { patched: false, runtimeSpec: null };
  }
  const raw = await fsp.readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  pkg.dependencies = pkg.dependencies ?? {};
  if (pkg.dependencies['@opengame/runtime'] === runtimeSpec) {
    return { patched: false, runtimeSpec };
  }
  pkg.dependencies['@opengame/runtime'] = runtimeSpec;
  await fsp.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return { patched: true, runtimeSpec };
}

export interface SkeletonOptions {
  /** Absolute path to `packages/runtime/skeleton-assets/`. */
  readonly skeletonDir: string;
  /** npm install spec for `@opengame/runtime` (e.g. `file:/abs/runtime`). */
  readonly runtimeSpec: string;
  /** Optional version pin for the runtime (recorded into a manifest). */
  readonly runtimeVersion?: string;
}

/**
 * Materializes a "near-empty" Vite + Phaser + TS skeleton. Re-runs are no-ops
 * when `package.json` already exists in `workspaceDir`. The Coder Agent fills
 * `src/` afterwards; `main.ts` already wires `@opengame/runtime` so the very
 * first build is playable (renders the placeholder `game.json`).
 */
export async function generateMinimalSkeleton(
  workspaceDir: string,
  opts: SkeletonOptions,
): Promise<{ created: boolean; runtimeSpec: string; runtimeVersion: string | null }> {
  const pkg = path.join(workspaceDir, 'package.json');
  if (fs.existsSync(pkg)) {
    return {
      created: false,
      runtimeSpec: opts.runtimeSpec,
      runtimeVersion: opts.runtimeVersion ?? null,
    };
  }
  if (!fs.existsSync(opts.skeletonDir)) {
    throw new Error(
      `generateMinimalSkeleton: skeleton dir not found: ${opts.skeletonDir}`,
    );
  }
  await fsp.mkdir(workspaceDir, { recursive: true });

  // Walk skeleton-assets, copying each file. `.tpl` files are token-expanded.
  await copyTree(opts.skeletonDir, workspaceDir, {
    __RUNTIME_SPEC__: opts.runtimeSpec,
    __RUNTIME_VERSION__: opts.runtimeVersion ?? '',
  });

  // Move src files into a `src/` subfolder so vite can find them.
  await ensureSrcLayout(workspaceDir);

  // Mark this workspace as a skeleton scaffold for downstream auditing.
  await fsp.writeFile(
    path.join(workspaceDir, '.opengame-scaffold.json'),
    JSON.stringify(
      {
        mode: 'skeleton',
        runtimeSpec: opts.runtimeSpec,
        runtimeVersion: opts.runtimeVersion ?? null,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    created: true,
    runtimeSpec: opts.runtimeSpec,
    runtimeVersion: opts.runtimeVersion ?? null,
  };
}

/** Reads `PLATFORM_RUNTIME_PACKAGE_SPEC` / `PLATFORM_RUNTIME_SKELETON_DIR`. */
export function readSkeletonOptionsFromEnv(): SkeletonOptions {
  const skeletonDir = process.env['PLATFORM_RUNTIME_SKELETON_DIR']?.trim();
  const runtimeSpec = process.env['PLATFORM_RUNTIME_PACKAGE_SPEC']?.trim();
  if (!skeletonDir) {
    throw new Error(
      'PLATFORM_RUNTIME_SKELETON_DIR is required when scaffold mode is "skeleton" (e.g. /opt/opengame/packages/runtime/skeleton-assets)',
    );
  }
  if (!runtimeSpec) {
    throw new Error(
      'PLATFORM_RUNTIME_PACKAGE_SPEC is required when scaffold mode is "skeleton" (e.g. file:/opt/opengame/packages/runtime)',
    );
  }
  return {
    skeletonDir: path.resolve(skeletonDir),
    runtimeSpec,
    ...(process.env['PLATFORM_RUNTIME_VERSION']
      ? { runtimeVersion: process.env['PLATFORM_RUNTIME_VERSION'] }
      : {}),
  };
}

export type GameArchetype =
  | 'platformer'
  | 'top_down'
  | 'grid_logic'
  | 'tower_defense'
  | 'ui_heavy';

/**
 * First-time scaffold: copy core template + merge archetype module `src/`.
 */
export async function ensureArchetypeWorkspace(
  workspaceDir: string,
  coreTemplateDir: string,
  modulesParentDir: string,
  archetype: GameArchetype,
): Promise<{ created: boolean; archetype: GameArchetype }> {
  const pkg = path.join(workspaceDir, 'package.json');
  if (fs.existsSync(pkg)) {
    return { created: false, archetype };
  }
  await ensureTemplateWorkspace(workspaceDir, coreTemplateDir);
  const modSrc = path.join(modulesParentDir, 'modules', archetype, 'src');
  if (fs.existsSync(modSrc)) {
    const destSrc = path.join(workspaceDir, 'src');
    await fsp.mkdir(destSrc, { recursive: true });
    await fsp.cp(modSrc, destSrc, { recursive: true, force: true });
  }
  const modConfig = path.join(
    modulesParentDir,
    'modules',
    archetype,
    'src',
    'gameConfig.json',
  );
  if (fs.existsSync(modConfig)) {
    await fsp.copyFile(
      modConfig,
      path.join(workspaceDir, 'src', 'gameConfig.json'),
    );
  }
  await fsp.writeFile(
    path.join(workspaceDir, '.opengame-archetype.json'),
    JSON.stringify({ archetype, scaffoldedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
  return { created: true, archetype };
}

export function readScaffoldMode(): ScaffoldMode {
  const raw = process.env['PLATFORM_PROJECT_SCAFFOLD_MODE']?.trim();
  if (raw === 'legacy-template') return 'legacy-template';
  if (raw === 'skeleton') return 'skeleton';
  if (raw === 'engine') return 'engine';
  // 默认 engine（有 skeleton env 时）以支持完整 Scene 游戏；grid 可通过 env 改 skeleton
  const hasSkeletonEnv =
    Boolean(process.env['PLATFORM_RUNTIME_SKELETON_DIR']?.trim()) &&
    Boolean(process.env['PLATFORM_RUNTIME_PACKAGE_SPEC']?.trim());
  if (hasSkeletonEnv) return 'engine';
  return 'legacy-template';
}

function monorepoPackagesRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..', 'packages');
}

function moduleFileSpec(packageDir: string): string {
  const abs = path.join(monorepoPackagesRoot(), packageDir);
  return `file:${abs.replace(/\\/g, '/')}`;
}

function namedModuleSpec(envKey: string, packageDir: string): string {
  return process.env[envKey]?.trim() || moduleFileSpec(packageDir);
}

/** Compose package.json deps from MechanicSpec.modules — not one exclusive bucket. */
export function moduleSpecsForModules(
  modules: readonly string[] | null | undefined,
): Record<string, string> {
  const deps: Record<string, string> = {};
  deps['@opengame/module-platform'] = namedModuleSpec(
    'PLATFORM_MODULE_PLATFORM_SPEC',
    'module-platform',
  );
  const set = new Set(modules ?? []);
  if (set.has('dialogue')) {
    deps['@opengame/module-dialogue'] = namedModuleSpec(
      'PLATFORM_MODULE_DIALOGUE_SPEC',
      'module-dialogue',
    );
  }
  if (set.has('combat')) {
    deps['@opengame/module-combat'] = namedModuleSpec(
      'PLATFORM_MODULE_COMBAT_SPEC',
      'module-combat',
    );
  }
  if (set.has('world')) {
    deps['@opengame/module-world'] = namedModuleSpec(
      'PLATFORM_MODULE_WORLD_SPEC',
      'module-world',
    );
  }
  if (set.has('systems')) {
    deps['@opengame/module-systems'] = namedModuleSpec(
      'PLATFORM_MODULE_SYSTEMS_SPEC',
      'module-systems',
    );
  }
  if (set.has('td')) {
    deps['@opengame/module-td'] = namedModuleSpec(
      'PLATFORM_MODULE_TD_SPEC',
      'module-td',
    );
  }
  if (set.has('board') || set.has('match')) {
    deps['@opengame/module-board'] = namedModuleSpec(
      'PLATFORM_MODULE_BOARD_SPEC',
      'module-board',
    );
  }
  if (set.has('cards')) {
    deps['@opengame/module-cards'] = namedModuleSpec(
      'PLATFORM_MODULE_CARDS_SPEC',
      'module-cards',
    );
  }
  if (set.has('emitter')) {
    deps['@opengame/module-emitter'] = namedModuleSpec(
      'PLATFORM_MODULE_EMITTER_SPEC',
      'module-emitter',
    );
  }
  return deps;
}

export function moduleSpecsForArchetype(archetype: GameArchetype): Record<string, string> {
  if (archetype === 'ui_heavy') {
    return moduleSpecsForModules(['platform', 'dialogue', 'combat', 'systems']);
  }
  if (archetype === 'top_down') {
    return moduleSpecsForModules(['platform', 'world', 'combat', 'dialogue', 'systems']);
  }
  if (archetype === 'tower_defense') {
    return moduleSpecsForModules(['platform', 'world', 'td']);
  }
  if (archetype === 'platformer') {
    return moduleSpecsForModules(['platform', 'world', 'combat']);
  }
  return moduleSpecsForModules(['platform']);
}

interface SceneStub {
  readonly file: string;
  readonly className: string;
  readonly sceneKey: string;
  readonly hint: string;
}

function sceneStubsFromKeys(sceneKeys: readonly string[]): SceneStub[] {
  return sceneKeys.map((sceneKey) => ({
    file: `${sceneKey}.ts`,
    className: sceneKey,
    sceneKey,
    hint: `实现 ${sceneKey} 玩法（见 GAME_DESIGN.md）`,
  }));
}

function resolveSceneStubs(
  archetype: GameArchetype,
  gddSceneKeys?: readonly string[],
): SceneStub[] {
  if (gddSceneKeys && gddSceneKeys.length > 0) {
    return sceneStubsFromKeys(gddSceneKeys);
  }
  return sceneStubsForArchetype(archetype);
}

function sceneStubsForArchetype(archetype: GameArchetype): SceneStub[] {
  switch (archetype) {
    case 'ui_heavy':
      return [
        { file: 'TitleScene.ts', className: 'TitleScene', sceneKey: 'TitleScene', hint: '标题 → ChapterScene' },
        { file: 'ChapterScene.ts', className: 'ChapterScene', sceneKey: 'ChapterScene', hint: '对话/剧情 → BattleScene' },
        { file: 'BattleScene.ts', className: 'BattleScene', sceneKey: 'BattleScene', hint: '回合战斗，胜负 → EndingScene' },
        { file: 'EndingScene.ts', className: 'EndingScene', sceneKey: 'EndingScene', hint: '结局，R 重开 → TitleScene' },
      ];
    case 'top_down':
      return [
        { file: 'TitleScene.ts', className: 'TitleScene', sceneKey: 'TitleScene', hint: '标题 → Chapter 开场 → World' },
        { file: 'ChapterScene.ts', className: 'ChapterScene', sceneKey: 'ChapterScene', hint: '叙事开场对话 → WorldScene' },
        { file: 'WorldScene.ts', className: 'WorldScene', sceneKey: 'WorldScene', hint: '俯视角探索/任务/门户' },
        { file: 'GameOverScene.ts', className: 'GameOverScene', sceneKey: 'GameOverScene', hint: '胜负' },
      ];
    case 'tower_defense':
      return [
        { file: 'TitleScene.ts', className: 'TitleScene', sceneKey: 'TitleScene', hint: '标题' },
        { file: 'TDScene.ts', className: 'TDScene', sceneKey: 'TDScene', hint: '塔防主循环' },
        { file: 'VictoryScene.ts', className: 'VictoryScene', sceneKey: 'VictoryScene', hint: '胜利/失败' },
      ];
    case 'platformer':
      return [
        { file: 'TitleScene.ts', className: 'TitleScene', sceneKey: 'TitleScene', hint: '标题' },
        { file: 'Level1Scene.ts', className: 'Level1Scene', sceneKey: 'Level1Scene', hint: '关卡玩法' },
        { file: 'GameOverScene.ts', className: 'GameOverScene', sceneKey: 'GameOverScene', hint: '胜负' },
      ];
    default:
      return [];
  }
}

/** Map GDD/custom scene names onto strong kernels — never SPACE-only stubs. */

async function writeEngineGameJson(
  workspaceDir: string,
  stubs: SceneStub[],
): Promise<void> {
  if (stubs.length === 0) return;
  const publicPath = path.join(workspaceDir, 'public', 'game.json');
  await fsp.mkdir(path.dirname(publicPath), { recursive: true });
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(publicPath)) {
    try {
      existing = JSON.parse(await fsp.readFile(publicPath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      existing = {};
    }
  }
  const titleStub =
    stubs.find((s) => /title|menu|start|hub/i.test(s.sceneKey)) ?? stubs[0]!;
  const scenes = stubs.map((s) => ({
    id: s.sceneKey,
    customModule: s.className,
    entities: [] as unknown[],
  }));
  const next = {
    dslVersion: (existing['dslVersion'] as string) ?? '1.0.0',
    meta:
      (existing['meta'] as Record<string, unknown>) ??
      ({
        title: 'OpenGame',
        canvas: { width: 960, height: 540, background: '#0f172a' },
      } as Record<string, unknown>),
    initialSceneId: titleStub.sceneKey,
    scenes,
    assets: Array.isArray(existing['assets']) ? existing['assets'] : [],
    audioTracks: Array.isArray(existing['audioTracks'])
      ? existing['audioTracks']
      : [],
    ...(existing['tunables'] ? { tunables: existing['tunables'] } : {}),
  };
  await fsp.writeFile(publicPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

async function writeEngineMainTs(
  workspaceDir: string,
  stubs: SceneStub[],
): Promise<void> {
  const imports = stubs.map((s) => `import { ${s.className} } from './scenes/${s.file.replace(/\\.ts$/, '')}';`).join('\n');
  const extra = stubs.map((s) => s.className).join(', ');
  const content = `import { bootstrap, enableHotReload } from '@opengame/runtime';
${imports}

const game = await bootstrap({
  source: './game.json',
  extraScenes: [${extra}],
});

enableHotReload({ game });
`;
  await fsp.writeFile(path.join(workspaceDir, 'src', 'main.ts'), content, 'utf8');
}

export async function ensureMechanicModuleDeps(
  workspaceDir: string,
  modules: readonly string[] | null | undefined,
): Promise<void> {
  if (!modules?.length) return;
  await mergeModuleDeps(workspaceDir, moduleSpecsForModules(modules));
}

async function mergeModuleDeps(
  workspaceDir: string,
  deps: Record<string, string>,
): Promise<void> {
  const pkgPath = path.join(workspaceDir, 'package.json');
  const raw = await fsp.readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> };
  pkg.dependencies = { ...pkg.dependencies, ...deps };
  await fsp.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

/**
 * Engine scaffold: skeleton + archetype module deps + Scene stubs + extraScenes main.ts
 */
export const ENGINE_KERNEL_VERSION = 'opengame-kernel-v19-tilemap-reputation';

export function shouldRefreshSceneStub(existing: string, next: string): boolean {
  if (!existing.trim()) return true;
  // Pre-uplift / empty stubs / broken VictoryScene refs
  if (
    /VictoryScene/.test(existing) &&
    /GameOverScene/.test(next) &&
    !/VictoryScene/.test(next)
  ) {
    return true;
  }
  if (/implement gameplay|TODO:|PLACEHOLDER|empty stub/i.test(existing)) {
    return true;
  }
  // Missing GameUiKit / ContentDirector while next kernel has them
  if (
    (/GameUiKit|ContentDirector|STORY_BIBLE/.test(next) &&
      !/GameUiKit|ContentDirector|STORY_BIBLE/.test(existing)) ||
    (/addDialoguePanel/.test(next) && !/addDialoguePanel/.test(existing))
  ) {
    return true;
  }
  // v16 systems / design-compiler / walk atlas
  if (
    (/QuestDag|TurnCombat|EquipmentLoadout|SaveStore|gainXp|Shop|craft|ReputationBoard|make.tilemap|og_systems|og_content|player_walk|ensureWalkAnims|spawnGroundedSprite/.test(
      next,
    ) &&
      !/QuestDag|TurnCombat|EquipmentLoadout|SaveStore|gainXp|Shop|craft|ReputationBoard|make.tilemap|og_systems|og_content|player_walk|ensureWalkAnims|spawnGroundedSprite/.test(
        existing,
      ))
  ) {
    return true;
  }
  // Missing ending_b / bible quests / ChoicePanel wrap / world layout from newer kernels
  if (
    (/ending_b/.test(next) && !/ending_b/.test(existing)) ||
    (/mainQuest|questTitle|giverNpcId/.test(next) &&
      !/mainQuest|questTitle|giverNpcId/.test(existing)) ||
    (/resolveWorldLayoutFromGame|og_game/.test(next) &&
      !/resolveWorldLayoutFromGame|og_game/.test(existing)) ||
    (/worldLayout\.enemies|itemFromLayout|questItemId\.slice/.test(next) &&
      !/worldLayout\.enemies|itemFromLayout|questItemId\.slice/.test(existing)) ||
    (/WORLD_SCENES|resolvePortalHop|travelCount|hubs\.push/.test(next) &&
      !/WORLD_SCENES|resolvePortalHop|resolvePortalTarget|travelCount|hubs\.push/.test(
        existing,
      )) ||
    (/resolveWorldLayoutsBySceneId|worldRegionId|__ogNpcPos/.test(next) &&
      !/resolveWorldLayoutsBySceneId|worldRegionId|__ogNpcPos/.test(existing)) ||
    (/bg_region_|chapterOpenerOnly|regionBgKey/.test(next) &&
      !/bg_region_|chapterOpenerOnly|regionBgKey/.test(existing)) ||
    (/playRegionBgm|bgm_region_|leaveChapter|Skip · S|endings\?/.test(next) &&
      !/playRegionBgm|bgm_region_|leaveChapter|Skip · S|endings\?/.test(
        existing,
      )) ||
    (/worldStartRegionId|layoutOnly|isEngineShellId/.test(next) &&
      !/worldStartRegionId|layoutOnly|isEngineShellId/.test(existing)) ||
    (/this\.wasd|addKeys\('W,A,S,D'\)/.test(next) &&
      !/this\.wasd|addKeys\('W,A,S,D'\)/.test(existing)) ||
    (/bg_chapter_03|chBgKey/.test(next) &&
      !/bg_chapter_03|chBgKey/.test(existing)) ||
    (/wordWrap:\s*true/.test(next) && !/wordWrap:\s*true/.test(existing))
  ) {
    return true;
  }
  return false;
}

/**
 * Engine scaffold: skeleton + archetype module deps + Scene stubs + extraScenes main.ts
 */
export async function ensureEngineScaffold(
  workspaceDir: string,
  archetype: GameArchetype,
  skeletonOpts: SkeletonOptions,
  gddSceneKeys?: readonly string[],
  options?: {
    readonly userPrompt?: string;
    readonly mechanic?: {
      readonly modules?: readonly string[];
      readonly arcadeVariant?: string;
      readonly boardKind?: string;
      readonly extraScenes?: readonly string[];
    } | null;
  },
): Promise<{ created: boolean; archetype: GameArchetype; arcade?: unknown }> {
  const res = await generateMinimalSkeleton(workspaceDir, skeletonOpts);
  let arcade: unknown;
  if (archetype === 'grid_logic') {
    const { ensureGridArcadeKernel } = await import('./gridArcadeKernels.js');
    arcade = await ensureGridArcadeKernel(
      workspaceDir,
      options?.userPrompt ?? '',
      options?.mechanic ?? null,
    );
  } else {
    const stubs = resolveSceneStubs(archetype, gddSceneKeys);
    if (stubs.length > 0) {
      const scenesDir = path.join(workspaceDir, 'src', 'scenes');
      await fsp.mkdir(scenesDir, { recursive: true });
      const metaPath = path.join(workspaceDir, '.opengame-scaffold.json');
      let prevKernel = '';
      try {
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
            kernelVersion?: string;
          };
          prevKernel = meta.kernelVersion ?? '';
        }
      } catch {
        /* optional */
      }
      const forceKernel = prevKernel !== ENGINE_KERNEL_VERSION;
      for (const stub of stubs) {
        const p = path.join(scenesDir, stub.file);
        const next = renderSceneStub(stub, archetype, stubs);
        if (!fs.existsSync(p)) {
          await fsp.writeFile(p, next, 'utf8');
        } else if (forceKernel) {
          const prev = await fsp.readFile(p, 'utf8');
          if (shouldRefreshSceneStub(prev, next)) {
            await fsp.writeFile(p, next, 'utf8');
          }
        }
      }
      await writeEngineMainTs(workspaceDir, stubs);
      await writeEngineGameJson(workspaceDir, stubs);
    }
  }
  const modDeps = options?.mechanic?.modules?.length
    ? moduleSpecsForModules(options.mechanic.modules)
    : moduleSpecsForArchetype(archetype);
  if (Object.keys(modDeps).length > 0) {
    await mergeModuleDeps(workspaceDir, modDeps);
  }
  if (options?.mechanic) {
    const { ensureBoundCapabilities } = await import('./boundCapabilities.js');
    await ensureBoundCapabilities(workspaceDir, options.mechanic);
  }
  if (archetype === 'ui_heavy' || archetype === 'top_down') {
    await ensureStoryScaffold(workspaceDir, archetype, options?.userPrompt);
  }
  await fsp.writeFile(
    path.join(workspaceDir, '.opengame-scaffold.json'),
    JSON.stringify(
      {
        mode: 'engine',
        archetype,
        kernelVersion: ENGINE_KERNEL_VERSION,
        runtimeSpec: skeletonOpts.runtimeSpec,
        sceneStubs:
          archetype === 'grid_logic'
            ? [(arcade as { sceneKey?: string } | undefined)?.sceneKey].filter(
                Boolean,
              )
            : resolveSceneStubs(archetype, gddSceneKeys).map((s) => s.sceneKey),
        gddSceneKeys: gddSceneKeys ?? [],
        arcade,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
  return { created: res.created, archetype, arcade };
}

/** Data-driven story bible + chapter JSON for narrative archetypes. */
async function ensureStoryScaffold(
  workspaceDir: string,
  archetype: GameArchetype,
  userPrompt?: string,
): Promise<void> {
  const { writeStoryOutlineArtifacts, writeContentDirectorScaffold } =
    await import('./storyOutline.js');
  const { writeContentGraphArtifacts } = await import('./contentGraph.js');
  await writeContentDirectorScaffold(workspaceDir);
  const outline = await writeStoryOutlineArtifacts(
    workspaceDir,
    userPrompt?.trim() ||
      (archetype === 'ui_heavy' ? 'Short visual novel' : 'Town exploration RPG'),
    { force: false, useLlmAuthor: false },
  );
  await writeContentGraphArtifacts({
    workspace: workspaceDir,
    bible: outline.bible,
    archetype,
    designBrief: null,
    userPrompt: userPrompt ?? '',
  });
}

async function copyTree(
  srcDir: string,
  dstDir: string,
  replacements: Record<string, string>,
): Promise<void> {
  const entries = await fsp.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'README.md') continue; // skip the skeleton's own docs
    const srcPath = path.join(srcDir, entry.name);
    const isTpl = entry.name.endsWith('.tpl');
    const dstName = isTpl ? entry.name.slice(0, -'.tpl'.length) : entry.name;
    const dstPath = path.join(dstDir, dstName);
    if (entry.isDirectory()) {
      await fsp.mkdir(dstPath, { recursive: true });
      await copyTree(srcPath, dstPath, replacements);
      continue;
    }
    if (isTpl || entry.name.endsWith('.json') || entry.name.endsWith('.html') || entry.name.endsWith('.ts')) {
      let content = await fsp.readFile(srcPath, 'utf8');
      for (const [token, value] of Object.entries(replacements)) {
        content = content.split(token).join(value);
      }
      await fsp.writeFile(dstPath, content, 'utf8');
    } else {
      await fsp.copyFile(srcPath, dstPath);
    }
  }
}

async function ensureSrcLayout(workspaceDir: string): Promise<void> {
  const srcDir = path.join(workspaceDir, 'src');
  await fsp.mkdir(srcDir, { recursive: true });
  const mainAtRoot = path.join(workspaceDir, 'main.ts');
  const mainInSrc = path.join(srcDir, 'main.ts');
  if (fs.existsSync(mainAtRoot) && !fs.existsSync(mainInSrc)) {
    await fsp.rename(mainAtRoot, mainInSrc);
  }
  // public/game.json is copied to dist root; bootstrap uses `source: './game.json'`.
  const publicDir = path.join(workspaceDir, 'public');
  await fsp.mkdir(publicDir, { recursive: true });
  const gameAtRoot = path.join(workspaceDir, 'game.json');
  const gameInPublic = path.join(publicDir, 'game.json');
  if (fs.existsSync(gameAtRoot) && !fs.existsSync(gameInPublic)) {
    await fsp.rename(gameAtRoot, gameInPublic);
  }
}

