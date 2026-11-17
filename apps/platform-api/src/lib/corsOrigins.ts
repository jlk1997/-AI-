/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Production CORS for `/v1` must not be `*`: session JWTs and admin routes live
 * there. Dev auth keeps the old open policy so local Vite ports still work.
 *
 * `/api/public` stays `*` on purpose — third-party embeds need it.
 */
export function resolveV1CorsOrigin(
  requestOrigin: string | undefined,
  env: {
    readonly allowDevAuth: boolean;
    readonly webBaseUrl: string | undefined;
    readonly publicBaseUrl: string | undefined;
    readonly wechatShareOrigins: readonly string[];
    readonly extraCorsOrigins?: readonly string[];
  },
): string | undefined {
  if (env.allowDevAuth) {
    return requestOrigin && requestOrigin.length > 0 ? requestOrigin : '*';
  }
  const allowed = new Set<string>();
  const add = (value: string | undefined): void => {
    if (!value) return;
    try {
      allowed.add(new URL(value).origin);
    } catch {
      /* ignore */
    }
  };
  add(env.webBaseUrl);
  add(env.publicBaseUrl);
  for (const origin of env.wechatShareOrigins) add(origin);
  for (const origin of env.extraCorsOrigins ?? []) add(origin);
  if (requestOrigin) {
    // `https://loveaibaby.cn.` is the same site as `https://loveaibaby.cn`.
    // Browsers still treat the trailing dot as a different origin, so the
    // header must echo the request, not the canonical form.
    const key = siteOrigin(requestOrigin);
    if (key && allowed.has(key)) return requestOrigin;
    // Sandboxed preview iframes send Origin: null.
    if (requestOrigin === 'null') return 'null';
    return undefined;
  }
  if (allowed.size === 1) return [...allowed][0];
  return undefined;
}

/** Origin string with a trailing DNS dot removed from the host. */
function siteOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, '');
    return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return undefined;
  }
}

export function parseExtraCorsOrigins(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      out.push(new URL(trimmed).origin);
    } catch {
      /* ignore */
    }
  }
  return out;
}
