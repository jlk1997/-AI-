/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { mergeCourseHints, type CourseReturnHint } from './courseBoard.js';

describe('mergeCourseHints', () => {
  it('attaches the hint for that deployment and leaves others null', () => {
    const hint: CourseReturnHint = {
      prompt: '今夜谁先离开',
      status: 'open',
      pool: 24,
      canon: null,
    };
    const merged = mergeCourseHints(
      [
        { deploymentId: 'd1', slug: 'a' },
        { deploymentId: 'd2', slug: 'b' },
      ],
      new Map([['d1', hint]]),
    );
    expect(merged[0]?.course).toEqual(hint);
    expect(merged[1]?.course).toBeNull();
  });
});
