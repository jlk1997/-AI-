/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type { AgentEventRow } from '../types';
import { deriveAcceptanceChecks } from './acceptanceChecks';

function evt(
  partial: Partial<AgentEventRow> & Pick<AgentEventRow, 'summary'>,
): AgentEventRow {
  return {
    id: '1',
    jobId: 'j',
    projectId: 'p',
    sessionId: null,
    role: 'qa',
    phase: 'QA',
    tool: null,
    seq: 1,
    details: null,
    elapsedMs: null,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe('deriveAcceptanceChecks', () => {
  it('does not paint green on lifecycle=done alone (game)', () => {
    const checks = deriveAcceptanceChecks([], 'game', 'done');
    expect(checks.every((c) => c.status === 'pending')).toBe(true);
  });

  it('does not paint green on lifecycle=done alone (world)', () => {
    const checks = deriveAcceptanceChecks([], 'world', 'done');
    expect(checks.every((c) => c.status === 'pending')).toBe(true);
  });

  it('passes game loop on quality gate text', () => {
    const checks = deriveAcceptanceChecks(
      [evt({ summary: '内容质量门禁通过' })],
      'game',
      'done',
    );
    expect(checks.find((c) => c.id === 'loop')?.status).toBe('pass');
  });

  it('follows the latest world-quality-gate after a FIX retry', () => {
    const checks = deriveAcceptanceChecks(
      [
        evt({
          seq: 1,
          tool: 'world-quality-gate',
          summary: 'World quality gate failed after 1 FIX: thin regions',
          details: { ok: false, issues: ['thin regions'] },
        }),
        evt({
          seq: 2,
          tool: 'world-quality-gate',
          summary: 'World quality gate passed after 1 FIX',
          details: { ok: true, issues: [] },
        }),
        evt({
          seq: 3,
          phase: 'BUILD',
          summary: 'npm install + vite build',
        }),
      ],
      'world',
      'done',
    );
    expect(checks.find((c) => c.id === 'build')?.status).not.toBe('fail');
  });

  it('passes world L2 only on agenticDiff evidence', () => {
    const weak = deriveAcceptanceChecks(
      [
        evt({
          role: 'planner',
          phase: 'PLAN',
          summary: 'World generated with probe later',
        }),
      ],
      'world',
      'done',
    );
    expect(weak.find((c) => c.id === 'l2')?.status).toBe('pending');

    const strong = deriveAcceptanceChecks(
      [
        evt({
          role: 'planner',
          phase: 'PLAN',
          summary: 'Agentic pre-pass · 2 ops · L2 diff visible in Spec',
          details: { agenticDiff: { opsApplied: 2 } },
        }),
      ],
      'world',
      'done',
    );
    expect(strong.find((c) => c.id === 'l2')?.status).toBe('pass');
  });

  it('marks emergence fail when gateFailed / spread < 30% at ≥24h', () => {
    const fail = deriveAcceptanceChecks(
      [
        evt({
          role: 'qa',
          phase: 'WORLD',
          tool: 'society-emergence',
          summary: '涌现报告 · spread=10%',
          details: {
            gateFailed: true,
            spreadOk: false,
            hours: 48,
            report: { informationSpread: { rate: 0.1 } },
          },
        }),
      ],
      'world',
      'done',
    );
    expect(fail.find((c) => c.id === 'emergence')?.status).toBe('fail');

    const pass = deriveAcceptanceChecks(
      [
        evt({
          role: 'qa',
          phase: 'WORLD',
          tool: 'society-emergence',
          summary: '涌现报告 · spread=45%',
          details: {
            gateFailed: false,
            spreadOk: true,
            hours: 48,
            report: { informationSpread: { rate: 0.45 } },
          },
        }),
      ],
      'world',
      'done',
    );
    expect(pass.find((c) => c.id === 'emergence')?.status).toBe('pass');
  });

  it('marks playtest soft-fail red on game acceptance', () => {
    const checks = deriveAcceptanceChecks(
      [
        evt({
          tool: 'playtest-agent',
          summary: '试玩 soft-fail（baseline 亦上报） ending=false',
          details: { ok: false, softFail: true, reachedEnding: false },
        }),
      ],
      'game',
      'done',
    );
    expect(checks.find((c) => c.id === 'playtest')?.status).toBe('fail');
  });

  it('surfaces requirement-gate fit on the game strip', () => {
    const missing = deriveAcceptanceChecks(
      [
        evt({
          tool: 'requirement-gate',
          summary: '需求贴合 1/2 项已落地 — 缺: 钓鱼',
          details: {
            satisfied: ['Boss 战'],
            missing: [{ label: '钓鱼', hint: '抛竿循环' }],
          },
        }),
      ],
      'game',
      'running',
    );
    expect(missing.find((c) => c.id === 'requirements')?.status).toBe('fail');
    expect(missing.find((c) => c.id === 'requirements')?.label).toContain('1/2');

    const ok = deriveAcceptanceChecks(
      [
        evt({
          tool: 'requirement-gate',
          summary: '需求贴合 1/1 项已落地',
          details: { satisfied: ['Boss 战'], missing: [] },
        }),
      ],
      'game',
      'done',
    );
    expect(ok.find((c) => c.id === 'requirements')?.status).toBe('pass');
  });

  it('omits requirement check when the gate never ran', () => {
    const checks = deriveAcceptanceChecks([], 'game', 'done');
    expect(checks.find((c) => c.id === 'requirements')).toBeUndefined();
  });

  it('discloses auto town-seed on top_down RPG as a warning, not a pass', () => {
    const checks = deriveAcceptanceChecks(
      [
        evt({
          role: 'planner',
          phase: 'WORLD',
          tool: 'auto-rpg-world-seed',
          summary: 'RPG used an auto town template (not your Society World)',
          details: { source: 'createEmptyTownWorld' },
        }),
      ],
      'game',
      'done',
    );
    expect(checks.find((c) => c.id === 'autoTownSeed')?.status).toBe('pending');
    expect(checks.find((c) => c.id === 'autoTownSeed')?.label).toMatch(
      /Auto town layout/,
    );
  });
});
