/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  createStripeCheckoutSession,
  formEncode,
  retrieveStripeCheckoutSession,
  stripeCheckoutFields,
  StripeStorefrontUnavailable,
} from './stripeCheckout.js';

describe('stripeCheckout', () => {
  it('builds a CNY payment session without embedding secrets', () => {
    const fields = stripeCheckoutFields({
      sku: 'pack_small',
      resolved: {
        kind: 'points',
        points: 120,
        cents: 900,
        plan: null,
        description: '开镇礼 120 点',
      },
      organizationId: 'org-1',
      userId: 'user-1',
      outTradeNo: 'og1',
      successUrl: 'https://gebi.example/wallet?cs={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://gebi.example/wallet?checkout=cancel',
    });
    expect(fields.mode).toBe('payment');
    expect(fields['line_items[0][price_data][currency]']).toBe('cny');
    expect(fields['metadata[sku]']).toBe('pack_small');
    expect(formEncode({ a: 'b c' })).toContain('b%20c');
  });

  it('refuses to call Stripe without an API key', async () => {
    await expect(
      createStripeCheckoutSession(
        {
          apiKey: '',
          successUrl: 'https://x/ok',
          cancelUrl: 'https://x/no',
        },
        {},
      ),
    ).rejects.toBeInstanceOf(StripeStorefrontUnavailable);
  });

  it('reads out_trade_no from a paid Checkout Session', async () => {
    const session = await retrieveStripeCheckoutSession(
      'sk_test',
      'cs_test',
      async () =>
        new Response(
          JSON.stringify({
            id: 'cs_test',
            payment_status: 'paid',
            client_reference_id: 'og1',
            amount_total: 900,
          }),
          { status: 200 },
        ),
    );
    expect(session.outTradeNo).toBe('og1');
    expect(session.paymentStatus).toBe('paid');
  });
});
