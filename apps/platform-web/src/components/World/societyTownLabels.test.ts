/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  goalReasonLabel,
  readableResidentAction,
  stillHeading,
  whyLine,
} from './societyTownLabels';

const t = (key: string, vars?: Record<string, string>) => {
  const table: Record<string, string> = {
    'product.obs.whyPlan': '按今天的安排',
    'product.obs.whyNamed': '计划里写了这儿',
    'product.obs.whyCrowd': '那边有人',
    'product.obs.whyPortal': `正走向${vars?.place ?? ''}路口`,
    'product.obs.whyToPlace': `${vars?.reason}，去${vars?.place}`,
    'product.obs.headingTo': `前往 ${vars?.place}`,
    'product.obs.whyHunger': '饿了',
    'product.obs.whyLine': `${vars?.drive} → ${vars?.place}（${vars?.reason}）`,
    'product.obs.crossing': '路口',
  };
  return table[key] ?? key;
};

describe('society town action copy', () => {
  it('maps planner reason enums to Chinese', () => {
    expect(goalReasonLabel('named', t)).toBe('计划里写了这儿');
    expect(goalReasonLabel('crowd', t)).toBe('那边有人');
    expect(goalReasonLabel('窑火熄了，改去别处', t)).toBe('窑火熄了，改去别处');
  });

  it('does not dump named → 麦田', () => {
    expect(
      whyLine({
        goalPlace: '麦田',
        goalReason: 'named',
        currentAction: '检查面团是否发酵',
        t,
      }),
    ).toBe('计划里写了这儿，去麦田');
  });

  it('prefers a heading line while they are still walking', () => {
    expect(stillHeading({ x: 2, y: 2, goalX: 18, goalY: 16 })).toBe(true);
    expect(
      readableResidentAction({
        currentAction: '检查面团是否发酵',
        goalPlace: '麦田',
        goalReason: 'named',
        x: 2,
        y: 2,
        goalX: 18,
        goalY: 16,
        t,
      }),
    ).toBe('前往 麦田');
    expect(
      readableResidentAction({
        currentAction: '往麦田走',
        goalPlace: '麦田',
        goalReason: 'named',
        t,
      }),
    ).toBe('往麦田走');
  });
});
