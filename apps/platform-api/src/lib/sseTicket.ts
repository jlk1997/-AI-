/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomBytes } from 'node:crypto';

import type { Redis } from 'ioredis';

import type { JwtPayload } from './jwt.js';

const PREFIX = 'sse:ticket:';
export const SSE_TICKET_TTL_SECONDS = 300;

export type SseTicketClaims = {
  readonly sub: string;
  readonly email: string;
  readonly organizationId: string;
  readonly phone?: string;
};

function hashTicket(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function sseTicketRedisKey(rawTicket: string): string {
  return `${PREFIX}${hashTicket(rawTicket)}`;
}

export async function mintSseTicket(
  redis: Redis,
  jwt: JwtPayload,
): Promise<{ ticket: string; expiresInSeconds: number }> {
  const ticket = randomBytes(24).toString('base64url');
  const claims: SseTicketClaims = {
    sub: jwt.sub,
    email: jwt.email,
    organizationId: jwt.organizationId,
    ...(jwt.phone ? { phone: jwt.phone } : {}),
  };
  await redis.set(
    sseTicketRedisKey(ticket),
    JSON.stringify(claims),
    'EX',
    SSE_TICKET_TTL_SECONDS,
  );
  return { ticket, expiresInSeconds: SSE_TICKET_TTL_SECONDS };
}

/**
 * Validate without deleting — EventSource reconnects with the same URL.
 */
export async function readSseTicket(
  redis: Redis,
  ticket: string,
): Promise<SseTicketClaims | null> {
  if (!ticket.trim()) return null;
  const raw = await redis.get(sseTicketRedisKey(ticket));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SseTicketClaims;
    if (
      typeof parsed.sub !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.organizationId !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
