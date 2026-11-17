/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The shareable "今晚巷口榜": hottest plays, most remixed, towns still living.
 * Hottest / remixed are China-day heat. Living is still the social clock.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import { communityDayStats, communityGames, deployments } from '@opengame/platform-db';

import { chinaDayKey } from './kaiMarket.js';
import { communityKindWhere, listCommunityGamesPage } from './communityList.js';
import { worldStatusByDeployment } from './identity.js';
import { townCatalogHeat } from '@opengame/platform-shared';
import type { SocietyWatchersRedis } from './societyWatchers.js';
import type { TownLamp } from './societyPatrons.js';
import { listAlleyCourseBoards } from './courseBoard.js';

export type AlleyCard = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly thumbnail: string | null;
  readonly category: string;
  readonly playCount: number;
  readonly remixCount: number;
  readonly publishedAt: Date | string;
  readonly watcherCount?: number;
  readonly lamp?: TownLamp | null;
  readonly living?: boolean;
  readonly speaking?: boolean;
  readonly clockPaused?: boolean;
};

export type AlleyCourseCard = AlleyCard & {
  readonly prompt: string;
  readonly pool: number;
  readonly status: string;
};

export type AlleyBoard = {
  readonly chinaDay: string;
  readonly hottest: AlleyCard[];
  readonly remixed: AlleyCard[];
  readonly living: AlleyCard[];
  readonly boards: AlleyCourseCard[];
};

function toLifetimeCard(row: {
  communityGames: {
    id: string;
    slug: string;
    title: string;
    thumbnail: string | null;
    category: string;
    playCount: number;
    remixCount: number | null;
    publishedAt: Date;
  };
}): AlleyCard {
  const g = row.communityGames;
  return {
    id: g.id,
    slug: g.slug,
    title: g.title,
    thumbnail: g.thumbnail,
    category: g.category,
    playCount: g.playCount ?? 0,
    remixCount: g.remixCount ?? 0,
    publishedAt: g.publishedAt,
  };
}

async function listTonightLane(
  db: DrizzleDb,
  metric: 'plays' | 'remixes',
): Promise<AlleyCard[]> {
  const day = chinaDayKey();
  const metricCol = metric === 'plays' ? communityDayStats.plays : communityDayStats.remixes;
  const rows = await db
    .select({
      game: communityGames,
      plays: communityDayStats.plays,
      remixes: communityDayStats.remixes,
    })
    .from(communityGames)
    .innerJoin(deployments, eq(communityGames.deploymentId, deployments.id))
    .innerJoin(
      communityDayStats,
      and(
        eq(communityDayStats.gameId, communityGames.id),
        eq(communityDayStats.chinaDay, day),
      ),
    )
    .where(and(communityKindWhere('game', undefined), sql`${metricCol} > 0`))
    .orderBy(desc(metricCol), desc(communityGames.publishedAt))
    .limit(6);
  return rows.map((row) => ({
    id: row.game.id,
    slug: row.game.slug,
    title: row.game.title,
    thumbnail: row.game.thumbnail,
    category: row.game.category,
    playCount: row.plays,
    remixCount: row.remixes,
    publishedAt: row.game.publishedAt,
  }));
}

export async function loadAlleyBoard(
  db: DrizzleDb,
  redis?: SocietyWatchersRedis | null,
): Promise<AlleyBoard> {
  const [hottest, remixed, livingRows, boards] = await Promise.all([
    listTonightLane(db, 'plays'),
    listTonightLane(db, 'remixes'),
    listCommunityGamesPage(db, { kind: 'world', sort: 'living', page: 1, pageSize: 6 }),
    listAlleyCourseBoards(db).catch((): AlleyCourseCard[] => []),
  ]);
  const livingStatuses = await worldStatusByDeployment(
    db,
    livingRows.map((row) => row.communityGames.deploymentId),
    redis,
  );
  const living = [...livingRows].sort((a, b) => {
    const sa = livingStatuses.get(a.communityGames.deploymentId);
    const sb = livingStatuses.get(b.communityGames.deploymentId);
    const heat = townCatalogHeat(sb) - townCatalogHeat(sa);
    if (heat !== 0) return heat;
    const watch = (sb?.watcherCount ?? 0) - (sa?.watcherCount ?? 0);
    if (watch !== 0) return watch;
    const tb = sb?.lastAdvancedAt ?? '';
    const ta = sa?.lastAdvancedAt ?? '';
    return tb.localeCompare(ta);
  });
  return {
    chinaDay: chinaDayKey(),
    hottest,
    remixed,
    boards,
    living: living.map((row) => {
      const status = livingStatuses.get(row.communityGames.deploymentId);
      return {
        ...toLifetimeCard(row),
        watcherCount: status?.watcherCount ?? 0,
        lamp: status?.lamp ?? null,
        living: status?.living,
        speaking: status?.speaking,
        clockPaused: status?.clockPaused,
      };
    }),
  };
}
