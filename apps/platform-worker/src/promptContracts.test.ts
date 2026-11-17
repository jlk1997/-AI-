/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureCliContextFile } from './cliContextFile.js';
import {
  CLI_CONTEXT_FILENAME,
  buildCliContextDoc,
  buildEnhancedPrompt,
  buildLeanFixPrompt,
} from './promptContracts.js';
import {
  extractRequirements,
  formatRequirementsForCoder,
} from './requirementSpec.js';

const ARCHETYPES = ['top_down', 'platformer', 'ui_heavy', 'grid_logic'] as const;

let tmp: string | null = null;

afterEach(async () => {
  if (tmp) await fsp.rm(tmp, { recursive: true, force: true });
  tmp = null;
});

describe('buildCliContextDoc', () => {
  it('carries the durable manuals', () => {
    const doc = buildCliContextDoc({ archetype: 'top_down' });
    expect(doc).toContain('Phaser 3.90');
    expect(doc).toContain('可玩性硬契约');
    expect(doc).toContain('能力库');
    expect(doc).toContain('平台托管环境');
    expect(doc).toContain('module-board');
  });

  it('drops rules that belong to other archetypes', () => {
    const platformer = buildCliContextDoc({ archetype: 'platformer' });
    expect(platformer).toContain('平台跳跃');
    expect(platformer).not.toContain('top_down 门户硬规则');

    const topDown = buildCliContextDoc({ archetype: 'top_down' });
    expect(topDown).toContain('top_down 门户硬规则');
    expect(topDown).not.toContain('平台跳跃');
  });

  it('keeps every archetype when none is known', () => {
    const doc = buildCliContextDoc();
    expect(doc).toContain('top_down 门户硬规则');
    expect(doc).toContain('平台跳跃');
  });

  it('tells grid_logic that chess is a Scene + module-board loop', () => {
    const doc = buildCliContextDoc({ archetype: 'grid_logic' });
    expect(doc).toContain('module-board');
    expect(doc).toMatch(/棋类必须点选走子|禁止 SPACE 涨分壳/);
  });
});

describe('prompt slimming', () => {
  it('replaces the inlined manual with a pointer to the workspace file', () => {
    const args = {
      basePrompt: '做一个像素农场游戏',
      isIteration: false,
      archetype: 'top_down',
    } as const;
    const inline = buildEnhancedPrompt({ ...args });
    const slim = buildEnhancedPrompt({ ...args, contractInWorkspace: true });

    expect(inline).toContain('Phaser 3.90');
    expect(slim).not.toContain('Phaser 3.90');
    expect(slim).toContain(CLI_CONTEXT_FILENAME);
    // Round-specific bullets must survive — those describe *this* workspace.
    expect(slim).toContain('脚手架契约');
    expect(slim).toContain('平台已写入的 MiniMax 真资产');
    expect(slim.length).toBeLessThan(inline.length / 2);
  });

  it('slims FIX rounds the same way', () => {
    const args = {
      userPrompt: '修一下',
      errorBlock: '【构建失败】TS2554',
    } as const;
    const inline = buildLeanFixPrompt({ ...args });
    const slim = buildLeanFixPrompt({ ...args, contractInWorkspace: true });
    expect(inline).toContain('Phaser 3.90');
    expect(slim).not.toContain('Phaser 3.90');
    expect(slim).toContain('只修错误');
    expect(slim).toContain('【构建失败】TS2554');
    expect(slim.length).toBeLessThan(inline.length);
  });
});

/**
 * The manual now lives in the workspace, and the round prompt only points at it.
 * That saving is invisible from the outside, so nothing stops a later edit from
 * pasting a rule back inline — these budgets fail loudly when one does. Raise a
 * number here only with a reason; every character is paid on every CODE round.
 */
describe('prompt size budgets', () => {
  const basePrompt =
    '做一个像素风格的农场游戏，可以种地、钓鱼，还要有商店和多结局';

  it('keeps the first CODE round lean for every archetype', () => {
    for (const archetype of ARCHETYPES) {
      const slim = buildEnhancedPrompt({
        basePrompt,
        isIteration: false,
        archetype,
        contractInWorkspace: true,
      });
      const inline = buildEnhancedPrompt({
        basePrompt,
        isIteration: false,
        archetype,
      });
      expect(slim.length, `${archetype} slim prompt`).toBeLessThan(2000);
      // Structural, not just numeric: the pointer must be replacing the manual.
      expect(slim.length * 3, `${archetype} vs inline`).toBeLessThan(inline.length);
    }
  });

  it('keeps the workspace manual within the context budget', () => {
    for (const archetype of ARCHETYPES) {
      expect(
        buildCliContextDoc({ archetype }).length,
        `${archetype} ${CLI_CONTEXT_FILENAME}`,
      ).toBeLessThan(9000);
    }
    expect(buildCliContextDoc().length).toBeLessThan(9000);
  });

  it('keeps FIX rounds smaller than the first round', () => {
    const fix = buildLeanFixPrompt({
      userPrompt: basePrompt,
      errorBlock: '【构建失败】TS2554 Expected 1 arguments, but got 0',
      contractInWorkspace: true,
    });
    expect(fix.length).toBeLessThan(1600);
  });

  it('bounds the restated requirement list', () => {
    // Every mechanic in the lexicon at once — the block still cannot run away.
    const everything = extractRequirements(
      '双人对战 boss 钓鱼 商店 背包 存档 多结局 对话选项 技能树 合成 种地 潜行 解谜 限时 排行榜 昼夜 天气 宠物 赛车 塔防',
    );
    expect(everything.features.length).toBeGreaterThan(8);
    const block = formatRequirementsForCoder(everything) ?? '';
    expect(block.length).toBeLessThan(1200);
    expect(block).toContain('REQUIREMENTS.json');
  });
});

describe('ensureCliContextFile', () => {
  it('writes the doc once and reports a no-op on re-run', async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-ctx-'));
    const first = await ensureCliContextFile(tmp, { archetype: 'ui_heavy' });
    expect(first.written).toBe(true);
    expect(path.basename(first.path)).toBe(CLI_CONTEXT_FILENAME);

    const onDisk = await fsp.readFile(first.path, 'utf8');
    expect(onDisk).toContain('ui_heavy');
    expect(onDisk).toContain('Do not edit or delete');

    const second = await ensureCliContextFile(tmp, { archetype: 'ui_heavy' });
    expect(second.written).toBe(false);
  });

  it('rewrites when the archetype changes', async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-ctx-'));
    await ensureCliContextFile(tmp, { archetype: 'ui_heavy' });
    const changed = await ensureCliContextFile(tmp, { archetype: 'top_down' });
    expect(changed.written).toBe(true);
    const onDisk = await fsp.readFile(changed.path, 'utf8');
    expect(onDisk).toContain('top_down');
  });
});
