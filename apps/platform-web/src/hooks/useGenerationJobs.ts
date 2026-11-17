/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Job-list helpers for the studio hook. Kept out of useGeneration so the
 * pipeline / preview / retry callbacks can stay in the hook.
 */

import { summarizeJobLogKey } from '../utils/jobFailureText';
import type { JobRow } from '../types';

export type FailedJobUiRow = {
  id: string;
  type: 'generate' | 'build' | 'publish' | 'bench' | 'world_generate' | 'world_edit';
  status: 'failed';
  logKey: string | null;
  retryCount: number;
  createdAt: string;
  errorMessage?: string;
  deadLetter?: boolean;
  deadLetterId?: string;
};

export function pickLiveProjectJobs(jobs: JobRow[]): JobRow[] {
  return jobs
    .filter(
      (j) =>
        (j.status === 'queued' || j.status === 'running') &&
        (j.type === 'generate' ||
          j.type === 'world_generate' ||
          j.type === 'world_edit' ||
          j.type === 'build' ||
          j.type === 'publish' ||
          j.type === 'bench'),
    )
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

export function pickLiveSessionJob(
  jobs: JobRow[],
  sessionId: string,
): JobRow | undefined {
  const live = jobs.filter(
    (j) =>
      j.sessionId === sessionId &&
      (j.status === 'queued' || j.status === 'running') &&
      (j.type === 'generate' ||
        j.type === 'world_generate' ||
        j.type === 'world_edit' ||
        j.type === 'build'),
  );
  return live.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
}

export function isWorldJobType(type: string | undefined): boolean {
  return type === 'world_generate' || type === 'world_edit';
}

/** Child job id after a studio retry. `'claiming'` is a crash leftover, not a job. */
export function requeuedToOf(job: { readonly result?: unknown }): string | null {
  const result = job.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const id = (result as { requeuedTo?: unknown }).requeuedTo;
  return typeof id === 'string' && id.length > 0 && id !== 'claiming' ? id : null;
}

export function pickLatestWorldJob(
  jobs: readonly JobRow[],
): JobRow | undefined {
  return [...jobs]
    .filter((job) => isWorldJobType(job.type))
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
}

export function isSupersededFailure(
  job: JobRow,
  all: readonly JobRow[],
): boolean {
  if (requeuedToOf(job)) return true;
  const ts = new Date(job.createdAt).getTime();
  return all.some(
    (other) =>
      other.status === 'succeeded' &&
      other.type === job.type &&
      new Date(other.createdAt).getTime() >= ts,
  );
}

/** Latest world job is the only one that decides the overlay — not an older fail. */
export function latestWorldJobFailed(jobs: readonly JobRow[]): boolean {
  const latest = pickLatestWorldJob(jobs);
  return Boolean(latest && latest.status === 'failed' && !requeuedToOf(latest));
}

export function pickAgentReplayJob(
  jobsOrderedDesc: JobRow[],
  sessionId: string,
): JobRow | undefined {
  for (const j of jobsOrderedDesc) {
    if (j.sessionId !== sessionId) continue;
    if (
      (j.type === 'generate' ||
        j.type === 'world_generate' ||
        j.type === 'world_edit') &&
      j.status === 'succeeded'
    ) {
      return j;
    }
  }
  for (const j of jobsOrderedDesc) {
    if (j.sessionId !== sessionId) continue;
    if (j.status === 'succeeded') return j;
  }
  return jobsOrderedDesc.find((j) => j.sessionId === sessionId);
}

export function filterFailedJobsForUi(
  jobs: JobRow[],
  sessionFocus: string | null,
): FailedJobUiRow[] {
  const failed = jobs.filter(
    (job) => job.status === 'failed' && !isSupersededFailure(job, jobs),
  );
  let picked: JobRow[];
  if (sessionFocus) {
    const sessionJobs = jobs.filter((j) => j.sessionId === sessionFocus);
    const latestSuccessTs = sessionJobs
      .filter((j) => j.status === 'succeeded')
      .reduce((max, j) => Math.max(max, new Date(j.createdAt).getTime()), 0);
    picked = failed.filter(
      (j) =>
        j.sessionId === sessionFocus &&
        new Date(j.createdAt).getTime() > latestSuccessTs,
    );
  } else {
    const cutoff = Date.now() - 48 * 3600 * 1000;
    picked = failed
      .filter((j) => new Date(j.createdAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 15);
  }
  picked.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return picked.map((job) => ({
    id: job.id,
    type: job.type as FailedJobUiRow['type'],
    status: 'failed' as const,
    logKey: job.logKey,
    retryCount: job.retryCount,
    createdAt: job.createdAt,
    errorMessage: summarizeJobLogKey(job.logKey) || undefined,
  }));
}

export function attachDeadLetters(
  rows: FailedJobUiRow[],
  letters: ReadonlyArray<{ id?: string; jobId: string | null }>,
): FailedJobUiRow[] {
  const byJob = new Map<string, string | undefined>();
  for (const letter of letters) {
    if (letter.jobId) byJob.set(letter.jobId, letter.id);
  }
  if (byJob.size === 0) return rows;
  return rows.map((row) =>
    byJob.has(row.id)
      ? { ...row, deadLetter: true, deadLetterId: byJob.get(row.id) }
      : row,
  );
}
