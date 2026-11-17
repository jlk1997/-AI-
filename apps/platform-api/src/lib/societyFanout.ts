/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One Redis subscription per world, many SSE listeners.
 * Per-connection subscribe would exhaust Redis as the observatory scales.
 */

import { Redis } from 'ioredis';
import { societyLatestFrameKey } from '@opengame/platform-shared';

type FrameListener = (message: string) => void;

export async function readLatestSocietyFrame(
  redis: { get(key: string): Promise<string | null> },
  worldId: string,
): Promise<string | null> {
  try {
    return await redis.get(societyLatestFrameKey(worldId));
  } catch {
    return null;
  }
}

/** Tip frame on SSE open, skipped if a live publish already arrived. */
export async function emitCachedSocietyFrame(options: {
  readonly redis: { get(key: string): Promise<string | null> };
  readonly worldId: string;
  readonly receivedLive: () => boolean;
  readonly writeFrame: (message: string) => void;
}): Promise<void> {
  if (options.receivedLive()) return;
  const latest = await readLatestSocietyFrame(options.redis, options.worldId);
  if (!latest || options.receivedLive()) return;
  options.writeFrame(latest);
}

type WorldFanout = {
  readonly redis: Redis;
  readonly listeners: Set<FrameListener>;
};

const worlds = new Map<string, WorldFanout>();

export function subscribeSocietyFrames(
  redisUrl: string,
  worldId: string,
  listener: FrameListener,
): () => void {
  let entry = worlds.get(worldId);
  if (!entry) {
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const listeners = new Set<FrameListener>();
    const created: WorldFanout = { redis, listeners };
    redis.on('message', (_channel: string, message: string) => {
      for (const fn of listeners) fn(message);
    });
    void redis.subscribe(`society:${worldId}`);
    worlds.set(worldId, created);
    entry = created;
  }
  entry.listeners.add(listener);
  return () => {
    entry?.listeners.delete(listener);
    if (entry && entry.listeners.size === 0) {
      try {
        entry.redis.disconnect();
      } catch {
        /* ignore */
      }
      worlds.delete(worldId);
    }
  };
}

export function societyFanoutWorldCount(): number {
  return worlds.size;
}
