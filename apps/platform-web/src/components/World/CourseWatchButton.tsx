/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 *「这镇有盘时提醒我」— 不要求先压盘，观望开压/封盘/结果。
 */

import React, { useEffect, useState } from 'react';
import { Button, Space, Typography, message } from 'antd';
import { BellOutlined, BellFilled } from '@ant-design/icons';

import { api } from '../../services/api';
import { useT } from '../../services/i18n';
import {
  courseNotifySupported,
  enableCourseBrowserNotify,
} from './coursePulseUx';
import { registerCourseWebPush } from './coursePushClient';
import { trackCourseEvent, notifyCourseWatchChanged } from './courseTelemetry';

const { Text } = Typography;

export const CourseWatchButton: React.FC<{
  readonly gameId: string;
  readonly watching: boolean;
  readonly compact?: boolean;
  readonly onWatchingChange?: (watching: boolean) => void;
  readonly onRequireLogin?: () => void;
  readonly isAuthenticated?: boolean;
}> = ({
  gameId,
  watching,
  compact = false,
  onWatchingChange,
  onRequireLogin,
  isAuthenticated = true,
}) => {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [localWatching, setLocalWatching] = useState(watching);

  useEffect(() => {
    setLocalWatching(watching);
  }, [watching]);

  const active = localWatching || watching;

  const syncPush = async (): Promise<void> => {
    if (!courseNotifySupported()) return;
    if (Notification.permission === 'granted') {
      await registerCourseWebPush();
      return;
    }
    const ok = await enableCourseBrowserNotify();
    if (ok) await registerCourseWebPush();
  };

  const toggle = (next: boolean): void => {
    setBusy(true);
    const req = next
      ? api.me.courseWatch(gameId)
      : api.me.courseUnwatch(gameId);
    void req
      .then(async () => {
        if (next) await syncPush().catch(() => undefined);
        setLocalWatching(next);
        onWatchingChange?.(next);
        notifyCourseWatchChanged();
        trackCourseEvent(next ? 'course_watch_enable' : 'course_watch_disable', {
          gameId,
        });
        message.success(
          next
            ? t('product.obs.course.watch.enabled')
            : t('product.obs.course.watch.disabled'),
        );
      })
      .catch(() => {
        message.error(t('product.obs.course.watch.fail'));
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className={`og-course-watch${compact ? ' is-compact' : ''}`}>
      {!compact ? (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
          {t('product.obs.course.watch.hint')}
        </Text>
      ) : null}
      <Space size={8} wrap>
        <Button
          size="small"
          type={active ? 'default' : 'primary'}
          icon={active ? <BellFilled /> : <BellOutlined />}
          loading={busy}
          onClick={() => {
            if (!isAuthenticated) {
              onRequireLogin?.();
              return;
            }
            toggle(!active);
          }}
        >
          {active ? t('product.obs.course.watch.active') : t('product.obs.course.watch.cta')}
        </Button>
        {active ? (
          <Button
            size="small"
            type="link"
            loading={busy}
            onClick={() => toggle(false)}
            style={{ padding: 0, height: 'auto' }}
          >
            {t('product.obs.course.watch.off')}
          </Button>
        ) : null}
      </Space>
    </div>
  );
};
