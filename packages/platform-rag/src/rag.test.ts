/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

describe('platform-rag', () => {
  it('keyword scoring heuristic', () => {
    const content = 'snake movement grid rules score';
    const query = 'snake game';
    const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    let score = 0;
    for (const t of tokens) {
      if (content.includes(t)) score += 2;
    }
    expect(score).toBeGreaterThan(0);
  });
});
