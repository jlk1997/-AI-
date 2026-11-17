/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type { DrizzleDb } from '@opengame/platform-db';

import { worldIdsWithLiveCourseStakes } from './courseTalkPriority.js';

function mockCourseStakeDb(rows: ReadonlyArray<{ worldId: string }>): DrizzleDb {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve([...rows]),
        }),
      }),
    }),
  } as unknown as DrizzleDb;
}

describe('worldIdsWithLiveCourseStakes', () => {
  it('returns empty when no worlds are in the sweep', async () => {
    const ids = await worldIdsWithLiveCourseStakes(
      mockCourseStakeDb([]),
      [],
    );
    expect(ids.size).toBe(0);
  });

  it('returns worlds with open or closed boards and live stakes', async () => {
    const ids = await worldIdsWithLiveCourseStakes(
      mockCourseStakeDb([{ worldId: 'w1' }, { worldId: 'w2' }]),
      ['w1', 'w2', 'w3'],
    );
    expect([...ids].sort()).toEqual(['w1', 'w2']);
  });
});
