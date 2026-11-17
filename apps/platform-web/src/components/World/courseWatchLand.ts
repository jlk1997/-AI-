/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Watch-push landing: mirror settled results, then clear pending pulse.
 */

import { refreshMyCourseTonight } from './myCourseTonightStore';
import { scheduleWatchPulseConsume } from './courseWatchSignals';

/**
 * Remember the landing town, then refresh the shared tonight store so
 * applyCourseWatchRows can sync outcomes and consume the pulse in order.
 */
export async function hydrateCourseWatchLanding(gameId: string): Promise<void> {
  scheduleWatchPulseConsume(gameId);
  try {
    await refreshMyCourseTonight('manual');
  } catch {
    /* guest or network — pulse stays in session until the next tonight refresh */
  }
}
