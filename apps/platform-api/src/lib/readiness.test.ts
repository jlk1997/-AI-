/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

import { checkReadiness } from './readiness.js';

describe('checkReadiness', () => {
  it('is ready when both dependencies answer', async () => {
    const report = await checkReadiness({
      db: { execute: vi.fn(async () => [{ '?column?': 1 }]) } as never,
      redis: { ping: vi.fn(async () => 'PONG') },
    });
    expect(report.ok).toBe(true);
    expect(report.checks).toEqual({ database: 'ok', redis: 'ok', queue: 'skipped' });
    expect(report.ms.database).toBeGreaterThanOrEqual(0);
    expect(report.ms.redis).toBeGreaterThanOrEqual(0);
  });

  it('fails closed when Redis is down', async () => {
    const report = await checkReadiness({
      db: { execute: vi.fn(async () => [{ '?column?': 1 }]) } as never,
      redis: {
        ping: vi.fn(async () => {
          throw new Error('down');
        }),
      },
    });
    expect(report.ok).toBe(false);
    expect(report.checks.redis).toBe('down');
  });

  it('fails closed when the job queue cannot answer', async () => {
    const report = await checkReadiness({
      db: { execute: vi.fn(async () => [{ '?column?': 1 }]) } as never,
      redis: { ping: vi.fn(async () => 'PONG') },
      queue: {
        getJobCounts: vi.fn(async () => {
          throw new Error('queue down');
        }),
      },
    });
    expect(report.ok).toBe(false);
    expect(report.checks.queue).toBe('down');
  });
});
