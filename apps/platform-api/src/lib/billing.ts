/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import { orders, subscriptions } from '@opengame/platform-db';

import type { PlatformEnv } from '../env.js';
import { COMMERCE } from './commerce.js';
import { grantFirstTopupBonus } from './kaiMarket.js';
import { creditPoints, currentPeriodKey } from './wallet.js';

export interface CatalogPlan {
  readonly id: string;
  readonly priceCents: number;
  readonly monthlyPoints: number;
  readonly dailyJobLimit: number;
  readonly maxConcurrentJobs: number;
}

export interface CatalogPack {
  readonly id: string;
  readonly points: number;
  readonly priceCents: number;
}

/** Old checkout SKUs still settle into the single balance. */
const LEGACY_POINT_PACKS: Record<string, { points: number; cents: number }> = {
  pack_jiaxi: { points: 200, cents: 1800 },
  pack_xiangyi: { points: 200, cents: 1800 },
};

export interface Catalog {
  readonly currency: 'CNY';
  readonly plans: readonly CatalogPlan[];
  readonly packs: readonly CatalogPack[];
  readonly jobCosts: Record<string, number>;
  readonly providers: readonly string[];
  readonly stripeStorefront: boolean;
  readonly commerce: {
    readonly tipPresets: readonly number[];
    readonly jiaxi: number;
    readonly xiangyi: number;
    readonly townTimeDay: number;
    readonly townTimeWeek: number;
    readonly townTimeMonth: number;
    readonly worldLightHour: number;
    readonly worldLightDay: number;
    readonly worldLightWeek: number;
    readonly challengeEntry: number;
    readonly remixBranch: number;
    readonly sandbox: number;
    readonly adopt: number;
  };
}

/**
 * What the checkout screen renders. Everything here is env-configurable so a
 * self-hoster can run at their own prices without touching code — and so we can
 * change pricing without a deploy of the web app.
 */
export function buildCatalog(env: PlatformEnv): Catalog {
  const planIds = ['free', 'creator', 'studio'];
  const providers: string[] = [];
  if (env.wechatPayMchId && env.wechatPayPrivateKey) providers.push('wechat');
  if (env.alipayAppId && env.alipayPrivateKey) providers.push('alipay');
  if (env.stripeApiKey) providers.push('stripe');
  if (env.allowMockPayments) providers.push('mock');

  return {
    currency: 'CNY',
    plans: planIds.map((id) => ({
      id,
      priceCents: env.planPriceCents[id] ?? 0,
      monthlyPoints: env.planMonthlyPoints[id] ?? 0,
      dailyJobLimit: env.planDailyJobLimits[id] ?? env.dailyJobLimitPerOrg,
      maxConcurrentJobs:
        env.planMaxConcurrentJobs[id] ?? env.maxConcurrentJobsPerOrg,
    })),
    packs: Object.entries(env.pointPacks)
      .filter(([id]) => id !== 'pack_jiaxi' && id !== 'pack_xiangyi')
      .map(([id, p]) => ({
        id,
        points: p.points,
        priceCents: p.cents,
      })),
    jobCosts: env.jobPointCosts,
    providers,
    stripeStorefront: Boolean(env.stripeApiKey && env.stripeStorefront),
    commerce: {
      tipPresets: COMMERCE.tipPresets,
      jiaxi: COMMERCE.jiaxi,
      xiangyi: COMMERCE.xiangyi,
      townTimeDay: COMMERCE.townTimeDay,
      townTimeWeek: COMMERCE.townTimeWeek,
      townTimeMonth: COMMERCE.townTimeMonth,
      worldLightHour: COMMERCE.worldLightHour,
      worldLightDay: COMMERCE.worldLightDay,
      worldLightWeek: COMMERCE.worldLightWeek,
      challengeEntry: COMMERCE.challengeEntry,
      remixBranch: COMMERCE.remixBranch,
      sandbox: COMMERCE.sandbox,
      adopt: COMMERCE.adopt,
    },
  };
}

export interface ResolvedSku {
  readonly kind: 'points' | 'subscription';
  readonly points: number;
  readonly cents: number;
  readonly plan: string | null;
  readonly description: string;
}

/** `plan:creator` buys a month of a plan; anything else must be a point pack. */
export function resolveSku(env: PlatformEnv, sku: string): ResolvedSku | null {
  if (sku.startsWith('plan:')) {
    const plan = sku.slice('plan:'.length);
    const cents = env.planPriceCents[plan];
    if (!cents || cents <= 0) return null;
    return {
      kind: 'subscription',
      points: env.planMonthlyPoints[plan] ?? 0,
      cents,
      plan,
      description: `开镇 ${plan} 月度 · 镇时与去水印`,
    };
  }
  const pack = env.pointPacks[sku] ?? LEGACY_POINT_PACKS[sku];
  if (!pack) return null;
  return {
    kind: 'points',
    points: pack.points,
    cents: pack.cents,
    plan: null,
    description: `开镇礼 ${pack.points} 点`,
  };
}

/**
 * Providers key everything off this string, so it has to be unique forever and
 * safe in a URL. Time prefix keeps it sortable when reading provider consoles.
 */
export function newOutTradeNo(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `og${stamp}${randomBytes(5).toString('hex')}`;
}

export interface SettleResult {
  readonly status: 'credited' | 'already-paid' | 'unknown-order' | 'amount-mismatch';
  readonly orderId?: string;
}

/**
 * Applies a provider's "this order is paid" callback.
 *
 * Idempotent by construction: the status flip is a conditional UPDATE on
 * `status = 'created'`, so a redelivered notify — which every provider will
 * send, repeatedly, until it gets a 200 — cannot credit the wallet twice.
 */
export async function settleOrder(
  db: DrizzleDb,
  env: PlatformEnv,
  params: {
    readonly outTradeNo: string;
    readonly transactionId?: string | null;
    readonly amountCents?: number | null;
    readonly raw?: unknown;
  },
): Promise<SettleResult> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.outTradeNo, params.outTradeNo))
    .limit(1);
  if (!order) return { status: 'unknown-order' };
  if (order.status === 'paid') {
    return { status: 'already-paid', orderId: order.id };
  }
  if (
    params.amountCents != null &&
    params.amountCents !== order.amountCents
  ) {
    // Never credit an amount we did not quote — this is the one check that
    // stops a tampered client from buying 4000 points for one fen.
    await db
      .update(orders)
      .set({ status: 'failed', raw: params.raw ?? null, updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    return { status: 'amount-mismatch', orderId: order.id };
  }

  try {
    await db.transaction(async (tx) => {
      const scoped = tx as unknown as DrizzleDb;
      const [claimed] = await tx
        .update(orders)
        .set({
          status: 'paid',
          paidAt: new Date(),
          transactionId: params.transactionId ?? null,
          raw: (params.raw as Record<string, unknown>) ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, order.id), eq(orders.status, 'created')))
        .returning({ id: orders.id });
      if (!claimed) {
        throw new Error('already-paid');
      }

      if (order.kind === 'subscription' && order.plan) {
        await applyPlanPurchase(scoped, env, order.organizationId, order.plan, order.id);
        return;
      }
      if (order.points > 0) {
        await creditPoints(scoped, order.organizationId, order.points, 'topup', {
          orderId: order.id,
          note: order.sku,
        });
        await grantFirstTopupBonus(scoped, order.organizationId, order.points, order.id);
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'already-paid') {
      return { status: 'already-paid', orderId: order.id };
    }
    throw error;
  }
  return { status: 'credited', orderId: order.id };
}

/**
 * A plan purchase is a month of higher limits plus that month's points. The
 * grant is stamped with the current period so the automatic monthly refill does
 * not hand out a second allowance a moment later.
 */
async function applyPlanPurchase(
  db: DrizzleDb,
  env: PlatformEnv,
  organizationId: string,
  plan: string,
  orderId: string,
): Promise<void> {
  const period = currentPeriodKey();
  const monthlyPoints = env.planMonthlyPoints[plan] ?? 0;
  const periodEnd = new Date();
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);
  if (existing) {
    await db
      .update(subscriptions)
      .set({
        plan,
        status: 'active',
        monthlyPoints,
        pointsGrantedFor: period,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, existing.id));
  } else {
    await db.insert(subscriptions).values({
      organizationId,
      plan,
      status: 'active',
      monthlyPoints,
      pointsGrantedFor: period,
      currentPeriodEnd: periodEnd,
    });
  }
  if (monthlyPoints > 0) {
    await creditPoints(db, organizationId, monthlyPoints, 'topup', {
      orderId,
      note: `plan ${plan} ${period}`,
    });
  }
}
