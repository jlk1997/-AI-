/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copy a finished job back onto the queue. Dead-letter rows for the source
 * job are removed so the studio tag does not linger after a successful requeue.
 * Double-click retry / dead-letter claim the source row once.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { DrizzleDb } from '@opengame/platform-db';
import { jobDeadLetters, jobs } from '@opengame/platform-db';

import type { PlatformEnv } from '../env.js';
import { enqueuePlatformJob } from './queue.js';
import { assertCanEnqueueJob, lockOrgJobQuota } from './quota.js';

export function canRequeueJobStatus(status: string): boolean {
  return status === 'failed' || status === 'succeeded';
}

export function asJobRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

export function requeueSourcePayload(
  payload: unknown,
  sourceJobId: string,
): Record<string, unknown> {
  return { ...asJobRecord(payload), requeuedFrom: sourceJobId };
}

export function alreadyRequeued(result: unknown): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  return typeof (result as { requeuedTo?: unknown }).requeuedTo === 'string';
}

export type RequeueOutcome =
  | { readonly already: false; readonly quotaDenied?: false; readonly jobId: string; readonly traceId: string }
  | { readonly already: true; readonly quotaDenied?: false; readonly jobId: string | null; readonly traceId: null }
  | {
      readonly already: false;
      readonly quotaDenied: true;
      readonly reason: string;
      readonly plan: string;
      readonly needPoints?: number;
      readonly balance?: number;
    };

export function isRequeueQuotaDenied(
  outcome: RequeueOutcome,
): outcome is Extract<RequeueOutcome, { quotaDenied: true }> {
  return 'quotaDenied' in outcome && outcome.quotaDenied === true;
}

class RequeueQuotaError extends Error {
  readonly plan: string;
  readonly needPoints?: number;
  readonly balance?: number;
  constructor(quota: {
    readonly reason: string;
    readonly plan: string;
    readonly needPoints?: number;
    readonly balance?: number;
  }) {
    super(quota.reason);
    this.name = 'RequeueQuotaError';
    this.plan = quota.plan;
    this.needPoints = quota.needPoints;
    this.balance = quota.balance;
  }
}

export async function insertRequeuedJob(
  db: DrizzleDb,
  queue: Queue,
  source: {
    readonly id: string;
    readonly projectId: string;
    readonly sessionId: string | null;
    readonly type: string;
    readonly payload: unknown;
    readonly retryCount: number;
    readonly result?: unknown;
  },
  opts?: {
    readonly deadLetterId?: string;
    readonly quota?: {
      readonly env: PlatformEnv;
      readonly organizationId: string;
      readonly jobType?: string;
    };
  },
): Promise<RequeueOutcome> {
  let outcome: RequeueOutcome;
  try {
    outcome = await db.transaction(async (tx) => {
    if (opts?.deadLetterId) {
      const [letter] = await tx
        .delete(jobDeadLetters)
        .where(eq(jobDeadLetters.id, opts.deadLetterId))
        .returning({ id: jobDeadLetters.id });
      if (!letter) {
        return { already: true as const, jobId: null, traceId: null };
      }
    }

    const [sourceRow] = await tx
      .select({ id: jobs.id, result: jobs.result })
      .from(jobs)
      .where(eq(jobs.id, source.id))
      .limit(1);
    if (!sourceRow || alreadyRequeued(sourceRow.result)) {
      const existing =
        sourceRow && alreadyRequeued(sourceRow.result)
          ? String((sourceRow.result as { requeuedTo: string }).requeuedTo)
          : null;
      return { already: true as const, jobId: existing, traceId: null };
    }

    const [claimed] = await tx
      .update(jobs)
      .set({
        updatedAt: new Date(),
        result: { ...asJobRecord(sourceRow.result), requeuedTo: 'claiming' },
      })
      .where(and(eq(jobs.id, source.id), sql`(${jobs.result}->>'requeuedTo') IS NULL`))
      .returning({ id: jobs.id });
    if (!claimed) {
      return { already: true as const, jobId: null, traceId: null };
    }

    if (opts?.quota) {
      const scoped = tx as unknown as DrizzleDb;
      await lockOrgJobQuota(scoped, opts.quota.organizationId);
      const quota = await assertCanEnqueueJob(
        scoped,
        opts.quota.env,
        opts.quota.organizationId,
        opts.quota.jobType ?? source.type,
      );
      if (!quota.ok) {
        throw new RequeueQuotaError(quota);
      }
    }

    const traceId = crypto.randomUUID();
    const [newJob] = await tx
      .insert(jobs)
      .values({
        projectId: source.projectId,
        sessionId: source.sessionId,
        type: source.type,
        status: 'queued',
        payload: requeueSourcePayload(source.payload, source.id),
        traceId,
        retryCount: source.retryCount + 1,
      })
      .returning();
    if (!newJob) {
      throw new Error('failed to insert requeued job');
    }

    await tx
      .update(jobs)
      .set({
        updatedAt: new Date(),
        result: { ...asJobRecord(sourceRow.result), requeuedTo: newJob.id },
      })
      .where(eq(jobs.id, source.id));
    await tx.delete(jobDeadLetters).where(eq(jobDeadLetters.jobId, source.id));
    return { already: false as const, jobId: newJob.id, traceId };
    });
  } catch (error) {
    if (error instanceof RequeueQuotaError) {
      return {
        already: false as const,
        quotaDenied: true as const,
        reason: error.message,
        plan: error.plan,
        needPoints: error.needPoints,
        balance: error.balance,
      };
    }
    throw error;
  }

  if (outcome.already || isRequeueQuotaDenied(outcome)) return outcome;
  await enqueuePlatformJob(queue, outcome.jobId);
  return outcome;
}
