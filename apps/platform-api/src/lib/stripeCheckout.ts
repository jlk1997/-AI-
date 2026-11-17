/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stripe Checkout Session for the overseas storefront. Merchant keys stay in
 * env — this file only builds the session when an API key is already present.
 */

import { createHmac } from 'node:crypto';

import type { ResolvedSku } from './billing.js';

export class StripeStorefrontUnavailable extends Error {
  constructor(message = 'Stripe Checkout is not configured') {
    super(message);
    this.name = 'StripeStorefrontUnavailable';
  }
}

export interface StripeCheckoutConfig {
  readonly apiKey: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface CreatedStripeCheckout {
  readonly id: string;
  readonly url: string;
}

export function formEncode(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export function stripeCheckoutFields(input: {
  readonly sku: string;
  readonly resolved: ResolvedSku;
  readonly organizationId: string;
  readonly userId: string;
  readonly outTradeNo: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
}): Record<string, string> {
  const unitAmount = String(input.resolved.cents);
  return {
    mode: input.resolved.kind === 'subscription' ? 'subscription' : 'payment',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.outTradeNo,
    'metadata[organization_id]': input.organizationId,
    'metadata[user_id]': input.userId,
    'metadata[sku]': input.sku,
    'metadata[out_trade_no]': input.outTradeNo,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'cny',
    'line_items[0][price_data][unit_amount]': unitAmount,
    'line_items[0][price_data][product_data][name]': input.resolved.description,
    ...(input.resolved.kind === 'subscription'
      ? { 'line_items[0][price_data][recurring][interval]': 'month' }
      : {}),
  };
}

export async function retrieveStripeCheckoutSession(
  apiKey: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  readonly id: string;
  readonly paymentStatus: string;
  readonly outTradeNo: string | null;
  readonly amountTotal: number | null;
}> {
  if (!apiKey.trim() || !sessionId.trim()) {
    throw new StripeStorefrontUnavailable();
  }
  const res = await fetchImpl(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    payment_status?: string;
    client_reference_id?: string;
    amount_total?: number;
    metadata?: Record<string, string>;
    error?: { message?: string };
  };
  if (!res.ok || !body.id) {
    throw new StripeStorefrontUnavailable(
      body.error?.message ?? `Stripe session lookup failed (${res.status})`,
    );
  }
  return {
    id: body.id,
    paymentStatus: body.payment_status ?? 'unpaid',
    outTradeNo: body.client_reference_id || body.metadata?.['out_trade_no'] || null,
    amountTotal: body.amount_total ?? null,
  };
}

export async function createStripeCheckoutSession(
  config: StripeCheckoutConfig,
  fields: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedStripeCheckout> {
  if (!config.apiKey.trim()) {
    throw new StripeStorefrontUnavailable();
  }
  const res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formEncode(fields),
  });
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok || !body.id || !body.url) {
    throw new StripeStorefrontUnavailable(
      body.error?.message ?? `Stripe Checkout failed (${res.status})`,
    );
  }
  return { id: body.id, url: body.url };
}

export function stripeAmountSignature(
  secret: string,
  outTradeNo: string,
  cents: number,
): string {
  return createHmac('sha256', secret)
    .update(`${outTradeNo}:${cents}`)
    .digest('hex')
    .slice(0, 16);
}
