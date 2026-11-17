/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  drainTalkPersistRetry,
  enqueueTalkPersistRetry,
  talkRetryKey,
} from './talkPersistRetry.js';

describe('talkPersistRetry', () => {
  it('parks events and drains them once', async () => {
    const lists = new Map<string, string[]>();
    const redis = {
      rpush: async (key: string, value: string) => {
        lists.set(key, [...(lists.get(key) ?? []), value]);
        return 1;
      },
      expire: async () => 1,
      lrange: async (key: string) => lists.get(key) ?? [],
      del: async (key: string) => {
        lists.delete(key);
        return 1;
      },
    };
    expect(
      await enqueueTalkPersistRetry(redis, 'w1', [{ type: 'talk', text: 'hi' }]),
    ).toBe(true);
    expect(lists.has(talkRetryKey('w1'))).toBe(true);
    const drained = await drainTalkPersistRetry(redis, 'w1');
    expect(drained).toEqual([{ type: 'talk', text: 'hi' }]);
    expect(await drainTalkPersistRetry(redis, 'w1')).toEqual([]);
  });

  it('fails closed when Redis cannot park the line', async () => {
    const redis = {
      rpush: async () => {
        throw new Error('down');
      },
      expire: async () => 1,
      lrange: async () => [],
      del: async () => 1,
    };
    expect(await enqueueTalkPersistRetry(redis, 'w1', [{ type: 'talk' }])).toBe(
      false,
    );
  });
});
