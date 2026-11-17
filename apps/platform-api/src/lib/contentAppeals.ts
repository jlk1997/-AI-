/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { desc, eq } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import { communityGames, contentAppeals } from '@opengame/platform-db';

import { listMyWorks } from './identity.js';

export async function fileContentAppeal(
  db: DrizzleDb,
  input: {
    readonly userId: string;
    readonly communityGameId: string;
    readonly message: string;
  },
): Promise<{ readonly id: string } | { readonly error: 'not-found' | 'not-author' }> {
  const [game] = await db
    .select({
      id: communityGames.id,
      slug: communityGames.slug,
    })
    .from(communityGames)
    .where(eq(communityGames.id, input.communityGameId))
    .limit(1);
  if (!game) return { error: 'not-found' };
  const mine = await listMyWorks(db, input.userId);
  const owned = [...mine.games, ...mine.worlds].some((w) => w.slug === game.slug);
  if (!owned) return { error: 'not-author' };
  const [row] = await db
    .insert(contentAppeals)
    .values({
      communityGameId: input.communityGameId,
      authorUserId: input.userId,
      message: input.message.slice(0, 2000),
    })
    .returning({ id: contentAppeals.id });
  if (!row) return { error: 'not-found' };
  return { id: row.id };
}

export async function listAuthorAppeals(db: DrizzleDb, userId: string) {
  return db
    .select()
    .from(contentAppeals)
    .where(eq(contentAppeals.authorUserId, userId))
    .orderBy(desc(contentAppeals.createdAt))
    .limit(40);
}
