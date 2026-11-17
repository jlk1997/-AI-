/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 5-act progress bar for the Course board:
 *   open → closing soon → evidence → settling → outcome
 *
 * 与 {@link CourseActProgressBar}（3 段旧版）并存，feature flag 控制切换。
 * CourseActProgressBar 仍可独立使用，本组件不修改其任何字段。
 */

import React, { useEffect, useRef } from 'react';

import {
  announceProgress,
  courseActDisplay,
  courseActDisplayLabelKey,
  describeProgressBar,
  type CourseActDisplayView,
} from '@opengame/platform-shared';

import { useT } from '../../services/i18n';
import { trackCourseEvent } from './courseTelemetry';

function remainLabel(
  t: (k: string, vars?: Record<string, string | number>) => string,
  minutes: number,
): string {
  if (minutes < 60) {
    return t('product.obs.course.remain.minutes', { n: String(minutes) });
  }
  const hours = Math.floor(minutes / 60);
  const leftover = minutes % 60;
  if (leftover === 0) {
    return t('product.obs.course.remain.hours', { h: String(hours) });
  }
  return t('product.obs.course.remain.hoursMinutes', {
    h: String(hours),
    m: String(leftover),
  });
}

export const CourseActProgress5Bar: React.FC<{
  readonly view: CourseActDisplayView & {
    readonly status: string;
    readonly bettingClosesAt: string;
    readonly settlesAt: string;
  };
  readonly nowMs?: number;
  readonly compact?: boolean;
}> = ({ view, nowMs = Date.now(), compact = false }) => {
  const { t } = useT();
  const act = courseActDisplay(view, nowMs);
  const lastActRef = useRef<typeof act>(null);
  // 批次 5：5 幕进度条每次切到新 act 都打点，便于 ops 看 progress 在每段停留时长。
  useEffect(() => {
    if (act && act !== lastActRef.current) {
      lastActRef.current = act;
      const closesAt = Date.parse(view.bettingClosesAt);
      const remainMs = Number.isFinite(closesAt) ? closesAt - nowMs : null;
      trackCourseEvent('course_act_display', {
        act,
        closesRemainMs: remainMs ?? 'unknown',
      });
    }
  }, [act, nowMs, view.bettingClosesAt]);
  if (!act) return null;

  const closesAtMs = Date.parse(view.bettingClosesAt);
  const closesRemainMin = Number.isFinite(closesAtMs)
    ? Math.max(0, Math.round((closesAtMs - nowMs) / 60_000))
    : 0;
  const remain = act < 5 ? remainLabel(t, closesRemainMin) : null;

  const descriptor = describeProgressBar({
    currentIndex: act,
    totalSteps: 5,
    stepLabelKey: 'product.obs.course.act5.step',
    statusLabelKey: courseActDisplayLabelKey(act),
    groupAriaLabel: t(courseActDisplayLabelKey(act)),
  });
  const ariaAnnouncement = announceProgress({
    messageKey: courseActDisplayLabelKey(act),
    severity: act === 5 ? 'success' : 'info',
  });

  return (
    <div
      className={`og-course-act5-bar${compact ? ' is-compact' : ''}`}
      role="progressbar"
      aria-valuemin={descriptor.totalSteps > 0 ? 1 : 0}
      aria-valuemax={descriptor.totalSteps}
      aria-valuenow={descriptor.currentIndex}
      aria-valuetext={t(descriptor.statusLabelKey)}
      aria-label={descriptor.groupAriaLabel}
      data-act={act}
    >
      <span
        className="og-visually-hidden"
        role="status"
        aria-live={ariaAnnouncement.politeness}
      >
        {t(descriptor.statusLabelKey)}
      </span>
      {([1, 2, 3, 4, 5] as const).map((step) => (
        <div
          key={step}
          className={`og-course-act5-bar__step${
            step === act ? ' og-course-act5-bar__step--active' : ''
          }${step < act ? ' og-course-act5-bar__step--done' : ''}`}
          aria-current={step === act ? 'step' : undefined}
          aria-label={`${t('product.obs.course.act5.step')} ${step}: ${t(courseActDisplayLabelKey(step))}`}
        >
          <span className="og-course-act5-bar__index" aria-hidden="true">
            {step}
          </span>
          <span className="og-course-act5-bar__label">
            {t(courseActDisplayLabelKey(step))}
          </span>
          {step === act && remain && act < 5 ? (
            <span className="og-course-act5-bar__remain" aria-live="polite">
              {t('product.obs.course.act5.remain', { n: remain })}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
};