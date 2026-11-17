/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  collapseHeartbeatEvents,
  extractProgressMeta,
  getEffectivePhase,
} from './generationProgressText';
import { derivePipelineSteps, pipelineVisualPercent } from './creationPipeline';
import type { AgentEventRow } from '../types';

function evt(
  partial: Partial<AgentEventRow> & Pick<AgentEventRow, 'phase' | 'seq'>,
): AgentEventRow {
  return {
    id: `e-${partial.seq}`,
    jobId: 'job-1',
    projectId: 'p1',
    sessionId: null,
    role: 'system',
    tool: null,
    summary: partial.summary ?? null,
    details: partial.details ?? null,
    elapsedMs: null,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe('getEffectivePhase', () => {
  it('ignores heartbeat PLAN and keeps CODE', () => {
    const events = [
      evt({ phase: 'CODE', seq: 1, summary: 'CLI start' }),
      evt({
        phase: 'PLAN',
        seq: 2,
        summary: 'OpenGame CLI…（已 30 秒）',
        details: { heartbeat: true, elapsedSec: 30, activePhase: 'CODE' },
      }),
    ];
    expect(getEffectivePhase(events)).toBe('CODE');
  });

  it('uses activePhase on heartbeat when no prior real event', () => {
    const events = [
      evt({
        phase: 'PLAN',
        seq: 1,
        details: { heartbeat: true, activePhase: 'FIX', elapsedSec: 10 },
      }),
    ];
    expect(getEffectivePhase(events)).toBe('FIX');
  });
});

describe('collapseHeartbeatEvents', () => {
  it('keeps only the latest heartbeat', () => {
    const events = [
      evt({ phase: 'CODE', seq: 1 }),
      evt({
        phase: 'CODE',
        seq: 2,
        details: { heartbeat: true, elapsedSec: 30 },
      }),
      evt({
        phase: 'CODE',
        seq: 3,
        details: { heartbeat: true, elapsedSec: 60 },
      }),
    ];
    const collapsed = collapseHeartbeatEvents(events);
    expect(collapsed).toHaveLength(2);
    expect((collapsed[1]!.details as { elapsedSec: number }).elapsedSec).toBe(60);
  });

  it('keeps only the latest CLI stream line alongside the latest heartbeat', () => {
    const events = [
      evt({ phase: 'CODE', seq: 1, summary: 'CLI start' }),
      evt({
        phase: 'CODE',
        seq: 2,
        summary: 'writing scene.ts',
        details: { stream: true, seq: 1 },
      }),
      evt({
        phase: 'CODE',
        seq: 3,
        details: { heartbeat: true, elapsedSec: 30 },
      }),
      evt({
        phase: 'CODE',
        seq: 4,
        summary: 'npm install',
        details: { stream: true, seq: 2 },
      }),
      evt({
        phase: 'CODE',
        seq: 5,
        details: { heartbeat: true, elapsedSec: 60 },
      }),
    ];
    const collapsed = collapseHeartbeatEvents(events);
    expect(collapsed).toHaveLength(3);
    expect(collapsed[0]!.summary).toBe('CLI start');
    expect((collapsed[1]!.details as { elapsedSec: number }).elapsedSec).toBe(60);
    expect(collapsed[2]!.summary).toBe('npm install');
  });
});

describe('extractProgressMeta', () => {
  it('keeps the latest CLI stream line for the live headline', () => {
    const meta = extractProgressMeta([
      evt({
        phase: 'CODE',
        seq: 1,
        summary: 'writing scene.ts',
        details: { stream: true },
      }),
      evt({
        phase: 'CODE',
        seq: 2,
        details: { heartbeat: true, elapsedSec: 45 },
        summary: 'still running',
      }),
      evt({
        phase: 'CODE',
        seq: 3,
        summary: 'npm install',
        details: { stream: true },
      }),
    ]);
    expect(meta.cliSummary).toBe('npm install');
    expect(meta.heartbeatSec).toBe(45);
  });
});

describe('getEffectivePhase stream', () => {
  it('ignores CLI stream rows so the headline stays on CODE', () => {
    const events = [
      evt({ phase: 'CODE', seq: 1, summary: 'CLI start' }),
      evt({
        phase: 'PLAN',
        seq: 2,
        summary: 'vite',
        details: { stream: true },
      }),
    ];
    expect(getEffectivePhase(events)).toBe('CODE');
  });
});

describe('derivePipelineSteps', () => {
  it('marks code active during CLI heartbeat with activePhase', () => {
    const events = [
      evt({ phase: 'INTENT', seq: 1 }),
      evt({ phase: 'PLAN', seq: 2, summary: 'engine 脚手架' }),
      evt({ phase: 'ASSET', seq: 3, details: { files: ['a.png'] } }),
      evt({ phase: 'CODE', seq: 4 }),
      evt({
        phase: 'CODE',
        seq: 5,
        details: { heartbeat: true, elapsedSec: 90, activePhase: 'CODE' },
      }),
    ];
    const steps = derivePipelineSteps(events, 'game');
    const code = steps.find((s) => s.id === 'code');
    expect(code?.status).toBe('active');
    const assets = steps.find((s) => s.id === 'assets');
    expect(assets?.status).toBe('done');
  });

  it('keeps code step healthy after silent MiniMax key rotation', () => {
    const events = [
      evt({ phase: 'CODE', seq: 1, details: { keyHint: 'bVM', poolSize: 2 } }),
      evt({
        phase: 'PLAN',
        seq: 2,
        summary: 'Agent 配额/欠费失败 — 切换 Key 池',
        details: {
          providerFailover: 'pool#1',
          keyHint: 'Xl0',
          poolSize: 2,
        },
      }),
      evt({ phase: 'BUILD', seq: 3 }),
    ];
    const steps = derivePipelineSteps(events, 'game');
    const code = steps.find((s) => s.id === 'code');
    expect(code?.note).not.toBe('keyRotated');
    expect(code?.status).not.toBe('degraded');
  });

  it('does not degrade assets on silent image key rotate', () => {
    const events = [
      evt({
        phase: 'ASSET',
        seq: 1,
        summary: 'MiniMax 游戏资产完成（7 项）',
        details: {
          files: ['assets/player.png', 'assets/bgm.mp3'],
          imageFailover: false,
          failoverEvents: [],
        },
      }),
      evt({ phase: 'CODE', seq: 2 }),
    ];
    const steps = derivePipelineSteps(events, 'game');
    const assets = steps.find((s) => s.id === 'assets');
    expect(assets?.status).toBe('done');
    expect(assets?.note).toBeNull();
  });

  it('marks preview degraded when smokeOk is false even with preview URL', () => {
    const events = [
      evt({
        phase: 'QA',
        seq: 1,
        summary: '运行时冒烟未通过',
        details: { smokeOk: false, issues: ['no progress'] },
      }),
      evt({
        phase: 'PREVIEW',
        seq: 2,
        summary: '预览已部署，但冒烟未通过 — 可能不可玩',
        details: { playable: false, smokeOk: false },
      }),
    ];
    const steps = derivePipelineSteps(events, 'game', { hasPreview: true });
    const preview = steps.find((s) => s.id === 'preview');
    expect(preview?.status).toBe('degraded');
    expect(preview?.note).toBe('previewUnplayable');
    const build = steps.find((s) => s.id === 'build');
    expect(build?.status).toBe('degraded');
  });
});

describe('pipelineVisualPercent', () => {
  it('raises percent as steps complete', () => {
    const mid = pipelineVisualPercent(
      [
        { id: 'intent', labelKey: 'a', status: 'done', note: null },
        { id: 'plan', labelKey: 'b', status: 'done', note: null },
        { id: 'code', labelKey: 'c', status: 'active', note: null },
        { id: 'preview', labelKey: 'd', status: 'pending', note: null },
      ],
      20,
    );
    expect(mid).toBeGreaterThan(20);
    expect(mid).toBeLessThan(100);
  });
});
