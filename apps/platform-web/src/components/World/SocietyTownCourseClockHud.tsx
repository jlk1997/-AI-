/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Map overlay: town clock + China wall clock for tonight’s board.
 */

import React, { useEffect, useMemo, useState } from 'react';

import { courseActIndex } from '@opengame/platform-shared';

import { type CourseBoard } from '../../services/api';
import { useT } from '../../services/i18n';
import { featureFlags } from '../../utils/featureFlags';
import { coursePromptPreview, courseBoardEmptyKey } from './courseAuthorFlow';
import { CourseActProgressBar } from './CourseActProgressBar';
import { evidenceHitLabels, courseEvidenceHudState } from './courseEvidence';
import {
  courseDeskClockLine,
  coursePhaseCopyKey,
} from './SocietyTownCourseDesk';
import type { TalkLine } from './societyTownStageModel';

export const SocietyTownCourseClockHud: React.FC<{
  readonly townClock: string;
  readonly gameId?: string | null;
  readonly projectId?: string | null;
  readonly talks?: readonly TalkLine[];
  readonly board?: CourseBoard | null;
  readonly offsetTop?: number;
}> = ({
  townClock,
  talks = [],
  board = null,
  offsetTop = 10,
}) => {
  const { t } = useT();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const current = board?.current ?? null;

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const wall = current ? courseDeskClockLine(t, current, nowMs) : null;
  const hud = useMemo(
    () => (current ? courseEvidenceHudState(current, talks) : null),
    [current, talks],
  );
  const act = current ? courseActIndex(current, nowMs) : null;

  if (!featureFlags.courseMarket) return null;

  return (
    <div className="og-town-clock-hud" style={{ top: offsetTop }}>
      <div className="og-town-clock-hud__row">
        <span className="og-town-clock-hud__kicker">
          {t('product.obs.course.clock.town')}
        </span>
        <span>{townClock}</span>
      </div>
      {current ? (
        <>
          <CourseActProgressBar view={current} nowMs={nowMs} compact />
          <div className="og-town-clock-hud__row">
            <span className="og-town-clock-hud__kicker">
              {t('product.obs.course.clock.wall')}
            </span>
            <span>
              {act
                ? t(
                    `product.obs.course.act.${
                      act === 1 ? 'bet' : act === 2 ? 'evidence' : 'result'
                    }`,
                  )
                : t(coursePhaseCopyKey(current.status))}
              {current.prompt
                ? ` · ${coursePromptPreview(current.prompt)}`
                : ''}
              {wall ? ` · ${wall}` : ''}
            </span>
          </div>
        </>
      ) : (
        <div className="og-town-clock-hud__row">
          <span className="og-town-clock-hud__kicker">
            {t('product.obs.course.clock.wall')}
          </span>
          <span>
            {t(
              courseBoardEmptyKey({
                skipReason: board?.skipReason,
              }),
            )}
          </span>
        </div>
      )}
      {hud && hud.hitLabels.length > 0 ? (
        <div className="og-course-hit-flash">
          {t('product.obs.course.hit', { label: hud.hitLabels.join(' / ') })}
        </div>
      ) : hud?.showMuted ? (
        <div className="og-course-hit-flash is-muted">
          {t('product.obs.course.evidenceHealth.muted')}
        </div>
      ) : null}
    </div>
  );
};

export { evidenceHitLabels as evidenceHits } from './courseEvidence';
