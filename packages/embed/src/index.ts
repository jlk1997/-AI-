/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Vanilla embed helper for OpenGame community games. Mirrors the
 * `/embed.js` snippet but returns typed promises for hosts that already use
 * bundlers.
 */
export interface OpenGameEmbedInfo {
  readonly slug: string;
  readonly title: string;
  readonly thumbnail?: string;
  readonly iframeUrl: string;
  readonly width: number;
  readonly height: number;
  readonly iframeSandbox: string;
}

export interface FetchEmbedOptions {
  readonly apiBase?: string;
  readonly fetch?: typeof fetch;
}

export async function fetchEmbedInfo(
  slug: string,
  opts: FetchEmbedOptions = {},
): Promise<OpenGameEmbedInfo> {
  const base = (opts.apiBase ?? 'https://api.opengame.dev').replace(/\/$/, '');
  const fn = opts.fetch ?? fetch;
  const res = await fn(`${base}/api/public/games/${encodeURIComponent(slug)}/embed`);
  if (!res.ok) {
    throw new Error(`OpenGame embed lookup failed: ${res.status}`);
  }
  return (await res.json()) as OpenGameEmbedInfo;
}

export interface EmbedAttachOptions extends FetchEmbedOptions {
  readonly width?: number | string;
  readonly height?: number | string;
}

/** Imperatively render the embed iframe into a host element. */
export async function attachEmbed(
  el: HTMLElement,
  slug: string,
  opts: EmbedAttachOptions = {},
): Promise<HTMLIFrameElement> {
  const info = await fetchEmbedInfo(slug, opts);
  const iframe = document.createElement('iframe');
  iframe.src = info.iframeUrl;
  iframe.title = info.title;
  iframe.width = String(opts.width ?? info.width);
  iframe.height = String(opts.height ?? info.height);
  iframe.loading = 'lazy';
  iframe.allow = 'autoplay; fullscreen; gamepad; pointer-lock';
  iframe.setAttribute('sandbox', info.iframeSandbox);
  iframe.style.border = '0';
  iframe.style.maxWidth = '100%';
  el.appendChild(iframe);
  return iframe;
}
