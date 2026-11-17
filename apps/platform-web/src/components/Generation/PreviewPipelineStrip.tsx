/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compact pipeline rail for LivePreview empty state (no full log).
 */

import React, { useMemo } from 'react';
import { Tag } from 'antd';
import type { AgentEventRow } from '../../types';
import type { GenerationState } from '../../hooks/useGeneration';
import { useT } from '../../services/i18n';
import {
  extractProgressMeta,
  formatElapsedSec,
  getEffectivePhase,
} from '../../utils/generationProgressText';
import {
  derivePipelineSteps,
} from '../../utils/creationPipeline';
import { getActiveJobEvents } from '../../utils/generationProgressText';
import { CreationPipelineRail } from './CreationPipelineRail';
import { elapsedSecSince } from '../../utils/generationResume';
import { estimateJobRemainMinutes } from '../../utils/jobEta';

interface PreviewPipelineStripProps {
  readonly agentEvents: AgentEventRow[];
  readonly activeJobId?: string | null;
  readonly generationState: GenerationState;
  readonly generationMode?: 'game' | 'world';
  readonly startedAt?: string | null;
  readonly resumePercent?: number;
}

export const PreviewPipelineStrip: React.FC<PreviewPipelineStripProps> = ({
  agentEvents,
  activeJobId = null,
  generationState,
  generationMode = 'game',
  startedAt = null,
  resumePercent = 0,
}) => {
  const { t } = useT();
  const jobEvents = useMemo(
    () => getActiveJobEvents(agentEvents, activeJobId),
    [agentEvents, activeJobId],
  );
  const phase = useMemo(() => getEffectivePhase(jobEvents), [jobEvents]);
  const meta = useMemo(() => extractProgressMeta(jobEvents), [jobEvents]);
  const steps = useMemo(
    () =>
      derivePipelineSteps(jobEvents, generationMode, {
        failed: generationState === 'error' || phase === 'FAIL',
      }),
    [jobEvents, generationMode, generationState, phase],
  );
  if (jobEvents.length === 0) {
    if (!startedAt && resumePercent <= 0) return null;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {resumePercent > 0 ? (
          <Tag color={generationMode === 'world' ? '#2A9D8F' : '#C45C26'} style={{ margin: 0, fontSize: 11 }}>
            {resumePercent}%
          </Tag>
        ) : null}
        {startedAt ? (
          <Tag style={{ margin: 0, fontSize: 11 }}>
            {t('generate.pipeline.elapsed', {
              time: formatElapsedSec(elapsedSecSince(startedAt)),
            })}
          </Tag>
        ) : null}
        {startedAt ? (
          <Tag style={{ margin: 0, fontSize: 11 }}>
            {t('generate.progress.remainMin', {
              min: estimateJobRemainMinutes({
                lifecycle: 'queued',
                jobType: generationMode === 'world' ? 'world_generate' : 'generate',
                startedAt,
              }).remainMin,
            })}
          </Tag>
        ) : null}
      </div>
    );
  }
  const accent = generationMode === 'world' ? 'var(--color-teal)' : 'var(--color-ember)';
  const active = steps.find(
    (s) => s.status === 'active' || s.status === 'degraded' || s.status === 'failed',
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <CreationPipelineRail steps={steps} accent={accent} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {active ? (
          <Tag color={generationMode === 'world' ? '#2A9D8F' : '#C45C26'} style={{ margin: 0, fontSize: 11 }}>
            {t(active.labelKey)}
            {active.note === 'imageFailover'
              ? ` · ${t('generate.pipeline.note.imageFailover')}`
              : active.note === 'audioSoftSkip'
                ? ` · ${t('generate.pipeline.note.audioSoftSkip')}`
                : active.note === 'previewUnplayable'
                  ? ` · ${t('generate.pipeline.note.previewUnplayable')}`
                  : ''}
          </Tag>
        ) : null}
        {meta.provider ? (
          <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
            {t('generate.pipeline.provider', { provider: meta.provider })}
          </Tag>
        ) : null}
        {meta.keyHint ? (
          <Tag
            color={meta.keyRotated ? 'orange' : 'default'}
            style={{ margin: 0, fontSize: 11 }}
          >
            {t('generate.pipeline.keyHint', { hint: meta.keyHint })}
          </Tag>
        ) : null}
        {meta.archetype ? (
          <Tag style={{ margin: 0, fontSize: 11 }}>{meta.archetype}</Tag>
        ) : null}
        {meta.heartbeatSec > 0 ? (
          <Tag style={{ margin: 0, fontSize: 11 }}>
            {t('generate.pipeline.elapsed', {
              time: formatElapsedSec(meta.heartbeatSec),
            })}
          </Tag>
        ) : null}
        <Tag style={{ margin: 0, fontSize: 11 }}>
          {t('generate.progress.remainMin', {
            min: estimateJobRemainMinutes({
              lifecycle: 'running',
              jobType: generationMode === 'world' ? 'world_generate' : 'generate',
              startedAt,
              percent: resumePercent || 35,
            }).remainMin,
          })}
        </Tag>
      </div>
    </div>
  );
};
