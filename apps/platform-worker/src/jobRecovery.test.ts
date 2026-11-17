/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildChangePlanAbortRecovery,
  buildNarrativeQualityRecovery,
  formatRecoveryLogMessage,
  writeJobRecovery,
  readJobRecovery,
} from './jobRecovery.js';
import { parseChangePlan } from './changePlan.js';

describe('jobRecovery', () => {
  it('builds ChangePlan abort recovery with suggested prompts', async () => {
    const plan = parseChangePlan({
      userPrompt: '更难一点，加一个 Boss，画风换成赛博朋克',
      intent: 'iterate',
    });
    const recovery = buildChangePlanAbortRecovery(plan, [
      'ChangePlan addBoss: Scene 未见 bossPresent',
      'ChangePlan artStyle: 指纹缺少 player.png',
    ]);
    expect(recovery.kind).toBe('change_plan_abort');
    expect(recovery.suggestedPrompts.length).toBeGreaterThanOrEqual(2);
    expect(recovery.suggestedPrompts.join(' ')).toMatch(/Boss|赛博|画风/i);
    const msg = formatRecoveryLogMessage(recovery);
    expect(msg).toContain('ChangePlan 未落地');
    expect(msg).toContain('建议下一句');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-rec-'));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    await writeJobRecovery(dir, recovery);
    const loaded = readJobRecovery(dir);
    expect(loaded?.schema).toBe('opengame-job-recovery-v1');
    expect(loaded?.issues[0]).toMatch(/ChangePlan/);
  });

  it('builds narrative quality recovery', () => {
    const recovery = buildNarrativeQualityRecovery([
      '叙事门禁: 缺少 public/STORY_BIBLE.json（章节×NPC×任务大纲）',
      '叙事门禁: STORY_BIBLE 需要 ≥2 可对话 NPC',
    ]);
    expect(recovery.kind).toBe('quality_gate');
    expect(recovery.suggestedPrompts.join(' ')).toMatch(/铁匠|角色|小镇|台词/i);
  });
});
