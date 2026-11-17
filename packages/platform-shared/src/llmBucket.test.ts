/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  llmBucketKey,
  takeLlmTokens,
  takeWorldLlmTokens,
  worldBelongsToShard,
  worldLlmBucketKey,
} from './llmBucket.js';

function memoryRedis() {
  const store = new Map<string, number>();
  return {
    store,
    async incrby(key: string, increment: number) {
      const next = (store.get(key) ?? 0) + increment;
      store.set(key, next);
      return next;
    },
    async expire() {
      return 1;
    },
  };
}

describe('llm bucket', () => {
  it('keeps appraisal and talk on separate hourly caps', async () => {
    const redis = memoryRedis();
    const now = 1_700_000_000_000;
    const caps = { appraisal: 2, talk: 1, reflect: 1 };
    expect(await takeLlmTokens(redis, 'appraisal', 1, now, caps)).toBe(true);
    expect(await takeLlmTokens(redis, 'appraisal', 1, now, caps)).toBe(true);
    expect(await takeLlmTokens(redis, 'appraisal', 1, now, caps)).toBe(false);
    expect(await takeLlmTokens(redis, 'talk', 1, now, caps)).toBe(true);
    expect(await takeLlmTokens(redis, 'talk', 1, now, caps)).toBe(false);
    expect(redis.store.get(llmBucketKey('appraisal', now))).toBe(2);
  });

  it('caps one world without touching another', async () => {
    const redis = memoryRedis();
    const now = 1_700_000_000_000;
    expect(await takeWorldLlmTokens(redis, 'world-a', 'talk', 1, now, 1)).toBe(true);
    expect(await takeWorldLlmTokens(redis, 'world-a', 'talk', 1, now, 1)).toBe(false);
    expect(await takeWorldLlmTokens(redis, 'world-b', 'talk', 1, now, 1)).toBe(true);
    expect(redis.store.get(worldLlmBucketKey('world-a', 'talk', now))).toBe(1);
  });

  it('leaves the world uncapped when the cap is unset', async () => {
    const redis = memoryRedis();
    expect(await takeWorldLlmTokens(redis, 'world-a', 'talk', 5, 0, 0)).toBe(true);
    expect(redis.store.size).toBe(0);
  });

  it('splits world ids across shards', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const shard0 = ids.filter((id) => worldBelongsToShard(id, 0, 2));
    const shard1 = ids.filter((id) => worldBelongsToShard(id, 1, 2));
    expect(shard0.length + shard1.length).toBe(ids.length);
    expect(shard0.some((id) => shard1.includes(id))).toBe(false);
    expect(worldBelongsToShard('anything', 3, 1)).toBe(true);
  });
});
