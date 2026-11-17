/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  markSidecarUnreachable,
  resetSidecarReachability,
  resolveConsumerFrameNum,
  resolveLingBotMode,
  sidecarRecentlyUnreachable,
} from './lingbot.js';

describe('lingbot consumer helpers', () => {
  afterEach(() => {
    delete process.env['LINGBOT_FRAME_NUM'];
    delete process.env['LINGBOT_PROFILE'];
    delete process.env['LINGBOT_MODE'];
  });

  it('uses LINGBOT_FRAME_NUM over long action-derived counts', () => {
    process.env['LINGBOT_FRAME_NUM'] = '17';
    process.env['LINGBOT_PROFILE'] = 'consumer';
    expect(resolveConsumerFrameNum(30)).toBe(17);
    expect(resolveConsumerFrameNum(30, 33)).toBe(33);
  });

  it('defaults consumer to short odd frame count', () => {
    process.env['LINGBOT_PROFILE'] = 'consumer';
    const n = resolveConsumerFrameNum(5);
    expect(n).toBeGreaterThanOrEqual(17);
    expect(n).toBeLessThanOrEqual(33);
    expect(n % 2).toBe(1);
  });

  it('downgrades real→mock when readyReal is false', () => {
    process.env['LINGBOT_MODE'] = 'real';
    expect(resolveLingBotMode(undefined, false)).toBe('mock');
    expect(resolveLingBotMode('real', false)).toBe('mock');
    expect(resolveLingBotMode('real', true)).toBe('real');
  });
});

describe('sidecar reachability memo', () => {
  afterEach(() => {
    resetSidecarReachability();
  });

  it('remembers a down sidecar so later regions skip the probe', () => {
    const url = 'http://127.0.0.1:8091';
    expect(sidecarRecentlyUnreachable(url)).toBe(false);
    markSidecarUnreachable(url);
    expect(sidecarRecentlyUnreachable(url)).toBe(true);
  });

  it('keeps the verdict per url', () => {
    markSidecarUnreachable('http://a:1');
    expect(sidecarRecentlyUnreachable('http://b:2')).toBe(false);
  });

  it('re-probes after the ttl so a restarted sidecar is picked up', () => {
    const url = 'http://127.0.0.1:8091';
    const t0 = 1_000_000;
    markSidecarUnreachable(url, t0);
    expect(sidecarRecentlyUnreachable(url, t0 + 30_000)).toBe(true);
    expect(sidecarRecentlyUnreachable(url, t0 + 61_000)).toBe(false);
  });
});
