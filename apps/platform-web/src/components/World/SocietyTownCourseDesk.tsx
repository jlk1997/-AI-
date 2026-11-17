/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tonight’s board. Authors seed; visitors stake 12 / 24 / 48.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Space, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';

import {
  chinaWallClock,
  courseActIndex,
  courseActPrimaryNoteKey,
  courseBoardPulse,
  coursePhaseClock,
  courseVoidReasonKey,
  previewCoursePayout,
  type CoursePulse,
} from '@opengame/platform-shared';

import {
  api,
  ApiError,
  type CourseBoard,
  type CourseView,
} from '../../services/api';
import { translateApiError, useT } from '../../services/i18n';
import { featureFlags } from '../../utils/featureFlags';
import {
  openWalletForPaywall,
  paywallFromError,
  paywallNeedCopy,
} from '../../utils/kaiPaywall';
import { authorSeedCtaKey, courseBoardEmptyKey, courseEvidenceHealthKey, courseEvidenceQuietKey, courseEvidenceQuietWarning, courseGuestReachabilityWarning, courseInEvidencePhase, coursePollingIntervalMs, coursePulseShouldFocusDesk, courseReachabilityDeskKey, courseSeedSourceKey, courseStakedEvidenceKey } from './courseAuthorFlow';
import { CourseActProgressBar } from './CourseActProgressBar';
import { CourseActProgress5Bar } from './CourseActProgress5Bar';
import { CourseFollowOpenCoach } from './CourseFollowOpenCoach';
import { CourseNotifyPrompt } from './CourseNotifyPrompt';
import { CourseWatchAfterStakePrompt } from './CourseWatchAfterStakePrompt';
import { CourseQueuedPreview } from './CourseQueuedPreview';
import { CourseNotifySettings } from './CourseNotifySettings';
import { CourseWatchButton } from './CourseWatchButton';
import { CourseOnboardingCoach } from './CourseOnboardingCoach';
import { GuestCourseCoach } from './GuestCourseCoach';
import { CourseTonightNearby } from './CourseTonightNearby';
import { CourseSettlementCard } from './CourseSettlementCard';
import { CourseShareButton } from './CourseShareButton';
import { courseEvidencePreview, courseEvidenceHitPulse, courseEvidenceHitToastKey } from './courseEvidence';
import { pushCourseOutcome, markCourseOutcomeSeen } from './courseOutcomeInbox';
import {
  coursePulseToastKey,
  maybeCourseBrowserPulseNotify,
  shouldShowCourseNotifyPrompt,
  showCoursePulseToast,
} from './coursePulseUx';
import { buildCourseHistoryShareText, courseDeepLinkUrl } from './courseShare';
import { shouldShowWatchAfterStakePrompt } from './courseWatchStakePrompt';
import { mergeCourseBoardKeepExtras, mergeCourseBoardPoll } from './courseBoardMerge';
import { coalescePendingSilent } from './coursePullCoalesce';
import { trackCourseEvent, notifyCourseStakeChanged, notifyCourseWatchChanged } from './courseTelemetry';
import {
  courseDeskReturnPath,
  peekPendingCourse,
  rememberLoginReturnTo,
  rememberPendingCourse,
  takePendingCourse,
} from '../../utils/loginIntent';
import type { TalkLine } from './societyTownStageModel';
import {
  COURSE_DESK_ID,
  COURSE_HISTORY_ID,
  scrollToCourseDesk,
  scrollToCourseHistory,
  scrollToWhisperDesk,
} from './societyTownTimeDesk';

const { Text } = Typography;

function remainLabel(
  t: (k: string, vars?: Record<string, string | number>) => string,
  minutes: number,
): string {
  if (minutes < 60) {
    return t('product.obs.course.remain.minutes', { n: String(minutes) });
  }
  const hours = Math.floor(minutes / 60);
  const leftover = minutes % 60;
  if (leftover === 0) {
    return t('product.obs.course.remain.hours', { h: String(hours) });
  }
  return t('product.obs.course.remain.hoursMinutes', {
    h: String(hours),
    m: String(leftover),
  });
}

/**
 * 5 幕 UX：把 pulse 映射到"是谁堵的盘"的客户可读 key。
 * 仅当 feature flag courseUxV2=true 时调用；不影响原有 coursePulseToastKey。
 */
function courseClosedReasonKey(
  pulse: { readonly kind: string; readonly voidReason?: string | null },
): string | null {
  if (pulse.kind !== 'closed' && pulse.kind !== 'voided') return null;
  const reason = pulse.voidReason;
  if (reason === 'paused') return 'product.obs.course.toast.closedPaused';
  if (reason === 'takedown') return 'product.obs.course.toast.closedTakedown';
  if (reason === 'author_replace') return 'product.obs.course.toast.closedAuthor';
  // 倒计时到 / muted / unclear / uncontested 等都是 timer 自然触发的关盘
  if (pulse.kind === 'closed') return 'product.obs.course.toast.closedTimer';
  return null;
}

export function courseDeskClockLine(
  t: (k: string, vars?: Record<string, string | number>) => string,
  current: Pick<CourseView, 'status' | 'bettingClosesAt' | 'settlesAt'>,
  nowMs = Date.now(),
): string | null {
  const bettingClosesAtMs = Date.parse(current.bettingClosesAt);
  const settlesAtMs = Date.parse(current.settlesAt);
  if (!Number.isFinite(bettingClosesAtMs) || !Number.isFinite(settlesAtMs)) {
    return null;
  }
  const clock = coursePhaseClock({
    status: current.status,
    bettingClosesAtMs,
    settlesAtMs,
    nowMs,
  });
  if (clock.phase === 'done') return null;
  const china = t('product.obs.course.clock.china');
  if (clock.phase === 'due') {
    return `${t('product.obs.course.clock.due')} · ${china}`;
  }
  const remain = remainLabel(t, clock.remainMinutes);
  const phase =
    clock.phase === 'betting'
      ? t('product.obs.course.clock.betting', { n: remain })
      : t('product.obs.course.clock.evidence', { n: remain });
  const until = chinaWallClock(current.settlesAt, nowMs);
  const untilLine = until
    ? t('product.obs.course.clock.evidenceUntil', {
        day: t(`product.obs.course.clock.day.${until.day}`),
        clock: until.clock,
      })
    : '';
  return untilLine
    ? `${phase} · ${untilLine} · ${china}`
    : `${phase} · ${china}`;
}

export function courseKeepAliveNeeded(board: CourseBoard | null): boolean {
  const current = board?.current;
  if (!current) return false;
  if (current.status !== 'open' && current.status !== 'closed') return false;
  if (!current.mutedHint) return false;
  return current.myPoints > 0 && Boolean(current.contested);
}

export { coursePulseToastKey } from './coursePulseUx';

export function coursePhaseCopyKey(
  status: string,
):
  | 'product.obs.course.phase.open'
  | 'product.obs.course.phase.closed'
  | 'product.obs.course.phase.settled'
  | 'product.obs.course.phase.voided' {
  if (status === 'closed') return 'product.obs.course.phase.closed';
  if (status === 'voided') return 'product.obs.course.phase.voided';
  if (status === 'settled') return 'product.obs.course.phase.settled';
  return 'product.obs.course.phase.open';
}

export function courseStakeCtaLine(
  t: (k: string, vars?: Record<string, string | number>) => string,
  input: { readonly stake: number; readonly pool: number; readonly optionPoints: number },
): string {
  const stake = t('product.obs.course.stakeCta', { n: String(input.stake) });
  const preview = previewCoursePayout(input);
  if (!preview) return stake;
  if (!preview.contested) {
    return `${stake} · ${t('product.obs.course.needOpponentInvite')}`;
  }
  return `${stake} · ${t('product.obs.course.ifWin', { n: String(preview.payout) })}`;
}

function courseErrorCopy(
  t: (k: string) => string,
  err: unknown,
): string {
  const raw =
    err instanceof ApiError
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: string }).message ?? '')
        : '';
  if (/23514|ledger_entries_kind/i.test(raw)) {
    return t('product.obs.course.err.ledger');
  }
  const key = `product.obs.course.err.${raw}`;
  const localized = t(key);
  return localized !== key ? localized : translateApiError(err);
}

export const SocietyTownCourseDesk: React.FC<{
  readonly gameId?: string | null;
  readonly projectId?: string | null;
  readonly canStake: boolean;
  readonly isAuthor: boolean;
  readonly onRequireLogin: () => void;
  readonly onBoard?: (board: CourseBoard | null) => void;
  readonly seedEmpty?: boolean;
  readonly variant?: 'full' | 'line';
  readonly liveNudge?: number;
  readonly onBalance?: (balance: number) => void;
  readonly onOpenAuthorSeed?: () => void;
  readonly onPulse?: (pulse: CoursePulse) => void;
  readonly talks?: readonly TalkLine[];
  readonly actBarCompact?: boolean;
  readonly shareTitle?: string;
  readonly shareSlugOrId?: string;
  readonly courseShareLanding?: boolean;
  readonly courseFollowLanding?: boolean;
  readonly onShareLandingDone?: () => void;
  /** When false, skip interval/visibility polls (e.g. mobile drawer closed). */
  readonly pollActive?: boolean;
}> = ({
  gameId,
  projectId,
  canStake,
  isAuthor,
  onRequireLogin,
  onBoard,
  seedEmpty = false,
  variant = 'full',
  liveNudge = 0,
  onBalance,
  onOpenAuthorSeed,
  onPulse,
  talks = [],
  actBarCompact = false,
  shareTitle,
  shareSlugOrId,
  courseShareLanding = false,
  courseFollowLanding = false,
  onShareLandingDone,
  pollActive = true,
}) => {
  const { t } = useT();
  const navigate = useNavigate();
  const [board, setBoard] = useState<CourseBoard | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stakePoints, setStakePoints] = useState<number>(12);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loaded, setLoaded] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [flashOptionId, setFlashOptionId] = useState<string | null>(null);
  const [highlightPick, setHighlightPick] = useState(false);
  const [notifyPrompt, setNotifyPrompt] = useState(false);
  const [watchPrompt, setWatchPrompt] = useState(false);
  const [resumeFollowCoach, setResumeFollowCoach] = useState(false);

  const requestCourseLogin = useCallback(
    (kind: 'stake' | 'follow_open' | 'watch' = 'stake'): void => {
      if (gameId) {
        rememberPendingCourse({ gameId, kind });
        rememberLoginReturnTo(
          courseDeskReturnPath(
            `${window.location.pathname}${window.location.search}`,
          ),
        );
      }
      onRequireLogin();
    },
    [gameId, onRequireLogin],
  );

  const boardRef = useRef<CourseBoard | null>(null);
  const talksRef = useRef(talks);
  const onBoardRef = useRef(onBoard);
  const onPulseRef = useRef(onPulse);
  const lastPulseRef = useRef('');
  const lastHitPulseRef = useRef('');
  const flashTimerRef = useRef(0);
  const lastActRef = useRef<number | null>(null);
  /** Bumped on stake/withdraw so in-flight GETs cannot clobber newer board. */
  const boardSeqRef = useRef(0);
  const pullInFlightRef = useRef(false);
  const pendingPullSilentRef = useRef<boolean | null>(null);
  const pollActiveRef = useRef(pollActive);
  const busyRef = useRef<string | null>(null);
  onBoardRef.current = onBoard;
  onPulseRef.current = onPulse;
  boardRef.current = board;
  talksRef.current = talks;
  busyRef.current = busy;
  pollActiveRef.current = pollActive;

  const patchWatching = useCallback((watching: boolean): void => {
    setBoard((prev) => {
      if (!prev) return prev;
      const next = { ...prev, watching };
      onBoardRef.current?.(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!canStake || !gameId) return;
    const pending = peekPendingCourse();
    if (!pending || pending.gameId !== gameId) return;
    takePendingCourse();
    if (pending.kind === 'watch') {
      const scrollTimer = window.setTimeout(() => scrollToCourseDesk(), 350);
      void api.me
        .courseWatch(gameId)
        .then(() => {
          patchWatching(true);
          notifyCourseWatchChanged();
        })
        .catch(() => undefined);
      trackCourseEvent('course_login_resume', { gameId, kind: 'watch' });
      return () => window.clearTimeout(scrollTimer);
    }
    setHighlightPick(true);
    if (pending.kind === 'follow_open') {
      setResumeFollowCoach(true);
    }
    const scrollTimer = window.setTimeout(() => scrollToCourseDesk(), 350);
    const clearHighlight =
      pending.kind === 'stake'
        ? window.setTimeout(() => setHighlightPick(false), 12_000)
        : 0;
    trackCourseEvent('course_login_resume', {
      gameId,
      kind: pending.kind,
    });
    return () => {
      window.clearTimeout(scrollTimer);
      if (clearHighlight) window.clearTimeout(clearHighlight);
    };
  }, [canStake, gameId, patchWatching]);

  const pullBoard = useCallback(
    async (silent: boolean): Promise<void> => {
      if (busyRef.current) return;
      if (
        silent
        && typeof document !== 'undefined'
        && document.hidden
      ) {
        return;
      }
      if (pullInFlightRef.current) {
        pendingPullSilentRef.current = coalescePendingSilent(
          pendingPullSilentRef.current,
          silent,
        );
        return;
      }
      const req = gameId
        ? api.community.course(gameId, { ensure: !isAuthor })
        : projectId
          ? api.community.worldCourse(projectId)
          : null;
      if (!req) return;
      const seq = boardSeqRef.current;
      pullInFlightRef.current = true;
      try {
      const next = await req;
      if (seq !== boardSeqRef.current || busyRef.current) return;
      const wasId = boardRef.current?.current?.id;
      const prevCurrent = boardRef.current?.current;
      const pulse = courseBoardPulse(boardRef.current, next, { isAuthor });
      const liveTalks = talksRef.current;
      const evidencePrev =
        prevCurrent
        && (prevCurrent.status === 'open' || prevCurrent.status === 'closed')
          ? courseEvidencePreview(prevCurrent, liveTalks)
          : [];
      const evidenceNext =
        next.current
        && (next.current.status === 'open' || next.current.status === 'closed')
          ? courseEvidencePreview(next.current, liveTalks)
          : [];
      const inEvidence =
        next.current
        && courseInEvidencePhase({
          status: next.current.status,
          bettingClosesAt: next.current.bettingClosesAt,
        });
      const hitPulse =
        inEvidence && !silent && variant === 'full'
          ? courseEvidenceHitPulse(
              evidencePrev,
              evidenceNext,
              next.current?.myOptionId,
            )
          : null;
      const merged = mergeCourseBoardPoll(boardRef.current, next);
      setBoard(merged);
      onBoardRef.current?.(merged);
      setLoaded(true);
      setStakePoints((prev) => {
        const steps = next.current?.addSteps ?? [];
        if (steps.includes(prev)) return prev;
        return steps[0] ?? next.current?.minStake ?? 12;
      });
      if (!silent && pulse && variant === 'full') {
        const hadStake = (prevCurrent?.myPoints ?? 0) > 0;
        const isWatching = Boolean(merged.watching);
        const watchMilestone =
          !hadStake
          && isWatching
          && !isAuthor
          && (pulse.kind === 'won'
            || pulse.kind === 'lost'
            || pulse.kind === 'voided'
            || pulse.kind === 'closed');
        const notifyPulse = hadStake || pulse.kind === 'author_contested' || watchMilestone;
        const sig = `${pulse.kind}:${next.current?.id ?? ''}:${next.current?.status ?? ''}:${next.current?.pool ?? 0}:${pulse.voidReason ?? ''}`;
        if (lastPulseRef.current !== sig) {
          lastPulseRef.current = sig;
          onPulseRef.current?.(pulse);
          if (coursePulseShouldFocusDesk(pulse, notifyPulse)) {
            scrollToCourseDesk();
          }
          if (notifyPulse) {
            showCoursePulseToast(t, pulse, hadStake);
            maybeCourseBrowserPulseNotify(t, pulse, notifyPulse, shareTitle);
            // 5 幕 UX：把"谁堵的盘"显式告诉客户。仅在 flag 开时追加，旧 toast 不受影响。
            if (featureFlags.courseUxV2) {
              const reasonKey = courseClosedReasonKey(pulse);
              if (reasonKey) {
                const reasonText = t(reasonKey);
                if (pulse.kind === 'voided') {
                  message.warning(reasonText, 6);
                } else {
                  message.info(reasonText, 4);
                }
              }
            }
          }
          if (
            (pulse.kind === 'won'
              || pulse.kind === 'lost'
              || pulse.kind === 'voided'
              || pulse.kind === 'closed')
            && hadStake
            && gameId
          ) {
            const nodeId = next.current?.id ?? prevCurrent?.id;
            if (nodeId) {
              pushCourseOutcome({
                gameId,
                nodeId,
                kind: pulse.kind === 'closed' ? 'closed' : pulse.kind,
                prompt: next.current?.prompt ?? prevCurrent?.prompt,
                canon: next.current?.canon ?? prevCurrent?.canon ?? null,
                at: Date.now(),
              });
              if (typeof document !== 'undefined' && !document.hidden) {
                markCourseOutcomeSeen(gameId, nodeId);
              }
            }
          }
          if (watchMilestone && gameId) {
            const nodeId = next.current?.id ?? prevCurrent?.id;
            if (nodeId) {
              pushCourseOutcome({
                gameId,
                nodeId,
                kind: pulse.kind === 'closed' ? 'closed' : 'watch_settled',
                prompt: next.current?.prompt ?? prevCurrent?.prompt,
                canon: next.current?.canon ?? prevCurrent?.canon ?? null,
                at: Date.now(),
              });
            }
          }
          if (
            pulse.kind === 'won' ||
            pulse.kind === 'lost' ||
            pulse.kind === 'voided'
          ) {
            window.setTimeout(() => scrollToCourseHistory(), 500);
          } else if (pulse.kind === 'closed' && hadStake) {
            window.setTimeout(() => scrollToWhisperDesk(), 600);
          }
        }
      }
      if (hitPulse) {
        const sig = `hit:${next.current?.id ?? ''}:${hitPulse.optionId}:${evidenceNext.find((row) => row.optionId === hitPulse.optionId)?.hits ?? 0}`;
        if (lastHitPulseRef.current !== sig) {
          lastHitPulseRef.current = sig;
          message.info(
            t(courseEvidenceHitToastKey(hitPulse.mine), {
              label: hitPulse.label,
            }),
          );
          setFlashOptionId(hitPulse.optionId);
          window.clearTimeout(flashTimerRef.current);
          flashTimerRef.current = window.setTimeout(() => setFlashOptionId(null), 2_400);
        }
      }
      } finally {
        pullInFlightRef.current = false;
        const pendingSilent = pendingPullSilentRef.current;
        if (pendingSilent !== null) {
          pendingPullSilentRef.current = null;
          void pullBoard(pendingSilent).catch(() => undefined);
        }
      }
    },
    [gameId, projectId, isAuthor, variant, t, shareTitle],
  );

  useEffect(() => {
    if (!featureFlags.courseMarket || !pollActive) return;
    void pullBoard(true).catch(() => undefined);
  }, [gameId, projectId, isAuthor, pullBoard, pollActive]);

  useEffect(() => {
    if (!featureFlags.courseMarket || !pollActive) return;
    const tick = (): void => {
      setNowMs(Date.now());
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!pollActiveRef.current) return;
      if (variant === 'full') {
        void pullBoard(false).catch(() => undefined);
      }
    };
    const pollMs = coursePollingIntervalMs({
      status: board?.current?.status,
      bettingClosesAt: board?.current?.bettingClosesAt,
      myPoints: board?.current?.myPoints,
    });
    const timer = window.setInterval(tick, variant === 'full' ? pollMs : 1_000);
    return () => window.clearInterval(timer);
  }, [
    pullBoard,
    variant,
    pollActive,
    board?.current?.status,
    board?.current?.myPoints,
    board?.current?.bettingClosesAt,
  ]);

  useEffect(() => {
    if (!featureFlags.courseMarket || !pollActive) return;
    const onVis = (): void => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void pullBoard(true).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [pullBoard, pollActive]);

  useEffect(() => {
    return () => {
      window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const current = board?.current;
    if (!current) return;
    const act = courseActIndex(current, nowMs);
    if (act == null || act === lastActRef.current) return;
    const prev = lastActRef.current;
    lastActRef.current = act;
    trackCourseEvent('course_act_view', { act });
    if (
      prev === 1
      && act === 2
      && current.myPoints > 0
      && variant === 'full'
    ) {
      message.info(t('product.obs.course.actEnterEvidence'), 5);
    }
  }, [
    board?.current?.id,
    board?.current?.status,
    board?.current?.bettingClosesAt,
    board?.current?.myPoints,
    nowMs,
    variant,
    t,
  ]);

  useEffect(() => {
    if (!featureFlags.courseMarket || liveNudge <= 0 || !pollActive) return;
    void pullBoard(false).catch(() => undefined);
  }, [liveNudge, pullBoard, pollActive]);

  if (!featureFlags.courseMarket) return null;

  const current = board?.current ?? null;
  const history = board?.history ?? [];

  const applyBoard = (next: CourseBoard): void => {
    setBoard(next);
    onBoard?.(next);
  };

  const stake = (optionId: string): void => {
    if (!gameId || !current) return;
    if (!canStake) {
      requestCourseLogin('stake');
      return;
    }
    const points = current.addSteps.includes(stakePoints)
      ? stakePoints
      : current.minStake;
    boardSeqRef.current += 1;
    setBusy(optionId);
    void api.community
      .stakeCourse(gameId, optionId, points)
      .then((res) => {
        applyBoard(
          mergeCourseBoardKeepExtras(boardRef.current, {
            current: res.current,
            history: res.history,
          }),
        );
        onBalance?.(res.balance);
        const before = current.options.find((row) => row.id === optionId);
        const preview = previewCoursePayout({
          pool: current.pool,
          optionPoints: before?.points ?? 0,
          stake: points,
        });
        message.success(
          preview?.contested
            ? `${t('product.obs.course.staked')} ${t('product.obs.course.ifWin', {
                n: String(preview.payout),
              })}`
            : `${t('product.obs.course.staked')} ${t('product.obs.course.needOpponent')}`,
        );
        if ((current.myPoints ?? 0) <= 0) {
          trackCourseEvent('course_first_stake', { gameId });
          const alreadyWatching = Boolean(boardRef.current?.watching);
          if (shouldShowCourseNotifyPrompt()) {
            setNotifyPrompt(true);
          } else if (
            !alreadyWatching
            && shouldShowWatchAfterStakePrompt(gameId)
          ) {
            setWatchPrompt(true);
          }
        }
        notifyCourseStakeChanged();
      })
      .catch((err: unknown) => {
        const status = err instanceof ApiError ? err.status : 0;
        if (status === 402) {
          const wall = openWalletForPaywall(err, navigate);
          message.warning(paywallNeedCopy(t, wall ?? paywallFromError(err)));
          return;
        }
        message.error(courseErrorCopy(t, err));
      })
      .finally(() => setBusy(null));
  };

  const withdraw = (): void => {
    if (!gameId || !current) return;
    if (!canStake) {
      requestCourseLogin('stake');
      return;
    }
    boardSeqRef.current += 1;
    setBusy('withdraw');
    void api.community
      .withdrawCourse(gameId, current.id)
      .then((res) => {
        applyBoard(
          mergeCourseBoardKeepExtras(boardRef.current, {
            current: res.current,
            history: res.history,
          }),
        );
        onBalance?.(res.balance);
        message.success(t('product.obs.course.withdrawn'));
        notifyCourseStakeChanged();
      })
      .catch((err: unknown) => message.error(courseErrorCopy(t, err)))
      .finally(() => setBusy(null));
  };

  if (variant === 'line') {
    if (!current) return null;
    const clock = courseDeskClockLine(t, current, nowMs);
    const goClosed = current.status !== 'open';
    return (
      <Space size={6} wrap style={{ width: '100%' }}>
        <Text style={{ fontSize: 12 }}>
          <Text strong>{t('product.obs.course.title')}</Text>
          {` · ${current.prompt}`}
          {` · ${t('product.obs.course.pool', { n: String(current.pool) })}`}
          {current.myPoints > 0
            ? ` · ${t('product.obs.course.myStake', { n: String(current.myPoints) })}`
            : ''}
          {clock ? ` · ${clock}` : ''}
        </Text>
        <Button
          type="link"
          size="small"
          style={{ padding: 0, height: 'auto', fontSize: 12 }}
          onClick={() => (goClosed ? scrollToWhisperDesk() : scrollToCourseDesk())}
        >
          {goClosed ? t('product.obs.course.goBlow') : t('product.obs.course.goStake')}
        </Button>
      </Space>
    );
  }

  return (
    <div id={COURSE_DESK_ID} className="og-course-desk">
      {current ? (
        featureFlags.courseUxV2 ? (
          <CourseActProgress5Bar view={current} nowMs={nowMs} compact={actBarCompact} />
        ) : (
          <CourseActProgressBar view={current} nowMs={nowMs} compact={actBarCompact} />
        )
      ) : null}
      {current && featureFlags.courseUxV2 ? (
        <p className="og-course-ai-judge">{t('product.obs.course.aiJudgeShort')}</p>
      ) : null}
      {current && shareTitle && shareSlugOrId && courseActIndex(current, nowMs) !== 3 ? (
        <CourseShareButton
          title={shareTitle}
          slugOrId={shareSlugOrId}
          prompt={current.prompt}
          pool={current.pool}
          status={current.status}
          bettingClosesAt={current.bettingClosesAt}
          contested={current.contested}
          myStakeLabel={
            current.options.find((row) => row.id === current.myOptionId)?.label ?? null
          }
          withPoster
        />
      ) : null}
      {current ? (
        <Button
          type="link"
          size="small"
          className="og-course-desk__how"
          onClick={() => setShowHow((on) => !on)}
        >
          {showHow ? t('product.obs.course.howHide') : t('product.obs.course.howShow')}
        </Button>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('product.obs.course.hint')}
        </Text>
      )}
      {!current || showHow ? (
        <div className="og-course-desk__rules">
          <span>{t('product.obs.course.how1')}</span>
          <span>{t('product.obs.course.how2')}</span>
          <span>{t('product.obs.course.how3')}</span>
        </div>
      ) : null}
      {seedEmpty ? (
        <Text type="warning" style={{ fontSize: 12 }}>
          {t('product.obs.course.seedEmpty')}
        </Text>
      ) : null}
      {!current ? (
        isAuthor ? (
          <Button type="primary" block onClick={() => onOpenAuthorSeed?.()}>
            {board?.skipReason === 'unfunded'
              ? t('product.obs.course.unfundedCta')
              : t('product.obs.course.emptyAuthorCta')}
          </Button>
        ) : (
          <Space orientation="vertical" size={4} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {loaded
                ? t(
                    courseBoardEmptyKey({
                      skipReason: board?.skipReason,
                      isAuthor,
                    }),
                  )
                : t('product.obs.course.loading')}
            </Text>
            {loaded && board?.skipReason === 'unfunded' && !isAuthor ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('product.obs.course.teaser')}
              </Text>
            ) : null}
            {loaded && !board?.skipReason ? (
              <>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('product.obs.course.emptyGuest')}
                </Text>
                <CourseTonightNearby />
                {gameId ? (
                  <CourseWatchButton
                    gameId={gameId}
                    watching={board?.watching ?? false}
                    isAuthenticated={canStake}
                    onRequireLogin={() => requestCourseLogin('watch')}
                    onWatchingChange={patchWatching}
                  />
                ) : null}
              </>
            ) : null}
          </Space>
        )
      ) : (
        <>
          {!(courseFollowLanding || resumeFollowCoach) ? (
            <CourseOnboardingCoach
              status={current.status}
              bettingClosesAt={current.bettingClosesAt}
              isAuthor={isAuthor}
              hasStake={current.myPoints > 0}
              isAuthenticated={canStake}
              onHighlightPick={setHighlightPick}
            />
          ) : null}
          <GuestCourseCoach
            status={current.status}
            bettingClosesAt={current.bettingClosesAt}
            isAuthor={isAuthor}
            isAuthenticated={canStake}
            hasStake={current.myPoints > 0}
            minStake={current.minStake}
            shareLanding={courseShareLanding}
            suppressed={courseFollowLanding || resumeFollowCoach}
            onHighlightPick={setHighlightPick}
            onLoginStake={() => requestCourseLogin('stake')}
            onDismiss={onShareLandingDone}
          />
          <CourseFollowOpenCoach
            gameId={gameId}
            status={current.status}
            bettingClosesAt={current.bettingClosesAt}
            isAuthor={isAuthor}
            hasStake={(current.myPoints ?? 0) > 0}
            isAuthenticated={canStake}
            followLanding={courseFollowLanding}
            forceOpen={resumeFollowCoach}
            onHighlightPick={setHighlightPick}
            onPickSide={() => {
              setResumeFollowCoach(false);
              scrollToCourseDesk();
            }}
            onClose={() => setResumeFollowCoach(false)}
            onRequireLogin={() => requestCourseLogin('follow_open')}
          />
          {notifyPrompt ? (
            <CourseNotifyPrompt
              onDone={() => {
                setNotifyPrompt(false);
                if (
                  gameId
                  && !board?.watching
                  && shouldShowWatchAfterStakePrompt(gameId)
                ) {
                  setWatchPrompt(true);
                }
              }}
            />
          ) : null}
          {watchPrompt && gameId ? (
            <CourseWatchAfterStakePrompt
              gameId={gameId}
              onDone={() => setWatchPrompt(false)}
              onWatchingChange={patchWatching}
            />
          ) : null}
          <CourseCard
            current={current}
            canStake={canStake && !isAuthor && Boolean(gameId)}
            askLogin={!canStake && !isAuthor}
            isAuthor={isAuthor}
            busy={busy}
            stakePoints={stakePoints}
            nowMs={nowMs}
            flashOptionId={flashOptionId}
            highlightFirstOption={highlightPick}
            onStakePoints={setStakePoints}
            onStake={stake}
            onWithdraw={withdraw}
            onRequireLogin={() => requestCourseLogin('stake')}
            talks={talks}
            shareTitle={shareTitle}
            shareSlugOrId={shareSlugOrId}
          />
          {isAuthor && onOpenAuthorSeed ? (
            <Button
              block
              style={{ marginTop: 8 }}
              onClick={() => onOpenAuthorSeed()}
            >
              {t(authorSeedCtaKey(current.status))}
            </Button>
          ) : null}
          {courseKeepAliveNeeded(board) && gameId && !isAuthor ? (
            <Text type="warning" style={{ fontSize: 12 }}>
              {t('product.obs.course.keepAlive')}
            </Text>
          ) : null}
          {board?.queued ? <CourseQueuedPreview queued={board.queued} /> : null}
          {!isAuthor && gameId ? (
            <CourseWatchButton
              gameId={gameId}
              watching={board?.watching ?? false}
              compact
              isAuthenticated={canStake}
              onRequireLogin={() => requestCourseLogin('watch')}
              onWatchingChange={patchWatching}
            />
          ) : null}
        </>
      )}
      {history.length > 0 ? (
        <Space
          id={COURSE_HISTORY_ID}
          orientation="vertical"
          size={2}
          style={{ width: '100%' }}
        >
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('product.obs.course.history')}
          </Text>
          {history.slice(0, 3).map((row) => (
            <div key={row.id} className="og-course-history-row">
              <Text style={{ fontSize: 12 }}>
                {row.canon
                  ?? (row.voidReason
                    ? t(courseVoidReasonKey(row.voidReason), {
                        reason: row.voidReason,
                      })
                    : row.prompt)}
              </Text>
              {shareTitle && shareSlugOrId ? (
                <Button
                  type="link"
                  size="small"
                  className="og-course-history-row__share"
                  onClick={() => {
                    const url = courseDeepLinkUrl(shareSlugOrId);
                    const text = buildCourseHistoryShareText({
                      title: shareTitle,
                      prompt: row.prompt,
                      canon: row.canon,
                      url,
                      t,
                    });
                    void navigator.clipboard?.writeText(text).then(
                      () => message.success(t('product.obs.course.share.copied')),
                      () => message.warning(t('product.obs.course.share.fail')),
                    );
                    trackCourseEvent('course_share', {
                      result: 'history',
                      slug: shareSlugOrId,
                    });
                  }}
                >
                  {t('product.obs.course.historyShare')}
                </Button>
              ) : null}
            </div>
          ))}
        </Space>
      ) : null}
      <CourseNotifySettings />
    </div>
  );
};

function CourseCard({
  current,
  canStake,
  askLogin,
  isAuthor,
  busy,
  stakePoints,
  nowMs,
  flashOptionId,
  highlightFirstOption,
  onStakePoints,
  onStake,
  onWithdraw,
  onRequireLogin,
  talks,
  shareTitle,
  shareSlugOrId,
}: {
  readonly current: CourseView;
  readonly canStake: boolean;
  readonly askLogin: boolean;
  readonly isAuthor: boolean;
  readonly busy: string | null;
  readonly stakePoints: number;
  readonly nowMs: number;
  readonly flashOptionId: string | null;
  readonly highlightFirstOption?: boolean;
  readonly onStakePoints: (n: number) => void;
  readonly onStake: (optionId: string) => void;
  readonly onWithdraw: () => void;
  readonly onRequireLogin: () => void;
  readonly talks: readonly TalkLine[];
  readonly shareTitle?: string;
  readonly shareSlugOrId?: string;
}): React.ReactElement {
  const { t } = useT();
  const act = courseActIndex(current, nowMs);
  const bettingOpen = current.status === 'open' && act === 1;
  const canAdd = canStake && bettingOpen && current.addSteps.length > 0;
  const steps = current.addSteps.length > 0 ? current.addSteps : [current.minStake];
  const evidence = courseEvidencePreview(current, talks);
  const evidenceByOption = new Map(
    evidence.map((row) => [row.optionId, row] as const),
  );
  const hitIds = new Set(
    evidence.filter((row) => row.hits > 0).map((row) => row.optionId),
  );
  const leadId = evidence.find((row) => row.leading)?.optionId ?? null;
  const inEvidence = courseInEvidencePhase({
    status: current.status,
    bettingClosesAt: current.bettingClosesAt,
    nowMs,
  });
  const stakedKey = courseStakedEvidenceKey({
    inEvidence,
    myOptionId: current.myOptionId,
    myPoints: current.myPoints,
    leadingOptionId: leadId,
    hitsByOption: Object.fromEntries(
      evidence.map((row) => [row.optionId, row.hits]),
    ),
  });
  const quietKey = courseEvidenceQuietWarning({
    status: current.status,
    evidenceHealth: current.evidenceHealth,
    opensAt: current.opensAt,
    bettingClosesAt: current.bettingClosesAt,
    nowMs,
  })
    ? courseEvidenceQuietKey({
        status: current.status,
        opensAt: current.opensAt,
        bettingClosesAt: current.bettingClosesAt,
        nowMs,
      })
    : null;
  const primaryNoteKey = courseActPrimaryNoteKey({
    view: current,
    isAuthor,
    inEvidence,
    stakedEvidenceKey: stakedKey,
    evidenceQuietKey: quietKey,
    nowMs,
  });
  const mine = current.options.find((row) => row.id === current.myOptionId);
  return (
    <div className="og-course-board">
      <p className="og-course-board__prompt">{current.prompt}</p>
      <p className="og-course-board__meta">
        {t('product.obs.course.pool', { n: String(current.pool) })}
        {current.myPoints > 0
          ? ` · ${t('product.obs.course.myStake', { n: String(current.myPoints) })}`
          : ''}
        {` · ${
          current.contested
            ? t('product.obs.course.rakeHint')
            : t('product.obs.course.needOpponentInvite')
        }`}
      </p>
      {primaryNoteKey ? (
        <p
          className={`og-course-board__note og-course-board__act-note${
            courseGuestReachabilityWarning({
              status: current.status,
              reachability: current.reachability,
              isAuthor,
            })
              ? ' og-course-board__warn'
              : ''
          }`}
        >
          {t(primaryNoteKey, { label: mine?.label ?? '' })}
        </p>
      ) : null}
      {act === 3 ? (
        <CourseSettlementCard
          current={current}
          shareTitle={shareTitle}
          shareSlugOrId={shareSlugOrId}
        />
      ) : null}
      {act === 2 && courseEvidenceHealthKey(current.evidenceHealth) ? (
        <p
          className={`og-course-board__evidence is-${current.evidenceHealth ?? 'living'}`}
        >
          {t(courseEvidenceHealthKey(current.evidenceHealth)!)}
        </p>
      ) : null}
      <details className="og-course-board__details">
        <summary>{t('product.obs.course.howShow')}</summary>
        {isAuthor && courseSeedSourceKey(current.seedSource) ? (
          <p className="og-course-board__note">
            {t(courseSeedSourceKey(current.seedSource)!)}
            {courseReachabilityDeskKey(current.reachability)
              ? ` · ${t(courseReachabilityDeskKey(current.reachability)!)}`
              : ''}
          </p>
        ) : null}
        {current.mutedHint ? (
          <p className="og-course-board__note">{t('product.obs.course.muteHint')}</p>
        ) : null}
        {isAuthor ? (
          <p className="og-course-board__note">
            {t('product.obs.course.authorNoStake')}
            {current.contested && (current.authorRakeIfSettled ?? 0) > 0
              ? ` · ${t('product.obs.course.authorRake', {
                  n: String(current.authorRakeIfSettled),
                })}`
              : ''}
          </p>
        ) : null}
        <div className="og-course-desk__rules">
          <span>{t('product.obs.course.how1')}</span>
          <span>{t('product.obs.course.how2')}</span>
          <span>{t('product.obs.course.how3')}</span>
        </div>
      </details>
      {current.canWithdraw ? (
        <Space wrap size={6}>
          <span className="og-course-board__note">
            {t('product.obs.course.withdrawHint')}
          </span>
          {canStake ? (
            <Button size="small" loading={busy === 'withdraw'} onClick={onWithdraw}>
              {t('product.obs.course.withdraw')}
            </Button>
          ) : askLogin ? (
            <Button size="small" onClick={onRequireLogin}>
              {t('product.obs.course.withdraw')}
            </Button>
          ) : null}
        </Space>
      ) : null}
      {act === 2 && !isAuthor ? (
        <Space wrap size={6}>
          <span className="og-course-board__note">
            {t('product.obs.course.closedNext')}
          </span>
          <Button
            type="link"
            size="small"
            className="og-course-desk__how"
            onClick={() => scrollToWhisperDesk()}
          >
            {t('product.obs.course.goBlow')}
          </Button>
        </Space>
      ) : null}
      {askLogin && bettingOpen ? (
        <p className="og-course-board__note og-course-guest-preview-hint">
          {t('product.obs.course.guestPreviewHint', {
            n: String(stakePoints),
          })}
        </p>
      ) : null}
      {askLogin && bettingOpen ? (
        <Button type="primary" block onClick={onRequireLogin}>
          {t('product.obs.course.guestCoach.loginCta', { n: String(stakePoints) })}
        </Button>
      ) : null}
      {canStake && bettingOpen && current.addSteps.length === 0 && current.myPoints > 0 ? (
        <p className="og-course-board__note">{t('product.obs.course.shareFull')}</p>
      ) : null}
      {canAdd ? (
        <div
          className="og-course-board__stakes"
          role="radiogroup"
          aria-label={t('product.obs.course.stakesAria')}
        >
          <span className="og-course-board__stakes-label">
            {t('product.obs.course.add')}
          </span>
          {steps.map((n) => (
            <Button
              key={n}
              type={stakePoints === n ? 'primary' : 'default'}
              onClick={() => onStakePoints(n)}
              role="radio"
              aria-checked={stakePoints === n}
              aria-label={t('product.obs.course.stepAria', { n: String(n) })}
            >
              {t('product.obs.course.step', { n: String(n) })}
            </Button>
          ))}
          <p className="og-course-board__note">{t('product.obs.course.stakePriority')}</p>
        </div>
      ) : null}
      {(canAdd || (askLogin && bettingOpen) || act === 2 || act === 3)
        ? current.options.map((option, optionIndex) => {
        const pct = Math.round(option.share * 100);
        const mine = current.myOptionId === option.id;
        const cta = courseStakeCtaLine(t, {
          stake: stakePoints,
          pool: current.pool,
          optionPoints: option.points,
        });
        const hit = hitIds.has(option.id);
        const leading = leadId === option.id;
        const evidenceRow = evidenceByOption.get(option.id);
        return (
          <div
            key={option.id}
            className={`og-course-option${mine ? ' is-mine' : ''}${hit ? ' is-hit' : ''}${leading ? ' is-leading' : ''}${flashOptionId === option.id ? ' is-flash' : ''}${highlightFirstOption && optionIndex === 0 && canAdd ? ' is-onboarding-target' : ''}`}
          >
            <div className="og-course-option__top">
              <span className="og-course-option__label">
                {option.label}
                {mine ? ` · ${t('product.obs.course.yourSide')}` : ''}
              </span>
              <span className="og-course-option__share">
                {option.points}
                {pct > 0 ? ` · ${pct}%` : ''}
              </span>
            </div>
            {option.winHint ? (
              <p className="og-course-board__note">
                {t('product.obs.course.modal.win')}
                {option.winHint}
              </p>
            ) : null}
            {hit ? (
              <p className="og-course-board__note og-course-option__hit">
                {evidenceRow && evidenceRow.hits > 1
                  ? t('product.obs.course.optionHits', {
                      n: String(evidenceRow.hits),
                    })
                  : t('product.obs.course.optionHit')}
              </p>
            ) : leading ? (
              <p className="og-course-board__note og-course-option__hit">
                {t('product.obs.course.optionLead')}
              </p>
            ) : null}
            <div className="og-course-option__bar" aria-hidden>
              <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
            </div>
            {canAdd ? (
              <Button
                block
                type={mine ? 'primary' : 'default'}
                disabled={Boolean(current.myOptionId) && !mine}
                loading={busy === option.id}
                onClick={() => onStake(option.id)}
                aria-label={t('product.obs.course.stakeOptionAria', {
                  option: option.label,
                  stake: String(stakePoints),
                })}
              >
                {cta}
              </Button>
            ) : askLogin && bettingOpen ? (
              <Button block type="default" onClick={onRequireLogin}>
                {cta}
              </Button>
            ) : null}
          </div>
        );
      })
        : null}
      {(current.hangs ?? []).length > 0 ? (
        <Space orientation="vertical" size={2} style={{ width: '100%' }}>
          <span className="og-course-board__note">
            {t('product.obs.course.blowing')}
          </span>
          {(current.hangs ?? []).slice(0, 4).map((hang, i) => (
            <Text key={`${hang.optionId}-${i}`} style={{ fontSize: 12 }}>
              {t('product.obs.course.stakedSaid', { label: hang.label })}
              {` · ${hang.authorName}`}
              {hang.paid ? ` · ${hang.text.slice(0, 24)}` : ''}
            </Text>
          ))}
        </Space>
      ) : null}
    </div>
  );
}
