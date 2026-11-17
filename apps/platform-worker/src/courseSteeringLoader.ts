/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Load active course steering from the API course board module (dist or src).
 */

import type { DrizzleDb } from '@opengame/platform-db';
import type { CourseSteeringHint } from '@opengame/platform-shared';

import { courseBoardModuleHrefs } from './courseSettleLoop.js';

type LoadCourseSteeringHint = (
  db: DrizzleDb,
  worldId: string,
  now?: Date,
) => Promise<CourseSteeringHint | null>;

let cached: LoadCourseSteeringHint | null | undefined;

async function resolveLoader(): Promise<LoadCourseSteeringHint | null> {
  if (cached !== undefined) return cached;
  for (const href of courseBoardModuleHrefs()) {
    try {
      const mod = (await import(href)) as {
        loadCourseSteeringHint?: LoadCourseSteeringHint;
      };
      if (typeof mod.loadCourseSteeringHint === 'function') {
        cached = mod.loadCourseSteeringHint;
        return cached;
      }
    } catch {
      // try next href
    }
  }
  cached = null;
  return null;
}

export async function loadCourseSteeringHintForWorker(
  db: DrizzleDb,
  worldId: string,
  now = new Date(),
): Promise<CourseSteeringHint | null> {
  const load = await resolveLoader();
  return load ? await load(db, worldId, now) : null;
}

/** Test hook: reset dynamic import cache between cases. */
export function resetCourseSteeringLoaderCache(): void {
  cached = undefined;
}
