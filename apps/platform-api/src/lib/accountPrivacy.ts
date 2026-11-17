/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Export and close an account. Ledger rows stay for fraud disputes; public
 * works come down so a closed author cannot keep earning from a ghost page.
 */

import { desc, eq } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import { communityGames, ledgerEntries, users, wallets } from '@opengame/platform-db';

import { listMyWorks, listUserOrgIds } from './identity.js';
import { takedownGame } from './moderation.js';

export const DEFAULT_MIN_AGE = 16;

export function currentAgeFromBirthYear(
  birthYear: number,
  now = new Date(),
): number {
  return now.getUTCFullYear() - birthYear;
}

export function isOldEnoughToPublish(
  birthYear: number | null | undefined,
  minAge = DEFAULT_MIN_AGE,
  now = new Date(),
): boolean {
  if (birthYear == null || !Number.isFinite(birthYear)) return false;
  if (birthYear < 1900 || birthYear > now.getUTCFullYear()) return false;
  return currentAgeFromBirthYear(birthYear, now) >= minAge;
}

export function anonymizedEmail(userId: string): string {
  return `deleted+${userId.replace(/-/g, '').slice(0, 12)}@invalid.local`;
}

export function anonymizedHandle(userId: string): string {
  return `deleted_${userId.replace(/-/g, '').slice(0, 8)}`;
}

export async function exportAccountBundle(
  db: DrizzleDb,
  userId: string,
): Promise<Record<string, unknown>> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.deletedAt) {
    throw new Error('account not found');
  }
  const orgIds = await listUserOrgIds(db, userId);
  const works = await listMyWorks(db, userId);
  const ledger: Array<{
    kind: string;
    points: number;
    note: string | null;
    createdAt: Date;
  }> = [];
  const walletSummaries: Array<{ organizationId: string; balance: number }> = [];
  for (const organizationId of orgIds) {
    const [wallet] = await db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.organizationId, organizationId))
      .limit(1);
    if (wallet) walletSummaries.push({ organizationId, balance: wallet.balance });
    const rows = await db
      .select({
        kind: ledgerEntries.kind,
        points: ledgerEntries.points,
        note: ledgerEntries.note,
        createdAt: ledgerEntries.createdAt,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.organizationId, organizationId))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(80);
    ledger.push(...rows);
  }
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      userId: user.id,
      email: user.email,
      handle: user.handle,
      displayName: user.displayName,
      birthYear: user.birthYear,
      acceptedLegalAt: user.acceptedLegalAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    },
    organizations: orgIds.map((organizationId) => ({ organizationId })),
    wallets: walletSummaries,
    works: {
      games: works.games.map((g) => ({
        slug: g.slug,
        title: g.title,
        isPublic: g.isPublic,
      })),
      worlds: works.worlds.map((g) => ({
        slug: g.slug,
        title: g.title,
        isPublic: g.isPublic,
      })),
    },
    ledger: ledger.map((row) => ({
      kind: row.kind,
      points: row.points,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function closeAccount(
  db: DrizzleDb,
  userId: string,
): Promise<{ readonly closed: true; readonly worksTakenDown: number }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error('account not found');
  if (user.deletedAt) return { closed: true, worksTakenDown: 0 };

  const works = await listMyWorks(db, userId);
  const publicIds = [...works.games, ...works.worlds]
    .filter((w) => w.isPublic)
    .map((w) => w.slug);
  let takenDown = 0;
  for (const slug of publicIds) {
    const [row] = await db
      .select({ id: communityGames.id })
      .from(communityGames)
      .where(eq(communityGames.slug, slug))
      .limit(1);
    if (!row) continue;
    if (await takedownGame(db, row.id, 'account closed')) takenDown += 1;
  }

  await db
    .update(users)
    .set({
      deletedAt: new Date(),
      email: anonymizedEmail(userId),
      phone: null,
      wechatOpenid: null,
      wechatUnionid: null,
      displayName: 'closed account',
      avatarUrl: null,
      bio: null,
      handle: anonymizedHandle(userId),
    })
    .where(eq(users.id, userId));

  return { closed: true, worksTakenDown: takenDown };
}

export async function recordLegalAcceptance(
  db: DrizzleDb,
  userId: string,
  input: { readonly birthYear?: number; readonly acceptedLegal?: boolean },
): Promise<void> {
  const patch: {
    birthYear?: number;
    acceptedLegalAt?: Date;
  } = {};
  if (input.birthYear && Number.isFinite(input.birthYear)) {
    patch.birthYear = Math.floor(input.birthYear);
  }
  if (input.acceptedLegal) {
    patch.acceptedLegalAt = new Date();
  }
  if (Object.keys(patch).length === 0) return;
  await db.update(users).set(patch).where(eq(users.id, userId));
}

export async function loadLegalProfile(
  db: DrizzleDb,
  userId: string,
): Promise<{
  readonly birthYear: number | null;
  readonly acceptedLegalAt: Date | null;
  readonly deletedAt: Date | null;
}> {
  const [row] = await db
    .select({
      birthYear: users.birthYear,
      acceptedLegalAt: users.acceptedLegalAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return {
    birthYear: row?.birthYear ?? null,
    acceptedLegalAt: row?.acceptedLegalAt ?? null,
    deletedAt: row?.deletedAt ?? null,
  };
}

export async function loadBirthYear(
  db: DrizzleDb,
  userId: string,
): Promise<number | null> {
  return (await loadLegalProfile(db, userId)).birthYear;
}

export function canPublishPublicly(
  legal: { readonly birthYear: number | null; readonly acceptedLegalAt: Date | null },
  minAge = DEFAULT_MIN_AGE,
  now = new Date(),
): boolean {
  return Boolean(legal.acceptedLegalAt) && isOldEnoughToPublish(legal.birthYear, minAge, now);
}
