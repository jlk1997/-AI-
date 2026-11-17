/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSign, createVerify } from 'node:crypto';

/**
 * Alipay wap pay (mobile web).
 *
 * The whole integration is two signed strings: a redirect URL that opens the
 * Alipay app or cashier, and a form-encoded notify we verify with Alipay's
 * public key. There is no SDK dependency because there is nothing an SDK would
 * add beyond these two functions.
 */

export interface AlipayConfig {
  readonly appId: string;
  /** Our PKCS#8 PEM application private key. */
  readonly privateKey: string;
  /** Alipay's public key, for verifying async notifications. */
  readonly publicKey: string;
  readonly gateway: string;
  readonly notifyUrl: string;
}

export interface AlipayWapRequest {
  readonly outTradeNo: string;
  readonly subject: string;
  readonly amountCents: number;
  /** Where the browser lands after the user finishes (or abandons) payment. */
  readonly returnUrl?: string;
}

function formatTimestamp(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  // Alipay expects Beijing wall-clock time, not the server's local zone.
  const cn = new Date(now.getTime() + 8 * 3600 * 1000);
  return (
    `${cn.getUTCFullYear()}-${pad(cn.getUTCMonth() + 1)}-${pad(cn.getUTCDate())} ` +
    `${pad(cn.getUTCHours())}:${pad(cn.getUTCMinutes())}:${pad(cn.getUTCSeconds())}`
  );
}

/**
 * Alipay signs the raw `k=v&k=v` of all non-empty parameters sorted by key,
 * with `sign` itself excluded. Both signing and verification use this, so they
 * cannot drift apart.
 */
export function canonicalize(params: Record<string, string | undefined>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type')
    .filter((k) => {
      const v = params[k];
      return v !== undefined && v !== null && v !== '';
    })
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

export function buildWapPayUrl(
  cfg: AlipayConfig,
  req: AlipayWapRequest,
  now: Date = new Date(),
): string {
  const bizContent = JSON.stringify({
    out_trade_no: req.outTradeNo,
    total_amount: (req.amountCents / 100).toFixed(2),
    subject: req.subject.slice(0, 250),
    product_code: 'QUICK_WAP_WAY',
  });
  const params: Record<string, string | undefined> = {
    app_id: cfg.appId,
    method: 'alipay.trade.wap.pay',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: formatTimestamp(now),
    version: '1.0',
    notify_url: cfg.notifyUrl,
    return_url: req.returnUrl,
    biz_content: bizContent,
  };
  const sign = createSign('RSA-SHA256')
    .update(canonicalize(params), 'utf8')
    .sign(cfg.privateKey, 'base64');

  const query = Object.entries({ ...params, sign })
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${cfg.gateway}?${query}`;
}

export function verifyNotify(
  publicKey: string,
  params: Record<string, string>,
): boolean {
  const signature = params['sign'];
  if (!signature) return false;
  try {
    return createVerify('RSA-SHA256')
      .update(canonicalize(params), 'utf8')
      .verify(publicKey, signature, 'base64');
  } catch {
    return false;
  }
}

export interface AlipayNotify {
  readonly outTradeNo: string;
  readonly tradeNo: string | null;
  readonly tradeStatus: string;
  readonly amountCents: number | null;
}

export function parseNotify(params: Record<string, string>): AlipayNotify {
  const total = Number(params['total_amount']);
  return {
    outTradeNo: params['out_trade_no'] ?? '',
    tradeNo: params['trade_no'] ?? null,
    tradeStatus: params['trade_status'] ?? '',
    amountCents: Number.isFinite(total) ? Math.round(total * 100) : null,
  };
}
