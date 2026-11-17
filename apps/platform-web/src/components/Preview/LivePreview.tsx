/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  ReloadOutlined,
  ExpandOutlined,
  DesktopOutlined,
  MobileOutlined,
  RocketOutlined,
  LoadingOutlined,
  ShareAltOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { Button, Space, Typography, Tooltip, Dropdown, Spin } from 'antd';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../services/i18n';
import { previewIframeAllow, previewIframeSandbox } from '../../utils/previewIframeSandbox';
import { postPlaySession, withPlayDeploymentContext } from '../../utils/playContext';
import { useAppStore } from '../../store';
import {
  previewDeploymentIdentity,
  withPreviewBustParam,
} from '../../utils/previewUrlStability';
import {
  WorldReadyStrip,
  type WorldReadySummary,
} from '../World/WorldReadyStrip';
import { SocietyTownStage } from '../World/SocietyTownStage';
import { GameAcceptanceStrip } from './GameAcceptanceStrip';
import { PreviewDiagnosticsStrip } from './PreviewDiagnosticsStrip';
import type { AcceptanceCheckItem } from '../../utils/acceptanceChecks';
import {
  PREVIEW_BROKEN_MSG,
  asPreviewReason,
  isStageKillingPreviewFailure,
  previewProbeShouldCondemn,
  probePreviewBundle,
  type PreviewBundleProbe,
} from '../../utils/previewBundleHealth';

const { Text } = Typography;

type DevicePreset = 'desktop' | 'iphone' | 'android' | 'tablet';

interface DeviceSpec {
  readonly id: DevicePreset;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly bezel?: number;
}

const DEVICE_PRESETS: Readonly<Record<DevicePreset, DeviceSpec>> = {
  desktop: { id: 'desktop', label: '桌面端', width: 0, height: 0 },
  iphone: { id: 'iphone', label: 'iPhone 14', width: 390, height: 844, bezel: 28 },
  android: { id: 'android', label: 'Pixel 7', width: 412, height: 915, bezel: 22 },
  tablet: { id: 'tablet', label: 'iPad mini', width: 744, height: 1133, bezel: 24 },
};

export type PreviewPipelineStage =
  | 'ready'
  | 'idle'
  | 'generating'
  | 'building'
  | 'deploying'
  | 'error';

interface LivePreviewProps {
  previewUrl: string | null;
  isGenerating?: boolean;
  /** Early playable draft while polish continues */
  playableDraft?: boolean;
  /** 无预览 URL 时的流水线阶段（ready 表示已有 URL，主区域走 iframe） */
  pipelineStage?: PreviewPipelineStage;
  /** generationState=error 时 log_key 的摘要（分号前一段） */
  errorSummary?: string;
  /** World mode empty-state helpers */
  generationMode?: 'game' | 'world';
  /** Required for Society Town stage (observe iframe + inspector) */
  projectId?: string | null;
  onOpenWorldPanel?: () => void;
  onStartWorldDemo?: () => void;
  /** Remount iframe when world rebuilds */
  remountKey?: number | string;
  worldSummary?: WorldReadySummary | null;
  acceptanceChecks?: AcceptanceCheckItem[] | null;
  onOpenQuality?: () => void;
  /** Prefer observatory tab after world job success */
  worldPaneFocusToken?: number;
  /** Visual pipeline shown while waiting for preview URL */
  progressPanel?: React.ReactNode;
  /** @deprecated alias of progressPanel */
  progressQueue?: React.ReactNode;
  /** Share current preview deployment to community gallery */
  onShareToCommunity?: () => void;
  /** Already published community slug for this deployment */
  publishedCommunitySlug?: string | null;
  onOpenCommunityGame?: (slug: string) => void;
  deploymentId?: string | null;
  /** Re-sign / remount preview after API restart — not a presenter rebuild. */
  onRefreshPreview?: () => void | Promise<void>;
  generateFailed?: boolean;
  onRetryFailedJob?: () => void | Promise<void>;
  assetProgress?: { readonly done: number; readonly total: number } | null;
}

export const LivePreview: React.FC<LivePreviewProps> = ({
  previewUrl,
  isGenerating,
  playableDraft = false,
  pipelineStage = 'idle',
  errorSummary = '',
  generationMode = 'game',
  projectId = null,
  onOpenWorldPanel,
  onStartWorldDemo,
  remountKey = 0,
  worldSummary = null,
  acceptanceChecks = null,
  onOpenQuality,
  worldPaneFocusToken = 0,
  progressPanel = null,
  progressQueue = null,
  onShareToCommunity,
  publishedCommunitySlug = null,
  onOpenCommunityGame,
  deploymentId = null,
  onRefreshPreview,
  generateFailed = false,
  onRetryFailedJob,
  assetProgress = null,
}) => {
  const pipelineSlot = progressPanel ?? progressQueue;
  const { isDark } = useTheme();
  const { t } = useT();
  const [key, setKey] = useState(0);
  const [device, setDevice] = useState<DevicePreset>('desktop');
  const [previewProbe, setPreviewProbe] = useState<PreviewBundleProbe | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleRefresh = () => {
    setPreviewProbe(null);
    setKey((k) => k + 1);
  };

  useEffect(() => {
    if (!previewUrl || generationMode === 'world') {
      setPreviewProbe(null);
      return;
    }
    let cancelled = false;
    void probePreviewBundle(previewUrl).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setPreviewProbe(null);
        return;
      }
      // Scanner syntax on a working Vite bundle must not cover a live game.
      if (
        isStageKillingPreviewFailure(result.reason) &&
        !previewProbeShouldCondemn(result.reason)
      ) {
        setPreviewProbe(null);
        return;
      }
      setPreviewProbe(result);
    });
    return () => {
      cancelled = true;
    };
  }, [previewUrl, key, remountKey, generationMode]);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; payload?: { reason?: string } } | null;
      if (data?.type !== PREVIEW_BROKEN_MSG) return;
      setPreviewProbe({
        ok: false,
        reason: asPreviewReason(data.payload?.reason),
      });
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const deviceMenuItems = [
    {
      key: 'desktop',
      icon: <DesktopOutlined />,
      label: DEVICE_PRESETS.desktop.label,
      onClick: () => setDevice('desktop'),
    },
    {
      key: 'iphone',
      icon: <MobileOutlined />,
      label: DEVICE_PRESETS.iphone.label,
      onClick: () => setDevice('iphone'),
    },
    {
      key: 'android',
      icon: <MobileOutlined />,
      label: DEVICE_PRESETS.android.label,
      onClick: () => setDevice('android'),
    },
    {
      key: 'tablet',
      icon: <MobileOutlined />,
      label: DEVICE_PRESETS.tablet.label,
      onClick: () => setDevice('tablet'),
    },
  ];

  const activeSpec = DEVICE_PRESETS[device];

  // Bust only on intentional remount (refresh / world rebuild) — never on
  // rotated preview-proxy JWT tokens, or Phaser reloads forever in the iframe.
  const token = useAppStore((s) => s.token);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pushSession = () =>
    postPlaySession(iframeRef.current, { token, deploymentId });

  const iframeSrc = React.useMemo(() => {
    if (!previewUrl) return '';
    const bust = `${key}-${remountKey ?? 0}`;
    const busted = withPreviewBustParam(previewUrl, bust);
    return deploymentId ? withPlayDeploymentContext(busted, deploymentId) : busted;
  }, [previewUrl, key, remountKey, deploymentId]);

  const openWindowHref = React.useMemo(() => {
    if (generationMode === 'world' && projectId) {
      return `/observatory/${projectId}`;
    }
    return previewUrl ?? undefined;
  }, [previewUrl, generationMode, projectId]);

  const stableIframeSrcRef = useRef(iframeSrc);
  const lastPreviewIdentityRef = useRef<string | null>(null);
  const lastBustKeyRef = useRef(`${key}-${remountKey ?? 0}`);

  if (!previewUrl) {
    stableIframeSrcRef.current = '';
    lastPreviewIdentityRef.current = null;
  } else {
    const identity = previewDeploymentIdentity(previewUrl) ?? previewUrl;
    const bustKey = `${key}-${remountKey ?? 0}`;
    if (
      identity !== lastPreviewIdentityRef.current ||
      bustKey !== lastBustKeyRef.current ||
      !stableIframeSrcRef.current
    ) {
      lastPreviewIdentityRef.current = identity;
      lastBustKeyRef.current = bustKey;
      stableIframeSrcRef.current = iframeSrc;
    }
  }
  const stableIframeSrc = stableIframeSrcRef.current;

  const gamePreviewOverlay =
    previewProbe && !previewProbe.ok ? (
      <div
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          top: 12,
          zIndex: 4,
        }}
      >
        <PreviewDiagnosticsStrip probe={previewProbe} onRetry={handleRefresh} />
      </div>
    ) : null;

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-layout)',
      }}
    >
      {/* 简洁工具栏 */}
      <div
        style={{
          flexShrink: 0,
          zIndex: 2,
          padding: '8px 16px',
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Space>
          <Text style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {generationMode === 'world'
              ? t('generate.preview.worldLabel')
              : t('generate.preview.label')}
          </Text>
          {playableDraft && previewUrl && isGenerating ? (
            <Text
              style={{
                fontSize: 12,
                color: isDark ? '#fbbf24' : '#b45309',
                background: isDark ? '#42200655' : '#fef3c7',
                padding: '2px 8px',
                borderRadius: 4,
              }}
            >
              {t('generate.preview.draftBadge')}
            </Text>
          ) : null}
          {isGenerating && (
            <Space size={4}>
              <LoadingOutlined
                style={{
                  color: generationMode === 'world' ? 'var(--color-teal)' : 'var(--color-ember)',
                  fontSize: 12,
                }}
              />
              <Text style={{ fontSize: 12, color: '#71717a' }}>
                {generationMode === 'world'
                  ? t('generate.status.buildingWorld')
                  : playableDraft && previewUrl
                    ? t('generate.pipeline.step.polish')
                    : t('generate.preview.generating')}
              </Text>
            </Space>
          )}
        </Space>

        <Space size={4} wrap style={{ justifyContent: 'flex-end' }}>
          {(previewUrl || (generationMode === 'world' && projectId)) && (
            <>
              <Button
                type="primary"
                size="small"
                icon={<RocketOutlined />}
                href={openWindowHref}
                target="_blank"
                rel="noopener noreferrer"
                disabled={!openWindowHref}
              >
                {generationMode === 'world'
                  ? t('generate.preview.openObservatory')
                  : t('generate.preview.openNewWindow')}
              </Button>
              {publishedCommunitySlug ? (
                <Button
                  size="small"
                  icon={<CheckCircleOutlined />}
                  onClick={() =>
                    onOpenCommunityGame?.(publishedCommunitySlug)
                  }
                >
                  {t('generate.preview.viewOnCommunity')}
                </Button>
              ) : onShareToCommunity ? (
                <Button
                  size="small"
                  type="default"
                  icon={<ShareAltOutlined />}
                  onClick={onShareToCommunity}
                >
                  {t('generate.preview.shareToCommunity')}
                </Button>
              ) : null}
              <Dropdown menu={{ items: deviceMenuItems }} trigger={['click']}>
                <Button type="text" size="small" style={{ color: '#71717a', fontSize: 12 }}>
                  {device === 'desktop' ? <DesktopOutlined /> : <MobileOutlined />}
                </Button>
              </Dropdown>
              <Tooltip title={t('generate.preview.refresh')}>
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={handleRefresh}
                  style={{ color: '#71717a' }}
                />
              </Tooltip>
              <Tooltip title={t('generate.preview.fullscreen')}>
                <Button
                  type="text"
                  size="small"
                  icon={<ExpandOutlined />}
                  onClick={toggleFullscreen}
                  style={{ color: '#71717a' }}
                />
              </Tooltip>
            </>
          )}
        </Space>
      </div>

      {/* 预览区域：iframe 在 flex 交叉轴上需 stretch，否则 height:100% 可能塌成 0 导致「一片黑」 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          background:
            'radial-gradient(90% 70% at 20% 0%, color-mix(in srgb, var(--color-gold) 14%, transparent), transparent 55%), var(--bg-layout)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: 'stretch',
        }}
      >
        {generationMode === 'world' && projectId ? (
          <>
          {worldSummary ? (
            <WorldReadyStrip world={worldSummary} observatoryActive />
          ) : null}
          {acceptanceChecks?.length ? (
            <GameAcceptanceStrip
              checks={acceptanceChecks}
              onOpenQuality={onOpenQuality}
            />
          ) : null}
          {isGenerating && pipelineSlot ? (
            <div
              style={{
                flexShrink: 0,
                padding: '8px 12px',
                borderBottom: '1px solid var(--border-color)',
                background: 'var(--bg-card)',
              }}
            >
              {pipelineSlot}
            </div>
          ) : null}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
            }}
          >
            <SocietyTownStage
              projectId={projectId}
              previewUrl={previewUrl}
              remountKey={
                Number(remountKey ?? 0) + key + Number(worldPaneFocusToken ?? 0)
              }
              isGenerating={Boolean(isGenerating)}
              generateFailed={generateFailed}
              hasWorld={Boolean(worldSummary)}
              autoloadMap
              onRefreshPreview={onRefreshPreview}
              onRetryFailedJob={onRetryFailedJob}
              assetProgress={assetProgress}
            />
          </div>
          </>
        ) : previewUrl ? (
          <>
          {acceptanceChecks?.length ? (
            <GameAcceptanceStrip
              checks={acceptanceChecks}
              onOpenQuality={onOpenQuality}
            />
          ) : null}
          <>
          {device === 'desktop' ? (
            <div
              style={{
                flex: 1,
                minHeight: 220,
                width: '100%',
                position: 'relative',
                background: '#000',
              }}
            >
              <iframe
                key={`${key}-${remountKey}`}
                ref={iframeRef}
                src={stableIframeSrc}
                title="Game Preview"
                onLoad={pushSession}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  border: 'none',
                }}
                sandbox={previewIframeSandbox(previewUrl)}
                allow={previewIframeAllow()}
              />
              {gamePreviewOverlay}
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 0,
                overflow: 'auto',
                padding: 16,
              }}
            >
              <div
                style={{
                  width: activeSpec.width + (activeSpec.bezel ?? 0) * 2,
                  height: activeSpec.height + (activeSpec.bezel ?? 0) * 2,
                  background: '#0f172a',
                  borderRadius: 36,
                  padding: activeSpec.bezel ?? 16,
                  boxShadow: '0 24px 60px rgba(15,23,42,0.5)',
                  position: 'relative',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
              <iframe
                key={`${key}-${remountKey}`}
                ref={iframeRef}
                src={stableIframeSrc}
                title={`Game Preview (${activeSpec.label})`}
                onLoad={pushSession}
                style={{
                  width: activeSpec.width,
                  height: activeSpec.height,
                  border: 'none',
                  borderRadius: 8,
                  background: '#000',
                }}
                sandbox={previewIframeSandbox(previewUrl)}
                allow={previewIframeAllow()}
              />
              {gamePreviewOverlay}
              </div>
            </div>
          )}
            </>
          </>
        ) : pipelineStage === 'generating' ||
          pipelineStage === 'building' ||
          pipelineStage === 'deploying' ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: 40,
              maxWidth: pipelineSlot ? 560 : 420,
              width: '100%',
              margin: '0 auto',
            }}
          >
            <Spin
              indicator={
                <LoadingOutlined
                  style={{
                    fontSize: 36,
                    color: generationMode === 'world' ? 'var(--color-teal)' : 'var(--color-ember)',
                  }}
                  spin
                />
              }
            />
            <Text
              style={{
                fontSize: 17,
                color: 'var(--text-primary)',
                marginTop: 20,
                marginBottom: 10,
                display: 'block',
                fontWeight: 600,
              }}
            >
              {pipelineStage === 'generating'
                ? generationMode === 'world'
                  ? t('generate.preview.pipelineWorldGenerateTitle')
                  : t('generate.preview.pipelineGenerateTitle')
                : pipelineStage === 'building'
                  ? generationMode === 'world'
                    ? t('generate.preview.pipelineWorldBuildTitle')
                    : t('generate.preview.pipelineBuildTitle')
                  : t('generate.preview.pipelineDeployTitle')}
            </Text>
            {pipelineSlot ? (
              <div
                style={{
                  width: '100%',
                  maxWidth: 520,
                  marginTop: 8,
                  textAlign: 'left',
                }}
              >
                {pipelineSlot}
              </div>
            ) : (
            <Text
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.75,
              }}
            >
              {pipelineStage === 'generating'
                ? generationMode === 'world'
                  ? t('generate.preview.pipelineWorldGenerateDesc')
                  : t('generate.preview.pipelineGenerateDesc')
                : pipelineStage === 'building'
                  ? generationMode === 'world'
                    ? t('generate.preview.pipelineWorldBuildDesc')
                    : t('generate.preview.pipelineBuildDesc')
                  : t('generate.preview.pipelineDeployDesc')}
            </Text>
            )}
          </div>
        ) : pipelineStage === 'error' ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: 40,
              maxWidth: 440,
              width: '100%',
              margin: '0 auto',
            }}
          >
            <Text
              style={{
                fontSize: 17,
                color: 'var(--color-error)',
                marginBottom: 12,
                fontWeight: 600,
              }}
            >
              {t('generate.preview.pipelineErrorTitle')}
            </Text>
            {errorSummary ? (
              <Text
                style={{
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  lineHeight: 1.7,
                  marginBottom: 12,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {errorSummary}
              </Text>
            ) : null}
            <Text style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75 }}>
              {t('generate.preview.pipelineErrorDesc')}
            </Text>
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: 40,
              width: '100%',
            }}
          >
            <div
              style={{
                width: 120,
                height: 120,
                borderRadius: 24,
                background:
                  generationMode === 'world'
                    ? 'linear-gradient(135deg, color-mix(in srgb, var(--color-teal) 42%, var(--color-night)) 0%, var(--bg-lane) 100%)'
                    : 'linear-gradient(135deg, color-mix(in srgb, var(--color-ember) 36%, var(--color-night)) 0%, var(--bg-lane) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 24,
                fontSize: 48,
                boxShadow: 'var(--shadow-md)',
              }}
            >
              {generationMode === 'world' ? '🌍' : '🎮'}
            </div>
            <Text
              style={{
                fontSize: 18,
                color: 'var(--text-primary)',
                marginBottom: 10,
                display: 'block',
                fontWeight: 600,
              }}
            >
              {generationMode === 'world'
                ? t('generate.preview.worldEmptyTitle')
                : t('generate.preview.emptyTitle')}
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: 'var(--text-secondary)',
                maxWidth: 320,
                lineHeight: 1.7,
                marginBottom: generationMode === 'world' ? 20 : 0,
              }}
            >
              {generationMode === 'world'
                ? t('generate.preview.worldEmptyDesc')
                : t('generate.preview.emptyDesc')}
            </Text>
            {generationMode === 'world' ? (
              <Space wrap style={{ justifyContent: 'center' }}>
                {onStartWorldDemo ? (
                  <Button type="primary" onClick={onStartWorldDemo}>
                    {t('world.quickStart.oneClick')}
                  </Button>
                ) : null}
                {onOpenWorldPanel ? (
                  <Button onClick={onOpenWorldPanel}>
                    {t('world.mode.openPanel')}
                  </Button>
                ) : null}
              </Space>
            ) : null}
          </div>
        )}      </div>
    </div>
  );
};
