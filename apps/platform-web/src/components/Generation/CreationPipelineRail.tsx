/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Tag, Tooltip } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  MinusCircleFilled,
  WarningFilled,
} from '@ant-design/icons';
import { useT } from '../../services/i18n';
import type { PipelineStepView } from '../../utils/creationPipeline';

interface CreationPipelineRailProps {
  readonly steps: PipelineStepView[];
  readonly accent?: string;
}

function StepIcon({
  status,
  accent,
}: {
  status: PipelineStepView['status'];
  accent: string;
}) {
  switch (status) {
    case 'done':
      return <CheckCircleFilled style={{ color: '#22c55e', fontSize: 14 }} />;
    case 'failed':
      return <CloseCircleFilled style={{ color: '#ef4444', fontSize: 14 }} />;
    case 'active':
      return <LoadingOutlined style={{ color: accent, fontSize: 14 }} spin />;
    case 'degraded':
      return <WarningFilled style={{ color: '#f59e0b', fontSize: 14 }} />;
    case 'skipped':
      return <MinusCircleFilled style={{ color: '#94a3b8', fontSize: 14 }} />;
    default:
      return (
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '2px solid var(--border-color)',
            display: 'inline-block',
          }}
        />
      );
  }
}

function connectorColor(
  prev: PipelineStepView['status'],
  next: PipelineStepView['status'],
  accent: string,
): string {
  if (prev === 'failed' || next === 'failed') return '#ef4444';
  if (
    prev === 'done' ||
    prev === 'skipped' ||
    prev === 'degraded' ||
    prev === 'active'
  ) {
    if (next === 'done' || next === 'skipped' || next === 'degraded') {
      return '#22c55e';
    }
    if (next === 'active') return accent;
    return `color-mix(in srgb, ${accent} 53%, transparent)`;
  }
  return 'var(--border-color)';
}

export const CreationPipelineRail: React.FC<CreationPipelineRailProps> = ({
  steps,
  accent = 'var(--color-ember)',
}) => {
  const { t } = useT();
  const doneRatio = useMemo(() => {
    if (steps.length === 0) return 0;
    const n = steps.filter(
      (s) =>
        s.status === 'done' ||
        s.status === 'skipped' ||
        s.status === 'degraded',
    ).length;
    const activeBoost = steps.some((s) => s.status === 'active') ? 0.35 : 0;
    return Math.min(1, (n + activeBoost) / steps.length);
  }, [steps]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          height: 3,
          borderRadius: 999,
          background: 'color-mix(in srgb, var(--border-color) 70%, transparent)',
          overflow: 'hidden',
        }}
        aria-hidden
      >
        <div
          style={{
            height: '100%',
            width: `${Math.round(doneRatio * 100)}%`,
            background: `linear-gradient(90deg, ${accent}, color-mix(in srgb, ${accent} 75%, transparent))`,
            transition: 'width 0.45s ease',
            borderRadius: 999,
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'center',
          padding: '2px 0 4px',
        }}
      >
        {steps.map((step, idx) => {
          const active =
            step.status === 'active' ||
            step.status === 'degraded' ||
            step.status === 'failed';
          const label = t(step.labelKey);
          const tip =
            step.note === 'audioSoftSkip'
              ? t('generate.pipeline.note.audioSoftSkip')
              : step.note === 'imageFailover'
                ? t('generate.pipeline.note.imageFailover')
                : step.note === 'previewUnplayable'
                  ? t('generate.pipeline.note.previewUnplayable')
                  : step.note === 'keyRotated'
                    ? t('generate.pipeline.note.keyRotated')
                    : label;
          const prev = idx > 0 ? steps[idx - 1]! : null;
          return (
            <React.Fragment key={step.id}>
              {prev ? (
                <span
                  style={{
                    width: 14,
                    height: 2,
                    borderRadius: 1,
                    background: connectorColor(prev.status, step.status, accent),
                    transition: 'background 0.35s ease',
                    flexShrink: 0,
                  }}
                />
              ) : null}
              <Tooltip title={tip}>
                <Tag
                  style={{
                    margin: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    borderColor: active ? accent : undefined,
                    boxShadow:
                      step.status === 'active'
                        ? `0 0 0 2px ${accent}22`
                        : undefined,
                    background:
                      step.status === 'active'
                        ? `${accent}18`
                        : step.status === 'degraded'
                          ? 'rgba(245,158,11,0.12)'
                          : step.status === 'failed'
                            ? 'rgba(239,68,68,0.1)'
                            : step.status === 'done'
                              ? 'rgba(34,197,94,0.08)'
                              : undefined,
                    fontWeight: active ? 600 : 400,
                    fontSize: 11,
                    lineHeight: '20px',
                    paddingInline: 6,
                    transition: 'background 0.25s ease, box-shadow 0.25s ease',
                  }}
                >
                  <StepIcon status={step.status} accent={accent} />
                  {label}
                </Tag>
              </Tooltip>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
