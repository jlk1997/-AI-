/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cross-process mutex for per-world simulation.
 *
 * A per-process `Map<string, Promise>` only serializes callers inside one Node
 * process. The API, the worker heartbeat and rewind/intervene all advance the
 * same world, so two of them could hydrate the same simTime, step, and persist —
 * duplicating events and corrupting agent state. This lock is held in Redis so
 * exactly one process advances a given world at a time.
 */

/** The subset of ioredis we need, so this package stays dependency-free. */
export interface RedisLikeForLock {
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    condition: 'NX',
  ): Promise<'OK' | null>;
  eval(
    script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

export class LockBusyError extends Error {
  readonly code = 'LOCK_BUSY';
  constructor(readonly key: string) {
    super(`lock busy: ${key}`);
    this.name = 'LockBusyError';
  }
}

/**
 * Release only if we still own the lock. A plain DEL would let a caller whose
 * lease already expired delete the *next* holder's lock.
 */
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

/** Extend our own lease; returns 1 when we still held it. */
const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

export interface RedisLockOptions {
  /** Lease length. Must exceed the longest safe run of the critical section. */
  readonly ttlMs?: number;
  /** How long to keep retrying acquisition before giving up. */
  readonly waitMs?: number;
  /** Delay between acquisition attempts. */
  readonly retryDelayMs?: number;
  /**
   * Auto-renew the lease while the critical section runs, so a slow-but-alive
   * holder is not mistaken for a crashed one.
   */
  readonly autoRenew?: boolean;
}

function randomToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface AcquiredLock {
  readonly key: string;
  readonly token: string;
  renew(ttlMs?: number): Promise<boolean>;
  release(): Promise<void>;
}

/**
 * Try to take the lock. Returns null instead of throwing so callers can decide
 * between failing fast and skipping quietly (the heartbeat skips).
 */
export async function acquireRedisLock(
  redis: RedisLikeForLock,
  key: string,
  options: RedisLockOptions = {},
): Promise<AcquiredLock | null> {
  const ttlMs = Math.max(1_000, options.ttlMs ?? 30_000);
  const waitMs = Math.max(0, options.waitMs ?? 0);
  const retryDelayMs = Math.max(25, options.retryDelayMs ?? 120);
  const token = randomToken();
  const deadline = Date.now() + waitMs;

  for (;;) {
    const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (ok === 'OK') {
      let released = false;
      let renewTimer: ReturnType<typeof setInterval> | undefined;
      const lock: AcquiredLock = {
        key,
        token,
        renew: async (nextTtlMs?: number) => {
          if (released) return false;
          const res = await redis.eval(
            RENEW_SCRIPT,
            1,
            key,
            token,
            String(Math.max(1_000, nextTtlMs ?? ttlMs)),
          );
          return Number(res) === 1;
        },
        release: async () => {
          if (released) return;
          released = true;
          if (renewTimer) clearInterval(renewTimer);
          try {
            await redis.eval(RELEASE_SCRIPT, 1, key, token);
          } catch {
            // Lease expiry is the backstop; a failed release is not fatal.
          }
        },
      };
      if (options.autoRenew !== false) {
        renewTimer = setInterval(
          () => {
            void lock.renew().catch(() => undefined);
          },
          Math.max(500, Math.floor(ttlMs / 3)),
        );
        // Never keep the process alive just to renew a lock.
        (renewTimer as unknown as { unref?: () => void }).unref?.();
      }
      return lock;
    }
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(retryDelayMs, Math.max(1, deadline - Date.now())));
  }
}

/**
 * Run `fn` while holding the lock. Throws {@link LockBusyError} if it cannot be
 * acquired within `waitMs`.
 */
export async function withRedisLock<T>(
  redis: RedisLikeForLock,
  key: string,
  fn: () => Promise<T>,
  options: RedisLockOptions = {},
): Promise<T> {
  const lock = await acquireRedisLock(redis, key, options);
  if (!lock) throw new LockBusyError(key);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/** Canonical lock key for advancing one world's society simulation. */
export function societyWorldLockKey(worldId: string): string {
  return `lock:society:world:${worldId}`;
}
