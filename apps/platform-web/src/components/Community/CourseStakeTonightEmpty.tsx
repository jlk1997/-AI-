/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Card, Space, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

import { api } from '../../services/api';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../services/i18n';
import {
  collectStakeTonightItems,
  courseStakeTonightHref,
  summarizeCourseTonight,
} from './communityCourseLine';

const { Text } = Typography;

export const CourseStakeTonightEmpty: React.FC = () => {
  const { isDark } = useTheme();
  const { t } = useT();
  const navigate = useNavigate();
  const [topSlug, setTopSlug] = useState<string | null>(null);
  const cardBg = isDark ? '#18181b' : '#ffffff';
  const cardBorder = isDark ? '#27272a' : '#e2e8f0';

  useEffect(() => {
    let cancelled = false;
    void api.community
      .courseTonight()
      .then((res) => {
        if (cancelled) return;
        const items = collectStakeTonightItems(
          res.items.map((row) => ({
            id: row.gameId,
            slug: row.slug,
            title: row.title,
            course: row.course,
          })),
        );
        const summary = summarizeCourseTonight(items);
        setTopSlug(summary?.topItems[0]?.slug ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        marginBottom: 24,
      }}
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space>
          <ThunderboltOutlined style={{ color: 'var(--color-teal)' }} />
          <Text>{t('community.stakeTonight.empty')}</Text>
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('community.stakeTonight.emptyHint')}
        </Text>
        {topSlug ? (
          <Button type="primary" size="small" onClick={() => navigate(courseStakeTonightHref(topSlug))}>
            {t('community.stakeTonight.emptyCta')}
          </Button>
        ) : null}
      </Space>
    </Card>
  );
};
