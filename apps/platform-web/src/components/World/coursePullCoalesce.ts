/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Helpers for course board pull coalescing.
 */

/** Prefer a loud (non-silent) pull when merging concurrent requests. */
export function coalescePendingSilent(
  pending: boolean | null,
  nextSilent: boolean,
): boolean {
  return pending === false || nextSilent === false ? false : true;
}

export const STAGE_EMBEDDED_COURSE_POLL_MS = 4_000;
export const PAGE_IDLE_COURSE_POLL_MS = 12_000;

/**
 * Page desk owns the live `/course` interval. Stage only polls when it is the
 * embed host, or when the page desk is idle (mobile sheet closed — HUD still
 * needs a slow refresh).
 */
export function stageOwnsCoursePoll(input: {
  readonly courseHost: 'stage' | 'page';
  readonly courseDeskActive: boolean;
}): boolean {
  if (input.courseHost !== 'page') return true;
  return !input.courseDeskActive;
}
