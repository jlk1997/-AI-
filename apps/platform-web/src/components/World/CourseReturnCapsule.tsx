/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global「今夜结果」pill for community / mobile me.
 */

import React, { useEffect, useState } from 'react';
import { Badge, Button } from 'antd';
import { useNavigate } from 'react-router-dom';

import type { MyCourseStakeRow, MyCourseWatchRow } from '../../services/api';
import { useT } from '../../services/i18n';
import { coursePlayHref, courseWatchPlayHref } from '../Community/communityCourseLine';
import {
  countUnseenCourseOutcomes,
  listUnseenCourseOutcomes,
  onCourseOutcomeChanged,
} from './courseOutcomeInbox';
import { courseReturnCapsuleCopy } from './courseReturnCapsuleCopy';
import { trackCourseEvent } from './courseTelemetry';
import { useMyCourseTonight } from './myCourseTonightStore';
import {
  anyWatchShouldPulse,
  markWatchPulseSeen,
  onWatchPulseChanged,
  shouldPulseWatch,
  watchPulseKind,
} from './courseWatchSignals';

export function pickReturnTarget(
  stakes: readonly MyCourseStakeRow[],
  watches: readonly MyCourseWatchRow[],
): { readonly slug: string; readonly gameId: string; readonly viaWatch: boolean } | null {
  const activeStakes = stakes.filter(
    (row) => row.status === 'open' || row.status === 'closed',
  );
  const stakedIds = new Set(activeStakes.map((row) => row.gameId));
  const watchOnly = watches.filter((row) => !stakedIds.has(row.gameId));

  // Match capsule copy / hub rank: pulsing settled → pulsing open → unseen → stakes.
  const pulsingSettled = watchOnly.find(
    (row) => shouldPulseWatch(row) && watchPulseKind(row) === 'settled',
  );
  if (pulsingSettled) {
    return { slug: pulsingSettled.slug, gameId: pulsingSettled.gameId, viaWatch: true };
  }

  const pulsingOpen = watchOnly.find(
    (row) => shouldPulseWatch(row) && watchPulseKind(row) === 'open',
  );
  if (pulsingOpen) {
    return { slug: pulsingOpen.slug, gameId: pulsingOpen.gameId, viaWatch: true };
  }

  const unseen = listUnseenCourseOutcomes();
  if (unseen.length > 0) {
    const hit = unseen[0];
    const fromStake = stakes.find((row) => row.gameId === hit.gameId);
    if (fromStake) {
      return { slug: fromStake.slug, gameId: hit.gameId, viaWatch: false };
    }
    const fromWatch = watches.find((row) => row.gameId === hit.gameId);
    if (fromWatch) {
      return { slug: fromWatch.slug, gameId: hit.gameId, viaWatch: true };
    }
  }

  if (activeStakes[0]) {
    return {
      slug: activeStakes[0].slug,
      gameId: activeStakes[0].gameId,
      viaWatch: false,
    };
  }

  const liveWatch = watchOnly.find(
    (row) => row.course?.status === 'open' || row.course?.status === 'closed',
  );
  if (liveWatch) {
    return { slug: liveWatch.slug, gameId: liveWatch.gameId, viaWatch: true };
  }
  if (stakes[0]) {
    return { slug: stakes[0].slug, gameId: stakes[0].gameId, viaWatch: false };
  }
  if (watches[0]) {
    return { slug: watches[0].slug, gameId: watches[0].gameId, viaWatch: true };
  }
  return null;
}

export const CourseReturnCapsule: React.FC = () => {
  const { t } = useT();
  const navigate = useNavigate();
  const { stakes, watches } = useMyCourseTonight();
  const [unseen, setUnseen] = useState(0);
  const [pulseTick, setPulseTick] = useState(0);

  useEffect(() => {
    const sync = (): void => setUnseen(countUnseenCourseOutcomes());
    sync();
    const timer = window.setInterval(sync, 12_000);
    const stopOutcome = onCourseOutcomeChanged(sync);
    const stopPulse = onWatchPulseChanged(() => {
      setPulseTick((n) => n + 1);
    });
    return () => {
      window.clearInterval(timer);
      stopOutcome();
      stopPulse();
    };
  }, []);

  const activeStakes = stakes.filter(
    (row) => row.status === 'open' || row.status === 'closed',
  );
  const stakedIds = new Set(activeStakes.map((row) => row.gameId));
  const watchOnly = watches.filter((row) => !stakedIds.has(row.gameId));
  const liveWatches = watchOnly.filter(
    (row) => row.course?.status === 'open' || row.course?.status === 'closed',
  );
  const revisitCount = activeStakes.length + liveWatches.length;
  const target = pickReturnTarget(stakes, watches);

  if (unseen <= 0 && revisitCount <= 0 && watchOnly.length <= 0 && !target) {
    return null;
  }

  const capsuleCopy = courseReturnCapsuleCopy({
    unseen,
    activeStakes,
    watchOnly,
    liveWatches,
  });
  void pulseTick;

  const go = (): void => {
    if (!target) return;
    const watchRow = watches.find((item) => item.gameId === target.gameId);
    if (watchRow) markWatchPulseSeen(watchRow);
    const row =
      activeStakes.find((item) => item.gameId === target.gameId) ?? watchRow;
    trackCourseEvent('course_return_from_community', {
      gameId: target.gameId,
      status: row && 'status' in row ? row.status : 'watch',
    });
    navigate(
      target.viaWatch
        ? courseWatchPlayHref(target.slug)
        : coursePlayHref(target.slug, { course: true }),
    );
  };

  const capsuleLive = unseen > 0 || anyWatchShouldPulse(watchOnly);

  return (
    <Badge count={unseen > 0 ? unseen : undefined} size="small">
      <Button
        size="small"
        className={`og-course-return-capsule${
          capsuleLive ? ' og-course-return-capsule--live' : ''
        }`}
        onClick={go}
      >
        {t(capsuleCopy.key, capsuleCopy.vars)}
      </Button>
    </Badge>
  );
};
