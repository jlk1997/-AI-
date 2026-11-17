/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Every successful sign-in leaves a row. A missing table must not lock the
 * door, so a write failure is logged and swallowed.
 */

import { desc, eq } from 'drizzle-orm';

import { authEvents, type DrizzleDb } from '@opengame/platform-db';

export type AuthMethod = 'email_code' | 'phone' | 'wechat' | 'magic';

export async function recordAuthEvent(
  db: DrizzleDb,
  input: {
    readonly userId: string;
    readonly method: AuthMethod;
    readonly ip: string | null;
    readonly userAgent: string | null;
  },
): Promise<void> {
  try {
    await db.insert(authEvents).values({
      userId: input.userId,
      method: input.method,
      ip: input.ip,
      userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
    });
  } catch (err) {
    console.warn('[auth] failed to record sign-in', err);
  }
}

export async function listAuthEvents(
  db: DrizzleDb,
  userId: string,
  limit = 20,
): Promise<
  Array<{
    readonly id: string;
    readonly method: string;
    readonly ip: string | null;
    readonly userAgent: string | null;
    readonly createdAt: string;
  }>
> {
  const rows = await db
    .select({
      id: authEvents.id,
      method: authEvents.method,
      ip: authEvents.ip,
      userAgent: authEvents.userAgent,
      createdAt: authEvents.createdAt,
    })
    .from(authEvents)
    .where(eq(authEvents.userId, userId))
    .orderBy(desc(authEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 50));
  return rows.map((row) => ({
    id: row.id,
    method: row.method,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  }));
}
