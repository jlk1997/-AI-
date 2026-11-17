/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Alert, Space, Tag, Typography } from 'antd';
import {
  FileOutlined,
  PictureOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { useT } from '../../services/i18n';
import type {
  PipelineStagePayload,
  PipelineStepId,
} from '../../utils/creationPipeline';
import { formatElapsedSec } from '../../utils/generationProgressText';
import { WorldLineageCard } from '../World/WorldLineageCard';

const { Text, Paragraph } = Typography;

interface CreationStepStageProps {
  readonly activeStepId: PipelineStepId | null;
  readonly payload: PipelineStagePayload;
  readonly previewUrl?: string | null;
  readonly generationMode?: 'game' | 'world';
}

function ChipGrid({
  items,
  icon,
  empty,
}: {
  items: string[];
  icon: React.ReactNode;
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        {empty}
      </Text>
    );
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.slice(0, 16).map((f) => (
        <Tag key={f} icon={icon} style={{ margin: 0, fontSize: 11, maxWidth: 220 }}>
          {f.split(/[/\\]/).pop() ?? f}
        </Tag>
      ))}
      {items.length > 16 ? (
        <Tag style={{ margin: 0 }}>+{items.length - 16}</Tag>
      ) : null}
    </div>
  );
}

export const CreationStepStage: React.FC<CreationStepStageProps> = ({
  activeStepId,
  payload,
  previewUrl = null,
  generationMode = 'game',
}) => {
  const { t } = useT();
  const step = activeStepId ?? 'intent';

  const metaBar = (
    <Space size={6} wrap style={{ marginBottom: 8 }}>
      {payload.provider ? (
        <Tag color="blue">
          {t('generate.pipeline.provider', { provider: payload.provider })}
          {payload.model ? ` · ${payload.model}` : ''}
        </Tag>
      ) : null}
      {payload.attempt != null && payload.maxAttempts != null ? (
        <Tag>
          {t('generate.pipeline.attempt', {
            attempt: payload.attempt,
            max: payload.maxAttempts,
          })}
        </Tag>
      ) : null}
      {payload.heartbeatSec > 0 ? (
        <Tag>
          {t('generate.pipeline.elapsed', {
            time: formatElapsedSec(payload.heartbeatSec),
          })}
          {payload.cliTimeoutMs
            ? ` / ${formatElapsedSec(Math.round(payload.cliTimeoutMs / 1000))}`
            : ''}
        </Tag>
      ) : null}
      {payload.archetype ? (
        <Tag color="purple">{payload.archetype}</Tag>
      ) : null}
      {payload.scaffold ? <Tag>{payload.scaffold}</Tag> : null}
      {payload.keyHint ? (
        <Tag color={payload.keyRotated ? 'orange' : 'default'}>
          {t('generate.pipeline.keyHint', { hint: payload.keyHint })}
        </Tag>
      ) : null}
    </Space>
  );

  let body: React.ReactNode = null;

  if (previewUrl && (step === 'preview' || step === 'polish')) {
    body = (
      <Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
        {payload.smokeOk === false || payload.playable === false
          ? t('generate.pipeline.stage.previewDegraded')
          : t('generate.pipeline.stage.previewReady')}
      </Paragraph>
    );
  } else if (step === 'intent') {
    body = (
      <Paragraph style={{ margin: 0, fontSize: 13 }}>
        {t(
          generationMode === 'world'
            ? 'generate.pipeline.stage.worldIntent'
            : 'generate.pipeline.stage.intent',
        )}
      </Paragraph>
    );
  } else if (step === 'plan' || step === 'scaffold') {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Text strong style={{ fontSize: 12 }}>
          {step === 'scaffold'
            ? t('generate.pipeline.stage.scaffold')
            : t('generate.pipeline.stage.plan')}
        </Text>
        {(payload.archetype || payload.scaffold) && (
          <Space size={4} wrap>
            {payload.archetype ? (
              <Tag color="purple">{payload.archetype}</Tag>
            ) : null}
            {payload.scaffold ? <Tag>{payload.scaffold}</Tag> : null}
          </Space>
        )}
        {payload.gddSceneKeys.length > 0 ? (
          <ChipGrid
            items={payload.gddSceneKeys}
            icon={null}
            empty={t('generate.pipeline.stage.noScenes')}
          />
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {payload.archetype
              ? t('generate.pipeline.stage.planScenesPending')
              : t('generate.pipeline.stage.planWaiting')}
          </Text>
        )}
      </div>
    );
  } else if (step === 'worldSpec') {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Text strong style={{ fontSize: 12 }}>
          {t('generate.pipeline.stage.worldSpec')}
        </Text>
        {payload.worldLineage ? (
          <WorldLineageCard snapshot={payload.worldLineage} />
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('generate.pipeline.stage.worldSpecWaiting')}
          </Text>
        )}
      </div>
    );
  } else if (step === 'assets') {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {payload.failoverNotes.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ padding: '4px 8px' }}
            message={payload.failoverNotes.slice(0, 2).join(' · ')}
          />
        ) : null}
        {/* Silent mid-pool Key rotate is not shown; imageFailover only when pool exhausted */}
        {payload.imageFailover ? (
          <Alert
            type="warning"
            showIcon
            style={{ padding: '4px 8px' }}
            message={t('generate.pipeline.note.imageFailover')}
          />
        ) : null}
        {payload.softSkipAudio ? (
          <Alert
            type="info"
            showIcon
            style={{ padding: '4px 8px' }}
            message={t('generate.pipeline.note.audioSoftSkip')}
          />
        ) : null}
        <Text strong style={{ fontSize: 12 }}>
          <PictureOutlined /> {t('generate.pipeline.stage.images')}
        </Text>
        {payload.imageFiles.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
              gap: 8,
            }}
          >
            {payload.imageFiles.slice(0, 12).map((f) => {
              const name = f.split(/[/\\]/).pop() ?? f;
              return (
                <div
                  key={f}
                  style={{
                    border: '1px solid rgba(148,163,184,0.35)',
                    borderRadius: 8,
                    padding: 8,
                    minHeight: 72,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    background: 'rgba(99,102,241,0.06)',
                  }}
                  title={f}
                >
                  <PictureOutlined style={{ fontSize: 22, color: 'var(--color-ember)' }} />
                  <Text
                    style={{
                      fontSize: 10,
                      textAlign: 'center',
                      wordBreak: 'break-all',
                      lineHeight: 1.2,
                    }}
                  >
                    {name}
                  </Text>
                </div>
              );
            })}
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('generate.pipeline.stage.imagesWaiting')}
          </Text>
        )}
        <Text strong style={{ fontSize: 12 }}>
          <SoundOutlined /> {t('generate.pipeline.stage.audio')}
        </Text>
        <ChipGrid
          items={payload.audioFiles}
          icon={<SoundOutlined />}
          empty={
            payload.softSkipAudio
              ? t('generate.pipeline.note.audioSoftSkip')
              : t('generate.pipeline.stage.audioWaiting')
          }
        />
      </div>
    );
  } else if (step === 'code') {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Text strong style={{ fontSize: 12 }}>
          {payload.attempt != null && payload.attempt > 1
            ? t('generate.pipeline.stage.fix', {
                attempt: payload.attempt,
                max: payload.maxAttempts ?? '?',
              })
            : t(
                generationMode === 'world'
                  ? 'generate.pipeline.stage.presenter'
                  : 'generate.pipeline.stage.code',
              )}
        </Text>
        {payload.qaIssues.length > 0 ? (
          <Alert
            type="info"
            showIcon
            style={{ padding: '4px 8px' }}
            message={payload.qaIssues.slice(0, 2).join(' · ')}
          />
        ) : null}
        <ChipGrid
          items={
            payload.filesChanged.length > 0
              ? payload.filesChanged
              : payload.allFiles.filter((f) => /\.(ts|tsx|js|json)$/i.test(f))
          }
          icon={<FileOutlined />}
          empty={t('generate.pipeline.stage.codeWaiting')}
        />
      </div>
    );
  } else if (step === 'build') {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Text style={{ fontSize: 12 }}>
          {payload.sceneCount != null
            ? t('generate.progress.sceneStatus', {
                count: payload.sceneCount,
                smoke:
                  payload.smokeOk === true
                    ? t('generate.progress.smokePass')
                    : payload.smokeOk === false
                      ? t('generate.progress.smokeFail')
                      : t('generate.progress.smokePending'),
              })
            : t('generate.pipeline.stage.buildWaiting')}
        </Text>
        {payload.qaIssues.length > 0 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('generate.progress.qaIssues', {
              issues: payload.qaIssues.join(' · '),
            })}
          </Text>
        ) : null}
      </div>
    );
  } else if (step === 'preview' || step === 'polish') {
    body = (
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('generate.pipeline.stage.previewWaiting')}
      </Text>
    );
  }

  return (
    <div
      style={{
        border: '1px solid rgba(148,163,184,0.25)',
        borderRadius: 10,
        padding: 10,
        background: 'rgba(15,23,42,0.03)',
        minHeight: 88,
      }}
    >
      {metaBar}
      {body}
    </div>
  );
};
