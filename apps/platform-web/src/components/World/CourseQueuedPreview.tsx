/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Read-only preview of the author's queued next board.
 */

import React from 'react';
import { Space, Typography } from 'antd';

import { type CourseView } from '../../services/api';
import { useT } from '../../services/i18n';
import { courseSeedSourceKey } from './courseAuthorFlow';

const { Text } = Typography;

export const CourseQueuedPreview: React.FC<{
  readonly queued: CourseView;
}> = ({ queued }) => {
  const { t } = useT();
  const sourceKey = courseSeedSourceKey(queued.seedSource);

  return (
    <div className="og-course-queue-preview">
      <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
        {t('product.obs.course.queue.guestHint')}
      </Text>
      <Text strong style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
        {queued.prompt}
      </Text>
      <Space wrap size={6} style={{ marginTop: 6 }}>
        {queued.options.map((opt) => (
          <span key={opt.id} className="og-course-queue-preview__opt">
            {opt.label}
          </span>
        ))}
      </Space>
      {sourceKey ? (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
          {t(sourceKey)}
        </Text>
      ) : null}
    </div>
  );
};
