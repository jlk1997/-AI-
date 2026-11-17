/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('OpenGame-Bench golden prompts', () => {
  it('keeps the product 8 plus society 5', () => {
    const bag = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          '../../../../docs/bench/golden-prompts.json',
        ),
        'utf8',
      ),
    ) as { prompts: Array<{ id: string; kind: string }> };
    const games = bag.prompts.filter((p) => p.kind === 'game' || p.kind === 'iterate');
    const worlds = bag.prompts.filter((p) => p.kind === 'world');
    expect(games).toHaveLength(8);
    expect(worlds).toHaveLength(5);
  });
});
