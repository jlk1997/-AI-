/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createEmptyTownWorld } from '@opengame/world-spec';
import { probeWorldPlayability } from './playabilityProbe.js';

describe('probeWorldPlayability', () => {
  it('starts or completes quests on thickened town under boost', () => {
    const world = createEmptyTownWorld({ title: 'ProbeTown' });
    const probe = probeWorldPlayability(world);
    expect(probe.issues.filter((i) => i.includes('missing itemId'))).toHaveLength(
      0,
    );
    // Town has start_quest on talk flag + ore delivery — boost should progress
    expect(
      probe.startedQuestIds.length + probe.completedQuestIds.length,
    ).toBeGreaterThan(0);
  });
});
