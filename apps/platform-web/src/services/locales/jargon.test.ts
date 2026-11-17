/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Visitor-facing Chinese must not slip back into the old alley jargon.
 */

import { describe, expect, it } from 'vitest';

import { zhCN } from './zh-CN';

const BANNED = [
  '开镇',
  '点亮',
  '续灯',
  '走向盘',
  '压盘',
  '锁点',
  '加戏',
  '巷议',
  '巷口',
  '课题',
  '推演',
  '涌现',
  '舆情',
  '片区',
  '对白额度',
  '社会世界',
  '可观察的世界',
  '今夜这盘',
  '直接登录',
  '耳语',
  '取证',
];

describe('visitor copy', () => {
  it('does not use the old jargon', () => {
    const hits: string[] = [];
    for (const [key, value] of Object.entries(zhCN)) {
      for (const word of BANNED) {
        if (value.includes(word)) hits.push(`${key}: ${word}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
