/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyGateTierEnv,
  BASELINE_TIER,
  gateTiersEqual,
  readGateEscalationMode,
  resolveGateTierForAttempt,
  resolveTargetGateTier,
  restoreGateTierEnv,
} from './gateEscalation.js';

const KEYS = [
  'PLATFORM_GATE_ESCALATION',
  'PLATFORM_GAME_QUALITY_MODE',
  'PLATFORM_GAME_QA_MODE',
  'PLATFORM_QUALITY_BEYOND_BASELINE',
  'PLATFORM_SMOKE_REQUIRE_PROGRESS',
  'PLATFORM_REQUIRE_REAL_ASSETS',
  'PLATFORM_ALLOW_PLACEHOLDER_ASSETS',
] as const;

describe('gateEscalation', () => {
  let saved: Map<string, string | undefined>;

  beforeEach(() => {
    saved = new Map();
    for (const k of KEYS) {
      saved.set(k, process.env[k]);
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      const v = saved.get(k);
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('defaults to progressive escalation', () => {
    expect(readGateEscalationMode()).toBe('progressive');
    process.env['PLATFORM_GATE_ESCALATION'] = 'strict-first';
    expect(readGateEscalationMode()).toBe('strict-first');
  });

  it('reads target tier from strict/beyond env', () => {
    process.env['PLATFORM_GAME_QUALITY_MODE'] = 'strict';
    const tier = resolveTargetGateTier();
    expect(tier.id).toBe('quality');
    expect(tier.qaMode).toBe('strict');
    expect(tier.beyondBaseline).toBe(true);
    expect(tier.requireProgress).toBe(true);
  });

  it('collapses to baseline tier when nothing strict is configured', () => {
    expect(gateTiersEqual(resolveTargetGateTier(), BASELINE_TIER)).toBe(true);
  });

  it('stays on baseline until a playable build shipped, then escalates', () => {
    process.env['PLATFORM_GAME_QUALITY_MODE'] = 'strict';
    const target = resolveTargetGateTier();
    const first = resolveGateTierForAttempt({
      mode: 'progressive',
      target,
      deliveredPlayable: false,
    });
    expect(first.id).toBe('baseline');
    const second = resolveGateTierForAttempt({
      mode: 'progressive',
      target,
      deliveredPlayable: true,
    });
    expect(second.id).toBe('quality');
  });

  it('strict-first mode never downgrades', () => {
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] = 'true';
    const target = resolveTargetGateTier();
    expect(
      resolveGateTierForAttempt({
        mode: 'strict-first',
        target,
        deliveredPlayable: false,
      }).id,
    ).toBe('quality');
  });

  it('baseline tier relaxes gates but keeps real-asset policy pinned', () => {
    process.env['PLATFORM_GAME_QUALITY_MODE'] = 'strict';
    const snapshot = applyGateTierEnv(BASELINE_TIER);
    try {
      expect(process.env['PLATFORM_GAME_QUALITY_MODE']).toBe('relaxed');
      expect(process.env['PLATFORM_QUALITY_BEYOND_BASELINE']).toBe('false');
      expect(process.env['PLATFORM_SMOKE_REQUIRE_PROGRESS']).toBe('false');
      // strict implied real assets — must survive the downgrade
      expect(process.env['PLATFORM_REQUIRE_REAL_ASSETS']).toBe('true');
    } finally {
      restoreGateTierEnv(snapshot);
    }
    expect(process.env['PLATFORM_GAME_QUALITY_MODE']).toBe('strict');
    expect(process.env['PLATFORM_REQUIRE_REAL_ASSETS']).toBeUndefined();
  });

  it('does not pin real assets when placeholders are explicitly allowed', () => {
    process.env['PLATFORM_ALLOW_PLACEHOLDER_ASSETS'] = 'true';
    const snapshot = applyGateTierEnv(BASELINE_TIER);
    try {
      expect(process.env['PLATFORM_REQUIRE_REAL_ASSETS']).toBeUndefined();
    } finally {
      restoreGateTierEnv(snapshot);
    }
  });
});
