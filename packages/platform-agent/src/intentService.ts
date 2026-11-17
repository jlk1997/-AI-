/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IntentKind, IterationDelta } from './types.js';

const RESET_PATTERNS =
  /重做|从零|重新开始|换类型|换个游戏|全部推翻|reset|start over|remake/i;
const ITERATE_PATTERNS =
  /加|改|调|优化|提升|换|增加|减少|修复|加长|缩短|更难|更简单|add|change|tweak|improve|fix/i;

export function extractIterationDelta(
  userPrompt: string,
  hasExistingGame: boolean,
): IterationDelta {
  const trimmed = userPrompt.trim();
  if (RESET_PATTERNS.test(trimmed)) {
    return {
      intent: 'reset',
      summary: '用户要求重做或更换游戏类型',
      changes: [trimmed],
    };
  }
  if (hasExistingGame && ITERATE_PATTERNS.test(trimmed)) {
    return {
      intent: 'iterate',
      summary: trimmed.slice(0, 200),
      changes: splitChanges(trimmed),
    };
  }
  if (hasExistingGame && trimmed.length < 80) {
    return {
      intent: 'iterate',
      summary: trimmed,
      changes: [trimmed],
    };
  }
  return {
    intent: hasExistingGame ? 'iterate' : 'create',
    summary: trimmed.slice(0, 300),
    changes: hasExistingGame ? splitChanges(trimmed) : [trimmed],
  };
}

function splitChanges(text: string): string[] {
  return text
    .split(/[，,；;。.\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .slice(0, 8);
}

export function formatDeltaForPrompt(delta: IterationDelta): string {
  const lines = [
    '【本轮变更意图 / Iteration delta】',
    `- 意图: ${delta.intent}`,
    `- 摘要: ${delta.summary}`,
  ];
  if (delta.changes.length > 0) {
    lines.push('- 变更点:');
    for (const c of delta.changes) {
      lines.push(`  * ${c}`);
    }
  }
  if (delta.intent === 'iterate') {
    lines.push('- 要求: 在现有游戏基础上增量修改，禁止整盘重写。');
  }
  if (delta.intent === 'reset') {
    lines.push('- 要求: 用户明确要求重做，可重建 game.json 与核心玩法。');
  }
  return lines.join('\n');
}

export function resolveEffectiveIntent(
  delta: IterationDelta,
  workspaceHasGame: boolean,
): IntentKind {
  if (delta.intent === 'reset') return 'reset';
  if (workspaceHasGame) return 'iterate';
  return 'create';
}
