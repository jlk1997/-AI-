/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global hourly token buckets for model calls.
 * Appraisal keeps its own lane so talk and reflection cannot spend it.
 */

export type LlmLane = 'appraisal' | 'talk' | 'reflect';

export type LlmBucketCaps = {
  readonly appraisal: number;
  readonly talk: number;
  readonly reflect: number;
};

export const LLM_BUCKET_CAPS: LlmBucketCaps = {
  appraisal: 40,
  talk: 180,
  reflect: 20,
};

export type LlmBucketRedis = {
  incrby(key: string, increment: number): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
};

const HOUR_MS = 60 * 60 * 1000;

export function llmBucketKey(lane: LlmLane, now = Date.now()): string {
  const hour = Math.floor(now / HOUR_MS);
  return `og:llm:${lane}:${hour}`;
}

export function worldLlmBucketKey(
  worldId: string,
  lane: LlmLane,
  now = Date.now(),
): string {
  const hour = Math.floor(now / HOUR_MS);
  return `og:llm:${worldId}:${lane}:${hour}`;
}

/**
 * Count `n` calls against the lane. Over cap, the increment is undone.
 * Missing Redis fails open so a local walk is not stuck.
 */
export async function takeLlmTokens(
  redis: LlmBucketRedis | undefined,
  lane: LlmLane,
  n = 1,
  now = Date.now(),
  caps: LlmBucketCaps = LLM_BUCKET_CAPS,
): Promise<boolean> {
  if (!redis) return true;
  const cost = Math.max(1, Math.floor(n));
  const cap = caps[lane];
  const key = llmBucketKey(lane, now);
  const used = await redis.incrby(key, cost);
  if (used === cost) {
    await redis.expire(key, 60 * 60 * 2).catch(() => undefined);
  }
  if (used <= cap) return true;
  await redis.incrby(key, -cost);
  return false;
}

/**
 * Per-world cap. A cap of 0 or less means this lane is not limited per world,
 * so a deployment that only set the global bucket keeps its old behavior.
 */
export async function takeWorldLlmTokens(
  redis: LlmBucketRedis | undefined,
  worldId: string,
  lane: LlmLane,
  n = 1,
  now = Date.now(),
  cap = 0,
): Promise<boolean> {
  if (!redis || cap <= 0) return true;
  const cost = Math.max(1, Math.floor(n));
  const key = worldLlmBucketKey(worldId, lane, now);
  const used = await redis.incrby(key, cost);
  if (used === cost) {
    await redis.expire(key, 60 * 60 * 2).catch(() => undefined);
  }
  if (used <= cap) return true;
  await redis.incrby(key, -cost);
  return false;
}

/** Stable shard so several workers can split a fleet without overlapping. */
export function worldBelongsToShard(
  worldId: string,
  index: number,
  shards: number,
): boolean {
  if (shards <= 1) return true;
  let hash = 0;
  for (let i = 0; i < worldId.length; i++) {
    hash = (hash * 33 + worldId.charCodeAt(i)) >>> 0;
  }
  const slot = ((index % shards) + shards) % shards;
  return hash % shards === slot;
}
