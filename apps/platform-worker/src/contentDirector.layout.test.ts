/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { writeContentDirectorScaffold } from './storyOutline.js';
import {
  resolveWorldLayoutFromGame,
  resolveWorldLayoutsBySceneId,
} from './worldLayout.js';

describe('resolveWorldLayoutFromGame', () => {
  it('extracts player / npc / item / portal from game.json shape', () => {
    const layout = resolveWorldLayoutFromGame({
      scenes: [
        {
          id: 'Town',
          entities: [
            { id: 'hero', tags: ['player'], sprite: { x: 120, y: 200 } },
            { id: 'Guide', tags: ['npc', 'dialog'], sprite: { x: 300, y: 180 } },
            { id: 'relic', tags: ['item'], sprite: { x: 710, y: 210 } },
            { id: 'gate', tags: ['portal'], sprite: { x: 880, y: 480 } },
          ],
        },
      ],
    });
    expect(layout.player).toEqual({
      x: 120,
      y: 200,
      id: 'hero',
      tags: ['player'],
    });
    expect(layout.npcs[0]?.id).toBe('Guide');
    expect(layout.items[0]?.x).toBe(710);
    expect(layout.portals[0]?.y).toBe(480);
  });

  it('maps every region via resolveWorldLayoutsBySceneId', () => {
    const byId = resolveWorldLayoutsBySceneId({
      initialSceneId: 'Town',
      scenes: [
        {
          id: 'Town',
          entities: [
            { id: 'hero', tags: ['player'], sprite: { x: 100, y: 100 } },
            { id: 'Guide', tags: ['npc'], sprite: { x: 200, y: 160 } },
          ],
        },
        {
          id: 'Forest',
          entities: [
            { id: 'slime', tags: ['enemy'], sprite: { x: 400, y: 300 } },
            {
              id: 'gate_back',
              tags: ['portal'],
              sprite: { x: 50, y: 270 },
              behaviors: [
                {
                  kind: 'sceneTransition',
                  options: { targetSceneId: 'Town' },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(Object.keys(byId)).toEqual(['Town', 'Forest']);
    expect(byId['Town']?.npcs[0]?.id).toBe('Guide');
    expect(byId['Forest']?.enemies[0]?.id).toBe('slime');
    expect(byId['Forest']?.portals[0]?.targetSceneId).toBe('Town');
    expect(resolveWorldLayoutFromGame({
      initialSceneId: 'Town',
      scenes: [
        { id: 'Town', entities: [{ id: 'hero', tags: ['player'], sprite: { x: 1, y: 2 } }] },
        { id: 'Forest', entities: [{ id: 'slime', tags: ['enemy'], sprite: { x: 3, y: 4 } }] },
      ],
    }).player?.x).toBe(1);
  });

  it('extracts enemies / bosses from tags', () => {
    const layout = resolveWorldLayoutFromGame({
      scenes: [
        {
          id: 'Wilds',
          entities: [
            { id: 'hero', tags: ['player'], sprite: { x: 100, y: 100 } },
            { id: 'slime', tags: ['enemy'], sprite: { x: 400, y: 300 } },
            { id: 'king', tags: ['boss', 'enemy'], sprite: { x: 700, y: 280 } },
          ],
        },
      ],
    });
    expect(layout.enemies).toHaveLength(2);
    expect(layout.enemies[1]?.id).toBe('king');
  });

  it('reads portal targetSceneId from sceneTransition behavior', () => {
    const layout = resolveWorldLayoutFromGame({
      scenes: [
        {
          id: 'Town',
          entities: [
            { id: 'hero', tags: ['player'], sprite: { x: 100, y: 100 } },
            {
              id: 'gate_east',
              tags: ['portal', 'exit'],
              sprite: { x: 900, y: 270 },
              behaviors: [
                {
                  kind: 'sceneTransition',
                  options: { targetSceneId: 'ForestScene', range: 34 },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(layout.portals[0]?.targetSceneId).toBe('ForestScene');
    expect(layout.portals[0]?.id).toBe('gate_east');
  });

  it('embeds helper into ContentDirector scaffold', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'og-cd-'));
    await writeContentDirectorScaffold(dir);
    const src = await fsp.readFile(
      path.join(dir, 'src', 'content', 'ContentDirector.ts'),
      'utf8',
    );
    expect(src).toContain('resolveWorldLayoutFromGame');
    expect(src).toContain('resolveWorldLayoutsBySceneId');
    expect(src).toContain('giverNpcId');
  });
});
