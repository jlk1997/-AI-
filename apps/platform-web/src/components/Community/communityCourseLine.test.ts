/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  collectStakeTonightItems,
  courseBettingRemainMinutes,
  courseBettingRemainKey,
  courseBettingRemainVars,
  coursePlayHref,
  courseTeaser,
  courseTeaserBadgeKey,
  courseTeaserShowsPrompt,
  courseWatchPlayHref,
  courseFollowPlayHref,
  summarizeCourseTonight,
} from './communityCourseLine';

describe('courseTeaser', () => {
  it('shows the live prompt only while betting is open', () => {
    expect(
      courseTeaser({
        prompt: '今夜谁先离开',
        status: 'open',
        pool: 36,
        canon: null,
      }),
    ).toEqual({
      open: true,
      prompt: '今夜谁先离开',
      actKey: null,
      pool: 36,
      contested: undefined,
    });
    expect(
      courseTeaser({
        prompt: '今夜谁先离开',
        status: 'closed',
        pool: 48,
        canon: null,
      }),
    ).toEqual({
      open: false,
      evidence: true,
      prompt: '今夜谁先离开',
      actKey: null,
      pool: 48,
      contested: undefined,
    });
  });

  it('falls back to canon after settle', () => {
    expect(
      courseTeaser({
        prompt: '昨夜题',
        status: 'settled',
        pool: 0,
        canon: '阿禾走了',
      }),
    ).toEqual({ open: false, prompt: '阿禾走了', actKey: null });
  });

  it('returns null when there is nothing to read', () => {
    expect(courseTeaser(null)).toBeNull();
    expect(courseTeaser({ prompt: '', status: 'open', pool: 0, canon: null })).toBeNull();
  });

  it('keeps 今夜可压 off the evidence window', () => {
    const closed = courseTeaser({
      prompt: '今夜谁先离开',
      status: 'closed',
      pool: 48,
      canon: null,
    });
    expect(closed && courseTeaserBadgeKey(closed)).toBe(
      'product.obs.course.phase.closed',
    );
    expect(closed && courseTeaserShowsPrompt(closed)).toBe(true);
    const open = courseTeaser({
      prompt: '今夜谁先离开',
      status: 'open',
      pool: 12,
      canon: null,
    });
    expect(open && courseTeaserBadgeKey(open)).toBe(
      'community.world.stakeTonight',
    );
  });

  it('collects open boards for the stake tonight strip', () => {
    const items = collectStakeTonightItems(
      [
        {
          id: 'a',
          slug: 'town-a',
          title: 'A',
          course: {
            prompt: '题 A',
            status: 'open',
            pool: 24,
            canon: null,
            bettingClosesAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
        {
          id: 'b',
          slug: 'town-b',
          title: 'B',
          course: {
            prompt: '题 B',
            status: 'closed',
            pool: 48,
            canon: null,
          },
        },
      ],
      4,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.slug).toBe('town-a');
  });

  it('computes betting remain minutes from hint clocks', () => {
    const closes = new Date(Date.now() + 90 * 60_000).toISOString();
    const settles = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
    const minutes = courseBettingRemainMinutes({
      status: 'open',
      bettingClosesAt: closes,
      settlesAt: settles,
    });
    expect(minutes).toBeGreaterThanOrEqual(89);
    expect(minutes).toBeLessThanOrEqual(91);
    if (minutes != null) {
      expect(courseBettingRemainKey(minutes)).toBe('product.obs.course.remain.hoursMinutes');
      expect(courseBettingRemainVars(minutes).h).toBe('1');
    }
  });

  it('rolls up cross-town stake tonight stats', () => {
    const items = collectStakeTonightItems(
      [
        {
          id: 'a',
          slug: 'town-a',
          title: 'A',
          course: {
            prompt: '题 A',
            status: 'open',
            pool: 24,
            canon: null,
            contested: true,
            bettingClosesAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          },
        },
        {
          id: 'b',
          slug: 'town-b',
          title: 'B',
          course: {
            prompt: '题 B',
            status: 'open',
            pool: 12,
            canon: null,
            contested: false,
            bettingClosesAt: new Date(Date.now() + 90 * 60_000).toISOString(),
          },
        },
      ],
      4,
    );
    const summary = summarizeCourseTonight(items);
    expect(summary?.townCount).toBe(2);
    expect(summary?.totalPool).toBe(36);
    expect(summary?.contestedCount).toBe(1);
    expect(summary?.topItems).toHaveLength(2);
  });

  it('builds course play href with course deep link', () => {
    expect(coursePlayHref('town-a')).toContain('town-a');
    expect(coursePlayHref('town-a')).toContain('course=1');
    expect(coursePlayHref('town-a', { course: false })).not.toContain('course=1');
    expect(coursePlayHref('town-a', { watch: true })).toContain('watch=1');
    expect(courseWatchPlayHref('town-a')).toContain('watch=1');
    expect(courseWatchPlayHref('town-a')).toContain('course=1');
    expect(courseFollowPlayHref('town-a')).toContain('follow=1');
  });
});
