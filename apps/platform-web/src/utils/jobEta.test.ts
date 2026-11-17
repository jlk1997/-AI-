/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { estimateJobRemainMinutes, typicalJobMinutes } from './jobEta';

describe('jobEta', () => {
  it('queues add a short worker-wait pad', () => {
    const eta = estimateJobRemainMinutes({
      lifecycle: 'queued',
      jobType: 'generate',
    });
    expect(eta.typicalMin).toBe(12);
    expect(eta.remainMin).toBe(14);
  });

  it('scales remain by pipeline percent', () => {
    const eta = estimateJobRemainMinutes({
      lifecycle: 'running',
      jobType: 'build',
      percent: 50,
    });
    expect(typicalJobMinutes('build')).toBe(4);
    expect(eta.remainMin).toBe(2);
  });

  it('caps remain by elapsed wall clock', () => {
    const startedAt = new Date(1_700_000_000_000).toISOString();
    const now = 1_700_000_000_000 + 10 * 60_000;
    const eta = estimateJobRemainMinutes({
      lifecycle: 'running',
      jobType: 'generate',
      percent: 10,
      startedAt,
      now,
    });
    expect(eta.remainMin).toBe(2);
  });
});
