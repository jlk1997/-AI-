/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Visitor-friendly 3-step coach before login.
 */

import React, { useEffect, useState } from 'react';
import { Button, Space } from 'antd';

import { courseActIndex } from '@opengame/platform-shared';

import { useT } from '../../services/i18n';
import {
  courseGuestCoachSeen,
  markCourseGuestCoachSeen,
  trackCourseEvent,
  trackCourseEventOnce,
} from './courseTelemetry';

export const GuestCourseCoach: React.FC<{
  readonly status?: string | null;
  readonly bettingClosesAt?: string;
  readonly isAuthor?: boolean;
  readonly isAuthenticated?: boolean;
  readonly hasStake?: boolean;
  readonly minStake?: number;
  readonly shareLanding?: boolean;
  /** Follow / watch one-shot landings own the coach slot. */
  readonly suppressed?: boolean;
  readonly onHighlightPick?: (active: boolean) => void;
  readonly onLoginStake?: () => void;
  /** Clear shareLanding so dismiss sticks across board remount. */
  readonly onDismiss?: () => void;
}> = ({
  status,
  bettingClosesAt,
  isAuthor,
  isAuthenticated,
  hasStake,
  minStake = 12,
  shareLanding = false,
  suppressed = false,
  onHighlightPick,
  onLoginStake,
  onDismiss,
}) => {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (dismissed || suppressed || isAuthor || isAuthenticated || hasStake) {
      setOpen(false);
      return;
    }
    if (status !== 'open' || !bettingClosesAt) return;
    if (courseActIndex({ status, bettingClosesAt }) !== 1) return;
    if (!shareLanding && courseGuestCoachSeen()) return;
    setStep(0);
    setOpen(true);
    trackCourseEvent('course_act_view', {
      act: 1,
      guestCoach: true,
      shareLanding,
    });
    if (shareLanding) {
      trackCourseEventOnce('course-share-coach', 'course_share_land', {});
    }
  }, [status, bettingClosesAt, isAuthor, isAuthenticated, hasStake, shareLanding, suppressed, dismissed]);

  useEffect(() => {
    onHighlightPick?.(open && step === 0);
    return () => onHighlightPick?.(false);
  }, [open, step, onHighlightPick]);

  if (!open) return null;

  const lines = [
    t('product.obs.course.guestCoach.pick'),
    t('product.obs.course.guestCoach.stake'),
    t('product.obs.course.guestCoach.wait'),
  ];

  const dismiss = (): void => {
    markCourseGuestCoachSeen();
    setDismissed(true);
    setOpen(false);
    onDismiss?.();
  };

  return (
    <div className="og-course-onboarding og-course-guest-coach">
      <div className="og-course-onboarding__dots" aria-hidden>
        {lines.map((_, i) => (
          <span
            key={i}
            className={`og-course-onboarding__dot${i === step ? ' is-active' : ''}`}
          />
        ))}
      </div>
      <p>{lines[step]}</p>
      <div className="og-course-onboarding__actions">
        <Space size={6} wrap>
          {step < lines.length - 1 ? (
            <Button size="small" type="primary" onClick={() => setStep((n) => n + 1)}>
              {t('product.obs.course.modal.next')}
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              onClick={() => {
                dismiss();
                onLoginStake?.();
              }}
            >
              {t('product.obs.course.guestCoach.loginCta', { n: String(minStake) })}
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
