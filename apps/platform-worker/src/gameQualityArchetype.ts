/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { GameArchetype } from './generationPipeline.js';

export const COMPLEX_ARCHETYPES = new Set<GameArchetype>([
  'ui_heavy',
  'top_down',
  'tower_defense',
  'platformer',
]);

export const UNIMPLEMENTED_DSL_ROOT_KEYS = [
  'gameFlow',
  'sceneConfig',
  'tunable',
] as const;

export const UNIMPLEMENTED_DSL_SCENE_KEYS = [
  'spawners',
  'entities_templates',
  'rules',
] as const;

export interface ArchetypeSceneRequirements {
  readonly minSceneFiles: number;
  readonly requireExtraScenes: boolean;
  readonly requireBattleOrLevel: boolean;
  readonly requireWinLoseHint: boolean;
}

export function archetypeSceneRequirements(
  archetype: GameArchetype | null | undefined,
  gddSceneKeys?: readonly string[],
): ArchetypeSceneRequirements | null {
  if (!archetype || !COMPLEX_ARCHETYPES.has(archetype)) return null;
  const gddMin = gddSceneKeys?.length ?? 0;
  switch (archetype) {
    case 'ui_heavy':
      return {
        minSceneFiles: gddMin >= 3 ? gddMin : 3,
        requireExtraScenes: true,
        requireBattleOrLevel: gddMin === 0,
        requireWinLoseHint: true,
      };
    case 'top_down':
      return {
        minSceneFiles: gddMin >= 2 ? gddMin : 3,
        requireExtraScenes: true,
        requireBattleOrLevel: gddMin === 0,
        requireWinLoseHint: true,
      };
    case 'tower_defense':
      return {
        minSceneFiles: gddMin >= 2 ? gddMin : 3,
        requireExtraScenes: true,
        requireBattleOrLevel: gddMin === 0,
        requireWinLoseHint: true,
      };
    case 'platformer':
      return {
        minSceneFiles: gddMin >= 2 ? gddMin : 2,
        requireExtraScenes: true,
        requireBattleOrLevel: false,
        requireWinLoseHint: true,
      };
    default:
      return null;
  }
}

export interface PipelineMeta {
  readonly archetype?: GameArchetype;
  readonly gddSceneKeys?: readonly string[];
}

export async function readPipelineMeta(workspace: string): Promise<PipelineMeta> {
  for (const rel of ['.opengame-pipeline.json', '.opengame-archetype.json']) {
    const p = path.join(workspace, rel);
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(await fsp.readFile(p, 'utf8')) as PipelineMeta & {
        archetype?: string;
      };
      const a = raw.archetype;
      const archetype =
        a === 'platformer' ||
        a === 'top_down' ||
        a === 'grid_logic' ||
        a === 'tower_defense' ||
        a === 'ui_heavy'
          ? a
          : undefined;
      const gddSceneKeys = Array.isArray(raw.gddSceneKeys)
        ? raw.gddSceneKeys.filter((k): k is string => typeof k === 'string' && k.length > 0)
        : undefined;
      return { archetype, gddSceneKeys };
    } catch {
      // ignore
    }
  }
  return {};
}

export async function readWorkspaceArchetype(
  workspace: string,
): Promise<GameArchetype | null> {
  const meta = await readPipelineMeta(workspace);
  return meta.archetype ?? null;
}

export function detectUnimplementedDslFields(dsl: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const key of UNIMPLEMENTED_DSL_ROOT_KEYS) {
    if (dsl[key] !== undefined && dsl[key] !== null) {
      issues.push(
        `game.json 根级 "${key}" 当前 runtime 不执行 — 请用 src/scenes/*.ts + extraScenes 实现，并删除该字段`,
      );
    }
  }
  const rootRules = dsl['rules'];
  if (rootRules && typeof rootRules === 'object' && !Array.isArray(rootRules)) {
    const r = rootRules as Record<string, unknown>;
    if (Object.keys(r).length > 3 || r['win'] === undefined) {
      issues.push(
        'game.json 根级复杂 rules 对象 runtime 不执行 — 请在 Phaser Scene 中实现胜负逻辑',
      );
    }
  }
  const scenes = Array.isArray(dsl['scenes']) ? dsl['scenes'] : [];
  for (const s of scenes) {
    if (!s || typeof s !== 'object') continue;
    const scene = s as Record<string, unknown>;
    const sid = typeof scene['id'] === 'string' ? scene['id'] : 'scene';
    for (const key of UNIMPLEMENTED_DSL_SCENE_KEYS) {
      if (scene[key] !== undefined && scene[key] !== null) {
        issues.push(
          `scene "${sid}" 的 "${key}" runtime 不执行 — 请在 TypeScript Scene 中实现`,
        );
      }
    }
  }
  return issues;
}

export function detectSvgImageAssets(dsl: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const assets = Array.isArray(dsl['assets']) ? dsl['assets'] : [];
  for (const a of assets) {
    if (!a || typeof a !== 'object') continue;
    const row = a as Record<string, unknown>;
    const url = typeof row['url'] === 'string' ? row['url'] : '';
    const id =
      typeof row['id'] === 'string'
        ? row['id']
        : typeof row['key'] === 'string'
          ? row['key']
          : 'asset';
    if (/\.svg(\?|$)/i.test(url)) {
      issues.push(`资产 "${id}" 使用 .svg — WebGL 无法加载，请改为 .png/.webp`);
    }
  }
  return issues;
}

export async function countCustomSceneFiles(workspace: string): Promise<number> {
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (!fs.existsSync(scenesDir)) return 0;
  const entries = await fsp.readdir(scenesDir, { withFileTypes: true });
  return entries.filter(
    (e) => e.isFile() && e.name.endsWith('Scene.ts') && !e.name.startsWith('_Template'),
  ).length;
}

export async function mainUsesExtraScenes(workspace: string): Promise<boolean> {
  const mainPath = path.join(workspace, 'src', 'main.ts');
  if (!fs.existsSync(mainPath)) return false;
  const src = await fsp.readFile(mainPath, 'utf8');
  return src.includes('extraScenes');
}

export async function detectWinLoseInScenes(workspace: string): Promise<boolean> {
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (!fs.existsSync(scenesDir)) return false;
  const entries = await fsp.readdir(scenesDir, { withFileTypes: true });
  let combined = '';
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.ts')) continue;
    combined += await fsp.readFile(path.join(scenesDir, e.name), 'utf8');
  }
  const mainPath = path.join(workspace, 'src', 'main.ts');
  if (fs.existsSync(mainPath)) {
    combined += await fsp.readFile(mainPath, 'utf8');
  }
  return (
    /registry\.set\(\s*['"]won['"]|onBattleEnd|VictoryScene|GameOverScene|EndingScene/i.test(
      combined,
    ) &&
    (/scene\.start\(\s*['"](?:Victory|GameOver|Ending)/i.test(combined) ||
      /this\.scene\.start\(\s*['"](?:Victory|GameOver|Ending)/i.test(combined))
  );
}

export async function hasBattleOrLevelScene(workspace: string): Promise<boolean> {
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (!fs.existsSync(scenesDir)) return false;
  const entries = await fsp.readdir(scenesDir, { withFileTypes: true });
  return entries.some(
    (e) =>
      e.isFile() &&
      /Battle|Combat|Level|Arena|TD|Tower|World|Chapter/i.test(e.name),
  );
}

/** Ensure Scene class names in main.ts roughly match src/scenes/*Scene.ts files. */
export async function detectSceneRegistrationMismatch(workspace: string): Promise<string[]> {
  const issues: string[] = [];
  const mainPath = path.join(workspace, 'src', 'main.ts');
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (!fs.existsSync(mainPath) || !fs.existsSync(scenesDir)) return issues;
  const mainSrc = await fsp.readFile(mainPath, 'utf8');
  if (!mainSrc.includes('extraScenes')) return issues;
  const entries = await fsp.readdir(scenesDir, { withFileTypes: true });
  const sceneFiles = entries.filter(
    (e) => e.isFile() && e.name.endsWith('Scene.ts') && !e.name.startsWith('_Template'),
  );
  for (const e of sceneFiles) {
    const className = e.name.replace(/\.ts$/, '');
    if (!mainSrc.includes(className)) {
      issues.push(`Scene 文件 ${e.name} 未在 main.ts extraScenes 中注册`);
    }
  }
  return issues;
}

/**
 * When main.ts registers Phaser extraScenes, game.json must boot into a
 * `customModule` scene — otherwise runtime starts the first DSL stub (often
 * indigo rect + Score HUD) and Title/Level never run.
 */
export function detectExtraScenesBootMismatch(
  dsl: Record<string, unknown>,
): string[] {
  const scenes = Array.isArray(dsl['scenes']) ? dsl['scenes'] : [];
  const customIds: string[] = [];
  for (const s of scenes) {
    if (!s || typeof s !== 'object') continue;
    const scene = s as Record<string, unknown>;
    const id = typeof scene['id'] === 'string' ? scene['id'].trim() : '';
    const cm = scene['customModule'];
    if (id && typeof cm === 'string' && cm.trim() !== '') {
      customIds.push(id);
    }
  }
  if (customIds.length === 0) {
    return [
      'main.ts 使用了 extraScenes，但 game.json 没有任何 scenes[].customModule；运行时会启动 DSL 占位（紫块/Score 0），玩法 Scene 不可达',
    ];
  }
  const firstId =
    scenes.find((s) => s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string') !=
    null
      ? String((scenes[0] as { id: string }).id)
      : '';
  const initRaw = dsl['initialSceneId'];
  const init =
    typeof initRaw === 'string' && initRaw.trim() !== '' ? initRaw.trim() : firstId;
  if (!customIds.includes(init)) {
    return [
      `game.json 启动场景 "${init || '(empty)'}" 不是 customModule 场景（应为 ${customIds.join('/')}）。请设置 initialSceneId 并声明 customModule，否则只会显示 DSL 占位`,
    ];
  }
  return [];
}

/** Async wrapper: only runs when main.ts already uses extraScenes. */
export async function detectExtraScenesNotBootable(
  workspace: string,
  dsl: Record<string, unknown>,
): Promise<string[]> {
  if (!(await mainUsesExtraScenes(workspace))) return [];
  return detectExtraScenesBootMismatch(dsl);
}

/** Parse `extraScenes: [TitleScene, WorldScene]` class names from main.ts. */
export function parseExtraScenesFromMain(mainSrc: string): string[] {
  const m = mainSrc.match(/extraScenes\s*:\s*\[([^\]]*)\]/s);
  if (!m?.[1]) return [];
  return m[1]
    .split(',')
    .map((part) => part.replace(/\/\/[^\n]*/g, '').trim())
    .filter((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part));
}

export interface ExtraScenesGameJsonHealResult {
  readonly healed: boolean;
  readonly scenes: readonly string[];
  readonly initialSceneId: string | null;
  readonly reason?: string;
}

/**
 * Deterministic heal/merge: keep world-region layout scenes (entities/portals) and
 * ensure main.ts extraScenes have matching customModule shells + Title boot.
 *
 * Never deletes entity-bearing / layoutOnly region rows — those are WorldScene SSOT.
 */
export async function healExtraScenesGameJsonWiring(
  workspace: string,
  options?: {
    /** Prefer this as worldStartRegionId when missing (from world seed lineage). */
    readonly worldStartRegionId?: string;
  },
): Promise<ExtraScenesGameJsonHealResult> {
  const mainPath = path.join(workspace, 'src', 'main.ts');
  const publicPath = path.join(workspace, 'public', 'game.json');
  if (!fs.existsSync(mainPath) || !fs.existsSync(publicPath)) {
    return { healed: false, scenes: [], initialSceneId: null };
  }
  const mainSrc = await fsp.readFile(mainPath, 'utf8');
  const extras = parseExtraScenesFromMain(mainSrc);
  if (extras.length === 0) {
    return { healed: false, scenes: [], initialSceneId: null };
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await fsp.readFile(publicPath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return {
      healed: false,
      scenes: extras,
      initialSceneId: null,
      reason: 'game.json parse failed',
    };
  }

  const scenes = Array.isArray(raw['scenes'])
    ? [...(raw['scenes'] as unknown[])]
    : [];
  const extraSet = new Set(extras);

  const isShellName = (id: string): boolean =>
    /^(Title|Chapter|World|Ending|GameOver|Victory|Battle|Level|Hub|Menu)Scene$/i.test(
      id,
    ) || extraSet.has(id);

  type SceneRow = Record<string, unknown>;
  const asRow = (s: unknown): SceneRow | null =>
    s && typeof s === 'object' ? (s as SceneRow) : null;

  const deferredIds: string[] = [];
  for (const s of scenes) {
    const scene = asRow(s);
    if (!scene) continue;
    const id = typeof scene['id'] === 'string' ? scene['id'].trim() : '';
    const cm = scene['customModule'];
    if (id && typeof cm === 'string' && cm.trim() !== '') deferredIds.push(id);
  }

  const initRaw = raw['initialSceneId'];
  const init =
    typeof initRaw === 'string' && initRaw.trim() !== '' ? initRaw.trim() : '';

  const everyExtraWired = extras.every((name) =>
    scenes.some((s) => {
      const scene = asRow(s);
      if (!scene) return false;
      const id = typeof scene['id'] === 'string' ? scene['id'].trim() : '';
      const cm = scene['customModule'];
      return (
        id === name && typeof cm === 'string' && cm.trim() !== '' && id.length > 0
      );
    }),
  );
  const orderOk =
    deferredIds.length >= extras.length &&
    extras.every((name, i) => deferredIds[i] === name);

  const title =
    extras.find((n) => /title|menu|hub|start|attract/i.test(n)) ?? extras[0]!;
  const initOk = Boolean(init && extras.includes(init) && deferredIds.includes(init));

  let worldStart =
    typeof options?.worldStartRegionId === 'string' &&
    options.worldStartRegionId.trim()
      ? options.worldStartRegionId.trim()
      : typeof raw['worldStartRegionId'] === 'string' &&
          raw['worldStartRegionId'].trim()
        ? String(raw['worldStartRegionId']).trim()
        : '';

  // Infer start region from first non-shell scene if missing
  if (!worldStart) {
    for (const s of scenes) {
      const scene = asRow(s);
      if (!scene) continue;
      const id = typeof scene['id'] === 'string' ? scene['id'].trim() : '';
      if (!id || isShellName(id)) continue;
      worldStart = id;
      break;
    }
  }

  const regionRowsNeedLayoutFlag = scenes.some((s) => {
    const scene = asRow(s);
    if (!scene) return false;
    const id = typeof scene['id'] === 'string' ? scene['id'].trim() : '';
    if (!id || isShellName(id)) return false;
    const cm = scene['customModule'];
    if (typeof cm === 'string' && cm.trim() !== '') return false;
    return scene['layoutOnly'] !== true;
  });

  const worldStartOk =
    !worldStart ||
    (typeof raw['worldStartRegionId'] === 'string' &&
      raw['worldStartRegionId'] === worldStart);

  if (everyExtraWired && orderOk && initOk && !regionRowsNeedLayoutFlag && worldStartOk) {
    return {
      healed: false,
      scenes: extras,
      initialSceneId: init || title,
    };
  }

  // Preserve non-shell scenes (world regions / other layouts)
  const preservedRegions: SceneRow[] = [];
  const seenRegionIds = new Set<string>();
  for (const s of scenes) {
    const scene = asRow(s);
    if (!scene) continue;
    const id = typeof scene['id'] === 'string' ? scene['id'].trim() : '';
    if (!id || extraSet.has(id) || isShellName(id)) continue;
    if (seenRegionIds.has(id)) continue;
    seenRegionIds.add(id);
    const cm = scene['customModule'];
    const hasCustom = typeof cm === 'string' && cm.trim() !== '';
    if (hasCustom) {
      // Unexpected: keep as-is after shells
      preservedRegions.push({ ...scene, id });
      continue;
    }
    preservedRegions.push({
      ...scene,
      id,
      layoutOnly: true,
    });
  }

  const newScenes: SceneRow[] = [
    ...extras.map((name) => ({
      id: name,
      customModule: name,
      entities: [] as unknown[],
    })),
    ...preservedRegions,
  ];

  const next: Record<string, unknown> = {
    ...raw,
    initialSceneId: title,
    scenes: newScenes,
  };
  if (worldStart) next['worldStartRegionId'] = worldStart;

  const body = `${JSON.stringify(next, null, 2)}\n`;
  await fsp.writeFile(publicPath, body, 'utf8');
  const distPath = path.join(workspace, 'dist', 'game.json');
  if (fs.existsSync(path.join(workspace, 'dist'))) {
    await fsp.writeFile(distPath, body, 'utf8');
  }
  return {
    healed: true,
    scenes: extras,
    initialSceneId: title,
    reason: !everyExtraWired
      ? 'merged engine shells with world region layouts'
      : !orderOk
        ? 'extraScenes/customModule order repaired; regions preserved'
        : regionRowsNeedLayoutFlag
          ? 'marked region scenes layoutOnly'
          : 'initialSceneId / worldStartRegionId repaired',
  };
}

/**
 * Catch Game Over → black → Game Over class bugs before shipping to chat-only users.
 */
export async function detectFragileRestartAndDeath(workspace: string): Promise<string[]> {
  const issues: string[] = [];
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (!fs.existsSync(scenesDir)) return issues;
  const entries = await fsp.readdir(scenesDir, { withFileTypes: true });
  let combined = '';
  let hasGameOver = false;
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.ts')) continue;
    const src = await fsp.readFile(path.join(scenesDir, e.name), 'utf8');
    combined += `\n${src}`;
    if (/GameOver|Victory|Ending/i.test(e.name) || /GAME OVER|GameOverScene/i.test(src)) {
      hasGameOver = true;
    }
  }
  if (!hasGameOver) return issues;

  const hasHardReload = /location\.(reload|replace)\s*\(/.test(combined);
  const hasKeyupRestart =
    /keyup-R|keyup-SPACE|keyup-ENTER|once\(\s*['"]keyup-/i.test(combined);
  const hasKeydownRestart =
    /keydown-R|once\(\s*['"]keydown-R['"]|once\(\s*['"]keydown-SPACE['"]/i.test(
      combined,
    );
  // Soft Title start alone does NOT make keydown safe — key-repeat still chains.
  if (hasKeydownRestart && !hasKeyupRestart && !hasHardReload) {
    issues.push(
      'GameOver 重开使用 keydown：按键连发会导致 Title 立刻开局再秒死回 GameOver；请改 keyup 或显式按钮',
    );
  }
  if (
    /TitleScene|PRESS SPACE|TO START/i.test(combined) &&
    /input\.once\(\s*['"]pointerdown['"]|input\.once\(\s*['"]pointerup['"]/i.test(combined) &&
    !/setInteractive\([^)]*\)[\s\S]{0,200}pointerup/i.test(combined)
  ) {
    // Heuristic: whole-scene pointer once() on Title is a common mis-click trap.
    const titleLike = /class\s+TitleScene|super\(\s*['"]TitleScene['"]/i.test(combined);
    if (titleLike && /this\.input\.once\(\s*['"]pointer(up|down)['"]/i.test(combined)) {
      issues.push(
        'Title 使用整画布 pointer 开始：用户点击预览抢焦点会立刻开局；请改为显式 Start 按钮的 setInteractive',
      );
    }
  }
  if (
    /player\.y\s*>/.test(combined) &&
    /loseLife|lives\s*-=|lives\s*--/.test(combined) &&
    !/body\.reset\s*\(/.test(combined)
  ) {
    issues.push(
      '平台跳跃虚空/重生未使用 body.reset(x,y)：只改 sprite.y 会让 Arcade body 留在虚空并同帧扣光命',
    );
  }
  return issues;
}

const OG_TEXTURE_KEYS = [
  ['og_player', 'player'],
  ['og_player_run', 'player_run'],
  ['og_enemy', 'enemy'],
  ['og_item', 'item'],
  ['og_bg', 'background'],
] as const;

/**
 * Scene asks for og_* while game.json only has bare MiniMax ids and code never
 * registers aliases → spriteOrRect falls back to colored rects.
 */
export async function detectMissingOgTextureAliases(workspace: string): Promise<string[]> {
  const issues: string[] = [];
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (!fs.existsSync(scenesDir)) return issues;

  let combined = '';
  const entries = await fsp.readdir(scenesDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.ts')) continue;
    combined += `\n${await fsp.readFile(path.join(scenesDir, e.name), 'utf8')}`;
  }

  const usedOg = OG_TEXTURE_KEYS.filter(([og]) =>
    new RegExp(`['"\`]${og}['"\`]`).test(combined),
  );
  if (usedOg.length === 0) return issues;

  const hasAliasLogic =
    /ensureGameArtAliases|preloadGameArt/.test(combined) ||
    usedOg.every(([og]) =>
      new RegExp(`load\\.image\\(\\s*['"\`]${og}['"\`]`).test(combined),
    );

  let assetIds = new Set<string>();
  for (const rel of ['public/game.json', 'game.json']) {
    const p = path.join(workspace, rel);
    if (!fs.existsSync(p)) continue;
    try {
      const dsl = JSON.parse(await fsp.readFile(p, 'utf8')) as {
        assets?: Array<{ id?: string }>;
      };
      for (const a of dsl.assets ?? []) {
        if (a?.id) assetIds.add(a.id);
      }
    } catch {
      /* ignore */
    }
  }
  if (assetIds.size === 0) return issues;

  for (const [og, bare] of usedOg) {
    const hasOg = assetIds.has(og);
    const hasBare = assetIds.has(bare);
    if (!hasOg && !hasBare) {
      issues.push(
        `Scene 引用纹理 '${og}'，但 game.json assets 缺少 '${og}' 与 '${bare}'`,
      );
    } else if (!hasOg && hasBare && !hasAliasLogic) {
      issues.push(
        `Scene 使用 '${og}' 而 game.json 仅有 '${bare}'：请调用 PlatformSceneHelper.ensureGameArtAliases / preloadGameArt，或 load.image('${og}', ...)`,
      );
    }
  }
  return issues;
}

/**
 * HUD chrome that looks like a button (stroked rect + MODE/START/RETRY label)
 * but the file never calls setInteractive → fake button.
 *
 * IMPORTANT: only scan string / template literal *contents*. A prior `/i` regex
 * with `\bSTART\b` matched `.start()` across quote boundaries and false-failed
 * every Scene that called `scene.start` / `dialogue.start` beside stroked rects.
 */
export async function detectFakeHudButtons(workspace: string): Promise<string[]> {
  const issues: string[] = [];
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (!fs.existsSync(scenesDir)) return issues;
  const hudLabelRe =
    /(?:EASY\s*MODE|NORMAL\s*MODE|HARD\s*MODE|◆\s*EASY|◆\s*NORMAL|\bSTART\b|\bRETRY\b|\bMODE\b)/i;
  const entries = await fsp.readdir(scenesDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.ts')) continue;
    const src = await fsp.readFile(path.join(scenesDir, e.name), 'utf8');
    const stringContents = extractJsStringLiterals(src);
    const hasChromeLabel = stringContents.some((s) => hudLabelRe.test(s));
    const hasStrokedRect =
      /\.rectangle\s*\(/.test(src) && /setStrokeStyle\s*\(/.test(src);
    const hasInteractive = /setInteractive\s*\(/.test(src);
    if (hasChromeLabel && hasStrokedRect && !hasInteractive) {
      issues.push(
        `${e.name}: HUD 含 MODE/START/RETRY 样式描边矩形但无 setInteractive（假按钮）；请可点或改为纯文字标签`,
      );
    }
  }
  return issues;
}

/** Collect contents of '...', "...", and `...` literals (no nested template interp). */
export function extractJsStringLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const raw = m[0]!;
    out.push(raw.slice(1, -1));
  }
  return out;
}

/**
 * Character/item sprites should be matted (have transparency). Fully opaque
 * player/enemy/item PNGs usually mean MiniMax plate without rembg/imgly.
 */
export async function detectOpaqueSpriteAssets(workspace: string): Promise<string[]> {
  const { isFullyOpaquePng, shouldMatteAsset } = await import('./assetMatte.js');
  const issues: string[] = [];
  const assetsDir = path.join(workspace, 'public', 'assets');
  if (!fs.existsSync(assetsDir)) return issues;
  for (const name of ['player.png', 'player_run.png', 'enemy.png', 'item.png']) {
    const full = path.join(assetsDir, name);
    if (!fs.existsSync(full)) continue;
    if (!shouldMatteAsset(name)) continue;
    try {
      const buf = await fsp.readFile(full);
      if (await isFullyOpaquePng(buf)) {
        issues.push(
          `assets/${name} 几乎无透明像素：角色/道具槽应自动抠图；请重跑 ASSET 或 applyMattePolicy`,
        );
      }
    } catch {
      /* ignore probe errors */
    }
  }
  return issues;
}
