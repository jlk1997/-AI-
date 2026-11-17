/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Space } from 'antd';

import { courseActIndex } from '@opengame/platform-shared';

import { useT } from '../../services/i18n';
import { featureFlags } from '../../utils/featureFlags';
import {
  courseOnboardingSeen,
  markCourseOnboardingSeen,
  trackCourseEvent,
} from './courseTelemetry';

export const CourseOnboardingCoach: React.FC<{
  readonly status?: string | null;
  readonly bettingClosesAt?: string;
  readonly isAuthor?: boolean;
  readonly hasStake?: boolean;
  /** Logged-in visitors only — guests use GuestCourseCoach. */
  readonly isAuthenticated?: boolean;
  readonly onHighlightPick?: (active: boolean) => void;
}> = ({
  status,
  bettingClosesAt,
  isAuthor,
  hasStake,
  isAuthenticated = false,
  onHighlightPick,
}) => {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || isAuthor || hasStake || courseOnboardingSeen()) return;
    if (status !== 'open' || !bettingClosesAt) return;
    if (courseActIndex({ status, bettingClosesAt }) !== 1) return;
    setOpen(true);
    trackCourseEvent('course_act_view', { act: 1, onboarding: true });
  }, [status, bettingClosesAt, isAuthor, hasStake, isAuthenticated]);

  useEffect(() => {
    onHighlightPick?.(open && step === 0);
    return () => onHighlightPick?.(false);
  }, [open, step, onHighlightPick]);

  if (!open) return null;

  const lines = [
    t('product.obs.course.onboarding.pick'),
    t('product.obs.course.onboarding.stake'),
    t('product.obs.course.onboarding.wait'),
  ];
  // 5 幕 UX：客户下注前的"规则预览"+ "AI 判"说明，只在 flag 开时追加。
  const rulesSteps: ReadonlyArray<readonly string[]> = featureFlags.courseUxV2
    ? [
        [
          t('product.obs.course.rules.l1'),
          t('product.obs.course.rules.l2'),
          t('product.obs.course.rules.l3'),
          t('product.obs.course.rules.l4'),
        ],
        [t('product.obs.course.aiJudgeShort')],
      ]
    : [];
  const steps = lines.length + rulesSteps.length;

  const dismiss = (): void => {
    markCourseOnboardingSeen();
    setOpen(false);
  };

  return (
    <div className="og-course-onboarding">
      <div className="og-course-onboarding__dots" aria-hidden>
        {Array.from({ length: steps }).map((_, i) => (
          <span
            key={i}
            className={`og-course-onboarding__dot${i === step ? ' is-active' : ''}`}
          />
        ))}
      </div>
      {step < lines.length ? (
        <p>{lines[step]}</p>
      ) : (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          {(rulesSteps[step - lines.length] ?? []).map((line, i) => (
            <p key={i} style={{ margin: 0 }}>{line}</p>
          ))}
        </Space>
      )}
      <div className="og-course-onboarding__actions">
        <Space size={6} wrap>
          {step < steps - 1 ? (
            <Button size="small" type="primary" onClick={() => setStep((n) => n + 1)}>
              {t('product.obs.course.modal.next')}
            </Button>
          ) : (
            <Button size="small" type="primary" onClick={dismiss}>
              {t('product.obs.course.rules.ok')}
            </Button>
          )}
          <Button size="small" type="link" onClick={dismiss}>
            {t('product.obs.course.onboarding.skip')}
          </Button>
        </Space>
      </div>
    </div>
  );
};
