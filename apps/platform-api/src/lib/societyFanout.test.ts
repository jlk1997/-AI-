/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  emitCachedSocietyFrame,
  readLatestSocietyFrame,
  societyFanoutWorldCount,
} from './societyFanout.js';

describe('societyFanout', () => {
  it('starts with no shared subscriptions', () => {
    expect(societyFanoutWorldCount()).toBe(0);
  });

  it('reads the cached tip frame', async () => {
    const store = new Map<string, string>([
      ['society:latest:w1', '{"simTime":12}'],
    ]);
    await expect(
      readLatestSocietyFrame(
        { get: async (key) => store.get(key) ?? null },
        'w1',
      ),
    ).resolves.toBe('{"simTime":12}');
  });

  it('does not replay a stale tip after a live frame', async () => {
    const written: string[] = [];
    await emitCachedSocietyFrame({
      redis: { get: async () => '{"simTime":3}' },
      worldId: 'w1',
      receivedLive: () => true,
      writeFrame: (message) => written.push(message),
    });
    expect(written).toEqual([]);
  });

  it('emits the tip when the channel is still quiet', async () => {
    const written: string[] = [];
    await emitCachedSocietyFrame({
      redis: { get: async () => '{"simTime":9}' },
      worldId: 'w1',
      receivedLive: () => false,
      writeFrame: (message) => written.push(message),
    });
    expect(written).toEqual(['{"simTime":9}']);
  });
});
