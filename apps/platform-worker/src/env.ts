/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveWorkspaceArchivePrefix } from './storageLayout.js';

function isProductionRuntime(): boolean {
  if (process.env['PLATFORM_RUNTIME'] === 'development') return false;
  return (
    process.env['PLATFORM_RUNTIME'] === 'production' ||
    process.env['NODE_ENV'] === 'production'
  );
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Default lock TTL: long enough for a blocked event loop, short enough to recover a killed worker. */
export const DEFAULT_BULLMQ_LOCK_DURATION_MS = 120_000;

export type WorkerEnv = {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly s3Endpoint: string;
  readonly s3Region: string;
  readonly s3Bucket: string;
  readonly s3AccessKey: string;
  readonly s3SecretKey: string;
  readonly s3ForcePathStyle: boolean;
  /** Concurrent jobs per worker process (BullMQ concurrency). */
  readonly concurrency: number;
  /**
   * BullMQ lock TTL (ms). The worker auto-renews the lock while the processor
   * is running — this is NOT the max job runtime. A 3h lock meant a killed
   * `tsx watch` process left generate jobs stuck until the lock expired.
   * Keep this a few minutes so crash/restart resumes quickly; only raise it if
   * a single sync stretch blocks the event loop longer than this TTL.
   * @see https://docs.bullmq.io/guide/workers/stalled-jobs
   */
  readonly bullmqLockDurationMs: number;
  /** How many times a job may re-enter `wait` after a stall before it is failed permanently. */
  readonly bullmqMaxStalledCount: number;
  /** How often the worker runs the stalled-job checker (ms). */
  readonly bullmqStalledIntervalMs: number;
  /** When set, projects' workspaces are archived to / restored from S3 with this key prefix. */
  readonly workspaceArchiveKeyPrefix: string | null;
  /** Optional ops ping when a job exhausts retries. */
  readonly alertWebhookUrl: string | undefined;
};

export function readWorkerEnv(): WorkerEnv {
  const databaseUrl = process.env['PLATFORM_DATABASE_URL'];
  const redisUrl = process.env['PLATFORM_REDIS_URL'];
  if (!databaseUrl || !redisUrl) {
    throw new Error('PLATFORM_DATABASE_URL and PLATFORM_REDIS_URL are required');
  }
  const s3Endpoint = process.env['PLATFORM_S3_ENDPOINT'];
  const s3Bucket = process.env['PLATFORM_S3_BUCKET'];
  const s3AccessKey = process.env['PLATFORM_S3_ACCESS_KEY'];
  const s3SecretKey = process.env['PLATFORM_S3_SECRET_KEY'];
  if (!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey) {
    throw new Error('S3 env vars are required for the worker');
  }
  const concurrencyRaw = process.env['PLATFORM_WORKER_CONCURRENCY'];
  const concurrency = concurrencyRaw ? Math.max(1, Number.parseInt(concurrencyRaw, 10)) : 1;
  const bullmqLockDurationMs = parsePositiveInt(
    process.env['PLATFORM_BULLMQ_LOCK_DURATION_MS'],
    DEFAULT_BULLMQ_LOCK_DURATION_MS,
  );
  const bullmqMaxStalledCount = parsePositiveInt(
    process.env['PLATFORM_BULLMQ_MAX_STALLED_COUNT'],
    64,
  );
  const bullmqStalledIntervalMs = parsePositiveInt(
    process.env['PLATFORM_BULLMQ_STALLED_INTERVAL_MS'],
    45_000,
  );
  const archivePrefix = resolveWorkspaceArchivePrefix(
    process.env['PLATFORM_WORKSPACE_ARCHIVE_PREFIX'],
  );
  if (isProductionRuntime() && !process.env['PLATFORM_ALERT_WEBHOOK_URL']?.trim()) {
    throw new Error(
      'Production boot refused: PLATFORM_ALERT_WEBHOOK_URL is required',
    );
  }
  return {
    databaseUrl,
    redisUrl,
    s3Endpoint,
    s3Region: process.env['PLATFORM_S3_REGION'] ?? 'us-east-1',
    s3Bucket,
    s3AccessKey,
    s3SecretKey,
    s3ForcePathStyle: process.env['PLATFORM_S3_FORCE_PATH_STYLE'] !== 'false',
    concurrency: Number.isFinite(concurrency) ? concurrency : 1,
    bullmqLockDurationMs,
    bullmqMaxStalledCount,
    bullmqStalledIntervalMs,
    workspaceArchiveKeyPrefix: archivePrefix,
    alertWebhookUrl: process.env['PLATFORM_ALERT_WEBHOOK_URL'],
  };
}
