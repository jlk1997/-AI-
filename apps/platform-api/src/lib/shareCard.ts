/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Crawler-facing share card.
 *
 * WeChat (and every other unfurl bot) fetches the URL without running the SPA.
 * The card they show is whatever `<title>` / `og:*` they find in the first
 * HTML response — which, for a Vite app, is "OpenGame" and nothing else.
 * This module builds that HTML (and the JSON the Vite plugin uses to inject
 * the same tags into `/play/:slug`).
 */

export interface ShareCardWork {
  readonly slug: string;
  readonly title: string;
  readonly description?: string | null;
  readonly thumbnail?: string | null;
  readonly category?: string | null;
  readonly authorName?: string | null;
  readonly remixCount?: number | null;
  readonly canon?: string | null;
}

export interface ShareCardMeta {
  readonly title: string;
  readonly desc: string;
  readonly link: string;
  readonly imgUrl: string;
}

export type ShareCardLocale = 'zh-CN' | 'en';

export function shareCardLocaleFromRequest(
  acceptLanguage?: string | null,
  query?: string | null,
): ShareCardLocale {
  const q = (query ?? '').trim().toLowerCase();
  if (q === 'en' || q.startsWith('en-')) return 'en';
  if (q === 'zh' || q.startsWith('zh-')) return 'zh-CN';
  const al = (acceptLanguage ?? '').toLowerCase();
  if (/(^|,|\s)zh\b/.test(al)) return 'zh-CN';
  if (/(^|,|\s)en\b/.test(al)) return 'en';
  return 'zh-CN';
}

export function buildShareMeta(
  work: ShareCardWork,
  origin: string,
  locale: ShareCardLocale = 'zh-CN',
): ShareCardMeta {
  const isWorld = work.category === 'world';
  const english = locale === 'en';
  const byline = work.authorName
    ? `@${work.authorName}`
    : english
      ? 'Gebi'
      : '隔壁';
  const fallback = isWorld
    ? english
      ? `${byline}'s town is still living — step in and see tonight in China (UTC+8)`
      : `${byline} 的小镇还在过日子，进去看看今晚发生了什么`
    : english
      ? `${byline} made this — play it, change a line, publish yours`
      : `${byline} 做的游戏，点开就能玩，改一句就变成你的`;
  const desc =
    (work.canon ?? '').trim() || (work.description ?? '').trim() || fallback;
  const remixes = Math.max(0, Math.round(Number(work.remixCount ?? 0)));
  const withProof =
    remixes > 0
      ? english
        ? `${desc} · remixed ${remixes} times`
        : `${desc} · 已被改 ${remixes} 次`
      : desc;
  const img = work.thumbnail
    ? absoluteUrl(work.thumbnail, origin)
    : `${origin.replace(/\/$/, '')}/icons/icon.svg`;
  return {
    title: work.title.slice(0, 80),
    desc: withProof.length > 80 ? `${withProof.slice(0, 77)}…` : withProof,
    link: `${origin.replace(/\/$/, '')}/play/${encodeURIComponent(work.slug)}`,
    imgUrl: img,
  };
}

function absoluteUrl(url: string, origin: string): string {
  try {
    return new URL(url, origin).toString();
  } catch {
    return `${origin.replace(/\/$/, '')}/icons/icon.svg`;
  }
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderShareCardHtml(
  meta: ShareCardMeta,
  locale: ShareCardLocale = 'zh-CN',
): string {
  const title = escapeHtml(meta.title);
  const desc = escapeHtml(meta.desc);
  const link = escapeHtml(meta.link);
  const img = escapeHtml(meta.imgUrl);
  const lang = locale === 'en' ? 'en' : 'zh-CN';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<meta name="description" content="${desc}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${title}"/>
<meta property="og:description" content="${desc}"/>
<meta property="og:url" content="${link}"/>
<meta property="og:image" content="${img}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${title}"/>
<meta name="twitter:description" content="${desc}"/>
<meta name="twitter:image" content="${img}"/>
<meta itemprop="name" content="${title}"/>
<meta itemprop="description" content="${desc}"/>
<meta itemprop="image" content="${img}"/>
<link rel="canonical" href="${link}"/>
<meta http-equiv="refresh" content="0;url=${link}"/>
</head>
<body>
<p><a href="${link}">${title}</a> — ${desc}</p>
<script>location.replace(${JSON.stringify(meta.link)})</script>
</body>
</html>`;
}

export function ogMetaTags(meta: ShareCardMeta): string {
  const title = escapeHtml(meta.title);
  const desc = escapeHtml(meta.desc);
  const link = escapeHtml(meta.link);
  const img = escapeHtml(meta.imgUrl);
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}"/>`,
    `<meta property="og:type" content="website"/>`,
    `<meta property="og:title" content="${title}"/>`,
    `<meta property="og:description" content="${desc}"/>`,
    `<meta property="og:url" content="${link}"/>`,
    `<meta property="og:image" content="${img}"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${title}"/>`,
    `<meta name="twitter:description" content="${desc}"/>`,
    `<meta name="twitter:image" content="${img}"/>`,
  ].join('\n    ');
}
