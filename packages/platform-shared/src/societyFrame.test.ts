/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  societyChannel,
  societyLatestFrameKey,
  worldIdFromSocietyChannel,
} from './societyFrame.js';

describe('society frame keys', () => {
  it('round-trips a world id from the live channel', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(worldIdFromSocietyChannel(societyChannel(id))).toBe(id);
    expect(societyLatestFrameKey(id)).toBe(`society:latest:${id}`);
  });

  it('does not treat the tip-frame key as a live channel', () => {
    expect(
      worldIdFromSocietyChannel('society:latest:11111111-1111-4111-8111-111111111111'),
    ).toBeNull();
  });
});
