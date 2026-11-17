/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * `/u/:handle` — the shareable half of identity. No login required: a link to
 * an author should open a page with playable things on it, not a sign-in wall.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Avatar,
  Button,
  Card,
  Col,
  Empty,
  List,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  EyeOutlined,
  GlobalOutlined,
  UserAddOutlined,
  UserDeleteOutlined,
} from '@ant-design/icons';

import {
  api,
  type CommunityWorkSummary,
  type FollowCounts,
  type PublicAuthor,
} from '../services/api';
import { AlleyEmpty } from '../components/brand/AlleyEmpty';
import { WorldPresenceTag } from '../components/Community/WorldPresenceTag';
import { useT } from '../services/i18n';
import { useAppStore } from '../store';
import { rememberLoginReturnTo } from '../utils/loginIntent';

const { Title, Text, Paragraph } = Typography;

const NO_FOLLOWS: FollowCounts = { followers: 0, following: 0, viewerFollows: false };

export default function PublicProfilePage(): React.ReactElement {
  const { handle } = useParams<{ handle: string }>();
  const navigate = useNavigate();
  const { t } = useT();
  const { isAuthenticated } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [author, setAuthor] = useState<PublicAuthor | null>(null);
  const [joinedAt, setJoinedAt] = useState<string | null>(null);
  const [works, setWorks] = useState<CommunityWorkSummary[]>([]);
  const [follows, setFollows] = useState<FollowCounts>(NO_FOLLOWS);
  const [followPending, setFollowPending] = useState(false);
  const [isSelf, setIsSelf] = useState(false);

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    setLoading(true);
    api.users
      .publicProfile(handle)
      .then(async (res) => {
        if (cancelled) return;
        setAuthor(res.author);
        setJoinedAt(res.joinedAt);
        setWorks(res.works);
        setFollows({
          followers: res.followers,
          following: res.following,
          viewerFollows: res.viewerFollows,
        });
        // Your own page offers no follow button; the server refuses that edge
        // anyway, and a button that always errors is worse than no button.
        if (isAuthenticated) {
          const me = await api.me.profile().catch(() => null);
          if (!cancelled) setIsSelf(me?.userId === res.userId);
        }
      })
      .catch(() => {
        if (!cancelled) setAuthor(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handle, isAuthenticated]);

  /**
   * Following is the one action on this page that needs an account, so an
   * anonymous reader is sent to sign in and comes back here rather than losing
   * the page they were on.
   */
  const toggleFollow = async (): Promise<void> => {
    if (!handle) return;
    if (!isAuthenticated) {
      rememberLoginReturnTo(window.location.pathname);
      navigate('/login');
      return;
    }
    setFollowPending(true);
    try {
      const res = follows.viewerFollows
        ? await api.users.unfollow(handle)
        : await api.users.follow(handle);
      setFollows({
        followers: res.followers,
        following: res.following,
        viewerFollows: res.viewerFollows,
      });
    } catch {
      message.error(t('profile.public.followFail'));
    } finally {
      setFollowPending(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spin tip={t('common.loading')} />
      </div>
    );
  }

  if (!author) {
    return (
      <div style={{ padding: 40 }}>
        <Empty description={t('profile.public.notFound')} />
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Button type="primary" onClick={() => navigate('/community')}>
            {t('nav.goPlay')}
          </Button>
        </div>
      </div>
    );
  }

  const worlds = works.filter((w) => w.category === 'world');
  const games = works.filter((w) => w.category !== 'world');

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto', overflow: 'auto' }}>
      <Row align="middle" gutter={16} style={{ marginBottom: 24 }}>
        <Col>
          <Avatar size={72} src={author.avatarUrl ?? undefined} style={{ backgroundColor: 'var(--color-ember)' }}>
            {author.displayName.slice(0, 2).toUpperCase()}
          </Avatar>
        </Col>
        <Col flex="auto">
          <Title level={3} style={{ margin: 0 }}>
            {author.displayName}
          </Title>
          <Space size={12} wrap>
            {author.handle ? <Text type="secondary">@{author.handle}</Text> : null}
            {joinedAt ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('profile.public.joined', {
                  date: new Date(joinedAt).toLocaleDateString(),
                })}
              </Text>
            ) : null}
          </Space>
          {author.bio ? (
            <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              {author.bio}
            </Paragraph>
          ) : null}
          <Space size={24} style={{ marginTop: 12 }}>
            <Statistic
              title={t('profile.public.followers')}
              value={follows.followers}
              valueStyle={{ fontSize: 18 }}
            />
            <Statistic
              title={t('profile.public.following')}
              value={follows.following}
              valueStyle={{ fontSize: 18 }}
            />
          </Space>
        </Col>
        <Col>
          <Space direction="vertical" align="end">
            {isSelf ? null : (
              <Button
                type={follows.viewerFollows ? 'default' : 'primary'}
                icon={
                  follows.viewerFollows ? <UserDeleteOutlined /> : <UserAddOutlined />
                }
                loading={followPending}
                onClick={() => void toggleFollow()}
              >
                {follows.viewerFollows
                  ? t('profile.public.unfollow')
                  : t('profile.public.follow')}
              </Button>
            )}
            <Button icon={<GlobalOutlined />} onClick={() => navigate('/community')}>
              {t('nav.goPlay')}
            </Button>
          </Space>
        </Col>
      </Row>

      {works.length === 0 ? (
        <Card>
          <AlleyEmpty
            title={t('profile.public.empty')}
            hint={t('app.tagline')}
            action={t('nav.goPlay')}
            onAction={() => navigate('/community')}
          />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {games.length > 0 ? (
            <Col xs={24} lg={worlds.length > 0 ? 12 : 24}>
              <Card title={t('community.tab.games')}>
                <List
                  dataSource={games}
                  renderItem={(work) => (
                    <List.Item
                      actions={[
                        <Link key="play" to={`/community/game/${work.slug}`}>
                          {t('community.gameDetail.startGame')}
                        </Link>,
                      ]}
                    >
                      <List.Item.Meta
                        title={work.title}
                        description={
                          <Space size={12} wrap>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              <EyeOutlined /> {work.playCount}
                            </Text>
                            {work.description ? (
                              <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                                {work.description}
                              </Text>
                            ) : null}
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
          ) : null}
          {worlds.length > 0 ? (
            <Col xs={24} lg={games.length > 0 ? 12 : 24}>
              <Card title={t('community.tab.worlds')}>
                <List
                  dataSource={worlds}
                  renderItem={(work) => (
                    <List.Item
                      actions={[
                        <Link key="observe" to={`/community/game/${work.slug}`}>
                          {t('community.world.observe')}
                        </Link>,
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space size={6} wrap>
                            <span>{work.title}</span>
                            <WorldPresenceTag
                              living={work.world?.living}
                              speaking={work.world?.speaking}
                              clockPaused={work.world?.clockPaused}
                            />
                          </Space>
                        }
                        description={
                          work.world?.simDays
                            ? t('community.world.simDays', { days: work.world.simDays })
                            : work.description
                        }
                      />
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
          ) : null}
        </Row>
      )}
    </div>
  );
}
