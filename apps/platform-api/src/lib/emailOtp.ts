/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Email sign-in is a 6-digit code, not a link and not "type any address".
 * The code lives in Redis for ten minutes and is deleted on the first check.
 */

import { timingSafeEqual } from 'node:crypto';

import {
  EMAIL_OTP_TTL_SECONDS,
  consumeEmailOtpRequestLimit,
  consumeEmailOtpVerifyLimit,
  type MagicLimitRedis,
} from './magicAbuse.js';
import {
  emailCodeEmail,
  isMailerConfigured,
  sendMail,
  type MailerConfig,
  type SmtpSender,
} from './mailer.js';

export const EMAIL_OTP_KEY_PREFIX = 'email:otp:';

export interface EmailOtpRedis extends MagicLimitRedis {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

export type EmailOtpFailure = {
  readonly ok: false;
  readonly status: 400 | 401 | 429 | 503;
  readonly message: string;
};

export function mintEmailCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Constant-time compare. A missing or wrong-length code is simply false. */
export function emailCodesMatch(expected: string | null, given: string): boolean {
  if (!expected || expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

export async function requestEmailCode(input: {
  readonly redis: EmailOtpRedis;
  readonly email: string;
  readonly ip: string;
  readonly mailer: MailerConfig;
  readonly echo: boolean;
  readonly smtpSend?: SmtpSender;
}): Promise<
  | {
      readonly ok: true;
      readonly expiresInSeconds: number;
      readonly code: string | null;
      readonly delivery: 'email' | 'echo';
    }
  | EmailOtpFailure
> {
  let limited: { ok: boolean };
  try {
    limited = await consumeEmailOtpRequestLimit(input.redis, {
      email: input.email,
      ip: input.ip,
    });
  } catch {
    return { ok: false, status: 503, message: 'Sign-in store unavailable' };
  }
  if (!limited.ok) {
    return { ok: false, status: 429, message: 'Too many codes requested. Try again later.' };
  }
  const canSend = isMailerConfigured(input.mailer);
  if (!canSend && !input.echo) {
    return { ok: false, status: 503, message: 'Sign-in mail is not configured' };
  }
  const code = mintEmailCode();
  const minutes = Math.max(1, Math.round(EMAIL_OTP_TTL_SECONDS / 60));
  try {
    await input.redis.set(
      `${EMAIL_OTP_KEY_PREFIX}${input.email}`,
      code,
      'EX',
      EMAIL_OTP_TTL_SECONDS,
    );
  } catch {
    return { ok: false, status: 503, message: 'Sign-in store unavailable' };
  }
  if (canSend) {
    const result = await sendMail(
      input.mailer,
      { ...emailCodeEmail(code, minutes), to: input.email },
      fetch,
      input.smtpSend,
    );
    if (!result.delivered) {
      if (!input.echo) {
        await input.redis.del(`${EMAIL_OTP_KEY_PREFIX}${input.email}`).catch(() => undefined);
        return { ok: false, status: 503, message: 'Sign-in mail is down. Try again shortly.' };
      }
    } else {
      return {
        ok: true,
        expiresInSeconds: EMAIL_OTP_TTL_SECONDS,
        code: input.echo ? code : null,
        delivery: 'email',
      };
    }
  }
  return {
    ok: true,
    expiresInSeconds: EMAIL_OTP_TTL_SECONDS,
    code,
    delivery: 'echo',
  };
}

export async function verifyEmailCode(input: {
  readonly redis: EmailOtpRedis;
  readonly email: string;
  readonly code: string;
  readonly ip: string;
}): Promise<{ readonly ok: true; readonly email: string } | EmailOtpFailure> {
  if (!/^\d{6}$/.test(input.code)) {
    return { ok: false, status: 400, message: 'A 6-digit code is required' };
  }
  let limited: { ok: boolean };
  try {
    limited = await consumeEmailOtpVerifyLimit(input.redis, {
      email: input.email,
      ip: input.ip,
    });
  } catch {
    return { ok: false, status: 503, message: 'Sign-in store unavailable' };
  }
  if (!limited.ok) {
    return { ok: false, status: 429, message: 'Too many code checks. Try again later.' };
  }
  let expected: string | null;
  try {
    expected = await input.redis.getdel(`${EMAIL_OTP_KEY_PREFIX}${input.email}`);
  } catch {
    return { ok: false, status: 503, message: 'Sign-in store unavailable' };
  }
  if (!emailCodesMatch(expected, input.code)) {
    return { ok: false, status: 401, message: 'code expired or wrong' };
  }
  return { ok: true, email: input.email };
}
