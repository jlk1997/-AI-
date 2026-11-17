/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Following people, and the feed that follows from it.
 *
 * Following a town answers "what happened in this place"; following a person
 * answers "what did they make next". Only the second one survives a work being
 * finished, which is why a creator platform needs it before it needs anything
 * else in this file.
 */

import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import type { DrizzleDb } from '@opengame/platform-db';
import {
  communityGames,
  deployments,
  organizationMembers,
  projects,
  userFollowedGames,
  userFollows,
  users,
} from '@opengame/platform-db';

import { publicAuthorOf, type PublicAuthor } from './identity.js';
import { listWorldActivity, type WorldActivityItem } from './worldActivity.js';

export interface FollowCounts {
  readonly followers: number;
  readonly following: number;
  /** Whether the person asking already follows this author. */
  readonly viewerFollows: boolean;
}

export interface FollowedAuthor extends PublicAuthor {
  readonly userId: string;
  readonly followedAt: string;
}

/** Returns false when the row already existed, so callers can stay idempotent. */
export async function followAuthor(
  db: DrizzleDb,
  followerUserId: string,
  followeeUserId: string,
): Promise<boolean> {
  if (followerUserId === followeeUserId) return false;
  const inserted = await db
    .insert(userFollows)
    .values({ followerUserId, followeeUserId })
    .onConflictDoNothing()
    .returning({ createdAt: userFollows.createdAt });
  return inserted.length > 0;
}

export async function unfollowAuthor(
  db: DrizzleDb,
  followerUserId: string,
  followeeUserId: string,
): Promise<void> {
  await db
    .delete(userFollows)
    .where(
      and(
        eq(userFollows.followerUserId, followerUserId),
        eq(userFollows.followeeUserId, followeeUserId),
      ),
    );
}

export async function followCounts(
  db: DrizzleDb,
  userId: string,
  viewerUserId?: string | null,
): Promise<FollowCounts> {
  const [followers] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(userFollows)
    .where(eq(userFollows.followeeUserId, userId));
  const [following] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(userFollows)
    .where(eq(userFollows.followerUserId, userId));

  let viewerFollows = false;
  if (viewerUserId && viewerUserId !== userId) {
    const [row] = await db
      .select({ createdAt: userFollows.createdAt })
      .from(userFollows)
      .where(
        and(
          eq(userFollows.followerUserId, viewerUserId),
          eq(userFollows.followeeUserId, userId),
        ),
      )
      .limit(1);
    viewerFollows = Boolean(row);
  }

  return {
    followers: Number(followers?.value ?? 0),
    following: Number(following?.value ?? 0),
    viewerFollows,
  };
}

/**
 * Both directions of the same edge. `match` is the side that equals the user we
 * are asking about, `join` is the side whose profile we want back.
 */
async function listRelated(
  db: DrizzleDb,
  match: PgColumn,
  join: PgColumn,
  userId: string,
  limit: number,
): Promise<FollowedAuthor[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      handle: users.handle,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
      createdAt: userFollows.createdAt,
    })
    .from(userFollows)
    .innerJoin(users, eq(users.id, join))
    .where(and(eq(match, userId), isNull(users.deletedAt)))
    .orderBy(desc(userFollows.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    ...publicAuthorOf(row),
    userId: row.id,
    followedAt: row.createdAt.toISOString(),
  }));
}

/** People this user follows. */
export function listFollowing(
  db: DrizzleDb,
  userId: string,
  limit = 100,
): Promise<FollowedAuthor[]> {
  return listRelated(
    db,
    userFollows.followerUserId,
    userFollows.followeeUserId,
    userId,
    limit,
  );
}

/** People who follow this user. */
export function listFollowers(
  db: DrizzleDb,
  userId: string,
  limit = 100,
): Promise<FollowedAuthor[]> {
  return listRelated(
    db,
    userFollows.followeeUserId,
    userFollows.followerUserId,
    userId,
    limit,
  );
}

export interface FeedPublishItem {
  readonly kind: 'publish';
  readonly at: string;
  readonly gameId: string;
  readonly slug: string;
  readonly title: string;
  readonly category: string;
  readonly thumbnail: string | null;
  readonly author: PublicAuthor;
}

/**
 * A town beat. `kind` on the activity item is the flavour of the line (talk /
 * whisper / rumor), so the feed's own discriminator has to be a separate field.
 */
export interface FeedWorldItem {
  readonly kind: 'world';
  readonly beat: WorldActivityItem;
  readonly at: string;
}

export type FeedItem = FeedPublishItem | FeedWorldItem;

/** Ids of the works published by a set of authors, via their organizations. */
async function publishedByAuthors(
  db: DrizzleDb,
  authorUserIds: readonly string[],
  limit: number,
): Promise<FeedPublishItem[]> {
  if (authorUserIds.length === 0) return [];
  const rows = await db
    .select({
      gameId: communityGames.id,
      slug: communityGames.slug,
      title: communityGames.title,
      category: communityGames.category,
      thumbnail: communityGames.thumbnail,
      publishedAt: communityGames.publishedAt,
      authorId: users.id,
      email: users.email,
      handle: users.handle,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
    })
    .from(communityGames)
    .innerJoin(deployments, eq(deployments.id, communityGames.deploymentId))
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .innerJoin(
      organizationMembers,
      eq(organizationMembers.organizationId, projects.organizationId),
    )
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(communityGames.isPublic, true),
        isNull(communityGames.takenDownAt),
        eq(organizationMembers.role, 'owner'),
        inArray(organizationMembers.userId, [...authorUserIds]),
      ),
    )
    .orderBy(desc(communityGames.publishedAt))
    .limit(limit);

  return rows.map((row) => ({
    kind: 'publish' as const,
    at: row.publishedAt.toISOString(),
    gameId: row.gameId,
    slug: row.slug,
    title: row.title,
    category: row.category,
    thumbnail: row.thumbnail,
    author: publicAuthorOf({
      id: row.authorId,
      email: row.email,
      handle: row.handle,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      bio: row.bio,
    }),
  }));
}

/**
 * What the people and places you follow have been up to, newest first.
 *
 * Deliberately two kinds and no ranking: a new work from someone you follow,
 * and a beat from a town you watch. Anything cleverer would need engagement
 * data we do not collect and would turn a small community into a slot machine.
 */
export async function listFollowingFeed(
  db: DrizzleDb,
  userId: string,
  limit = 24,
): Promise<FeedItem[]> {
  const capped = Math.max(1, Math.min(50, limit));

  const [followedAuthors, followedTowns] = await Promise.all([
    db
      .select({ userId: userFollows.followeeUserId })
      .from(userFollows)
      .where(eq(userFollows.followerUserId, userId))
      .limit(200),
    db
      .select({ deploymentId: userFollowedGames.deploymentId })
      .from(userFollowedGames)
      .where(eq(userFollowedGames.userId, userId))
      .limit(200),
  ]);

  const [publishes, beats] = await Promise.all([
    publishedByAuthors(
      db,
      followedAuthors.map((r) => r.userId),
      capped,
    ),
    followedTowns.length > 0
      ? listWorldActivity(db, {
          limit: capped,
          deploymentIds: followedTowns.map((r) => r.deploymentId),
        })
      : Promise.resolve([]),
  ]);

  const items: FeedItem[] = [
    ...publishes,
    ...beats.map((beat) => ({ kind: 'world' as const, beat, at: beat.at })),
  ];
  items.sort((a, b) => b.at.localeCompare(a.at));
  return items.slice(0, capped);
}

/**
 * Suggested authors for someone whose feed is empty. Ordered by how much of
 * their work is public rather than by follower count, so a brand-new community
 * still has something to recommend.
 */
export async function suggestedAuthors(
  db: DrizzleDb,
  viewerUserId: string | null,
  limit = 8,
): Promise<Array<FollowedAuthor & { works: number }>> {
  const already = viewerUserId
    ? await db
        .select({ userId: userFollows.followeeUserId })
        .from(userFollows)
        .where(eq(userFollows.followerUserId, viewerUserId))
        .limit(200)
    : [];
  const exclude = new Set(already.map((r) => r.userId));
  if (viewerUserId) exclude.add(viewerUserId);

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      handle: users.handle,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
      works: sql<number>`count(distinct ${communityGames.id})::int`,
    })
    .from(communityGames)
    .innerJoin(deployments, eq(deployments.id, communityGames.deploymentId))
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .innerJoin(
      organizationMembers,
      eq(organizationMembers.organizationId, projects.organizationId),
    )
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(communityGames.isPublic, true),
        isNull(communityGames.takenDownAt),
        eq(organizationMembers.role, 'owner'),
        isNull(users.deletedAt),
        // A profile with no handle has no page to send anyone to.
        ne(users.handle, ''),
      ),
    )
    .groupBy(
      users.id,
      users.email,
      users.handle,
      users.displayName,
      users.avatarUrl,
      users.bio,
    )
    .orderBy(desc(sql`count(distinct ${communityGames.id})`))
    .limit(limit + exclude.size);

  return rows
    .filter((row) => !exclude.has(row.id) && row.handle)
    .slice(0, limit)
    .map((row) => ({
      ...publicAuthorOf(row),
      userId: row.id,
      followedAt: '',
      works: Number(row.works ?? 0),
    }));
}
