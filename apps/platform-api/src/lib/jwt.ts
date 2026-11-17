/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { sign, verify } from 'hono/jwt';

export type JwtPayload = {
  readonly sub: string;
  readonly email: string;
  readonly organizationId: string;
  readonly exp: number;
  /** Present for phone-only accounts so admin allowlists can match a number. */
  readonly phone?: string;
};

export async function signSessionJwt(
  secret: string,
  payload: Omit<JwtPayload, 'exp'>,
  ttlSeconds: number,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const full: JwtPayload = { ...payload, exp };
  return sign(full, secret, 'HS256');
}

export async function verifySessionJwt(
  secret: string,
  token: string,
): Promise<JwtPayload> {
  const decoded = await verify(token, secret, 'HS256');
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    typeof decoded['sub'] !== 'string' ||
    typeof decoded['email'] !== 'string' ||
    typeof decoded['organizationId'] !== 'string' ||
    typeof decoded['exp'] !== 'number'
  ) {
    throw new Error('Invalid token payload');
  }
  const phone = decoded['phone'];
  return {
    sub: decoded['sub'],
    email: decoded['email'],
    organizationId: decoded['organizationId'],
    exp: decoded['exp'],
    ...(typeof phone === 'string' && phone.length > 0 ? { phone } : {}),
  };
}

/** Public GETs may show "your stake" without failing closed on a bad header. */
export async function peekOptionalJwt(
  secret: string,
  authorization: string | undefined,
): Promise<JwtPayload | null> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;
  try {
    return await verifySessionJwt(secret, token);
  } catch {
    return null;
  }
}
