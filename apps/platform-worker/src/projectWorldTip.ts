/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Load the project's World Spec for game↔world coupling on generate jobs.
 * The style tip feeds prompts; the full Spec feeds the deterministic
 * world→game compiler (`worldGameSeedPhase`).
 */

import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '@opengame/platform-db';
import { worlds } from '@opengame/platform-db';
import { parseWorldSpec, type WorldSpec } from '@opengame/world-spec';

import type { WorldStyleTip } from './generationPipeline.js';

export interface ProjectWorld {
  readonly world: WorldSpec;
  readonly tip: WorldStyleTip;
}

export function worldStyleTipOf(world: WorldSpec): WorldStyleTip {
  return {
    artStyle: world.styleAnchor?.artStyle,
    mood: world.styleAnchor?.mood,
    palette: world.styleAnchor?.palette,
    narrativeSeed: world.presentation.narrativeSeed ?? world.meta.id,
    title: world.meta.title,
  };
}

export async function loadProjectWorld(
  db: DrizzleDb,
  projectId: string,
): Promise<ProjectWorld | null> {
  try {
    const [row] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.projectId, projectId))
      .limit(1);
    if (!row?.specJson) return null;
    const world = parseWorldSpec(row.specJson);
    return { world, tip: worldStyleTipOf(world) };
  } catch {
    return null;
  }
}

export async function loadProjectWorldStyleTip(
  db: DrizzleDb,
  projectId: string,
): Promise<WorldStyleTip | null> {
  const loaded = await loadProjectWorld(db, projectId);
  return loaded?.tip ?? null;
}
