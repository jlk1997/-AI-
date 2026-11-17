/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified community strip: active stakes + watch subscriptions (deduped).
 */

import React, { useEffect, useState } from 'react';
import { Button, Popconfirm, Space, Tag, Typography } from 'antd';
import { BellOutlined, CloseOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

import type { MyCourseStakeRow, MyCourseWatchRow } from '../../services/api';
import { useT } from '../../services/i18n';
import {
  anyWatchShouldPulse,
  markWatchPulseSeen,
  onWatchPulseChanged,
  shouldPulseWatch,
  watchPulseBadgeKey,
} from '../World/courseWatchSignals';
import { pickCourseTonightMineChips } from '../World/courseWatchHub';
import { useMyCourseTonight } from '../World/myCourseTonightStore';
import { useCourseUnwatch } from '../World/useCourseUnwatch';
import { coursePlayHref, courseWatchPlayHref } from './communityCourseLine';

const { Text } = Typography;

function watchChipSuffix(
  row: MyCourseWatchRow,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  const status = row.course?.status;
  if (status === 'open') {
    const pool = row.course?.pool ?? 0;
    return pool > 0
      ? ` · ${t('product.obs.course.pool', { n: String(pool) })}`
      : ` · ${t('profile.myWatches.status.open')}`;
  }
  if (status === 'closed') {
    return ` · ${t('profile.myWatches.status.closed')}`;
  }
  if (status === 'settled') {
    return ` · ${t('profile.myWatches.status.settled')}`;
  }
  return ` · ${t('profile.myWatches.status.waiting')}`;
}

function stakeChipSuffix(
  row: MyCourseStakeRow,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  if (row.myPoints > 0) {
    return ` · ${t('product.obs.course.myStake', { n: String(row.myPoints) })}`;
  }
  if (row.status === 'closed') {
    return ` · ${t('profile.myWatches.status.closed')}`;
  }
  return '';
}

export const CourseTonightMineStrip: React.FC = () => {
  const { t } = useT();
  const navigate = useNavigate();
  const { unwatch, busyGameId } = useCourseUnwatch();
  const { stakes, watches, refresh } = useMyCourseTonight();
  const [pulseTick, setPulseTick] = useState(0);

  useEffect(() => {
    // Pulse-only — do NOT refetch watches on outcome (avoids sync→event→fetch storm).
    return onWatchPulseChanged(() => setPulseTick((n) => n + 1));
  }, []);

  const chips = pickCourseTonightMineChips(stakes, watches);
  const watchOnly = chips
    .filter((chip) => chip.kind === 'watch')
    .map((chip) => chip.row);

  if (chips.length === 0) return null;

  const handleUnwatch = async (gameId: string): Promise<void> => {
    const ok = await unwatch(gameId);
    if (ok) {
      await refresh();
    }
  };

  const handleWatchOpen = (row: MyCourseWatchRow): void => {
    markWatchPulseSeen(row);
    navigate(courseWatchPlayHref(row.slug));
  };

  void pulseTick;
  const stripLive = anyWatchShouldPulse(watchOnly);

  return (
    <div
      className={`og-course-tonight-mine-strip og-course-my-stakes-strip${
        stripLive ? ' og-course-tonight-mine-strip--live' : ''
      }`}
    >
      <Text type="secondary" className="og-course-my-stakes-strip__label">
        {t('community.tonightBundle.mine')}
      </Text>
      <Space wrap size={8}>
        {chips.map((chip) => {
          if (chip.kind === 'stake') {
            const row = chip.row;
            return (
              <Button
                key={`stake-${row.gameId}`}
                size="small"
                className="og-course-my-stakes-strip__chip og-course-tonight-mine-strip__chip--stake"
                icon={<ThunderboltOutlined />}
                onClick={() => navigate(coursePlayHref(row.slug, { course: true }))}
              >
                {row.title}
                {stakeChipSuffix(row, t)}
              </Button>
            );
          }
          const row = chip.row;
          const pulse = shouldPulseWatch(row);
          const badgeKey = watchPulseBadgeKey(row);
          return (
            <span key={`watch-${row.gameId}`} className="og-course-watch-chip-wrap">
              <Button
                size="small"
                className={`og-course-my-stakes-strip__chip og-course-tonight-mine-strip__chip--watch${
                  pulse ? ' og-course-watch-chip--live' : ''
                }`}
                icon={<BellOutlined />}
                onClick={() => handleWatchOpen(row)}
              >
                {row.title}
                {watchChipSuffix(row, t)}
                {badgeKey ? (
                  <Tag className="og-course-watch-chip__badge" color="cyan">
                    {t(badgeKey)}
                  </Tag>
                ) : null}
              </Button>
              <Popconfirm
                title={t('profile.myWatches.unwatchConfirm')}
                okText={t('profile.myWatches.unwatch')}
                cancelText={t('common.cancel')}
                onConfirm={() => void handleUnwatch(row.gameId)}
              >
                <button
                  type="button"
                  className="og-course-watch-chip__dismiss"
                  aria-label={t('profile.myWatches.unwatch')}
                  disabled={busyGameId === row.gameId}
                  onClick={(e) => e.stopPropagation()}
                >
                  <CloseOutlined />
                </button>
              </Popconfirm>
            </span>
          );
        })}
      </Space>
    </div>
  );
};
