/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  alreadyRequeued,
  canRequeueJobStatus,
  isRequeueQuotaDenied,
  requeueSourcePayload,
} from './requeueJob.js';

describe('canRequeueJobStatus', () => {
  it('allows finished jobs only', () => {
    expect(canRequeueJobStatus('failed')).toBe(true);
    expect(canRequeueJobStatus('succeeded')).toBe(true);
    expect(canRequeueJobStatus('running')).toBe(false);
    expect(canRequeueJobStatus('queued')).toBe(false);
  });

  it('stamps the source job id so a second retry is a no-op', () => {
    expect(alreadyRequeued(null)).toBe(false);
    expect(alreadyRequeued({ cacheHit: true })).toBe(false);
    expect(alreadyRequeued({ requeuedTo: 'job-2' })).toBe(true);
    expect(requeueSourcePayload({ prompt: 'hi' }, 'job-1')).toEqual({
      prompt: 'hi',
      requeuedFrom: 'job-1',
    });
  });

  it('does not treat a successful requeue as a quota denial', () => {
    expect(
      isRequeueQuotaDenied({ already: false, jobId: 'j2', traceId: 't' }),
    ).toBe(false);
    expect(
      isRequeueQuotaDenied({
        already: false,
        quotaDenied: true,
        reason: 'Daily job limit reached',
        plan: 'free',
      }),
    ).toBe(true);
  });
});
