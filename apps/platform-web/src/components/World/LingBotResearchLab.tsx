/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Always-visible research lab for LingBot L3 - first-class in World panel.
 */

import React, { forwardRef, useMemo } from 'react';
import {
  Alert,
  Button,
  Card,
  Select,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd';
import {
  ExperimentOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { useT } from '../../services/i18n';
import { useTheme } from '../../hooks/useTheme';

const { Text, Paragraph } = Typography;

export type LingbotHealthView = {
  ok: boolean;
  mode?: string;
  acceptNc?: boolean;
  profile?: string;
  readyReal?: boolean;
  weightsReady?: boolean;
  shardComplete?: number;
  shardExpected?: number;
  gpuName?: string;
  vramMb?: number;
  warnings?: string[];
  recommendedFrameNum?: number;
  ckpt?: string | null;
  repo?: string | null;
};

export type SpatialPreviewView = {
  message: string;
  videoUrl?: string;
  frameUrl?: string;
  licenseNote?: string;
  fallbackFromReal?: boolean;
  presentationMock?: boolean;
};

export interface LingBotResearchLabProps {
  readonly health: LingbotHealthView | null;
  readonly sessionId: string | null;
  readonly spatialBackend: string;
  readonly clipFrameNum: number;
  readonly clipBusy: boolean;
  readonly preview: SpatialPreviewView | null;
  /** When false, session/clip need a world Spec first. */
  readonly hasWorld?: boolean;
  readonly onHealth: () => void;
  readonly onSmoke: () => void;
  readonly onBackendChange: (v: string) => void;
  readonly onFrameChange: (n: number) => void;
  readonly onProbe: () => void;
  readonly onOpenSession: () => void;
  readonly onCloseSession: () => void;
  readonly onClip: () => void;
  readonly onStep: (action: string) => void;
  readonly onStartWorld?: () => void;
}

export const LingBotResearchLab = forwardRef(function LingBotResearchLab(
  {
    health,
    sessionId,
    spatialBackend,
    clipFrameNum,
    clipBusy,
    preview,
    hasWorld = true,
    onHealth,
    onSmoke,
    onBackendChange,
    onFrameChange,
    onProbe,
    onOpenSession,
    onCloseSession,
    onClip,
    onStep,
    onStartWorld,
  }: LingBotResearchLabProps,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const { t } = useT();
  const { isDark } = useTheme();

  const stepIndex = useMemo(() => {
    if (!health?.ok) return 0;
    if (!health.weightsReady) return 1;
    if (!health.readyReal && health.mode !== 'real') return 2;
    if (!hasWorld) return 3;
    if (!sessionId) return 3;
    // Real offline clip only - presentationMock frameUrl must NOT count as finished
    if (!preview?.videoUrl) return 4;
    return 5;
  }, [health, sessionId, preview, hasWorld]);

  return (
    <div ref={ref} id="og-research-lab">
      <Card
        size="small"
        style={{
          marginBottom: 12,
          borderColor: isDark ? '#334155' : '#99f6e4',
          background: isDark ? '#0b1220' : '#f0fdfa',
        }}
        title={
          <Space wrap>
            <ExperimentOutlined style={{ color: '#14b8a6' }} />
            <Text strong>{t('world.research.title')}</Text>
            <Tag color="purple">{t('world.research.badge')}</Tag>
            {health?.readyReal ? (
              <Tag color="success" icon={<CheckCircleOutlined />}>
                readyReal
              </Tag>
            ) : health?.weightsReady ? (
              <Tag color="processing">
                weights {health.shardComplete ?? '?'}/
                {health.shardExpected ?? 8}
              </Tag>
            ) : (
              <Tag color="warning">sidecar?</Tag>
            )}
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          title={t('world.research.stackTitle')}
          description={t('world.research.stackDesc')}
          style={{ marginBottom: 12 }}
        />

        <Alert
          type="warning"
          showIcon
          title={t('world.lingbot.researchBanner')}
          description={
            health?.warnings?.length
              ? health.warnings.join(' ')
              : t('world.lingbot.consumerHint')
          }
          style={{ marginBottom: 12 }}
        />

        {!health?.ok ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            title={t('world.lingbot.sidecarDown')}
            description={t('world.research.startSidecar')}
            action={
              <Button
                size="small"
                onClick={() => {
                  const cmd =
                    'cd services/lingbot-sidecar; powershell -ExecutionPolicy Bypass -File .\\start-tier-b.ps1';
                  void navigator.clipboard?.writeText(cmd);
                }}
              >
                {t('world.research.copyStart')}
              </Button>
            }
          />
        ) : null}

        {!hasWorld ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={t('world.research.needWorld')}
            action={
              onStartWorld ? (
                <Button size="small" type="primary" onClick={onStartWorld}>
                  {t('world.quickStart.oneClick')}
                </Button>
              ) : null
            }
          />
        ) : null}

        <Steps
          size="small"
          current={stepIndex}
          direction="vertical"
          style={{ marginBottom: 12 }}
          items={[
            {
              title: t('world.research.step.sidecar'),
              description: t('world.research.step.sidecarDesc'),
              status: health?.ok ? 'finish' : 'process',
            },
            {
              title: t('world.research.step.weights'),
              description: t('world.research.step.weightsDesc'),
              status: health?.weightsReady
                ? 'finish'
                : health?.ok
                  ? 'process'
                  : 'wait',
            },
            {
              title: t('world.research.step.real'),
              description: t('world.research.step.realDesc'),
              status: health?.readyReal
                ? 'finish'
                : health?.weightsReady
                  ? 'process'
                  : 'wait',
            },
            {
              title: t('world.research.step.smoke'),
              description: t('world.research.step.smokeDesc'),
            },
            {
              title: t('world.research.step.session'),
              description: t('world.research.step.sessionDesc'),
              status: sessionId ? 'finish' : undefined,
            },
            {
              title: t('world.research.step.clip'),
              description: t('world.research.step.clipDesc'),
              icon: clipBusy ? <LoadingOutlined /> : undefined,
              status: preview?.videoUrl
                ? 'finish'
                : preview?.frameUrl && preview?.presentationMock
                  ? 'error'
                  : preview?.frameUrl
                    ? 'process'
                    : undefined,
            },
          ]}
        />

        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
          {t('world.research.howto')}
        </Paragraph>

        <Space wrap style={{ marginBottom: 8 }}>
          <Tag color={health?.ok ? 'success' : 'default'}>
            {health?.ok ? `mode=${health.mode ?? '?'}` : 'sidecar ?'}
          </Tag>
          {health?.profile ? (
            <Tag color="processing">profile={health.profile}</Tag>
          ) : null}
          {health?.gpuName ? (
            <Tag>
              {health.gpuName}
              {health.vramMb
                ? ` - ${Math.round(health.vramMb / 1024)}GB`
                : ''}
            </Tag>
          ) : null}
          {health?.mode === 'mock' ? (
            <Tag color="orange">L3 mode=mock</Tag>
          ) : health?.mode === 'real' ? (
            <Tag color="green">L3 mode=real</Tag>
          ) : (
            <Tag>L3 mode=?</Tag>
          )}
          {preview?.presentationMock || sessionId ? (
            <Tag color="orange">{t('world.lingbot.presentationMock')}</Tag>
          ) : null}
          {sessionId ? (
            <Tag color="geekblue">{t('world.lingbot.recordingOnly')}</Tag>
          ) : null}
          {preview?.fallbackFromReal ? (
            <Tag color="error">{t('world.lingbot.fallbackBadge')}</Tag>
          ) : null}
          {health?.weightsReady && health.mode !== 'real' ? (
            <Tag color="gold">{t('world.lingbot.finishHint')}</Tag>
          ) : null}
        </Space>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
          title={t('world.lingbot.clipPathTitle')}
          description={t('world.lingbot.clipPathHint')}
        />

        {preview?.fallbackFromReal ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 8 }}
            title={t('world.lingbot.clipFallback')}
          />
        ) : null}

        <Space wrap>
          <Button size="small" onClick={onHealth}>
            {t('world.action.lingbotHealth')}
          </Button>
          <Button size="small" type="dashed" onClick={onSmoke}>
            {t('world.action.lingbotSmoke')}
          </Button>
          <Select
            style={{ width: 160 }}
            value={spatialBackend}
            onChange={onBackendChange}
            options={[
              { value: 'null', label: 'null (2D Phaser)' },
              { value: 'three', label: 'three (roam demo)' },
              { value: 'lingbot', label: 'lingbot (L3)' },
              // marble stub hidden - no real API wired
            ]}
          />
          <Select
            style={{ width: 150 }}
            value={clipFrameNum}
            onChange={onFrameChange}
            options={[
              { value: 17, label: 'frames 17 (4070)' },
              { value: 33, label: 'frames 33' },
              { value: 81, label: 'frames 81' },
            ]}
          />
          <Button onClick={onProbe} disabled={!hasWorld}>
            {t('world.action.probe')}
          </Button>
          <Button
            type="primary"
            ghost
            onClick={onOpenSession}
            disabled={!hasWorld || !health?.ok}
          >
            {t('world.action.lingbotSession')}
          </Button>
          {sessionId ? (
            <Button onClick={onCloseSession}>
              {t('world.action.lingbotClose')}
            </Button>
          ) : null}
          <Button
            type="primary"
            loading={clipBusy}
            onClick={onClip}
            disabled={!hasWorld || !health?.ok}
          >
            {t('world.action.lingbotOfflineClip')}
          </Button>
          {health?.readyReal ? (
            <Button
              type="default"
              loading={clipBusy}
              onClick={onClip}
              disabled={!hasWorld}
            >
              {t('world.action.lingbotRealClip')}
            </Button>
          ) : (
            <Tag color="default">{t('world.lingbot.realClipLocked')}</Tag>
          )}
        </Space>

        {clipBusy ? (
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
            {t('world.lingbot.clipBusy')}
          </Text>
        ) : null}

        {sessionId ? (
          <div style={{ marginTop: 8 }}>
            <Space wrap size="small" style={{ marginBottom: 6 }}>
              <Tag color="orange">presentationMock</Tag>
              <Tag color="geekblue">recordingOnly</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('world.lingbot.stepHonest')}
              </Text>
            </Space>
            <Space wrap size="small">
              {(
                ['move_n', 'move_e', 'talk', 'attack', 'spell'] as const
              ).map((a) => (
                <Button key={a} size="small" onClick={() => onStep(a)}>
                  {a}
                </Button>
              ))}
            </Space>
          </div>
        ) : null}

        {preview ? (
          <div style={{ marginTop: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {preview.message}
              {preview.licenseNote ? ` - ${preview.licenseNote}` : ''}
            </Text>
            {preview.frameUrl ? (
              <img
                src={preview.frameUrl}
                alt="LingBot frame"
                style={{
                  width: '100%',
                  maxHeight: 180,
                  objectFit: 'cover',
                  background: '#0b0f14',
                  borderRadius: 8,
                  marginTop: 8,
                }}
              />
            ) : null}
            {preview.videoUrl ? (
              <video
                src={preview.videoUrl}
                controls
                muted
                playsInline
                style={{
                  width: '100%',
                  maxHeight: 180,
                  background: '#0b0f14',
                  borderRadius: 8,
                  marginTop: 8,
                }}
              />
            ) : null}
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
            {t('world.lingbot.hint')}
          </Text>
        )}
      </Card>
    </div>
  );
});
