/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { normalizeWorldBrief } from './worldBrief.js';

describe('normalizeWorldBrief', () => {
  it('maps venue ids to planner place labels and keeps pack', () => {
    const brief = normalizeWorldBrief({
      packId: 'society.crew',
      useCase: 'workplace',
      venues: ['bridge', 'greenhouse'],
      scale: 'compact',
      livedIn: 'full_day',
    });
    expect(brief.packId).toBe('society.crew');
    expect(brief.places).toEqual(['舰桥', '温室舱']);
  });

  it('ignores unknown packs', () => {
    const brief = normalizeWorldBrief({
      packId: 'society.dungeon',
      venues: ['night_market'],
    });
    expect(brief.packId).toBeUndefined();
    expect(brief.places).toEqual(['夜市']);
  });

  it('maps coop to 鸡舍', () => {
    const brief = normalizeWorldBrief({
      packId: 'society.town',
      venues: ['coop', 'night_market'],
    });
    expect(brief.places).toEqual(['鸡舍', '夜市']);
  });
});
