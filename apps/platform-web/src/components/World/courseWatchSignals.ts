/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pulse cues for「有盘时提醒我」— open board / settled canon.
 */

import type { MyCourseWatchRow } from '../../services/api';

export type WatchPulseKind = 'open' | 'settled';

const STORAGE_KEY = 'og.course.watchPulseSeen.v1';
const WATCH_PULSE_CHANGED_EVENT = 'og.course.watchPulseChanged';
const PENDING_GAME_KEY = 'og.course.watchPulsePending.v1';

type SeenMap = Record<string, string>;

let seenCache: SeenMap | null = null;

function readSeen(): SeenMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      seenCache = {};
      return seenCache;
    }
    if (seenCache) return seenCache;
    const parsed = JSON.parse(raw) as SeenMap;
    seenCache = parsed && typeof parsed === 'object' ? parsed : {};
    return seenCache;
  } catch {
    seenCache = {};
    return seenCache;
  }
}

function writeSeen(map: SeenMap): void {
  seenCache = map;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(WATCH_PULSE_CHANGED_EVENT));
  } catch {
    /* ignore quota */
  }
}

export function onWatchPulseChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(WATCH_PULSE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(WATCH_PULSE_CHANGED_EVENT, listener);
}

/** Landed from watch Web Push — mark pulse once watches are loaded. */
export function scheduleWatchPulseConsume(gameId: string): void {
  if (typeof window === 'undefined' || !gameId.trim()) return;
  try {
    window.sessionStorage.setItem(PENDING_GAME_KEY, gameId.trim());
  } catch {
    /* ignore quota */
  }
}

export function consumePendingWatchPulse(
  watches: readonly MyCourseWatchRow[],
): boolean {
  if (typeof window === 'undefined') return false;
  let pending: string | null = null;
  try {
    pending = window.sessionStorage.getItem(PENDING_GAME_KEY);
  } catch {
    return false;
  }
  if (!pending) return false;
  const row = watches.find((watch) => watch.gameId === pending);
  if (!row) return false;
  markWatchPulseSeen(row);
  try {
    window.sessionStorage.removeItem(PENDING_GAME_KEY);
  } catch {
    /* ignore */
  }
  return true;
}

export function watchPulseKind(row: MyCourseWatchRow): WatchPulseKind | null {
  const status = row.course?.status;
  if (status === 'open') return 'open';
  if (status === 'settled' && row.course?.canon?.trim()) return 'settled';
  return null;
}

export function watchPulseFingerprint(row: MyCourseWatchRow): string | null {
  const course = row.course;
  const kind = watchPulseKind(row);
  if (!kind || !course) return null;
  if (kind === 'open') {
    return `open:${course.prompt}:${course.bettingClosesAt ?? ''}`;
  }
  return `settled:${course.canon ?? ''}:${course.prompt}`;
}

export function shouldPulseWatch(row: MyCourseWatchRow): boolean {
  const fp = watchPulseFingerprint(row);
  if (!fp) return false;
  return readSeen()[row.gameId] !== fp;
}

export function markWatchPulseSeen(row: MyCourseWatchRow): void {
  const fp = watchPulseFingerprint(row);
  if (!fp) return;
  const seen = readSeen();
  writeSeen({ ...seen, [row.gameId]: fp });
}

export function anyWatchShouldPulse(watches: readonly MyCourseWatchRow[]): boolean {
  return watches.some(shouldPulseWatch);
}

export function watchPulseBadgeKey(row: MyCourseWatchRow): string | null {
  const kind = watchPulseKind(row);
  if (!kind || !shouldPulseWatch(row)) return null;
  return kind === 'open'
    ? 'profile.myWatches.badge.open'
    : 'profile.myWatches.badge.settled';
}
