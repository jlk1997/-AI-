/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Last verified WeChat / Alipay notify, kept so a missed credit can be
 * replayed from the wallet without asking the provider again.
 */

import type { Redis } from 'ioredis';

export const PAY_NOTIFY_TTL_SECONDS = 7 * 24 * 60 * 60;

export type StoredPayNotify = {
  readonly outTradeNo: string;
  readonly transactionId?: string | null;
  readonly amountCents?: number | null;
  readonly raw?: unknown;
};

export function payNotifyRedisKey(outTradeNo: string): string {
  return `pay:notify:${outTradeNo}`;
}

export async function rememberPayNotify(
  redis: Redis,
  payload: StoredPayNotify,
): Promise<void> {
  const outTradeNo = payload.outTradeNo.trim();
  if (!outTradeNo) return;
  await redis.set(
    payNotifyRedisKey(outTradeNo),
    JSON.stringify(payload),
    'EX',
    PAY_NOTIFY_TTL_SECONDS,
  );
}

export async function readPayNotify(
  redis: Redis,
  outTradeNo: string,
): Promise<StoredPayNotify | null> {
  const raw = await redis.get(payNotifyRedisKey(outTradeNo.trim()));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPayNotify;
    if (!parsed?.outTradeNo) return null;
    return parsed;
  } catch {
    return null;
  }
}
