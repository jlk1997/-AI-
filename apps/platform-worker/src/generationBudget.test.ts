/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CLI_TIMEOUT_MS,
  DEFAULT_TIME_BUDGET_MS,
  MIN_CLI_TIMEOUT_MS,
  hasUsefulCliBudget,
  readBaseCliTimeoutMs,
  readGenerationTimeBudgetMs,
  resolveCliTimeoutForAttempt,
} from './generationBudget.js';

describe('readGenerationTimeBudgetMs', () => {
  it('defaults to 20 minutes and rejects absurdly small values', () => {
    expect(readGenerationTimeBudgetMs({})).toBe(DEFAULT_TIME_BUDGET_MS);
    expect(
      readGenerationTimeBudgetMs({ PLATFORM_GENERATION_TIME_BUDGET_MS: '1000' }),
    ).toBe(DEFAULT_TIME_BUDGET_MS);
    expect(
      readGenerationTimeBudgetMs({
        PLATFORM_GENERATION_TIME_BUDGET_MS: '300000',
      }),
    ).toBe(300_000);
  });
});

describe('readBaseCliTimeoutMs', () => {
  it('falls back to the 10-minute default', () => {
    expect(readBaseCliTimeoutMs({})).toBe(DEFAULT_CLI_TIMEOUT_MS);
    expect(readBaseCliTimeoutMs({ PLATFORM_CLI_TIMEOUT_MS: 'abc' })).toBe(
      DEFAULT_CLI_TIMEOUT_MS,
    );
    expect(readBaseCliTimeoutMs({ PLATFORM_CLI_TIMEOUT_MS: '60000' })).toBe(
      60_000,
    );
  });
});

describe('hasUsefulCliBudget', () => {
  it('requires at least the minimum CLI timeout', () => {
    expect(hasUsefulCliBudget(MIN_CLI_TIMEOUT_MS)).toBe(true);
    expect(hasUsefulCliBudget(MIN_CLI_TIMEOUT_MS - 1)).toBe(false);
  });
});

describe('resolveCliTimeoutForAttempt', () => {
  const base = 720_000;

  it('gives CODE the full timeout and decays FIX rounds gently', () => {
    expect(
      resolveCliTimeoutForAttempt({
        attempt: 1,
        remainingBudgetMs: 900_000,
        baseTimeoutMs: base,
      }),
    ).toBe(base);
    expect(
      resolveCliTimeoutForAttempt({
        attempt: 2,
        remainingBudgetMs: 900_000,
        baseTimeoutMs: base,
      }),
    ).toBe(360_000);
    expect(
      resolveCliTimeoutForAttempt({
        attempt: 4,
        remainingBudgetMs: 900_000,
        baseTimeoutMs: base,
      }),
    ).toBe(288_000);
  });

  it('clamps to the remaining budget without inflating past it', () => {
    expect(
      resolveCliTimeoutForAttempt({
        attempt: 1,
        remainingBudgetMs: 200_000,
        baseTimeoutMs: base,
      }),
    ).toBe(200_000);
    expect(
      resolveCliTimeoutForAttempt({
        attempt: 3,
        remainingBudgetMs: 1_000,
        baseTimeoutMs: base,
      }),
    ).toBe(1_000);
  });

  it('keeps the floor when the remaining budget can afford it', () => {
    expect(
      resolveCliTimeoutForAttempt({
        attempt: 3,
        remainingBudgetMs: MIN_CLI_TIMEOUT_MS + 5_000,
        baseTimeoutMs: base,
      }),
    ).toBe(MIN_CLI_TIMEOUT_MS + 5_000);
  });

  it('honours a small configured base without inflating it', () => {
    expect(
      resolveCliTimeoutForAttempt({
        attempt: 3,
        remainingBudgetMs: 900_000,
        baseTimeoutMs: 60_000,
      }),
    ).toBe(60_000);
  });

  it('can force a full CODE timeout on a later attempt', () => {
    expect(
      resolveCliTimeoutForAttempt({
        attempt: 2,
        remainingBudgetMs: 900_000,
        baseTimeoutMs: base,
        forceFullTimeout: true,
      }),
    ).toBe(base);
  });
});
