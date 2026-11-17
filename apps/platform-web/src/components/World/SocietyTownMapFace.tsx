/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Map column faces only. Overlays and the inspector stay on the stage so a
 * later lamp/observe change does not reopen the iframe switch.
 */

import React from 'react';
import { Button, Spin, Typography } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

import { PreviewDiagnosticsStrip } from '../Preview/PreviewDiagnosticsStrip';
import {
  asPreviewReason,
  previewRetryAction,
  previewRetryLabelKey,
  type PreviewBundleProbe,
  type PreviewRetryKind,
  type PreviewStageFace,
} from '../../utils/previewBundleHealth';
import {
  previewIframeAllow,
  previewIframeSandbox,
} from '../../utils/previewIframeSandbox';

const { Paragraph } = Typography;

export const SocietyTownMapFace: React.FC<{
  readonly face: PreviewStageFace;
  readonly t: (key: string) => string;
  readonly previewSettling: boolean;
  readonly isGenerating: boolean;
  readonly previewUrl: string | null;
  readonly buildingOverlay: string;
  readonly previewProbe: PreviewBundleProbe | null;
  readonly previewBroken: string | null;
  readonly brokenRetryKind: PreviewRetryKind;
  readonly onRetryFailedJob?: () => void | Promise<void>;
  readonly onRefreshPreview?: () => void | Promise<void>;
  readonly markLeaseAttempt: () => void;
  readonly isAuthor: boolean;
  readonly rebuildPresenter: () => void;
  readonly iframeRef: React.RefObject<HTMLIFrameElement | null>;
  readonly remountKey: number;
  readonly iframeSrc: string;
  readonly onIframeLoad: () => void;
  readonly iframePrep: 'idle' | 'republish' | 'ready';
  readonly onLoadMap: () => void;
}> = ({
  face,
  t,
  previewSettling,
  isGenerating,
  previewUrl,
  buildingOverlay,
  previewProbe,
  previewBroken,
  brokenRetryKind,
  onRetryFailedJob,
  onRefreshPreview,
  markLeaseAttempt,
  isAuthor,
  rebuildPresenter,
  iframeRef,
  remountKey,
  iframeSrc,
  onIframeLoad,
  iframePrep,
  onLoadMap,
}) => {
  if (face === 'baking') {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          background: 'var(--bg-layout)',
          zIndex: 3,
        }}
      >
        <Spin
          indicator={
            <LoadingOutlined
              style={{ fontSize: 32, color: 'var(--color-teal)' }}
              spin
            />
          }
        />
        <Typography.Title
          level={5}
          style={{ margin: 0, color: 'var(--text-primary)' }}
        >
          {t(
            previewSettling && !isGenerating
              ? 'preview.diag.settling'
              : 'preview.diag.baking',
          )}
        </Typography.Title>
        <Paragraph
          type="secondary"
          style={{ textAlign: 'center', margin: 0, maxWidth: 360 }}
        >
          {previewSettling && !isGenerating
            ? t('preview.diag.settlingHint')
            : previewUrl
              ? t('preview.diag.bakingHint')
              : buildingOverlay}
        </Paragraph>
      </div>
    );
  }
  if (face === 'broken') {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          background: 'var(--bg-layout)',
          zIndex: 3,
        }}
      >
        <div style={{ maxWidth: 440, width: '100%' }}>
          <PreviewDiagnosticsStrip
            probe={
              previewProbe ?? {
                ok: false,
                reason: asPreviewReason(previewBroken),
              }
            }
            retryKind={brokenRetryKind}
            onRetry={() => {
              const action = previewRetryAction(brokenRetryKind);
              if (action === 'job' && onRetryFailedJob) {
                void onRetryFailedJob();
                return;
              }
              if (action === 'lease' && onRefreshPreview) {
                markLeaseAttempt();
                void onRefreshPreview();
                return;
              }
              if (isAuthor) rebuildPresenter();
            }}
            retryLabel={t(previewRetryLabelKey(brokenRetryKind))}
          />
        </div>
      </div>
    );
  }
  if (face === 'live') {
    return (
      <iframe
        ref={iframeRef}
        key={`${remountKey}`}
        src={iframeSrc}
        title="Society Town"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 'none',
        }}
        sandbox={previewIframeSandbox(previewUrl ?? '')}
        allow={previewIframeAllow()}
        onLoad={onIframeLoad}
      />
    );
  }
  if (face === 'load') {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          background: 'var(--bg-layout)',
          zIndex: 2,
        }}
      >
        <Paragraph type="secondary" style={{ textAlign: 'center', margin: 0 }}>
          {iframePrep === 'republish'
            ? t('product.obs.mapPreparing')
            : t('product.obs.loadMapHint')}
        </Paragraph>
        <Button type="primary" onClick={onLoadMap}>
          {t('product.obs.loadMap')}
        </Button>
      </div>
    );
  }
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--bg-layout)',
      }}
    >
      <Paragraph type="secondary" style={{ textAlign: 'center' }}>
        {isGenerating ? buildingOverlay : t('product.town.mapEmpty')}
      </Paragraph>
    </div>
  );
};
