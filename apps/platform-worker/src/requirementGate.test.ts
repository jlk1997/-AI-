/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { inferMechanicSpec } from './mechanicSpec.js';
import {
  extractRequirements,
  formatRequirementsForCoder,
  readRequirementSpec,
  writeRequirementSpec,
} from './requirementSpec.js';
import { runRequirementGate } from './requirementGate.js';
import { buildRequirementGapRecovery } from './jobRecovery.js';

function tmpWorkspace(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
}

describe('extractRequirements', () => {
  it('names board / xiangqi loops from a chess prompt', () => {
    const spec = extractRequirements('做个中国象棋，双人本地，点选，将死');
    const ids = spec.features.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['xiangqi', 'boardTurn']));
  });

  it('promotes MechanicSpec custom loops that the lexicon does not know', () => {
    const mechanic = inferMechanicSpec('做一个可以赶海的游戏');
    const spec = extractRequirements('做一个可以赶海的游戏', { mechanic });
    expect(spec.features.some((f) => f.label.includes('赶海'))).toBe(true);
  });

  it('names the mechanics the user asked for', () => {
    const spec = extractRequirements(
      '做一个可以钓鱼的休闲游戏，有商店可以卖鱼买鱼竿，还要有排行榜',
    );
    const ids = spec.features.map((f) => f.id).sort();
    expect(ids).toEqual(['fishing', 'leaderboard', 'shop']);
    expect(spec.features.every((f) => f.source === 'prompt')).toBe(true);
  });

  it('claims nothing for a prompt with no known mechanics', () => {
    const spec = extractRequirements('做一个好玩的游戏，画面好看一点');
    expect(spec.features).toEqual([]);
  });

  it('folds in the design intake brief', () => {
    const spec = extractRequirements('做个武侠游戏', {
      designBrief: '希望有 Boss 战和多结局',
    });
    expect(spec.features.map((f) => f.id).sort()).toEqual(['boss', 'multiEnding']);
  });

  it('accepts pvp from game params even when the prompt is silent', () => {
    const spec = extractRequirements('做个格斗游戏', { variant: 'pvp' });
    const pvp = spec.features.find((f) => f.id === 'pvp');
    expect(pvp?.source).toBe('params');
  });

  it('lets the GDD restate a requirement but not invent one', () => {
    const fromGdd = extractRequirements('做个农场游戏', {
      gdd: '## 玩法\n包含商店购买种子，金币结算',
    });
    expect(fromGdd.features.find((f) => f.id === 'shop')?.source).toBe('gdd');

    const promptOnly = extractRequirements('做个农场游戏');
    expect(promptOnly.features.find((f) => f.id === 'shop')).toBeUndefined();
  });

  it('round-trips through the workspace', async () => {
    const ws = tmpWorkspace('og-reqspec-');
    const spec = extractRequirements('要有 boss 战');
    await writeRequirementSpec(ws, spec);
    expect(fs.existsSync(path.join(ws, 'public', 'REQUIREMENTS.json'))).toBe(true);
    expect(readRequirementSpec(ws)?.features[0]?.id).toBe('boss');
  });
});

describe('runRequirementGate', () => {
  it('passes when the mechanic is implemented in scene code', async () => {
    const ws = tmpWorkspace('og-reqgate-');
    await writeRequirementSpec(ws, extractRequirements('要有 boss 战'));
    write(
      path.join(ws, 'src', 'scenes', 'BattleScene.ts'),
      `const boss = this.add.sprite(0, 0, 'og_enemy');
       this.registry.set('bossHp', 40);`,
    );

    const result = await runRequirementGate(ws);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('reports a mechanic that was designed but never built', async () => {
    const ws = tmpWorkspace('og-reqgate2-');
    await writeRequirementSpec(ws, extractRequirements('要能钓鱼'));
    write(path.join(ws, 'src', 'scenes', 'MainScene.ts'), 'const x = 1;');

    const result = await runRequirementGate(ws);
    expect(result.ok).toBe(false);
    expect(result.missing.map((m) => m.id)).toEqual(['fishing']);
    expect(result.issues[0]).toContain('钓鱼');
  });

  it('does not accept dialogue prose as proof of a mechanic', async () => {
    const ws = tmpWorkspace('og-reqgate3-');
    await writeRequirementSpec(ws, extractRequirements('要能钓鱼'));
    write(path.join(ws, 'src', 'scenes', 'MainScene.ts'), 'const x = 1;');
    // Narrative JSON mentions every keyword, but nothing implements the loop.
    write(
      path.join(ws, 'public', 'STORY_BIBLE.json'),
      JSON.stringify({ npcs: [{ line: '我去钓鱼了，鱼获不错，抛竿吧' }] }),
    );

    const result = await runRequirementGate(ws);
    expect(result.missing.map((m) => m.id)).toEqual(['fishing']);
  });

  it('requires a second mechanical signal for speech-like mechanics', async () => {
    const ws = tmpWorkspace('og-reqgate4-');
    await writeRequirementSpec(ws, extractRequirements('要能钓鱼'));
    // Only the noun, no loop verbs — one signal is not enough.
    write(path.join(ws, 'src', 'scenes', 'MainScene.ts'), "const fish = 'fish';");
    expect((await runRequirementGate(ws)).ok).toBe(false);

    write(
      path.join(ws, 'src', 'scenes', 'MainScene.ts'),
      `let fish = 0;
       const onBite = () => { fish += 1; };`,
    );
    expect((await runRequirementGate(ws)).ok).toBe(true);
  });

  it('accepts DSL-only implementations', async () => {
    const ws = tmpWorkspace('og-reqgate5-');
    await writeRequirementSpec(ws, extractRequirements('限时挑战'));
    write(
      path.join(ws, 'public', 'game.json'),
      JSON.stringify({ tunables: { countdown: 60 } }),
    );
    expect((await runRequirementGate(ws)).ok).toBe(true);
  });

  it('is a no-op when nothing was claimed', async () => {
    const ws = tmpWorkspace('og-reqgate6-');
    const result = await runRequirementGate(ws);
    expect(result.ok).toBe(true);
    expect(result.checks).toEqual([]);
  });

  it('can be switched off entirely', async () => {
    const ws = tmpWorkspace('og-reqgate7-');
    await writeRequirementSpec(ws, extractRequirements('要能钓鱼'));
    write(path.join(ws, 'src', 'scenes', 'MainScene.ts'), 'const x = 1;');
    expect((await runRequirementGate(ws)).ok).toBe(false);

    process.env['PLATFORM_REQUIREMENT_GATE'] = 'false';
    try {
      const off = await runRequirementGate(ws);
      expect(off.ok).toBe(true);
      expect(off.checks).toEqual([]);
    } finally {
      delete process.env['PLATFORM_REQUIREMENT_GATE'];
    }
  });
});

describe('buildRequirementGapRecovery', () => {
  it('names the missing mechanics in the user-facing summary', async () => {
    const ws = tmpWorkspace('og-reqrecover-');
    await writeRequirementSpec(ws, extractRequirements('要能钓鱼，还要有排行榜'));
    write(path.join(ws, 'src', 'scenes', 'MainScene.ts'), 'const x = 1;');

    const gate = await runRequirementGate(ws);
    const recovery = buildRequirementGapRecovery(gate.issues);

    expect(recovery.kind).toBe('requirement_gap');
    expect(recovery.userSummary).toContain('钓鱼');
    expect(recovery.userSummary).toContain('可玩');
    expect(recovery.suggestedPrompts.length).toBeGreaterThan(0);
    expect(recovery.suggestedPrompts[0]).toContain('钓鱼');
  });

  it('degrades gracefully when the issues are not requirement lines', () => {
    const recovery = buildRequirementGapRecovery(['构建失败: tsc error']);
    expect(recovery.issues).toEqual(['构建失败: tsc error']);
    expect(recovery.suggestedPrompts.length).toBeGreaterThan(0);
  });
});

describe('formatRequirementsForCoder', () => {
  it('restates the ask with implementation hints', () => {
    const text = formatRequirementsForCoder(extractRequirements('要有 boss 战'));
    expect(text).toContain('Boss 战');
    expect(text).toContain('bossHp');
  });

  it('returns null when there is nothing to restate', () => {
    expect(formatRequirementsForCoder(extractRequirements('随便做个游戏'))).toBeNull();
  });
});
