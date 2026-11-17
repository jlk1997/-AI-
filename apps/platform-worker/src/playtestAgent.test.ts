/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { choosePlaytestAction, runPlaytestAgent } from './playtestAgent.js';

describe('playtestAgent', () => {
  it('prefers talk then portal', () => {
    expect(choosePlaytestAction({ nearNpc: true })).toBe('KeyE');
    expect(choosePlaytestAction({ nearPortal: true, talkedCount: 2 })).toBe(
      'KeyE',
    );
    expect(choosePlaytestAction({ won: true })).toBe('done');
  });

  it('runs offline policy loop', async () => {
    const report = await runPlaytestAgent({
      distDir: '/tmp/dist',
      maxSteps: 20,
    });
    expect(report.steps.length).toBeGreaterThan(0);
    expect(report.summary).toContain('playtest');
  });

  it('rejects rubber-stamp minutes without structural depth', async () => {
    const thin = await runPlaytestAgent({
      distDir: '/tmp/dist',
      maxSteps: 20,
      contentMinutes: 5,
    });
    expect(thin.ok).toBe(false);

    const deep = await runPlaytestAgent({
      distDir: '/tmp/dist',
      maxSteps: 20,
      contentMinutes: 30,
    });
    expect(deep.ok).toBe(true);
    expect(deep.estimatedMinutes).toBeGreaterThanOrEqual(20);
  });
});
