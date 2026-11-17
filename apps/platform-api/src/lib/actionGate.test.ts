/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

import { assertHourlyCap, HOURLY_CAPS } from './actionGate.js';

describe('assertHourlyCap', () => {
  it('blocks after the window fills', async () => {
    let n = 0;
    const redis = {
      incr: vi.fn(async () => {
        n += 1;
        return n;
      }),
      expire: vi.fn(async () => 1),
    };
    expect(await assertHourlyCap(redis as never, 'fork:u1', 2)).toBe(true);
    expect(await assertHourlyCap(redis as never, 'fork:u1', 2)).toBe(true);
    expect(await assertHourlyCap(redis as never, 'fork:u1', 2)).toBe(false);
  });

  it('keeps write-path buckets below a burst', () => {
    expect(HOURLY_CAPS.tip).toBe(20);
    expect(HOURLY_CAPS.jiaxi).toBe(12);
    expect(HOURLY_CAPS.comment).toBe(30);
    expect(HOURLY_CAPS.rating).toBe(20);
    expect(HOURLY_CAPS.playSession).toBe(40);
    expect(HOURLY_CAPS.presence).toBe(180);
    expect(HOURLY_CAPS.report).toBe(12);
  });

  it('fails open for alley chatter when Redis throws', async () => {
    const redis = {
      incr: vi.fn(async () => {
        throw new Error('down');
      }),
    };
    expect(await assertHourlyCap(redis as never, 'fork:u1', 2)).toBe(true);
    expect(await assertHourlyCap(redis as never, 'comment:u1', 2)).toBe(true);
  });

  it('fails closed for tip / jiaxi / play-session when Redis throws', async () => {
    const redis = {
      incr: vi.fn(async () => {
        throw new Error('down');
      }),
    };
    expect(await assertHourlyCap(redis as never, 'tip:u1', 2)).toBe(false);
    expect(await assertHourlyCap(redis as never, 'jiaxi:u1', 2)).toBe(false);
    expect(await assertHourlyCap(redis as never, 'play-session:ip', 2)).toBe(false);
    expect(await assertHourlyCap(redis as never, 'report:u1', 2)).toBe(false);
  });
});
