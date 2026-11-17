/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Observe-stage camera framing.
 *
 * The town used to render at zoom 1 inside a viewport that is usually larger
 * than a small region, and camera bounds were floored at 800x600 — when the
 * bounds are smaller than the viewport Phaser clamps the scroll to the bounds
 * origin, so the map ended up pinned in the top-left corner with dead space
 * around it. This module owns the maths for "fill the viewport without making
 * residents unreadable"; the scene only applies the result.
 */

export interface TownFrameInput {
  readonly mapW: number;
  readonly mapH: number;
  readonly viewW: number;
  readonly viewH: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}

export interface TownFrame {
  readonly zoom: number;
  readonly centerX: number;
  readonly centerY: number;
  /**
   * The scaled map overflows the viewport, so the camera must clamp to map
   * bounds. When false the map fits entirely and the camera centers it instead —
   * clamping there is what pushed small towns into the corner.
   */
  readonly bounded: boolean;
}

/** Quantised zoom: resizing must not jitter the scale by fractions of a percent. */
const ZOOM_STEP = 0.05;
/** Below this a resident is a few pixels tall and the stage stops being readable. */
export const MIN_TOWN_ZOOM = 0.75;
/** Above this the tile art shows its resampling. */
export const MAX_TOWN_ZOOM = 2.2;

function usable(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function fitTownCamera(input: TownFrameInput): TownFrame {
  const minZoom = input.minZoom ?? MIN_TOWN_ZOOM;
  const maxZoom = input.maxZoom ?? MAX_TOWN_ZOOM;
  const mapW = usable(input.mapW);
  const mapH = usable(input.mapH);
  const viewW = usable(input.viewW);
  const viewH = usable(input.viewH);
  if (!mapW || !mapH || !viewW || !viewH) {
    return {
      zoom: 1,
      centerX: mapW / 2,
      centerY: mapH / 2,
      bounded: false,
    };
  }
  const raw = Math.min(viewW / mapW, viewH / mapH);
  // Floor to a zoom step so the fit never crops the outer tile row.
  const stepped = Math.floor(raw / ZOOM_STEP) * ZOOM_STEP;
  const zoom = Math.round(
    Math.min(maxZoom, Math.max(minZoom, stepped)) * 100,
  ) / 100;
  return {
    zoom,
    centerX: mapW / 2,
    centerY: mapH / 2,
    // Half a pixel of slack: an exact fit should center, not clamp.
    bounded: mapW * zoom > viewW + 0.5 || mapH * zoom > viewH + 0.5,
  };
}
