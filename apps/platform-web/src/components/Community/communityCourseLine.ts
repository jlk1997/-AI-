/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One line for discovery cards and feeds: tonight’s open question, or the
 * last settled canon. Keeps WorldCard / WorkCard / TonightFeed in lockstep.
 */

import { courseActIndex, courseActLabelKey, coursePhaseClock } from '@opengame/platform-shared';

import { detectShell } from '../../mobile/deviceShell';
import type { CourseReturnHint } from '../../services/api';

export type CourseTeaser = {
  readonly open: boolean;
  readonly evidence?: boolean;
  readonly prompt: string;
  readonly actKey?: string | null;
  readonly pool?: number;
  readonly contested?: boolean;
};

export type CourseStakeTonightItem = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly course: CourseReturnHint;
};

export function courseTeaser(
  course?: CourseReturnHint | null,
): CourseTeaser | null {
  if (!course?.prompt) return null;
  const actKey = courseShareActKeyFromHint(course);
  if (course.status === 'open') {
    return {
      open: true,
      prompt: course.prompt,
      actKey,
      pool: course.pool,
      contested: course.contested,
    };
  }
  if (course.status === 'closed') {
    return {
      open: false,
      evidence: true,
      prompt: course.prompt,
      actKey,
      pool: course.pool,
      contested: course.contested,
    };
  }
  return {
    open: false,
    prompt: course.canon || course.prompt,
    actKey: null,
  };
}

function courseShareActKeyFromHint(
  course: CourseReturnHint,
): string | null {
  if (!course.bettingClosesAt) return null;
  const act = courseActIndex({
    status: course.status,
    bettingClosesAt: course.bettingClosesAt,
  });
  return act ? courseActLabelKey(act) : null;
}

export function courseTeaserBadgeKey(teaser: CourseTeaser): string {
  if (teaser.open) return 'community.world.stakeTonight';
  if (teaser.evidence) return 'product.obs.course.phase.closed';
  return 'product.obs.course.history';
}

export function courseTeaserTagColor(
  teaser: CourseTeaser,
): 'magenta' | 'orange' | undefined {
  if (teaser.open) return 'magenta';
  if (teaser.evidence) return 'orange';
  return undefined;
}

export function courseTeaserShowsPrompt(teaser: CourseTeaser): boolean {
  return teaser.open || Boolean(teaser.evidence);
}

/** Rows with an open betting window, deduped by id, sorted by pool then title. */
export function collectStakeTonightItems(
  rows: ReadonlyArray<{
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly course?: CourseReturnHint | null;
  }>,
  limit = 8,
): CourseStakeTonightItem[] {
  const seen = new Set<string>();
  const out: CourseStakeTonightItem[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    const teaser = courseTeaser(row.course);
    if (!teaser?.open || !row.course) continue;
    seen.add(row.id);
    out.push({
      id: row.id,
      slug: row.slug || row.id,
      title: row.title,
      course: row.course,
    });
  }
  out.sort((a, b) => {
    const poolDiff = (b.course.pool ?? 0) - (a.course.pool ?? 0);
    if (poolDiff !== 0) return poolDiff;
    return a.title.localeCompare(b.title);
  });
  return out.slice(0, limit);
}

export function coursePlayHref(
  slug: string,
  opts?: {
    readonly course?: boolean;
    readonly watch?: boolean;
    readonly follow?: boolean;
  },
): string {
  const encoded = encodeURIComponent(slug);
  const params = new URLSearchParams();
  if (opts?.course !== false) params.set('course', '1');
  if (opts?.watch) params.set('watch', '1');
  if (opts?.follow) params.set('follow', '1');
  const q = params.toString() ? `?${params.toString()}` : '';
  if (typeof window !== 'undefined' && detectShell() === 'mobile') {
    return `/play/${encoded}${q}`;
  }
  return `/community/game/${encoded}${q}`;
}

export function courseStakeTonightHref(slug: string): string {
  return coursePlayHref(slug, { course: true });
}

/** Deep link for watch/pulse revisit — auto-consumes pulse on land. */
export function courseWatchPlayHref(slug: string): string {
  return coursePlayHref(slug, { course: true, watch: true });
}

/** Deep link for follower open-board push — triggers follow coach on land. */
export function courseFollowPlayHref(slug: string): string {
  return coursePlayHref(slug, { course: true, follow: true });
}

/** Minutes left in Act 1 betting, or null if not in betting phase. */
export function courseBettingRemainMinutes(
  course: Pick<CourseReturnHint, 'status' | 'bettingClosesAt' | 'settlesAt'>,
  nowMs = Date.now(),
): number | null {
  if (course.status !== 'open' || !course.bettingClosesAt) return null;
  const bettingClosesAtMs = Date.parse(course.bettingClosesAt);
  const settlesAtMs = course.settlesAt
    ? Date.parse(course.settlesAt)
    : bettingClosesAtMs;
  if (!Number.isFinite(bettingClosesAtMs)) return null;
  const clock = coursePhaseClock({
    status: course.status,
    bettingClosesAtMs,
    settlesAtMs: Number.isFinite(settlesAtMs) ? settlesAtMs : bettingClosesAtMs,
    nowMs,
  });
  if (clock.phase !== 'betting') return null;
  return clock.remainMinutes;
}

export function courseBettingRemainKey(minutes: number): string {
  if (minutes < 60) return 'product.obs.course.remain.minutes';
  if (minutes % 60 === 0) return 'product.obs.course.remain.hours';
  return 'product.obs.course.remain.hoursMinutes';
}

export function courseBettingRemainVars(minutes: number): Record<string, string> {
  const hours = Math.floor(minutes / 60);
  const leftover = minutes % 60;
  if (minutes < 60) return { n: String(minutes) };
  if (leftover === 0) return { h: String(hours) };
  return { h: String(hours), m: String(leftover) };
}

export type CourseTonightSummary = {
  readonly townCount: number;
  readonly totalPool: number;
  readonly contestedCount: number;
  readonly soonestMinutes: number | null;
  readonly topItems: readonly CourseStakeTonightItem[];
};

/** Cross-town rollup for the「今夜套餐」display layer (client or API). */
export function summarizeCourseTonight(
  items: readonly CourseStakeTonightItem[],
  nowMs = Date.now(),
  topN = 3,
): CourseTonightSummary | null {
  if (items.length === 0) return null;
  let totalPool = 0;
  let contestedCount = 0;
  let soonestMinutes: number | null = null;
  for (const item of items) {
    totalPool += item.course.pool ?? 0;
    if (item.course.contested) contestedCount += 1;
    const remain = courseBettingRemainMinutes(item.course, nowMs);
    if (remain != null) {
      soonestMinutes =
        soonestMinutes == null ? remain : Math.min(soonestMinutes, remain);
    }
  }
  return {
    townCount: items.length,
    totalPool,
    contestedCount,
    soonestMinutes,
    topItems: items.slice(0, topN),
  };
}
