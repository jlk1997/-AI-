/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Layout,
  Typography,
  Row,
  Col,
  Select,
  Space,
  Input,
  Spin,
  Carousel,
  Card,
  Button,
  Segmented,
  Tooltip,
  message,
} from 'antd';
import {
  FireOutlined,
  HeartOutlined,
  SearchOutlined,
  UserOutlined,
  MoonOutlined,
  SunOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { BrandLockup } from '../brand/BrandMark';
import { AlleyEmpty } from '../components/brand/AlleyEmpty';
import { useNavigate } from 'react-router-dom';
import { GameCard } from '../components/Community/GameCard';
import { WorldCard } from '../components/Community/WorldCard';
import { TonightFeed } from '../components/Community/TonightFeed';
import { collectStakeTonightItems } from '../components/Community/communityCourseLine';
import { featureFlags } from '../utils/featureFlags';
import { CourseReturnCapsule } from '../components/World/CourseReturnCapsule';
import { FollowingFeed } from '../components/Community/FollowingFeed';
import { KaiMarketBar } from '../components/Community/KaiMarketBar';
import { AlleyCharts } from '../components/Community/AlleyCharts';
import { InviteLanding } from '../components/Community/InviteLanding';
import { api, type CourseTonightDiscovery, type WorldActivityItem } from '../services/api';
import { useAppStore } from '../store';
import { useTheme } from '../hooks/useTheme';
import { useT } from '../services/i18n';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { rememberLoginReturnTo } from '../utils/loginIntent';
import { townCatalogHeat } from '@opengame/platform-shared';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

const CATEGORY_KEYS: { value: string; key: string }[] = [
  { value: '', key: 'community.category.all' },
  { value: 'arcade', key: 'community.category.arcade' },
  { value: 'puzzle', key: 'community.category.puzzle' },
  { value: 'action', key: 'community.category.action' },
  { value: 'strategy', key: 'community.category.strategy' },
  { value: 'rpg', key: 'community.category.rpg' },
  { value: 'story', key: 'community.category.story' },
  { value: 'world', key: 'community.category.world' },
  { value: 'other', key: 'community.category.other' },
];

export const Community: React.FC = () => {
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const { t } = useT();
  const { isAuthenticated } = useAppStore();

  /**
   * The studio and "my page" need an account, so a visitor gets sent through
   * login and dropped exactly where they were headed instead of at the studio
   * door with their intent lost.
   */
  const goAuthed = (target: string): void => {
    if (isAuthenticated) {
      navigate(target);
      return;
    }
    rememberLoginReturnTo(target);
    navigate('/login');
  };
  const [featuredGames, setFeaturedGames] = useState<any[]>([]);
  const [recentGames, setRecentGames] = useState<any[]>([]);
  const [popularGames, setPopularGames] = useState<any[]>([]);
  const [prizeGames, setPrizeGames] = useState<any[]>([]);
  const [challenge, setChallenge] = useState<{
    id: string;
    title: string;
    prompt: string;
    entryPoints?: number;
    poolPoints?: number;
  } | null>(null);
  const [worlds, setWorlds] = useState<any[]>([]);
  const [tonight, setTonight] = useState<WorldActivityItem[]>([]);
  const [tonightDiscovery, setTonightDiscovery] = useState<CourseTonightDiscovery | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'games' | 'worlds'>('worlds');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [ragSuggestions, setRagSuggestions] = useState<
    Array<{ title: string; slug: string; snippet: string }>
  >([]);
  const debouncedSearch = useDebouncedValue(searchKeyword, 300);
  const initialLoadDone = useRef(false);
  const stakeFeedRef = useRef<HTMLDivElement | null>(null);

  const categoryOptions = useMemo(
    () => CATEGORY_KEYS.map((o) => ({ value: o.value, label: t(o.key) })),
    [t],
  );

  const filteredFeatured = useMemo(() => {
    const playable = featuredGames.filter((g) => g.category !== 'world');
    if (!selectedCategory) return playable;
    return playable.filter((g) => g.category === selectedCategory);
  }, [featuredGames, selectedCategory]);

  const featuredWorlds = useMemo(
    () => featuredGames.filter((g) => g.category === 'world'),
    [featuredGames],
  );

  const stakeTonightItems = useMemo(() => {
    if (tonightDiscovery?.items.length) {
      return tonightDiscovery.items.map((item) => ({
        id: item.gameId,
        slug: item.slug,
        title: item.title,
        course: item.course,
      }));
    }
    return collectStakeTonightItems([...featuredWorlds, ...worlds], 8);
  }, [tonightDiscovery, featuredWorlds, worlds]);

  useEffect(() => {
    if (!featureFlags.courseMarket || activeTab !== 'worlds') return;
    let cancelled = false;
    void api.community
      .courseTonight(12)
      .then((res) => {
        if (!cancelled) setTonightDiscovery(res);
      })
      .catch(() => {
        if (!cancelled) setTonightDiscovery(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!initialLoadDone.current) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      try {
        const q = debouncedSearch.trim().toLowerCase();
        const match = (g: any) =>
          !q ||
          (g.title && String(g.title).toLowerCase().includes(q)) ||
          (g.slug && String(g.slug).toLowerCase().includes(q)) ||
          (g.description && String(g.description).toLowerCase().includes(q));

        if (activeTab === 'worlds') {
          const [featured, worldRes, activity] = await Promise.all([
            api.community.getFeaturedGames(),
            api.community.getGames({
              page: 1,
              pageSize: 48,
              sort: 'living',
              kind: 'world',
            }),
            api.community.worldActivity(16).catch(() => ({ items: [] as WorldActivityItem[] })),
          ]);
          if (cancelled) return;
          const rows = (worldRes.games || []).filter(match);
          // Towns that are still moving are the reason to open this tab.
          rows.sort((a: any, b: any) => {
            const heat = townCatalogHeat(b.world) - townCatalogHeat(a.world);
            if (heat !== 0) return heat;
            return (b.world?.watcherCount ?? 0) - (a.world?.watcherCount ?? 0);
          });
          setFeaturedGames(featured.games || []);
          setWorlds(rows);
          setTonight(
            (activity.items || []).filter(
              (item) =>
                !q ||
                item.title.toLowerCase().includes(q) ||
                item.line.toLowerCase().includes(q) ||
                item.slug.toLowerCase().includes(q),
            ),
          );
        } else {
          const cat = selectedCategory || undefined;
          const [featured, recentRes, popularRes, prizeRes, weekly] = await Promise.all([
            api.community.getFeaturedGames(),
            api.community.getGames({
              page: 1,
              pageSize: 48,
              sort: 'latest',
              kind: 'game',
              category: cat,
            }),
            api.community.getGames({
              page: 1,
              pageSize: 24,
              sort: 'popular',
              kind: 'game',
              category: cat,
            }),
            api.community.getGames({
              page: 1,
              pageSize: 12,
              sort: 'prize',
              kind: 'game',
              category: cat,
            }),
            api.community.currentChallenge().catch(() => ({ challenge: null })),
          ]);
          if (cancelled) return;
          setFeaturedGames(featured.games || []);
          setRecentGames((recentRes.games || []).filter(match).slice(0, 16));
          setPopularGames((popularRes.games || []).filter(match).slice(0, 4));
          setPrizeGames((prizeRes.games || []).filter((g: { challengeId?: string }) => g.challengeId).filter(match));
          setChallenge(weekly.challenge);
        }
      } catch (error) {
        console.error('Failed to load community data:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
          initialLoadDone.current = true;
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedCategory, debouncedSearch]);

  useEffect(() => {
    const q = debouncedSearch.trim();
    if (q.length < 2) {
      setRagSuggestions([]);
      return;
    }
    let cancelled = false;
    void api.communityRag
      .suggestions(q)
      .then((res) => {
        if (!cancelled) setRagSuggestions(res.suggestions ?? []);
      })
      .catch(() => {
        if (!cancelled) setRagSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  const shellBg = 'var(--bg-layout)';
  const headerBg = 'var(--bg-header)';
  const headerBorder = 'var(--border-color)';
  const cardBg = 'var(--bg-card)';
  const cardBorder = 'var(--border-color)';
  const titleColor = 'var(--text-primary)';
  const mutedColor = 'var(--text-secondary)';

  if (loading && featuredGames.length === 0 && recentGames.length === 0) {
    return (
      <Layout style={{ height: '100%', background: shellBg }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            minHeight: 200,
          }}
        >
          <Spin size="large" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: shellBg,
      }}
    >
      <Header
        style={{
          flexShrink: 0,
          background: headerBg,
          borderBottom: `1px solid ${headerBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 56,
          lineHeight: '56px',
          padding: '0 20px',
        }}
      >
        <Space size={12} align="center">
          <BrandLockup variant="full" size={32} />
          <Text style={{ color: mutedColor, fontSize: 12 }}>{t('community.subtitle')}</Text>
        </Space>
        <Space size={4}>
          {isAuthenticated && featureFlags.courseMarket ? <CourseReturnCapsule /> : null}
          {isAuthenticated ? (
            <Tooltip title={t('nav.myStudio')}>
              <Button
                type="text"
                icon={<UserOutlined />}
                onClick={() => goAuthed('/profile')}
                style={{ color: mutedColor }}
              />
            </Tooltip>
          ) : (
            <Tooltip title={t('nav.signIn.tip')}>
              <Button type="text" onClick={() => goAuthed('/')} style={{ color: mutedColor }}>
                {t('nav.signIn')}
              </Button>
            </Tooltip>
          )}
          <Tooltip title={isDark ? t('common.switchToLight') : t('common.switchToDark')}>
            <Button
              type="text"
              icon={isDark ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggleTheme}
              style={{ color: mutedColor }}
            />
          </Tooltip>
          <Tooltip title={t('nav.goCreate.tip')}>
            <Button type="primary" onClick={() => goAuthed('/')}>
              {t('nav.goCreate')}
            </Button>
          </Tooltip>
        </Space>
      </Header>

      <Content
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 24,
          position: 'relative',
        }}
      >
        {refreshing ? (
          <div
            style={{
              position: 'absolute',
              top: 16,
              right: 24,
              zIndex: 2,
            }}
          >
            <Spin size="small" />
          </div>
        ) : null}

        <Card
          style={{
            background: cardBg,
            border: `1px solid ${cardBorder}`,
            marginBottom: 24,
          }}
        >
          <Space size={16} wrap>
            <Segmented
              value={activeTab}
              onChange={(value) => setActiveTab(value as 'games' | 'worlds')}
              options={[
                { label: t('community.tab.worlds'), value: 'worlds' },
                { label: t('community.tab.games'), value: 'games' },
              ]}
            />
            <Input
              placeholder={t('community.search.placeholder')}
              prefix={<SearchOutlined style={{ color: 'var(--color-ember)' }} />}
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              allowClear
              style={{ width: 240 }}
            />
            {activeTab === 'games' ? (
              <Select
                value={selectedCategory}
                onChange={setSelectedCategory}
                options={categoryOptions}
                style={{ width: 160 }}
              />
            ) : null}
          </Space>
          {ragSuggestions.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('community.search.rag')}
              </Text>
              <Space wrap style={{ marginTop: 6 }}>
                {ragSuggestions.map((s) => (
                  <Button
                    key={s.slug}
                    size="small"
                    type="link"
                    onClick={() => navigate(`/community/game/${s.slug}`)}
                  >
                    {s.title}
                  </Button>
                ))}
              </Space>
            </div>
          ) : null}
        </Card>

        <div className="og-community-stage">
        <aside>
        <InviteLanding />
        <KaiMarketBar />
        {activeTab === 'games' && challenge ? (
          <div className="og-poster-card" style={{ marginBottom: 20 }}>
            <div className="og-poster-card__art">
              <div className="og-poster-card__kicker">{t('community.prize.title')}</div>
              <div className="og-poster-card__title">{challenge.title}</div>
              <div className="og-poster-card__prompt">{challenge.prompt}</div>
            </div>
            <div className="og-poster-card__cta">
              <Button
                type="primary"
                block
                onClick={() => {
                  if (!isAuthenticated) {
                    goAuthed('/login');
                    return;
                  }
                  void api.community
                    .enterChallenge(challenge.id)
                    .then((res) => {
                      message.success(
                        res.already
                          ? t('community.prize.already')
                          : t('community.prize.entered', { pool: res.poolPoints ?? 0 }),
                      );
                    })
                    .catch((err) => {
                      const status = (err as { status?: number }).status;
                      if (status === 402) {
                        navigate('/wallet');
                        return;
                      }
                      message.error(t('community.prize.fail'));
                    });
                }}
              >
                {t('community.prize.enter')}
              </Button>
            </div>
          </div>
        ) : null}
        {activeTab === 'worlds' ? <TonightFeed items={tonight} /> : null}
        </aside>
        <div>
        <FollowingFeed authenticated={isAuthenticated} />
        <AlleyCharts />

        {activeTab === 'worlds' ? (
          <>
            {featuredWorlds.length > 0 ? (
              <Card
                title={
                  <Space>
                    <FireOutlined style={{ color: 'var(--color-teal)' }} />
                    <span>{t('community.featuredWorlds')}</span>
                  </Space>
                }
                style={{
                  background: cardBg,
                  border: `1px solid ${cardBorder}`,
                  marginBottom: 24,
                }}
              >
                <Row gutter={[16, 16]}>
                  {featuredWorlds.map((world) => (
                    <Col key={world.id} xs={24} sm={12} lg={8}>
                      <WorldCard world={world} />
                    </Col>
                  ))}
                </Row>
              </Card>
            ) : null}
            <Card
              title={
              <Space>
                <ClockCircleOutlined style={{ color: 'var(--color-teal)' }} />
                <span>{t('community.living.title')}</span>
              </Space>
              }
              style={{
                background: cardBg,
                border: `1px solid ${cardBorder}`,
              }}
            >
              {worlds.length > 0 ? (
                <Row gutter={[16, 16]}>
                  {worlds.map((world) => (
                    <Col key={world.id} xs={24} sm={12} lg={8}>
                      <WorldCard world={world} />
                    </Col>
                  ))}
                </Row>
              ) : (
                <AlleyEmpty
                  title={t('community.worlds.empty')}
                  hint={t('mobile.community.emptyHint')}
                  action={t('nav.goCreate')}
                  onAction={() => goAuthed('/?mode=world')}
                />
              )}
            </Card>
          </>
        ) : (
          <>
        {prizeGames.length > 0 ? (
          <Card
            title={t('community.prize.works')}
            style={{
              background: cardBg,
              border: `1px solid ${cardBorder}`,
              marginBottom: 24,
            }}
          >
            <Row gutter={[16, 16]}>
              {prizeGames.slice(0, 4).map((game) => (
                <Col key={game.id} xs={24} sm={12} lg={6}>
                  <GameCard game={game} deployment={game.deployment} />
                </Col>
              ))}
            </Row>
          </Card>
        ) : null}
        {filteredFeatured.length > 0 && (
          <Card
            title={
              <Space>
                <FireOutlined style={{ color: '#ef4444' }} />
                <span>{t('community.featured')}</span>
              </Space>
            }
            style={{
              background: cardBg,
              border: `1px solid ${cardBorder}`,
              marginBottom: 24,
            }}
          >
            <Carousel autoplay dots>
              {filteredFeatured.map((game) => (
                <div key={game.id}>
                  <div
                    style={{
                      height: 240,
                      background:
                        'linear-gradient(160deg, rgba(196,92,38,0.35), var(--color-night))',
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                    onClick={() => navigate(`/community/game/${game.slug || game.id}`)}
                  >
                    <div style={{ textAlign: 'center', padding: 16 }}>
                      <Title
                        level={3}
                        ellipsis
                        style={{ color: titleColor, margin: 0, maxWidth: '90vw' }}
                      >
                        {game.title}
                      </Title>
                      <Text type="secondary" ellipsis style={{ maxWidth: 560, display: 'block' }}>
                        {game.description || t('community.noDescription')}
                      </Text>
                    </div>
                  </div>
                </div>
              ))}
            </Carousel>
          </Card>
        )}

        <Card
          title={
            <Space>
              <HeartOutlined style={{ color: 'var(--color-ember)' }} />
              <span>{t('community.popular')}</span>
            </Space>
          }
          style={{
            background: cardBg,
            border: `1px solid ${cardBorder}`,
            marginBottom: 24,
          }}
        >
          <Row gutter={[16, 16]}>
            {popularGames.slice(0, 4).map((game) => (
              <Col key={game.id} xs={24} sm={12} lg={6}>
                <GameCard game={game} deployment={game.deployment} />
              </Col>
            ))}
          </Row>
        </Card>

        <Card
          title={
            <Space>
              <FireOutlined style={{ color: 'var(--color-gold)' }} />
              <span>{t('community.recent')}</span>
            </Space>
          }
          style={{
            background: cardBg,
            border: `1px solid ${cardBorder}`,
          }}
        >
          {recentGames.length > 0 ? (
            <Row gutter={[16, 16]}>
              {recentGames.map((game) => (
                <Col key={game.id} xs={24} sm={12} lg={6}>
                  <GameCard game={game} deployment={game.deployment} />
                </Col>
              ))}
            </Row>
          ) : (
            <AlleyEmpty
              title={t('community.games.empty')}
              hint={t('mobile.community.emptyHint')}
              action={t('community.games.emptyCta')}
              onAction={() => goAuthed('/')}
            />
          )}
        </Card>
          </>
        )}
        </div>
        </div>
      </Content>
    </Layout>
  );
};
