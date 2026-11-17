/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  attachDeadLetters,
  filterFailedJobsForUi,
  isWorldJobType,
  isSupersededFailure,
  latestWorldJobFailed,
  pickLatestWorldJob,
  pickLiveProjectJobs,
  requeuedToOf,
} from './useGenerationJobs';
import type { JobRow } from '../types';

function job(partial: Partial<JobRow> & Pick<JobRow, 'id' | 'status' | 'type'>): JobRow {
  return {
    sessionId: null,
    logKey: null,
    retryCount: 0,
    createdAt: '2026-08-19T00:00:00.000Z',
    ...partial,
  } as JobRow;
}

describe('useGenerationJobs', () => {
  it('treats world generate/edit as world jobs', () => {
    expect(isWorldJobType('world_generate')).toBe(true);
    expect(isWorldJobType('generate')).toBe(false);
  });

  it('lists only live pipeline jobs', () => {
    const live = pickLiveProjectJobs([
      job({ id: '1', status: 'queued', type: 'generate' }),
      job({ id: '2', status: 'succeeded', type: 'generate' }),
      job({ id: '3', status: 'running', type: 'build' }),
    ]);
    expect(live.map((j) => j.id)).toEqual(['1', '3']);
  });

  it('hides a failed job that already grew a retry child', () => {
    const parent = job({
      id: 'e655',
      status: 'failed',
      type: 'world_generate',
      sessionId: 's1',
      createdAt: '2026-08-20T00:57:00.000Z',
      result: { requeuedTo: '0aecc' },
    });
    const child = job({
      id: '0aecc',
      status: 'succeeded',
      type: 'world_generate',
      sessionId: 's1',
      createdAt: '2026-08-20T01:00:00.000Z',
    });
    expect(requeuedToOf(parent)).toBe('0aecc');
    expect(latestWorldJobFailed([parent, child])).toBe(false);
    expect(filterFailedJobsForUi([parent, child], 's1')).toEqual([]);
  });

  it('hides an older world fail after a later success even without requeuedTo', () => {
    const failed = job({
      id: 'old',
      status: 'failed',
      type: 'world_generate',
      sessionId: 's1',
      createdAt: '2026-08-20T00:57:00.000Z',
    });
    const ok = job({
      id: 'new',
      status: 'succeeded',
      type: 'world_generate',
      sessionId: 's1',
      createdAt: '2026-08-20T01:37:00.000Z',
    });
    expect(latestWorldJobFailed([failed, ok])).toBe(false);
    expect(pickLatestWorldJob([failed, ok])?.id).toBe('new');
    expect(isSupersededFailure(failed, [failed, ok])).toBe(true);
    expect(filterFailedJobsForUi([failed, ok], 's1')).toEqual([]);
  });

  it('still shows a failed world job that was never requeued', () => {
    const failed = job({
      id: 'e655',
      status: 'failed',
      type: 'world_generate',
      sessionId: 's1',
      createdAt: '2026-08-20T01:10:00.000Z',
    });
    expect(latestWorldJobFailed([failed])).toBe(true);
    expect(filterFailedJobsForUi([failed], 's1').map((row) => row.id)).toEqual([
      'e655',
    ]);
  });

  it('marks failed jobs that landed in the dead-letter table', () => {
    const marked = attachDeadLetters(
      [
        {
          id: 'a',
          type: 'generate',
          status: 'failed',
          logKey: null,
          retryCount: 3,
          createdAt: '2026-08-19T00:00:00.000Z',
        },
        {
          id: 'b',
          type: 'bench',
          status: 'failed',
          logKey: null,
          retryCount: 1,
          createdAt: '2026-08-19T00:00:00.000Z',
        },
      ],
      [{ id: 'dl-1', jobId: 'a' }],
    );
    expect(marked[0]?.deadLetter).toBe(true);
    expect(marked[0]?.deadLetterId).toBe('dl-1');
    expect(marked[1]?.deadLetter).toBeUndefined();
  });
});
