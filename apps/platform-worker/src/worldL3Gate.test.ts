/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyTownWorld } from '@opengame/world-spec';

import { assertWorldL3Playable } from './worldL3Gate.js';

describe('assertWorldL3Playable', () => {
  const prev = process.env['WORLD_QUALITY_GATE'];

  afterEach(() => {
    if (prev === undefined) delete process.env['WORLD_QUALITY_GATE'];
    else process.env['WORLD_QUALITY_GATE'] = prev;
  });

  it('returns issues without throwing when gate env is soft/false', () => {
    process.env['WORLD_QUALITY_GATE'] = 'false';
    const world = createEmptyTownWorld({ title: 'L3Soft' });
    world.presentation.cinematicEnabled = true;
    world.presentation.spatialBackend = 'lingbot';
    world.presentation.lingbotMode = 'mock';
    world.presentation.spatialAssets = {
      [world.space.startRegionId]: {
        backend: 'lingbot',
        assetUrl: 'data:application/json,%7B%7D',
      },
    };
    const gate = assertWorldL3Playable(world);
    expect(gate.issues.some((i) => i.includes('可播') || i.includes('L3'))).toBe(
      true,
    );
  });

  it('throws when WORLD_QUALITY_GATE=true and L3 media unplayable', () => {
    process.env['WORLD_QUALITY_GATE'] = 'true';
    const world = createEmptyTownWorld({ title: 'L3Hard' });
    world.presentation.cinematicEnabled = true;
    world.presentation.spatialBackend = 'lingbot';
    world.presentation.lingbotMode = 'mock';
    world.presentation.spatialAssets = {
      [world.space.startRegionId]: {
        backend: 'lingbot',
        assetUrl: 'data:application/json,%7B%7D',
      },
    };
    expect(() => assertWorldL3Playable(world)).toThrow(/World L3 gate failed/);
  });

  it('passes playable PNG poster under enforce', () => {
    process.env['WORLD_QUALITY_GATE'] = 'true';
    const world = createEmptyTownWorld({ title: 'L3Ok' });
    world.presentation.cinematicEnabled = true;
    world.presentation.spatialBackend = 'lingbot';
    world.presentation.lingbotMode = 'mock';
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    world.presentation.spatialAssets = Object.fromEntries(
      world.space.regions.map((r) => [
        r.id,
        { backend: 'lingbot', assetUrl: png },
      ]),
    );
    const gate = assertWorldL3Playable(world);
    expect(
      gate.issues.filter((i) => i.includes('可播') || i.includes('L3')),
    ).toHaveLength(0);
  });
});
