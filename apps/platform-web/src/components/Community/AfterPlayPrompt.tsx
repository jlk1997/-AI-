/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * After a hosted run posts a score: cheer, throw one more card, or change one
 * line. This is the conversion beat the play loop was missing.
 */

import React from 'react';
import { Button } from 'antd';
import { FireOutlined, ForkOutlined, GiftOutlined } from '@ant-design/icons';
import { useT } from '../../services/i18n';

export const AfterPlayPrompt: React.FC<{
  onCheer: () => void;
  onJiaxi?: () => void;
  onJiaxiRun?: () => void;
  onRemix?: () => void;
  jiaxiLabel?: string;
  jiaxiRunLabel?: string;
  onDismiss: () => void;
}> = ({ onCheer, onJiaxi, onJiaxiRun, onRemix, jiaxiLabel, jiaxiRunLabel, onDismiss }) => {
  const { t } = useT();
  return (
    <div className="og-after-play">
      <div className="og-after-play__body">{t('kai.afterPlay.body')}</div>
      <div className="og-after-play__actions">
        <Button size="small" icon={<GiftOutlined />} onClick={onCheer}>
          {t('kai.afterPlay.cheer')}
        </Button>
        {onJiaxi ? (
          <Button size="small" type="primary" icon={<FireOutlined />} onClick={onJiaxi}>
            {jiaxiLabel ?? t('kai.afterPlay.jiaxi')}
          </Button>
        ) : null}
        {onJiaxiRun ? (
          <Button size="small" ghost icon={<FireOutlined />} onClick={onJiaxiRun}>
            {jiaxiRunLabel ?? t('kai.jiaxi.run')}
          </Button>
        ) : null}
        {onRemix ? (
          <Button size="small" icon={<ForkOutlined />} onClick={onRemix}>
            {t('kai.afterPlay.remix')}
          </Button>
        ) : null}
        <Button size="small" type="text" style={{ color: 'rgba(244, 238, 228, 0.72)' }} onClick={onDismiss}>
          {t('kai.afterPlay.later')}
        </Button>
      </div>
    </div>
  );
};
