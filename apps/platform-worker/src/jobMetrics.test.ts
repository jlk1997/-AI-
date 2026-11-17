/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

import { emitJobMetric } from './jobMetrics.js';

describe('emitJobMetric', () => {
  it('writes a structured og.job.metric line', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    emitJobMetric({ name: 'job.dead_letter', jobId: 'j1', extra: { attempts: 3 } });
    expect(spy).toHaveBeenCalled();
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain('og.job.metric');
    expect(line).toContain('job.dead_letter');
    spy.mockRestore();
  });
});
