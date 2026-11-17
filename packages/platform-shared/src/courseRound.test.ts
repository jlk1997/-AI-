/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { courseRoundMs, parseCourseRoundPreset } from './courseRound.js';

describe('courseRound', () => {
  it('defaults to 4h betting + 4h evidence', () => {
    const ms = courseRoundMs('default');
    expect(ms.bettingMs).toBe(4 * 60 * 60 * 1000);
    expect(ms.evidenceMs).toBe(4 * 60 * 60 * 1000);
  });

  it('fast preset is 2h + 2h', () => {
    const ms = courseRoundMs('fast');
    expect(ms.bettingMs).toBe(2 * 60 * 60 * 1000);
    expect(ms.evidenceMs).toBe(2 * 60 * 60 * 1000);
  });

  it('parses env preset', () => {
    expect(parseCourseRoundPreset('fast')).toBe('fast');
    expect(parseCourseRoundPreset(' FAST ')).toBe('fast');
    expect(parseCourseRoundPreset(undefined)).toBe('default');
  });
});
