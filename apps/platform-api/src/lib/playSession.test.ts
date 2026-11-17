/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  clientFingerprint,
  playMountPath,
  signPlaySession,
  verifyPlaySession,
  type PlaySessionPayload,
} from './playSession.js';

const secret = 'x'.repeat(32);

function payload(overrides: Partial<PlaySessionPayload> = {}): PlaySessionPayload {
  return {
    v: 1,
    gid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    did: '11111111-2222-3333-4444-555555555555',
    dp: 'projects/p1/artifacts/a1/dist',
    fp: clientFingerprint('Mozilla/5.0 (iPhone)'),
    exp: Math.floor(Date.now() / 1000) + 60,
    sid: '99999999-8888-7777-6666-555555555555',
    ...overrides,
  };
}

describe('play session token', () => {
  it('round-trips a signed session', () => {
    const parsed = verifyPlaySession(secret, signPlaySession(secret, payload()));
    expect(parsed?.dp).toBe('projects/p1/artifacts/a1/dist');
    expect(parsed?.gid).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('rejects a token signed with a different secret', () => {
    const token = signPlaySession('y'.repeat(32), payload());
    expect(verifyPlaySession(secret, token)).toBeNull();
  });

  it('rejects an expired session', () => {
    const token = signPlaySession(secret, payload({ exp: Math.floor(Date.now() / 1000) - 1 }));
    expect(verifyPlaySession(secret, token)).toBeNull();
  });

  it('rejects a dist prefix that walks out of its bucket path', () => {
    const token = signPlaySession(secret, payload({ dp: 'projects/p1/../../secrets' }));
    expect(verifyPlaySession(secret, token)).toBeNull();
  });

  it('rejects a tampered body', () => {
    const token = signPlaySession(secret, payload());
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as {
      body: string;
      sig: string;
    };
    decoded.body = decoded.body.replace('artifacts/a1', 'artifacts/a2');
    const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');
    expect(verifyPlaySession(secret, forged)).toBeNull();
  });
});

describe('clientFingerprint', () => {
  it('is stable for the same user agent', () => {
    expect(clientFingerprint('UA/1.0')).toBe(clientFingerprint('UA/1.0'));
  });

  it('separates different user agents', () => {
    expect(clientFingerprint('UA/1.0')).not.toBe(clientFingerprint('UA/2.0'));
  });

  it('treats a missing user agent as its own bucket rather than throwing', () => {
    expect(clientFingerprint(undefined)).toBe(clientFingerprint(null));
  });
});

describe('playMountPath', () => {
  it('escapes the token so it cannot break out of the mount path', () => {
    expect(playMountPath('a/b?c')).toBe('/v1/play/a%2Fb%3Fc');
  });
});
