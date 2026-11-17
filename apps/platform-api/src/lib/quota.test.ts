/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { jobQuotaBlockReason, ledgerRowIsJobSpend } from './quota.js';

describe('jobQuotaBlockReason', () => {
  it('blocks when concurrency or the UTC-day cap is full', () => {
    expect(
      jobQuotaBlockReason(2, 0, { plan: 'free', maxConcurrent: 2, dailyJobLimit: 10 }),
    ).toContain('Concurrent job limit');
    expect(
      jobQuotaBlockReason(0, 10, { plan: 'free', maxConcurrent: 2, dailyJobLimit: 10 }),
    ).toContain('Daily job limit');
    expect(
      jobQuotaBlockReason(1, 9, { plan: 'free', maxConcurrent: 2, dailyJobLimit: 10 }),
    ).toBeNull();
  });
});

describe('ledgerRowIsJobSpend', () => {
  it('only matches a negative spend row so refunds cannot skip a later charge', () => {
    expect(ledgerRowIsJobSpend('spend', -10)).toBe(true);
    expect(ledgerRowIsJobSpend('spend', 10)).toBe(false);
    expect(ledgerRowIsJobSpend('refund', -10)).toBe(false);
    expect(ledgerRowIsJobSpend('royalty', 3)).toBe(false);
  });
});
