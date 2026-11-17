/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Preview-proxy URLs embed a rotating JWT in the path. Comparing full strings
 * would remount the iframe every mint; identity is the deployment id segment.
 */

/** Extract stable deployment id from `/v1/preview-dist/:deploymentId/:token/...`. */
export function previewDeploymentIdentity(url: string): string | null {
  try {
    const base =
      typeof window !== 'undefined' ? window.location.href : 'http://local/';
    const u = new URL(url, base);
    const m = u.pathname.match(/\/preview-dist\/([^/]+)\//);
    if (m?.[1]) return m[1];
    // Presigned / absolute URLs: strip volatile query.
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Asset next to the preview HTML, e.g. `index.html` → `assets/bgm.mp3`.
 * Drops `mode` / `_pv` so the signed preview-dist path still resolves.
 */
export function previewSiblingAssetUrl(
  previewUrl: string,
  assetRel: string,
): string | null {
  try {
    const base =
      typeof window !== 'undefined' ? window.location.href : 'http://local/';
    const u = new URL(previewUrl, base);
    const rel = assetRel.replace(/^\.\//, '').replace(/^\/+/, '');
    if (/\/index\.html$/i.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/index\.html$/i, `/${rel}`);
    } else {
      const dir = u.pathname.replace(/\/[^/]*$/, '');
      u.pathname = `${dir}/${rel}`;
    }
    u.search = '';
    u.hash = '';
    if (previewUrl.startsWith('/')) {
      return `${u.pathname}${u.search}`;
    }
    return u.toString();
  } catch {
    return null;
  }
}

/** Append cache-bust query without rewriting path tokens. */
export function withPreviewBustParam(url: string, bust: string): string {
  try {
    const base =
      typeof window !== 'undefined' ? window.location.href : 'http://local/';
    const u = new URL(url, base);
    u.searchParams.set('_pv', bust);
    if (url.startsWith('/')) {
      return `${u.pathname}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_pv=${encodeURIComponent(bust)}`;
  }
}
