/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One share path for play, detail, and publish: WeChat card, system sheet,
 * clipboard, then a poster for people who forward pictures.
 */

import { getLocale, type Locale } from '../services/i18n.js';
import { share, type ShareCard } from '../mobile/wechat.js';
import { downloadPoster, type PosterInput } from './poster.js';
import { buildShareCard, remixProofLine, type ShareableWork } from './shareCard.js';

export type ShareWorkResult = 'wechat' | 'shared' | 'copied' | 'failed';

export function shareableToPoster(
  work: ShareableWork,
  locale: Locale = getLocale(),
): PosterInput {
  const proof = remixProofLine(work.remixCount, locale).trim();
  const body = (work.description ?? '').trim();
  return {
    slug: work.slug,
    title: work.title,
    description: proof || body,
    thumbnail: work.thumbnail,
    authorName: work.authorName,
  };
}

export function townDaysLived(newHours: number | null | undefined): number {
  return Math.max(0, Math.floor(Math.max(0, Number(newHours ?? 0)) / 24));
}

export function canShareTownDays(newHours: number | null | undefined): boolean {
  return townDaysLived(newHours) >= 1;
}

export function townDaysHeadline(
  title: string,
  newHours: number | null | undefined,
  locale: Locale = getLocale(),
): { readonly days: number; readonly title: string; readonly description: string } {
  const days = Math.max(1, townDaysLived(newHours));
  if (locale === 'en') {
    return {
      days,
      title: `${title} lived another ${days} days`,
      description: `A town you follow is still living. Open the stage and see those ${days} days.`,
    };
  }
  return {
    days,
    title: `${title} 又过了 ${days} 天`,
    description: `关注的镇还在过日子。点开观察台，看看这 ${days} 天发生了什么`,
  };
}

export async function sharePublishedWork(work: ShareableWork): Promise<{
  readonly result: ShareWorkResult;
  readonly posterSaved: boolean;
  readonly card: ShareCard;
}> {
  const card = buildShareCard(work);
  const result = await share(card);
  let posterSaved = false;
  try {
    posterSaved = await downloadPoster(shareableToPoster(work));
  } catch {
    posterSaved = false;
  }
  return { result, posterSaved, card };
}

export async function shareFollowedTown(town: {
  readonly slug: string;
  readonly title: string;
  readonly thumbnail?: string | null;
  readonly authorName?: string | null;
  readonly newHours: number | null;
  readonly headline?: { readonly title: string; readonly description: string };
}): Promise<{
  readonly result: ShareWorkResult;
  readonly posterSaved: boolean;
  readonly card: ShareCard;
}> {
  const fallback = townDaysHeadline(town.title, town.newHours);
  const copy = town.headline
    ? { days: fallback.days, title: town.headline.title, description: town.headline.description }
    : fallback;
  const work: ShareableWork = {
    slug: town.slug,
    title: copy.title,
    description: copy.description,
    thumbnail: town.thumbnail,
    category: 'world',
    authorName: town.authorName,
  };
  const card = buildShareCard(work);
  const result = await share(card);
  let posterSaved = false;
  try {
    posterSaved = await downloadPoster({
      ...shareableToPoster(work),
      title: copy.title,
      description: copy.description,
      kind: 'town-days',
      days: copy.days,
    });
  } catch {
    posterSaved = false;
  }
  return { result, posterSaved, card };
}
