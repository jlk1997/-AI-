/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button } from 'antd';

import { useT } from '../../services/i18n';
import {
  courseOutcomeToastKey,
  listUnseenCourseOutcomes,
  markCourseOutcomeSeen,
  onCourseOutcomeChanged,
  type CourseOutcomeRecord,
} from './courseOutcomeInbox';
import { scrollToCourseDesk, scrollToCourseHistory, scrollToWhisperDesk } from './societyTownTimeDesk';
import { trackCourseEvent } from './courseTelemetry';
import { useCourseUnwatch } from './useCourseUnwatch';

export const CourseOutcomeBanner: React.FC<{
  readonly gameId: string;
  readonly watching?: boolean;
  readonly isAuthenticated?: boolean;
  readonly onOpenCourse?: () => void;
  readonly onUnwatch?: () => void;
}> = ({
  gameId,
  watching = false,
  isAuthenticated = true,
  onOpenCourse,
  onUnwatch,
}) => {
  const { t } = useT();
  const { unwatch, busyGameId } = useCourseUnwatch();
  const [row, setRow] = useState<CourseOutcomeRecord | null>(null);

  const sync = (): void => {
    const unseen = listUnseenCourseOutcomes(gameId);
    setRow(unseen[0] ?? null);
  };

  useEffect(() => {
    sync();
    const unseen = listUnseenCourseOutcomes(gameId);
    const next = unseen[0] ?? null;
    if (next) {
      trackCourseEvent('course_outcome_banner', {
        kind: next.kind,
        gameId: next.gameId,
      });
    }
    return onCourseOutcomeChanged(sync);
  }, [gameId]);

  if (!row) return null;

  const dismiss = (): void => {
    markCourseOutcomeSeen(row.gameId, row.nodeId);
    setRow(null);
  };

  const open = (): void => {
    dismiss();
    onOpenCourse?.();
    if (row.kind === 'closed') {
      window.setTimeout(() => scrollToWhisperDesk(), 400);
      return;
    }
    if (
      row.kind === 'won'
      || row.kind === 'lost'
      || row.kind === 'voided'
      || row.kind === 'watch_settled'
    ) {
      window.setTimeout(() => scrollToCourseHistory(), 400);
      return;
    }
    scrollToCourseDesk();
  };

  const settleUnwatch = (): void => {
    if (!isAuthenticated) return;
    void unwatch(gameId).then((ok) => {
      if (!ok) return;
      trackCourseEvent('course_watch_settle_unwatch', { gameId });
      dismiss();
      onUnwatch?.();
    });
  };

  const line =
    row.canon?.trim()
      ? t('product.obs.course.settlement.canon', { canon: row.canon.trim() })
      : row.prompt?.trim() ?? t(courseOutcomeToastKey(row.kind));

  const showSettleUnwatch = row.kind === 'watch_settled' && watching && isAuthenticated;

  return (
    <div className={`og-course-outcome-banner is-${row.kind}`}>
      <p className="og-course-outcome-banner__title">
        {t(courseOutcomeToastKey(row.kind))}
      </p>
      <p className="og-course-outcome-banner__note">{line}</p>
      <div className="og-course-outcome-banner__actions">
        <Button size="small" type="primary" onClick={open}>
          {row.kind === 'closed'
            ? t('product.obs.course.outcome.whisper')
            : t('product.obs.course.outcome.view')}
        </Button>
        {showSettleUnwatch ? (
          <Button
            size="small"
            loading={busyGameId === gameId}
            onClick={settleUnwatch}
          >
            {t('product.obs.course.watch.settleUnwatch')}
          </Button>
        ) : null}
        <Button size="small" type="link" onClick={dismiss}>
          {t('product.obs.course.outcome.dismiss')}
        </Button>
      </div>
    </div>
  );
};
