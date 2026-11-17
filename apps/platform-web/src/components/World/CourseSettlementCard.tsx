/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { Button, Popover, Tooltip } from 'antd';
import { InfoCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';

import {
  courseSettlementState,
  courseSettlementTitleKey,
  courseVoidReasonKey,
  previewCoursePayout,
} from '@opengame/platform-shared';

import type { CourseView } from '../../services/api';
import { useT } from '../../services/i18n';
import { featureFlags } from '../../utils/featureFlags';
import { CourseShareButton } from './CourseShareButton';
import { scrollToCourseHistory } from './societyTownTimeDesk';

export const CourseSettlementCard: React.FC<{
  readonly current: CourseView;
  readonly shareTitle?: string;
  readonly shareSlugOrId?: string;
}> = ({ current, shareTitle, shareSlugOrId }) => {
  const { t } = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const state = courseSettlementState(current);
  const titleKey = courseSettlementTitleKey(state);

  useEffect(() => {
    if (!titleKey || state === 'pending') return;
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [titleKey, state, current.id]);

  if (!titleKey || state === 'pending') return null;

  const mine = current.options.find((row) => row.id === current.myOptionId);
  const winner = current.options.find(
    (row) => row.id === current.winningOptionId,
  );
  const preview =
    state === 'win' && mine
      ? previewCoursePayout({
          pool: current.pool,
          optionPoints: mine.points,
          stake: current.myPoints,
        })
      : null;

  const voidLine = current.voidReason
    ? t(courseVoidReasonKey(current.voidReason), {
        reason: current.voidReason,
      })
    : null;

  // 分彩公式所需的展示数据（（（仅 v2 开启时用）））
  const myOptionRow = current.options.find((row) => row.id === current.myOptionId);
  const stake = current.myPoints;
  const winningPool = current.pool;
  const share = stake > 0 && winningPool > 0
    ? Math.round((stake / winningPool) * 100)
    : 0;

  return (
    <div
      ref={rootRef}
      className={`og-course-settlement is-${state}`}
      role="region"
      aria-live="polite"
      aria-label={t(titleKey ?? 'product.obs.course.settlement.titleFallback')}
    >
      <p className="og-course-settlement__title">{t(titleKey)}</p>
      {state === 'void' && voidLine ? (
        featureFlags.courseUxV2 ? (
          <Popover
            trigger="click"
            content={
              <div style={{ maxWidth: 240 }}>
                <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600 }}>
                  {t('product.obs.course.rules.title')}
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                  <li>{t('product.obs.course.rules.l1')}</li>
                  <li>{t('product.obs.course.rules.l2')}</li>
                  <li>{t('product.obs.course.rules.l3')}</li>
                </ul>
              </div>
            }
          >
            <Button
              type="link"
              size="small"
              icon={<QuestionCircleOutlined />}
              className="og-course-settlement__note"
            >
              {voidLine}
            </Button>
          </Popover>
        ) : (
          <p className="og-course-settlement__note">{voidLine}</p>
        )
      ) : null}
      {state === 'win' && preview ? (
        featureFlags.courseUxV2 && myOptionRow ? (
          <Tooltip
            mouseEnterDelay={0.3}
            title={
              <div style={{ maxWidth: 260 }}>
                <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 600 }}>
                  {t('product.obs.course.payoutFormula.title')}
                </p>
                <p style={{ margin: '0 0 2px', fontSize: 12 }}>
                  {t('product.obs.course.payoutFormula.line1', {
                    stake: String(stake),
                    pool: String(winningPool),
                    share: String(share),
                  })}
                </p>
                <p style={{ margin: '0 0 2px', fontSize: 12 }}>
                  {t('product.obs.course.payoutFormula.line2')}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
                  {t('product.obs.course.payoutFormula.cap')}
                </p>
              </div>
            }
          >
            <Button
              type="link"
              size="small"
              icon={<InfoCircleOutlined />}
              className="og-course-settlement__note"
            >
              {t('product.obs.course.settlement.payout', {
                n: String(preview.payout),
              })}
            </Button>
          </Tooltip>
        ) : (
          <p className="og-course-settlement__note">
            {t('product.obs.course.settlement.payout', {
              n: String(preview.payout),
            })}
          </p>
        )
      ) : null}
      {state === 'lose' && winner ? (
        <p className="og-course-settlement__note">{winner.label}</p>
      ) : null}
      {current.canon ? (
        <p className="og-course-settlement__canon">
          {t('product.obs.course.settlement.canon', { canon: current.canon })}
        </p>
      ) : null}
      <div className="og-course-settlement__actions">
        <Button
          size="small"
          type="link"
          onClick={() => scrollToCourseHistory()}
          aria-label={t('product.obs.course.settlement.viewHistoryAria')}
        >
          {t('product.obs.course.settlement.viewHistory')}
        </Button>
        {shareTitle && shareSlugOrId ? (
          <CourseShareButton
            title={shareTitle}
            slugOrId={shareSlugOrId}
            prompt={current.prompt}
            pool={current.pool}
            status={current.status}
            bettingClosesAt={current.bettingClosesAt}
            canon={current.canon}
            withPoster
          />
        ) : null}
      </div>
    </div>
  );
};
