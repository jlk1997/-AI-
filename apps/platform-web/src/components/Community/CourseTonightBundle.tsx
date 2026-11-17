/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cross-town「今夜套餐」summary — discovery hero above the per-town list.
 */

import React, { useEffect, useState } from 'react';
import { Button, Card, Space, Statistic, Tag, Typography } from 'antd';
import { GiftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../services/i18n';
import {
  courseBettingRemainKey,
  courseBettingRemainVars,
  courseStakeTonightHref,
  summarizeCourseTonight,
  type CourseStakeTonightItem,
} from './communityCourseLine';

const { Text } = Typography;

export const CourseTonightBundle: React.FC<{
  readonly items: readonly CourseStakeTonightItem[];
  readonly variant?: 'full' | 'compact';
  readonly onBrowse?: () => void;
}> = ({ items, variant = 'full', onBrowse }) => {
  const { isDark } = useTheme();
  const { t } = useT();
  const navigate = useNavigate();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const cardBg = isDark ? '#18181b' : '#ffffff';
  const cardBorder = isDark ? '#27272a' : '#e2e8f0';

  useEffect(() => {
    if (items.length === 0) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [items.length]);

  const summary = summarizeCourseTonight(items, nowMs);
  if (!summary) return null;

  const soonestLine =
    summary.soonestMinutes != null
      ? t(
          courseBettingRemainKey(summary.soonestMinutes),
          courseBettingRemainVars(summary.soonestMinutes),
        )
      : null;

  return (
    <Card
      className={`og-course-tonight-bundle${variant === 'compact' ? ' is-compact' : ''}${
        summary.townCount > 0 ? ' og-course-tonight-bundle--live' : ''
      }`}
      title={
        <Space>
          <GiftOutlined style={{ color: 'var(--color-gold)' }} />
          <span>{t('community.tonightBundle.title')}</span>
        </Space>
      }
      extra={
        onBrowse ? (
          <Button type="link" size="small" onClick={onBrowse}>
            {t('community.tonightBundle.browse')}
          </Button>
        ) : null
      }
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        marginBottom: variant === 'compact' ? 12 : 16,
      }}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('community.tonightBundle.subtitle', {
            towns: String(summary.townCount),
            pool: String(summary.totalPool),
            contested: String(summary.contestedCount),
          })}
        </Text>
        {variant === 'full' ? (
          <Space wrap size={16}>
            <Statistic
              title={t('community.tonightBundle.statTowns')}
              value={summary.townCount}
              valueStyle={{ fontSize: 20 }}
            />
            <Statistic
              title={t('community.tonightBundle.statPool')}
              value={summary.totalPool}
              valueStyle={{ fontSize: 20 }}
            />
            <Statistic
              title={t('community.tonightBundle.statContested')}
              value={summary.contestedCount}
              valueStyle={{ fontSize: 20 }}
            />
            {soonestLine ? (
              <Statistic
                title={t('community.tonightBundle.statSoonest')}
                value={soonestLine}
                valueStyle={{ fontSize: 14 }}
              />
            ) : null}
          </Space>
        ) : soonestLine ? (
          <Tag color="blue">
            {t('community.stakeTonight.closesIn', { time: soonestLine })}
          </Tag>
        ) : null}
        <Space wrap size={8}>
          {summary.topItems.map((item) => (
            <Button
              key={item.id}
              size="small"
              onClick={() => navigate(courseStakeTonightHref(item.slug))}
            >
              {item.title}
              {item.course.pool > 0
                ? ` · ${t('product.obs.course.pool', { n: String(item.course.pool) })}`
                : ''}
            </Button>
          ))}
        </Space>
      </Space>
    </Card>
  );
};
