/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Observe-pane banners only. Keeps draft-walk and first-visit copy out of the
 * 4k-line stage so launch-week copy edits do not retouch the map.
 */

import React, { useEffect, useRef } from 'react';
import { Alert, App } from 'antd';

import { useT } from '../../services/i18n.js';

export function SocietyTownObserveAlerts({
  isGenerating,
  previewUrl,
  guideOpen,
  isAuthor,
  assetDone,
  assetTotal,
  onCloseGuide,
}: {
  readonly isGenerating: boolean;
  readonly previewUrl?: string | null;
  readonly guideOpen: boolean;
  readonly isAuthor: boolean;
  readonly assetDone?: number;
  readonly assetTotal?: number;
  readonly onCloseGuide: () => void;
}): React.ReactElement | null {
  const { t } = useT();
  const { modal } = App.useApp();
  const shownModalRef = useRef(false);

  useEffect(() => {
    if (!isGenerating) {
      shownModalRef.current = false;
      return;
    }
    if (!isAuthor || !previewUrl || shownModalRef.current) return;
    shownModalRef.current = true;
    const done = Math.max(0, assetDone ?? 0);
    const total = Math.max(done, assetTotal ?? 0);
    modal.info({
      title: t('product.obs.draftTalkModalTitle'),
      content: t('product.obs.draftTalkModalBody', {
        done: String(done),
        total: String(total || '…'),
      }),
      okText: t('product.obs.draftTalkModalOk'),
      centered: true,
    });
  }, [isAuthor, isGenerating, previewUrl, assetDone, assetTotal, modal, t]);

  if (!isGenerating && !guideOpen) return null;
  return (
    <>
      {isGenerating && previewUrl ? (
        <Alert
          type="warning"
          showIcon
          style={{ fontSize: 12 }}
          title={t('product.obs.draftWalkTitle')}
          description={t('product.obs.draftWalkHint')}
        />
      ) : null}
      {guideOpen ? (
        <Alert
          type="info"
          showIcon
          closable
          onClose={onCloseGuide}
          title={isAuthor ? t('product.obs.alertTitle') : t('product.obs.guestAlertTitle')}
          description={isAuthor ? t('product.obs.alertDesc') : t('product.obs.guestHint')}
          style={{ fontSize: 12 }}
        />
      ) : null}
    </>
  );
}
