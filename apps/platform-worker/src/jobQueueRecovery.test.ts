/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  collectBullPostgresJobIds,
  pickGhostBullJobs,
  pickOrphanedDbJobs,
  shouldStealActiveJobs,
} from './jobQueueRecovery.js';
import { DEFAULT_BULLMQ_LOCK_DURATION_MS } from './env.js';

describe('jobQueueRecovery', () => {
  it('collects postgres job ids from BullMQ payloads', () => {
    const ids = collectBullPostgresJobIds([
      { id: '1', data: { jobId: 'pg-a' } },
      { id: '2', data: {} },
      { id: '3' },
    ]);
    expect([...ids]).toEqual(['pg-a']);
  });

  it('requeues running/queued rows that have no BullMQ counterpart', () => {
    const orphans = pickOrphanedDbJobs(
      [
        { id: 'live', status: 'running' },
        { id: 'waiting', status: 'queued' },
        { id: 'done', status: 'succeeded' },
        { id: 'in-bull', status: 'running' },
      ],
      new Set(['in-bull']),
    );
    expect(orphans.map((j) => j.id).sort()).toEqual(['live', 'waiting']);
  });

  it('picks BullMQ payloads whose postgres job row is gone', () => {
    const ghosts = pickGhostBullJobs(
      [
        { id: '1', data: { jobId: 'gone' } },
        { id: '2', data: { jobId: 'alive' } },
        { id: '3', data: {} },
      ],
      new Set(['alive']),
    );
    expect(ghosts.map((j) => j.id)).toEqual(['1']);
  });

  it('steals active jobs only when at most one worker is alive', () => {
    expect(shouldStealActiveJobs(0)).toBe(true);
    expect(shouldStealActiveJobs(1)).toBe(true);
    expect(shouldStealActiveJobs(2)).toBe(false);
  });

  it('keeps the lock short so a killed worker resumes in minutes, not hours', () => {
    expect(DEFAULT_BULLMQ_LOCK_DURATION_MS).toBe(120_000);
    expect(DEFAULT_BULLMQ_LOCK_DURATION_MS).toBeLessThan(10 * 60 * 1000);
  });
});
