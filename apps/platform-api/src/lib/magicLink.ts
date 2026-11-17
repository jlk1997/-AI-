/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One-time sign-in links. `/auth/dev-token` handed out a 14-day session to
 * anyone who could type an email address, which is fine on a laptop and wrong
 * anywhere else. A magic link keeps the same "an email is all you need" feel
 * but proves the address once: the link is short-lived, scoped to a purpose,
 * and single-use (the caller burns the jti in Redis before minting a session).
 */

import { sign, verify } from 'hono/jwt';

const PURPOSE = 'magic-link';

/** Long enough to walk to another device, short enough to be forgettable. */
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

export interface MagicLinkClaims {
  readonly email: string;
  /** Single-use id; the verifier must reject a jti it has already seen. */
  readonly jti: string;
  readonly exp: number;
}

export interface MintedMagicLink {
  readonly token: string;
  readonly jti: string;
  readonly expiresInSeconds: number;
}

/**
 * Deliberately loose: we only need to reject obvious garbage before signing,
 * because possession of the link is the real proof.
 */
export function isEmailish(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(trimmed);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function signMagicLinkToken(
  secret: string,
  email: string,
  ttlSeconds: number = MAGIC_LINK_TTL_SECONDS,
): Promise<MintedMagicLink> {
  const jti = crypto.randomUUID();
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = await sign(
    { purpose: PURPOSE, email: normalizeEmail(email), jti, exp },
    secret,
    'HS256',
  );
  return { token, jti, expiresInSeconds: ttlSeconds };
}

/** Throws when the token is forged, expired, or minted for something else. */
export async function verifyMagicLinkToken(
  secret: string,
  token: string,
): Promise<MagicLinkClaims> {
  const decoded = await verify(token, secret, 'HS256');
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    decoded['purpose'] !== PURPOSE ||
    typeof decoded['email'] !== 'string' ||
    typeof decoded['jti'] !== 'string' ||
    typeof decoded['exp'] !== 'number'
  ) {
    throw new Error('Invalid magic link payload');
  }
  return {
    email: normalizeEmail(decoded['email']),
    jti: decoded['jti'],
    exp: decoded['exp'],
  };
}

/**
 * The link a human clicks. Falls back to a relative path so a self-hoster who
 * never set a base URL still gets something copy-pasteable next to the app.
 */
export function buildMagicLinkUrl(webBaseUrl: string | undefined, token: string): string {
  const path = `/login?token=${encodeURIComponent(token)}`;
  if (!webBaseUrl) return path;
  return `${webBaseUrl.replace(/\/+$/, '')}${path}`;
}
