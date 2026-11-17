/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  consumeMagicRequestLimit,
  consumePhoneRequestLimit,
  consumePhoneVerifyLimit,
  hashEmailForLog,
  MAGIC_EMAIL_LIMIT,
  PHONE_OTP_LIMIT,
  PHONE_VERIFY_LIMIT,
} from './magicAbuse.js';

describe('magicAbuse', () => {
  it('caps one address and one IP independently', async () => {
    const counts = new Map<string, number>();
    const redis = {
      incr: async (key: string) => {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return next;
      },
      expire: async () => 1,
    };
    for (let i = 0; i < MAGIC_EMAIL_LIMIT; i += 1) {
      expect(
        await consumeMagicRequestLimit(redis, {
          email: 'a@x.com',
          ip: '1.1.1.1',
        }),
      ).toEqual({ ok: true });
    }
    expect(
      await consumeMagicRequestLimit(redis, { email: 'a@x.com', ip: '1.1.1.1' }),
    ).toEqual({ ok: false });
    expect(
      await consumeMagicRequestLimit(redis, { email: 'b@x.com', ip: '1.1.1.1' }),
    ).toEqual({ ok: true });
  });

  it('caps phone OTP minting per number and IP', async () => {
    const counts = new Map<string, number>();
    const redis = {
      incr: async (key: string) => {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return next;
      },
      expire: async () => 1,
    };
    for (let i = 0; i < PHONE_OTP_LIMIT; i += 1) {
      expect(
        await consumePhoneRequestLimit(redis, { phone: '13800138000', ip: '2.2.2.2' }),
      ).toEqual({ ok: true });
    }
    expect(
      await consumePhoneRequestLimit(redis, { phone: '13800138000', ip: '2.2.2.2' }),
    ).toEqual({ ok: false });
  });

  it('caps phone OTP guesses per number', async () => {
    const counts = new Map<string, number>();
    const redis = {
      incr: async (key: string) => {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return next;
      },
      expire: async () => 1,
    };
    for (let i = 0; i < PHONE_VERIFY_LIMIT; i += 1) {
      expect(
        await consumePhoneVerifyLimit(redis, { phone: '13800138000', ip: '2.2.2.2' }),
      ).toEqual({ ok: true });
    }
    expect(
      await consumePhoneVerifyLimit(redis, { phone: '13800138000', ip: '2.2.2.2' }),
    ).toEqual({ ok: false });
  });

  it('logs a hash, never the address', () => {
    const hash = hashEmailForLog('Player@Example.com');
    expect(hash).toHaveLength(12);
    expect(hash).not.toContain('@');
    expect(hash).not.toContain('player');
  });
});
