/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Typography, Progress, Spin, Empty, Alert, Collapse, Tag } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import type { AgentEventRow } from '../../types';
import type { GenerationState, JobLifecycleStatus } from '../../hooks/useGeneration';
import { useT } from '../../services/i18n';
import {
  collapseHeartbeatEvents,
  eventToPlainLine,
  extractProgressMeta,
  formatElapsedSec,
  formatEventTime,
  getActiveJobEvents,
  getEffectivePhase,
  phaseToHeadline,
  phaseToProgressPercent,
} from '../../utils/generationProgressText';
import {
  activeStepId,
  collectPipelineStagePayload,
  derivePipelineSteps,
  pipelineVisualPercent,
} from '../../utils/creationPipeline';
import { CreationPipelineRail } from './CreationPipelineRail';
import { CreationStepStage } from './CreationStepStage';
import {
  defaultJobPointCost,
  estimateJobRemainMinutes,
} from '../../utils/jobEta';

const { Text, Paragraph } = Typography;

interface GenerationProgressFeedProps {
  readonly agentEvents: AgentEventRow[];
  readonly generationState: GenerationState;
  readonly isLoading: boolean;
  readonly jobLifecycleStatus: JobLifecycleStatus;
  readonly queuedTimeoutHint: boolean;
  readonly generationMode?: 'game' | 'world';
  readonly activeJobId?: string | null;
  readonly previewUrl?: string | null;
  /** Other queued/running jobs in this project (for accurate queue headlines). */
  readonly liveProjectJobs?: Array<{ id: string; status: string; type?: string }>;
  /** Jobs running on other projects. The worker handles one at a time. */
  readonly runningElsewhere?: number;
  readonly jobType?: string | null;
  readonly jobStartedAt?: string | null;
  readonly jobCosts?: Record<string, number>;
}

export const GenerationProgressFeed: React.FC<GenerationProgressFeedProps> = ({
  agentEvents,
  generationState,
  isLoading,
  jobLifecycleStatus,
  queuedTimeoutHint,
  generationMode = 'game',
  activeJobId = null,
  previewUrl = null,
  liveProjectJobs = [],
  runningElsewhere = 0,
  jobType = null,
  jobStartedAt = null,
  jobCosts = {},
}) => {
  const { t } = useT();
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const jobEvents = useMemo(
    () => getActiveJobEvents(agentEvents, activeJobId),
    [agentEvents, activeJobId],
  );
  const latestPhase = useMemo(() => getEffectivePhase(jobEvents), [jobEvents]);
  const meta = useMemo(() => extractProgressMeta(jobEvents), [jobEvents]);
  const displayEvents = useMemo(
    () => collapseHeartbeatEvents(jobEvents),
    [jobEvents],
  );
  const steps = useMemo(
    () =>
      derivePipelineSteps(jobEvents, generationMode, {
        failed: generationState === 'error' || latestPhase === 'FAIL',
        hasPreview: Boolean(previewUrl) || generationState === 'preview',
      }),
    [jobEvents, generationMode, generationState, latestPhase, previewUrl],
  );
  const stagePayload = useMemo(
    () => collectPipelineStagePayload(jobEvents, activeJobId),
    [jobEvents, activeJobId],
  );
  const currentStep = activeStepId(steps);

  const queueHint = useMemo(() => {
    const peers = liveProjectJobs.filter((j) => j.id !== activeJobId);
    return {
      runningPeers:
        peers.filter((j) => j.status === 'running').length + runningElsewhere,
      queuedPeers: peers.filter((j) => j.status === 'queued').length +
        (jobLifecycleStatus === 'queued' ? 1 : 0),
    };
  }, [liveProjectJobs, activeJobId, jobLifecycleStatus, runningElsewhere]);

  let headline = phaseToHeadline(
    latestPhase,
    generationState,
    isLoading,
    t,
    jobLifecycleStatus,
    generationMode,
    queueHint,
    { smokeOk: meta.smokeOk, playable: meta.playable },
  );
  if (
    isLoading &&
    (latestPhase === 'CODE' ||
      latestPhase === 'FIX' ||
      latestPhase === 'ITERATE' ||
      latestPhase === 'BUILD')
  ) {
    if (meta.cliSummary) {
      headline = t('generate.progress.cli', { line: meta.cliSummary });
    } else if (meta.heartbeatSummary) {
      headline = meta.heartbeatSummary;
    }
  }

  const percent = pipelineVisualPercent(
    steps,
    phaseToProgressPercent(latestPhase),
  );
  const isFailed = generationState === 'error' || latestPhase === 'FAIL';
  const isDone = !isLoading && generationState === 'preview';
  const showActive = isLoading && !isFailed;

  const waitingHint =
    jobLifecycleStatus === 'queued'
      ? t('generate.progress.statusQueued')
      : jobLifecycleStatus === 'running'
        ? t('generate.progress.statusRunning')
        : t('generate.progress.waitingEvents');

  useEffect(() => {
    if (logOpen) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [displayEvents.length, logOpen]);

  if (!isLoading && jobEvents.length === 0 && generationState === 'idle') {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          generationMode === 'world'
            ? t('generate.progress.emptyIdleWorld')
            : t('generate.progress.emptyIdle')
        }
        style={{ margin: '12px 0' }}
      />
    );
  }

  const progressStatus = isFailed
    ? 'exception'
    : isDone
      ? 'success'
      : showActive
        ? 'active'
        : 'normal';
  const displayPercent = isFailed
    ? Math.max(percent, 5)
    : isDone
      ? 100
      : showActive
        ? Math.max(percent, 8)
        : percent;
  const accent = generationMode === 'world' ? 'var(--color-teal)' : 'var(--color-ember)';
  const inferredJobType =
    jobType ??
    liveProjectJobs.find((j) => j.id === activeJobId)?.type ??
    (generationMode === 'world' ? 'world_generate' : 'generate');
  const remainEta = estimateJobRemainMinutes({
    lifecycle: jobLifecycleStatus,
    percent: displayPercent,
    jobType: inferredJobType,
    startedAt: jobStartedAt,
  });
  const remainPoints =
    jobCosts[inferredJobType] ?? defaultJobPointCost(inferredJobType);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 200 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {showActive ? (
          <Spin indicator={<LoadingOutlined style={{ fontSize: 18 }} spin />} />
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Paragraph strong style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
            {headline}
          </Paragraph>
          <SpaceMeta
            provider={meta.provider}
            model={meta.model}
            attempt={meta.attempt}
            maxAttempts={meta.maxAttempts}
            heartbeatSec={meta.heartbeatSec}
            cliTimeoutMs={meta.cliTimeoutMs}
            keyHint={meta.keyHint}
            keyRotated={meta.keyRotated}
            poolSize={meta.poolSize}
            t={t}
          />
        </div>
      </div>

      {(showActive || jobEvents.length > 0) && (
        <CreationPipelineRail steps={steps} accent={accent} />
      )}

      {(showActive || jobEvents.length > 0) && (
        <CreationStepStage
          activeStepId={currentStep}
          payload={stagePayload}
          previewUrl={previewUrl}
          generationMode={generationMode}
        />
      )}

      <Progress
        percent={displayPercent}
        status={progressStatus}
        strokeColor={
          isFailed ? '#ef4444' : isDone ? '#22c55e' : accent
        }
        size="small"
      />

      {showActive && remainEta.remainMin > 0 ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('generate.progress.remainMin', { min: remainEta.remainMin })}
          {remainPoints > 0
            ? ` · ${t('generate.progress.remainPoints', { points: remainPoints })}`
            : ''}
        </Text>
      ) : null}

      {queuedTimeoutHint ? (
        <Alert
          type="warning"
          showIcon
          message={
            runningElsewhere > 0
              ? t('generate.progress.queuedBehindOther', { count: runningElsewhere })
              : t('generate.progress.queuedTimeout')
          }
        />
      ) : null}

      {showActive && meta.heartbeatSec >= 180 ? (
        <Alert
          type="warning"
          showIcon
          message={t('generate.progress.cliHangHint', {
            secs: String(meta.heartbeatSec),
          })}
        />
      ) : null}

      {isFailed ? (
        <Text type="danger" style={{ fontSize: 12 }}>
          {generationMode === 'world'
            ? t('generate.progress.failHintWorld')
            : t('generate.progress.failHint')}
        </Text>
      ) : null}

      <Collapse
        size="small"
        activeKey={logOpen ? ['log'] : []}
        onChange={(keys) => setLogOpen(keys.includes('log'))}
        items={[
          {
            key: 'log',
            label: t('generate.pipeline.logToggle'),
            children: (
              <div
                style={{
                  maxHeight: 180,
                  overflowY: 'auto',
                  borderRadius: 6,
                  background: 'rgba(99, 102, 241, 0.04)',
                  padding: '8px 10px',
                }}
              >
                {displayEvents.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {waitingHint}
                  </Text>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {displayEvents.map((evt) => {
                      const line = eventToPlainLine(evt, t);
                      const failed = evt.phase === 'FAIL';
                      return (
                        <div
                          key={evt.id}
                          style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'flex-start',
                            fontSize: 12,
                            lineHeight: 1.45,
                          }}
                        >
                          <Text
                            type="secondary"
                            style={{ fontSize: 11, flexShrink: 0, minWidth: 58 }}
                          >
                            {formatEventTime(evt.createdAt)}
                          </Text>
                          <Text style={{ color: failed ? '#ef4444' : undefined }}>
                            {line}
                          </Text>
                        </div>
                      );
                    })}
                    <div ref={logEndRef} />
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
};

function SpaceMeta({
  provider,
  model,
  attempt,
  maxAttempts,
  heartbeatSec,
  cliTimeoutMs,
  keyHint,
  keyRotated,
  poolSize,
  t,
}: {
  provider: string | null;
  model: string | null;
  attempt: number | null;
  maxAttempts: number | null;
  heartbeatSec: number;
  cliTimeoutMs: number | null;
  keyHint: string | null;
  keyRotated: boolean;
  poolSize: number | null;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  if (!provider && attempt == null && heartbeatSec <= 0 && !keyHint) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
      {provider ? (
        <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
          {t('generate.pipeline.provider', { provider })}
          {model ? ` · ${model}` : ''}
        </Tag>
      ) : null}
      {keyHint ? (
        <Tag color={keyRotated ? 'orange' : 'default'} style={{ margin: 0, fontSize: 11 }}>
          {t('generate.pipeline.keyHint', { hint: keyHint })}
          {poolSize && poolSize > 1 ? ` · ${poolSize}` : ''}
        </Tag>
      ) : null}
      {attempt != null && maxAttempts != null ? (
        <Tag style={{ margin: 0, fontSize: 11 }}>
          {t('generate.pipeline.attempt', { attempt, max: maxAttempts })}
        </Tag>
      ) : null}
      {heartbeatSec > 0 ? (
        <Tag style={{ margin: 0, fontSize: 11 }}>
          {t('generate.pipeline.elapsed', {
            time: formatElapsedSec(heartbeatSec),
          })}
          {cliTimeoutMs
            ? ` / ${formatElapsedSec(Math.round(cliTimeoutMs / 1000))}`
            : ''}
        </Tag>
      ) : null}
    </div>
  );
}
