/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { sign } from 'hono/jwt';
import {
  MAGIC_LINK_TTL_SECONDS,
  buildMagicLinkUrl,
  isEmailish,
  signMagicLinkToken,
  verifyMagicLinkToken,
} from './magicLink.js';
import { handleCandidateFromEmail } from './identity.js';

const SECRET = 'test-secret-that-is-long-enough-for-hs256';

describe('magic link tokens', () => {
  it('round-trips the address and mints a fresh jti each time', async () => {
    const first = await signMagicLinkToken(SECRET, ' Ada@Example.com ');
    const second = await signMagicLinkToken(SECRET, 'ada@example.com');
    const claims = await verifyMagicLinkToken(SECRET, first.token);
    expect(claims.email).toBe('ada@example.com');
    expect(first.expiresInSeconds).toBe(MAGIC_LINK_TTL_SECONDS);
    expect(first.jti).not.toBe(second.jti);
  });

  it('rejects a token signed with another secret', async () => {
    const { token } = await signMagicLinkToken(SECRET, 'ada@example.com');
    await expect(verifyMagicLinkToken('another-secret-of-sufficient-length!!', token))
      .rejects.toThrow();
  });

  it('rejects a session token replayed as a sign-in link', async () => {
    const session = await sign(
      { sub: 'u1', email: 'ada@example.com', organizationId: 'o1', exp: 9999999999 },
      SECRET,
      'HS256',
    );
    await expect(verifyMagicLinkToken(SECRET, session)).rejects.toThrow();
  });

  it('rejects an expired link', async () => {
    const expired = await sign(
      {
        purpose: 'magic-link',
        email: 'ada@example.com',
        jti: 'abc',
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      SECRET,
      'HS256',
    );
    await expect(verifyMagicLinkToken(SECRET, expired)).rejects.toThrow();
  });

  it('builds an absolute link when a web base is configured', () => {
    expect(buildMagicLinkUrl('https://play.example.com/', 'tok en')).toBe(
      'https://play.example.com/login?token=tok%20en',
    );
    expect(buildMagicLinkUrl(undefined, 'abc')).toBe('/login?token=abc');
  });

  it('screens obvious non-addresses before signing anything', () => {
    expect(isEmailish('ada@example.com')).toBe(true);
    expect(isEmailish('ada@example')).toBe(false);
    expect(isEmailish('not an email')).toBe(false);
    expect(isEmailish('')).toBe(false);
  });
});

describe('handle suggestions', () => {
  it('derives a URL-safe handle from the address', () => {
    expect(handleCandidateFromEmail('Ada.Lovelace+games@example.com')).toBe('ada_lovelace');
    expect(handleCandidateFromEmail('a@example.com')).toBeNull();
  });
});
