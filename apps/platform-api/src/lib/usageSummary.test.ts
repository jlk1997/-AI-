/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { mapUsageRecent, usageDurationMs, usageJobType } from './usageSummary.js';

describe('usageJobType', () => {
  it('prefers meta.jobType when present', () => {
    expect(usageJobType('generate', { jobType: 'world_edit', ms: 12 })).toBe('world_edit');
    expect(usageJobType('build', null)).toBe('build');
  });
});

describe('usageDurationMs', () => {
  it('reads a finite non-negative ms', () => {
    expect(usageDurationMs({ ms: 1500 })).toBe(1500);
    expect(usageDurationMs({ ms: -1 })).toBeNull();
    expect(usageDurationMs({})).toBeNull();
  });
});

describe('mapUsageRecent', () => {
  it('flattens recent rows for the wallet', () => {
    const [row] = mapUsageRecent([
      {
        modality: 'generate',
        units: '1',
        jobId: 'j1',
        createdAt: new Date('2026-08-19T00:00:00.000Z'),
        meta: { jobType: 'generate', ms: 4200 },
      },
    ]);
    expect(row).toMatchObject({
      jobType: 'generate',
      units: 1,
      ms: 4200,
      jobId: 'j1',
    });
  });
});
