/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import {
  ledgerEntries,
  pluginEntitlements,
  pluginPackages,
  subscriptions,
  templateEntitlements,
  templatePackages,
  wallets,
} from '@opengame/platform-db';

import type { PlatformEnv } from '../env.js';

export type LedgerKind =
  | 'topup'
  | 'grant'
  | 'spend'
  | 'refund'
  | 'royalty'
  | 'tip'
  /** Buying something in the marketplace. */
  | 'purchase'
  /** The other half of a purchase, credited to the seller. */
  | 'sale'
  | 'adjust'
  | 'course_stake'
  | 'course_payout'
  | 'course_void'
  | 'course_rake';

export interface WalletSnapshot {
  readonly balance: number;
  readonly lifetimeEarned: number;
  readonly lifetimeSpent: number;
  readonly welcomeGranted: boolean;
  readonly loginStreak: number;
  readonly lastLoginDay: string | null;
  readonly firstTopupGranted: boolean;
  readonly inviteClaimed: boolean;
}

export interface MovementRef {
  readonly jobId?: string | null;
  readonly orderId?: string | null;
  readonly sourceOrganizationId?: string | null;
  readonly communityGameId?: string | null;
  readonly pluginId?: string | null;
  readonly note?: string;
  readonly meta?: Record<string, unknown>;
}

function dayKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export function snapshotWallet(
  row: {
    balance: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    welcomeGranted: boolean;
    loginStreak: number;
    lastLoginDay: Date | string | null;
    firstTopupGranted: boolean;
    inviteClaimed: boolean;
  },
): WalletSnapshot {
  return {
    balance: row.balance,
    lifetimeEarned: row.lifetimeEarned,
    lifetimeSpent: row.lifetimeSpent,
    welcomeGranted: row.welcomeGranted,
    loginStreak: row.loginStreak,
    lastLoginDay: dayKey(row.lastLoginDay),
    firstTopupGranted: row.firstTopupGranted,
    inviteClaimed: row.inviteClaimed,
  };
}

/** Calendar month in UTC. The key a plan grant is idempotent against. */
export function currentPeriodKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function ensureWallet(
  db: DrizzleDb,
  organizationId: string,
): Promise<WalletSnapshot> {
  const [existing] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.organizationId, organizationId))
    .limit(1);
  if (existing) return snapshotWallet(existing);
  await db.insert(wallets).values({ organizationId }).onConflictDoNothing();
  const [fresh] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.organizationId, organizationId))
    .limit(1);
  return fresh
    ? snapshotWallet(fresh)
    : {
        balance: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0,
        welcomeGranted: false,
        loginStreak: 0,
        lastLoginDay: null,
        firstTopupGranted: false,
        inviteClaimed: false,
      };
}

/**
 * Adds points and records the movement. Credits have no race to lose — the
 * conditional balance check only matters when spending — so this is a plain
 * increment.
 */
export async function creditPoints(
  db: DrizzleDb,
  organizationId: string,
  points: number,
  kind: LedgerKind,
  ref: MovementRef = {},
): Promise<number> {
  if (points <= 0) return (await ensureWallet(db, organizationId)).balance;
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    await ensureWallet(scoped, organizationId);
    const [row] = await tx
      .update(wallets)
      .set({
        balance: sql`${wallets.balance} + ${points}`,
        lifetimeEarned: sql`${wallets.lifetimeEarned} + ${points}`,
        updatedAt: new Date(),
      })
      .where(eq(wallets.organizationId, organizationId))
      .returning({
        balance: wallets.balance,
      });
    const balance = row?.balance ?? points;
    await tx.insert(ledgerEntries).values({
      organizationId,
      kind,
      points,
      balanceAfter: balance,
      jobId: ref.jobId ?? null,
      orderId: ref.orderId ?? null,
      sourceOrganizationId: ref.sourceOrganizationId ?? null,
      communityGameId: ref.communityGameId ?? null,
      pluginId: ref.pluginId ?? null,
      note: ref.note ?? null,
      meta: ref.meta ?? null,
    });
    return balance;
  });
}

export interface DebitResult {
  readonly ok: boolean;
  readonly balance: number;
  readonly charged: number;
  /** Points still missing when `ok` is false. */
  readonly need?: number;
}

/**
 * Spends points if — and only if — the wallet can cover them. The check and the
 * decrement are one statement, so two jobs submitted at the same moment cannot
 * both spend the last point and leave the balance negative.
 */
export async function debitPoints(
  db: DrizzleDb,
  organizationId: string,
  points: number,
  kind: LedgerKind,
  ref: MovementRef = {},
): Promise<DebitResult> {
  const snapshot = await ensureWallet(db, organizationId);
  if (points <= 0) return { ok: true, balance: snapshot.balance, charged: 0 };
  return db.transaction(async (tx) => {
  const [row] = await tx
    .update(wallets)
    .set({
      balance: sql`${wallets.balance} - ${points}`,
      lifetimeSpent: sql`${wallets.lifetimeSpent} + ${points}`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(wallets.organizationId, organizationId), gte(wallets.balance, points)),
    )
    .returning({ balance: wallets.balance });
  if (!row) {
    const [fresh] = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.organizationId, organizationId))
      .limit(1);
    const balance = fresh?.balance ?? snapshot.balance;
    return {
      ok: false,
      balance,
      charged: 0,
      need: Math.max(0, points - balance),
    };
  }
  await tx.insert(ledgerEntries).values({
    organizationId,
    kind,
    points: -points,
    balanceAfter: row.balance,
    jobId: ref.jobId ?? null,
    orderId: ref.orderId ?? null,
    sourceOrganizationId: ref.sourceOrganizationId ?? null,
    communityGameId: ref.communityGameId ?? null,
    pluginId: ref.pluginId ?? null,
    note: ref.note ?? null,
    meta: ref.meta ?? null,
  });
  return { ok: true, balance: row.balance, charged: points };
  });
}

/**
 * Hands the plan's monthly points to an org the first time it asks in a given
 * calendar month. Free accounts get theirs here too, which is what keeps a
 * brand-new signup — and every org that existed before points did — able to
 * generate without anyone topping them up.
 */
export async function refreshPlanGrant(
  db: DrizzleDb,
  env: PlatformEnv,
  organizationId: string,
): Promise<void> {
  const period = currentPeriodKey();
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);
  const plan = (sub?.status === 'active' && sub.plan) || 'free';
  const points = sub?.monthlyPoints ?? env.planMonthlyPoints[plan] ?? 0;
  if (points <= 0) return;

  if (!sub) {
    await db.transaction(async (tx) => {
      const scoped = tx as unknown as DrizzleDb;
      const [created] = await tx
        .insert(subscriptions)
        .values({
          organizationId,
          plan: 'free',
          status: 'active',
          provider: 'none',
          pointsGrantedFor: period,
        })
        .onConflictDoNothing()
        .returning({ id: subscriptions.id });
      if (!created) return;
      await creditPoints(scoped, organizationId, points, 'grant', {
        note: `plan grant ${plan} ${period}`,
      });
    });
    return;
  }

  if (sub.pointsGrantedFor === period) return;
  // Claim the period and credit in one transaction. If credit throws, the
  // marker rolls back so the next request can still hand out this month.
  await db.transaction(async (tx) => {
    const scoped = tx as unknown as DrizzleDb;
    const [claimed] = await tx
      .update(subscriptions)
      .set({ pointsGrantedFor: period, updatedAt: new Date() })
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          sub.pointsGrantedFor === null
            ? sql`${subscriptions.pointsGrantedFor} IS NULL`
            : eq(subscriptions.pointsGrantedFor, sub.pointsGrantedFor),
        ),
      )
      .returning({ id: subscriptions.id });
    if (!claimed) return;
    await creditPoints(scoped, organizationId, points, 'grant', {
      note: `plan grant ${plan} ${period}`,
    });
  });
}

export function jobPointCost(env: PlatformEnv, jobType: string): number {
  const cost = env.jobPointCosts[jobType];
  return Number.isFinite(cost) ? Math.max(0, Math.round(cost as number)) : 0;
}

/** Whether an org may already use a paid plugin. */
export async function hasPluginEntitlement(
  db: DrizzleDb,
  organizationId: string,
  pluginId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ pluginId: pluginEntitlements.pluginId })
    .from(pluginEntitlements)
    .where(
      and(
        eq(pluginEntitlements.organizationId, organizationId),
        eq(pluginEntitlements.pluginId, pluginId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function grantPluginEntitlement(
  db: DrizzleDb,
  params: {
    readonly organizationId: string;
    readonly pluginId: string;
    readonly userId: string;
    readonly pointsPaid: number;
  },
): Promise<void> {
  await db
    .insert(pluginEntitlements)
    .values({
      organizationId: params.organizationId,
      pluginId: params.pluginId,
      grantedByUserId: params.userId,
      pointsPaid: params.pointsPaid,
    })
    .onConflictDoNothing();
}

export type CatalogPurchaseResult =
  | { readonly already: true; readonly pointsPaid: 0 }
  | { readonly already: false; readonly pointsPaid: number; readonly balance: number }
  | { readonly already: false; readonly unpaid: true; readonly need: number; readonly balance: number };

/**
 * Insert the entitlement first. Only the winner of ON CONFLICT pays.
 * A failed debit rolls the seat back so a retry can buy again.
 */
export async function purchasePluginSeat(
  db: DrizzleDb,
  params: {
    readonly organizationId: string;
    readonly pluginId: string;
    readonly sellerOrgId: string;
    readonly userId: string;
    readonly slug: string;
    readonly pricePoints: number;
  },
): Promise<CatalogPurchaseResult> {
  const price = Math.max(0, Math.round(params.pricePoints));
  try {
    return await db.transaction(async (tx) => {
      const scoped = tx as unknown as DrizzleDb;
      const [seat] = await tx
        .insert(pluginEntitlements)
        .values({
          organizationId: params.organizationId,
          pluginId: params.pluginId,
          grantedByUserId: params.userId,
          pointsPaid: price,
        })
        .onConflictDoNothing()
        .returning({ pluginId: pluginEntitlements.pluginId });
      if (!seat) return { already: true, pointsPaid: 0 };
      if (price <= 0) return { already: false, pointsPaid: 0, balance: 0 };
      const paid = await debitPoints(scoped, params.organizationId, price, 'purchase', {
        pluginId: params.pluginId,
        note: `plugin ${params.slug}`,
      });
      if (!paid.ok) throw new Error('catalog_unpaid');
      if (params.sellerOrgId && params.sellerOrgId !== params.organizationId) {
        await creditPoints(scoped, params.sellerOrgId, price, 'sale', {
          pluginId: params.pluginId,
          sourceOrganizationId: params.organizationId,
          note: `plugin ${params.slug}`,
        });
      }
      await tx
        .update(pluginPackages)
        .set({ revenuePoints: sql`${pluginPackages.revenuePoints} + ${price}` })
        .where(eq(pluginPackages.id, params.pluginId));
      return { already: false, pointsPaid: price, balance: paid.balance };
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'catalog_unpaid') {
      const snap = await ensureWallet(db, params.organizationId);
      return {
        already: false,
        unpaid: true,
        need: Math.max(0, price - snap.balance),
        balance: snap.balance,
      };
    }
    throw err;
  }
}

export async function purchaseTemplateSeat(
  db: DrizzleDb,
  params: {
    readonly organizationId: string;
    readonly templateId: string;
    readonly sellerOrgId: string | null;
    readonly userId: string;
    readonly slug: string;
    readonly pricePoints: number;
  },
): Promise<CatalogPurchaseResult> {
  const price = Math.max(0, Math.round(params.pricePoints));
  try {
    return await db.transaction(async (tx) => {
      const scoped = tx as unknown as DrizzleDb;
      const [seat] = await tx
        .insert(templateEntitlements)
        .values({
          organizationId: params.organizationId,
          templateId: params.templateId,
          grantedByUserId: params.userId,
          pointsPaid: price,
        })
        .onConflictDoNothing()
        .returning({ templateId: templateEntitlements.templateId });
      if (!seat) return { already: true, pointsPaid: 0 };
      if (price <= 0) return { already: false, pointsPaid: 0, balance: 0 };
      const paid = await debitPoints(scoped, params.organizationId, price, 'purchase', {
        note: `template ${params.slug}`,
      });
      if (!paid.ok) throw new Error('catalog_unpaid');
      if (params.sellerOrgId && params.sellerOrgId !== params.organizationId) {
        await creditPoints(scoped, params.sellerOrgId, price, 'sale', {
          sourceOrganizationId: params.organizationId,
          note: `template sale ${params.slug}`,
        });
        await tx
          .update(templatePackages)
          .set({ revenuePoints: sql`${templatePackages.revenuePoints} + ${price}` })
          .where(eq(templatePackages.id, params.templateId));
      }
      return { already: false, pointsPaid: price, balance: paid.balance };
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'catalog_unpaid') {
      const snap = await ensureWallet(db, params.organizationId);
      return {
        already: false,
        unpaid: true,
        need: Math.max(0, price - snap.balance),
        balance: snap.balance,
      };
    }
    throw err;
  }
}

export async function listLedger(
  db: DrizzleDb,
  organizationId: string,
  limit = 30,
): Promise<
  Array<{
    id: string;
    kind: string;
    points: number;
    balanceAfter: number;
    note: string | null;
    createdAt: Date;
  }>
> {
  return db
    .select({
      id: ledgerEntries.id,
      kind: ledgerEntries.kind,
      points: ledgerEntries.points,
      balanceAfter: ledgerEntries.balanceAfter,
      note: ledgerEntries.note,
      createdAt: ledgerEntries.createdAt,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.organizationId, organizationId))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(Math.min(100, Math.max(1, limit)));
}
