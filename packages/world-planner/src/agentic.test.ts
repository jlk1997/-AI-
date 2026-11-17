/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createEmptyTownWorld } from '@opengame/world-spec';
import { runAgenticHarness } from './agentic.js';

describe('agentic harness', () => {
  it('pilot+director apply heuristic ops', async () => {
    process.env['WORLD_PLANNER_HEURISTIC'] = 'true';
    const world = createEmptyTownWorld({ title: 'Test' });
    const result = await runAgenticHarness({
      world,
      intent: 'expand forest and talk to smith',
    });
    expect(result.proposals).toHaveLength(2);
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.world.meta.version).toBeGreaterThanOrEqual(world.meta.version);
  });
});
