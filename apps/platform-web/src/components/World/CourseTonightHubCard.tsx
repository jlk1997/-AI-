/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Profile hub: active stakes + watch-only towns in one card.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Divider, List, Popconfirm, Space, Tag, Typography } from 'antd';
import { BellOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

import type { MyCourseStakeRow, MyCourseWatchRow } from '../../services/api';
import { useT } from '../../services/i18n';
import { featureFlags } from '../../utils/featureFlags';
import {
  courseBettingRemainKey,
  courseBettingRemainMinutes,
  courseBettingRemainVars,
  courseStakeTonightHref,
  courseWatchPlayHref,
} from '../Community/communityCourseLine';
import { useCourseUnwatch } from './useCourseUnwatch';
import {
  listWatchSettledHits,
  sortCourseWatchHubRows,
} from './courseWatchHub';
import {
  markCourseOutcomeSeen,
  onCourseOutcomeChanged,
} from './courseOutcomeInbox';
import {
  markWatchPulseSeen,
  shouldPulseWatch,
  watchPulseBadgeKey,
} from './courseWatchSignals';
import { syncWatchMilestoneOutcomes } from './courseWatchOutcomeSync';

const { Text } = Typography;

function watchStatusTag(
  row: MyCourseWatchRow,
  t: (key: string) => string,
): { color: string; label: string } {
  const status = row.course?.status;
  if (status === 'open') {
    return { color: 'green', label: t('profile.myWatches.status.open') };
  }
  if (status === 'closed') {
    return { color: 'orange', label: t('profile.myWatches.status.closed') };
  }
  if (status === 'settled') {
    return { color: 'purple', label: t('profile.myWatches.status.settled') };
  }
  return { color: 'default', label: t('profile.myWatches.status.waiting') };
}

export const CourseTonightHubCard: React.FC<{
  readonly stakes: readonly MyCourseStakeRow[];
  readonly watches: readonly MyCourseWatchRow[];
  readonly onWatchesChange?: (watches: readonly MyCourseWatchRow[]) => void;
}> = ({ stakes, watches, onWatchesChange }) => {
  const { t } = useT();
  const navigate = useNavigate();
  const { unwatch, busyGameId } = useCourseUnwatch();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const activeStakes = useMemo(
    () => stakes.filter((row) => row.status === 'open' || row.status === 'closed'),
    [stakes],
  );
  const stakedGameIds = useMemo(
    () => new Set(activeStakes.map((row) => row.gameId)),
    [activeStakes],
  );
  const watchOnly = useMemo(
    () =>
      sortCourseWatchHubRows(
        watches.filter((row) => !stakedGameIds.has(row.gameId)),
      ),
    [watches, stakedGameIds],
  );
  const [outcomeTick, setOutcomeTick] = useState(0);
  const settledHits = useMemo(() => {
    void outcomeTick;
    return listWatchSettledHits(watches);
  }, [watches, outcomeTick]);

  useEffect(() => {
    // Store already runs applyCourseWatchRows on refresh; keep a cheap sync for
    // prop-driven updates that bypass the store.
    syncWatchMilestoneOutcomes(watches);
  }, [watches]);

  useEffect(() => {
    return onCourseOutcomeChanged(() => setOutcomeTick((n) => n + 1));
  }, []);

  useEffect(() => {
    if (activeStakes.length === 0 && watchOnly.length === 0 && settledHits.length === 0) {
      return;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [activeStakes.length, watchOnly.length, settledHits.length]);

  if (
    activeStakes.length === 0
    && watchOnly.length === 0
    && settledHits.length === 0
  ) {
    return null;
  }

  const handleUnwatch = async (gameId: string): Promise<void> => {
    const ok = await unwatch(gameId);
    if (ok) {
      onWatchesChange?.(watches.filter((row) => row.gameId !== gameId));
    }
  };

  return (
    <Card
      title={
        <Space>
          <ThunderboltOutlined style={{ color: 'var(--color-teal)' }} />
          <span>{t('profile.tonightHub.title')}</span>
        </Space>
      }
      style={{ marginBottom: 24 }}
    >
      {featureFlags.courseUxV2 ? (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
          {t('product.obs.course.aiJudge')}
        </Text>
      ) : null}
      {settledHits.length > 0 ? (
        <>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            {t('profile.tonightHub.results')}
          </Text>
          <List
            size="small"
            dataSource={settledHits}
            renderItem={({ outcome, watch: item }) => (
              <List.Item
                className="og-course-hub-watch-row--live"
                actions={[
                  <Button
                    key="open"
                    type="link"
                    size="small"
                    onClick={() => {
                      markCourseOutcomeSeen(outcome.gameId, outcome.nodeId);
                      markWatchPulseSeen(item);
                      navigate(courseWatchPlayHref(item.slug));
                    }}
                  >
                    {t('profile.tonightHub.seeResult')}
                  </Button>,
                ]}
              >
                <Space orientation="vertical" size={2}>
                  <Space size={8} wrap>
                    <Text strong>{item.title}</Text>
                    <Tag color="purple">{t('profile.tonightHub.resultTag')}</Tag>
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {(outcome.canon ?? item.course?.canon ?? item.course?.prompt ?? '').trim()}
                  </Text>
                </Space>
              </List.Item>
            )}
          />
          {activeStakes.length > 0 || watchOnly.length > 0 ? (
            <Divider style={{ margin: '12px 0' }} />
          ) : null}
        </>
      ) : null}

      {activeStakes.length > 0 ? (
        <List
          dataSource={[...activeStakes]}
          renderItem={(item) => {
            const remain = courseBettingRemainMinutes(item, nowMs);
            const remainLine =
              remain != null
                ? t(courseBettingRemainKey(remain), courseBettingRemainVars(remain))
                : null;
            const href = courseStakeTonightHref(item.slug);
            return (
              <List.Item
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(href)}
                actions={[
                  <Button
                    key="open"
                    type="link"
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(href);
                    }}
                  >
                    {t('profile.myStakes.open')}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={6} wrap>
                      <Text strong>{item.title}</Text>
                      {item.actKey ? <Tag color="gold">{t(item.actKey)}</Tag> : null}
                      {item.contested ? (
                        <Tag color="green">{t('product.obs.course.contested')}</Tag>
                      ) : (
                        <Tag>{t('product.obs.course.needOpponent')}</Tag>
                      )}
                    </Space>
                  }
                  description={
                    <Space orientation="vertical" size={2}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.prompt}
                      </Text>
                      <Space size={8} wrap>
                        <Text style={{ fontSize: 12 }}>
                          {t('profile.myStakes.side', { side: item.myOptionLabel })}
                        </Text>
                        <Text style={{ fontSize: 12 }}>
                          {t('profile.myStakes.points', { n: String(item.myPoints) })}
                        </Text>
                        {item.pool > 0 ? (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {t('profile.myStakes.pool', { n: String(item.pool) })}
                          </Text>
                        ) : null}
                        {remainLine ? (
                          <Text style={{ fontSize: 12, color: '#ca8a04' }}>
                            {remainLine}
                          </Text>
                        ) : null}
                      </Space>
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
      ) : null}

      {activeStakes.length > 0 && watchOnly.length > 0 ? (
        <Divider style={{ margin: '12px 0' }} />
      ) : null}

      {watchOnly.length > 0 ? (
        <>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            <BellOutlined style={{ marginRight: 4 }} />
            {t('profile.tonightHub.watching')}
          </Text>
          <List
            size="small"
            dataSource={[...watchOnly]}
            renderItem={(item) => {
              const tag = watchStatusTag(item, t);
              const pulse = shouldPulseWatch(item);
              const badgeKey = watchPulseBadgeKey(item);
              return (
                <List.Item
                  className={pulse ? 'og-course-hub-watch-row--live' : undefined}
                  actions={[
                    <Button
                      key="open"
                      type="link"
                      size="small"
                      onClick={() => {
                        markWatchPulseSeen(item);
                        navigate(courseWatchPlayHref(item.slug));
                      }}
                    >
                      {t('profile.myWatches.open')}
                    </Button>,
                    <Popconfirm
                      key="unwatch"
                      title={t('profile.myWatches.unwatchConfirm')}
                      okText={t('profile.myWatches.unwatch')}
                        cancelText={t('common.cancel')}
                      onConfirm={() => void handleUnwatch(item.gameId)}
                    >
                      <Button
                        type="link"
                        size="small"
                        danger
                        loading={busyGameId === item.gameId}
                      >
                        {item.course?.status === 'settled'
                          ? t('product.obs.course.watch.settleUnwatch')
                          : t('profile.myWatches.unwatch')}
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <Space orientation="vertical" size={2}>
                    <Space size={8} wrap>
                      <Text strong>{item.title}</Text>
                      <Tag color={tag.color}>{tag.label}</Tag>
                      {badgeKey ? (
                        <Tag color="cyan" className="og-course-watch-chip__badge">
                          {t(badgeKey)}
                        </Tag>
                      ) : null}
                    </Space>
                    {item.course?.canon?.trim() ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.course.canon.trim()}
                      </Text>
                    ) : item.course?.prompt ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.course.prompt}
                      </Text>
                    ) : null}
                  </Space>
                </List.Item>
              );
            }}
          />
        </>
      ) : null}
    </Card>
  );
};
