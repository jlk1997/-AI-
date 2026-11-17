/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reports and takedowns.
 *
 * Hosting other people's work means being able to answer "this is stolen" or
 * "this should not be in front of children" with a decision and a record of who
 * made it. This module is the small amount of shape that needs: a closed set of
 * reasons, a closed set of outcomes, and the one query a curator opens.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import { communityGames, contentReports, gameComments, users } from '@opengame/platform-db';

import { publicAuthorOf, type PublicAuthor } from './identity.js';

export const REPORT_REASONS = [
  'stolen',
  'nsfw',
  'illegal',
  'broken',
  'spam',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_TARGETS = ['game', 'comment'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export function isReportReason(value: unknown): value is ReportReason {
  return (
    typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value)
  );
}

export function isReportTarget(value: unknown): value is ReportTarget {
  return (
    typeof value === 'string' && (REPORT_TARGETS as readonly string[]).includes(value)
  );
}

/** Free text from a stranger: trimmed, capped, and empty means absent. */
export function normalizeDetail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/\s+/g, ' ');
  if (text.length === 0) return null;
  return text.slice(0, 500);
}

export interface OpenReport {
  readonly id: string;
  readonly targetKind: ReportTarget;
  readonly reason: ReportReason;
  readonly detail: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly reporter: PublicAuthor | null;
  readonly game: {
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly isPublic: boolean;
    readonly takenDownAt: string | null;
  } | null;
  readonly comment: { readonly id: string; readonly content: string } | null;
}

/**
 * The curator's queue. Open reports first and oldest first inside that, because
 * the complaint that has been waiting longest is the one that erodes trust.
 */
export async function listReports(
  db: DrizzleDb,
  options?: { readonly status?: string; readonly limit?: number },
): Promise<OpenReport[]> {
  const limit = Math.max(1, Math.min(100, options?.limit ?? 50));
  const rows = await db
    .select({
      report: contentReports,
      game: {
        id: communityGames.id,
        slug: communityGames.slug,
        title: communityGames.title,
        isPublic: communityGames.isPublic,
        takenDownAt: communityGames.takenDownAt,
      },
      comment: { id: gameComments.id, content: gameComments.content },
      reporter: {
        id: users.id,
        email: users.email,
        handle: users.handle,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
      },
    })
    .from(contentReports)
    .leftJoin(communityGames, eq(communityGames.id, contentReports.communityGameId))
    .leftJoin(gameComments, eq(gameComments.id, contentReports.commentId))
    .leftJoin(users, eq(users.id, contentReports.reporterUserId))
    .where(
      options?.status ? eq(contentReports.status, options.status) : sql`true`,
    )
    .orderBy(desc(contentReports.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.report.id,
    targetKind: row.report.targetKind as ReportTarget,
    reason: row.report.reason as ReportReason,
    detail: row.report.detail,
    status: row.report.status,
    createdAt: row.report.createdAt.toISOString(),
    reporter: row.reporter?.id ? publicAuthorOf(row.reporter) : null,
    game: row.game?.id
      ? {
          id: row.game.id,
          slug: row.game.slug,
          title: row.game.title,
          isPublic: row.game.isPublic,
          takenDownAt: row.game.takenDownAt?.toISOString() ?? null,
        }
      : null,
    comment: row.comment?.id
      ? { id: row.comment.id, content: row.comment.content }
      : null,
  }));
}

export async function countOpenReports(db: DrizzleDb): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(contentReports)
    .where(eq(contentReports.status, 'open'));
  return Number(row?.value ?? 0);
}

/**
 * Hides a work from the community without deleting it. The author keeps their
 * project and their source; what stops is the public listing and, through
 * `is_public`, the play session — an appeal has to be able to undo this.
 */
export async function takedownGame(
  db: DrizzleDb,
  communityGameId: string,
  reason: string,
): Promise<boolean> {
  const rows = await db
    .update(communityGames)
    .set({
      isPublic: false,
      isFeatured: false,
      takedownReason: reason.slice(0, 200),
      takenDownAt: new Date(),
    })
    .where(eq(communityGames.id, communityGameId))
    .returning({ id: communityGames.id });
  if (rows.length > 0) {
    const { voidCourseNodesForGame } = await import('./courseBoard.js');
    await voidCourseNodesForGame(db, communityGameId, 'takedown').catch(() => 0);
  }
  return rows.length > 0;
}

export async function restoreGame(
  db: DrizzleDb,
  communityGameId: string,
): Promise<boolean> {
  const rows = await db
    .update(communityGames)
    .set({ isPublic: true, takedownReason: null, takenDownAt: null })
    .where(eq(communityGames.id, communityGameId))
    .returning({ id: communityGames.id });
  return rows.length > 0;
}

/** Every open report about the same thing is settled by one decision. */
export async function resolveReportsFor(
  db: DrizzleDb,
  target: { readonly communityGameId?: string; readonly commentId?: string },
  status: 'upheld' | 'rejected',
  resolvedByUserId: string,
  resolution: string | null,
): Promise<number> {
  const scope = target.communityGameId
    ? eq(contentReports.communityGameId, target.communityGameId)
    : target.commentId
      ? eq(contentReports.commentId, target.commentId)
      : null;
  if (!scope) return 0;
  const rows = await db
    .update(contentReports)
    .set({
      status,
      resolution: resolution?.slice(0, 200) ?? null,
      resolvedByUserId,
      resolvedAt: new Date(),
    })
    .where(and(scope, eq(contentReports.status, 'open')))
    .returning({ id: contentReports.id });
  return rows.length;
}

/** Whether a work is currently visible to the public. */
export async function isGameVisible(
  db: DrizzleDb,
  communityGameId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: communityGames.id })
    .from(communityGames)
    .where(
      and(
        eq(communityGames.id, communityGameId),
        eq(communityGames.isPublic, true),
        isNull(communityGames.takenDownAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}
