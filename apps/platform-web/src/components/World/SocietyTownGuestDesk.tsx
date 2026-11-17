/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Visitor cash desk: tonight’s board first. Watching stays free. Town-time / light /
 * adopt are not sold on the community page. Tips only stack the same lamp.
 */

import React, { useEffect, useState } from 'react';
import { Collapse, Space, Typography } from 'antd';

import type { CoursePulse } from '@opengame/platform-shared';

import { WorldWhispers } from '../Community/WorldWhispers';
import { api } from '../../services/api';
import type { CourseBoard } from '../../services/api';
import { useT } from '../../services/i18n';
import type { TownContributor, TownLamp, WorkCommerce } from '../../services/api';
import type { SocietyTalkBudgetView } from './societyTownGating';
import { guestDeskOpenFolds } from './courseAuthorFlow';
import { SocietyTownCourseDesk, courseKeepAliveNeeded } from './SocietyTownCourseDesk';
import { CourseOutcomeBanner } from './CourseOutcomeBanner';
import type { TalkLine } from './societyTownStageModel';
import { SocietyTownTipFold } from './SocietyTownTipFold';

export {
  TOWN_TIME_DESK_ID,
  WORLD_LIGHT_DESK_ID,
  scrollToTownTimeDesk,
  scrollToWorldLightDesk,
} from './societyTownTimeDesk';

const { Text } = Typography;

export type SocietyTownGuestDeskProps = {
  readonly gameId: string;
  readonly commerce?: WorkCommerce | null;
  readonly canSpend: boolean;
  readonly whisperDraft?: string;
  readonly whisperTick?: number;
  readonly onRequireLogin: (line?: string) => void;
  readonly onWhispered?: () => void;
  readonly permitHint: string;
  readonly talkBudgetHint: string | null;
  readonly onTownMoved: (info?: {
    townTimeUntil?: string | null;
    lamp?: TownLamp | null;
    contributors?: TownContributor[];
    watcherCount?: number;
    talkBudget?: unknown;
    lightUntil?: string | null;
    lightBonusPerHour?: number;
  }) => void;
  readonly talkBudget?: SocietyTalkBudgetView | null;
  readonly urgeLight?: boolean;
  readonly now?: number;
  readonly lamp?: TownLamp | null;
  readonly contributors?: readonly TownContributor[];
  readonly watcherCount?: number;
  readonly slot?: 'permit' | 'more' | 'full';
  readonly dense?: boolean;
  readonly onCourseKeepAlive?: (on: boolean) => void;
  readonly liveNudge?: number;
  readonly talks?: readonly TalkLine[];
  readonly onPulse?: (pulse: CoursePulse) => void;
  readonly onCourseStatus?: (status: string | null) => void;
  readonly onCourseBoard?: (board: CourseBoard | null) => void;
  readonly actBarCompact?: boolean;
  readonly shareTitle?: string;
  readonly shareSlugOrId?: string;
  readonly onOpenCourse?: () => void;
  readonly courseShareLanding?: boolean;
  readonly courseFollowLanding?: boolean;
  readonly onShareLandingDone?: () => void;
  readonly pollActive?: boolean;
};

export const SocietyTownGuestDesk: React.FC<SocietyTownGuestDeskProps> = ({
  gameId,
  commerce,
  canSpend,
  whisperDraft,
  whisperTick,
  onRequireLogin,
  onWhispered,
  onTownMoved,
  talkBudgetHint,
  slot = 'full',
  onCourseKeepAlive,
  liveNudge = 0,
  talks = [],
  onPulse,
  onCourseStatus,
  onCourseBoard,
  actBarCompact = false,
  shareTitle,
  shareSlugOrId,
  onOpenCourse,
  courseShareLanding = false,
  courseFollowLanding = false,
  onShareLandingDone,
  pollActive = true,
}) => {
  const { t } = useT();
  const [balance, setBalance] = useState<number | null>(null);
  const [courseStatus, setCourseStatus] = useState<string | null>(null);
  const [courseWatching, setCourseWatching] = useState(false);
  const [courseCurrent, setCourseCurrent] = useState<CourseBoard['current']>(null);
  const [folds, setFolds] = useState<string[]>([]);
  const showBoard = slot === 'permit' || slot === 'full';
  const showWhisper = slot === 'more' || slot === 'full';
  const tipPresets = commerce?.tipPresets?.length
    ? commerce.tipPresets
    : [5, 12, 30];

  useEffect(() => {
    if (!canSpend) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    void api.billing
      .wallet()
      .then((w) => {
        if (!cancelled) setBalance(w.balance);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canSpend, gameId]);

  useEffect(() => {
    const extra = guestDeskOpenFolds(courseStatus);
    if (extra.length === 0) return;
    setFolds((prev) => {
      const next = new Set(prev);
      for (const key of extra) next.add(key);
      return [...next];
    });
  }, [courseStatus]);

  const extraFolds = [
    ...(showWhisper
      ? [
          {
            key: 'whisper',
            label: t('product.obs.course.whisperToggle'),
            children: (
              <WorldWhispers
                embedded
                ensureCourse
                courseSnapshot={courseCurrent}
                gameId={gameId}
                canWhisper={canSpend}
                paidCost={0}
                xiangyiEnabled={false}
                initialLine={whisperDraft}
                refreshToken={whisperTick}
                onRequireLogin={(line) => onRequireLogin(line)}
                onWhispered={onWhispered}
              />
            ),
          },
        ]
      : []),
    {
      key: 'tip',
      label: t('product.obs.tipLight'),
      children: (
        <SocietyTownTipFold
          gameId={gameId}
          canSpend={canSpend}
          presets={tipPresets}
          onRequireLogin={() => onRequireLogin()}
          onTipped={(info) => {
            if (typeof info.balance === 'number') setBalance(info.balance);
            onTownMoved({
              lightUntil: info.lightUntil,
            });
          }}
        />
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={10} style={{ width: '100%' }}>
      <CourseOutcomeBanner
        gameId={gameId}
        watching={courseWatching}
        isAuthenticated={canSpend}
        onOpenCourse={onOpenCourse}
        onUnwatch={() => setCourseWatching(false)}
      />
      {showBoard ? (
        <SocietyTownCourseDesk
          gameId={gameId}
          canStake={canSpend}
          isAuthor={false}
          liveNudge={liveNudge}
          pollActive={pollActive}
          talks={talks}
          actBarCompact={actBarCompact}
          shareTitle={shareTitle}
          shareSlugOrId={shareSlugOrId}
          courseShareLanding={courseShareLanding}
          courseFollowLanding={courseFollowLanding}
          onShareLandingDone={onShareLandingDone}
          onBalance={setBalance}
          onRequireLogin={() => onRequireLogin()}
          onPulse={onPulse}
          onBoard={(board) => {
            const status = board?.current?.status ?? null;
            setCourseStatus(status);
            setCourseWatching(board?.watching ?? false);
            setCourseCurrent(board?.current ?? null);
            onCourseStatus?.(status);
            onCourseBoard?.(board);
            onCourseKeepAlive?.(courseKeepAliveNeeded(board));
          }}
        />
      ) : talkBudgetHint ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {talkBudgetHint}
        </Text>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('product.obs.guestWatchHint')}
        </Text>
      )}
      {balance != null ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('product.obs.balanceHint', { n: String(balance) })}
        </Text>
      ) : null}
      {extraFolds.length > 0 ? (
        <Collapse
          size="small"
          ghost
          activeKey={folds}
          onChange={(keys) =>
            setFolds(Array.isArray(keys) ? keys.map(String) : [String(keys)])
          }
          items={extraFolds}
        />
      ) : null}
    </Space>
  );
};
