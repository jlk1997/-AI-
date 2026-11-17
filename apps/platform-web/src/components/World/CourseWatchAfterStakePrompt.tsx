/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * After first stake in a town, nudge「观望」when the user is not subscribed yet.
 */

import React, { useState } from 'react';
import { Button, Space, message } from 'antd';
import { BellOutlined } from '@ant-design/icons';

import { api } from '../../services/api';
import { useT } from '../../services/i18n';
import {
  courseNotifySupported,
  enableCourseBrowserNotify,
} from './coursePulseUx';
import { registerCourseWebPush } from './coursePushClient';
import { markWatchAfterStakePromptSeen } from './courseWatchStakePrompt';
import { notifyCourseWatchChanged, trackCourseEvent } from './courseTelemetry';

export const CourseWatchAfterStakePrompt: React.FC<{
  readonly gameId: string;
  readonly onDone?: () => void;
  readonly onWatchingChange?: (watching: boolean) => void;
}> = ({ gameId, onDone, onWatchingChange }) => {
  const { t } = useT();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const finish = (accepted: boolean): void => {
    markWatchAfterStakePromptSeen(gameId);
    trackCourseEvent('course_watch_after_stake_nudge', { gameId, accepted });
    setOpen(false);
    onDone?.();
  };

  const syncPush = async (): Promise<void> => {
    if (!courseNotifySupported()) return;
    if (Notification.permission === 'granted') {
      await registerCourseWebPush();
      return;
    }
    const ok = await enableCourseBrowserNotify();
    if (ok) await registerCourseWebPush();
  };

  return (
    <div className="og-course-notify-prompt og-course-watch-after-stake">
      <p>{t('product.obs.course.watch.afterStake')}</p>
      <Space size={6} wrap>
        <Button
          size="small"
          type="primary"
          icon={<BellOutlined />}
          loading={busy}
          onClick={() => {
            setBusy(true);
            void api.me
              .courseWatch(gameId)
              .then(async () => {
                await syncPush().catch(() => undefined);
                onWatchingChange?.(true);
                notifyCourseWatchChanged();
                finish(true);
              })
              .catch(() => {
                message.error(t('product.obs.course.watch.fail'));
              })
              .finally(() => setBusy(false));
          }}
        >
          {t('product.obs.course.watch.afterStakeCta')}
        </Button>
        <Button
          size="small"
          type="link"
          onClick={() => finish(false)}
        >
          {t('product.obs.course.watch.afterStakeSkip')}
        </Button>
      </Space>
    </div>
  );
};
