/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { createDrizzle, createPostgresClient } from '@opengame/platform-db';
import {
  SOCIETY_LATEST_FRAME_TTL_SEC,
  societyLatestFrameKey,
  worldIdFromSocietyChannel,
} from '@opengame/platform-shared';

import { readWorkerEnv } from './env.js';
import { createS3Client } from './s3.js';
import { processPlatformJob } from './processJob.js';
import { startSocietyHeartbeat } from './societyHeartbeat.js';
import { recoverOrphanedPlatformJobs } from './jobQueueRecovery.js';
import { emitJobMetric } from './jobMetrics.js';
import { persistDeadLetter } from './deadLetter.js';
import { silentOpsAlertWarning } from './alertWebhook.js';
import { startWorkerCourseSettle } from './courseSettleLoop.js';

const env = readWorkerEnv();
const opsSilence = silentOpsAlertWarning(env.alertWebhookUrl, process.env['NODE_ENV']);
if (opsSilence) {
  console.warn(`[platform-worker] ${opsSilence}`);
}
const sql = createPostgresClient(env.databaseUrl);
const db = createDrizzle(sql);
const s3 = createS3Client(env);

const connection = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
});

const queueConnection = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
});

// Dedicated publisher for agent_events / progress fan-out; kept separate from
// BullMQ's subscriber so neither connection ends up in subscriber-only mode.
const publisherConnection = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
});

const jobQueue = new Queue('platform', { connection: queueConnection });

const startedAt = new Date().toISOString();
console.log(
  `[platform-worker] pid=${process.pid} startedAt=${startedAt} concurrency=${env.concurrency} bullmq lockDurationMs=${env.bullmqLockDurationMs} maxStalledCount=${env.bullmqMaxStalledCount}`,
);

try {
  const recovered = await recoverOrphanedPlatformJobs({ db, queue: jobQueue });
  console.log(
    `[platform-worker] orphan recovery workers=${recovered.workerCount} movedActive=${recovered.movedActive} discardedGhosts=${recovered.discardedGhosts} requeued=${recovered.requeued}`,
  );
} catch (err) {
  console.error('[platform-worker] orphan recovery failed', err);
}

const worker = new Worker<{ jobId: string }>(
  'platform',
  async (bullJob) => {
    const jobId = bullJob.data.jobId;
    await processPlatformJob(db, s3, env, jobQueue, jobId, {
      publisher: publisherConnection,
    });
  },
  {
    connection,
    concurrency: env.concurrency,
    lockDuration: env.bullmqLockDurationMs,
    maxStalledCount: env.bullmqMaxStalledCount,
    stalledInterval: env.bullmqStalledIntervalMs,
  },
);

worker.on('active', (job) => {
  console.log('[worker] active', job.data.jobId, `(bull=${job.id})`);
});

worker.on('completed', (job) => {
  console.log('[worker] completed', job.data.jobId);
});

worker.on('failed', (job, err) => {
  const attempts = job?.attemptsMade ?? 0;
  const max = job?.opts.attempts ?? 1;
  const jobId = job?.data?.jobId ?? job?.id;
  console.error('[worker] failed', jobId, err);
  if (attempts >= max) {
    const error = err instanceof Error ? err.message : String(err);
    emitJobMetric({
      name: 'job.dead_letter',
      jobId: typeof jobId === 'string' ? jobId : undefined,
      extra: {
        error,
        attempts,
      },
    });
    console.error('[worker] dead-letter', jobId, `attempts=${attempts}`);
    void persistDeadLetter(db, {
      jobId: typeof jobId === 'string' ? jobId : undefined,
      attempts,
      error,
      alertWebhookUrl: env.alertWebhookUrl,
    }).catch((persistErr) => {
      console.error('[worker] dead-letter persist failed', persistErr);
    });
  }
});

worker.on('stalled', (jobId) => {
  console.warn('BullMQ job stalled (will re-queue if under maxStalledCount):', jobId);
});

worker.on('lockRenewalFailed', (jobIds) => {
  console.error('BullMQ lock renewal failed — risk of duplicate work if another worker exists:', jobIds);
});

console.log('platform-worker listening on queue "platform"');

// The town advances while someone is on the page. Shares the API's Redis lock so
// only one process ever advances a given world.
const heartbeat = startSocietyHeartbeat({
  db,
  redis: publisherConnection,
  talkBudget: publisherConnection,
  publish: async (channel, message) => {
    const n = await publisherConnection.publish(channel, message);
    const worldId = worldIdFromSocietyChannel(channel);
    if (worldId) {
      await publisherConnection.set(
        societyLatestFrameKey(worldId),
        message,
        'EX',
        SOCIETY_LATEST_FRAME_TTL_SEC,
      );
    }
    return n;
  },
});

const stopCourseSettle = startWorkerCourseSettle(db, publisherConnection);

let shuttingDown = false;

async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.warn(
    `[platform-worker] shutting down (${reason}) — in-flight jobs will be recovered on the next start`,
  );
  stopCourseSettle();
  await heartbeat.stop().catch(() => undefined);
  // Force-close so `tsx watch` / Windows taskkill is not blocked by a 20-minute generate.
  try {
    await worker.close(true);
  } catch {
    // already closing
  }
  await jobQueue.close().catch(() => undefined);
  await queueConnection.quit().catch(() => undefined);
  await publisherConnection.quit().catch(() => undefined);
  await connection.quit().catch(() => undefined);
  await sql.end({ timeout: 5 }).catch(() => undefined);
}

function requestShutdown(reason: string): void {
  void shutdown(reason).finally(() => process.exit(0));
}

process.on('SIGINT', () => requestShutdown('SIGINT'));
process.on('SIGTERM', () => requestShutdown('SIGTERM'));
process.on('SIGBREAK', () => requestShutdown('SIGBREAK'));
