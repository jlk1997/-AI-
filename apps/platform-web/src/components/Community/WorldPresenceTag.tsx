/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Same living / speaking face on alley cards, profiles, and the work header.
 */

import React from 'react';
import { Tag } from 'antd';

import { useT } from '../../services/i18n';
import { guestTownFace } from '../World/societyTownGating';

export const WorldPresenceTag: React.FC<{
  readonly living?: boolean;
  readonly speaking?: boolean;
  readonly clockPaused?: boolean;
  readonly showIdle?: boolean;
}> = ({ living, speaking, clockPaused = false, showIdle = false }) => {
  const { t } = useT();
  if (clockPaused) {
    return (
      <Tag color="orange" style={{ marginInlineEnd: 0 }}>
        {t('community.world.authorPaused')}
      </Tag>
    );
  }
  const face = guestTownFace({ living, speaking });
  if (face === 'speaking') {
    return (
      <Tag color="cyan" style={{ marginInlineEnd: 0 }}>
        {t('community.world.speaking')}
      </Tag>
    );
  }
  if (face === 'walking') {
    return (
      <Tag color="green" style={{ marginInlineEnd: 0 }}>
        {t('community.world.living')}
      </Tag>
    );
  }
  if (showIdle) {
    return <Tag style={{ marginInlineEnd: 0 }}>{t('community.world.paused')}</Tag>;
  }
  return null;
};
