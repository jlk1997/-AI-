/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export interface WorkspaceGameSummary {
  readonly hasExistingGame: boolean;
  readonly gameJsonPath: string | null;
  readonly title: string | null;
  readonly sceneIds: string[];
  readonly entityIds: string[];
  readonly entityCount: number;
  readonly assetCount: number;
  readonly skillCount: number;
  readonly hasCustomModules: boolean;
  readonly srcFiles: string[];
  readonly summaryText: string;
}

function resolveGameJsonPath(workspace: string): string | null {
  const candidates = [
    path.join(workspace, 'public', 'game.json'),
    path.join(workspace, 'game.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function listSrcFiles(workspace: string): Promise<string[]> {
  const srcDir = path.join(workspace, 'src');
  if (!fs.existsSync(srcDir)) return [];
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(path.join(dir, e.name), rel);
      } else if (/\.(ts|tsx|json|md)$/i.test(e.name)) {
        out.push(`src/${rel}`);
      }
    }
  }
  await walk(srcDir, '');
  return out.sort().slice(0, 40);
}

/**
 * Summarizes the current workspace game for iteration prompts (not full file dump).
 */
export async function summarizeWorkspaceGame(
  workspace: string,
): Promise<WorkspaceGameSummary> {
  const gameJsonPath = resolveGameJsonPath(workspace);
  if (!gameJsonPath) {
    return {
      hasExistingGame: false,
      gameJsonPath: null,
      title: null,
      sceneIds: [],
      entityIds: [],
      entityCount: 0,
      assetCount: 0,
      skillCount: 0,
      hasCustomModules: false,
      srcFiles: await listSrcFiles(workspace),
      summaryText: '（工作区尚无 game.json，视为首次生成）',
    };
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(await fsp.readFile(gameJsonPath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return {
      hasExistingGame: true,
      gameJsonPath,
      title: null,
      sceneIds: [],
      entityIds: [],
      entityCount: 0,
      assetCount: 0,
      skillCount: 0,
      hasCustomModules: false,
      srcFiles: await listSrcFiles(workspace),
      summaryText: `（${gameJsonPath} 存在但无法解析 JSON）`,
    };
  }

  const meta =
    parsed['meta'] && typeof parsed['meta'] === 'object'
      ? (parsed['meta'] as Record<string, unknown>)
      : {};
  const title =
    typeof meta['title'] === 'string' ? meta['title'] : null;
  const scenes = Array.isArray(parsed['scenes']) ? parsed['scenes'] : [];
  const sceneIds: string[] = [];
  const entityIds: string[] = [];
  let entityCount = 0;
  for (const s of scenes) {
    if (!s || typeof s !== 'object') continue;
    const row = s as Record<string, unknown>;
    if (typeof row['id'] === 'string') sceneIds.push(row['id']);
    if (Array.isArray(row['entities'])) {
      entityCount += row['entities'].length;
      for (const e of row['entities']) {
        if (!e || typeof e !== 'object') continue;
        const ent = e as Record<string, unknown>;
        if (typeof ent['id'] === 'string') entityIds.push(ent['id']);
      }
    }
  }
  const assets = Array.isArray(parsed['assets']) ? parsed['assets'] : [];
  const skills = Array.isArray(parsed['skills']) ? parsed['skills'] : [];
  const customModules = Array.isArray(parsed['customModules'])
    ? parsed['customModules']
    : [];
  const dialogue = Array.isArray(parsed['dialogue']) ? parsed['dialogue'] : [];
  const rules =
    parsed['rules'] && typeof parsed['rules'] === 'object'
      ? parsed['rules']
      : null;

  const srcFiles = await listSrcFiles(workspace);
  const sceneOutlines: string[] = [];
  for (const s of scenes.slice(0, 8)) {
    if (!s || typeof s !== 'object') continue;
    const row = s as Record<string, unknown>;
    const id = typeof row['id'] === 'string' ? row['id'] : '?';
    const ents = Array.isArray(row['entities'])
      ? (row['entities'] as Array<Record<string, unknown>>)
      : [];
    const names = ents
      .map((e) => String(e['name'] ?? e['id'] ?? ''))
      .filter(Boolean)
      .slice(0, 6);
    sceneOutlines.push(
      `${id}{ents=${ents.length}${names.length ? `:${names.join('/')}` : ''}}`,
    );
  }

  const dialoguePreview = dialogue
    .slice(0, 4)
    .map((d) => {
      if (!d || typeof d !== 'object') return '';
      const row = d as Record<string, unknown>;
      const sp = String(row['speaker'] ?? '');
      const tx = String(row['text'] ?? '').slice(0, 40);
      return sp ? `${sp}:${tx}` : tx;
    })
    .filter(Boolean);

  let storyFiles = 0;
  const storyDir = path.join(workspace, 'public', 'story');
  if (fs.existsSync(storyDir)) {
    try {
      storyFiles = (await fsp.readdir(storyDir)).filter((f) =>
        f.endsWith('.json'),
      ).length;
    } catch {
      /* optional */
    }
  }

  // Prefer story bible NPC ids when present (narrative targeting)
  try {
    const biblePath = path.join(workspace, 'public', 'STORY_BIBLE.json');
    if (fs.existsSync(biblePath)) {
      const bible = JSON.parse(fs.readFileSync(biblePath, 'utf8')) as {
        npcs?: Array<{ id?: string }>;
      };
      for (const n of bible.npcs ?? []) {
        if (n?.id && !entityIds.includes(n.id)) entityIds.push(n.id);
      }
    }
  } catch {
    /* optional */
  }

  const lines = [
    `标题: ${title ?? '（未命名）'}`,
    `场景: ${sceneIds.join(', ') || '（无）'}`,
    `场景大纲: ${sceneOutlines.join(' · ') || '（无）'}`,
    `实体数: ${entityCount}`,
    `实体/NPC: ${entityIds.slice(0, 12).join(', ') || '（无）'}`,
    `资产条目: ${assets.length}`,
    `技能链: ${skills.length}`,
    `对话条数: ${dialogue.length}`,
    `对话预览: ${dialoguePreview.join(' | ') || '（无）'}`,
    `story JSON: ${storyFiles}`,
    `规则块: ${rules ? '有' : '无'}`,
    `自定义模块: ${customModules.length > 0 ? customModules.join(', ') : '无'}`,
    `源码文件: ${srcFiles.length > 0 ? srcFiles.join(', ') : '（仅 DSL）'}`,
  ];

  return {
    hasExistingGame: true,
    gameJsonPath,
    title,
    sceneIds,
    entityIds,
    entityCount,
    assetCount: assets.length,
    skillCount: skills.length,
    hasCustomModules: customModules.length > 0,
    srcFiles,
    summaryText: lines.join('\n'),
  };
}

/**
 * How much target-Scene source to paste into an iteration prompt.
 *
 * The slice is a pointer, not the source of truth — the CLI opens the file
 * itself. 8000 characters used to be a third of the round-1 prompt for a file
 * the model was about to read anyway.
 */
export function readTargetSceneSliceChars(): number {
  const raw = Number(process.env['PLATFORM_TARGET_SCENE_CHARS'] ?? '4000');
  if (!Number.isFinite(raw) || raw < 0) return 4000;
  return Math.floor(raw);
}

/**
 * Read up to maxChars of the target Scene TS for iteration prompts.
 */
export async function readTargetSceneSlice(
  workspace: string,
  targetSceneId: string,
  maxChars = readTargetSceneSliceChars(),
): Promise<string> {
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (!fs.existsSync(scenesDir)) return '';
  const files = await fsp.readdir(scenesDir);
  const hit =
    files.find((f) => f.replace(/\.ts$/i, '') === targetSceneId) ||
    files.find((f) => f.includes(targetSceneId) && f.endsWith('.ts'));
  if (!hit) return '';
  const src = await fsp.readFile(path.join(scenesDir, hit), 'utf8');
  if (src.length <= maxChars) return src;
  return `${src.slice(0, maxChars)}\n/* …truncated ${src.length - maxChars} chars */\n`;
}

export function workspaceHasPlayableGame(workspace: string): boolean {
  return resolveGameJsonPath(workspace) !== null;
}

/**
 * Soft-reset for "重做/reset" intents: clear playable markers so the next job
 * runs first-generation classify+GDD+scaffold, while keeping node_modules.
 */
export async function prepareWorkspaceForReset(
  workspace: string,
): Promise<{ readonly removed: string[] }> {
  const removed: string[] = [];
  const targets = [
    path.join(workspace, 'public', 'game.json'),
    path.join(workspace, 'game.json'),
    path.join(workspace, 'GAME_DESIGN.md'),
    path.join(workspace, 'public', 'CHANGE_PLAN.json'),
    path.join(workspace, 'public', 'ASSET_BRIEF.json'),
    path.join(workspace, '.opengame', 'cli-session.json'),
  ];
  for (const p of targets) {
    try {
      if (fs.existsSync(p)) {
        await fsp.unlink(p);
        removed.push(path.relative(workspace, p));
      }
    } catch {
      // best-effort
    }
  }
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (fs.existsSync(scenesDir)) {
    try {
      const files = await fsp.readdir(scenesDir);
      for (const f of files) {
        if (!/\.(ts|tsx|js)$/i.test(f)) continue;
        // Keep shared helpers if any; wipe Scene entry points
        if (!/Scene\.(ts|tsx|js)$/i.test(f) && f !== 'index.ts') continue;
        const full = path.join(scenesDir, f);
        await fsp.unlink(full);
        removed.push(path.relative(workspace, full));
      }
    } catch {
      // best-effort
    }
  }
  const stamp = path.join(workspace, 'public', 'RESET_STAMP.json');
  await fsp.mkdir(path.dirname(stamp), { recursive: true });
  await fsp.writeFile(
    stamp,
    JSON.stringify(
      {
        schema: 'opengame-reset-stamp-v1',
        at: new Date().toISOString(),
        removed,
      },
      null,
      2,
    ),
    'utf8',
  );
  return { removed };
}
