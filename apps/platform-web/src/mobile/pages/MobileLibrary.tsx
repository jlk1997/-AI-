/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Empty, List, Spin, Tag, Typography, message } from 'antd';
import { ClockCircleOutlined, PlayCircleOutlined } from '@ant-design/icons';

import { api, type FollowedWorld, type PlayHistoryEntry } from '../../services/api.js';
import { useT } from '../../services/i18n.js';
import { useAppStore } from '../../store/index.js';
import { canShareTownDays, shareFollowedTown, townDaysLived } from '../../utils/shareWork.js';
import { worldAudienceLine } from '../../components/Community/WorldAudienceHint.js';
import { followTownLiveCopy } from '../../components/World/societyTownHonesty.js';
import { featureFlags } from '../../utils/featureFlags.js';
import { MobileHeader } from '../MobileShell.js';

const { Text } = Typography;

/**
 * The "come back" tab: what you were playing, and which towns moved on while
 * you were gone. Signed-out visitors get a reason to sign in rather than an
 * empty list.
 */
export const MobileLibrary: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useT();
  const { isAuthenticated } = useAppStore();
  const [history, setHistory] = useState<PlayHistoryEntry[]>([]);
  const [follows, setFollows] = useState<FollowedWorld[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [h, f] = await Promise.all([
          api.me.history().catch(() => ({ history: [] as PlayHistoryEntry[] })),
          api.me.follows().catch(() => ({ follows: [] as FollowedWorld[] })),
        ]);
        if (cancelled) return;
        setHistory(h.history ?? []);
        setFollows(f.follows ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <>
        <MobileHeader title={t('mobile.library.title')} />
        <Empty
          style={{ padding: 48 }}
          description={t('mobile.library.signInHint')}
        >
          <Button type="primary" onClick={() => navigate('/login')}>
            {t('mobile.me.signIn')}
          </Button>
        </Empty>
      </>
    );
  }

  return (
    <>
      <MobileHeader title={t('mobile.library.title')} />
      {loading ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : (
        <>
          <section style={{ padding: '12px 12px 0' }}>
            <Text strong style={{ fontSize: 13 }}>
              {t('mobile.library.followed')}
            </Text>
          </section>
          {follows.length === 0 ? (
            <Empty
              style={{ padding: 20 }}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('mobile.library.noFollows')}
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
                const liveNow =
                  liveCopy.key === 'product.obs.watchers' ||
                  liveCopy.key === 'product.obs.watchersOne' ||
                  liveCopy.key === 'profile.follows.gapAndLive';
                return (
                <List.Item
                  onClick={() => navigate(`/play/${item.slug}`)}
                  style={{ cursor: 'pointer' }}
                  actions={[
                    canShareTownDays(item.newHours) ? (
                      <Button
                        key="share"
                        type="link"
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
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
                        {t('mobile.library.share')}
                      </Button>
                    ) : null,
                    liveNow ? (
                      <Badge
                        key="live"
                        count={t(liveCopy.key, liveCopy.vars)}
                        style={{ backgroundColor: 'var(--color-ember)' }}
                      />
                    ) : item.newHours && item.newHours > 0 ? (
                      <Badge
                        key="new"
                        count={t('mobile.library.newHours', {
                          hours: String(Math.round(item.newHours)),
                        })}
                        style={{ backgroundColor: 'var(--color-ember)' }}
                      />
                    ) : (
                      <Tag key="caught-up">{t('mobile.library.caughtUp')}</Tag>
                    ),
                  ]}
                >
                  <List.Item.Meta
                    avatar={<ClockCircleOutlined />}
                    title={item.title}
                    description={
                      [
                        item.world?.simDays != null
                          ? t('mobile.card.simDays', { days: String(item.world.simDays) })
                          : null,
                        liveCopy.key === 'profile.follows.noNews'
                          ? worldAudienceLine(t, item.world)
                          : t(liveCopy.key, liveCopy.vars),
                        featureFlags.courseMarket && item.course?.canon
                          ? item.course.canon
                          : featureFlags.courseMarket && item.course
                            ? t('profile.follows.courseOpen', {
                                prompt: item.course.prompt,
                                n: String(item.course.pool),
                              })
                            : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || undefined
                    }
                  />
                </List.Item>
                );
              }}
            />
          )}

          <section style={{ padding: '16px 12px 0' }}>
            <Text strong style={{ fontSize: 13 }}>
              {t('mobile.library.recent')}
            </Text>
          </section>
          {history.length === 0 ? (
            <Empty
              style={{ padding: 20 }}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('mobile.library.noHistory')}
            />
          ) : (
            <List
              dataSource={history}
              renderItem={(item) => (
                <List.Item
                  onClick={() => item.slug && navigate(`/play/${item.slug}`)}
                  style={{ cursor: item.slug ? 'pointer' : 'default' }}
                >
                  <List.Item.Meta
                    avatar={<PlayCircleOutlined />}
                    title={item.title ?? item.deploymentId}
                    description={t('mobile.library.playedTimes', {
                      count: String(item.playCount),
                    })}
                  />
                </List.Item>
              )}
            />
          )}
          <div style={{ height: 24 }} />
        </>
      )}
    </>
  );
};

export default MobileLibrary;
