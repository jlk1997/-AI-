/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button } from 'antd';

import { useT } from '../../services/i18n';
import {
  courseNotifySupported,
  enableCourseBrowserNotify,
} from './coursePulseUx';
import { registerCourseWebPush } from './coursePushClient';
import { trackCourseEvent } from './courseTelemetry';

export const CourseNotifySettings: React.FC = () => {
  const { t } = useT();
  const [busy, setBusy] = useState(false);

  if (!courseNotifySupported()) return null;
  if (Notification.permission === 'granted') return null;

  return (
    <div className="og-course-notify-settings">
      <span>{t('product.obs.course.notify.off')}</span>
      <Button
        size="small"
        type="link"
        loading={busy}
        onClick={() => {
          setBusy(true);
          void enableCourseBrowserNotify()
            .then(async (ok) => {
              if (ok) await registerCourseWebPush();
              trackCourseEvent('course_notify_permission', {
                granted: ok,
                from: 'settings',
              });
            })
            .finally(() => setBusy(false));
        }}
      >
        {t('product.obs.course.notify.enable')}
      </Button>
    </div>
  );
};
