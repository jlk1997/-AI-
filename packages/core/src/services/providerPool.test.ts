/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  classifyPoolFailure,
  describeProviderPool,
  isPoolExhausted,
  markPoolFailure,
  markPoolSuccess,
  orderPoolCandidates,
  resetProviderPoolHealth,
  resolveProviderPool,
  runWithProviderPool,
  withProviderPoolFailover,
} from './providerPool.js';
import { MissingProviderConfigError } from './providerConfig.js';

const POOL_ENV = {
  OPENGAME_IMAGE_PROVIDER: 'minimax',
  OPENGAME_IMAGE_API_KEY: 'sk-primary-0001',
  OPENGAME_IMAGE_API_KEYS: 'sk-primary-0002, sk-primary-0003',
  OPENGAME_FALLBACK_PROVIDER: 'doubao',
  OPENGAME_FALLBACK_API_KEY: 'volc-9999',
} satisfies NodeJS.ProcessEnv;

beforeEach(() => {
  resetProviderPoolHealth();
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('resolveProviderPool', () => {
  it('expands OPENGAME_<MOD>_API_KEYS into primary candidates and appends the fallback tier', () => {
    const pool = resolveProviderPool('image', undefined, POOL_ENV);
    expect(pool.map((e) => e.config.apiKey)).toEqual([
      'sk-primary-0001',
      'sk-primary-0002',
      'sk-primary-0003',
      'volc-9999',
    ]);
    expect(pool.map((e) => e.tier)).toEqual([
      'primary',
      'primary',
      'primary',
      'fallback',
    ]);
    // Pooled keys inherit the primary provider/base URL/model.
    expect(pool[1]!.config.provider).toBe('minimax');
    expect(pool[1]!.config.baseUrl).toBe(pool[0]!.config.baseUrl);
    expect(pool[3]!.config.provider).toBe('doubao');
  });

  it('works when only the plural form is set', () => {
    const pool = resolveProviderPool('image', undefined, {
      OPENGAME_IMAGE_PROVIDER: 'minimax',
      OPENGAME_IMAGE_API_KEYS: 'sk-a,sk-b',
    });
    expect(pool.map((e) => e.config.apiKey)).toEqual(['sk-a', 'sk-b']);
  });

  it('dedupes a key that appears in both the singular and plural forms', () => {
    const pool = resolveProviderPool('image', undefined, {
      OPENGAME_IMAGE_PROVIDER: 'minimax',
      OPENGAME_IMAGE_API_KEY: 'sk-a',
      OPENGAME_IMAGE_API_KEYS: 'sk-a,sk-b',
    });
    expect(pool.map((e) => e.config.apiKey)).toEqual(['sk-a', 'sk-b']);
  });

  it('is empty rather than throwing when nothing is configured', () => {
    expect(resolveProviderPool('video', undefined, {})).toEqual([]);
  });
});

describe('classifyPoolFailure', () => {
  it('separates arrears from rate limits', () => {
    expect(classifyPoolFailure(new Error('403 overdue balance'))).toBe('billing');
    expect(classifyPoolFailure(new Error('账号欠费，请充值'))).toBe('billing');
    expect(classifyPoolFailure(new Error('429 usage limit exceeded'))).toBe(
      'quota',
    );
    expect(classifyPoolFailure(new Error('TS2554: expected 1 argument'))).toBe(
      'error',
    );
  });
});

describe('cooldown + health ordering', () => {
  it('moves a parked key to the back and honours the cooldown window', () => {
    const pool = resolveProviderPool('image', undefined, POOL_ENV);
    const first = pool[0]!;
    markPoolFailure(first.id, new Error('429 rate limit'), {
      OPENGAME_POOL_QUOTA_COOLDOWN_MS: '60000',
    });
    const ordered = orderPoolCandidates(pool);
    expect(ordered[ordered.length - 1]!.id).toBe(first.id);
    expect(ordered[0]!.config.apiKey).toBe('sk-primary-0002');
  });

  it('keeps billing failures parked far longer than quota failures', () => {
    const pool = resolveProviderPool('image', undefined, POOL_ENV);
    const quotaId = pool[0]!.id;
    const billingId = pool[1]!.id;
    const now = 1_000_000;
    markPoolFailure(quotaId, new Error('429 rate limit'), {}, now);
    markPoolFailure(billingId, new Error('403 overdue balance'), {}, now);
    const snapshot = describeProviderPool(
      'image',
      undefined,
      POOL_ENV,
      now + 61_000,
    );
    const quota = snapshot.find((e) => e.id === quotaId)!;
    const billing = snapshot.find((e) => e.id === billingId)!;
    expect(quota.coolingDown).toBe(false);
    expect(billing.coolingDown).toBe(true);
    expect(billing.lastKind).toBe('billing');
  });

  it('recovers health on success', () => {
    const pool = resolveProviderPool('image', undefined, POOL_ENV);
    const id = pool[0]!.id;
    markPoolFailure(id, new Error('429'), {});
    markPoolSuccess(id);
    const entry = describeProviderPool('image', undefined, POOL_ENV).find(
      (e) => e.id === id,
    )!;
    expect(entry.coolingDown).toBe(false);
    expect(entry.score).toBeGreaterThan(0.6);
  });

  it('reports exhaustion only when every key is parked', () => {
    const pool = resolveProviderPool('image', undefined, POOL_ENV);
    const now = 5_000;
    expect(isPoolExhausted(pool, now)).toBe(false);
    for (const entry of pool) {
      markPoolFailure(entry.id, new Error('429'), {}, now);
    }
    expect(isPoolExhausted(pool, now + 1)).toBe(true);
  });
});

describe('runWithProviderPool', () => {
  it('rotates through keys on quota errors and stops at the first success', async () => {
    const tried: string[] = [];
    const result = await runWithProviderPool({
      modality: 'image',
      env: POOL_ENV,
      run: async (cfg) => {
        tried.push(cfg.apiKey);
        if (tried.length < 3) throw new Error('429 usage limit exceeded');
        return 'ok';
      },
    });
    expect(result).toBe('ok');
    expect(tried).toEqual([
      'sk-primary-0001',
      'sk-primary-0002',
      'sk-primary-0003',
    ]);
  });

  it('does not burn the pool on a non-quota error', async () => {
    const tried: string[] = [];
    await expect(
      runWithProviderPool({
        modality: 'image',
        env: POOL_ENV,
        run: async (cfg) => {
          tried.push(cfg.apiKey);
          throw new Error('prompt rejected: unsafe content');
        },
      }),
    ).rejects.toThrow(/unsafe content/);
    expect(tried).toHaveLength(1);
  });

  it('throws MissingProviderConfigError when the pool is empty', async () => {
    await expect(
      runWithProviderPool({ modality: 'video', env: {}, run: async () => 'x' }),
    ).rejects.toThrow(MissingProviderConfigError);
  });
});

describe('withProviderPoolFailover', () => {
  it('runs the primary first, then every other key', async () => {
    const seen: string[] = [];
    const out = await withProviderPoolFailover(
      'image',
      'minimax',
      async () => {
        seen.push('primary');
        throw new Error('429 usage limit exceeded');
      },
      async (cfg) => {
        seen.push(cfg.apiKey);
        if (cfg.apiKey === 'sk-primary-0002') {
          throw new Error('429 usage limit exceeded');
        }
        return 'done';
      },
      POOL_ENV,
    );
    expect(out).toBe('done');
    expect(seen).toEqual(['primary', 'sk-primary-0002', 'sk-primary-0003']);
  });

  it('skips a billing-parked primary, but still retries a quota-parked primary', async () => {
    const pool = resolveProviderPool('image', undefined, POOL_ENV);
    markPoolFailure(pool[0]!.id, new Error('403 overdue balance'), {});
    const seenBilling: string[] = [];
    const outBilling = await withProviderPoolFailover(
      'image',
      'minimax',
      async () => {
        seenBilling.push('primary');
        return 'primary';
      },
      async (cfg) => {
        seenBilling.push(cfg.apiKey);
        return 'pooled';
      },
      POOL_ENV,
    );
    expect(outBilling).toBe('pooled');
    expect(seenBilling).toEqual(['sk-primary-0002']);

    resetProviderPoolHealth();
    markPoolFailure(pool[0]!.id, new Error('429 usage limit exceeded'), {});
    const seenQuota: string[] = [];
    const outQuota = await withProviderPoolFailover(
      'image',
      'minimax',
      async () => {
        seenQuota.push('primary');
        return 'primary-ok';
      },
      async (cfg) => {
        seenQuota.push(cfg.apiKey);
        return 'pooled';
      },
      POOL_ENV,
    );
    // Quota cooldown must NOT skip MiniMax — it may already have recovered.
    expect(outQuota).toBe('primary-ok');
    expect(seenQuota).toEqual(['primary']);
  });

  it('behaves like a plain call when only one key exists', async () => {
    const env = {
      OPENGAME_IMAGE_PROVIDER: 'minimax',
      OPENGAME_IMAGE_API_KEY: 'sk-solo',
    };
    await expect(
      withProviderPoolFailover(
        'image',
        'minimax',
        async () => {
          throw new Error('429 usage limit exceeded');
        },
        async () => 'never',
        env,
      ),
    ).rejects.toThrow(/429/);
  });
});
