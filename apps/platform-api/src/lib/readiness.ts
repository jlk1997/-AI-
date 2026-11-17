/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * /health stays cheap for liveness. /readyz proves the process can serve.
 */

import { sql } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';

export interface ReadinessRedis {
  ping(): Promise<unknown>;
}

export interface ReadinessQueue {
  getJobCounts(...types: string[]): Promise<unknown>;
}

export interface ReadinessReport {
  readonly ok: boolean;
  readonly status: 'ok' | 'degraded';
  readonly checks: {
    readonly database: 'ok' | 'down';
    readonly redis: 'ok' | 'down';
    readonly queue: 'ok' | 'down' | 'skipped';
  };
  readonly ms: {
    readonly database: number;
    readonly redis: number;
    readonly queue: number;
  };
}

export async function checkReadiness(input: {
  readonly db: DrizzleDb;
  readonly redis: ReadinessRedis;
  readonly queue?: ReadinessQueue;
}): Promise<ReadinessReport> {
  const timed = async <T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> => {
    const t0 = Date.now();
    const value = await fn();
    return { value, ms: Date.now() - t0 };
  };
  const [database, redis, queue] = await Promise.all([
    timed(() =>
      input.db
        .execute(sql`select 1`)
        .then(() => 'ok' as const)
        .catch(() => 'down' as const),
    ),
    timed(() =>
      input.redis
        .ping()
        .then(() => 'ok' as const)
        .catch(() => 'down' as const),
    ),
    timed(() =>
      input.queue
        ? input.queue
            .getJobCounts('wait', 'active', 'failed')
            .then(() => 'ok' as const)
            .catch(() => 'down' as const)
        : Promise.resolve('skipped' as const),
    ),
  ]);
  const ok =
    database.value === 'ok' && redis.value === 'ok' && queue.value !== 'down';
  return {
    ok,
    status: ok ? 'ok' : 'degraded',
    checks: { database: database.value, redis: redis.value, queue: queue.value },
    ms: { database: database.ms, redis: redis.ms, queue: queue.ms },
  };
}
