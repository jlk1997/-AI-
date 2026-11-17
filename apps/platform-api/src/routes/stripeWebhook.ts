/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { eq } from 'drizzle-orm';

import type { DrizzleDb } from '@opengame/platform-db';
import { subscriptions } from '@opengame/platform-db';

import type { PlatformEnv } from '../env.js';
import { settleOrder } from '../lib/billing.js';
import {
  readSubscription,
  type StripeWebhookEvent,
} from '../lib/stripe.js';

export async function handleStripeEvent(
  db: DrizzleDb,
  env: PlatformEnv,
  event: StripeWebhookEvent,
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const obj = event.data.object as {
        client_reference_id?: string;
        amount_total?: number;
        payment_status?: string;
        metadata?: Record<string, string>;
        id?: string;
      };
      const outTradeNo =
        obj.client_reference_id || obj.metadata?.['out_trade_no'] || '';
      if (!outTradeNo || obj.payment_status === 'unpaid') return;
      await settleOrder(db, env, {
        outTradeNo,
        transactionId: obj.id ?? null,
        amountCents: obj.amount_total ?? null,
        raw: obj,
      });
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = readSubscription(event.data.object);
      if (!sub) return;
      const plan = sub.priceId ? (env.stripePriceToPlan[sub.priceId] ?? 'pro') : 'free';
      const status =
        event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status;

      const [byCustomer] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.stripeCustomerId, sub.stripeCustomerId))
        .limit(1);

      const objMeta = (event.data.object as { metadata?: Record<string, string> }).metadata;
      const orgFromMeta = objMeta?.['organization_id'];

      const targetOrgId = byCustomer?.organizationId ?? orgFromMeta;
      if (!targetOrgId) {
        console.warn(
          'stripe webhook: no organization mapping for customer',
          sub.stripeCustomerId,
        );
        return;
      }
      await db
        .insert(subscriptions)
        .values({
          organizationId: targetOrgId,
          stripeCustomerId: sub.stripeCustomerId,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          stripePriceId: sub.priceId,
          plan,
          status,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          currentPeriodEnd: sub.currentPeriodEnd,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: subscriptions.organizationId,
          set: {
            stripeCustomerId: sub.stripeCustomerId,
            stripeSubscriptionId: sub.stripeSubscriptionId,
            stripePriceId: sub.priceId,
            plan,
            status,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            currentPeriodEnd: sub.currentPeriodEnd,
            updatedAt: new Date(),
          },
        });
      return;
    }
    default:
      return;
  }
}
