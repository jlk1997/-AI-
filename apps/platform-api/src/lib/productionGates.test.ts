/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  collectProductionGateFailures,
  isMailerReady,
  isProductionRuntime,
} from './productionGates.js';

const ok = {
  allowDevAuth: false,
  allowMockPayments: false,
  magicLinkEcho: false,
  phoneOtpEcho: false,
  billingEnforcePoints: true,
  jwtSecret: 'a'.repeat(32),
  webBaseUrl: 'https://gebi.example',
  allowPublicPlayUrls: false,
  mailProvider: 'resend' as const,
  mailFrom: 'Gebi <hi@gebi.example>',
  mailApiKey: 're_test',
  authWechatOnly: false,
  requireAlertWebhook: true,
  alertWebhookUrl: 'https://hooks.example/ops',
  adminEmails: ['ops@gebi.example'],
};

describe('productionGates', () => {
  it('treats PLATFORM_RUNTIME=development as not production even if NODE_ENV is', () => {
    expect(
      isProductionRuntime({
        NODE_ENV: 'production',
        PLATFORM_RUNTIME: 'development',
      }),
    ).toBe(false);
    expect(isProductionRuntime({ PLATFORM_RUNTIME: 'production' })).toBe(true);
  });

  it('accepts a dual-launch mail + billing setup', () => {
    expect(collectProductionGateFailures(ok)).toEqual([]);
  });

  it('refuses leftover local flags', () => {
    const failures = collectProductionGateFailures({
      ...ok,
      allowDevAuth: true,
      magicLinkEcho: true,
      phoneOtpEcho: true,
      billingEnforcePoints: false,
      jwtSecret: 'change-me-to-a-long-random-string-at-least-32-chars',
    });
    expect(failures.join(' ')).toMatch(/DEV_AUTH/);
    expect(failures.join(' ')).toMatch(/MAGIC_LINK_ECHO/);
    expect(failures.join(' ')).toMatch(/PHONE_OTP_ECHO/);
    expect(failures.join(' ')).toMatch(/BILLING_ENFORCE/);
    expect(failures.join(' ')).toMatch(/JWT_SECRET/);
  });

  it('allows WeChat-only China door without mail', () => {
    expect(
      collectProductionGateFailures({
        ...ok,
        mailProvider: 'none',
        mailApiKey: undefined,
        authWechatOnly: true,
        wechatAppId: 'wx123',
        wechatAppSecret: 'secret',
      }),
    ).toEqual([]);
    expect(isMailerReady({ mailProvider: 'none' })).toBe(false);
  });

  it('refuses a public launch with nobody on reports duty', () => {
    expect(
      collectProductionGateFailures({ ...ok, adminEmails: [] }).join(' '),
    ).toMatch(/ADMIN_EMAILS/);
  });
});
