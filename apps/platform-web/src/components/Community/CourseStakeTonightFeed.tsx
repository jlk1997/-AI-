/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Discovery strip: towns with an open betting window right now.
 */

import React, { useEffect, useState } from 'react';
import { Button, Card, List, Space, Tag, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../services/i18n';
import {
  courseBettingRemainKey,
  courseBettingRemainMinutes,
  courseBettingRemainVars,
  courseStakeTonightHref,
  courseTeaser,
  type CourseStakeTonightItem,
} from './communityCourseLine';
import { CourseStakeTonightEmpty } from './CourseStakeTonightEmpty';

const { Text } = Typography;

export const CourseStakeTonightFeed: React.FC<{
  readonly items: readonly CourseStakeTonightItem[];
}> = ({ items }) => {
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

  if (items.length === 0) return <CourseStakeTonightEmpty />;

  return (
    <Card
      title={
        <Space>
          <ThunderboltOutlined style={{ color: 'var(--color-teal)' }} />
          <span>{t('community.stakeTonight.title')}</span>
        </Space>
      }
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        marginBottom: 24,
      }}
    >
      <List
        dataSource={[...items]}
        renderItem={(item) => {
          const teaser = courseTeaser(item.course);
          const remain = courseBettingRemainMinutes(item.course, nowMs);
          const remainLine =
            remain != null
              ? t(courseBettingRemainKey(remain), courseBettingRemainVars(remain))
              : null;
          return (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(courseStakeTonightHref(item.slug))}
              actions={[
                <Button
                  key="go"
                  type="link"
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(courseStakeTonightHref(item.slug));
                  }}
                >
                  {t('product.obs.course.goStake')}
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space size={6} wrap>
                    <Text strong>{item.title}</Text>
                    <Tag color="magenta">{t('community.world.stakeTonight')}</Tag>
                    {teaser?.actKey ? (
                      <Tag color="gold">{t(teaser.actKey)}</Tag>
                    ) : null}
                    {item.course.contested ? (
                      <Tag color="green">{t('product.obs.course.contested')}</Tag>
                    ) : (
                      <Tag>{t('product.obs.course.needOpponent')}</Tag>
                    )}
                    {item.course.pool > 0 ? (
                      <Tag>
                        {t('product.obs.course.pool', {
                          n: String(item.course.pool),
                        })}
                      </Tag>
                    ) : null}
                    {remainLine ? (
                      <Tag icon={null} color="blue">
                        {t('community.stakeTonight.closesIn', { time: remainLine })}
                      </Tag>
                    ) : null}
                  </Space>
                }
                description={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('community.world.coursePrompt', { prompt: item.course.prompt })}
                  </Text>
                }
              />
            </List.Item>
          );
        }}
      />
    </Card>
  );
};
