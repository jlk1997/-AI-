/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Spin, Tooltip, Typography } from 'antd';

import { api, type CourseAuthorStats } from '../../services/api';
import { useT } from '../../services/i18n';

const { Text } = Typography;

function pct(rate: number | null): string {
  if (rate == null) return '—';
  return `${Math.round(rate * 100)}%`;
}

export const CourseAuthorStatsStrip: React.FC<{
  readonly gameId?: string | null;
  readonly projectId?: string | null;
}> = ({ gameId, projectId }) => {
  const { t } = useT();
  const [stats, setStats] = useState<CourseAuthorStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const req = gameId
      ? api.community.courseStats(gameId)
      : projectId
        ? api.community.worldCourseStats(projectId)
        : null;
    if (!req) return;
    setLoading(true);
    void req
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [gameId, projectId]);

  if (loading && !stats) {
    return (
      <div className="og-course-author-stats">
        <Spin size="small" />
      </div>
    );
  }
  if (!stats || stats.finished === 0) return null;

  return (
    <Tooltip title={t('product.obs.course.authorStats.hint', { n: String(stats.window) })}>
      <div className="og-course-author-stats">
        <Text type="secondary" style={{ fontSize: 12 }}>
        {t('product.obs.course.authorStats.title', {
          n: String(stats.window),
        })}
        {' · '}
        {t('product.obs.course.authorStats.contested', {
          pct: pct(stats.contestedRate),
        })}
        {' · '}
        {t('product.obs.course.authorStats.void', {
          pct: pct(stats.voidRate),
        })}
        {' · '}
        {t('product.obs.course.authorStats.seeds', {
          n: String(stats.seeds),
        })}
      </Text>
      </div>
    </Tooltip>
  );
};
