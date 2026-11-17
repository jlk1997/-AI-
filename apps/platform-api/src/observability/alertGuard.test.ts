/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 阈值 + 冷却逻辑；不真打 webhook。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  guardCourseVoidRate,
  guardNarrativeRefreshError,
  resetAlertGuardForTest,
} from './alertGuard.js';

beforeEach(() => {
  resetAlertGuardForTest();
  process.env['PLATFORM_ALERT_WEBHOOK_URL'] = 'http://localhost:0/alert';
  vi.restoreAllMocks();
});

afterEach(() => {
  resetAlertGuardForTest();
});

describe('alertGuard thresholds', () => {
  it('does not alert under threshold', async () => {
    process.env['ALERT_COURSE_VOID_PER_HOUR'] = '4';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }),
    );
    for (let i = 0; i < 3; i++) guardCourseVoidRate({ reason: 'muted' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('alerts once when threshold crossed', async () => {
    process.env['ALERT_COURSE_VOID_PER_HOUR'] = '2';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }),
    );
    for (let i = 0; i < 5; i++) guardCourseVoidRate({ reason: 'paused' });
    // 等 fire-and-forget 的微任务完成
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('separate metrics have independent counters', async () => {
    process.env['ALERT_NARRATIVE_REFRESH_ERROR_PER_HOUR'] = '1';
    process.env['ALERT_COURSE_VOID_PER_HOUR'] = '10';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }),
    );
    guardNarrativeRefreshError();
    for (let i = 0; i < 9; i++) guardCourseVoidRate({ reason: 'muted' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});