/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  acquireRedisLock,
  LockBusyError,
  societyWorldLockKey,
  withRedisLock,
  type RedisLikeForLock,
} from './redisLock.js';

/** Minimal SET NX PX / EVAL stub with real expiry semantics. */
class FakeRedis implements RedisLikeForLock {
  private store = new Map<string, { value: string; expiresAt: number }>();

  private live(key: string): { value: string; expiresAt: number } | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async set(
    key: string,
    value: string,
    _mode: 'PX',
    ttlMs: number,
    _condition: 'NX',
  ): Promise<'OK' | null> {
    if (this.live(key)) return null;
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return 'OK';
  }

  async eval(
    script: string,
    _numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    const [key, token, ttl] = args as [string, string, string | undefined];
    const entry = this.live(key);
    if (!entry || entry.value !== token) return 0;
    if (script.includes('pexpire')) {
      entry.expiresAt = Date.now() + Number(ttl ?? 0);
      return 1;
    }
    this.store.delete(key);
    return 1;
  }

  get size(): number {
    return this.store.size;
  }
}

describe('redisLock', () => {
  it('lets only one holder into the critical section', async () => {
    const redis = new FakeRedis();
    const key = societyWorldLockKey('w1');
    const first = await acquireRedisLock(redis, key, { ttlMs: 5_000 });
    expect(first).not.toBeNull();
    // A second process must not get in while the first holds the lease.
    expect(await acquireRedisLock(redis, key, { ttlMs: 5_000 })).toBeNull();
    await first!.release();
    const second = await acquireRedisLock(redis, key, { ttlMs: 5_000 });
    expect(second).not.toBeNull();
    await second!.release();
    expect(redis.size).toBe(0);
  });

  it('waits for the holder to finish instead of failing instantly', async () => {
    const redis = new FakeRedis();
    const key = societyWorldLockKey('w2');
    const held = await acquireRedisLock(redis, key, { ttlMs: 5_000 });
    setTimeout(() => void held!.release(), 60);
    const waited = await acquireRedisLock(redis, key, {
      ttlMs: 5_000,
      waitMs: 1_000,
      retryDelayMs: 25,
    });
    expect(waited).not.toBeNull();
    await waited!.release();
  });

  it('throws LockBusyError when the wait budget runs out', async () => {
    const redis = new FakeRedis();
    const key = societyWorldLockKey('w3');
    const held = await acquireRedisLock(redis, key, { ttlMs: 5_000 });
    await expect(
      withRedisLock(redis, key, async () => 'never', {
        waitMs: 40,
        retryDelayMs: 10,
      }),
    ).rejects.toBeInstanceOf(LockBusyError);
    await held!.release();
  });

  it('releases the lock even when the critical section throws', async () => {
    const redis = new FakeRedis();
    const key = societyWorldLockKey('w4');
    await expect(
      withRedisLock(redis, key, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Lock must be free again, otherwise one crash wedges the world forever.
    const after = await acquireRedisLock(redis, key, { ttlMs: 1_000 });
    expect(after).not.toBeNull();
    await after!.release();
  });

  it('an expired lease does not let the old holder delete the new one', async () => {
    const redis = new FakeRedis();
    const key = societyWorldLockKey('w5');
    const stale = await acquireRedisLock(redis, key, {
      ttlMs: 1_000,
      autoRenew: false,
    });
    await new Promise((r) => setTimeout(r, 1_050));
    const fresh = await acquireRedisLock(redis, key, { ttlMs: 5_000 });
    expect(fresh).not.toBeNull();
    // The stale holder's release must be a no-op, not a steal.
    await stale!.release();
    expect(await acquireRedisLock(redis, key, { ttlMs: 1_000 })).toBeNull();
    await fresh!.release();
  });

  it('renews its own lease but cannot renew someone else’s', async () => {
    const redis = new FakeRedis();
    const key = societyWorldLockKey('w6');
    const lock = await acquireRedisLock(redis, key, {
      ttlMs: 1_000,
      autoRenew: false,
    });
    expect(await lock!.renew(5_000)).toBe(true);
    await new Promise((r) => setTimeout(r, 1_050));
    // Still held thanks to the renewal.
    expect(await acquireRedisLock(redis, key, { ttlMs: 500 })).toBeNull();
    await lock!.release();
    expect(await lock!.renew(1_000)).toBe(false);
  });
});
