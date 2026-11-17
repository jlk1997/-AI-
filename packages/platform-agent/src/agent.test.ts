/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { extractIterationDelta } from './intentService.js';
import { assembleContextStack } from './contextStack.js';

describe('intentService', () => {
  it('detects reset intent', () => {
    const d = extractIterationDelta('请从零重做一款塔防游戏', true);
    expect(d.intent).toBe('reset');
  });

  it('detects iterate intent', () => {
    const d = extractIterationDelta('把蛇加长并加分数', true);
    expect(d.intent).toBe('iterate');
  });
});

describe('contextStack', () => {
  it('assembles layers with brief and delta', () => {
    const r = assembleContextStack({
      userPrompt: '加 Boss 战',
      isIteration: true,
      brief: { version: 1, title: 'RPG', gameplay: '回合制' },
      memories: ['不要像素风'],
      sessionSummary: '用户想要赛博朋克 RPG',
      conversationTurns: [{ role: 'user', content: '加 Boss' }],
      workspaceSummaryText: '标题: RPG\n场景: main',
      ragChunks: ['design rule snippet'],
    });
    expect(r.intent).toBe('iterate');
    expect(r.promptPrefix).toContain('Project Brief');
    expect(r.promptPrefix).toContain('Boss');
    expect(r.layers.L1.chars).toBeGreaterThan(0);
  });
});
