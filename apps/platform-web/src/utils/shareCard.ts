/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Locale } from '../services/i18n.js';
import { getLocale } from '../services/i18n.js';
import type { ShareCard } from '../mobile/wechat.js';
import { myInviteHandle, normalizeInviteHandle } from './kaiPaywall.js';

export interface ShareableWork {
  readonly slug: string;
  readonly title: string;
  readonly description?: string | null;
  readonly thumbnail?: string | null;
  readonly category?: string | null;
  readonly authorName?: string | null;
  readonly remixCount?: number | null;
  readonly canon?: string | null;
}

const CHINA_CLOCK = 'tonight in China (UTC+8)';

/** WeChat cards cut at ~60 chars — never drop the China clock to fit remix proof. */
export function clipShareDesc(text: string, max = 60): string {
  if (text.length <= max) return text;
  if (text.includes(CHINA_CLOCK) && CHINA_CLOCK.length + 4 <= max) {
    const room = max - CHINA_CLOCK.length - 3;
    const head = text.slice(0, Math.max(0, room)).trimEnd();
    const clipped = `${head} ${CHINA_CLOCK}`;
    return clipped.length <= max ? clipped : `${clipped.slice(0, max - 1)}…`;
  }
  return `${text.slice(0, max - 3)}…`;
}

export function remixProofLine(
  n: number | null | undefined,
  locale: Locale = getLocale(),
): string {
  const count = Math.max(0, Math.round(Number(n ?? 0)));
  if (count <= 0) return '';
  return locale === 'en' ? `remixed ${count} times` : `已被改 ${count} 次`;
}

/**
 * Canonical share target: the play-first landing page.
 * Pass `invite` to stamp (or suppress with `null`); omit to use the stored handle.
 */
export function playLink(slug: string, invite?: string | null): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const path = `${origin}/play/${encodeURIComponent(slug)}`;
  const handle = normalizeInviteHandle(invite === undefined ? myInviteHandle() : invite);
  return handle ? `${path}?invite=${encodeURIComponent(handle)}` : path;
}

function absolute(url: string | null | undefined): string {
  if (!url) return `${window.location.origin}/icons/icon.svg`;
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return `${window.location.origin}/icons/icon.svg`;
  }
}

/**
 * Worlds and games get different hooks: a world is worth opening because it
 * kept living while you were away, a game because you can beat someone's score.
 */
export function buildShareCard(
  work: ShareableWork,
  locale: Locale = getLocale(),
): ShareCard {
  const isWorld = work.category === 'world';
  const english = locale === 'en';
  const byline = work.authorName ? `@${work.authorName}` : english ? 'Gebi' : '隔壁';
  const fallbackDesc = isWorld
    ? english
      ? `${byline}'s town lives — tonight in China (UTC+8)`
      : `${byline} 的小镇还在过日子，进去看看今晚发生了什么`
    : english
      ? `${byline} made this — play, change a line, publish`
      : `${byline} 做的游戏，点开就能玩，改一句就变成你的`;
  const desc =
    (work.canon ?? '').trim() || (work.description ?? '').trim() || fallbackDesc;
  const proof = remixProofLine(work.remixCount, locale);
  const withProof = proof ? `${desc} · ${proof}` : desc;
  return {
    title: work.title,
    desc: clipShareDesc(withProof),
    link: playLink(work.slug),
    imgUrl: absolute(work.thumbnail),
  };
}
