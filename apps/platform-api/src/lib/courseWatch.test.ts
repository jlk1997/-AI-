/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  courseFollowOpenBody,
  courseFollowOpenPushPath,
  courseWatchBodyForClosed,
  courseWatchBodyForOpen,
  courseWatchBodyForSettled,
  courseWatchPushPath,
} from './courseWatch.js';

describe('courseWatch bodies', () => {
  it('names an open board with the prompt', () => {
    expect(courseWatchBodyForOpen('今夜谁先走')).toContain('今夜谁先走');
    expect(courseWatchBodyForOpen(null)).toContain('开压');
  });

  it('names follower open push copy', () => {
    expect(courseFollowOpenBody('今夜谁先走')).toContain('你关注的镇');
    expect(courseFollowOpenBody('今夜谁先走')).toContain('今夜谁先走');
    expect(courseFollowOpenBody(null)).toContain('开压');
  });

  it('names close and settle milestones', () => {
    expect(courseWatchBodyForClosed()).toContain('封盘');
    expect(courseWatchBodyForSettled({ canon: '阿禾走了', prompt: '题' })).toContain(
      '阿禾走了',
    );
  });

  it('builds a mobile-first watch push path', () => {
    expect(courseWatchPushPath('my-town')).toBe('/play/my-town?course=1&watch=1');
    expect(courseFollowOpenPushPath('my-town')).toBe('/play/my-town?course=1&follow=1');
    expect(courseFollowOpenPushPath('my-town')).not.toContain('watch=1');
  });
});
