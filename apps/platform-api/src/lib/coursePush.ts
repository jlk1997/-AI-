/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Optional Web Push for course settle / close. Requires VAPID keys in env.
 */

import { and, eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';

import type { DrizzleDb } from '@opengame/platform-db';
import {
  communityGames,
  coursePushSubscriptions,
  worldCourseNodes,
  worldCourseStakes,
} from '@opengame/platform-db';

export type CoursePushSubscriptionBody = {
  readonly endpoint: string;
  readonly keys: {
    readonly p256dh: string;
    readonly auth: string;
  };
};

export type CoursePushPayload = {
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly tag?: string;
};

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

export function coursePushPublicKey(): string | null {
  return vapidConfig()?.publicKey ?? null;
}

export async function upsertCoursePushSubscription(
  db: DrizzleDb,
  userId: string,
  body: CoursePushSubscriptionBody,
): Promise<void> {
  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh?.trim();
  const auth = body.keys?.auth?.trim();
  if (!endpoint || !p256dh || !auth) return;
  await db
    .insert(coursePushSubscriptions)
    .values({
      userId,
      endpoint,
      p256dh,
      auth,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [coursePushSubscriptions.userId, coursePushSubscriptions.endpoint],
      set: {
        p256dh,
        auth,
        updatedAt: new Date(),
      },
    });
}

export async function removeCoursePushSubscription(
  db: DrizzleDb,
  userId: string,
  endpoint: string,
): Promise<void> {
  const trimmed = endpoint.trim();
  if (!trimmed) return;
  await db
    .delete(coursePushSubscriptions)
    .where(
      and(
        eq(coursePushSubscriptions.userId, userId),
        eq(coursePushSubscriptions.endpoint, trimmed),
      ),
    );
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

export async function notifyCourseSettlePush(
  db: DrizzleDb,
  input: {
    readonly nodeId: string;
    readonly gameId: string | null;
    readonly voided: boolean;
    readonly voidReason: string | null;
    readonly winningOptionId: string | null;
    readonly canon: string | null;
    readonly payouts: ReadonlyArray<{
      readonly organizationId: string;
      readonly kind: string;
      readonly points: number;
    }>;
    readonly stakes: ReadonlyArray<{
      readonly organizationId: string;
      readonly userId: string | null;
      readonly optionId: string;
    }>;
    readonly webBaseUrl?: string | null;
  },
): Promise<void> {
  if (!ensureVapid()) return;
  const userIds = [
    ...new Set(
      input.stakes
        .map((row) => row.userId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (userIds.length === 0) return;

  const subs = await db
    .select()
    .from(coursePushSubscriptions)
    .where(inArray(coursePushSubscriptions.userId, userIds));
  if (subs.length === 0) return;

  let slug = input.gameId ?? '';
  let title = 'OpenGame';
  if (input.gameId) {
    const [game] = await db
      .select({ slug: communityGames.slug, title: communityGames.title })
      .from(communityGames)
      .where(eq(communityGames.id, input.gameId))
      .limit(1);
    if (game) {
      slug = game.slug || input.gameId;
      title = game.title;
    }
  }
  const origin = (input.webBaseUrl ?? '').replace(/\/$/, '');
  const path = `/community/game/${encodeURIComponent(slug)}?course=1`;
  const url = origin ? `${origin}${path}` : path;

  const payoutByOrg = new Map(
    input.payouts.map((row) => [row.organizationId, row] as const),
  );
  const stakeByUser = new Map<string, (typeof input.stakes)[number]>();
  for (const row of input.stakes) {
    if (row.userId) stakeByUser.set(row.userId, row);
  }

  const gone: string[] = [];
  for (const sub of subs) {
    const stake = stakeByUser.get(sub.userId);
    const payout = stake
      ? payoutByOrg.get(stake.organizationId)
      : undefined;
    const body = coursePushBodyForStake({
      voided: input.voided,
      voidReason: input.voidReason,
      canon: input.canon,
      payoutKind: payout?.kind,
      won:
        !input.voided
        && Boolean(input.winningOptionId)
        && stake?.optionId === input.winningOptionId,
    });
    const result = await sendPush(sub, {
      title,
      body,
      url,
      tag: `course-settle:${input.nodeId}`,
    });
    if (result === 'gone') gone.push(sub.id);
  }
  if (gone.length > 0) {
    await db
      .delete(coursePushSubscriptions)
      .where(inArray(coursePushSubscriptions.id, gone));
  }
  console.log(
    '[course-push]',
    JSON.stringify({
      nodeId: input.nodeId,
      gameId: input.gameId,
      subscribers: subs.length,
      voided: input.voided,
    }),
  );
}

export function coursePushBodyForStake(input: {
  readonly voided: boolean;
  readonly voidReason: string | null;
  readonly canon: string | null;
  readonly payoutKind?: string;
  readonly won: boolean;
}): string {
  if (input.voided) {
    return input.voidReason === 'uncontested'
      ? '这盘退了：只有一边有仓'
      : '走向盘已退点';
  }
  if (input.won) {
    return input.canon?.trim() ? `你这边赢了 · ${input.canon.trim()}` : '你这边赢了';
  }
  if (input.payoutKind === 'course_void') return '走向盘已退点';
  return input.canon?.trim() ? `结算了 · ${input.canon.trim()}` : '走向盘已结算';
}

export function coursePushBodyForClosed(): string {
  return '已封盘，去吹风帮自己这边';
}

export function coursePushBodyForContested(prompt?: string | null): string {
  const trimmed = prompt?.trim();
  return trimmed ? `成盘了 · ${trimmed}` : '你的走向盘成盘了';
}

async function resolveCoursePushTarget(
  db: DrizzleDb,
  gameId: string | null,
  webBaseUrl?: string | null,
): Promise<{ title: string; url: string }> {
  let slug = gameId ?? '';
  let title = 'OpenGame';
  if (gameId) {
    const [game] = await db
      .select({ slug: communityGames.slug, title: communityGames.title })
      .from(communityGames)
      .where(eq(communityGames.id, gameId))
      .limit(1);
    if (game) {
      slug = game.slug || gameId;
      title = game.title;
    }
  }
  const origin = (webBaseUrl ?? '').replace(/\/$/, '');
  const path = `/community/game/${encodeURIComponent(slug)}?course=1`;
  const url = origin ? `${origin}${path}` : path;
  return { title, url };
}

/** Notify stakers that Act 1 closed — time to whisper for evidence. */
export async function notifyCourseClosedPush(
  db: DrizzleDb,
  input: {
    readonly nodeId: string;
    readonly gameId: string | null;
    readonly webBaseUrl?: string | null;
  },
): Promise<void> {
  if (!ensureVapid()) return;
  const stakeUsers = await db
    .select({
      userId: worldCourseStakes.userId,
    })
    .from(worldCourseStakes)
    .where(eq(worldCourseStakes.nodeId, input.nodeId));
  const userIds = [
    ...new Set(
      stakeUsers
        .map((row) => row.userId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (userIds.length === 0) return;
  const subs = await db
    .select()
    .from(coursePushSubscriptions)
    .where(inArray(coursePushSubscriptions.userId, userIds));
  if (subs.length === 0) return;
  const { title, url } = await resolveCoursePushTarget(
    db,
    input.gameId,
    input.webBaseUrl,
  );
  const body = coursePushBodyForClosed();
  const gone: string[] = [];
  for (const sub of subs) {
    const result = await sendPush(sub, {
      title,
      body,
      url,
      tag: `course-closed:${input.nodeId}`,
    });
    if (result === 'gone') gone.push(sub.id);
  }
  if (gone.length > 0) {
    await db
      .delete(coursePushSubscriptions)
      .where(inArray(coursePushSubscriptions.id, gone));
  }
  console.log(
    '[course-push]',
    JSON.stringify({
      kind: 'closed',
      nodeId: input.nodeId,
      gameId: input.gameId,
      subscribers: subs.length,
    }),
  );
}

/** Notify the author when both sides have stake for the first time. */
export async function notifyCourseContestedPush(
  db: DrizzleDb,
  input: {
    readonly nodeId: string;
    readonly gameId: string | null;
    readonly webBaseUrl?: string | null;
  },
): Promise<void> {
  if (!ensureVapid()) return;
  const [node] = await db
    .select({
      createdByUserId: worldCourseNodes.createdByUserId,
      prompt: worldCourseNodes.prompt,
    })
    .from(worldCourseNodes)
    .where(eq(worldCourseNodes.id, input.nodeId))
    .limit(1);
  const userId = node?.createdByUserId;
  if (!userId) return;
  const subs = await db
    .select()
    .from(coursePushSubscriptions)
    .where(eq(coursePushSubscriptions.userId, userId));
  if (subs.length === 0) return;
  const { title, url } = await resolveCoursePushTarget(
    db,
    input.gameId,
    input.webBaseUrl,
  );
  const body = coursePushBodyForContested(node?.prompt);
  const gone: string[] = [];
  for (const sub of subs) {
    const result = await sendPush(sub, {
      title,
      body,
      url,
      tag: `course-contested:${input.nodeId}`,
    });
    if (result === 'gone') gone.push(sub.id);
  }
  if (gone.length > 0) {
    await db
      .delete(coursePushSubscriptions)
      .where(inArray(coursePushSubscriptions.id, gone));
  }
  console.log(
    '[course-push]',
    JSON.stringify({
      kind: 'contested',
      nodeId: input.nodeId,
      gameId: input.gameId,
      subscribers: subs.length,
    }),
  );
}
