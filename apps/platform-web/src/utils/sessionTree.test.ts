/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { orderSessionsAsTree } from './sessionTree';

describe('orderSessionsAsTree', () => {
  it('nests forks under their parent and keeps orphan parentIds as roots', () => {
    const rows = orderSessionsAsTree([
      { id: 'child', title: 'Fork · A', updatedAt: '2', messageCount: 1, parentId: 'root' },
      { id: 'root', title: 'A', updatedAt: '1', messageCount: 3, parentId: null },
      { id: 'orphan', title: 'Lost', updatedAt: '3', messageCount: 0, parentId: 'missing' },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['root', 'child', 'orphan']);
    expect(rows[1]).toMatchObject({
      id: 'child',
      depth: 1,
      parentTitle: 'A',
    });
    expect(rows[2]?.depth).toBe(0);
  });
});
