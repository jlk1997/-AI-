/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq, ne, sql, type SQL } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import { communityGames, deployments } from '@opengame/platform-db';

export type CommunityListKind = 'game' | 'world' | undefined;
export type CommunityListSort =
  | 'latest'
  | 'popular'
  | 'rating'
  | 'living'
  | 'prize'
  | 'remixed';

export function parseCommunityListSort(raw: string | undefined): CommunityListSort {
  if (
    raw === 'popular' ||
    raw === 'rating' ||
    raw === 'living' ||
    raw === 'prize' ||
    raw === 'remixed'
  ) {
    return raw;
  }
  return 'latest';
}

export function communityKindWhere(
  kind: CommunityListKind,
  category: string | undefined,
): SQL | undefined {
  if (category) {
    return and(eq(communityGames.isPublic, true), eq(communityGames.category, category));
  }
  if (kind === 'world') {
    return and(eq(communityGames.isPublic, true), eq(communityGames.category, 'world'));
  }
  if (kind === 'game') {
    return and(eq(communityGames.isPublic, true), ne(communityGames.category, 'world'));
  }
  return eq(communityGames.isPublic, true);
}

/**
 * SQL order + limit so the catalog never loads every row into Node.
 * `living` still needs a post-filter of world clocks; we only fetch a window.
 */
export async function listCommunityGamesPage(
  db: DrizzleDb,
  params: {
    readonly kind?: CommunityListKind;
    readonly category?: string;
    readonly sort: CommunityListSort;
    readonly page: number;
    readonly pageSize: number;
  },
) {
  const where = communityKindWhere(params.kind, params.category);
  const offset = (params.page - 1) * params.pageSize;
  const window = params.sort === 'living' ? Math.max(params.pageSize * 8, 80) : params.pageSize;
  const windowOffset = params.sort === 'living' ? 0 : offset;

  const order =
    params.sort === 'remixed'
      ? [desc(communityGames.remixCount), desc(communityGames.publishedAt)]
      : params.sort === 'popular' || params.sort === 'rating'
        ? [desc(communityGames.playCount), desc(communityGames.publishedAt)]
        : params.sort === 'prize'
          ? [
              desc(sql`(${communityGames.challengeId} is not null)`),
              desc(communityGames.playCount),
            ]
          : [desc(communityGames.publishedAt)];

  const rows = await db
    .select()
    .from(communityGames)
    .innerJoin(deployments, eq(communityGames.deploymentId, deployments.id))
    .where(where)
    .orderBy(...order)
    .limit(window)
    .offset(windowOffset);
  return rows.map((row) => ({
    communityGames: row.community_games,
    deployments: row.deployments,
  }));
}
