/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, Card, List, Space, Tag, Typography, message } from 'antd';
import { TeamOutlined, UserOutlined } from '@ant-design/icons';

import { api, type FeedItem, type FollowedAuthor } from '../../services/api';
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
import { useT } from '../../services/i18n';

const { Text } = Typography;

type Suggested = FollowedAuthor & { works: number };

interface FollowingFeedProps {
  /** Hidden entirely for a signed-out reader: they follow nobody yet. */
  authenticated: boolean;
  limit?: number;
  /** `plain` drops the card chrome so the phone shell can own the spacing. */
  variant?: 'card' | 'plain';
}

export const FollowingFeed: React.FC<FollowingFeedProps> = ({
  authenticated,
  limit = 12,
  variant = 'card',
}) => {
  const navigate = useNavigate();
  const { t } = useT();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [suggested, setSuggested] = useState<Suggested[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    api.me
      .feed(limit)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setSuggested(res.suggested);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, limit]);

  const follow = async (author: Suggested): Promise<void> => {
    if (!author.handle) return;
    try {
      await api.users.follow(author.handle);
      setSuggested((prev) => prev.filter((a) => a.userId !== author.userId));
      const res = await api.me.feed(limit);
      setItems(res.items);
    } catch {
      message.error(t('profile.public.followFail'));
    }
  };

  if (!authenticated || !loaded) return null;
  if (items.length === 0 && suggested.length === 0) return null;

  const cardBg = 'var(--bg-card)';
  const cardBorder = 'var(--border-color)';

  const body = (
    <>
      {items.length === 0 ? (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            {t('feed.empty')}
          </Text>
          <List
            dataSource={suggested}
            renderItem={(author) => (
              <List.Item
                actions={[
                  <Button key="follow" size="small" onClick={() => void follow(author)}>
                    {t('profile.public.follow')}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar
                      src={author.avatarUrl ?? undefined}
                      icon={<UserOutlined />}
                      style={{ background: 'var(--color-ember)' }}
                    />
                  }
                  title={
                    <a onClick={() => navigate(`/u/${author.handle ?? ''}`)}>
                      {author.displayName}
                    </a>
                  }
                  description={t('feed.suggestedWorks', { count: author.works })}
                />
              </List.Item>
            )}
          />
        </>
      ) : (
        <List
          dataSource={items}
          renderItem={(item) => {
            const slug = item.kind === 'publish' ? item.slug : item.beat.slug;
            const title = item.kind === 'publish' ? item.title : item.beat.title;
            const teaser =
              item.kind === 'world' ? courseTeaser(item.beat.course) : null;
            const href =
              teaser && (teaser.open || teaser.evidence)
                ? coursePlayHref(slug, { course: true })
                : coursePlayHref(slug, { course: false });
            const remain =
              item.kind === 'world' && item.beat.course && teaser?.open
                ? courseBettingRemainMinutes(item.beat.course, nowMs)
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
                          key="stake"
                          type="link"
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(courseStakeTonightHref(slug));
                          }}
                        >
                          {t('product.obs.course.goStake')}
                        </Button>,
                      ]
                    : undefined
                }
              >
                <List.Item.Meta
                  avatar={
                    item.kind === 'publish' ? (
                      <Avatar
                        src={item.author.avatarUrl ?? undefined}
                        icon={<UserOutlined />}
                        style={{ background: 'var(--color-ember)' }}
                      />
                    ) : null
                  }
                  title={
                    <Space size={6} wrap>
                      <Text strong>{title}</Text>
                      {item.kind === 'publish' ? (
                        <Tag color="gold">{t('feed.published')}</Tag>
                      ) : (
                        <Tag color="cyan">
                          {t('community.tonight.day', {
                            day: Math.floor(item.beat.simTime / 24) + 1,
                          })}
                        </Tag>
                      )}
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
                      <Text style={{ fontSize: 13 }} type="secondary">
                        {item.kind === 'publish'
                          ? item.author.displayName
                          : item.beat.speakerName
                            ? `${item.beat.speakerName}：${item.beat.line}`
                            : item.beat.line}
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
    </>
  );

  if (variant === 'plain') {
    return (
      <section style={{ padding: '12px 12px 0' }}>
        <Text strong style={{ fontSize: 13 }}>
          {t('feed.title')}
        </Text>
        {body}
      </section>
    );
  }

  return (
    <Card
      title={
        <Space>
          <TeamOutlined style={{ color: 'var(--color-ember)' }} />
          <span>{t('feed.title')}</span>
        </Space>
      }
      style={{ background: cardBg, border: `1px solid ${cardBorder}`, marginBottom: 24 }}
    >
      {body}
    </Card>
  );
};
