/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * What the login page is allowed to offer. Direct email entry is never one of
 * them: a typed address is not proof that the person owns it.
 */

import { isMailerConfigured, type MailerConfig } from './mailer.js';

export interface AuthMethodEnv {
  readonly allowDevAuth: boolean;
  readonly productionRuntime: boolean;
  readonly authWechatOnly: boolean;
  readonly wechatAppId: string | undefined;
  readonly wechatAppSecret: string | undefined;
  readonly phoneSmsProvider: 'none' | 'http';
  readonly minAge: number;
  readonly mailProvider: MailerConfig['provider'];
  readonly mailEndpoint: string | undefined;
  readonly mailApiKey: string | undefined;
  readonly mailFrom: string | undefined;
  readonly smtpHost: string | undefined;
  readonly smtpPort: number;
  readonly smtpSecure: boolean;
  readonly smtpUser: string | undefined;
  readonly smtpPass: string | undefined;
}

export function mailerFromAuthEnv(env: AuthMethodEnv): MailerConfig {
  return {
    provider: env.mailProvider,
    endpoint: env.mailEndpoint,
    apiKey: env.mailApiKey,
    from: env.mailFrom,
    smtp: {
      host: env.smtpHost ?? '',
      port: env.smtpPort,
      secure: env.smtpSecure,
      user: env.smtpUser,
      pass: env.smtpPass,
    },
  };
}

/** Dev token exists for local automated tests only, never a public door. */
export function devTokenAllowed(env: {
  readonly allowDevAuth: boolean;
  readonly productionRuntime: boolean;
}): boolean {
  return env.allowDevAuth && !env.productionRuntime;
}

export function authMethodFlags(env: AuthMethodEnv): {
  readonly magic: boolean;
  readonly wechat: boolean;
  readonly phone: boolean;
  readonly direct: false;
  readonly emailCode: boolean;
  readonly minAge: number;
} {
  return {
    magic: !env.authWechatOnly || env.allowDevAuth,
    wechat: Boolean(env.wechatAppId && env.wechatAppSecret),
    phone: env.phoneSmsProvider !== 'none',
    direct: false,
    emailCode: isMailerConfigured(mailerFromAuthEnv(env)),
    minAge: env.minAge,
  };
}
