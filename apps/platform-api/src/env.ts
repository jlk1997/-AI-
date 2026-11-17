/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveWorkspaceArchivePrefix } from './lib/workspaceArchiveStatus.js';
import {
  assertProductionGates,
  isProductionRuntime,
} from './lib/productionGates.js';

export type PlatformEnv = {
  readonly port: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly jwtSecret: string;
  readonly allowDevAuth: boolean;
  readonly s3Endpoint: string;
  readonly s3Region: string;
  readonly s3Bucket: string;
  readonly s3AccessKey: string;
  readonly s3SecretKey: string;
  readonly s3ForcePathStyle: boolean;
  readonly publicObjectBaseUrl: string | undefined;
  readonly publicBaseUrl: string | undefined;
  /** Where the player-facing app lives; used to build sign-in links. */
  readonly webBaseUrl: string | undefined;
  /**
   * Emails allowed to curate the community (feature / unfeature). Kept as an
   * env allowlist on purpose: a full operations console is not first-release
   * work, but hand-editing `is_featured` in SQL is not either.
   */
  readonly adminEmails: readonly string[];
  /**
   * Return the sign-in link in the API response instead of assuming mail
   * delivery. Self-hosters without SMTP need this to get in at all.
   */
  readonly magicLinkEcho: boolean;
  /** Mail for sign-in codes and links. `smtp` is the China-friendly door. */
  readonly mailProvider: 'none' | 'resend' | 'http' | 'smtp';
  readonly mailEndpoint: string | undefined;
  readonly mailApiKey: string | undefined;
  readonly mailFrom: string | undefined;
  readonly smtpHost: string | undefined;
  readonly smtpPort: number;
  readonly smtpSecure: boolean;
  readonly smtpUser: string | undefined;
  readonly smtpPass: string | undefined;
  /**
   * Return the email code in the API response. Only honored outside production.
   * Live deploys must deliver the code by mail.
   */
  readonly emailOtpEcho: boolean;
  readonly dailyJobLimitPerOrg: number;
  readonly maxConcurrentJobsPerOrg: number;
  readonly stripeApiKey: string | undefined;
  readonly stripeWebhookSecret: string | undefined;
  /** Show card checkout even on zh-CN. Keys still live in PLATFORM_STRIPE_API_KEY. */
  readonly stripeStorefront: boolean;
  /** Maps Stripe price_id → internal plan name. */
  readonly stripePriceToPlan: Record<string, string>;
  /** Plan → daily job limit. Falls back to `dailyJobLimitPerOrg`. */
  readonly planDailyJobLimits: Record<string, number>;
  /** Plan → concurrent job limit. Falls back to `maxConcurrentJobsPerOrg`. */
  readonly planMaxConcurrentJobs: Record<string, number>;
  // CDN 配置
  readonly cdnEnabled: boolean;
  readonly cdnProvider: string;
  readonly cdnZoneId: string | undefined;
  readonly cdnApiToken: string | undefined;
  readonly cdnDistributionDomain: string | undefined;
  readonly cdnCustomDomain: string | undefined;
  /**
   * WeChat Official Account. Drives share cards (JS-SDK) and, when a secret is
   * present, web OAuth sign-in. Unset means both degrade to copy-link and
   * magic-link respectively rather than failing.
   */
  readonly wechatAppId: string | undefined;
  readonly wechatAppSecret: string | undefined;
  /** Extra origins allowed to request a JS-SDK signature, beyond our own. */
  readonly wechatShareOrigins: readonly string[];
  /**
   * Escape hatch back to permanent CDN / public-object play URLs. Off by
   * default: a durable unauthenticated link to a build cannot be revoked and
   * makes published work trivial to mirror. Self-hosters who want plain static
   * hosting can turn it back on.
   */
  readonly allowPublicPlayUrls: boolean;

  /**
   * Generation credit. Points are the unit a Chinese user actually buys, and
   * they run alongside the job-count quota rather than replacing it: no points
   * means you cannot queue, but having points still cannot blow past the
   * concurrency limit.
   */
  readonly billingEnforcePoints: boolean;
  /** Job type → points charged when it is queued. */
  readonly jobPointCosts: Record<string, number>;
  /** Plan → points granted at the start of each calendar month. */
  readonly planMonthlyPoints: Record<string, number>;
  /** Plan → price in fen (RMB cents) for the monthly subscription. */
  readonly planPriceCents: Record<string, number>;
  /** Purchasable point packs: sku → { points, cents, lane }. */
  readonly pointPacks: Record<string, { points: number; cents: number }>;
  /** Share of a remix's generation spend paid to the parent author, 0–0.5. */
  readonly remixRoyaltyRate: number;

  /** WeChat Pay merchant (APIv3). Unset disables the WeChat checkout. */
  readonly wechatPayMchId: string | undefined;
  readonly wechatPayCertSerial: string | undefined;
  /** PEM private key; supports `\n`-escaped single-line env values. */
  readonly wechatPayPrivateKey: string | undefined;
  /** APIv3 key — also what authenticates the notify callback. */
  readonly wechatPayApiV3Key: string | undefined;
  readonly wechatPayNotifyUrl: string | undefined;

  /** Alipay wap pay. Unset disables the Alipay checkout. */
  readonly alipayAppId: string | undefined;
  readonly alipayPrivateKey: string | undefined;
  readonly alipayPublicKey: string | undefined;
  readonly alipayGateway: string;
  readonly alipayNotifyUrl: string | undefined;

  /**
   * Settle orders through a dev endpoint instead of a real provider. Only ever
   * true alongside dev auth — it mints money.
   */
  readonly allowMockPayments: boolean;
  /** Extra browser origins allowed to call `/v1` (production CORS). */
  readonly extraCorsOrigins: readonly string[];
  /** Same default-on prefix as the worker. `false` disables archive reads. */
  readonly workspaceArchiveKeyPrefix: string | null;
  /**
   * When set, phone OTP is delivered by this provider. Unset means production
   * must not advertise SMS — request returns 503 unless echo/dev is on.
   */
  readonly phoneSmsProvider: 'none' | 'http';
  /** Optional ops webhook for poison jobs / settle failures. */
  readonly alertWebhookUrl: string | undefined;
  /** Production dual-launch: mail is required unless this China-only door is on. */
  readonly authWechatOnly: boolean;
  readonly productionRuntime: boolean;
  /** Publish / generate age floor. Default 16. */
  readonly minAge: number;
};

/**
 * Parses `price_xxx:plan_name,price_yyy:another` into a lookup map. Returns an
 * empty object if the env var is missing or malformed (no Stripe configured).
 */
function parseStripePriceMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const [priceId, plan] = pair.split(':').map((s) => s?.trim());
    if (priceId && plan) out[priceId] = plan;
  }
  return out;
}

/**
 * Parses `plan_name:limit,other:limit` into a lookup map.
 * `fallback` is returned for plans not present in the map.
 */
function parsePlanLimitMap(
  raw: string | undefined,
  fallback: number,
): Record<string, number> {
  const out: Record<string, number> = { free: fallback };
  if (!raw) return out;
  for (const pair of raw.split(',')) {
    const [plan, limit] = pair.split(':').map((s) => s?.trim());
    const value = Number(limit);
    if (plan && Number.isFinite(value)) out[plan] = value;
  }
  return out;
}

/** Parses `a@x.com, b@y.com` into a lowercase list; empty when unset. */
function parseEmailList(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * Origin allowlist for WeChat JS-SDK signing. Our own web/public base URLs are
 * always included, so a normal deployment needs no extra configuration.
 */
function parseOriginList(
  raw: string | undefined,
  implicit: ReadonlyArray<string | undefined>,
): readonly string[] {
  const out = new Set<string>();
  const add = (value: string | undefined): void => {
    if (!value) return;
    try {
      out.add(new URL(value).origin);
    } catch {
      /* ignore malformed entries */
    }
  };
  for (const value of implicit) add(value);
  for (const value of raw?.split(',') ?? []) add(value.trim());
  return [...out];
}

/**
 * Parses `sku:points:cents` triples. A leftover fourth `:lane` segment is
 * ignored. A malformed entry is dropped rather than failing boot — a broken
 * price must not take the whole API down.
 */
function parsePointPacks(
  raw: string | undefined,
): Record<string, { points: number; cents: number }> {
  const out: Record<string, { points: number; cents: number }> = {};
  if (!raw) {
    return {
      pack_kai: { points: 80, cents: 600 },
      pack_small: { points: 120, cents: 900 },
      pack_plus: { points: 200, cents: 1800 },
    };
  }
  for (const entry of raw.split(',')) {
    const [sku, points, cents] = entry.split(':').map((s) => s?.trim());
    const p = Number(points);
    const c = Number(cents);
    if (sku && Number.isFinite(p) && Number.isFinite(c) && p > 0 && c > 0) {
      out[sku] = { points: p, cents: c };
    }
  }
  return out;
}

/** Reads a PEM key that may arrive with literal `\n` escapes from a .env file. */
function parsePem(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  return value.trim().length > 0 ? value : undefined;
}

/** Unknown values mean "no mail service" rather than a boot failure. */
function parseMailProvider(
  raw: string | undefined,
): 'none' | 'resend' | 'http' | 'smtp' {
  if (raw === 'resend' || raw === 'http' || raw === 'smtp') return raw;
  return 'none';
}

export function readPlatformEnv(): PlatformEnv {
  const databaseUrl = process.env['PLATFORM_DATABASE_URL'];
  const redisUrl = process.env['PLATFORM_REDIS_URL'];
  const jwtSecret = process.env['PLATFORM_JWT_SECRET'];
  if (!databaseUrl || !redisUrl || !jwtSecret) {
    throw new Error(
      'Missing PLATFORM_DATABASE_URL, PLATFORM_REDIS_URL, or PLATFORM_JWT_SECRET',
    );
  }
  if (jwtSecret.length < 32) {
    throw new Error('PLATFORM_JWT_SECRET must be at least 32 characters');
  }
  const s3Endpoint = process.env['PLATFORM_S3_ENDPOINT'];
  const s3Bucket = process.env['PLATFORM_S3_BUCKET'];
  const s3AccessKey = process.env['PLATFORM_S3_ACCESS_KEY'];
  const s3SecretKey = process.env['PLATFORM_S3_SECRET_KEY'];
  if (!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey) {
    throw new Error(
      'Missing PLATFORM_S3_ENDPOINT, PLATFORM_S3_BUCKET, PLATFORM_S3_ACCESS_KEY, or PLATFORM_S3_SECRET_KEY',
    );
  }
  const productionRuntime = isProductionRuntime();
  const minAgeRaw = Number(process.env['PLATFORM_MIN_AGE'] ?? 16);
  const env: PlatformEnv = {
    port: Number(process.env['PLATFORM_API_PORT'] ?? 3847),
    databaseUrl,
    redisUrl,
    jwtSecret,
    allowDevAuth: process.env['PLATFORM_ALLOW_DEV_AUTH'] === 'true',
    s3Endpoint,
    s3Region: process.env['PLATFORM_S3_REGION'] ?? 'us-east-1',
    s3Bucket,
    s3AccessKey,
    s3SecretKey,
    s3ForcePathStyle: process.env['PLATFORM_S3_FORCE_PATH_STYLE'] !== 'false',
    publicObjectBaseUrl: process.env['PLATFORM_PUBLIC_OBJECT_BASE_URL'],
    publicBaseUrl: process.env['PLATFORM_PUBLIC_BASE_URL'],
    webBaseUrl: process.env['PLATFORM_WEB_BASE_URL'],
    adminEmails: parseEmailList(process.env['PLATFORM_ADMIN_EMAILS']),
    magicLinkEcho: process.env['PLATFORM_MAGIC_LINK_ECHO'] === 'true',
    mailProvider: parseMailProvider(process.env['PLATFORM_MAIL_PROVIDER']),
    mailEndpoint: process.env['PLATFORM_MAIL_ENDPOINT'],
    mailApiKey: process.env['PLATFORM_MAIL_API_KEY'],
    mailFrom: process.env['PLATFORM_MAIL_FROM'],
    smtpHost: process.env['PLATFORM_SMTP_HOST']?.trim() || undefined,
    smtpPort: Number(process.env['PLATFORM_SMTP_PORT'] ?? 465) || 465,
    smtpSecure:
      process.env['PLATFORM_SMTP_SECURE'] === undefined
        ? (Number(process.env['PLATFORM_SMTP_PORT'] ?? 465) || 465) === 465
        : process.env['PLATFORM_SMTP_SECURE'] === 'true',
    smtpUser: process.env['PLATFORM_SMTP_USER']?.trim() || undefined,
    smtpPass: process.env['PLATFORM_SMTP_PASS'],
    emailOtpEcho:
      !productionRuntime && process.env['PLATFORM_EMAIL_OTP_ECHO'] === 'true',
    dailyJobLimitPerOrg: Number(
      process.env['PLATFORM_DAILY_JOB_LIMIT_PER_ORG'] ?? 500,
    ),
    maxConcurrentJobsPerOrg: Number(
      process.env['PLATFORM_MAX_CONCURRENT_JOBS_PER_ORG'] ?? 2,
    ),
    stripeApiKey: process.env['PLATFORM_STRIPE_API_KEY'],
    stripeWebhookSecret: process.env['PLATFORM_STRIPE_WEBHOOK_SECRET'],
    stripeStorefront: process.env['PLATFORM_BILLING_STRIPE_STOREFRONT'] === 'true',
    stripePriceToPlan: parseStripePriceMap(process.env['PLATFORM_STRIPE_PRICE_MAP']),
    planDailyJobLimits: parsePlanLimitMap(
      process.env['PLATFORM_PLAN_DAILY_LIMITS'],
      Number(process.env['PLATFORM_DAILY_JOB_LIMIT_PER_ORG'] ?? 500),
    ),
    planMaxConcurrentJobs: parsePlanLimitMap(
      process.env['PLATFORM_PLAN_CONCURRENCY_LIMITS'],
      Number(process.env['PLATFORM_MAX_CONCURRENT_JOBS_PER_ORG'] ?? 2),
    ),
    // CDN 配置
    cdnEnabled: process.env['PLATFORM_CDN_ENABLED'] === 'true',
    cdnProvider: process.env['PLATFORM_CDN_PROVIDER'] ?? 'custom',
    cdnZoneId: process.env['PLATFORM_CDN_ZONE_ID'],
    cdnApiToken: process.env['PLATFORM_CDN_API_TOKEN'],
    cdnDistributionDomain: process.env['PLATFORM_CDN_DISTRIBUTION_DOMAIN'],
    cdnCustomDomain: process.env['PLATFORM_CDN_CUSTOM_DOMAIN'],
    wechatAppId: process.env['PLATFORM_WECHAT_APP_ID'],
    wechatAppSecret: process.env['PLATFORM_WECHAT_APP_SECRET'],
    wechatShareOrigins: parseOriginList(
      process.env['PLATFORM_WECHAT_SHARE_ORIGINS'],
      [process.env['PLATFORM_WEB_BASE_URL'], process.env['PLATFORM_PUBLIC_BASE_URL']],
    ),
    allowPublicPlayUrls: process.env['PLATFORM_ALLOW_PUBLIC_PLAY_URLS'] === 'true',

    // Opt-in: a self-hosted install that upgrades into this release must not
    // suddenly refuse to generate because nobody has bought points yet.
    billingEnforcePoints: process.env['PLATFORM_BILLING_ENFORCE_POINTS'] === 'true',
    jobPointCosts: {
      generate: 10,
      world_generate: 20,
      world_edit: 6,
      world_train: 4,
      world_society_run: 2,
      build: 1,
      publish: 0,
      bench: 2,
      ...parsePlanLimitMap(process.env['PLATFORM_JOB_POINT_COSTS'], 0),
    },
    planMonthlyPoints: {
      free: 40,
      creator: 800,
      studio: 4000,
      ...parsePlanLimitMap(process.env['PLATFORM_PLAN_MONTHLY_POINTS'], 40),
    },
    planPriceCents: {
      creator: 3900,
      studio: 19900,
      ...parsePlanLimitMap(process.env['PLATFORM_PLAN_PRICES'], 0),
    },
    pointPacks: parsePointPacks(process.env['PLATFORM_POINT_PACKS']),
    remixRoyaltyRate: Math.min(
      0.5,
      Math.max(0, Number(process.env['PLATFORM_REMIX_ROYALTY_RATE'] ?? 0.1)),
    ),

    wechatPayMchId: process.env['PLATFORM_WECHAT_PAY_MCH_ID'],
    wechatPayCertSerial: process.env['PLATFORM_WECHAT_PAY_CERT_SERIAL'],
    wechatPayPrivateKey: parsePem(process.env['PLATFORM_WECHAT_PAY_PRIVATE_KEY']),
    wechatPayApiV3Key: process.env['PLATFORM_WECHAT_PAY_APIV3_KEY'],
    wechatPayNotifyUrl: process.env['PLATFORM_WECHAT_PAY_NOTIFY_URL'],

    alipayAppId: process.env['PLATFORM_ALIPAY_APP_ID'],
    alipayPrivateKey: parsePem(process.env['PLATFORM_ALIPAY_PRIVATE_KEY']),
    alipayPublicKey: parsePem(process.env['PLATFORM_ALIPAY_PUBLIC_KEY']),
    alipayGateway:
      process.env['PLATFORM_ALIPAY_GATEWAY'] ?? 'https://openapi.alipay.com/gateway.do',
    alipayNotifyUrl: process.env['PLATFORM_ALIPAY_NOTIFY_URL'],

    allowMockPayments:
      process.env['PLATFORM_ALLOW_MOCK_PAYMENTS'] === 'true' &&
      process.env['PLATFORM_ALLOW_DEV_AUTH'] === 'true',
    extraCorsOrigins: parseOriginList(process.env['PLATFORM_CORS_ORIGINS'], []),
    workspaceArchiveKeyPrefix: resolveWorkspaceArchivePrefix(
      process.env['PLATFORM_WORKSPACE_ARCHIVE_PREFIX'],
    ),
    phoneSmsProvider: process.env['PLATFORM_SMS_PROVIDER'] === 'http' ? 'http' : 'none',
    alertWebhookUrl: process.env['PLATFORM_ALERT_WEBHOOK_URL'],
    authWechatOnly: process.env['PLATFORM_AUTH_WECHAT_ONLY'] === 'true',
    productionRuntime,
    minAge: Number.isFinite(minAgeRaw) && minAgeRaw >= 13 ? Math.floor(minAgeRaw) : 16,
  };
  if (productionRuntime) {
    assertProductionGates({
      allowDevAuth: env.allowDevAuth,
      allowMockPayments: env.allowMockPayments,
      magicLinkEcho: env.magicLinkEcho,
      phoneOtpEcho: process.env['PLATFORM_PHONE_OTP_ECHO'] === 'true',
      billingEnforcePoints: env.billingEnforcePoints,
      jwtSecret: env.jwtSecret,
      webBaseUrl: env.webBaseUrl,
      publicBaseUrl: env.publicBaseUrl,
      allowPublicPlayUrls: env.allowPublicPlayUrls,
      mailProvider: env.mailProvider,
      mailFrom: env.mailFrom,
      mailApiKey: env.mailApiKey,
      mailEndpoint: env.mailEndpoint,
      smtpHost: env.smtpHost,
      smtpUser: env.smtpUser,
      smtpPass: env.smtpPass,
      emailOtpEcho: process.env['PLATFORM_EMAIL_OTP_ECHO'] === 'true',
      authWechatOnly: env.authWechatOnly,
      wechatAppId: env.wechatAppId,
      wechatAppSecret: env.wechatAppSecret,
      alertWebhookUrl: env.alertWebhookUrl,
      requireAlertWebhook: true,
      adminEmails: env.adminEmails,
    });
  }
  return env;
}
