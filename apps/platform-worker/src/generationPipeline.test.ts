/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentEventStream } from './agentEvents.js';
import {
  buildHeuristicGddMarkdown,
  formatPipelineContextForCoder,
  heuristicArchetypeFromPrompt,
  runGenerationPipeline,
  stampGddArtStyle,
} from './generationPipeline.js';
import { readMechanicSpec } from './mechanicSpec.js';

describe('heuristicArchetypeFromPrompt', () => {
  it('classifies clear arcade prompts as high-confidence grid_logic', () => {
    const r = heuristicArchetypeFromPrompt('做一个贪吃蛇小游戏');
    expect(r.archetype).toBe('grid_logic');
    expect(r.confidence).toBe('high');
  });

  it('keeps mixed 俯视探索 + 象棋 as top_down, not an exclusive chess SKU', () => {
    const r = heuristicArchetypeFromPrompt(
      '俯视探索小镇，还能下中国象棋，有对话选项',
    );
    expect(r.archetype).toBe('top_down');
    expect(r.reason).toBe('mixed-explore-capability');
  });

  it('keeps mixed 俯视探索 + 消消乐 as top_down, not an exclusive candy SKU', () => {
    const r = heuristicArchetypeFromPrompt('俯视探索小镇，还能玩消消乐');
    expect(r.archetype).toBe('top_down');
    expect(r.reason).toBe('mixed-explore-capability');
  });

  it('classifies 中国象棋 and English chess as high-confidence grid_logic, not platformer', () => {
    const cn = heuristicArchetypeFromPrompt('做个中国象棋，双人本地，点选，将死');
    expect(cn.archetype).toBe('grid_logic');
    expect(cn.confidence).toBe('high');
    const en = heuristicArchetypeFromPrompt('make a two-player chess game');
    expect(en.archetype).toBe('grid_logic');
    expect(en.confidence).toBe('high');
  });

  it('classifies tower defense', () => {
    const r = heuristicArchetypeFromPrompt('经典塔防，三波敌人');
    expect(r.archetype).toBe('tower_defense');
    expect(r.confidence).toBe('high');
  });

  it('maps wuxia / RPG explore prompts to top_down, not dialogue VN', () => {
    const wuxia = heuristicArchetypeFromPrompt(
      '做一个武侠RPG：小镇里走动找人说话，选项影响结局，还能打架',
    );
    expect(wuxia.archetype).toBe('top_down');
    const rpg = heuristicArchetypeFromPrompt('角色扮演游戏，能在地图上探索');
    expect(rpg.archetype).toBe('top_down');
  });

  it('keeps pure visual novel as ui_heavy', () => {
    const r = heuristicArchetypeFromPrompt('做一个视觉小说，纯对话选项');
    expect(r.archetype).toBe('ui_heavy');
  });

  it('defaults ambiguous prompts to low-confidence platformer', () => {
    const r = heuristicArchetypeFromPrompt('好玩的小游戏');
    expect(r.archetype).toBe('platformer');
    expect(r.confidence).toBe('low');
  });
});

describe('formatPipelineContextForCoder', () => {
  it('omits GDD body when PLATFORM_CODER_GDD_CHARS=0', () => {
    const prev = process.env['PLATFORM_CODER_GDD_CHARS'];
    process.env['PLATFORM_CODER_GDD_CHARS'] = '0';
    try {
      const text = formatPipelineContextForCoder({
        archetype: 'platformer',
        classificationReasoning: 'test',
        gddMarkdown: '# long gdd\n'.repeat(200),
        assetPhasePrompt: null,
        gddSceneKeys: ['TitleScene', 'LevelScene'],
      });
      expect(text).toContain('TitleScene');
      expect(text).toContain('不复述');
      expect(text).not.toContain('long gdd');
    } finally {
      if (prev === undefined) delete process.env['PLATFORM_CODER_GDD_CHARS'];
      else process.env['PLATFORM_CODER_GDD_CHARS'] = prev;
    }
  });

  it('asks top_down WorldScene to consume layout Spec', () => {
    const text = formatPipelineContextForCoder({
      archetype: 'top_down',
      classificationReasoning: 'rpg',
      gddMarkdown: null,
      assetPhasePrompt: null,
      gddSceneKeys: [],
      worldSeedApplied: true,
    });
    expect(text).toContain('resolveWorldLayoutsBySceneId');
    expect(text).toMatch(/chapterOpenerOnly|Title→Chapter|Skip/);
    expect(text).toMatch(/worldRegionId|scene\.restart|scene\.start/);
    expect(text).toMatch(/bg_region_|playRegionBgm|endings/);
  });

  it('tells the coder to implement MechanicSpec loops, not a SPACE shell', () => {
    const text = formatPipelineContextForCoder({
      archetype: 'grid_logic',
      classificationReasoning: 'xiangqi',
      gddMarkdown: null,
      assetPhasePrompt: null,
      gddSceneKeys: [],
      mechanic: {
        schema: 'opengame-mechanic-v1',
        prompt: '中国象棋',
        space: 'grid',
        time: 'turn',
        input: 'cell-select',
        win: 'checkmate',
        loops: [
          {
            id: 'xiangqi',
            label: '中国象棋',
            signals: ['legalMoves'],
            source: 'lexicon',
          },
        ],
        modules: ['platform', 'board'],
        archetypeHint: 'grid_logic',
        boardKind: 'xiangqi',
        arcadeVariant: 'board_turn',
        updatedAt: new Date().toISOString(),
      },
    });
    expect(text).toContain('module-board');
    expect(text).toContain('BoardTurnScene');
    expect(text).not.toContain('无需 extraScenes');
  });

  it('tells mixed explore+board to keep World and bind BoardTurnScene', () => {
    const text = formatPipelineContextForCoder({
      archetype: 'top_down',
      classificationReasoning: 'mixed-explore-board',
      gddMarkdown: null,
      assetPhasePrompt: null,
      gddSceneKeys: ['TitleScene', 'WorldScene'],
      mechanic: {
        schema: 'opengame-mechanic-v1',
        prompt: '俯视探索小镇，还能下中国象棋',
        space: 'top_down',
        time: 'turn',
        input: 'keys',
        win: 'checkmate',
        loops: [
          {
            id: 'xiangqi',
            label: '中国象棋',
            signals: ['legalMoves'],
            source: 'lexicon',
          },
        ],
        modules: ['platform', 'world', 'board', 'dialogue'],
        archetypeHint: 'top_down',
        boardKind: 'xiangqi',
        extraScenes: ['BoardTurnScene'],
        updatedAt: new Date().toISOString(),
      },
    });
    expect(text).toContain('混合规格');
    expect(text).toContain('BoardTurnScene');
    expect(text).toContain('module-board');
  });
});

describe('buildHeuristicGddMarkdown', () => {
  it('includes scene keys for platformer', () => {
    const md = buildHeuristicGddMarkdown('横版跳跃', 'platformer');
    expect(md).toContain('TitleScene');
    expect(md).toContain('platformer');
  });

  it('documents MechanicSpec so GDD is a manual, not the SSOT', () => {
    const md = buildHeuristicGddMarkdown('中国象棋', 'grid_logic', {
      schema: 'opengame-mechanic-v1',
      prompt: '中国象棋',
      space: 'grid',
      time: 'turn',
      input: 'cell-select',
      win: 'checkmate',
      loops: [
        {
          id: 'xiangqi',
          label: '中国象棋',
          signals: ['legalMoves'],
          source: 'lexicon',
        },
      ],
      modules: ['platform', 'board'],
      archetypeHint: 'grid_logic',
      boardKind: 'xiangqi',
      arcadeVariant: 'board_turn',
      updatedAt: new Date().toISOString(),
    });
    expect(md).toContain('MechanicSpec');
    expect(md).toContain('cell-select');
    expect(md).toContain('BoardTurnScene');
  });
});

describe('stampGddArtStyle', () => {
  it('overwrites the model guess with the picked profile', () => {
    const md = '# Game\n\nart style: 8-bit pixel art\n\n## Enemies\n- foes\n';
    const out = stampGddArtStyle(md, 'ink_wash');
    expect(out).toMatch(/art style: Chinese ink-wash/);
    expect(out).not.toContain('8-bit pixel art');
    expect(out).toContain('## Enemies');
  });

  it('keeps list markers so the GDD still renders', () => {
    const out = stampGddArtStyle('## Art\n\n- art style: pixel\n', 'neon_noir');
    expect(out).toMatch(/^- art style: neon noir/m);
  });

  it('appends a section when the GDD never mentioned art style', () => {
    const out = stampGddArtStyle('# Game\n\n## Loop\n- jump\n', 'soft_3d');
    expect(out).toContain('Art Direction');
    expect(out).toMatch(/2\.5D stylized render/);
  });

  it('leaves the GDD alone without a picked style', () => {
    const md = '# Game\n\nart style: whatever the model said\n';
    expect(stampGddArtStyle(md, null)).toBe(md);
    expect(stampGddArtStyle(md, 'not_a_style')).toBe(md);
  });
});

describe('runGenerationPipeline first-gen MechanicSpec', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await fsp.rm(d, { recursive: true, force: true });
    }
  });

  it('writes MechanicSpec before GDD so chess is not a null spec', async () => {
    const prevSkip = process.env['PLATFORM_SKIP_GDD_LLM'];
    const prevMode = process.env['PLATFORM_CLASSIFY_MODE'];
    process.env['PLATFORM_SKIP_GDD_LLM'] = 'true';
    process.env['PLATFORM_CLASSIFY_MODE'] = 'heuristic';
    const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-pipe-'));
    dirs.push(workspace);
    const stream = { emit: async () => undefined } as unknown as AgentEventStream;
    try {
      const ctx = await runGenerationPipeline({
        userPrompt: '做个中国象棋，双人本地，点选，将死',
        workspace,
        isFirstGeneration: true,
        stream,
      });
      expect(ctx.mechanic?.boardKind).toBe('xiangqi');
      expect(ctx.mechanic?.arcadeVariant).toBe('board_turn');
      expect(readMechanicSpec(workspace)?.boardKind).toBe('xiangqi');
      expect(ctx.gddMarkdown).toContain('MechanicSpec');
    } finally {
      if (prevSkip === undefined) delete process.env['PLATFORM_SKIP_GDD_LLM'];
      else process.env['PLATFORM_SKIP_GDD_LLM'] = prevSkip;
      if (prevMode === undefined) delete process.env['PLATFORM_CLASSIFY_MODE'];
      else process.env['PLATFORM_CLASSIFY_MODE'] = prevMode;
    }
  });

  it('keeps an existing chess spec when iterating 加上钓鱼', async () => {
    const prevSkip = process.env['PLATFORM_SKIP_GDD_LLM'];
    const prevMode = process.env['PLATFORM_CLASSIFY_MODE'];
    process.env['PLATFORM_SKIP_GDD_LLM'] = 'true';
    process.env['PLATFORM_CLASSIFY_MODE'] = 'heuristic';
    const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-pipe-it-'));
    dirs.push(workspace);
    const stream = { emit: async () => undefined } as unknown as AgentEventStream;
    try {
      await runGenerationPipeline({
        userPrompt: '做个中国象棋',
        workspace,
        isFirstGeneration: true,
        stream,
      });
      const ctx = await runGenerationPipeline({
        userPrompt: '加上钓鱼循环',
        workspace,
        isFirstGeneration: false,
        stream,
      });
      expect(ctx.mechanic?.boardKind).toBe('xiangqi');
      expect(ctx.mechanic?.arcadeVariant).toBe('board_turn');
      expect(ctx.mechanic?.loops.some((l) => l.id === 'fishing')).toBe(true);
      expect(ctx.gameOps?.some((o) => o.op === 'add_loop')).toBe(true);
      expect(ctx.intent?.boardKind).toBe('xiangqi');
    } finally {
      if (prevSkip === undefined) delete process.env['PLATFORM_SKIP_GDD_LLM'];
      else process.env['PLATFORM_SKIP_GDD_LLM'] = prevSkip;
      if (prevMode === undefined) delete process.env['PLATFORM_CLASSIFY_MODE'];
      else process.env['PLATFORM_CLASSIFY_MODE'] = prevMode;
    }
  });
});
