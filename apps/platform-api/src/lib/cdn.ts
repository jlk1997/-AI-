/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PlatformEnv } from '../env.js';

/**
 * CDN 配置接口
 */
export interface CDNConfig {
  provider: 'cloudflare' | 'aws-cloudfront' | 'custom';
  enabled: boolean;
  zoneId?: string;
  apiToken?: string;
  distributionDomain?: string;
  customDomain?: string;
}

/**
 * 获取 CDN 配置
 */
export function getCDNConfig(env: PlatformEnv): CDNConfig {
  const cdnProvider = env.cdnProvider || 'custom';
  const cdnEnabled = env.cdnEnabled === true;

  if (!cdnEnabled) {
    return {
      provider: 'custom',
      enabled: false,
    };
  }

  return {
    provider: cdnProvider as CDNConfig['provider'],
    enabled: true,
    zoneId: env.cdnZoneId,
    apiToken: env.cdnApiToken,
    distributionDomain: env.cdnDistributionDomain,
    customDomain: env.cdnCustomDomain,
  };
}

/**
 * 生成游戏的公开访问 URL
 * 支持 CDN 加速或直接 S3 访问
 */
export function getGameUrl(
  env: PlatformEnv,
  s3Key: string,
  options?: {
    expiresIn?: number;
    isHtml?: boolean;
  },
): { url: string; expiresIn: number | null } {
  const { isHtml = false } = options || {};
  const cdnConfig = getCDNConfig(env);

  // 如果启用了 CDN
  if (cdnConfig.enabled && cdnConfig.distributionDomain) {
    // 构建 CDN URL
    const cdnUrl = `https://${cdnConfig.distributionDomain}/${s3Key}`;
    // CDN 通常不需要过期时间（默认长期缓存）
    // 但 HTML 文件需要设置不缓存或短期缓存
    return {
      url: cdnUrl,
      expiresIn: null, // CDN 永久有效
    };
  }

  // 如果配置了公开的基础 URL
  if (env.publicObjectBaseUrl) {
    const url = `${env.publicObjectBaseUrl.replace(/\/$/, '')}/${s3Key}`;
    return {
      url,
      expiresIn: null, // 公开 URL 无需过期
    };
  }

  // 需要签名的 URL（默认行为）
  // 注意：这个函数会返回签名 URL，但如果需要前端直接访问，需要在 API 层处理签名
  return {
    url: `/v1/static/${s3Key}`,
    expiresIn: null,
  };
}

/**
 * 获取静态资源的 Cache-Control 头
 * HTML 文件不缓存，静态资源长期缓存
 */
export function getCacheControlHeaders(filePath: string): Record<string, string> {
  const base = filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || '';
  const ext = base.split('.').pop()?.toLowerCase() || '';

  // HTML 文件不缓存
  if (ext === 'html' || ext === 'htm') {
    return {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    };
  }

  // Living society / world JSON must not be immutable-cached
  if (
    base === 'society_replay.json' ||
    base === 'world.json' ||
    base === 'asset_brief.json'
  ) {
    return {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    };
  }

  // 静态资源长期缓存
  // JS/CSS 带有 hash，可以长期缓存
  if (['js', 'css', 'json', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'woff', 'woff2', 'ttf', 'eot', 'ico'].includes(ext)) {
    return {
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
  }

  // 默认缓存策略
  return {
    'Cache-Control': 'public, max-age=86400',
  };
}

/**
 * 清除 CDN 缓存（可选，用于更新已部署的游戏）
 */
export async function purgeCDNCache(
  cdnConfig: CDNConfig,
  paths: string[],
): Promise<{ success: boolean; purgedPaths: string[] }> {
  if (!cdnConfig.enabled) {
    return { success: true, purgedPaths: [] };
  }

  if (cdnConfig.provider === 'cloudflare' && cdnConfig.zoneId && cdnConfig.apiToken) {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${cdnConfig.zoneId}/purge_cache`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cdnConfig.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            files: paths.map((p) => `https://${cdnConfig.distributionDomain}/${p}`),
          }),
        },
      );

      if (!response.ok) {
        console.error('Cloudflare cache purge failed:', await response.text());
        return { success: false, purgedPaths: [] };
      }

      return { success: true, purgedPaths: paths };
    } catch (error) {
      console.error('Cloudflare cache purge error:', error);
      return { success: false, purgedPaths: [] };
    }
  }

  // 其他 CDN 暂不支持自动清理
  return { success: true, purgedPaths: [] };
}

/**
 * 生成游戏的分享链接
 */
export function generateShareUrl(
  env: PlatformEnv,
  deploymentId: string,
  gameSlug?: string,
): string {
  const baseUrl = env.publicBaseUrl || 'https://opengame.example.com';

  if (gameSlug) {
    return `${baseUrl}/play/${gameSlug}`;
  }

  return `${baseUrl}/play/deployment/${deploymentId}`;
}
