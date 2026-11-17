/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Juice hard-lock baseline: remember which gameplay Scenes had PlatformSceneHelper
 * so FIX/CODE regressions fail the gate instead of silently becoming mute color blocks.
 * Phase-36: deterministically restore juice from baseline (gates > hoping CODE).
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

const JUICE_RE =
  /PlatformSceneHelper|preloadGameAudio|playSfx|addParallaxBackground|installPauseMenu|followPlayer|ensureBgm/;

const HELPER_IMPORT =
  "import { PlatformSceneHelper } from '@opengame/module-platform';";

const PRELOAD_JUICE_SNIPPET = `
    // OpenGame juice restore (JUICE_BASELINE)
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
`;

const CREATE_JUICE_SNIPPET = `
    // OpenGame juice restore (JUICE_BASELINE)
    try { PlatformSceneHelper.ensureBgm(this); } catch { /* optional */ }
    try { PlatformSceneHelper.installPauseMenu(this); } catch { /* optional */ }
`;

export interface JuiceBaseline {
  readonly schema: 'opengame-juice-baseline-v1';
  readonly at: string;
  readonly scenes: string[];
}

export function juiceBaselinePath(workspace: string): string {
  return path.join(workspace, 'public', 'JUICE_BASELINE.json');
}

export async function scanJuiceScenes(workspace: string): Promise<string[]> {
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (!fs.existsSync(scenesDir)) return [];
  const hits: string[] = [];
  for (const f of await fsp.readdir(scenesDir)) {
    if (!f.endsWith('Scene.ts') && !f.endsWith('ArcadeScene.ts')) continue;
    if (/Title|Ending|Victory|GameOver|Chapter/i.test(f)) continue;
    const src = await fsp.readFile(path.join(scenesDir, f), 'utf8');
    if (JUICE_RE.test(src)) hits.push(f);
  }
  return hits.sort();
}

export async function writeJuiceBaseline(
  workspace: string,
): Promise<JuiceBaseline | null> {
  const scenes = await scanJuiceScenes(workspace);
  if (scenes.length === 0) return null;
  const baseline: JuiceBaseline = {
    schema: 'opengame-juice-baseline-v1',
    at: new Date().toISOString(),
    scenes,
  };
  await fsp.mkdir(path.join(workspace, 'public'), { recursive: true });
  await fsp.writeFile(
    juiceBaselinePath(workspace),
    JSON.stringify(baseline, null, 2),
    'utf8',
  );
  return baseline;
}

export function readJuiceBaseline(workspace: string): JuiceBaseline | null {
  const p = juiceBaselinePath(workspace);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as JuiceBaseline;
  } catch {
    return null;
  }
}

/** Return gate issues when juice scenes from baseline lost PlatformSceneHelper. */
export async function issuesFromJuiceBaseline(
  workspace: string,
): Promise<string[]> {
  const baseline = readJuiceBaseline(workspace);
  if (!baseline?.scenes.length) return [];
  const current = new Set(await scanJuiceScenes(workspace));
  const missing = baseline.scenes.filter((s) => !current.has(s));
  if (missing.length === 0) return [];
  return [
    `Juice 硬锁：以下 Scene 丢失 PlatformSceneHelper juice（相对基线）：${missing.join(', ')} — 请恢复 preloadGameAudio/playSfx/burst/pause，禁止退化成无声色块`,
  ];
}

function ensureHelperImport(src: string): { src: string; changed: boolean } {
  if (/PlatformSceneHelper/.test(src)) {
    return { src, changed: false };
  }
  if (/from\s+['"]phaser['"]\s*;?/.test(src)) {
    return {
      src: src.replace(
        /(from\s+['"]phaser['"]\s*;?\s*\n)/i,
        `$1${HELPER_IMPORT}\n`,
      ),
      changed: true,
    };
  }
  if (/^import\s/m.test(src)) {
    return {
      src: src.replace(/^(import\s.+;\s*\n)/m, `$1${HELPER_IMPORT}\n`),
      changed: true,
    };
  }
  return { src: `${HELPER_IMPORT}\n${src}`, changed: true };
}

function injectPreloadJuice(src: string): { src: string; changed: boolean } {
  if (/preloadGameAudio/.test(src)) {
    if (!/preloadGameArt/.test(src) && /preload\s*\(\s*\)\s*:\s*void\s*\{/.test(src)) {
      return {
        src: src.replace(
          /preload\s*\(\s*\)\s*:\s*void\s*\{/,
          (m) => `${m}\n    PlatformSceneHelper.preloadGameArt(this);\n`,
        ),
        changed: true,
      };
    }
    return { src, changed: false };
  }
  if (/preload\s*\(\s*\)\s*:\s*void\s*\{/.test(src)) {
    return {
      src: src.replace(
        /preload\s*\(\s*\)\s*:\s*void\s*\{/,
        (m) => `${m}${PRELOAD_JUICE_SNIPPET}`,
      ),
      changed: true,
    };
  }
  // No preload — insert before create()
  if (/create\s*\(\s*\)\s*:\s*void\s*\{/.test(src)) {
    return {
      src: src.replace(
        /create\s*\(\s*\)\s*:\s*void\s*\{/,
        `preload(): void {${PRELOAD_JUICE_SNIPPET}  }\n  create(): void {`,
      ),
      changed: true,
    };
  }
  return { src, changed: false };
}

function injectCreateJuice(src: string): { src: string; changed: boolean } {
  if (/ensureBgm|installPauseMenu/.test(src)) {
    return { src, changed: false };
  }
  if (/create\s*\(\s*\)\s*:\s*void\s*\{/.test(src)) {
    return {
      src: src.replace(
        /create\s*\(\s*\)\s*:\s*void\s*\{/,
        (m) => `${m}${CREATE_JUICE_SNIPPET}`,
      ),
      changed: true,
    };
  }
  return { src, changed: false };
}

/**
 * Deterministically re-inject PlatformSceneHelper juice into Scenes listed in
 * JUICE_BASELINE that no longer match the juice regex (mute color-block regression).
 */
export async function restoreJuiceFromBaseline(
  workspace: string,
): Promise<{ readonly patches: string[]; readonly restored: string[] }> {
  const baseline = readJuiceBaseline(workspace);
  if (!baseline?.scenes.length) {
    return { patches: [], restored: [] };
  }
  const current = new Set(await scanJuiceScenes(workspace));
  const missing = baseline.scenes.filter((s) => !current.has(s));
  const patches: string[] = [];
  const restored: string[] = [];
  const scenesDir = path.join(workspace, 'src', 'scenes');

  for (const sceneFile of missing) {
    const full = path.join(scenesDir, sceneFile);
    if (!fs.existsSync(full)) continue;
    let src = await fsp.readFile(full, 'utf8');
    if (!/extends\s+Phaser\.Scene/.test(src)) continue;

    let dirty = false;
    const withImport = ensureHelperImport(src);
    src = withImport.src;
    dirty = dirty || withImport.changed;

    const withPreload = injectPreloadJuice(src);
    src = withPreload.src;
    dirty = dirty || withPreload.changed;

    const withCreate = injectCreateJuice(src);
    src = withCreate.src;
    dirty = dirty || withCreate.changed;

    if (dirty) {
      await fsp.writeFile(full, src, 'utf8');
      patches.push(`juice-restore:${sceneFile}`);
      restored.push(sceneFile);
    }
  }

  return { patches, restored };
}

export function formatJuiceRestoreHint(issues: readonly string[]): string {
  if (!issues.some((i) => i.includes('Juice'))) return '';
  return [
    '',
    '【Juice 硬锁修复】',
    '- 平台会优先按 JUICE_BASELINE 确定性恢复 PlatformSceneHelper（preloadGameAudio/Art + ensureBgm/pause）',
    '- 若仍失败：打开 src/scenes/* 玩法 Scene，确认 import { PlatformSceneHelper } from @opengame/module-platform',
    '- 在 preload 调用 PlatformSceneHelper.preloadGameAudio(this)',
    '- 在 create 调用 ensureBgm / installPauseMenu；得分/死亡处 playSfx + burst/shake',
    '- 禁止删除已有 juice 调用来「简化」代码',
  ].join('\n');
}
