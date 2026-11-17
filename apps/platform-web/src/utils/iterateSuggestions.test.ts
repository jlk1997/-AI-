/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildSuccessIteratePrompts,
  detectIterateKind,
  resolveQuickActionPrompt,
} from './iterateSuggestions.js';

describe('iterateSuggestions', () => {
  it('detects narrative vs platformer', () => {
    expect(
      detectIterateKind({
        lastUserPrompt: '做一个小镇剧情：3 NPC、2 任务',
      }),
    ).toBe('narrative');
    expect(
      detectIterateKind({
        lastUserPrompt: '做一个横版霓虹跑酷，两关',
      }),
    ).toBe('platformer');
  });

  it('builds actionable next prompts', () => {
    const n = buildSuccessIteratePrompts('narrative');
    expect(n.some((p) => /铁匠|对话/.test(p))).toBe(true);
    const p = buildSuccessIteratePrompts('platformer');
    expect(p.some((x) => /Boss|金币|赛博/.test(x))).toBe(true);
  });

  it('maps quick actions to ChangePlan-friendly prompts', () => {
    expect(resolveQuickActionPrompt('dialogue')).toMatch(/对话|story/i);
    expect(resolveQuickActionPrompt('harder')).toMatch(/更难/);
  });

  it('keeps share out of iterate prompt list (dedicated CTA)', () => {
    const n = buildSuccessIteratePrompts('narrative');
    expect(n.every((p) => !/分享到社区/.test(p))).toBe(true);
    expect(n[0]).toMatch(/铁匠|对话/);
  });
});
