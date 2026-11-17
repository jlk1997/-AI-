/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * A few core residents think deeply. The rest are the crowd.
 * Calls are capped per hour. Thinking does not wait on the walk lock.
 */

import type { ConflictCell } from './conflict.js';
import type { Psyche } from './psyche.js';

export const CORE_MIN = 12;
export const CORE_MAX = 24;

export function salience(psyche: Psyche, cell?: ConflictCell): number {
  const emotion = Math.max(
    psyche.emotions.anger,
    psyche.emotions.fear,
    psyche.emotions.sadness,
    psyche.emotions.hope,
  );
  const clash = cell ? cell.rung / 8 : 0;
  return emotion * 0.4 + psyche.grievance * 0.25 + clash * 0.25 + (1 - psyche.boredom) * 0.1;
}

export function selectCore<T extends { readonly id: string }>(
  rows: readonly T[],
  score: (row: T) => number,
  limit = CORE_MAX,
): T[] {
  const cap = Math.max(1, Math.min(CORE_MAX, limit));
  return [...rows].sort((a, b) => score(b) - score(a)).slice(0, cap);
}

export function deepCallsPerHour(): number {
  const n = Number(process.env['OPENGAME_SOCIETY_DEEP_CALLS_PER_HOUR'] ?? '');
  return Number.isFinite(n) && n >= 0 ? Math.min(80, n) : 12;
}

export function forecastCallBudget(): number {
  const n = Number(process.env['OPENGAME_FORECAST_LLM_CALLS'] ?? '');
  return Number.isFinite(n) && n >= 0 ? Math.min(64, n) : 8;
}

/** One simulated hour takes about three real minutes at the default beat. */
export function deepDtHours(): number {
  const n = Number(process.env['OPENGAME_SOCIETY_DEEP_DT_HOURS'] ?? '');
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.02;
}

export function takeCall(input: {
  readonly bucket: string;
  readonly calls: number;
  readonly cap: number;
}): { readonly ok: boolean; readonly bucket: string; readonly calls: number } {
  if (input.calls >= input.cap) return { ok: false, bucket: input.bucket, calls: input.calls };
  return { ok: true, bucket: input.bucket, calls: input.calls + 1 };
}
