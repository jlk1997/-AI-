/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * "My page": the author-facing half of the dual loop. It answers three
 * questions the studio could not — who do others see, where are my published
 * things, and is anything worth coming back for (followed towns that moved on).
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Avatar,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  List,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  ClockCircleOutlined,
  EyeOutlined,
  GlobalOutlined,
  HomeOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
} from '@ant-design/icons';

import {
  api,
  type CommunityWorkSummary,
  type FollowedWorld,
  type MyWorks,
  type PlayHistoryEntry,
  type KaiMarket,
  type UserProfile,
} from '../services/api';
import { AlleyEmpty } from '../components/brand/AlleyEmpty';
import { WorldAudienceHint } from '../components/Community/WorldAudienceHint';
import { WorldPresenceTag } from '../components/Community/WorldPresenceTag';
import { useT } from '../services/i18n';
import { useAppStore } from '../store';
import { followTownLiveCopy } from '../components/World/societyTownHonesty';
import { canShareTownDays, shareFollowedTown, townDaysLived } from '../utils/shareWork';
import { featureFlags } from '../utils/featureFlags';
import {
  courseStakeTonightHref,
  courseTeaser,
} from '../components/Community/communityCourseLine';
import { CourseTonightHubCard } from '../components/World/CourseTonightHubCard';
import { CourseReturnCapsule } from '../components/World/CourseReturnCapsule';
import { useMyCourseTonight } from '../components/World/myCourseTonightStore';
import {
  accountPrivacyError,
  closeOwnAccount,
  downloadAccountExport,
} from '../utils/accountPrivacy';

const { Title, Text, Paragraph } = Typography;

interface QuotaCard {
  plan: string;
  dailyJobLimit: number;
  maxConcurrentJobs: number;
}

function WorkList({
  works,
  emptyText,
  emptyAction,
  onEmpty,
  onOpenStudio,
}: {
  works: CommunityWorkSummary[];
  emptyText: string;
  emptyAction: string;
  onEmpty: () => void;
  onOpenStudio: (work: CommunityWorkSummary) => void;
}): React.ReactElement {
  const { t } = useT();
  if (works.length === 0) {
    return (
      <AlleyEmpty
        title={emptyText}
        hint={t('app.tagline')}
        action={emptyAction}
        onAction={onEmpty}
      />
    );
  }
  return (
    <List
      dataSource={works}
      renderItem={(work) => (
        <List.Item
          actions={[
            <Link key="open" to={`/community/game/${work.slug}`}>
              {work.category === 'world'
                ? t('community.world.observe')
                : t('community.gameDetail.startGame')}
            </Link>,
            <a key="studio" onClick={() => onOpenStudio(work)}>
              {t('profile.works.openStudio')}
            </a>,
          ]}
        >
          <List.Item.Meta
            title={
              <Space size={6} wrap>
                <span>{work.title}</span>
                {work.takenDownAt ? (
                  <Tag color="red">{t('community.takedown.tag')}</Tag>
                ) : !work.isPublic ? (
                  <Tag>{t('profile.works.private')}</Tag>
                ) : null}
                <WorldPresenceTag
                  living={work.world?.living}
                  speaking={work.world?.speaking}
                  clockPaused={work.world?.clockPaused}
                />
                {work.world?.simDays ? (
                  <Tag color="cyan">
                    {t('community.world.simDays', { days: work.world.simDays })}
                  </Tag>
                ) : null}
                <WorldAudienceHint status={work.world} />
              </Space>
            }
            description={
              <Space size={12} wrap>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <EyeOutlined /> {work.playCount}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {new Date(work.publishedAt).toLocaleDateString()}
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
  );
}

export default function ProfilePage(): React.ReactElement {
  const navigate = useNavigate();
  const { t } = useT();
  const { isAuthenticated, logout } = useAppStore();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState({ achievements: 0, saves: 0 });
  const [works, setWorks] = useState<MyWorks | null>(null);
  const [history, setHistory] = useState<PlayHistoryEntry[]>([]);
  const [follows, setFollows] = useState<FollowedWorld[]>([]);
  const { stakes: courseStakes, watches: courseWatches, refresh: refreshCourseTonight } =
    useMyCourseTonight();
  const [quota, setQuota] = useState<QuotaCard | null>(null);
  const [market, setMarket] = useState<KaiMarket | null>(null);
  const [logins, setLogins] = useState<
    Array<{ id: string; method: string; ip: string | null; createdAt: string }>
  >([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profileRes, worksRes, historyRes, followsRes, quotaRes, marketRes, loginRes] =
        await Promise.all([
        api.me.profile(),
        api.me.works().catch(() => null),
        api.me.history().catch(() => ({ history: [] })),
        api.me.follows().catch(() => ({ follows: [] })),
        api.billing.quota().catch(() => null),
        api.billing.market().catch(() => null),
        api.auth.logins().catch(() => ({ events: [] })),
      ]);
      setProfile(profileRes.profile);
      setStats({
        achievements: profileRes.achievements.length,
        saves: profileRes.savesCount,
      });
      setWorks(worksRes);
      setHistory(historyRes.history);
      setFollows(followsRes.follows);
      setQuota(
        quotaRes
          ? {
              plan: quotaRes.plan,
              dailyJobLimit: quotaRes.dailyJobLimit,
              maxConcurrentJobs: quotaRes.maxConcurrentJobs,
            }
          : null,
      );
      setMarket(marketRes);
      setLogins(loginRes.events);
      if (profileRes.profile) {
        form.setFieldsValue({
          handle: profileRes.profile.handle ?? '',
          displayName: profileRes.profile.displayName ?? '',
          avatarUrl: profileRes.profile.avatarUrl ?? '',
          bio: profileRes.profile.bio ?? '',
        });
      }
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : 'failed to load profile';
      message.error(text);
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    void load();
  }, [isAuthenticated, load, navigate]);

  const handleSave = async () => {
    const values = (await form.validateFields()) as {
      handle?: string;
      displayName?: string;
      avatarUrl?: string;
      bio?: string;
      birthYear?: number;
    };
    setSaving(true);
    try {
      const res = await api.me.updateProfile({
        handle: values.handle?.trim() ?? '',
        displayName: values.displayName?.trim() ?? '',
        avatarUrl: values.avatarUrl?.trim() ?? '',
        bio: values.bio?.trim() ?? '',
      });
      setProfile(res.profile);
      if (values.birthYear) {
        await api.auth.acceptLegal({ birthYear: values.birthYear, acceptedLegal: true });
      }
      message.success(t('profile.save.success'));
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 409) {
        message.error(t('profile.handle.taken'));
      } else if (status === 400) {
        message.error(t('profile.handle.invalid'));
      } else {
        message.error(t('profile.save.failed'));
      }
    } finally {
      setSaving(false);
    }
  };

  const openInStudio = (work: CommunityWorkSummary) => {
    const params = new URLSearchParams({ project: work.projectId });
    if (work.category === 'world') params.set('mode', 'world');
    navigate(`/?${params.toString()}`);
  };

  const publicUrl = profile?.handle ? `${window.location.origin}/u/${profile.handle}` : null;

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spin tip={t('common.loading')} />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1180, margin: '0 auto', overflow: 'auto' }}>
      <Row align="middle" gutter={16} style={{ marginBottom: 24 }}>
        <Col>
          <Avatar size={64} src={profile?.avatarUrl ?? undefined} style={{ backgroundColor: 'var(--color-ember)' }}>
            {(profile?.displayName ?? 'OG').slice(0, 2).toUpperCase()}
          </Avatar>
        </Col>
        <Col flex="auto">
          <Title level={3} style={{ margin: 0 }}>
            {profile?.displayName ?? t('profile.me.title')}
          </Title>
          {publicUrl ? (
            <Space size={8}>
              <Text type="secondary">@{profile?.handle}</Text>
              <Tooltip title={t('profile.publicLink.copy')}>
                <Button
                  size="small"
                  type="link"
                  icon={<LinkOutlined />}
                  onClick={() => {
                    void navigator.clipboard.writeText(publicUrl);
                    message.success(t('profile.publicLink.copied'));
                  }}
                >
                  {t('profile.publicLink')}
                </Button>
              </Tooltip>
              {profile?.handle ? (
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    const url = `${window.location.origin}/community?invite=${profile.handle}`;
                    void navigator.clipboard.writeText(url);
                    message.success(t('kai.invite.copied'));
                  }}
                >
                  {t('kai.invite.copy')}
                </Button>
              ) : null}
            </Space>
          ) : (
            <Text type="secondary">{t('profile.handle.missing')}</Text>
          )}
        </Col>
        <Col>
          <Space>
            <Button onClick={() => navigate('/wallet')}>{t('nav.points')}</Button>
            <Button icon={<GlobalOutlined />} onClick={() => navigate('/community')}>
              {t('nav.goPlay')}
            </Button>
            <Button type="primary" icon={<HomeOutlined />} onClick={() => navigate('/')}>
              {t('nav.goCreate')}
            </Button>
          </Space>
        </Col>
      </Row>

      <Card title={t('profile.logins.title')} style={{ marginBottom: 24 }}>
        {logins.length === 0 ? (
          <Text type="secondary">{t('profile.logins.empty')}</Text>
        ) : (
          <List
            dataSource={logins}
            renderItem={(item) => (
              <List.Item>
                {t(`profile.logins.method.${item.method}`)}
                {' · '}
                {new Date(item.createdAt).toLocaleString()}
                {item.ip ? ` · ${item.ip}` : ''}
              </List.Item>
            )}
          />
        )}
      </Card>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={10}>
          <Card title={t('profile.me.identity')}>
            <Form form={form} layout="vertical" size="small">
              <Form.Item
                name="handle"
                label={t('profile.field.handle')}
                rules={[
                  {
                    pattern: /^[a-z0-9_]{3,20}$/,
                    message: t('profile.handle.invalid'),
                  },
                ]}
              >
                <Input placeholder="pixel_smith" allowClear />
              </Form.Item>
              <Form.Item name="displayName" label={t('profile.field.displayName')}>
                <Input maxLength={40} allowClear />
              </Form.Item>
              <Form.Item name="avatarUrl" label={t('profile.field.avatar')}>
                <Input placeholder="https://…" allowClear />
              </Form.Item>
              <Form.Item name="bio" label={t('profile.field.bio')}>
                <Input.TextArea rows={2} maxLength={280} showCount />
              </Form.Item>
              <Form.Item name="birthYear" label={t('login.legal.birthYear')}>
                <InputNumber min={1900} max={new Date().getFullYear() - 13} style={{ width: '100%' }} />
              </Form.Item>
              <Button type="primary" loading={saving} onClick={() => void handleSave()}>
                {t('profile.save')}
              </Button>
              <Space style={{ marginTop: 12 }}>
                <Button
                  onClick={() => {
                    void downloadAccountExport()
                      .then(() => message.success(t('account.exportOk')))
                      .catch((err: unknown) =>
                        message.error(accountPrivacyError(err) || t('account.exportFail')),
                      );
                  }}
                >
                  {t('account.export')}
                </Button>
                <Button
                  danger
                  onClick={() => {
                    if (!window.confirm(t('account.deleteConfirm'))) return;
                    void closeOwnAccount()
                      .then(() => {
                        logout();
                        message.success(t('account.deleteOk'));
                        navigate('/login');
                      })
                      .catch((err: unknown) =>
                        message.error(accountPrivacyError(err) || t('account.deleteFail')),
                      );
                  }}
                >
                  {t('account.delete')}
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title={t('profile.works.games')}
                  value={works?.games.length ?? 0}
                  prefix={<PlayCircleOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title={t('profile.works.worlds')}
                  value={works?.worlds.length ?? 0}
                  prefix={<GlobalOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title={t('profile.stats.achievements')}
                  value={stats.achievements}
                  prefix={<TrophyOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title={t('profile.kai.tonight')}
                  value={market?.authorTonight ?? 0}
                  prefix={<ThunderboltOutlined />}
                />
                {market?.authorTonightByKind ? (
                  <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                    {t('kai.author.tonightKind', {
                      tip: market.authorTonightByKind.tip,
                      jiaxi: market.authorTonightByKind.jiaxi,
                      xiangyi: market.authorTonightByKind.xiangyi,
                      townTime: market.authorTonightByKind.townTime ?? 0,
                      worldLight: market.authorTonightByKind.worldLight ?? 0,
                    })}
                  </Text>
                ) : null}
                {market?.authorWeek ? (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t('profile.kai.week', { points: market.authorWeek })}
                  </Text>
                ) : null}
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title={t('profile.kai.streak')}
                  value={market?.loginStreak ?? market?.daily?.streak ?? 0}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title={t('profile.history.title')}
                  value={history.length}
                  prefix={<EyeOutlined />}
                />
              </Card>
            </Col>
          </Row>
          {quota ? (
            <Card title={t('profile.quota.title')} style={{ marginTop: 16 }} size="small">
              <Space size={24} wrap>
                <Statistic title={t('profile.quota.plan')} value={quota.plan} />
                <Statistic title={t('profile.quota.daily')} value={quota.dailyJobLimit} />
                <Statistic
                  title={t('profile.quota.concurrent')}
                  value={quota.maxConcurrentJobs}
                />
              </Space>
              <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                {t('profile.quota.hint')}
              </Paragraph>
            </Card>
          ) : null}
        </Col>
      </Row>

      {featureFlags.courseMarket
      && (courseStakes.length > 0 || courseWatches.length > 0) ? (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginBottom: 8,
            }}
          >
            <CourseReturnCapsule />
          </div>
          <CourseTonightHubCard
            stakes={courseStakes}
            watches={courseWatches}
            onWatchesChange={() => void refreshCourseTonight()}
          />
        </>
      ) : null}

      <Card
        title={
          <Space>
            <ClockCircleOutlined />
            {t('profile.follows.title')}
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        {follows.length === 0 ? (
          <AlleyEmpty
            title={t('profile.follows.empty')}
            hint={t('app.tagline')}
            action={t('nav.goPlay')}
            onAction={() => navigate('/community')}
          />
        ) : (
          <List
            dataSource={follows}
            renderItem={(item) => {
              const liveCopy = followTownLiveCopy({
                watcherCount: item.world?.watcherCount,
                newHours: item.newHours,
                clockPaused: item.world?.clockPaused,
              });
              const summary = t(liveCopy.key, liveCopy.vars);
              const courseLine =
                featureFlags.courseMarket && item.course ? courseTeaser(item.course) : null;
              const courseLive = courseLine?.open || courseLine?.evidence;
              const openHref = courseLive
                ? courseStakeTonightHref(item.slug)
                : `/community/game/${item.slug}`;
              return (
                <List.Item
                  actions={[
                    canShareTownDays(item.newHours) ? (
                      <a
                        key="share"
                        onClick={() => {
                          const days = townDaysLived(item.newHours);
                          void shareFollowedTown({
                            slug: item.slug,
                            title: item.title,
                            thumbnail: item.thumbnail,
                            newHours: item.newHours,
                            headline: {
                              title: t('profile.follows.shareTitle', {
                                title: item.title,
                                days,
                              }),
                              description: t('profile.follows.shareDesc', { days }),
                            },
                          }).then(({ result, posterSaved }) => {
                            if (result === 'wechat') message.info(t('mobile.share.wechatHint'));
                            else if (result === 'copied') message.success(t('mobile.share.copied'));
                            else if (result === 'failed') message.error(t('mobile.share.failed'));
                            if (posterSaved) message.success(t('mobile.share.posterSaved'));
                          });
                        }}
                      >
                        {t('profile.follows.share')}
                      </a>
                    ) : null,
                    courseLive ? (
                      <Link key="stake" to={openHref}>
                        {t('product.obs.course.goStake')}
                      </Link>
                    ) : null,
                    <Link key="open" to={openHref}>
                      {t('profile.follows.open')}
                    </Link>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space size={6} wrap>
                        <span>{item.title}</span>
                        <WorldPresenceTag
                          living={item.world?.living}
                          speaking={item.world?.speaking}
                          clockPaused={item.world?.clockPaused}
                          showIdle
                        />
                      </Space>
                    }
                    description={
                      <Space size={12} wrap>
                        <Text
                          style={{
                            fontSize: 12,
                            color:
                              liveCopy.key === 'profile.follows.noNews' ||
                              liveCopy.key === 'community.world.authorPaused'
                                ? undefined
                                : '#16a34a',
                          }}
                        >
                          {summary}
                        </Text>
                        {item.world?.simDays ? (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {t('community.world.simDays', { days: item.world.simDays })}
                          </Text>
                        ) : null}
                        {item.world?.residents ? (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {t('community.world.people', { count: item.world.residents })}
                          </Text>
                        ) : null}
                        {featureFlags.courseMarket && item.course?.canon ? (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {item.course.canon}
                          </Text>
                        ) : featureFlags.courseMarket && item.course ? (
                          <Space size={4} wrap>
                            {courseLine?.actKey ? (
                              <Tag color="gold" style={{ margin: 0 }}>
                                {t(courseLine.actKey)}
                              </Tag>
                            ) : null}
                            <Text style={{ fontSize: 12, color: '#ca8a04' }}>
                              {t('profile.follows.courseOpen', {
                                prompt: item.course.prompt,
                                n: String(item.course.pool),
                              })}
                            </Text>
                          </Space>
                        ) : null}
                        <WorldAudienceHint status={item.world} />
                      </Space>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={t('profile.works.games')}>
            <WorkList
              works={works?.games ?? []}
              emptyText={t('profile.works.empty.games')}
              emptyAction={t('nav.goCreate')}
              onEmpty={() => navigate('/')}
              onOpenStudio={openInStudio}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t('profile.works.worlds')}>
            <WorkList
              works={works?.worlds ?? []}
              emptyText={t('profile.works.empty.worlds')}
              emptyAction={t('nav.goCreate')}
              onEmpty={() => navigate('/?mode=world')}
              onOpenStudio={openInStudio}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t('profile.works.drafts')}>
            {(works?.drafts.length ?? 0) === 0 ? (
              <AlleyEmpty
                title={t('profile.works.empty.drafts')}
                hint={t('app.tagline')}
                action={t('nav.goCreate')}
                onAction={() => navigate('/')}
              />
            ) : (
              <List
                dataSource={works?.drafts ?? []}
                renderItem={(draft) => (
                  <List.Item
                    actions={[
                      <a
                        key="open"
                        onClick={() =>
                          navigate(
                            `/?project=${draft.projectId}${draft.hasWorld ? '&mode=world' : ''}`,
                          )
                        }
                      >
                        {t('profile.works.openStudio')}
                      </a>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <Space size={6}>
                          <span>{draft.name}</span>
                          {draft.hasWorld ? (
                            <Tag color="cyan">{t('profile.works.kindWorld')}</Tag>
                          ) : null}
                          {draft.hasPreview ? (
                            <Tag color="blue">
                              <ThunderboltOutlined /> {t('profile.works.hasPreview')}
                            </Tag>
                          ) : null}
                        </Space>
                      }
                      description={new Date(draft.createdAt).toLocaleString()}
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t('profile.history.title')}>
            {history.length === 0 ? (
              <AlleyEmpty
                title={t('profile.history.empty')}
                hint={t('app.tagline')}
                action={t('nav.goPlay')}
                onAction={() => navigate('/community')}
              />
            ) : (
              <List
                dataSource={history}
                renderItem={(item) => (
                  <List.Item
                    actions={
                      item.slug
                        ? [
                            <Link key="open" to={`/community/game/${item.slug}`}>
                              {item.category === 'world'
                                ? t('community.world.observe')
                                : t('community.gameDetail.startGame')}
                            </Link>,
                          ]
                        : []
                    }
                  >
                    <List.Item.Meta
                      title={item.title ?? item.deploymentId.slice(0, 8)}
                      description={new Date(item.lastPlayedAt).toLocaleString()}
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
        {(works?.remixes.length ?? 0) > 0 ? (
          <Col xs={24}>
            <Card title={t('profile.works.remixes')}>
              <List
                dataSource={works?.remixes ?? []}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      <a
                        key="open"
                        onClick={() => navigate(`/?project=${item.projectId}`)}
                      >
                        {t('profile.works.openStudio')}
                      </a>,
                    ]}
                  >
                    <List.Item.Meta
                      title={item.name}
                      description={item.note ?? new Date(item.createdAt).toLocaleString()}
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        ) : null}
      </Row>
    </div>
  );
}
