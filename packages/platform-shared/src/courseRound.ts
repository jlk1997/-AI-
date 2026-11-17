/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Configurable round length (P2). Does not change pari-mutuel math.
 */

import { COURSE } from './courseMarket.js';

export type CourseRoundPreset = 'default' | 'fast';

export function parseCourseRoundPreset(
  raw: string | null | undefined,
): CourseRoundPreset {
  const trimmed = raw?.trim().toLowerCase();
  return trimmed === 'fast' ? 'fast' : 'default';
}

export function courseRoundMs(
  preset: CourseRoundPreset = 'default',
): { readonly bettingMs: number; readonly evidenceMs: number } {
  if (preset === 'fast') {
    const hour = 60 * 60 * 1000;
    return { bettingMs: 2 * hour, evidenceMs: 2 * hour };
  }
  return { bettingMs: COURSE.bettingMs, evidenceMs: COURSE.evidenceMs };
}
