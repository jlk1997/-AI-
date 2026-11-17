/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  buildCourseHistoryShareText,
  buildCourseShareText,
  courseDeepLinkPath,
  isCourseDeepLinkActive,
  isCourseFollowOpenLand,
  isCourseWatchPushLand,
  stripCourseLandingParams,
} from './courseShare';

describe('courseShare', () => {
  it('builds a deep link path with the course flag', () => {
    expect(courseDeepLinkPath('my-town')).toBe('/community/game/my-town?course=1');
  });

  it('detects course deep links', () => {
    expect(isCourseDeepLinkActive(new URLSearchParams('course=1'))).toBe(true);
    expect(isCourseDeepLinkActive(new URLSearchParams(''))).toBe(false);
  });

  it('detects watch push landings', () => {
    expect(isCourseWatchPushLand(new URLSearchParams('course=1&watch=1'))).toBe(true);
    expect(isCourseWatchPushLand(new URLSearchParams('course=1'))).toBe(false);
  });

  it('detects follower open landings', () => {
    expect(isCourseFollowOpenLand(new URLSearchParams('course=1&follow=1'))).toBe(true);
    expect(isCourseFollowOpenLand(new URLSearchParams('course=1'))).toBe(false);
  });

  it('strips one-shot landing flags while keeping course', () => {
    const stripped = stripCourseLandingParams(
      new URLSearchParams('course=1&follow=1&watch=1'),
    );
    expect(stripped.get('course')).toBe('1');
    expect(stripped.get('follow')).toBeNull();
    expect(stripped.get('watch')).toBeNull();
  });

  it('assembles share copy with act and pool', () => {
    const text = buildCourseShareText({
      title: '桂花镇',
      prompt: '今夜还在吗',
      pool: 36,
      actKey: 'product.obs.course.act.bet',
      url: 'https://example.com/community/game/guihua?course=1',
      t: (key, vars) => (vars?.n ? `${key}:${vars.n}` : key),
    });
    expect(text).toContain('桂花镇');
    expect(text).toContain('今夜还在吗');
    expect(text).toContain('product.obs.course.act.bet');
    expect(text).toContain('product.obs.course.pool:36');
  });

  it('assembles share copy with staked side', () => {
    const text = buildCourseShareText({
      title: '桂花镇',
      prompt: '今夜还在吗',
      myStakeLabel: '还在',
      url: 'https://example.com/t?course=1',
      t: (key, vars) => (vars?.side ? `${key}:${vars.side}` : key),
    });
    expect(text).toContain('还在');
  });

  it('assembles history share copy with canon', () => {
    const text = buildCourseHistoryShareText({
      title: '桂花镇',
      prompt: '昨夜题',
      canon: '阿禾走了',
      url: 'https://example.com/t?course=1',
      t: (key, vars) => (vars?.canon ? `${key}:${vars.canon}` : key),
    });
    expect(text).toContain('昨夜题');
    expect(text).toContain('阿禾走了');
  });
});
