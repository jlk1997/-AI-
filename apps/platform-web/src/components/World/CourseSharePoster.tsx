/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';

import {
  courseBettingRemainKey,
  courseBettingRemainMinutes,
  courseBettingRemainVars,
} from '../Community/communityCourseLine';
import { useT } from '../../services/i18n';

export const CourseSharePoster: React.FC<{
  readonly title: string;
  readonly prompt: string;
  readonly pool?: number;
  readonly actKey?: string | null;
  readonly canon?: string | null;
  readonly contested?: boolean;
  readonly bettingClosesAt?: string;
  readonly myStakeLabel?: string | null;
}> = ({
  title,
  prompt,
  pool,
  actKey,
  canon,
  contested,
  bettingClosesAt,
  myStakeLabel,
}) => {
  const { t } = useT();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!bettingClosesAt) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [bettingClosesAt]);

  const remain =
    bettingClosesAt
      ? courseBettingRemainMinutes(
          { status: 'open', bettingClosesAt, settlesAt: bettingClosesAt },
          nowMs,
        )
      : null;
  const remainLine =
    remain != null
      ? t(courseBettingRemainKey(remain), courseBettingRemainVars(remain))
      : null;

  return (
    <div className="og-course-share-poster" aria-hidden={false}>
      <p className="og-course-share-poster__brand">{t('product.obs.course.title')}</p>
      <p className="og-course-share-poster__town">{title}</p>
      {actKey ? (
        <span className="og-course-share-poster__act">{t(actKey)}</span>
      ) : null}
      {remainLine ? (
        <span className="og-course-share-poster__countdown">{remainLine}</span>
      ) : null}
      <p className="og-course-share-poster__prompt">{prompt}</p>
      {myStakeLabel?.trim() ? (
        <p className="og-course-share-poster__staked">
          {t('product.obs.course.share.staked', { side: myStakeLabel.trim() })}
        </p>
      ) : null}
      <div className="og-course-share-poster__meta">
        {typeof pool === 'number' && pool > 0 ? (
          <span>{t('product.obs.course.pool', { n: String(pool) })}</span>
        ) : null}
        <span>
          {contested
            ? t('product.obs.course.contested')
            : t('product.obs.course.needOpponentInvite')}
        </span>
      </div>
      {canon?.trim() ? (
        <p className="og-course-share-poster__canon">
          {t('product.obs.course.settlement.canon', { canon: canon.trim() })}
        </p>
      ) : null}
    </div>
  );
};
