/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The worlds tab's reason to exist: what happened in published towns recently,
 * not another grid of covers.
 */

import React, { useEffect, useState } from 'react';
import { Button, Card, List, Space, Tag, Typography } from 'antd';
import { SoundOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../services/i18n';
import type { WorldActivityItem } from '../../services/api';
import {
  courseBettingRemainKey,
  courseBettingRemainMinutes,
  courseBettingRemainVars,
  courseStakeTonightHref,
  coursePlayHref,
  courseTeaser,
  courseTeaserBadgeKey,
  courseTeaserShowsPrompt,
  courseTeaserTagColor,
} from './communityCourseLine';

const { Text } = Typography;

interface TonightFeedProps {
  items: WorldActivityItem[];
}

export const TonightFeed: React.FC<TonightFeedProps> = ({ items }) => {
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

  const kindTag = (kind: WorldActivityItem['kind']): { color: string; label: string } => {
    if (kind === 'whisper') return { color: 'cyan', label: t('community.tonight.whisper') };
    if (kind === 'rumor') return { color: 'gold', label: t('community.tonight.rumor') };
    return { color: 'purple', label: t('community.tonight.talk') };
  };

  return (
    <Card
      title={
        <Space>
          <SoundOutlined style={{ color: 'var(--color-teal)' }} />
          <span>{t('community.tonight.title')}</span>
        </Space>
      }
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        marginBottom: 24,
      }}
    >
      {items.length === 0 ? (
        <Text type="secondary">{t('community.tonight.empty')}</Text>
      ) : (
        <List
          dataSource={items}
          renderItem={(item) => {
            const tag = kindTag(item.kind);
            const day = Math.floor(item.simTime / 24) + 1;
            const teaser = courseTeaser(item.course);
            const href =
              teaser && (teaser.open || teaser.evidence)
                ? coursePlayHref(item.slug, { course: true })
                : coursePlayHref(item.slug, { course: false });
            const remain =
              item.course && teaser?.open
                ? courseBettingRemainMinutes(item.course, nowMs)
                : null;
            const remainLine =
              remain != null
                ? t(courseBettingRemainKey(remain), courseBettingRemainVars(remain))
                : null;
            return (
              <List.Item
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(href)}
                actions={
                  teaser?.open
                    ? [
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
                      ]
                    : undefined
                }
              >
                <List.Item.Meta
                  title={
                    <Space size={6} wrap>
                      <Text strong>{item.title}</Text>
                      <Tag color={tag.color}>{tag.label}</Tag>
                      <Tag>{t('community.tonight.day', { day })}</Tag>
                      {teaser ? (
                        <Tag color={courseTeaserTagColor(teaser)}>
                          {t(courseTeaserBadgeKey(teaser))}
                        </Tag>
                      ) : null}
                      {teaser?.actKey ? (
                        <Tag color="gold">{t(teaser.actKey)}</Tag>
                      ) : null}
                      {remainLine ? (
                        <Tag color="blue">
                          {t('community.stakeTonight.closesIn', { time: remainLine })}
                        </Tag>
                      ) : null}
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Text style={{ fontSize: 13 }}>
                        {item.speakerName ? `${item.speakerName}：${item.line}` : item.line}
                      </Text>
                      {teaser ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {courseTeaserShowsPrompt(teaser)
                            ? t('community.world.coursePrompt', { prompt: teaser.prompt })
                            : teaser.prompt}
                        </Text>
                      ) : null}
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
};
