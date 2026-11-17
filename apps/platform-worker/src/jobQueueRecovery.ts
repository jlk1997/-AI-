/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * When platform-worker is killed by `tsx watch` (Windows especially), the
 * in-flight BullMQ job stays `active` under a lock that used to last 3 hours.
 * Postgres still says `running`, the new process prints "listening", and the
 * UI looks like generation stopped.
 *
 * Recovery:
 * 1. If we are the only worker, move leftover `active` jobs back to `wait`.
 * 2. Discard BullMQ payloads whose Postgres `jobs` row is gone (DB wipe /
 *    cascade delete left Redis orphaned — these cause agent_events FK spam).
 * 3. Re-enqueue DB queued/running jobs that have no waiting/active/delayed
 *    BullMQ counterpart.
 */

import { inArray } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import type { DrizzleDb } from '@opengame/platform-db';
import { jobs } from '@opengame/platform-db';

import { enqueuePlatformJob } from './bullEnqueue.js';

export type BullJobRef = {
  readonly id?: string;
  readonly data?: { jobId?: string };
  remove?: () => Promise<unknown>;
};

export type DbJobRef = {
  readonly id: string;
  readonly status: string;
};

export function collectBullPostgresJobIds(bullJobs: BullJobRef[]): Set<string> {
  const ids = new Set<string>();
  for (const job of bullJobs) {
    const id = job.data?.jobId;
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  }
  return ids;
}

export function pickOrphanedDbJobs(
  dbJobs: DbJobRef[],
  bullPostgresIds: Set<string>,
): DbJobRef[] {
  return dbJobs.filter(
    (job) =>
      (job.status === 'queued' || job.status === 'running') &&
      !bullPostgresIds.has(job.id),
  );
}

/** BullMQ jobs pointing at Postgres ids that no longer exist. */
export function pickGhostBullJobs(
  bullJobs: BullJobRef[],
  knownPostgresIds: Set<string>,
): BullJobRef[] {
  return bullJobs.filter((job) => {
    const id = job.data?.jobId;
    if (typeof id !== 'string' || id.length === 0) return false;
    return !knownPostgresIds.has(id);
  });
}

/**
 * Stealing `active` jobs is only safe when no other living worker owns them.
 * `workerCount === 0` is a restart gap; `=== 1` is this process after listen.
 */
export function shouldStealActiveJobs(workerCount: number): boolean {
  return workerCount <= 1;
}

export type OrphanRecoveryResult = {
  readonly workerCount: number;
  readonly movedActive: number;
  readonly discardedGhosts: number;
  readonly requeued: number;
};

export async function recoverOrphanedPlatformJobs(args: {
  readonly db: DrizzleDb;
  readonly queue: Queue;
}): Promise<OrphanRecoveryResult> {
  const { db, queue } = args;
  let movedActive = 0;
  const workerCount = await queue.getWorkersCount();

  if (shouldStealActiveJobs(workerCount)) {
    const active = await queue.getJobs(['active']);
    const client = await queue.client;
    const qualified = queue.qualifiedName;
    for (const job of active) {
      try {
        if (job.id) {
          // Token "0" skips lock matching but leaves the dead worker's lock key.
          await client.del(`${qualified}:${job.id}:lock`);
        }
        await job.moveToWait();
        movedActive += 1;
        const pgId =
          job.data && typeof job.data === 'object' && 'jobId' in job.data
            ? String((job.data as { jobId?: string }).jobId ?? job.id)
            : String(job.id);
        console.warn(
          `[platform-worker] moved orphaned active job back to wait postgres=${pgId} bull=${job.id}`,
        );
      } catch (err) {
        console.warn(
          `[platform-worker] moveToWait failed bull=${job.id}`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  const inflight = await queue.getJobs(['waiting', 'active', 'delayed', 'paused']);
  const bullIds = collectBullPostgresJobIds(
    inflight.map((job) => ({
      id: job.id,
      data: job.data as { jobId?: string },
    })),
  );

  let discardedGhosts = 0;
  if (bullIds.size > 0) {
    const existingRows = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(inArray(jobs.id, [...bullIds]));
    const existingSet = new Set(existingRows.map((row) => row.id));
    const ghosts = pickGhostBullJobs(
      inflight.map((job) => ({
        id: job.id,
        data: job.data as { jobId?: string },
        remove: () => job.remove(),
      })),
      existingSet,
    );
    for (const ghost of ghosts) {
      try {
        await ghost.remove?.();
        discardedGhosts += 1;
        console.warn(
          `[platform-worker] discarded ghost BullMQ job postgres=${ghost.data?.jobId} bull=${ghost.id}`,
        );
      } catch (err) {
        console.warn(
          `[platform-worker] discard ghost failed bull=${ghost.id}`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  const remaining = await queue.getJobs(['waiting', 'active', 'delayed', 'paused']);
  const remainingIds = collectBullPostgresJobIds(
    remaining.map((job) => ({
      id: job.id,
      data: job.data as { jobId?: string },
    })),
  );

  const dbJobs = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(inArray(jobs.status, ['queued', 'running']));

  const orphans = pickOrphanedDbJobs(dbJobs, remainingIds);
  let requeued = 0;
  for (const job of orphans) {
    try {
      await enqueuePlatformJob(queue, job.id);
      requeued += 1;
      console.warn(
        `[platform-worker] re-enqueued orphaned ${job.status} job ${job.id}`,
      );
    } catch (err) {
      console.error(
        `[platform-worker] re-enqueue failed ${job.id}`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { workerCount, movedActive, discardedGhosts, requeued };
}
