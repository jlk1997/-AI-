/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { courseActIndex, courseActLabelKey } from '@opengame/platform-shared';

import { coursePlayHref } from '../Community/communityCourseLine';
import type { CourseReturnHint, CourseView } from '../../services/api';

export const COURSE_DEEP_LINK_PARAM = 'course';

export function courseDeepLinkPath(slugOrId: string): string {
  return coursePlayHref(slugOrId, { course: true });
}

export function courseDeepLinkUrl(slugOrId: string, origin = window.location.origin): string {
  return `${origin}${courseDeepLinkPath(slugOrId)}`;
}

export function isCourseDeepLinkActive(
  params: URLSearchParams | null | undefined,
): boolean {
  if (!params) return false;
  const raw = params.get(COURSE_DEEP_LINK_PARAM);
  return raw === '1' || raw === 'true' || raw === 'open';
}

/** Push / watch-subscription landings — auto-consume open/settled pulse. */
export function isCourseWatchPushLand(
  params: URLSearchParams | null | undefined,
): boolean {
  if (!params) return false;
  const raw = params.get('watch');
  return raw === '1' || raw === 'true';
}

/** Follower open-board push landings — show follow coach once per town. */
export function isCourseFollowOpenLand(
  params: URLSearchParams | null | undefined,
): boolean {
  if (!params) return false;
  const raw = params.get('follow');
  return raw === '1' || raw === 'true';
}

/**
 * Drop one-shot landing flags after they are consumed so refresh does not
 * re-fire follow coach / watch pulse consume. Keeps `course=1`.
 */
export function stripCourseLandingParams(
  params: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('follow');
  next.delete('watch');
  return next;
}

export function courseShareActKey(
  input: Pick<CourseReturnHint, 'status' | 'bettingClosesAt'> | Pick<CourseView, 'status' | 'bettingClosesAt'>,
): string | null {
  if (!input.bettingClosesAt) return null;
  const act = courseActIndex({
    status: input.status,
    bettingClosesAt: input.bettingClosesAt,
  });
  return act ? courseActLabelKey(act) : null;
}

export function buildCourseShareText(input: {
  readonly title: string;
  readonly prompt: string;
  readonly pool?: number;
  readonly actKey?: string | null;
  readonly canon?: string | null;
  readonly url: string;
  readonly myStakeLabel?: string | null;
  readonly t: (key: string, vars?: Record<string, string | number>) => string;
}): string {
  const parts: string[] = [input.title];
  if (input.actKey) {
    parts.push(input.t(input.actKey));
  }
  parts.push(input.prompt);
  if (input.myStakeLabel?.trim()) {
    parts.push(
      input.t('product.obs.course.share.staked', { side: input.myStakeLabel.trim() }),
    );
  }
  if (typeof input.pool === 'number' && input.pool > 0) {
    parts.push(input.t('product.obs.course.pool', { n: String(input.pool) }));
  }
  if (input.canon?.trim()) {
    parts.push(input.t('product.obs.course.settlement.canon', { canon: input.canon.trim() }));
  }
  parts.push(input.url);
  return parts.filter(Boolean).join(' · ');
}

export function buildCourseHistoryShareText(input: {
  readonly title: string;
  readonly prompt: string;
  readonly canon?: string | null;
  readonly url: string;
  readonly t: (key: string, vars?: Record<string, string | number>) => string;
}): string {
  const parts: string[] = [input.title];
  parts.push(input.prompt);
  if (input.canon?.trim()) {
    parts.push(
      input.t('product.obs.course.settlement.canon', { canon: input.canon.trim() }),
    );
  }
  parts.push(input.url);
  return parts.filter(Boolean).join(' · ');
}

export async function shareCourseBoard(input: {
  readonly title: string;
  readonly prompt: string;
  readonly slugOrId: string;
  readonly pool?: number;
  readonly actKey?: string | null;
  readonly canon?: string | null;
  readonly myStakeLabel?: string | null;
  readonly t: (key: string, vars?: Record<string, string | number>) => string;
}): Promise<'shared' | 'copied' | 'failed'> {
  const url = courseDeepLinkUrl(input.slugOrId);
  const text = buildCourseShareText({ ...input, url });
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: input.title, text, url });
      return 'shared';
    } catch {
      /* fall through to clipboard */
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  return 'failed';
}

export async function shareCourseHistory(input: {
  readonly title: string;
  readonly prompt: string;
  readonly slugOrId: string;
  readonly canon?: string | null;
  readonly t: (key: string, vars?: Record<string, string | number>) => string;
}): Promise<'shared' | 'copied' | 'failed'> {
  const url = courseDeepLinkUrl(input.slugOrId);
  const text = buildCourseHistoryShareText({ ...input, url });
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: input.title, text, url });
      return 'shared';
    } catch {
      /* fall through */
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  return 'failed';
}
