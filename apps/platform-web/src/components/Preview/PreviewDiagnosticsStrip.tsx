/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Honest preview failure: CORS vs 404 vs timeout vs broken JS, with the URL
 * that actually failed. Game iframe and town stage share this strip.
 */

import React from 'react';
import { Alert, Button, Typography } from 'antd';
import { useT } from '../../services/i18n';
import {
  previewHintKey,
  previewReasonCopyKey,
  previewRetryKind,
  shortenPreviewFailedUrl,
  type PreviewBundleProbe,
  type PreviewRetryKind,
} from '../../utils/previewBundleHealth';

const { Text } = Typography;

export interface PreviewDiagnosticsStripProps {
  readonly probe: PreviewBundleProbe;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly retryKind?: PreviewRetryKind;
}

export const PreviewDiagnosticsStrip: React.FC<PreviewDiagnosticsStripProps> = ({
  probe,
  onRetry,
  retryLabel,
  retryKind,
}) => {
  const { t } = useT();
  if (probe.ok) return null;
  const kind =
    retryKind ??
    previewRetryKind({ reason: probe.reason });
  const detail = [
    probe.failedUrl
      ? t('preview.diag.url', { url: shortenPreviewFailedUrl(probe.failedUrl) })
      : null,
    probe.statusCode
      ? t('preview.diag.status', { status: String(probe.statusCode) })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Alert
      type="error"
      showIcon
      title={t(previewReasonCopyKey(probe.reason))}
      description={
        <div>
          <Text style={{ fontSize: 12 }}>
            {t(previewHintKey(kind, probe.reason))}
          </Text>
          {detail ? (
            <div style={{ marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}>
              {detail}
            </div>
          ) : null}
          {onRetry ? (
            <div style={{ marginTop: 10 }}>
              <Button size="small" type="primary" onClick={onRetry}>
                {retryLabel ?? t('preview.diag.retry')}
              </Button>
            </div>
          ) : null}
        </div>
      }
    />
  );
};
