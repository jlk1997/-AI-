/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { DrizzleDb } from '@opengame/platform-db';
import { apiKeys } from '@opengame/platform-db';

/**
 * Public API key auth + token-bucket rate limiting.
 *
 * Keys look like `og_pk_<24-hex>.<32-hex>` — the first half is a public
 * `keyPrefix` we can index in Postgres, the second half is the secret that
 * we hash with sha256 before storing. We use `timingSafeEqual` on the hash
 * to short-circuit length-based timing attacks.
 *
 * Rate limiting is a per-key fixed-window counter in Redis with a 60s TTL.
 * This is deliberately simpler than a token bucket: it costs one INCR and
 * one EXPIRE per request, fits in a single pipeline, and matches Stripe's
 * own published model (X-RateLimit-Reset header). The slight burst at
 * window boundaries is acceptable for a public read API.
 */
const RAW_KEY_REGEX = /^og_pk_([0-9a-f]{24})\.([0-9a-f]{32,})$/i;

export interface ResolvedApiKey {
  readonly id: string;
  readonly organizationId: string;
  readonly scopes: string[];
  readonly rateLimitPerMinute: number;
  readonly keyPrefix: string;
}

export interface MintedApiKey {
  readonly rawKey: string;
  readonly keyPrefix: string;
  readonly keyHash: string;
}

export function mintApiKey(): MintedApiKey {
  const prefix = randomBytes(12).toString('hex'); // 24 hex chars
  const secret = randomBytes(20).toString('hex'); // 40 hex chars
  const rawKey = `og_pk_${prefix}.${secret}`;
  const keyHash = createHash('sha256').update(rawKey, 'utf8').digest('hex');
  return { rawKey, keyPrefix: `og_pk_${prefix}`, keyHash };
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

export async function resolveApiKey(
  db: DrizzleDb,
  rawKey: string,
): Promise<ResolvedApiKey | null> {
  const m = RAW_KEY_REGEX.exec(rawKey);
  if (!m) return null;
  const prefix = `og_pk_${m[1]}`;
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  const candidate = Buffer.from(hashApiKey(rawKey), 'hex');
  const expected = Buffer.from(row.keyHash, 'hex');
  if (candidate.length !== expected.length) return null;
  if (!timingSafeEqual(candidate, expected)) return null;

  const scopes = Array.isArray(row.scopes) ? (row.scopes as unknown[]).map(String) : [];

  return {
    id: row.id,
    organizationId: row.organizationId,
    scopes,
    rateLimitPerMinute: row.rateLimitPerMinute ?? 60,
    keyPrefix: row.keyPrefix,
  };
}

/** Updates `last_used_at` without blocking the request — fire-and-forget. */
export function touchApiKeyAsync(db: DrizzleDb, keyId: string): void {
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, keyId))
    .catch(() => {
      /* swallow: best-effort */
    });
}

export interface RateLimitResult {
  readonly ok: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetSeconds: number;
}

export async function consumeRateLimit(
  redis: Redis,
  bucketKey: string,
  limitPerMinute: number,
): Promise<RateLimitResult> {
  // Round to the current minute window so the bucket key naturally expires.
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / 60);
  const key = `rl:${bucketKey}:${window}`;
  const pipeline = redis.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, 90);
  const results = await pipeline.exec();
  const count = Number(results?.[0]?.[1] ?? 0);
  const resetSeconds = 60 - (now % 60);
  return {
    ok: count <= limitPerMinute,
    limit: limitPerMinute,
    remaining: Math.max(0, limitPerMinute - count),
    resetSeconds,
  };
}
