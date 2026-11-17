/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single poller for /me/course-stakes + /me/course-watches (capsule + mine strip).
 */

import { useCallback, useEffect, useState } from 'react';

import { api, type MyCourseStakeRow, type MyCourseWatchRow } from '../../services/api';
import { applyCourseWatchRows } from './courseWatchOutcomeSync';
import {
  onCourseStakeChanged,
  onCourseWatchChanged,
} from './courseTelemetry';

export type MyCourseTonightSnapshot = {
  readonly stakes: readonly MyCourseStakeRow[];
  readonly watches: readonly MyCourseWatchRow[];
};

const EMPTY: MyCourseTonightSnapshot = { stakes: [], watches: [] };

let snapshot: MyCourseTonightSnapshot = EMPTY;
const listeners = new Set<() => void>();
let bootstrapped = false;
let inFlight = false;
let pendingRefresh = false;
let gen = 0;
let lastFetchedAt = 0;
const MOUNT_FRESH_MS = 8_000;
let pollTimer = 0;
let stopStake: (() => void) | null = null;
let stopWatch: (() => void) | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

export function getMyCourseTonightSnapshot(): MyCourseTonightSnapshot {
  return snapshot;
}

export async function refreshMyCourseTonight(
  reason: 'mount' | 'poll' | 'focus' | 'event' | 'manual' = 'manual',
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (reason === 'poll' && typeof document !== 'undefined' && document.hidden) {
    return;
  }
  if (
    reason === 'mount'
    && lastFetchedAt > 0
    && Date.now() - lastFetchedAt < MOUNT_FRESH_MS
  ) {
    return;
  }
  if (inFlight) {
    pendingRefresh = true;
    return;
  }
  inFlight = true;
  const myGen = ++gen;
  try {
    const [stakesRes, watchesRes] = await Promise.all([
      api.me.courseStakes().catch(() => ({ stakes: [] as MyCourseStakeRow[] })),
      api.me.courseWatches().catch(() => ({ watches: [] as MyCourseWatchRow[] })),
    ]);
    if (myGen !== gen) return;
    const watches = watchesRes.watches ?? [];
    applyCourseWatchRows(watches);
    snapshot = {
      stakes: stakesRes.stakes ?? [],
      watches,
    };
    lastFetchedAt = Date.now();
    emit();
  } finally {
    if (myGen === gen) {
      inFlight = false;
      if (pendingRefresh) {
        pendingRefresh = false;
        void refreshMyCourseTonight('event');
      }
    }
  }
}

function onVisibility(): void {
  if (typeof document !== 'undefined' && !document.hidden) {
    void refreshMyCourseTonight('focus');
  }
}

function ensureBootstrapped(): void {
  if (bootstrapped || typeof window === 'undefined') return;
  bootstrapped = true;
  stopStake = onCourseStakeChanged(() => {
    void refreshMyCourseTonight('event');
  });
  stopWatch = onCourseWatchChanged(() => {
    void refreshMyCourseTonight('event');
  });
  pollTimer = window.setInterval(() => {
    void refreshMyCourseTonight('poll');
  }, 45_000);
  window.addEventListener('focus', onVisibility);
  document.addEventListener('visibilitychange', onVisibility);
}

function teardownIfIdle(): void {
  if (listeners.size > 0 || !bootstrapped) return;
  bootstrapped = false;
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = 0;
  }
  stopStake?.();
  stopWatch?.();
  stopStake = null;
  stopWatch = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('focus', onVisibility);
    document.removeEventListener('visibilitychange', onVisibility);
  }
}

/** Test helper — reset singleton between cases. */
export function __resetMyCourseTonightStoreForTests(): void {
  snapshot = EMPTY;
  listeners.clear();
  bootstrapped = false;
  inFlight = false;
  pendingRefresh = false;
  gen = 0;
  lastFetchedAt = 0;
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = 0;
  }
  stopStake?.();
  stopWatch?.();
  stopStake = null;
  stopWatch = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('focus', onVisibility);
    document.removeEventListener('visibilitychange', onVisibility);
  }
}

export function __isMyCourseTonightBootstrappedForTests(): boolean {
  return bootstrapped;
}

/** Test helper — subscribe without React so teardown can be asserted. */
export function __subscribeMyCourseTonightForTests(
  listener: () => void,
): () => void {
  ensureBootstrapped();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    teardownIfIdle();
  };
}

export function useMyCourseTonight(): MyCourseTonightSnapshot & {
  readonly refresh: () => Promise<void>;
} {
  const [snap, setSnap] = useState<MyCourseTonightSnapshot>(snapshot);

  useEffect(() => {
    ensureBootstrapped();
    const listener = (): void => setSnap(snapshot);
    listeners.add(listener);
    setSnap(snapshot);
    void refreshMyCourseTonight('mount');
    return () => {
      listeners.delete(listener);
      teardownIfIdle();
    };
  }, []);

  const refresh = useCallback(
    () => refreshMyCourseTonight('manual'),
    [],
  );

  return { ...snap, refresh };
}
