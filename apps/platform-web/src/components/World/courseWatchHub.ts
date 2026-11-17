/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sort / surface helpers for profile「今夜走向盘」hub.
 */

import type { MyCourseStakeRow, MyCourseWatchRow } from '../../services/api';
import {
  listUnseenCourseOutcomes,
  type CourseOutcomeRecord,
} from './courseOutcomeInbox';
import {
  shouldPulseWatch,
  watchPulseKind,
} from './courseWatchSignals';

/** Lower = higher priority in the hub watch list. */
export function courseWatchHubRank(row: MyCourseWatchRow): number {
  const pulsing = shouldPulseWatch(row);
  const kind = watchPulseKind(row);
  if (pulsing && kind === 'settled') return 0;
  if (pulsing && kind === 'open') return 1;
  if (row.course?.status === 'settled') return 2;
  if (row.course?.status === 'open') return 3;
  if (row.course?.status === 'closed') return 4;
  return 5;
}

export function sortCourseWatchHubRows(
  rows: readonly MyCourseWatchRow[],
): MyCourseWatchRow[] {
  return [...rows].sort((a, b) => {
    const rank = courseWatchHubRank(a) - courseWatchHubRank(b);
    if (rank !== 0) return rank;
    return a.title.localeCompare(b.title);
  });
}

export type CourseWatchSettledHit = {
  readonly outcome: CourseOutcomeRecord;
  readonly watch: MyCourseWatchRow;
};

/** Unseen watch_settled inbox rows that still match a subscribed town. */
export function listWatchSettledHits(
  watches: readonly MyCourseWatchRow[],
): CourseWatchSettledHit[] {
  const byGame = new Map(watches.map((row) => [row.gameId, row]));
  const out: CourseWatchSettledHit[] = [];
  for (const outcome of listUnseenCourseOutcomes()) {
    if (outcome.kind !== 'watch_settled') continue;
    const watch = byGame.get(outcome.gameId);
    if (!watch) continue;
    out.push({ outcome, watch });
  }
  return out;
}

export type CourseTonightMineChip =
  | { readonly kind: 'stake'; readonly row: MyCourseStakeRow }
  | { readonly kind: 'watch'; readonly row: MyCourseWatchRow };

/**
 * Community strip chips: pulsing watches first (reserved), then stakes, then rest.
 * Prevents six stakes from starving settled/open watch pulses.
 */
export function pickCourseTonightMineChips(
  stakes: readonly MyCourseStakeRow[],
  watches: readonly MyCourseWatchRow[],
  maxChips = 6,
  reservedPulse = 2,
): CourseTonightMineChip[] {
  const activeStakes = stakes.filter(
    (row) => row.status === 'open' || row.status === 'closed',
  );
  const stakedIds = new Set(activeStakes.map((row) => row.gameId));
  const ranked = sortCourseWatchHubRows(
    watches.filter((row) => !stakedIds.has(row.gameId)),
  );
  const pulsing = ranked.filter((row) => shouldPulseWatch(row));
  const rest = ranked.filter((row) => !shouldPulseWatch(row));
  const head = pulsing.slice(0, Math.min(reservedPulse, maxChips));
  const stakeBudget = Math.max(0, maxChips - head.length);
  const stakeRows = activeStakes.slice(0, stakeBudget);
  const leftover = Math.max(0, maxChips - head.length - stakeRows.length);
  const tail = [...pulsing.slice(head.length), ...rest].slice(0, leftover);
  return [
    ...head.map((row) => ({ kind: 'watch' as const, row })),
    ...stakeRows.map((row) => ({ kind: 'stake' as const, row })),
    ...tail.map((row) => ({ kind: 'watch' as const, row })),
  ];
}
