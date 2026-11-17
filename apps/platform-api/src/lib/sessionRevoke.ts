/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * JWTs last 14 days. Closing an account must stop those tokens without a
 * session table — Redis is the revoke list.
 */

export const SESSION_REVOKE_TTL_SECONDS = 60 * 60 * 24 * 16;

export function sessionRevokeKey(userId: string): string {
  return `auth:revoked:${userId}`;
}

export async function revokeUserSessions(
  redis: { set(key: string, value: string, ...rest: unknown[]): Promise<unknown> },
  userId: string,
): Promise<void> {
  await redis.set(sessionRevokeKey(userId), '1', 'EX', SESSION_REVOKE_TTL_SECONDS);
}

export async function isUserSessionRevoked(
  redis: { get(key: string): Promise<string | null> },
  userId: string,
): Promise<boolean> {
  return (await redis.get(sessionRevokeKey(userId))) === '1';
}
