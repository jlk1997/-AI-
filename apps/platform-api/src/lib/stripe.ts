/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal Stripe webhook verifier — implements the canonical
 * `Stripe-Signature: t=<ts>,v1=<sig>` HMAC check so we don't have to take a
 * dependency on the official Stripe SDK just for webhooks.
 *
 * Stripe signs the payload as `${timestamp}.${rawBody}` with HMAC-SHA256 and
 * sends it in the `v1` segment of the header. We tolerate any number of v1
 * candidates (Stripe rolls signing secrets atomically) and require at least
 * one to match within the configured tolerance.
 *
 * NB: the rawBody must be the **exact** bytes Stripe sent — do NOT re-stringify
 * a parsed JSON body before calling this.
 */
export interface StripeVerifyOptions {
  readonly rawBody: string;
  readonly signatureHeader: string;
  readonly secret: string;
  /** Window in seconds. Default 5min (Stripe's recommendation). */
  readonly toleranceSeconds?: number;
  /** For tests; defaults to Math.floor(Date.now() / 1000). */
  readonly nowSeconds?: number;
}

export type StripeVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export function verifyStripeSignature(opts: StripeVerifyOptions): StripeVerifyResult {
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);

  const parts = opts.signatureHeader.split(',').map((p) => p.trim());
  let timestamp: number | null = null;
  const sigs: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1') sigs.push(value);
  }
  if (timestamp == null || !Number.isFinite(timestamp)) {
    return { ok: false, reason: 'missing timestamp' };
  }
  if (Math.abs(now - timestamp) > tolerance) {
    return { ok: false, reason: 'timestamp outside tolerance window' };
  }
  if (sigs.length === 0) {
    return { ok: false, reason: 'no v1 signatures present' };
  }
  const expected = createHmac('sha256', opts.secret)
    .update(`${timestamp}.${opts.rawBody}`, 'utf8')
    .digest('hex');
  for (const sig of sigs) {
    const candidate = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (candidate.length !== expectedBuf.length) continue;
    if (timingSafeEqual(candidate, expectedBuf)) return { ok: true };
  }
  return { ok: false, reason: 'no matching v1 signature' };
}

/**
 * Lightweight typing for the subset of Stripe webhook events we actually
 * consume. The full payload is much larger but unused.
 */
export interface StripeWebhookEvent {
  readonly id: string;
  readonly type: string;
  readonly created: number;
  readonly data: {
    readonly object: Record<string, unknown>;
  };
}

interface StripeSubscriptionLike {
  readonly id: string;
  readonly customer: string;
  readonly status: string;
  readonly cancel_at_period_end?: boolean;
  readonly current_period_end?: number;
  readonly items?: { readonly data?: Array<{ readonly price?: { readonly id?: string } }> };
}

/**
 * Extracts the fields we care about from a Stripe Subscription resource. We
 * tolerate missing fields because tests can hand-craft minimal events.
 */
export function readSubscription(
  obj: Record<string, unknown>,
): {
  readonly stripeSubscriptionId: string;
  readonly stripeCustomerId: string;
  readonly status: string;
  readonly priceId: string | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodEnd: Date | null;
} | null {
  const sub = obj as unknown as StripeSubscriptionLike;
  if (!sub.id || !sub.customer) return null;
  const priceId =
    sub.items?.data?.[0]?.price?.id != null ? String(sub.items.data[0].price.id) : null;
  return {
    stripeSubscriptionId: sub.id,
    stripeCustomerId: sub.customer,
    status: sub.status ?? 'active',
    priceId,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    currentPeriodEnd: sub.current_period_end
      ? new Date(sub.current_period_end * 1000)
      : null,
  };
}
