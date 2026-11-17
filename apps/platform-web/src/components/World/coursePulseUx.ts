/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { message } from 'antd';

import { courseVoidReasonKey, type CoursePulse } from '@opengame/platform-shared';

import { trackCourseEvent } from './courseTelemetry';

export function coursePulseToastKey(pulse: CoursePulse): string {
  if (pulse.kind === 'voided') return courseVoidReasonKey(pulse.voidReason);
  if (pulse.kind === 'author_contested') {
    return 'product.obs.course.toast.authorContested';
  }
  return `product.obs.course.toast.${pulse.kind}`;
}

const NOTIFY_ASKED_KEY = 'og.course.notify.asked.v1';

export function courseNotifySupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function courseNotifyAsked(): boolean {
  if (!courseNotifySupported()) return true;
  try {
    return window.localStorage.getItem(NOTIFY_ASKED_KEY) === '1';
  } catch {
    return true;
  }
}

export function markCourseNotifyAsked(): void {
  try {
    window.localStorage.setItem(NOTIFY_ASKED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function shouldShowCourseNotifyPrompt(): boolean {
  if (!courseNotifySupported()) return false;
  if (courseNotifyAsked()) return false;
  return Notification.permission === 'default';
}

export async function enableCourseBrowserNotify(): Promise<boolean> {
  if (!courseNotifySupported()) return false;
  markCourseNotifyAsked();
  const result = await Notification.requestPermission();
  trackCourseEvent('course_notify_permission', {
    granted: result === 'granted',
  });
  return result === 'granted';
}

export function dismissCourseNotifyPrompt(): void {
  markCourseNotifyAsked();
  trackCourseEvent('course_notify_permission', { granted: false, dismissed: true });
}

export function showCourseBrowserNotification(input: {
  readonly title: string;
  readonly body: string;
  readonly tag?: string;
}): void {
  if (!courseNotifySupported() || Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && !document.hidden) return;
  try {
    new Notification(input.title, {
      body: input.body,
      tag: input.tag ?? 'opengame-course',
    });
  } catch {
    /* Safari / blocked */
  }
}

export function showCoursePulseToast(
  t: (key: string, vars?: Record<string, string | number>) => string,
  pulse: CoursePulse,
  hadStake: boolean,
): void {
  const key = coursePulseToastKey(pulse);
  const text =
    pulse.kind === 'voided' && pulse.voidReason
      ? t(courseVoidReasonKey(pulse.voidReason), { reason: pulse.voidReason })
      : t(key);
  const duration = pulse.kind === 'closed' && hadStake ? 6 : 4;
  // 批次 5：退盘埋点（reason + 客户是否参与下注），便于 ops 监控 course_void_kind 指标。
  if (pulse.kind === 'voided' || pulse.kind === 'closed') {
    trackCourseEvent('course_void_kind', {
      kind: pulse.kind,
      reason: pulse.voidReason ?? 'none',
      hadStake,
    });
  }
  if (pulse.kind === 'won') {
    message.success(text, duration);
    return;
  }
  if (pulse.kind === 'lost' || pulse.kind === 'voided') {
    message.warning(text, duration);
    return;
  }
  if (pulse.kind === 'opposed') {
    message.success(text, duration);
    return;
  }
  if (pulse.kind === 'author_contested') {
    message.success(text, duration);
    return;
  }
  message.info(text, duration);
}

export function maybeCourseBrowserPulseNotify(
  t: (key: string, vars?: Record<string, string | number>) => string,
  pulse: CoursePulse,
  hadStake: boolean,
  townTitle?: string,
): void {
  if (!hadStake) return;
  const title = townTitle?.trim() || t('product.obs.course.title');
  const body = t(coursePulseToastKey(pulse));
  showCourseBrowserNotification({ title, body, tag: `course-${pulse.kind}` });
  trackCourseEvent('course_browser_notify', { kind: pulse.kind });
}
