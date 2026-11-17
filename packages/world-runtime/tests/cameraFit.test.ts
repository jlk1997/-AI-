/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_TOWN_ZOOM,
  MIN_TOWN_ZOOM,
  fitTownCamera,
} from '../scaffold/src/ui/cameraFit';

describe('fitTownCamera', () => {
  it('zooms a small region up so it fills the pane', () => {
    // 16x12 tiles at 48px inside a 1000x800 pane.
    const frame = fitTownCamera({
      mapW: 768,
      mapH: 576,
      viewW: 1000,
      viewH: 800,
    });
    expect(frame.zoom).toBeGreaterThan(1);
    expect(frame.zoom * 768).toBeLessThanOrEqual(1000);
    expect(frame.zoom * 576).toBeLessThanOrEqual(800);
    expect(frame.centerX).toBe(384);
    expect(frame.centerY).toBe(288);
  });

  it('keeps residents readable instead of fitting a huge region entirely', () => {
    const frame = fitTownCamera({
      mapW: 1536,
      mapH: 1152,
      viewW: 800,
      viewH: 745,
    });
    expect(frame.zoom).toBe(MIN_TOWN_ZOOM);
    // Larger than the pane once clamped, so the camera has to clamp to bounds.
    expect(frame.bounded).toBe(true);
  });

  it('centers rather than clamps when the map fits', () => {
    const frame = fitTownCamera({
      mapW: 400,
      mapH: 300,
      viewW: 1200,
      viewH: 700,
    });
    expect(frame.bounded).toBe(false);
    expect(frame.zoom).toBeLessThanOrEqual(MAX_TOWN_ZOOM);
  });

  it('never exceeds the readable zoom band', () => {
    const tiny = fitTownCamera({ mapW: 96, mapH: 96, viewW: 1600, viewH: 900 });
    expect(tiny.zoom).toBe(MAX_TOWN_ZOOM);
  });

  it('falls back to 1:1 before the stage knows its size', () => {
    const frame = fitTownCamera({ mapW: 0, mapH: 0, viewW: 0, viewH: 0 });
    expect(frame.zoom).toBe(1);
    expect(frame.bounded).toBe(false);
  });

  it('quantises zoom so a resize does not jitter the scale', () => {
    const frame = fitTownCamera({
      mapW: 733,
      mapH: 517,
      viewW: 1000,
      viewH: 800,
    });
    expect(Math.round(frame.zoom * 100) % 5).toBe(0);
  });
});
