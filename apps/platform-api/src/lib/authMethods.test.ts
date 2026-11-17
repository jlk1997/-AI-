/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { authMethodFlags, devTokenAllowed, type AuthMethodEnv } from './authMethods.js';

const base: AuthMethodEnv = {
  allowDevAuth: true,
  productionRuntime: false,
  authWechatOnly: false,
  wechatAppId: undefined,
  wechatAppSecret: undefined,
  phoneSmsProvider: 'none',
  minAge: 16,
  mailProvider: 'smtp',
  mailEndpoint: undefined,
  mailApiKey: undefined,
  mailFrom: '隔壁 <hi@example.com>',
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: 'hi',
  smtpPass: 'secret',
};

describe('auth methods', () => {
  it('never advertises direct login, even when dev auth is on', () => {
    expect(authMethodFlags(base).direct).toBe(false);
    expect(authMethodFlags(base).emailCode).toBe(true);
    expect(authMethodFlags(base).phone).toBe(false);
  });

  it('advertises phone only when a real SMS provider is configured', () => {
    expect(authMethodFlags({ ...base, phoneSmsProvider: 'http' }).phone).toBe(true);
    expect(authMethodFlags({ ...base, allowDevAuth: false }).phone).toBe(false);
  });

  it('keeps the dev token for local tests and closes it in production', () => {
    expect(devTokenAllowed(base)).toBe(true);
    expect(devTokenAllowed({ ...base, allowDevAuth: false })).toBe(false);
    expect(devTokenAllowed({ ...base, productionRuntime: true })).toBe(false);
  });
});
