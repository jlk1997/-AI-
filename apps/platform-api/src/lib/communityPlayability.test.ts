/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { isPubliclyPlayable } from './communityPlayability.js';

describe('isPubliclyPlayable', () => {
  it('stops play-url after a takedown even if isPublic was left true', () => {
    expect(
      isPubliclyPlayable({
        isPublic: true,
        takenDownAt: new Date('2026-08-21T00:00:00Z'),
      }),
    ).toBe(false);
  });

  it('allows a living public work', () => {
    expect(isPubliclyPlayable({ isPublic: true, takenDownAt: null })).toBe(true);
  });

  it('hides a private draft', () => {
    expect(isPubliclyPlayable({ isPublic: false, takenDownAt: null })).toBe(
      false,
    );
  });

  it('treats a missing row as not playable', () => {
    expect(isPubliclyPlayable(undefined)).toBe(false);
    expect(isPubliclyPlayable(null)).toBe(false);
  });
});
