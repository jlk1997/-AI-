/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';

import {
  chinaWallClock,
  courseActIndex,
  courseActLabelKey,
  coursePhaseClock,
  type CourseActView,
} from '@opengame/platform-shared';

import { useT } from '../../services/i18n';

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

export const CourseActProgressBar: React.FC<{
  readonly view: CourseActView & {
    readonly status: string;
    readonly bettingClosesAt: string;
    readonly settlesAt: string;
  };
  readonly nowMs?: number;
  readonly compact?: boolean;
}> = ({ view, nowMs = Date.now(), compact = false }) => {
  const { t } = useT();
  const act = courseActIndex(view, nowMs);
  const clock = useMemo(() => {
    const bettingClosesAtMs = Date.parse(view.bettingClosesAt);
    const settlesAtMs = Date.parse(view.settlesAt);
    if (!Number.isFinite(bettingClosesAtMs) || !Number.isFinite(settlesAtMs)) {
      return null;
    }
    return coursePhaseClock({
      status: view.status,
      bettingClosesAtMs,
      settlesAtMs,
      nowMs,
    });
  }, [view, nowMs]);

  const remain =
    clock && clock.phase !== 'done'
      ? remainLabel(t, clock.remainMinutes)
      : null;

  const clockLine = useMemo(() => {
    if (!clock || clock.phase === 'done') return null;
    const china = t('product.obs.course.clock.china');
    if (clock.phase === 'due') {
      return `${t('product.obs.course.clock.due')} · ${china}`;
    }
    const phase =
      clock.phase === 'betting'
        ? t('product.obs.course.clock.betting', { n: remain ?? '' })
        : t('product.obs.course.clock.evidence', { n: remain ?? '' });
    const until = chinaWallClock(view.settlesAt, nowMs);
    const untilLine = until
      ? t('product.obs.course.clock.evidenceUntil', {
          day: t(`product.obs.course.clock.day.${until.day}`),
          clock: until.clock,
        })
      : '';
    return untilLine ? `${phase} · ${untilLine} · ${china}` : `${phase} · ${china}`;
  }, [clock, remain, t, view.settlesAt, nowMs]);

  if (!act) return null;

  return (
    <div
      className={`og-course-act-bar${compact ? ' is-compact' : ''}`}
      role="group"
      aria-label={t(courseActLabelKey(act))}
    >
      {([1, 2, 3] as const).map((step) => {
        const active = step === act;
        const done = step < act;
        return (
          <div
            key={step}
            className={`og-course-act-bar__step${
              active ? ' og-course-act-bar__step--active' : ''
            }${done ? ' og-course-act-bar__step--done' : ''}`}
          >
            <span className="og-course-act-bar__index">{step}</span>
            <span className="og-course-act-bar__label">
              {t(courseActLabelKey(step))}
            </span>
            {active && remain ? (
              <span className="og-course-act-bar__remain">
                {t('product.obs.course.act.remain', { n: remain })}
              </span>
            ) : null}
          </div>
        );
      })}
      {!compact ? (
        <p className="og-course-act-bar__clock">{clockLine}</p>
      ) : null}
    </div>
  );
};
