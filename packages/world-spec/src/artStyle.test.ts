/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  ART_STYLES,
  DEFAULT_ART_STYLE_ID,
  artStyleProfile,
  artStyleIds,
  isArtStyleId,
  resolveArtStyle,
} from './artStyle.js';
import { createSocietyTownWorld, parseWorldSpec } from './schema.js';

describe('art style registry', () => {
  it('defaults to high fidelity, not pixel art', () => {
    const spec = parseWorldSpec({
      meta: { id: 'w1', title: 'T', version: 1 },
      space: { regions: [{ id: 'r1', name: 'R' }], startRegionId: 'r1' },
    });
    expect(spec.styleAnchor.artStyle).not.toMatch(/pixel/i);
    expect(spec.styleAnchor.artStyle).toBe(
      artStyleProfile(DEFAULT_ART_STYLE_ID).artStyle,
    );
    expect(artStyleProfile(DEFAULT_ART_STYLE_ID).pixelPerfect).toBe(false);
  });

  it('only marks the pixel profile as pixel perfect, and gives it small frames', () => {
    const pixel = artStyleProfile('fine_pixel');
    expect(pixel.pixelPerfect).toBe(true);
    for (const profile of ART_STYLES) {
      if (profile.id === 'fine_pixel') continue;
      expect(profile.pixelPerfect).toBe(false);
      // Painterly art must keep far more of the 1K render than a sprite sheet.
      expect(profile.frameWidth).toBeGreaterThan(pixel.frameWidth);
      expect(profile.tileSize).toBeGreaterThan(pixel.tileSize);
    }
  });

  it('keeps legacy free-text styles on a matching profile', () => {
    // Worlds generated before the picker stored bare strings; reopening one
    // must not silently restyle it.
    expect(resolveArtStyle({ text: 'pixel' }).id).toBe('fine_pixel');
    expect(resolveArtStyle({ text: 'pixel dungeon' }).id).toBe('fine_pixel');
    expect(resolveArtStyle({ text: 'warm_pixel' }).id).toBe('fine_pixel');
    expect(resolveArtStyle({ text: '水墨江湖' }).id).toBe('ink_wash');
    expect(resolveArtStyle({ text: 'neon cyberpunk alley' }).id).toBe(
      'neon_noir',
    );
    // An explicit id always wins over sniffed text.
    expect(resolveArtStyle({ id: 'ink_wash', text: 'pixel' }).id).toBe(
      'ink_wash',
    );
    expect(resolveArtStyle({ text: 'something nobody mapped' }).id).toBe(
      DEFAULT_ART_STYLE_ID,
    );
    expect(resolveArtStyle().id).toBe(DEFAULT_ART_STYLE_ID);
  });

  it('validates ids and repaints the scaffold palette when a style is picked', () => {
    expect(artStyleIds()).toContain(DEFAULT_ART_STYLE_ID);
    expect(isArtStyleId('fine_pixel')).toBe(true);
    expect(isArtStyleId('not_a_style')).toBe(false);

    const untouched = createSocietyTownWorld({ id: 'w_default' });
    expect(untouched.styleAnchor.palette).toEqual([
      '#2d6a4f',
      '#d8f3dc',
      '#f4a261',
    ]);

    const neon = createSocietyTownWorld({
      id: 'w_neon',
      artStyleId: 'neon_noir',
    });
    expect(neon.styleAnchor.artStyleId).toBe('neon_noir');
    expect(neon.styleAnchor.palette).toEqual(
      artStyleProfile('neon_noir').palette,
    );
  });
});

describe('presentation fidelity defaults', () => {
  it('separates the on-screen tile size from the texture frame size', () => {
    // These used to be one number, capping tileset.png detail at the display
    // size, so a 1K tile render was thrown away.
    const spec = parseWorldSpec({
      meta: { id: 'w1', title: 'T', version: 1 },
      space: { regions: [{ id: 'r1', name: 'R' }], startRegionId: 'r1' },
      presentation: { tileSourceSize: 128 },
    });
    expect(spec.presentation.tileSize).toBe(48);
    expect(spec.presentation.tileSourceSize).toBe(128);
  });

  it('keeps speech pacing overrides instead of stripping them on parse', () => {
    // The scaffold reads these from world.json; before they were declared here,
    // parseWorldSpec dropped them and the override silently did nothing.
    const spec = parseWorldSpec({
      meta: { id: 'w1', title: 'T', version: 1 },
      space: { regions: [{ id: 'r1', name: 'R' }], startRegionId: 'r1' },
      presentation: { speechStaggerMs: 420, maxLiveSpeech: 10 },
    });
    expect(spec.presentation.speechStaggerMs).toBe(420);
    expect(spec.presentation.maxLiveSpeech).toBe(10);
  });
});
