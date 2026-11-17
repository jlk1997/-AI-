/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * A published world is not an arcade cabinet: what makes someone click is
 * tonight’s open question, then the clock and whether the town is still moving.
 */

import React, { useEffect, useState } from 'react';
import { Card, Space, Tag, Typography } from 'antd';
import { ClockCircleOutlined, EyeOutlined, TeamOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../services/i18n';
import type { CourseReturnHint, WorldStatusDto } from '../../services/api';
import {
  courseBettingRemainKey,
  courseBettingRemainMinutes,
  courseBettingRemainVars,
  courseTeaser,
  courseTeaserBadgeKey,
  courseTeaserShowsPrompt,
  courseTeaserTagColor,
  coursePlayHref,
} from './communityCourseLine';
import { WorldAudienceHint } from './WorldAudienceHint';
import { WorldPresenceTag } from './WorldPresenceTag';

const { Text, Paragraph } = Typography;

interface WorldCardProps {
  world: {
    id: string;
    title: string;
    slug: string;
    description?: string;
    playCount?: number;
    publishedAt?: string;
    world?: WorldStatusDto | null;
    course?: CourseReturnHint | null;
    isOfficial?: boolean;
    xiangyiEnabled?: boolean;
  };
}

export const WorldCard: React.FC<WorldCardProps> = ({ world }) => {
  const navigate = useNavigate();
  const { t } = useT();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!world.course || world.course.status !== 'open') return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [world.course?.status, world.course?.bettingClosesAt]);

  const status = world.world ?? null;
  const titleColor = 'var(--text-primary)';
  const mutedColor = 'var(--text-secondary)';
  const teaser = courseTeaser(world.course);
  const remain =
    world.course && teaser?.open
      ? courseBettingRemainMinutes(world.course, nowMs)
      : null;
  const remainLine =
    remain != null
      ? t(courseBettingRemainKey(remain), courseBettingRemainVars(remain))
      : null;

  return (
    <Card
      hoverable
      className="og-world-card"
      onClick={() =>
        navigate(
          teaser?.open
            ? coursePlayHref(world.slug || world.id, { course: true })
            : coursePlayHref(world.slug || world.id, { course: false }),
        )
      }
      style={{
        overflow: 'hidden',
      }}
      styles={{ body: { padding: 16 } }}
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space size={8} wrap>
          {world.isOfficial ? (
            <Tag color="gold" style={{ marginInlineEnd: 0 }}>
              {t('community.official')}
            </Tag>
          ) : null}
          <WorldPresenceTag
            living={status?.living}
            speaking={status?.speaking}
            clockPaused={status?.clockPaused}
            showIdle
          />
          <WorldAudienceHint status={status} />
          {teaser ? (
            <Tag
              color={courseTeaserTagColor(teaser)}
              style={{ marginInlineEnd: 0 }}
            >
              {t(courseTeaserBadgeKey(teaser))}
            </Tag>
          ) : null}
          {teaser?.actKey ? (
            <Tag color="gold" style={{ marginInlineEnd: 0 }}>
              {t(teaser.actKey)}
            </Tag>
          ) : null}
          {remainLine ? (
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
              {t('community.stakeTonight.closesIn', { time: remainLine })}
            </Tag>
          ) : null}
          {status?.simDays ? (
            <Text style={{ color: 'var(--color-teal)', fontSize: 12 }}>
              <ClockCircleOutlined /> {t('community.world.simDays', { days: status.simDays })}
            </Text>
          ) : null}
        </Space>

        <Paragraph
          strong
          ellipsis={{ rows: 1 }}
          style={{ color: titleColor, fontSize: 16, margin: 0 }}
        >
          {world.title}
        </Paragraph>

        {teaser ? (
          <Paragraph
            ellipsis={{ rows: 2 }}
            style={{ fontSize: 13, color: 'var(--color-teal)', margin: 0, minHeight: 22 }}
          >
            {courseTeaserShowsPrompt(teaser)
              ? t('community.world.coursePrompt', { prompt: teaser.prompt })
              : teaser.prompt}
          </Paragraph>
        ) : (
          <Paragraph
            ellipsis={{ rows: 2 }}
            style={{ fontSize: 12, color: mutedColor, margin: 0, minHeight: 32 }}
          >
            {world.description || t('community.noDescription')}
          </Paragraph>
        )}

        <Space size={16} wrap>
          {status?.residents ? (
            <Text style={{ color: mutedColor, fontSize: 12 }}>
              <TeamOutlined /> {t('community.world.people', { count: status.residents })}
            </Text>
          ) : null}
          <Text style={{ color: mutedColor, fontSize: 12 }}>
            <EyeOutlined /> {world.playCount ?? 0}
          </Text>
          <span className="og-world-card__cta">
            {teaser?.open
              ? t('product.obs.course.goStake')
              : t('community.world.observe')}{' '}
            →
          </span>
        </Space>
      </Space>
    </Card>
  );
};
