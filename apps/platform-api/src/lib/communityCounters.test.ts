/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { playHitKeys, playHitRedisKeys, playVisitorKey, requestClientIp } from './communityCounters.js';

describe('playVisitorKey', () => {
  it('prefers a signed-in user over the client IP', () => {
    expect(playVisitorKey('user-1', '1.1.1.1')).toBe('user:user-1');
    expect(playVisitorKey(null, '1.1.1.1')).toBe('ip:1.1.1.1');
    expect(playVisitorKey('  ', '')).toBe('ip:anon');
  });

  it('pairs IP with user so a later login can see the guest hit', () => {
    expect(playHitKeys(null, '1.1.1.1')).toEqual(['ip:1.1.1.1']);
    expect(playHitKeys('user-1', '1.1.1.1')).toEqual(['ip:1.1.1.1', 'user:user-1']);
    expect(playHitRedisKeys('game-9', playHitKeys('user-1', '8.8.8.8'))).toEqual([
      'play:hit:game-9:ip:8.8.8.8',
      'play:hit:game-9:user:user-1',
    ]);
  });

  it('reads the first forwarded hop', () => {
    expect(requestClientIp({ forwarded: ' 8.8.8.8, 1.1.1.1', cf: '9.9.9.9' })).toBe('8.8.8.8');
    expect(requestClientIp({ forwarded: null, cf: '9.9.9.9' })).toBe('9.9.9.9');
  });
});
