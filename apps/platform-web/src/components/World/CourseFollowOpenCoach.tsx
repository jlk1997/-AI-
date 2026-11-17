/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Follower Web Push landing — nudge to pick a side on an open board.
 */

import React, { useEffect, useState } from 'react';
import { Button, Space } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';

import { courseActIndex } from '@opengame/platform-shared';

import { useT } from '../../services/i18n';
import { rememberPendingCourse } from '../../utils/loginIntent';
import {
  markCourseFollowCoachSeen,
  shouldShowCourseFollowCoach,
} from './courseFollowCoach';
import { trackCourseEvent } from './courseTelemetry';

export const CourseFollowOpenCoach: React.FC<{
  readonly gameId?: string | null;
  readonly status?: string | null;
  readonly bettingClosesAt?: string;
  readonly isAuthor?: boolean;
  readonly hasStake?: boolean;
  readonly isAuthenticated?: boolean;
  readonly followLanding?: boolean;
  /** Resume after login without `?follow=1` (pending course intent). */
  readonly forceOpen?: boolean;
  readonly onHighlightPick?: (active: boolean) => void;
  readonly onPickSide?: () => void;
  readonly onRequireLogin?: () => void;
  /** Parent clears forceOpen so dismiss sticks across board refresh. */
  readonly onClose?: () => void;
}> = ({
  gameId,
  status,
  bettingClosesAt,
  isAuthor,
  hasStake,
  isAuthenticated = true,
  followLanding = false,
  forceOpen = false,
  onHighlightPick,
  onPickSide,
  onRequireLogin,
  onClose,
}) => {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    if (isAuthor || hasStake) return;
    if (status !== 'open' || !bettingClosesAt) return;
    if (courseActIndex({ status, bettingClosesAt }) !== 1) return;
    if (!forceOpen && !followLanding) return;
    if (!forceOpen && !shouldShowCourseFollowCoach(gameId)) return;
    setOpen(true);
    trackCourseEvent('course_follow_open_land', {
      gameId,
      resume: forceOpen,
      guest: !isAuthenticated,
    });
  }, [
    followLanding,
    forceOpen,
    gameId,
    status,
    bettingClosesAt,
    isAuthor,
    hasStake,
    isAuthenticated,
  ]);

  useEffect(() => {
    onHighlightPick?.(open);
    return () => onHighlightPick?.(false);
  }, [open, onHighlightPick]);

  if (!open || !gameId) return null;

  const dismiss = (): void => {
    markCourseFollowCoachSeen(gameId);
    setOpen(false);
    onClose?.();
    trackCourseEvent('course_follow_open_coach', {
      gameId,
      accepted: false,
      guest: !isAuthenticated,
    });
  };

  const pick = (): void => {
    if (!isAuthenticated) {
      rememberPendingCourse({ gameId, kind: 'follow_open' });
      trackCourseEvent('course_follow_open_coach', {
        gameId,
        accepted: true,
        guest: true,
      });
      onRequireLogin?.();
      return;
    }
    markCourseFollowCoachSeen(gameId);
    setOpen(false);
    onClose?.();
    trackCourseEvent('course_follow_open_coach', {
      gameId,
      accepted: true,
      guest: false,
    });
    onPickSide?.();
  };

  return (
    <div className="og-course-notify-prompt og-course-follow-open-coach">
      <p>
        {t(
          isAuthenticated
            ? 'product.obs.course.followCoach.prompt'
            : 'product.obs.course.followCoach.guestPrompt',
        )}
      </p>
      <Space size={6} wrap>
        <Button
          size="small"
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={pick}
        >
          {t(
            isAuthenticated
              ? 'product.obs.course.followCoach.cta'
              : 'product.obs.course.followCoach.loginCta',
          )}
        </Button>
        <Button size="small" type="link" onClick={dismiss}>
          {t('product.obs.course.followCoach.skip')}
        </Button>
      </Space>
    </div>
  );
};
