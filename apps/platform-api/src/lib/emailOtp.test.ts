/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { requestEmailCode, verifyEmailCode, type EmailOtpRedis } from './emailOtp.js';
import type { MailerConfig } from './mailer.js';

class MemoryRedis implements EmailOtpRedis {
  readonly counts = new Map<string, number>();
  readonly values = new Map<string, string>();
  fail = false;

  async incr(key: string): Promise<number> {
    if (this.fail) throw new Error('redis down');
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }
  async expire(): Promise<unknown> {
    return 1;
  }
  async set(key: string, value: string): Promise<unknown> {
    if (this.fail) throw new Error('redis down');
    this.values.set(key, value);
    return 'OK';
  }
  async getdel(key: string): Promise<string | null> {
    if (this.fail) throw new Error('redis down');
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
  async del(key: string): Promise<unknown> {
    this.values.delete(key);
    return 1;
  }
}

const smtp: MailerConfig = {
  provider: 'smtp',
  endpoint: undefined,
  apiKey: undefined,
  from: '隔壁 <hi@example.com>',
  smtp: { host: 'smtp.example.com', port: 465, secure: true, user: 'hi', pass: 'secret' },
};

const none: MailerConfig = {
  provider: 'none',
  endpoint: undefined,
  apiKey: undefined,
  from: undefined,
};

describe('email code sign-in', () => {
  it('sends a code and accepts it once', async () => {
    const redis = new MemoryRedis();
    const sent: string[] = [];
    const requested = await requestEmailCode({
      redis,
      email: 'ada@example.com',
      ip: '1.1.1.1',
      mailer: smtp,
      echo: false,
      smtpSend: async (message) => {
        sent.push(message.text);
      },
    });
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    expect(requested.code).toBeNull();
    expect(requested.delivery).toBe('email');
    const code = sent[0]?.match(/\d{6}/)?.[0] ?? '';
    const verified = await verifyEmailCode({
      redis,
      email: 'ada@example.com',
      code,
      ip: '1.1.1.1',
    });
    expect(verified).toEqual({ ok: true, email: 'ada@example.com' });
    const again = await verifyEmailCode({
      redis,
      email: 'ada@example.com',
      code,
      ip: '1.1.1.1',
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.status).toBe(401);
  });

  it('rejects a wrong code and burns the stored one', async () => {
    const redis = new MemoryRedis();
    await requestEmailCode({
      redis,
      email: 'ada@example.com',
      ip: '1.1.1.1',
      mailer: smtp,
      echo: true,
      smtpSend: async () => undefined,
    });
    const wrong = await verifyEmailCode({
      redis,
      email: 'ada@example.com',
      code: '000000',
      ip: '1.1.1.1',
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.status).toBe(401);
    expect(redis.values.size).toBe(0);
  });

  it('treats a missing code as expired', async () => {
    const redis = new MemoryRedis();
    const missing = await verifyEmailCode({
      redis,
      email: 'ada@example.com',
      code: '123456',
      ip: '1.1.1.1',
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toMatch(/expired/);
  });

  it('rate-limits repeated requests', async () => {
    const redis = new MemoryRedis();
    let last: Awaited<ReturnType<typeof requestEmailCode>> | undefined;
    for (let i = 0; i < 6; i += 1) {
      last = await requestEmailCode({
        redis,
        email: 'ada@example.com',
        ip: '1.1.1.1',
        mailer: none,
        echo: true,
      });
    }
    expect(last?.ok).toBe(false);
    if (last && !last.ok) expect(last.status).toBe(429);
  });

  it('refuses to mint a code when mail is not configured and echo is off', async () => {
    const redis = new MemoryRedis();
    const result = await requestEmailCode({
      redis,
      email: 'ada@example.com',
      ip: '1.1.1.1',
      mailer: none,
      echo: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
    expect(redis.values.size).toBe(0);
  });
});
