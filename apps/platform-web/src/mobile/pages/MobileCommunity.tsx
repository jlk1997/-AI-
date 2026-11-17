/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Spin, Tag, Typography, message } from 'antd';
import { MoonOutlined, SunOutlined, UserOutlined } from '@ant-design/icons';

import { api, type CourseTonightDiscovery, type WorldActivityItem } from '../../services/api.js';
import { useT } from '../../services/i18n.js';
import { useTheme } from '../../hooks/useTheme.js';
import { useAppStore } from '../../store/index.js';
import { MobileHeader } from '../MobileShell.js';
import { FollowingFeed } from '../../components/Community/FollowingFeed.js';
import { KaiMarketBar } from '../../components/Community/KaiMarketBar.js';
import { AlleyCharts } from '../../components/Community/AlleyCharts.js';
import { InviteLanding } from '../../components/Community/InviteLanding.js';
import { WorkCard } from '../components/WorkCard.js';
import { BrandLockup } from '../../brand/BrandMark.js';
import { AlleyEmpty } from '../../components/brand/AlleyEmpty.js';
import { collectStakeTonightItems, coursePlayHref } from '../../components/Community/communityCourseLine.js';
import { CourseReturnCapsule } from '../../components/World/CourseReturnCapsule.js';
import { featureFlags } from '../../utils/featureFlags.js';
import type { CommunityWorkCard } from '../types.js';

const { Text } = Typography;

const PAGE_SIZE = 20;

type Kind = 'game' | 'world';

/**
 * The phone front door. A visitor arrives here from a shared link or the home
 * screen icon, so the first screen is other people's work — never an empty
 * prompt box.
 */
export const MobileCommunity: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useT();
  const { isDark, toggleTheme } = useTheme();
  const { isAuthenticated } = useAppStore();
  const [params, setParams] = useSearchParams();

  const kind: Kind = params.get('kind') === 'game' ? 'game' : 'world';
  const [works, setWorks] = useState<CommunityWorkCard[]>([]);
  const [featured, setFeatured] = useState<CommunityWorkCard[]>([]);
  const [tonight, setTonight] = useState<WorldActivityItem[]>([]);
  const [challenge, setChallenge] = useState<{
    id: string;
    title: string;
    prompt: string;
    entryPoints?: number;
    poolPoints?: number;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [tonightDiscovery, setTonightDiscovery] = useState<CourseTonightDiscovery | null>(
    null,
  );
  const sentinel = useRef<HTMLDivElement>(null);

  const stakeTonightItems = useMemo(() => {
    if (tonightDiscovery?.items.length) {
      return tonightDiscovery.items.map((item) => ({
        id: item.gameId,
        slug: item.slug,
        title: item.title,
        course: item.course,
      }));
    }
    if (!featureFlags.courseMarket || kind !== 'world') return [];
    return collectStakeTonightItems([...featured, ...works], 6);
  }, [tonightDiscovery, featured, works, kind]);

  useEffect(() => {
    if (!featureFlags.courseMarket || kind !== 'world') return;
    let cancelled = false;
    void api.community
      .courseTonight(8)
      .then((res) => {
        if (!cancelled) setTonightDiscovery(res);
      })
      .catch(() => {
        if (!cancelled) setTonightDiscovery(null);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const setKind = (next: Kind): void => {
    const copy = new URLSearchParams(params);
    copy.set('kind', next);
    setParams(copy, { replace: true });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPage(1);
    setExhausted(false);
    void (async () => {
      try {
        const res = await api.community.getGames({
          page: 1,
          pageSize: PAGE_SIZE,
          kind,
          sort: kind === 'world' ? 'living' : 'prize',
        });
        if (cancelled) return;
        const list = (res.games ?? []) as CommunityWorkCard[];
        setWorks(list);
        setExhausted(list.length < PAGE_SIZE);
      } catch {
        if (!cancelled) setWorks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.community.getFeaturedGames();
        if (!cancelled) setFeatured(((res.games ?? []) as CommunityWorkCard[]).slice(0, 8));
      } catch {
        /* curation is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.community
      .currentChallenge()
      .then((res) => {
        if (!cancelled && res.challenge) {
          setChallenge({
            id: res.challenge.id,
            title: res.challenge.title,
            prompt: res.challenge.prompt,
            entryPoints: res.challenge.entryPoints,
            poolPoints: res.challenge.poolPoints,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (kind !== 'world') return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.community.worldActivity(8);
        if (!cancelled) setTonight(res.items ?? []);
      } catch {
        /* activity is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const loadMore = useCallback(async () => {
    if (loadingMore || exhausted || loading) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res = await api.community.getGames({
        page: next,
        pageSize: PAGE_SIZE,
        kind,
        sort: kind === 'world' ? 'living' : 'prize',
      });
      const list = (res.games ?? []) as CommunityWorkCard[];
      setWorks((prev) => [...prev, ...list]);
      setPage(next);
      if (list.length < PAGE_SIZE) setExhausted(true);
    } catch {
      setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  }, [exhausted, kind, loading, loadingMore, page]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: '320px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [loadMore]);

  return (
    <>
      <MobileHeader
        title={<BrandLockup variant="short" size={26} />}
        right={
          <>
            {isAuthenticated && featureFlags.courseMarket ? (
              <CourseReturnCapsule />
            ) : null}
            <Button
              type="text"
              size="small"
              icon={isDark ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggleTheme}
              aria-label={t('mobile.community.theme')}
            />
            <Button
              type="text"
              size="small"
              icon={<UserOutlined />}
              onClick={() => navigate(isAuthenticated ? '/me' : '/login')}
              aria-label={t('mobile.tab.me')}
            />
          </>
        }
        below={
          <div style={{ padding: '0 0 10px' }}>
            <div className="og-lane-doors">
              <button
                type="button"
                className={`og-lane-door og-lane-door--world${kind === 'world' ? ' is-on' : ''}`}
                onClick={() => setKind('world')}
              >
                {t('mobile.community.worlds')}
              </button>
              <button
                type="button"
                className={`og-lane-door og-lane-door--game${kind === 'game' ? ' is-on' : ''}`}
                onClick={() => setKind('game')}
              >
                {t('mobile.community.games')}
              </button>
            </div>
          </div>
        }
      />

      <div style={{ padding: '8px 12px 0' }}>
        <InviteLanding />
        <KaiMarketBar compact />
        <AlleyCharts />
      </div>

      {challenge && (
        <section className="og-poster-card" style={{ margin: '12px 12px 0' }}>
          <div className="og-poster-card__art">
            <div className="og-poster-card__kicker">{t('mobile.community.challenge')}</div>
            <div className="og-poster-card__title">{challenge.title}</div>
            <div className="og-poster-card__prompt">{challenge.prompt}</div>
          </div>
          <div className="og-poster-card__cta">
            <Button
              type="primary"
              block
              onClick={() => {
                if (!isAuthenticated) {
                  navigate('/login');
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
        </section>
      )}

      <FollowingFeed authenticated={isAuthenticated} limit={8} variant="plain" />


      {kind === 'world' && tonight.length > 0 && (
        <section style={{ padding: '12px 12px 0' }}>
          <Text strong style={{ fontSize: 13 }}>
            {t('mobile.community.tonight')}
          </Text>
          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
            {tonight.slice(0, 4).map((item, i) => {
              const href = coursePlayHref(item.slug, { course: true });
              return (
              <div
                key={`${item.gameId}-${i}`}
                role="button"
                tabIndex={0}
                onClick={() => navigate(href)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') navigate(href);
                }}
                style={{ fontSize: 12, lineHeight: 1.5, cursor: 'pointer' }}
              >
                <Tag color="purple" style={{ marginInlineEnd: 6 }}>
                  {item.title}
                </Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {item.speakerName ? `${item.speakerName}: ` : ''}
                  {item.line}
                </Text>
              </div>
              );
            })}
          </div>
        </section>
      )}

      {featured.length > 0 && (
        <section style={{ paddingTop: 12 }}>
          <Text strong style={{ fontSize: 13, paddingInlineStart: 12 }}>
            {t('mobile.community.featured')}
          </Text>
          <div className="og-chip-rail">
            {featured.map((work) => (
              <div key={work.id} style={{ width: 150 }}>
                <WorkCard work={work} />
              </div>
            ))}
          </div>
        </section>
      )}

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : works.length === 0 ? (
        <AlleyEmpty
          title={t('mobile.community.empty')}
          hint={t('mobile.community.emptyHint')}
          action={t('mobile.community.emptyCta')}
          onAction={() => navigate(isAuthenticated ? '/' : '/login')}
        />
      ) : (
        <>
          <div className="og-card-grid">
            {works.map((work) => (
              <WorkCard key={work.id} work={work} />
            ))}
          </div>
          <div ref={sentinel} style={{ height: 1 }} />
          <div style={{ padding: '8px 12px 24px', textAlign: 'center' }}>
            {loadingMore ? (
              <Spin size="small" />
            ) : exhausted ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('mobile.community.end')}
              </Text>
            ) : (
              <Button size="small" onClick={() => void loadMore()}>
                {t('mobile.community.loadMore')}
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
};

export default MobileCommunity;
