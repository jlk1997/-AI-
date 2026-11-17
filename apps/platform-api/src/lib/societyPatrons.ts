/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public town lamp: who last bought 镇时, and who spent points on this work.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import { kaiTransfers, users } from '@opengame/platform-db';
import { leaseActive, societyChannel } from '@opengame/platform-shared';

export type TownTimeSku = 'day' | 'week' | 'month';

const CONTRIBUTE_KINDS = ['town_time', 'world_light', 'xiangyi', 'event', 'adopt'] as const;

export type TownContributor = {
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly points: number;
  readonly lastSku: TownTimeSku | null;
};

export type TownLamp = {
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly sku: TownTimeSku;
  readonly townTimeUntil: string;
};

export type SocietyPatronMessage = {
  readonly og: 'patron';
  readonly lamp: TownLamp;
  readonly contributors: readonly TownContributor[];
  readonly watcherCount: number;
};

export type SocietyWorldLightMessage = {
  readonly og: 'world-light';
  readonly displayName: string;
  readonly bonus: number;
  readonly lightUntil: string | null;
  readonly talkBudget?: unknown;
  readonly contributors: readonly TownContributor[];
  readonly watcherCount: number;
};

export type SocietyCoursePulseMessage = {
  readonly og: 'course';
  readonly nodeId: string | null;
  readonly status: string;
  readonly pool: number;
  readonly contested: boolean;
  readonly winningOptionId: string | null;
  readonly voidReason: string | null;
  readonly options: ReadonlyArray<{ readonly id: string; readonly points: number }>;
  readonly canon: string | null;
};

export type SocietyCeremonyMessage =
  | SocietyPatronMessage
  | SocietyWorldLightMessage
  | SocietyCoursePulseMessage;

export function asTownTimeSku(raw: unknown): TownTimeSku | null {
  return raw === 'day' || raw === 'week' || raw === 'month' ? raw : null;
}

export function publicDisplayName(
  displayName: string | null | undefined,
  handle: string | null | undefined,
): string {
  const name = displayName?.trim();
  if (name) return name.slice(0, 24);
  const tag = handle?.trim();
  if (tag) return tag.slice(0, 24);
  return '有人';
}

export async function loadUserPublicName(
  db: DrizzleDb,
  userId: string,
): Promise<string> {
  const [row] = await db
    .select({ displayName: users.displayName, handle: users.handle })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return publicDisplayName(row?.displayName, row?.handle);
}

export async function loadTownContributors(
  db: DrizzleDb,
  gameId: string,
  limit = 8,
): Promise<TownContributor[]> {
  const rows = await db
    .select({
      userId: kaiTransfers.userId,
      points: sql<number>`sum(${kaiTransfers.points})`.mapWith(Number),
    })
    .from(kaiTransfers)
    .where(
      and(
        eq(kaiTransfers.communityGameId, gameId),
        inArray(kaiTransfers.kind, [...CONTRIBUTE_KINDS]),
      ),
    )
    .groupBy(kaiTransfers.userId)
    .orderBy(sql`sum(${kaiTransfers.points}) desc`)
    .limit(limit);

  const ids = rows
    .map((r) => r.userId)
    .filter((id): id is string => typeof id === 'string');
  const people =
    ids.length === 0
      ? []
      : await db
          .select({
            id: users.id,
            displayName: users.displayName,
            handle: users.handle,
            avatarUrl: users.avatarUrl,
          })
          .from(users)
          .where(inArray(users.id, ids));
  const byId = new Map(people.map((p) => [p.id, p]));

  const latestSku = new Map<string, TownTimeSku>();
  if (ids.length) {
    const recent = await db
      .select({
        userId: kaiTransfers.userId,
        meta: kaiTransfers.meta,
      })
      .from(kaiTransfers)
      .where(
        and(
          eq(kaiTransfers.communityGameId, gameId),
          eq(kaiTransfers.kind, 'town_time'),
          inArray(kaiTransfers.userId, ids),
        ),
      )
      .orderBy(desc(kaiTransfers.createdAt))
      .limit(40);
    for (const row of recent) {
      if (!row.userId || latestSku.has(row.userId)) continue;
      const sku = asTownTimeSku((row.meta as { sku?: unknown } | null)?.sku);
      if (sku) latestSku.set(row.userId, sku);
    }
  }

  return rows.map((row) => {
    const person = row.userId ? byId.get(row.userId) : undefined;
    return {
      displayName: publicDisplayName(person?.displayName, person?.handle),
      avatarUrl: person?.avatarUrl ?? null,
      points: Number(row.points ?? 0),
      lastSku: row.userId ? (latestSku.get(row.userId) ?? null) : null,
    };
  });
}

export async function loadTownLamp(
  db: DrizzleDb,
  gameId: string,
  townTimeUntil: Date | string | null | undefined,
  now = Date.now(),
): Promise<TownLamp | null> {
  if (!leaseActive(townTimeUntil, now)) return null;
  const [row] = await db
    .select({
      userId: kaiTransfers.userId,
      meta: kaiTransfers.meta,
      displayName: users.displayName,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
    })
    .from(kaiTransfers)
    .leftJoin(users, eq(users.id, kaiTransfers.userId))
    .where(
      and(eq(kaiTransfers.communityGameId, gameId), eq(kaiTransfers.kind, 'town_time')),
    )
    .orderBy(desc(kaiTransfers.createdAt))
    .limit(1);
  if (!row) return null;
  const sku = asTownTimeSku((row.meta as { sku?: unknown } | null)?.sku) ?? 'day';
  const until =
    townTimeUntil instanceof Date
      ? townTimeUntil.toISOString()
      : String(townTimeUntil);
  return {
    displayName: publicDisplayName(row.displayName, row.handle),
    avatarUrl: row.avatarUrl ?? null,
    sku,
    townTimeUntil: until,
  };
}

export async function loadTownLampsByGames(
  db: DrizzleDb,
  games: ReadonlyArray<{
    readonly gameId: string;
    readonly townTimeUntil: Date | string | null | undefined;
  }>,
  now = Date.now(),
): Promise<Map<string, TownLamp>> {
  const out = new Map<string, TownLamp>();
  const live = games.filter((g) => leaseActive(g.townTimeUntil, now));
  if (!live.length) return out;
  const ids = live.map((g) => g.gameId);
  const untilByGame = new Map(
    live.map((g) => [
      g.gameId,
      g.townTimeUntil instanceof Date
        ? g.townTimeUntil.toISOString()
        : String(g.townTimeUntil),
    ]),
  );
  const recent = await db
    .select({
      gameId: kaiTransfers.communityGameId,
      userId: kaiTransfers.userId,
      meta: kaiTransfers.meta,
    })
    .from(kaiTransfers)
    .where(
      and(inArray(kaiTransfers.communityGameId, ids), eq(kaiTransfers.kind, 'town_time')),
    )
    .orderBy(desc(kaiTransfers.createdAt))
    .limit(Math.min(240, ids.length * 8));
  const latest = new Map<string, (typeof recent)[number]>();
  for (const row of recent) {
    if (!row.gameId || latest.has(row.gameId)) continue;
    latest.set(row.gameId, row);
  }
  const userIds = [...new Set([...latest.values()].map((r) => r.userId).filter(Boolean))] as string[];
  const people =
    userIds.length === 0
      ? []
      : await db
          .select({
            id: users.id,
            displayName: users.displayName,
            handle: users.handle,
            avatarUrl: users.avatarUrl,
          })
          .from(users)
          .where(inArray(users.id, userIds));
  const byId = new Map(people.map((p) => [p.id, p]));
  for (const [gameId, row] of latest) {
    const person = row.userId ? byId.get(row.userId) : undefined;
    out.set(gameId, {
      displayName: publicDisplayName(person?.displayName, person?.handle),
      avatarUrl: person?.avatarUrl ?? null,
      sku: asTownTimeSku((row.meta as { sku?: unknown } | null)?.sku) ?? 'day',
      townTimeUntil: untilByGame.get(gameId) ?? '',
    });
  }
  return out;
}

export async function loadTownCeremony(
  db: DrizzleDb,
  gameId: string,
  townTimeUntil: Date | string | null | undefined,
): Promise<{
  readonly contributors: TownContributor[];
  readonly lamp: TownLamp | null;
}> {
  const [contributors, lamp] = await Promise.all([
    loadTownContributors(db, gameId),
    loadTownLamp(db, gameId, townTimeUntil),
  ]);
  return { contributors, lamp };
}

export function societyPatronPayload(input: {
  readonly lamp: TownLamp;
  readonly contributors: readonly TownContributor[];
  readonly watcherCount: number;
}): SocietyPatronMessage {
  return {
    og: 'patron',
    lamp: input.lamp,
    contributors: input.contributors,
    watcherCount: input.watcherCount,
  };
}

/** Redis society channel carries both sim frames and the 点灯 ceremony. */
export function societyStreamEventName(
  message: string,
): 'society-patron' | 'society-course' | 'society-frame' {
  try {
    const parsed = JSON.parse(message) as { og?: string };
    if (parsed?.og === 'patron' || parsed?.og === 'world-light') {
      return 'society-patron';
    }
    if (parsed?.og === 'course') {
      return 'society-course';
    }
  } catch {
    /* sim frames stay society-frame */
  }
  return 'society-frame';
}

export function societyCoursePulsePayload(input: {
  readonly nodeId: string | null;
  readonly status: string;
  readonly pool: number;
  readonly contested: boolean;
  readonly winningOptionId?: string | null;
  readonly voidReason?: string | null;
  readonly options?: ReadonlyArray<{ readonly id: string; readonly points: number }>;
  readonly canon?: string | null;
}): SocietyCoursePulseMessage {
  return {
    og: 'course',
    nodeId: input.nodeId,
    status: input.status,
    pool: input.pool,
    contested: input.contested,
    winningOptionId: input.winningOptionId ?? null,
    voidReason: input.voidReason ?? null,
    options: input.options ?? [],
    canon: input.canon ?? null,
  };
}

export async function publishSocietyPatron(
  redis: { publish(channel: string, message: string): Promise<unknown> },
  worldId: string,
  payload: SocietyCeremonyMessage,
): Promise<void> {
  await redis.publish(societyChannel(worldId), JSON.stringify(payload));
}
