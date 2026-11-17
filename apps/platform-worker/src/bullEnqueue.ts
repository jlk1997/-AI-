/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Queue } from 'bullmq';

function isDuplicateJobIdError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Job .* already exists|already exists/i.test(msg);
}

/**
 * Enqueue a platform run. Uses the Postgres `jobs.id` as the BullMQ job id so
 * restarts / recovery cannot stack duplicate payloads for the same row.
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
