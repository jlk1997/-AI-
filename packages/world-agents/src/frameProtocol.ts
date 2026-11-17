/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live frame contract. Version 2 is an incremental pose plus a periodic keyframe.
 */

export const SOCIETY_FRAME_VERSION = 2;
export const FRAME_KEYFRAME_EVERY = 12;
export const FRAME_MAX_BYTES = 96_000;

export function shouldKeyframe(seq: number, every = FRAME_KEYFRAME_EVERY): boolean {
  if (seq <= 1) return true;
  return seq % every === 0;
}

/** Drop bulky fields until the JSON fits. The caller rebuilds the string. */
export function trimFrameForBudget<T extends Record<string, unknown>>(
  frame: T,
  maxBytes = FRAME_MAX_BYTES,
): T {
  let body = JSON.stringify(frame);
  if (body.length <= maxBytes) return frame;
  const next: Record<string, unknown> = { ...frame, trimmed: true };
  if (Array.isArray(next['agents'])) {
    next['agents'] = (next['agents'] as Array<Record<string, unknown>>).map((agent) => {
      const { needs: _needs, ...rest } = agent;
      return rest;
    });
  }
  body = JSON.stringify(next);
  if (body.length <= maxBytes && Array.isArray(next['relations'])) {
    return next as T;
  }
  if (Array.isArray(next['relations'])) {
    next['relations'] = (next['relations'] as unknown[]).slice(0, 16);
  }
  if (Array.isArray(next['crowd'])) {
    next['crowd'] = (next['crowd'] as unknown[]).slice(0, 40);
  }
  if (JSON.stringify(next).length > maxBytes && Array.isArray(next['agents'])) {
    next['agents'] = (next['agents'] as unknown[]).slice(0, 8);
  }
  return next as T;
}
