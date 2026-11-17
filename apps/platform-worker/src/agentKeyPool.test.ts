/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { resetProviderPoolHealth } from '@opengame/opengame-core';
import {
  agentKeyMaxRotations,
  applyAgentKeyCandidate,
  formatAgentKeyRotationSummary,
  jobAllowsEmergencyModel,
  pickNextAgentKey,
  pushAgentKeyFailure,
  reclaimPrimaryAfterFallbackBilling,
  recordAgentKeyOutcome,
  resolveAgentKeyCandidates,
  type AgentKeyAttemptFailure,
} from './agentKeyPool.js';

const ENV = {
  OPENGAME_REASONING_PROVIDER: 'minimax',
  OPENGAME_REASONING_API_KEY: 'sk-mm-1111',
  OPENGAME_REASONING_API_KEYS: 'sk-mm-2222',
  OPENAI_FALLBACK_API_KEY: 'sk-mm-3333',
  OPENAI_FALLBACK_BASE_URL: 'https://api.minimaxi.com/v1',
  OPENAI_FALLBACK_MODEL: 'MiniMax-M3',
} satisfies NodeJS.ProcessEnv;

beforeEach(() => {
  resetProviderPoolHealth();
});

describe('resolveAgentKeyCandidates', () => {
  it('orders reasoning keys first, then the MiniMax fallback line', () => {
    const candidates = resolveAgentKeyCandidates(ENV);
    expect(candidates.map((c) => c.keyHint)).toEqual(['1111', '2222', '3333']);
    expect(candidates.map((c) => c.tier)).toEqual([
      'primary',
      'primary',
      'fallback',
    ]);
    expect(candidates[2]!.provider).toBe('minimax');
    expect(candidates[2]!.baseUrl).toBe('https://api.minimaxi.com/v1');
  });

  it('produces a child env overlay that repoints both OPENAI_* and OPENGAME_REASONING_*', () => {
    const candidate = resolveAgentKeyCandidates(ENV)[2]!;
    const childEnv = applyAgentKeyCandidate(
      { PATH: '/usr/bin', OPENAI_API_KEY: 'sk-mm-1111' },
      candidate,
    );
    expect(childEnv['PATH']).toBe('/usr/bin');
    expect(childEnv['OPENAI_API_KEY']).toBe('sk-mm-3333');
    expect(childEnv['OPENGAME_REASONING_API_KEY']).toBe('sk-mm-3333');
    expect(childEnv['OPENGAME_REASONING_PROVIDER']).toBe('minimax');
    expect(childEnv['OPENAI_MODEL']).toBe(childEnv['OPENGAME_REASONING_MODEL']);
  });

  it('defaults fallback base URL to MiniMax (not Ark) when omitted', () => {
    const candidates = resolveAgentKeyCandidates({
      OPENGAME_REASONING_API_KEY: 'sk-mm-aaaa',
      OPENAI_FALLBACK_API_KEY: 'sk-mm-bbbb',
    });
    const fb = candidates.find((c) => c.tier === 'fallback');
    expect(fb?.provider).toBe('minimax');
    expect(fb?.baseUrl).toContain('minimaxi.com');
  });

  it('reads the CLI-facing OPENAI_API_KEYS plural form', () => {
    const candidates = resolveAgentKeyCandidates({
      OPENAI_BASE_URL: 'https://api.minimaxi.com/v1',
      OPENAI_MODEL: 'MiniMax-M2.7',
      OPENAI_API_KEYS: 'sk-a-aaaa,sk-b-bbbb',
    });
    expect(candidates.map((c) => c.keyHint)).toEqual(['aaaa', 'bbbb']);
    expect(candidates[0]!.provider).toBe('minimax');
  });

  it('is empty when no reasoning key is configured', () => {
    expect(resolveAgentKeyCandidates({})).toEqual([]);
  });
});

describe('pickNextAgentKey', () => {
  it('skips keys already used in this job', () => {
    const candidates = resolveAgentKeyCandidates(ENV);
    const used = new Set([candidates[0]!.id]);
    expect(pickNextAgentKey(candidates, used)!.keyHint).toBe('2222');
  });

  it('prefers a key that is not cooling down', () => {
    const candidates = resolveAgentKeyCandidates(ENV);
    recordAgentKeyOutcome(
      candidates[1]!.id,
      'Error: 429 usage limit exceeded',
      {},
    );
    const used = new Set([candidates[0]!.id]);
    expect(pickNextAgentKey(candidates, used)!.keyHint).toBe('3333');
  });

  it('returns null once every key has been used', () => {
    const candidates = resolveAgentKeyCandidates(ENV);
    const used = new Set(candidates.map((c) => c.id));
    expect(pickNextAgentKey(candidates, used)).toBeNull();
  });

  it('skips fallback-tier keys when the job is not allowed to lose money', () => {
    const candidates = resolveAgentKeyCandidates(ENV);
    const used = new Set([candidates[0]!.id, candidates[1]!.id]);
    expect(
      pickNextAgentKey(candidates, used, Date.now(), { allowEmergency: false }),
    ).toBeNull();
    expect(
      pickNextAgentKey(candidates, used, Date.now(), { allowEmergency: true })
        ?.tier,
    ).toBe('fallback');
  });
});

describe('jobAllowsEmergencyModel', () => {
  it('lets paid generate through and blocks cheap society / build jobs', () => {
    expect(jobAllowsEmergencyModel({ jobType: 'generate' })).toBe(true);
    expect(jobAllowsEmergencyModel({ jobType: 'world_generate' })).toBe(true);
    expect(jobAllowsEmergencyModel({ jobType: 'world_society_run' })).toBe(
      false,
    );
    expect(jobAllowsEmergencyModel({ jobType: 'build' })).toBe(false);
    expect(
      jobAllowsEmergencyModel({ jobType: 'world_edit', pointsCharged: 6 }),
    ).toBe(false);
    expect(jobAllowsEmergencyModel({ pointsCharged: 10 })).toBe(true);
    expect(
      jobAllowsEmergencyModel({
        pointsCharged: 6,
        env: { PLATFORM_EMERGENCY_MIN_POINTS: '6' },
      }),
    ).toBe(true);
  });
});

describe('recordAgentKeyOutcome', () => {
  it('only parks a key for quota / arrears output', () => {
    const candidates = resolveAgentKeyCandidates(ENV);
    expect(
      recordAgentKeyOutcome(candidates[0]!.id, 'TS2554: expected 1 argument', {}),
    ).toBe('none');
    expect(
      recordAgentKeyOutcome(candidates[0]!.id, '429 usage limit exceeded', {}),
    ).toBe('quota');
    expect(
      recordAgentKeyOutcome(
        candidates[1]!.id,
        'HTTP 403: overdue balance, 请充值',
        {},
      ),
    ).toBe('billing');
  });

  it('parks auth failures (2049 invalid api key) so the next key can run', () => {
    const candidates = resolveAgentKeyCandidates(ENV);
    expect(
      recordAgentKeyOutcome(
        candidates[0]!.id,
        'MiniMax image status 2049 invalid api key',
        {},
      ),
    ).toBe('auth');
    const trail: AgentKeyAttemptFailure[] = [];
    expect(
      pushAgentKeyFailure(
        trail,
        candidates[0],
        'Chat completion failed: HTTP 401 invalid api key',
        {},
      ),
    ).toBe('auth');
    expect(trail[0]?.kind).toBe('auth');
  });
});

describe('reclaimPrimaryAfterFallbackBilling', () => {
  it('clears MiniMax quota park and returns the primary after fallback billing', () => {
    const candidates = resolveAgentKeyCandidates(ENV);
    const primary = candidates[0]!;
    const fallback = candidates[2]!;
    const used = new Set([primary.id, fallback.id]);
    const trail: AgentKeyAttemptFailure[] = [];

    pushAgentKeyFailure(
      trail,
      primary,
      'Chat completion failed: 429 - usage limit exceeded',
      {},
    );
    pushAgentKeyFailure(
      trail,
      fallback,
      'HTTP 403: overdue balance, account has arrears',
      {},
    );

    const reclaimed = reclaimPrimaryAfterFallbackBilling(
      candidates,
      used,
      trail,
    );
    expect(reclaimed?.id).toBe(primary.id);
    expect(used.has(primary.id)).toBe(false);
    expect(pickNextAgentKey(candidates, used)?.id).toBe(primary.id);
  });

  it('returns null when the last failure is not fallback billing', () => {
    const candidates = resolveAgentKeyCandidates(ENV);
    const used = new Set([candidates[0]!.id]);
    const trail: AgentKeyAttemptFailure[] = [
      {
        id: candidates[0]!.id,
        tier: 'primary',
        provider: 'minimax',
        model: 'MiniMax-M3',
        keyHint: '1111',
        kind: 'quota',
        snippet: '429',
      },
    ];
    expect(
      reclaimPrimaryAfterFallbackBilling(candidates, used, trail),
    ).toBeNull();
  });
});

describe('formatAgentKeyRotationSummary', () => {
  it('lists every attempt instead of only the last error', () => {
    const summary = formatAgentKeyRotationSummary([
      {
        id: 'a',
        tier: 'primary',
        provider: 'minimax',
        model: 'MiniMax-M3',
        keyHint: 'bVM',
        kind: 'quota',
        snippet: '429 usage limit exceeded',
      },
      {
        id: 'b',
        tier: 'fallback',
        provider: 'minimax',
        model: 'MiniMax-M3',
        keyHint: '3333',
        kind: 'billing',
        snippet: '403 overdue balance',
      },
    ]);
    expect(summary).toContain('已试 2 路');
    expect(summary).toContain('主路 minimax');
    expect(summary).toContain('备路 minimax');
    expect(summary).toContain('429');
    expect(summary).toContain('403');
    expect(summary).not.toMatch(/全部失败（主路 \+ 备路）/);
  });
});

describe('agentKeyMaxRotations', () => {
  it('defaults to 2 and honours the override', () => {
    expect(agentKeyMaxRotations({})).toBe(2);
    expect(agentKeyMaxRotations({ PLATFORM_AGENT_KEY_MAX_ROTATIONS: '4' })).toBe(4);
    expect(agentKeyMaxRotations({ PLATFORM_AGENT_KEY_MAX_ROTATIONS: '0' })).toBe(0);
    expect(
      agentKeyMaxRotations({ PLATFORM_AGENT_KEY_MAX_ROTATIONS: 'nope' }),
    ).toBe(2);
  });
});
