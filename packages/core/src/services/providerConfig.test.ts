/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  MissingProviderConfigError,
  resolveProviderConfig,
  tryResolveProviderConfig,
  resolveFallbackProviderConfig,
  withProviderFailover,
  getProviderStatus,
  getAllProvidersStatus,
  ALL_MODALITIES,
} from './providerConfig.js';

describe('resolveProviderConfig', () => {
  it('throws an actionable error when nothing is configured', () => {
    expect(() => resolveProviderConfig('image', undefined, {})).toThrow(
      MissingProviderConfigError,
    );
    expect(() => resolveProviderConfig('image', undefined, {})).toThrow(
      /OPENGAME_IMAGE_PROVIDER/,
    );
  });

  it('returns undefined for tryResolve when nothing is configured', () => {
    expect(tryResolveProviderConfig('image', undefined, {})).toBeUndefined();
  });

  it('reads tongyi config from per-modality env vars', () => {
    const env = {
      OPENGAME_IMAGE_PROVIDER: 'tongyi',
      OPENGAME_IMAGE_API_KEY: 'sk-aliyun',
    };
    const cfg = resolveProviderConfig('image', undefined, env);
    expect(cfg.provider).toBe('tongyi');
    expect(cfg.apiKey).toBe('sk-aliyun');
    expect(cfg.baseUrl).toBe('https://dashscope.aliyuncs.com');
    expect(cfg.model).toBe('wan2.5-t2i-preview');
  });

  it('falls back to settings.json when env vars are absent', () => {
    const cfg = resolveProviderConfig(
      'reasoning',
      {
        reasoning: {
          provider: 'doubao',
          apiKey: 'volc-key',
        },
      },
      {},
    );
    expect(cfg.provider).toBe('doubao');
    expect(cfg.apiKey).toBe('volc-key');
    expect(cfg.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3');
    expect(cfg.model).toBe('doubao-seed-2-1-pro-260628');
  });

  it('lets env vars override settings.json field-by-field', () => {
    const cfg = resolveProviderConfig(
      'image',
      {
        image: {
          provider: 'tongyi',
          apiKey: 'settings-key',
          model: 'settings-model',
        },
      },
      { OPENGAME_IMAGE_API_KEY: 'env-key' },
    );
    expect(cfg.apiKey).toBe('env-key');
    expect(cfg.model).toBe('settings-model'); // settings still wins for model
    expect(cfg.provider).toBe('tongyi');
  });

  it('infers tongyi when only the legacy DASHSCOPE_API_KEY is set', () => {
    const cfg = resolveProviderConfig('image', undefined, {
      DASHSCOPE_API_KEY: 'legacy-key',
    });
    expect(cfg.provider).toBe('tongyi');
    expect(cfg.apiKey).toBe('legacy-key');
  });

  it('requires a base URL and model for openai-compat', () => {
    expect(() =>
      resolveProviderConfig('image', undefined, {
        OPENGAME_IMAGE_PROVIDER: 'openai-compat',
        OPENGAME_IMAGE_API_KEY: 'sk-...',
      }),
    ).toThrow(/base URL/);

    expect(() =>
      resolveProviderConfig('image', undefined, {
        OPENGAME_IMAGE_PROVIDER: 'openai-compat',
        OPENGAME_IMAGE_API_KEY: 'sk-...',
        OPENGAME_IMAGE_BASE_URL: 'https://api.openai.com/v1',
      }),
    ).toThrow(/model/);
  });

  it('applies MiniMax built-in defaults when only provider + key are set', () => {
    const cfg = resolveProviderConfig('image', undefined, {
      OPENGAME_IMAGE_PROVIDER: 'minimax',
      OPENGAME_IMAGE_API_KEY: 'sk-mm',
    });
    expect(cfg.provider).toBe('minimax');
    expect(cfg.apiKey).toBe('sk-mm');
    expect(cfg.baseUrl).toBe('https://api.minimaxi.com');
    expect(cfg.model).toBe('image-01');
  });

  it('accepts a fully-specified openai-compat config', () => {
    const cfg = resolveProviderConfig('image', undefined, {
      OPENGAME_IMAGE_PROVIDER: 'openai-compat',
      OPENGAME_IMAGE_API_KEY: 'sk-...',
      OPENGAME_IMAGE_BASE_URL: 'https://api.openai.com/v1/',
      OPENGAME_IMAGE_MODEL: 'dall-e-3',
    });
    expect(cfg.provider).toBe('openai-compat');
    expect(cfg.baseUrl).toBe('https://api.openai.com/v1'); // trailing slash trimmed
    expect(cfg.model).toBe('dall-e-3');
  });

  it('rejects an unknown provider name in env', () => {
    // Unknown providers are ignored and fall through to legacy inference.
    // With no legacy key set, that means we hit MissingProviderConfigError.
    expect(() =>
      resolveProviderConfig('image', undefined, {
        OPENGAME_IMAGE_PROVIDER: 'midjourney',
        OPENGAME_IMAGE_API_KEY: 'sk-...',
      }),
    ).toThrow(MissingProviderConfigError);
  });

  it('resolves all four modalities independently', () => {
    const env = {
      OPENGAME_REASONING_PROVIDER: 'openai-compat',
      OPENGAME_REASONING_API_KEY: 'k1',
      OPENGAME_REASONING_BASE_URL: 'https://api.openai.com/v1',
      OPENGAME_REASONING_MODEL: 'gpt-4o-mini',
      OPENGAME_IMAGE_PROVIDER: 'tongyi',
      OPENGAME_IMAGE_API_KEY: 'k2',
      OPENGAME_VIDEO_PROVIDER: 'doubao',
      OPENGAME_VIDEO_API_KEY: 'k3',
      OPENGAME_AUDIO_PROVIDER: 'tongyi',
      OPENGAME_AUDIO_API_KEY: 'k4',
    };
    expect(resolveProviderConfig('reasoning', undefined, env).provider).toBe(
      'openai-compat',
    );
    expect(resolveProviderConfig('image', undefined, env).provider).toBe(
      'tongyi',
    );
    expect(resolveProviderConfig('video', undefined, env).provider).toBe(
      'doubao',
    );
    expect(resolveProviderConfig('audio', undefined, env).provider).toBe(
      'tongyi',
    );
  });
});

describe('getProviderStatus', () => {
  it('reports configured=false with a hint when nothing is set', () => {
    const status = getProviderStatus('image', undefined, {});
    expect(status.configured).toBe(false);
    expect(status.missingHint).toMatch(/OPENGAME_IMAGE_PROVIDER/);
    expect(status).not.toHaveProperty('apiKey');
  });

  it('reports configured=true with provider/model and source=env', () => {
    const status = getProviderStatus('image', undefined, {
      OPENGAME_IMAGE_PROVIDER: 'tongyi',
      OPENGAME_IMAGE_API_KEY: 'sk-abc',
    });
    expect(status).toMatchObject({
      modality: 'image',
      configured: true,
      provider: 'tongyi',
      source: 'env',
    });
    expect(status.model).toBeTruthy();
    expect(status.baseUrl).toBeTruthy();
  });

  it('reports source=settings when only settings.json supplies the config', () => {
    const status = getProviderStatus(
      'image',
      { image: { provider: 'tongyi', apiKey: 'sk-from-settings' } },
      {},
    );
    expect(status.configured).toBe(true);
    expect(status.source).toBe('settings');
  });

  it('reports source=legacy-env when only the legacy DASHSCOPE_API_KEY is set', () => {
    const status = getProviderStatus('image', undefined, {
      DASHSCOPE_API_KEY: 'sk-legacy',
    });
    expect(status.configured).toBe(true);
    expect(status.provider).toBe('tongyi');
    expect(status.source).toBe('legacy-env');
  });

  it('never throws — even on totally empty env + settings', () => {
    expect(() => getAllProvidersStatus(undefined, {})).not.toThrow();
    const all = getAllProvidersStatus(undefined, {});
    expect(all).toHaveLength(ALL_MODALITIES.length);
    expect(all.every((s) => s.configured === false)).toBe(true);
  });
});

describe('resolveFallbackProviderConfig / withProviderFailover', () => {
  it('defaults fallback provider to minimax when only FALLBACK_API_KEY is set', () => {
    const cfg = resolveFallbackProviderConfig('reasoning', {
      OPENGAME_FALLBACK_API_KEY: 'sk-mm-spare',
    });
    expect(cfg?.provider).toBe('minimax');
    expect(cfg?.baseUrl).toContain('minimaxi.com');
    expect(cfg?.model).toBeTruthy();
  });

  it('prefers modality-specific FALLBACK_BASE_URL over shared (image host without /v1)', () => {
    const cfg = resolveFallbackProviderConfig('image', {
      OPENGAME_FALLBACK_API_KEY: 'sk-mm-spare',
      OPENGAME_FALLBACK_PROVIDER: 'minimax',
      OPENGAME_FALLBACK_BASE_URL: 'https://api.minimaxi.com/v1',
      OPENGAME_IMAGE_FALLBACK_BASE_URL: 'https://api.minimaxi.com',
      OPENGAME_IMAGE_FALLBACK_MODEL: 'image-01',
    });
    expect(cfg?.baseUrl).toBe('https://api.minimaxi.com');
    expect(cfg?.model).toBe('image-01');
  });

  it('resolves doubao fallback from OPENGAME_FALLBACK_*', () => {
    const cfg = resolveFallbackProviderConfig('image', {
      OPENGAME_FALLBACK_API_KEY: 'ark-test',
      OPENGAME_FALLBACK_PROVIDER: 'doubao',
      OPENGAME_IMAGE_FALLBACK_MODEL: 'doubao-seedream-4-0-250828',
    });
    expect(cfg?.provider).toBe('doubao');
    expect(cfg?.apiKey).toBe('ark-test');
    expect(cfg?.baseUrl).toContain('ark.cn-beijing.volces.com');
    expect(cfg?.model).toBe('doubao-seedream-4-0-250828');
  });

  it('returns undefined without fallback key', () => {
    expect(resolveFallbackProviderConfig('image', {})).toBeUndefined();
  });

  it('retries with fallback on quota-like primary failure', async () => {
    const env = {
      OPENGAME_FALLBACK_API_KEY: 'ark-test',
      OPENGAME_FALLBACK_PROVIDER: 'doubao',
    };
    let sawFallback = false;
    const out = await withProviderFailover(
      'image',
      'minimax',
      async () => {
        throw new Error('MiniMax image status 2056 已达到 Token Plan 用量上限');
      },
      async (cfg) => {
        sawFallback = true;
        expect(cfg.provider).toBe('doubao');
        return 'ok-from-ark';
      },
      env,
    );
    expect(sawFallback).toBe(true);
    expect(out).toBe('ok-from-ark');
  });
});
