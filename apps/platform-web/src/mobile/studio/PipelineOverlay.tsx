/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Progress } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  MinusOutlined,
  WarningFilled,
} from '@ant-design/icons';

import { useT } from '../../services/i18n.js';
import type { AgentEventRow } from '../../types/index.js';
import {
  collectPipelineStagePayload,
  derivePipelineSteps,
  pipelineVisualPercent,
  type PipelineStepView,
} from '../../utils/creationPipeline.js';
import {
  collapseHeartbeatEvents,
  eventToPlainLine,
  formatElapsedSec,
  getActiveJobEvents,
  getEffectivePhase,
  phaseToProgressPercent,
} from '../../utils/generationProgressText.js';
import { elapsedSecSince, type ResumeStepSnap } from '../../utils/generationResume.js';

export interface PipelineOverlayProps {
  readonly events: AgentEventRow[];
  readonly activeJobId: string | null;
  readonly mode: 'game' | 'world';
  readonly failed: boolean;
  readonly hasPreview: boolean;
  readonly queued: boolean;
  readonly queuedTimeoutHint: boolean;
  readonly canCancel: boolean;
  readonly onCancel: () => void;
  /** Send it to the background — the job keeps running server-side. */
  readonly onMinimize: () => void;
  /** job.createdAt so a refresh does not reset the clock. */
  readonly startedAt?: string | null;
  /** Last known percent while agent events are still loading. */
  readonly resumePercent?: number;
  readonly resumeSteps?: readonly ResumeStepSnap[];
}

function stepIcon(status: PipelineStepView['status']): React.ReactNode {
  switch (status) {
    case 'done':
      return <CheckCircleFilled style={{ color: '#22c55e' }} />;
    case 'active':
      return <LoadingOutlined style={{ color: 'var(--color-ember)' }} spin />;
    case 'failed':
      return <CloseCircleFilled style={{ color: '#ef4444' }} />;
    case 'degraded':
      return <WarningFilled style={{ color: '#f59e0b' }} />;
    default:
      return <span className="og-pipeline__dot" />;
  }
}

/**
 * The phone answer to "black box waiting". A desktop user has a whole column of
 * logs next to the preview; a phone user staring at a spinner for four minutes
 * assumes it hung and closes WeChat. So generation takes the whole screen,
 * names the stage it is on, and stays honest about how long it has been there.
 */
export const PipelineOverlay: React.FC<PipelineOverlayProps> = ({
  events,
  activeJobId,
  mode,
  failed,
  hasPreview,
  queued,
  queuedTimeoutHint,
  canCancel,
  onCancel,
  onMinimize,
  startedAt = null,
  resumePercent = 0,
  resumeSteps = [],
}) => {
  const { t } = useT();
  const [elapsedSec, setElapsedSec] = useState(() => elapsedSecSince(startedAt));

  useEffect(() => {
    setElapsedSec(elapsedSecSince(startedAt));
    const id = setInterval(() => {
      setElapsedSec(elapsedSecSince(startedAt));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const jobEvents = useMemo(
    () => getActiveJobEvents(events, activeJobId),
    [events, activeJobId],
  );
  const steps = useMemo(
    () => derivePipelineSteps(jobEvents, mode, { failed, hasPreview }),
    [jobEvents, mode, failed, hasPreview],
  );
  const livePercent = useMemo(
    () =>
      pipelineVisualPercent(
        steps,
        phaseToProgressPercent(getEffectivePhase(jobEvents)),
      ),
    [steps, jobEvents],
  );
  const percent = Math.max(livePercent, resumePercent);
  const displaySteps = useMemo<PipelineStepView[]>(() => {
    if (jobEvents.length > 0) return steps;
    return resumeSteps.map((s) => ({
      id: s.id as PipelineStepView['id'],
      labelKey: s.labelKey,
      status: s.status as PipelineStepView['status'],
      note: null,
    }));
  }, [jobEvents.length, steps, resumeSteps]);
  const payload = useMemo(
    () => collectPipelineStagePayload(jobEvents, activeJobId),
    [jobEvents, activeJobId],
  );
  const recent = useMemo(
    () => collapseHeartbeatEvents(jobEvents).slice(-4).reverse(),
    [jobEvents],
  );

  const assetCount = payload.imageFiles.length + payload.audioFiles.length;

  return (
    <div className="og-pipeline">
      <div className="og-pipeline__head">
        <Button
          type="text"
          size="small"
          icon={<MinusOutlined />}
          onClick={onMinimize}
          aria-label={t('mobile.studio.pipeline.minimize')}
        />
        <span className="og-pipeline__elapsed">{formatElapsedSec(elapsedSec)}</span>
      </div>

      <div className="og-pipeline__body">
        <div className="og-pipeline__ring">
          <Progress
            type="circle"
            percent={percent}
            size={132}
            strokeWidth={8}
            status={failed ? 'exception' : 'active'}
            railColor="var(--og-pipeline-trail)"
            strokeColor={failed ? '#ef4444' : { '0%': '#22d3ee', '100%': '#7c3aed' }}
            format={() => <span className="og-pipeline__pct">{percent}%</span>}
          />
        </div>
        <div className="og-pipeline__headline">
          {queued
            ? t('mobile.studio.pipeline.queued')
            : mode === 'world'
              ? t('mobile.studio.pipeline.buildingWorld')
              : t('mobile.studio.pipeline.buildingGame')}
        </div>
        <p className="og-pipeline__sub">
          {queuedTimeoutHint
            ? t('mobile.studio.pipeline.queuedLong')
            : t('mobile.studio.pipeline.safeToLeave')}
        </p>

        <ol className="og-pipeline__steps">
          {displaySteps.map((s) => (
            <li key={s.id} className={`og-pipeline__step og-pipeline__step--${s.status}`}>
              <span className="og-pipeline__icon">{stepIcon(s.status)}</span>
              <span className="og-pipeline__label">{t(s.labelKey)}</span>
              {s.id === 'assets' && assetCount > 0 && (
                <span className="og-pipeline__note">
                  {t('mobile.studio.pipeline.assetCount', { count: String(assetCount) })}
                </span>
              )}
              {s.note === 'audioSoftSkip' && (
                <span className="og-pipeline__note">
                  {t('mobile.studio.pipeline.audioSkipped')}
                </span>
              )}
            </li>
          ))}
        </ol>

        {recent.length > 0 && (
          <div className="og-pipeline__log">
            {recent.map((evt) => (
              <div key={evt.id} className="og-pipeline__log-line">
                {eventToPlainLine(evt, t)}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="og-pipeline__foot">
        <Button type="primary" block size="large" onClick={onMinimize}>
          {t('mobile.studio.pipeline.background')}
        </Button>
        {canCancel && (
          <Button block danger type="text" onClick={onCancel}>
            {t('mobile.studio.pipeline.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
};

export default PipelineOverlay;
