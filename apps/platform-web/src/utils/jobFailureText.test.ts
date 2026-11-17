/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseRecoverySuggestedPrompts } from './jobFailureText';

describe('parseRecoverySuggestedPrompts', () => {
  it('extracts numbered suggestions from ChangePlan abort block', () => {
    const block = [
      'ChangePlan 未落地（已停止空转 FIX）',
      '你的改口（加 Boss · 更难）连续自愈后仍未落地。',
      '建议下一句：',
      '1. 在主关卡明确生成一个带 BOSS 标签的敌人',
      '2. 把敌人数量和 HP 再提高一档',
      '门禁摘要: ChangePlan addBoss: 未见',
    ].join('\n');
    const prompts = parseRecoverySuggestedPrompts(block);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toMatch(/BOSS/i);
    expect(prompts[1]).toMatch(/HP|敌人/);
  });

  it('returns empty when no suggestion section', () => {
    expect(parseRecoverySuggestedPrompts('Generate FSM exhausted')).toEqual([]);
  });

  it('extracts suggestions from FAIL tip copy', () => {
    const tip = [
      '生成失败：ChangePlan 未落地',
      '',
      '一键填入恢复建议：',
      '1. 在主关卡明确生成一个带 BOSS 标签的敌人',
      '2. Raise enemy HP one notch',
    ].join('\n');
    const prompts = parseRecoverySuggestedPrompts(tip);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toMatch(/BOSS/i);
  });
});
