/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Preview iframes load the game from the same site (e.g. `/v1/preview-dist/.../index.html`).
 * Without `allow-same-origin`, the framed document has an opaque unique origin, so:
 * - Full absolute URLs that look “same host” still fail security checks.
 * - WebGL texture uploads from some `data:` URLs can error (`texImage2D: bad image data`).
 *
 * We only add `allow-same-origin` when the preview URL is same-origin (or root-relative),
 * not for arbitrary external CDN embeds.
 */

/** Permissions Policy so the framed Phaser/WebAudio may autoplay after a parent gesture. */
export function previewIframeAllow(): string {
  return 'autoplay; fullscreen';
}

function sameSite(a: string, b: string): boolean {
  const key = (origin: string): string => {
    try {
      const url = new URL(origin);
      return `${url.protocol}//${url.hostname.replace(/\.$/, '')}${url.port ? `:${url.port}` : ''}`;
    } catch {
      return origin;
    }
  };
  return key(a) === key(b);
}

export function previewIframeSandbox(previewUrl: string): string {
  const base = 'allow-scripts allow-forms allow-popups';
  if (typeof window === 'undefined') {
    return `${base} allow-same-origin`;
  }
  if (previewUrl.startsWith('/')) {
    return `${base} allow-same-origin`;
  }
  try {
    const u = new URL(previewUrl, window.location.href);
    if (sameSite(u.origin, window.location.origin)) {
      return `${base} allow-same-origin`;
    }
  } catch {
    return base;
  }
  return base;
}
