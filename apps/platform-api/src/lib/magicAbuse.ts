/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Magic-link minting is the overseas front door. Redis down or a missing
 * mailer must not print a login URL into production logs.
 */

import { createHash } from 'node:crypto';

import { MAGIC_LINK_TTL_SECONDS } from './magicLink.js';

export const MAGIC_EMAIL_LIMIT = 5;
export const MAGIC_IP_LIMIT = 20;
export const PHONE_OTP_LIMIT = 5;
export const PHONE_IP_LIMIT = 20;
export const PHONE_VERIFY_LIMIT = 12;
export const PHONE_VERIFY_IP_LIMIT = 40;
export const EMAIL_OTP_LIMIT = 5;
export const EMAIL_OTP_IP_LIMIT = 20;
export const EMAIL_OTP_VERIFY_LIMIT = 8;
export const EMAIL_OTP_VERIFY_IP_LIMIT = 30;
export const EMAIL_OTP_TTL_SECONDS = 600;

export interface MagicLimitRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export type MagicLimitResult = { readonly ok: true } | { readonly ok: false };

export async function consumeMagicRequestLimit(
  redis: MagicLimitRedis,
  input: { readonly email: string; readonly ip: string },
): Promise<MagicLimitResult> {
  const emailKey = `magic:req:${input.email}`;
  const ipKey = `magic:ip:${input.ip}`;
  const emailCount = await redis.incr(emailKey);
  if (emailCount === 1) await redis.expire(emailKey, MAGIC_LINK_TTL_SECONDS);
  const ipCount = await redis.incr(ipKey);
  if (ipCount === 1) await redis.expire(ipKey, 3_600);
  if (emailCount > MAGIC_EMAIL_LIMIT || ipCount > MAGIC_IP_LIMIT) {
    return { ok: false };
  }
  return { ok: true };
}

export async function consumePhoneRequestLimit(
  redis: MagicLimitRedis,
  input: { readonly phone: string; readonly ip: string },
): Promise<MagicLimitResult> {
  const phoneKey = `phone:req:${input.phone}`;
  const ipKey = `phone:ip:${input.ip}`;
  const phoneCount = await redis.incr(phoneKey);
  if (phoneCount === 1) await redis.expire(phoneKey, 3_600);
  const ipCount = await redis.incr(ipKey);
  if (ipCount === 1) await redis.expire(ipKey, 3_600);
  if (phoneCount > PHONE_OTP_LIMIT || ipCount > PHONE_IP_LIMIT) {
    return { ok: false };
  }
  return { ok: true };
}

export async function consumePhoneVerifyLimit(
  redis: MagicLimitRedis,
  input: { readonly phone: string; readonly ip: string },
): Promise<MagicLimitResult> {
  const phoneKey = `phone:verify:${input.phone}`;
  const ipKey = `phone:verify-ip:${input.ip}`;
  const phoneCount = await redis.incr(phoneKey);
  if (phoneCount === 1) await redis.expire(phoneKey, 3_600);
  const ipCount = await redis.incr(ipKey);
  if (ipCount === 1) await redis.expire(ipKey, 3_600);
  if (phoneCount > PHONE_VERIFY_LIMIT || ipCount > PHONE_VERIFY_IP_LIMIT) {
    return { ok: false };
  }
  return { ok: true };
}

export async function consumeEmailOtpRequestLimit(
  redis: MagicLimitRedis,
  input: { readonly email: string; readonly ip: string },
): Promise<MagicLimitResult> {
  const emailKey = `emailotp:req:${input.email}`;
  const ipKey = `emailotp:ip:${input.ip}`;
  const emailCount = await redis.incr(emailKey);
  if (emailCount === 1) await redis.expire(emailKey, 3_600);
  const ipCount = await redis.incr(ipKey);
  if (ipCount === 1) await redis.expire(ipKey, 3_600);
  if (emailCount > EMAIL_OTP_LIMIT || ipCount > EMAIL_OTP_IP_LIMIT) {
    return { ok: false };
  }
  return { ok: true };
}

export async function consumeEmailOtpVerifyLimit(
  redis: MagicLimitRedis,
  input: { readonly email: string; readonly ip: string },
): Promise<MagicLimitResult> {
  const emailKey = `emailotp:verify:${input.email}`;
  const ipKey = `emailotp:verify-ip:${input.ip}`;
  const emailCount = await redis.incr(emailKey);
  if (emailCount === 1) await redis.expire(emailKey, 3_600);
  const ipCount = await redis.incr(ipKey);
  if (ipCount === 1) await redis.expire(ipKey, 3_600);
  if (emailCount > EMAIL_OTP_VERIFY_LIMIT || ipCount > EMAIL_OTP_VERIFY_IP_LIMIT) {
    return { ok: false };
  }
  return { ok: true };
}

export function hashEmailForLog(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 12);
}
