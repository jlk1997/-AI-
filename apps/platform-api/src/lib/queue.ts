/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export type JobQueueBundle = {
  readonly queue: Queue;
  /** A separate Redis client safe to use for non-BullMQ operations (e.g. rate-limits). */
  readonly redis: Redis;
  readonly close: () => Promise<void>;
};

export function createJobQueue(redisUrl: string): JobQueueBundle {
  // BullMQ requires `maxRetriesPerRequest: null` on its client; keep it dedicated.
  const queueConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  // For app-level use (rate limit, cache, etc.) we keep defaults so reads fail fast.
  const sideConnection = new Redis(redisUrl);
  const queue = new Queue('platform', { connection: queueConnection });
  return {
    queue,
    redis: sideConnection,
    close: async () => {
      await queue.close();
      await queueConnection.quit();
      await sideConnection.quit();
    },
  };
}

function isDuplicateJobIdError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Job .* already exists|already exists/i.test(msg);
}

/**
 * Enqueue a platform run. Uses the Postgres `jobs.id` as the BullMQ job id so
 * the API and worker share one idempotent queue entry per DB row.
 */
export async function enqueuePlatformJob(
  queue: Queue,
  jobId: string,
): Promise<void> {
  try {
    await queue.add(
      'run',
      { jobId },
      {
        jobId,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  } catch (err) {
    if (isDuplicateJobIdError(err)) return;
    throw err;
  }
}
