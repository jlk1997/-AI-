/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { listExpectedNarrativeAssetSlots } from './gameAssetPhase.js';

describe('listExpectedNarrativeAssetSlots', () => {
  const prev = {
    npcs: process.env['PLATFORM_ASSET_MAX_NPCS'],
    ch: process.env['PLATFORM_ASSET_MAX_CHAPTER_BGS'],
    reg: process.env['PLATFORM_ASSET_MAX_REGION_BGS'],
  };

  afterEach(() => {
    for (const [k, v] of Object.entries({
      PLATFORM_ASSET_MAX_NPCS: prev.npcs,
      PLATFORM_ASSET_MAX_CHAPTER_BGS: prev.ch,
      PLATFORM_ASSET_MAX_REGION_BGS: prev.reg,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('caps NPC portraits and chapter backgrounds (default 6 / 2)', async () => {
    delete process.env['PLATFORM_ASSET_MAX_NPCS'];
    delete process.env['PLATFORM_ASSET_MAX_CHAPTER_BGS'];
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-slots-'));
    await fsp.mkdir(path.join(dir, 'public'), { recursive: true });
    await fsp.writeFile(
      path.join(dir, 'public', 'STORY_BIBLE.json'),
      JSON.stringify({
        title: 'Cast Town',
        npcs: [
          { id: 'Guide' },
          { id: 'Smith' },
          { id: 'Traveler' },
          { id: 'Mayor' },
          { id: 'Child' },
          { id: 'Guard' },
          { id: 'Extra' },
        ],
        chapters: [
          { id: 'c1', title: 'Arrive' },
          { id: 'c2', title: 'Market' },
          { id: 'c3', title: 'Temple' },
          { id: 'c4', title: 'Peak' },
        ],
        quests: [],
      }),
      'utf8',
    );
    const slots = listExpectedNarrativeAssetSlots(dir);
    expect(slots.filter((s) => s.startsWith('npc_'))).toHaveLength(6);
    expect(slots).toContain('npc_guide');
    expect(slots).toContain('bg_chapter_02');
    expect(slots).toContain('bg_chapter_03');
    expect(slots).not.toContain('bg_chapter_04');
    expect(slots).not.toContain('npc_extra');
  });

  it('honours PLATFORM_ASSET_MAX_* overrides', async () => {
    process.env['PLATFORM_ASSET_MAX_NPCS'] = '6';
    process.env['PLATFORM_ASSET_MAX_CHAPTER_BGS'] = '4';
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-slots-hi-'));
    await fsp.mkdir(path.join(dir, 'public'), { recursive: true });
    await fsp.writeFile(
      path.join(dir, 'public', 'STORY_BIBLE.json'),
      JSON.stringify({
        npcs: Array.from({ length: 8 }, (_, i) => ({ id: `N${i}` })),
        chapters: [
          { id: 'c1' },
          { id: 'c2' },
          { id: 'c3' },
          { id: 'c4' },
          { id: 'c5' },
        ],
      }),
      'utf8',
    );
    const slots = listExpectedNarrativeAssetSlots(dir);
    expect(slots.filter((s) => s.startsWith('npc_'))).toHaveLength(6);
    expect(slots.filter((s) => s.startsWith('bg_chapter_'))).toHaveLength(4);
  });

  it('plans bg_region_* from layoutOnly / non-shell scenes', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-reg-'));
    await fsp.mkdir(path.join(dir, 'public'), { recursive: true });
    await fsp.writeFile(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        scenes: [
          { id: 'TitleScene', customModule: 'TitleScene', entities: [] },
          { id: 'TownSquare', layoutOnly: true, entities: [] },
          { id: 'DarkForest', layoutOnly: true, entities: [] },
          { id: 'GameOverScene', customModule: 'GameOverScene', entities: [] },
        ],
      }),
      'utf8',
    );
    const slots = listExpectedNarrativeAssetSlots(dir);
    expect(slots).toContain('bg_region_townsquare');
    expect(slots).toContain('bg_region_darkforest');
    expect(slots).not.toContain('bg_region_titlescene');
  });
});
