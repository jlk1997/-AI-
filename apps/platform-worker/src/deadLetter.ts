/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import { jobDeadLetters, jobs } from '@opengame/platform-db';

import { postAlertWebhook } from './alertWebhook.js';

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && 'code' in err && (err as { code: unknown }).code === '23505',
  );
}

/**
 * Persist at most one dead-letter row per job. A second exhaust (or a raced
 * failed handler) must not duplicate the studio list or ping ops twice.
 */
export async function persistDeadLetter(
  db: DrizzleDb,
  params: {
    readonly jobId?: string;
    readonly attempts: number;
    readonly error: string;
    readonly alertWebhookUrl?: string;
  },
): Promise<boolean> {
  let projectId: string | null = null;
  let jobType: string | null = null;
  if (params.jobId) {
    const [row] = await db
      .select({ projectId: jobs.projectId, type: jobs.type })
      .from(jobs)
      .where(eq(jobs.id, params.jobId))
      .limit(1);
    projectId = row?.projectId ?? null;
    jobType = row?.type ?? null;
    const [existing] = await db
      .select({ id: jobDeadLetters.id })
      .from(jobDeadLetters)
      .where(eq(jobDeadLetters.jobId, params.jobId))
      .limit(1);
    if (existing) return false;
  }
  try {
    await db.insert(jobDeadLetters).values({
      jobId: params.jobId ?? null,
      projectId,
      jobType,
      attempts: params.attempts,
      error: params.error.slice(0, 4000),
    });
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
  await postAlertWebhook(params.alertWebhookUrl, {
    kind: 'job.dead_letter',
    jobId: params.jobId ?? null,
    projectId,
    jobType,
    attempts: params.attempts,
    error: params.error.slice(0, 400),
  });
  return true;
}
