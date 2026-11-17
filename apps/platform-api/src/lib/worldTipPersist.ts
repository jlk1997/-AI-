/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Optimistic tip writes: concurrent restore / patch / persist cannot both
 * advance the same revision. The loser sees 0 rows and must not enqueue.
 */

import { and, eq } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import { worldRevisions, worlds } from '@opengame/platform-db';

export function nextWorldTipVersion(currentTip: number, specVersion = 0): number {
  return Math.max(currentTip + 1, specVersion);
}

export function isWorldTipConflict(error: unknown): boolean {
  return error instanceof Error && error.message === 'world_tip_conflict';
}

export async function persistWorldTipRevision(
  db: DrizzleDb,
  params: {
    readonly worldId: string;
    readonly expectedTip: number;
    readonly nextVersion: number;
    readonly specJson: unknown;
    readonly title: string;
    readonly opJson: unknown;
    readonly summary: string;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [moved] = await tx
      .update(worlds)
      .set({
        tipRevision: params.nextVersion,
        specJson: params.specJson,
        title: params.title,
        updatedAt: new Date(),
      })
      .where(and(eq(worlds.id, params.worldId), eq(worlds.tipRevision, params.expectedTip)))
      .returning({ id: worlds.id });
    if (!moved) return false;
    await tx.insert(worldRevisions).values({
      worldId: params.worldId,
      revision: params.nextVersion,
      parentRevision: params.expectedTip,
      opJson: params.opJson,
      specJson: params.specJson,
      summary: params.summary,
    });
    return true;
  });
}
