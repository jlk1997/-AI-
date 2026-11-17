/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stake/withdraw API returns current+history only — keep watching/queued.
 */

import type { CourseBoard, CourseView } from '../../services/api';

export function mergeCourseBoardKeepExtras(
  prev: CourseBoard | null,
  patch: {
    readonly current: CourseView | null;
    readonly history: readonly CourseView[];
    readonly watching?: boolean;
    readonly queued?: CourseView | null;
    readonly skipReason?: CourseBoard['skipReason'];
  },
): CourseBoard {
  return {
    current: patch.current,
    history: [...patch.history],
    watching: patch.watching ?? prev?.watching,
    queued: patch.queued !== undefined ? patch.queued : (prev?.queued ?? null),
    skipReason: patch.skipReason ?? prev?.skipReason,
  };
}

/** Apply a full GET /course payload without dropping client-side extras. */
export function mergeCourseBoardPoll(
  prev: CourseBoard | null,
  next: CourseBoard,
): CourseBoard {
  return mergeCourseBoardKeepExtras(prev, {
    current: next.current,
    history: next.history,
    watching: next.watching,
    queued: next.queued,
    skipReason: next.skipReason,
  });
}
