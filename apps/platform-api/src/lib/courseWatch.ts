/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 *「观望」订阅：不要求先压盘，开压/封盘/结果时 Web Push 回访。
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';

import type { DrizzleDb } from '@opengame/platform-db';
import {
  communityGames,
  courseGameWatches,
  coursePushSubscriptions,
  userFollowedGames,
  worldCourseNodes,
  worldCourseStakes,
} from '@opengame/platform-db';

import type { CoursePushPayload } from './coursePush.js';
import {
  courseReturnHintsForCommunityGames,
  type CourseReturnHint,
} from './courseBoard.js';

function vapidConfig(): {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
} | null {
  const publicKey = process.env['PLATFORM_COURSE_PUSH_VAPID_PUBLIC_KEY']?.trim();
  const privateKey = process.env['PLATFORM_COURSE_PUSH_VAPID_PRIVATE_KEY']?.trim();
  const subject =
    process.env['PLATFORM_COURSE_PUSH_VAPID_SUBJECT']?.trim()
    ?? 'mailto:course@opengame.local';
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

let vapidReady = false;

function ensureVapid(): boolean {
  const cfg = vapidConfig();
  if (!cfg) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    vapidReady = true;
  }
  return true;
}

async function sendPush(
  sub: typeof coursePushSubscriptions.$inferSelect,
  payload: CoursePushPayload,
): Promise<'sent' | 'gone' | 'skipped'> {
  if (!ensureVapid()) return 'skipped';
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
    );
    return 'sent';
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) return 'gone';
    return 'skipped';
  }
}

export async function upsertCourseGameWatch(
  db: DrizzleDb,
  userId: string,
  gameId: string,
): Promise<void> {
  const trimmed = gameId.trim();
  if (!trimmed) return;
  await db
    .insert(courseGameWatches)
    .values({ userId, gameId: trimmed })
    .onConflictDoNothing();
}

export async function removeCourseGameWatch(
  db: DrizzleDb,
  userId: string,
  gameId: string,
): Promise<void> {
  const trimmed = gameId.trim();
  if (!trimmed) return;
  await db
    .delete(courseGameWatches)
    .where(
      and(
        eq(courseGameWatches.userId, userId),
        eq(courseGameWatches.gameId, trimmed),
      ),
    );
}

export type MyCourseWatchRow = {
  readonly gameId: string;
  readonly slug: string;
  readonly title: string;
  readonly course: CourseReturnHint | null;
};

/** Towns the signed-in user subscribed to via「有盘时提醒我」. */
export async function loadMyCourseWatches(
  db: DrizzleDb,
  userId: string,
  locale: 'zh-CN' | 'en' = 'zh-CN',
): Promise<MyCourseWatchRow[]> {
  const rows = await db
    .select({
      gameId: courseGameWatches.gameId,
      slug: communityGames.slug,
      title: communityGames.title,
    })
    .from(courseGameWatches)
    .innerJoin(communityGames, eq(courseGameWatches.gameId, communityGames.id))
    .where(eq(courseGameWatches.userId, userId))
    .orderBy(desc(courseGameWatches.createdAt));
  if (rows.length === 0) return [];
  const gameIds = rows.map((row) => row.gameId);
  const hints = await courseReturnHintsForCommunityGames(db, gameIds, locale);
  return rows.map((row) => ({
    gameId: row.gameId,
    slug: row.slug || row.gameId,
    title: row.title || row.slug || 'Town',
    course: hints.get(row.gameId) ?? null,
  }));
}

export async function isCourseGameWatched(
  db: DrizzleDb,
  userId: string | null | undefined,
  gameId: string | null | undefined,
): Promise<boolean> {
  if (!userId || !gameId) return false;
  const [row] = await db
    .select({ id: courseGameWatches.id })
    .from(courseGameWatches)
    .where(
      and(
        eq(courseGameWatches.userId, userId),
        eq(courseGameWatches.gameId, gameId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export function courseWatchBodyForOpen(prompt?: string | null): string {
  const trimmed = prompt?.trim();
  return trimmed ? `今夜开压了 · ${trimmed}` : '这座镇今夜开压了';
}

export function courseFollowOpenBody(prompt?: string | null): string {
  const trimmed = prompt?.trim();
  return trimmed ? `你关注的镇今夜开压 · ${trimmed}` : '你关注的镇今夜开压了';
}

export function courseWatchBodyForClosed(): string {
  return '已封盘，去看一眼这盘';
}

export function courseWatchBodyForSettled(input: {
  readonly canon?: string | null;
  readonly prompt?: string | null;
}): string {
  const canon = input.canon?.trim();
  if (canon) return `结果出来了 · ${canon}`;
  const prompt = input.prompt?.trim();
  return prompt ? `结果出来了 · ${prompt}` : '走向盘结果出来了';
}

/** Mobile-first deep link for watch Web Push (also works on desktop /play). */
export function courseWatchPushPath(slug: string): string {
  return `/play/${encodeURIComponent(slug)}?course=1&watch=1`;
}

/** Follower open-board push — lands on the board with follow coach semantics. */
export function courseFollowOpenPushPath(slug: string): string {
  return `/play/${encodeURIComponent(slug)}?course=1&follow=1`;
}

async function resolveCoursePushTarget(
  db: DrizzleDb,
  gameId: string,
  pathForSlug: (slug: string) => string,
  webBaseUrl?: string | null,
): Promise<{ title: string; url: string }> {
  let slug = gameId;
  let title = 'OpenGame';
  const [game] = await db
    .select({ slug: communityGames.slug, title: communityGames.title })
    .from(communityGames)
    .where(eq(communityGames.id, gameId))
    .limit(1);
  if (game) {
    slug = game.slug || gameId;
    title = game.title;
  }
  const origin = (webBaseUrl ?? '').replace(/\/$/, '');
  const path = pathForSlug(slug);
  const url = origin ? `${origin}${path}` : path;
  return { title, url };
}

async function notifyCoursePushToUsers(
  db: DrizzleDb,
  input: {
    readonly gameId: string;
    readonly nodeId: string;
    readonly userIds: readonly string[];
    readonly body: string;
    readonly tag: string;
    readonly webBaseUrl?: string | null;
    readonly logKind: string;
    readonly pathForSlug?: (slug: string) => string;
  },
): Promise<void> {
  if (input.userIds.length === 0 || !ensureVapid()) return;

  const subs = await db
    .select()
    .from(coursePushSubscriptions)
    .where(inArray(coursePushSubscriptions.userId, [...input.userIds]));
  if (subs.length === 0) return;

  const pathForSlug = input.pathForSlug ?? courseWatchPushPath;
  const { title, url } = await resolveCoursePushTarget(
    db,
    input.gameId,
    pathForSlug,
    input.webBaseUrl,
  );

  const gone: string[] = [];
  for (const sub of subs) {
    const result = await sendPush(sub, {
      title,
      body: input.body,
      url,
      tag: input.tag,
    });
    if (result === 'gone') gone.push(sub.id);
  }
  if (gone.length > 0) {
    await db
      .delete(coursePushSubscriptions)
      .where(inArray(coursePushSubscriptions.id, gone));
  }
  console.log(
    '[course-watch]',
    JSON.stringify({
      kind: input.logKind,
      gameId: input.gameId,
      nodeId: input.nodeId,
      recipients: input.userIds.length,
      subscribers: subs.length,
    }),
  );
}

/** Notify followers (with Web Push) when a subscribed town opens a new board. */
export async function notifyCourseFollowOpenPush(
  db: DrizzleDb,
  input: {
    readonly gameId: string;
    readonly nodeId: string;
    readonly prompt?: string | null;
    readonly excludeUserIds?: readonly string[];
    readonly webBaseUrl?: string | null;
  },
): Promise<void> {
  if (!ensureVapid()) return;

  const [game] = await db
    .select({ deploymentId: communityGames.deploymentId })
    .from(communityGames)
    .where(eq(communityGames.id, input.gameId))
    .limit(1);
  if (!game) return;

  const [followers, watchers, activeStakers] = await Promise.all([
    db
      .select({ userId: userFollowedGames.userId })
      .from(userFollowedGames)
      .where(eq(userFollowedGames.deploymentId, game.deploymentId)),
    db
      .select({ userId: courseGameWatches.userId })
      .from(courseGameWatches)
      .where(eq(courseGameWatches.gameId, input.gameId)),
    db
      .select({ userId: worldCourseStakes.userId })
      .from(worldCourseStakes)
      .innerJoin(worldCourseNodes, eq(worldCourseStakes.nodeId, worldCourseNodes.id))
      .where(
        and(
          eq(worldCourseNodes.communityGameId, input.gameId),
          inArray(worldCourseNodes.status, ['open', 'closed']),
        ),
      ),
  ]);

  const exclude = new Set([
    ...(input.excludeUserIds ?? []),
    ...watchers.map((row) => row.userId),
    ...activeStakers
      .map((row) => row.userId)
      .filter((id): id is string => Boolean(id)),
  ]);
  const userIds = [
    ...new Set(
      followers
        .map((row) => row.userId)
        .filter((id) => id && !exclude.has(id)),
    ),
  ];
  if (userIds.length === 0) return;

  await notifyCoursePushToUsers(db, {
    gameId: input.gameId,
    nodeId: input.nodeId,
    userIds,
    body: courseFollowOpenBody(input.prompt),
    tag: `course-follow-open:${input.nodeId}`,
    webBaseUrl: input.webBaseUrl,
    logKind: 'follow-open',
    pathForSlug: courseFollowOpenPushPath,
  });
}

/** Notify watchers (with Web Push) for open / close / settle milestones. */
export async function notifyCourseWatchPush(
  db: DrizzleDb,
  input: {
    readonly gameId: string | null;
    readonly nodeId: string;
    readonly kind: 'open' | 'closed' | 'settled';
    readonly prompt?: string | null;
    readonly canon?: string | null;
    readonly excludeUserIds?: readonly string[];
    readonly webBaseUrl?: string | null;
  },
): Promise<void> {
  if (!input.gameId || !ensureVapid()) return;
  const watchers = await db
    .select({ userId: courseGameWatches.userId })
    .from(courseGameWatches)
    .where(eq(courseGameWatches.gameId, input.gameId));
  const exclude = new Set(input.excludeUserIds ?? []);
  const userIds = [
    ...new Set(
      watchers
        .map((row) => row.userId)
        .filter((id) => id && !exclude.has(id)),
    ),
  ];
  if (userIds.length === 0) return;

  const body =
    input.kind === 'open'
      ? courseWatchBodyForOpen(input.prompt)
      : input.kind === 'closed'
        ? courseWatchBodyForClosed()
        : courseWatchBodyForSettled({
            canon: input.canon,
            prompt: input.prompt,
          });

  await notifyCoursePushToUsers(db, {
    gameId: input.gameId,
    nodeId: input.nodeId,
    userIds,
    body,
    tag: `course-watch:${input.kind}:${input.nodeId}`,
    webBaseUrl: input.webBaseUrl,
    logKind: input.kind,
  });
}
