/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Space, Typography, message } from 'antd';

import { courseActIndex, courseCanAuthorReplace, courseCanAuthorQueue } from '@opengame/platform-shared';

import {
  api,
  type CourseBoard,
  type CourseSeedBody,
} from '../../services/api';
import { useT } from '../../services/i18n';
import {
  coursePhaseCopyKey,
  courseDeskClockLine,
} from './SocietyTownCourseDesk';
import { CourseAuthorStatsStrip } from './CourseAuthorStatsStrip';
import { CourseQueuedPreview } from './CourseQueuedPreview';
import { CourseRecommendPreviewCard } from './CourseRecommendPreviewCard';
import { trackCourseEvent } from './courseTelemetry';
import { useCourseRecommendPreview } from './useCourseRecommendPreview';

const { Text } = Typography;

export const SocietyTownAuthorOpsBar: React.FC<{
  readonly gameId?: string | null;
  readonly projectId?: string | null;
  readonly board: CourseBoard | null;
  readonly paused?: boolean;
  readonly funded?: boolean;
  readonly nowMs?: number;
  readonly onOpenAdvanced?: () => void;
  readonly onOpenFund?: () => void;
  readonly onResumeClock?: () => void;
  readonly onSeeded?: (board: CourseBoard) => void;
  readonly recommendHintKey?: string;
}> = ({
  gameId,
  projectId,
  board,
  paused = false,
  funded = true,
  nowMs = Date.now(),
  onOpenAdvanced,
  onOpenFund,
  onResumeClock,
  onSeeded,
  recommendHintKey,
}) => {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [recommendReload, setRecommendReload] = useState(0);
  const current = board?.current ?? null;
  const act = current ? courseActIndex(current, nowMs) : null;
  const replacePolicy = courseCanAuthorReplace(current);
  const queuePolicy = courseCanAuthorQueue({
    current,
    queued: board?.queued,
  });
  const clock = current ? courseDeskClockLine(t, current, nowMs) : null;
  const canRecommend = !current || replacePolicy.ok;
  const { preview: recommendPreview, loading: recommendLoading, error: recommendError, reload: reloadRecommend } =
    useCourseRecommendPreview({
      enabled: Boolean(gameId || projectId) && canRecommend,
      gameId,
      projectId,
      kind: 'auto',
      reloadKey: recommendReload,
    });

  const seed = (body: CourseSeedBody): void => {
    if (body.queue) {
      if (!queuePolicy.ok) {
        if (queuePolicy.reasonKey) message.warning(t(queuePolicy.reasonKey));
        return;
      }
    } else if (!body.cancelQueue && current && !replacePolicy.ok) {
      trackCourseEvent('author_replace_blocked', {
        reason: replacePolicy.reasonKey ?? 'blocked',
      });
      if (replacePolicy.reasonKey) {
        message.warning(t(replacePolicy.reasonKey));
      }
      return;
    }
    const payload: CourseSeedBody = {
      ...body,
      ...(current && !body.queue && !body.cancelQueue ? { replace: true } : {}),
    };
    setBusy(true);
    const req = gameId
      ? api.community.seedCourse(gameId, payload)
      : projectId
        ? api.community.seedWorldCourse(projectId, payload)
        : null;
    if (!req) {
      setBusy(false);
      return;
    }
    void req
      .then((next) => {
        trackCourseEvent('author_recommend_seed', {
          kind: body.kind ?? 'auto',
          replaced: Boolean(current),
        });
        onSeeded?.(next);
        if (!body.cancelQueue) {
          setRecommendReload((value) => value + 1);
        }
        message.success(
          body.cancelQueue
            ? t('product.obs.course.queue.cancelled')
            : body.queue
              ? t('product.obs.course.queue.saved')
              : t('product.obs.course.seeded'),
        );
      })
      .catch((err: unknown) => {
        const raw =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message?: string }).message ?? '')
            : '';
        const key = `product.obs.course.err.${raw}`;
        const localized = t(key);
        message.error(localized !== key ? localized : raw || 'seed failed');
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="og-course-author-ops">
      <Space wrap size={8} className="og-course-author-ops__meta">
        {paused ? (
          <button
            type="button"
            className="og-course-author-ops__chip is-warn"
            onClick={() => onResumeClock?.()}
          >
            {t('product.obs.course.authorOps.paused')}
          </button>
        ) : null}
        {!funded ? (
          <button
            type="button"
            className="og-course-author-ops__chip is-warn"
            onClick={() => onOpenFund?.()}
          >
            {t('product.obs.course.authorOps.lamp')}
          </button>
        ) : null}
        {current ? (
          <span className="og-course-author-ops__chip">
            {t('product.obs.course.authorOps.board')}
            {' · '}
            {act ? t(`product.obs.course.act.${act === 1 ? 'bet' : act === 2 ? 'evidence' : 'result'}`) : t(coursePhaseCopyKey(current.status))}
            {` · ${t('product.obs.course.pool', { n: String(current.pool) })}`}
            {current.contested
              ? ` · ${t('product.obs.course.contested')}`
              : ` · ${t('product.obs.course.needOpponent')}`}
            {clock ? ` · ${clock}` : ''}
          </span>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('product.obs.course.empty')}
          </Text>
        )}
      </Space>
      <Space wrap size={8}>
        <Button
          type="primary"
          size="small"
          loading={busy}
          disabled={
            !canRecommend ||
            recommendLoading ||
            !recommendPreview
          }
          onClick={() => seed({})}
        >
          {t('product.obs.course.authorOps.recommend')}
        </Button>
        {current && queuePolicy.ok ? (
          <Button
            size="small"
            loading={busy}
            disabled={recommendLoading || !recommendPreview}
            onClick={() => seed({ queue: true })}
          >
            {t('product.obs.course.authorOps.queue')}
          </Button>
        ) : null}
        {board?.queued ? (
          <Button
            size="small"
            loading={busy}
            onClick={() => seed({ cancelQueue: true })}
          >
            {t('product.obs.course.authorOps.cancelQueue')}
          </Button>
        ) : null}
        <Button size="small" onClick={() => onOpenAdvanced?.()}>
          {t('product.obs.course.authorOps.advanced')}
        </Button>
      </Space>
      {canRecommend && (recommendLoading || recommendPreview || recommendError) ? (
        <CourseRecommendPreviewCard
          preview={recommendPreview}
          loading={recommendLoading}
          compact
          error={recommendError}
          hintKey="product.obs.course.recommend.empty"
          onRetry={reloadRecommend}
        />
      ) : null}
      {board?.queued ? (
        <CourseQueuedPreview queued={board.queued} />
      ) : null}
      {recommendHintKey && !current ? (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
          {t(recommendHintKey)}
        </Text>
      ) : null}
      {current && !replacePolicy.ok && replacePolicy.reasonKey ? (
        <Text type="warning" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
          {t(replacePolicy.reasonKey)}
        </Text>
      ) : null}
      <CourseAuthorStatsStrip gameId={gameId} projectId={projectId} />
    </div>
  );
};
