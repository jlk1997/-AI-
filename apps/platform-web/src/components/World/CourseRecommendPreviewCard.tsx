/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Author dry-run recommend card (from GET course/recommend).
 */

import React from 'react';
import { Button, Space, Typography } from 'antd';

import { type CourseRecommendPreview } from '../../services/api';
import { useT } from '../../services/i18n';
import { courseReachabilityDeskKey, courseSeedSourceKey } from './courseAuthorFlow';
import type { CourseRecommendPreviewError } from './useCourseRecommendPreview';

const { Text } = Typography;

export const CourseRecommendPreviewCard: React.FC<{
  readonly preview: CourseRecommendPreview | null;
  readonly loading?: boolean;
  readonly compact?: boolean;
  readonly error?: CourseRecommendPreviewError;
  readonly hintKey?: string | null;
  readonly onRetry?: () => void;
}> = ({
  preview,
  loading = false,
  compact = false,
  error = null,
  hintKey = null,
  onRetry,
}) => {
  const { t } = useT();

  if (loading) {
    return (
      <Text type="secondary" style={{ fontSize: compact ? 11 : 12 }}>
        {t('product.obs.course.recommend.loading')}
      </Text>
    );
  }
  if (!preview) {
    const emptyKey =
      error === 'cannot_preview' && hintKey
        ? hintKey
        : error === 'network'
          ? 'product.obs.course.recommend.network'
          : 'product.obs.course.recommend.empty';
    return (
      <Space orientation="vertical" size={6}>
        <Text type="warning" style={{ fontSize: compact ? 11 : 12 }}>
          {t(emptyKey)}
        </Text>
        {error === 'network' && onRetry ? (
          <Button size="small" type="link" onClick={onRetry} style={{ padding: 0, height: 'auto' }}>
            {t('product.obs.course.recommend.retry')}
          </Button>
        ) : null}
      </Space>
    );
  }

  const sourceKey = courseSeedSourceKey(preview.seedSource);
  const reachKey = courseReachabilityDeskKey(preview.reachability);

  return (
    <div
      className={
        compact
          ? 'og-course-recommend-preview og-course-recommend-preview--compact'
          : 'og-course-recommend-preview'
      }
    >
      {!compact ? (
        <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
          {t('product.obs.course.recommend.previewTitle')}
        </Text>
      ) : null}
      <Text
        strong
        style={{
          fontSize: compact ? 13 : 14,
          display: 'block',
          marginTop: compact ? 0 : 4,
        }}
      >
        {preview.prompt}
      </Text>
      <Space wrap size={6} style={{ marginTop: 8 }}>
        {preview.options.map((opt, index) => (
          <span key={`${opt.label}-${index}`} className="og-course-recommend-preview__opt">
            {opt.label}
          </span>
        ))}
      </Space>
      <Space wrap size={8} style={{ marginTop: 8 }}>
        {sourceKey ? (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t(sourceKey)}
          </Text>
        ) : null}
        {reachKey ? (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t(reachKey)}
          </Text>
        ) : null}
      </Space>
    </div>
  );
};
