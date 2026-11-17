/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Space } from 'antd';

import { useT } from '../../services/i18n';
import {
  dismissCourseNotifyPrompt,
  enableCourseBrowserNotify,
} from './coursePulseUx';
import { registerCourseWebPush } from './coursePushClient';

export const CourseNotifyPrompt: React.FC<{
  readonly onDone?: () => void;
}> = ({ onDone }) => {
  const { t } = useT();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  return (
    <div className="og-course-notify-prompt">
      <p>{t('product.obs.course.notify.prompt')}</p>
      <Space size={6} wrap>
        <Button
          size="small"
          type="primary"
          loading={busy}
          onClick={() => {
            setBusy(true);
            void enableCourseBrowserNotify()
              .then(async (ok) => {
                if (ok) {
                  await registerCourseWebPush();
                }
                // Grant or deny — close so after-stake watch nudge can still appear.
                setOpen(false);
                onDone?.();
              })
              .finally(() => setBusy(false));
          }}
        >
          {t('product.obs.course.notify.enable')}
        </Button>
        <Button
          size="small"
          type="link"
          onClick={() => {
            dismissCourseNotifyPrompt();
            setOpen(false);
            onDone?.();
          }}
        >
          {t('product.obs.course.notify.later')}
        </Button>
      </Space>
    </div>
  );
};
