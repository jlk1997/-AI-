/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  shouldVoidCourseOnHeartbeat,
  societyHeartbeatWrite,
} from './societyHeartbeatMode.js';

describe('societyHeartbeatWrite', () => {
  const now = Date.parse('2026-08-20T00:00:00.000Z');

  it('watching writes a short presence + author watch, not a 24h permit', () => {
    const patch = societyHeartbeatWrite('watching', 12 * 60_000, now);
    expect(patch.clockPaused).toBeUndefined();
    expect(patch.heartbeatEnabled).toBe(true);
    expect(patch.heartbeatUntil?.toISOString()).toBe('2026-08-20T00:12:00.000Z');
    expect(patch.authorWatchUntil?.toISOString()).toBe(
      '2026-08-20T00:04:00.000Z',
    );
    expect(patch.lastHeartbeatAt?.toISOString()).toBe(
      '2026-08-20T00:00:00.000Z',
    );
  });

  it('watching only unpauses when the author explicitly resumes', () => {
    expect(
      societyHeartbeatWrite('watching', 12 * 60_000, now, { resumeClock: true })
        .clockPaused,
    ).toBe(false);
  });

  it('off freezes the shared clock and clears both leases', () => {
    expect(societyHeartbeatWrite('off', 12 * 60_000, now)).toEqual({
      heartbeatEnabled: false,
      heartbeatUntil: null,
      authorWatchUntil: null,
      clockPaused: true,
    });
  });

  it('leave drops author presence immediately so an empty page cannot talk', () => {
    // 当 keepPresence=false（没有别的 watcher）时，整列 heartbeatEnabled 设为 false，
    // 避免前端 / UI 误以为还有观察者。也避免任何只看该字段的下游误判。
    const patch = societyHeartbeatWrite('leave', 12 * 60_000, now);
    expect(patch).toEqual({
      heartbeatEnabled: false,
      heartbeatUntil: null,
      authorWatchUntil: null,
    });
    expect(patch).not.toHaveProperty('clockPaused');
  });

  it('leave keeps the shared heartbeat when guests are still watching', () => {
    // keepPresence=true 表示仍有 guest 围观，所以 enabled 保留。
    const patch = societyHeartbeatWrite('leave', 12 * 60_000, now, {
      keepPresence: true,
    });
    expect(patch).toEqual({
      heartbeatEnabled: true,
      authorWatchUntil: null,
    });
    expect(patch).not.toHaveProperty('heartbeatUntil');
    expect(patch).not.toHaveProperty('clockPaused');
  });

  it('leave of a paused town keeps the freeze even if guests remain', () => {
    expect(
      societyHeartbeatWrite('leave', 12 * 60_000, now, {
        keepPresence: true,
        keepPaused: true,
      }),
    ).toEqual({
      heartbeatEnabled: true,
      authorWatchUntil: null,
      clockPaused: true,
    });
  });

  it('always still writes no until, so the worker will not scan it', () => {
    const patch = societyHeartbeatWrite('always', 12 * 60_000, now);
    expect(patch.heartbeatUntil).toBeNull();
    expect(patch.authorWatchUntil).toBeUndefined();
    expect(patch.clockPaused).toBe(false);
  });

  it('only voids the board when the author pauses the clock', () => {
    expect(shouldVoidCourseOnHeartbeat('off')).toBe(true);
    expect(shouldVoidCourseOnHeartbeat('watching')).toBe(false);
    expect(shouldVoidCourseOnHeartbeat('leave')).toBe(false);
    expect(shouldVoidCourseOnHeartbeat('always')).toBe(false);
  });
});
