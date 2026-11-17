/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One-time nudge after first stake: subscribe to「观望」for the next board.
 */

const KEY = 'og.course.watchStakePrompt.v1';

function readSeen(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

export function shouldShowWatchAfterStakePrompt(gameId: string): boolean {
  const trimmed = gameId.trim();
  if (!trimmed) return false;
  return !readSeen().has(trimmed);
}

export function markWatchAfterStakePromptSeen(gameId: string): void {
  const trimmed = gameId.trim();
  if (!trimmed) return;
  const seen = readSeen();
  seen.add(trimmed);
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore */
  }
}
