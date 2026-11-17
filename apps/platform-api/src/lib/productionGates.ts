/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production must refuse to boot with a leftover local .env. Self-host
 * development keeps the old flags; the public dual-launch must not.
 */

export function isProductionRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env['PLATFORM_RUNTIME'] === 'development') return false;
  return (
    env['PLATFORM_RUNTIME'] === 'production' || env['NODE_ENV'] === 'production'
  );
}

export function isMailerReady(env: {
  readonly mailProvider: 'none' | 'resend' | 'http' | 'smtp';
  readonly mailFrom?: string;
  readonly mailApiKey?: string;
  readonly mailEndpoint?: string;
  readonly smtpHost?: string;
  readonly smtpUser?: string;
  readonly smtpPass?: string;
}): boolean {
  if (env.mailProvider === 'none' || !env.mailFrom) return false;
  if (env.mailProvider === 'resend') return Boolean(env.mailApiKey);
  if (env.mailProvider === 'smtp') {
    return Boolean(env.smtpHost && env.smtpUser && env.smtpPass);
  }
  return Boolean(env.mailEndpoint);
}

export interface ProductionGateInput {
  readonly allowDevAuth: boolean;
  readonly allowMockPayments: boolean;
  readonly magicLinkEcho: boolean;
  readonly phoneOtpEcho: boolean;
  readonly billingEnforcePoints: boolean;
  readonly jwtSecret: string;
  readonly webBaseUrl?: string;
  readonly publicBaseUrl?: string;
  readonly allowPublicPlayUrls: boolean;
  readonly mailProvider: 'none' | 'resend' | 'http' | 'smtp';
  readonly mailFrom?: string;
  readonly mailApiKey?: string;
  readonly mailEndpoint?: string;
  readonly smtpHost?: string;
  readonly smtpUser?: string;
  readonly smtpPass?: string;
  readonly emailOtpEcho?: boolean;
  readonly authWechatOnly: boolean;
  readonly wechatAppId?: string;
  readonly wechatAppSecret?: string;
  readonly alertWebhookUrl?: string;
  readonly requireAlertWebhook?: boolean;
  readonly adminEmails?: readonly string[];
}

export function collectProductionGateFailures(
  input: ProductionGateInput,
): string[] {
  const failures: string[] = [];
  if (input.allowDevAuth) {
    failures.push('PLATFORM_ALLOW_DEV_AUTH must be false in production');
  }
  if (input.allowMockPayments) {
    failures.push('PLATFORM_ALLOW_MOCK_PAYMENTS must be false in production');
  }
  if (input.magicLinkEcho) {
    failures.push('PLATFORM_MAGIC_LINK_ECHO must be false in production');
  }
  if (input.phoneOtpEcho) {
    failures.push('PLATFORM_PHONE_OTP_ECHO must be false in production');
  }
  if (input.emailOtpEcho) {
    failures.push('PLATFORM_EMAIL_OTP_ECHO must be false in production');
  }
  if (!input.billingEnforcePoints) {
    failures.push('PLATFORM_BILLING_ENFORCE_POINTS must be true in production');
  }
  const secret = input.jwtSecret.trim();
  if (secret.length < 32 || /change-me/i.test(secret)) {
    failures.push('PLATFORM_JWT_SECRET is too weak or still the example value');
  }
  if (!input.webBaseUrl && !input.publicBaseUrl) {
    failures.push(
      'PLATFORM_WEB_BASE_URL or PLATFORM_PUBLIC_BASE_URL is required in production',
    );
  }
  if (input.allowPublicPlayUrls) {
    failures.push(
      'PLATFORM_ALLOW_PUBLIC_PLAY_URLS must stay false on a public launch',
    );
  }
  const mailReady = isMailerReady(input);
  if (input.authWechatOnly) {
    if (!input.wechatAppId || !input.wechatAppSecret) {
      failures.push(
        'PLATFORM_AUTH_WECHAT_ONLY requires PLATFORM_WECHAT_APP_ID and PLATFORM_WECHAT_APP_SECRET',
      );
    }
  } else if (!mailReady) {
    failures.push(
      'Production needs PLATFORM_MAIL_PROVIDER (or PLATFORM_AUTH_WECHAT_ONLY=true for a China-only door)',
    );
  }
  if (input.requireAlertWebhook && !input.alertWebhookUrl?.trim()) {
    failures.push('PLATFORM_ALERT_WEBHOOK_URL is required in production');
  }
  if (!input.adminEmails?.length) {
    failures.push('PLATFORM_ADMIN_EMAILS must list at least one on-call address');
  }
  return failures;
}

export function assertProductionGates(input: ProductionGateInput): void {
  const failures = collectProductionGateFailures(input);
  if (failures.length === 0) return;
  throw new Error(`Production boot refused:\n- ${failures.join('\n- ')}`);
}
