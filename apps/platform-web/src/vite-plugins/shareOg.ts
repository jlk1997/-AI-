/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Plugin } from 'vite';

/**
 * WeChat's crawler does not run the SPA. For `/play/:slug` it must see
 * `og:title` / `og:image` in the first HTML response. In dev and `vite preview`
 * we stamp those tags from the API share-card endpoint.
 */
export function shareOgPlugin(): Plugin {
  const apiBase = process.env['PLATFORM_API_URL'] ?? 'http://127.0.0.1:3847';

  return {
    name: 'opengame-share-og',
    transformIndexHtml: {
      order: 'post',
      async handler(html, ctx) {
        const url = ctx.originalUrl || ctx.path || '';
        const match = url.match(/\/play\/([^/?#]+)/);
        if (!match) return html;
        try {
          const res = await fetch(
            `${apiBase.replace(/\/$/, '')}/v1/public/games/${match[1]}/share-card`,
            { signal: AbortSignal.timeout(2500) },
          );
          if (!res.ok) return html;
          const card = (await res.json()) as { title?: string; tags?: string };
          if (!card.tags) return html;
          return html
            .replace(/<title>[^<]*<\/title>/, `<title>${card.title ?? 'AI隔壁世界引擎'}</title>`)
            .replace('</head>', `    ${card.tags}\n  </head>`);
        } catch {
          return html;
        }
      },
    },
  };
}
