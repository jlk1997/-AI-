/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Worlds with an open or closed board and live stakes get talk slots first.
 * Mute voids the board; do not starve evidence for a watched stake.
 */

import { and, eq, gt, inArray } from 'drizzle-orm';
import {
  worldCourseNodes,
  worldCourseStakes,
  type DrizzleDb,
} from '@opengame/platform-db';

export async function worldIdsWithLiveCourseStakes(
  db: DrizzleDb,
  worldIds: readonly string[],
): Promise<Set<string>> {
  if (worldIds.length === 0) return new Set();
  const rows = await db
    .select({ worldId: worldCourseNodes.worldId })
    .from(worldCourseNodes)
    .innerJoin(worldCourseStakes, eq(worldCourseStakes.nodeId, worldCourseNodes.id))
    .where(
      and(
        inArray(worldCourseNodes.worldId, [...worldIds]),
        inArray(worldCourseNodes.status, ['open', 'closed']),
        gt(worldCourseStakes.points, 0),
      ),
    );
  return new Set(rows.map((row) => row.worldId));
}
