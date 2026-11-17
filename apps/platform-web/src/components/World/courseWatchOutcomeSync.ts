/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Push watch milestones into the global outcome inbox while off-town.
 */

import type { MyCourseWatchRow } from '../../services/api';
import { pushCourseOutcome } from './courseOutcomeInbox';
import {
  consumePendingWatchPulse,
  shouldPulseWatch,
  watchPulseFingerprint,
  watchPulseKind,
} from './courseWatchSignals';

function watchOutcomeNodeId(row: MyCourseWatchRow): string | null {
  const nodeId = row.course?.nodeId?.trim();
  if (nodeId) return nodeId;
  return watchPulseFingerprint(row);
}

/** Mirror SocietyTownCourseDesk watch milestones for community/profile surfaces. */
export function syncWatchMilestoneOutcomes(
  watches: readonly MyCourseWatchRow[],
): void {
  for (const row of watches) {
    if (!shouldPulseWatch(row)) continue;
    const pulseKind = watchPulseKind(row);
    if (pulseKind !== 'settled') continue;
    const nodeId = watchOutcomeNodeId(row);
    if (!nodeId) continue;
    pushCourseOutcome({
      gameId: row.gameId,
      nodeId,
      kind: 'watch_settled',
      prompt: row.course?.prompt,
      canon: row.course?.canon ?? null,
      at: Date.now(),
    });
  }
}

/** Sync settled inbox first, then clear pending pulse — never reverse. */
export function applyCourseWatchRows(watches: readonly MyCourseWatchRow[]): void {
  syncWatchMilestoneOutcomes(watches);
  consumePendingWatchPulse(watches);
}
