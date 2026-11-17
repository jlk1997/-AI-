/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  emailCodeEmail,
  isMailerConfigured,
  magicLinkEmail,
  sendMail,
  smtpSocketMode,
  type MailerConfig,
} from './mailer.js';
import { isPlatformAdmin } from './identity.js';

const resend: MailerConfig = {
  provider: 'resend',
  endpoint: undefined,
  apiKey: 'key_123',
  from: 'OpenGame <hi@example.com>',
};

describe('mailer configuration', () => {
  it('treats a half-configured provider as no provider', () => {
    expect(isMailerConfigured(resend)).toBe(true);
    expect(isMailerConfigured({ ...resend, apiKey: undefined })).toBe(false);
    expect(isMailerConfigured({ ...resend, from: undefined })).toBe(false);
    expect(isMailerConfigured({ ...resend, provider: 'none' })).toBe(false);
    expect(
      isMailerConfigured({
        provider: 'http',
        endpoint: 'https://mail.internal/send',
        apiKey: undefined,
        from: 'hi@example.com',
      }),
    ).toBe(true);
    expect(
      isMailerConfigured({
        provider: 'http',
        endpoint: undefined,
        apiKey: 'k',
        from: 'hi@example.com',
      }),
    ).toBe(false);
    expect(
      isMailerConfigured({
        provider: 'smtp',
        endpoint: undefined,
        apiKey: undefined,
        from: 'hi@example.com',
        smtp: { host: 'smtp.example.com', port: 465, secure: true, user: 'hi', pass: 'secret' },
      }),
    ).toBe(true);
    expect(
      isMailerConfigured({
        provider: 'smtp',
        endpoint: undefined,
        apiKey: undefined,
        from: 'hi@example.com',
        smtp: { host: 'smtp.example.com', port: 465, secure: true, user: 'hi', pass: undefined },
      }),
    ).toBe(false);
  });
});

describe('sending a sign-in code over SMTP', () => {
  it('hands the message to the SMTP sender and does not open HTTP', async () => {
    const smtp: MailerConfig = {
      provider: 'smtp',
      endpoint: undefined,
      apiKey: undefined,
      from: '隔壁 <hi@example.com>',
      smtp: { host: 'smtp.example.com', port: 465, secure: true, user: 'hi', pass: 'secret' },
    };
    const sent: Array<{ to: string; subject: string; text: string; html?: string }> = [];
    const fetchMock = vi.fn();
    const result = await sendMail(
      smtp,
      { ...emailCodeEmail('123456', 10), to: 'ada@example.com' },
      fetchMock as unknown as typeof fetch,
      async (message) => {
        sent.push(message);
      },
    );
    expect(result).toEqual({ delivered: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sent[0]?.to).toBe('ada@example.com');
    expect(sent[0]?.subject).toBe('你的隔壁登录验证码');
    expect(sent[0]?.text).toContain('123456');
    expect(sent[0]?.text).toContain('10 分钟');
    expect(sent[0]?.html).toContain('letter-spacing:10px');
    expect(sent[0]?.html).toContain('123456');
  });

  it('uses STARTTLS on port 587 and implicit TLS on 465', () => {
    expect(smtpSocketMode(587, true)).toEqual({ secure: false, requireTLS: true });
    expect(smtpSocketMode(465, true)).toEqual({ secure: true, requireTLS: false });
  });
});

describe('sending a sign-in link', () => {
  it('posts the message to the provider with the api key', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const result = await sendMail(
      resend,
      { ...magicLinkEmail('https://play.example.com/login?token=t', 15), to: 'ada@example.com' },
      fetchMock as unknown as typeof fetch,
    );
    expect(result.delivered).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer key_123');
    const body = JSON.parse(String(init.body)) as { to: string[]; text: string };
    expect(body.to).toEqual(['ada@example.com']);
    expect(body.text).toContain('https://play.example.com/login?token=t');
    expect(body.text).toContain('15 分钟');
  });

  it('reports a provider error instead of throwing', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 422 }));
    const result = await sendMail(
      resend,
      { to: 'ada@example.com', subject: 's', text: 't' },
      fetchMock as unknown as typeof fetch,
    );
    expect(result).toEqual({ delivered: false, reason: 'mail provider returned 422' });
  });

  it('reports a network failure instead of throwing', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('DNS is having a day');
    });
    const result = await sendMail(
      resend,
      { to: 'ada@example.com', subject: 's', text: 't' },
      fetchMock as unknown as typeof fetch,
    );
    expect(result).toEqual({ delivered: false, reason: 'DNS is having a day' });
  });

  it('does not call out when no provider is configured', async () => {
    const fetchMock = vi.fn();
    const result = await sendMail(
      { provider: 'none', endpoint: undefined, apiKey: undefined, from: undefined },
      { to: 'ada@example.com', subject: 's', text: 't' },
      fetchMock as unknown as typeof fetch,
    );
    expect(result.delivered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('curator allowlist', () => {
  it('is closed unless an operator opted somebody in', () => {
    expect(isPlatformAdmin({ adminEmails: [] }, 'ada@example.com')).toBe(false);
    expect(
      isPlatformAdmin({ adminEmails: ['ada@example.com'] }, ' Ada@Example.com '),
    ).toBe(true);
    expect(isPlatformAdmin({ adminEmails: ['ada@example.com'] }, 'bob@example.com')).toBe(
      false,
    );
    expect(
      isPlatformAdmin({ adminEmails: ['13800138000'] }, { email: '', phone: '13800138000' }),
    ).toBe(true);
  });
});
