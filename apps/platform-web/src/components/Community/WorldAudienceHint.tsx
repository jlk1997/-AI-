/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Discovery cards: who is watching. Not a lamp shop or a second wallet.
 */

import React from 'react';
import { Typography } from 'antd';

import type { WorldStatusDto } from '../../services/api';
import { useT } from '../../services/i18n';

const { Text } = Typography;

export function worldAudienceLine(
  t: (k: string, vars?: Record<string, string | number>) => string,
  status?: WorldStatusDto | null,
): string | null {
  if (!status) return null;
  const bits: string[] = [];
  const n = status.watcherCount ?? 0;
  if (n === 1) bits.push(t('product.obs.watchersOne'));
  else if (n > 1) bits.push(t('product.obs.watchers', { n: String(n) }));
  if (status.clockPaused) {
    bits.unshift(t('community.world.authorPaused'));
    return bits.join(' · ');
  }
  if (bits.length) return bits.join(' · ');
  if (status.living) return t('product.obs.watchFreeAlone');
  return t('product.obs.nobodyWatchingYet');
}

export const WorldAudienceHint: React.FC<{
  readonly status?: WorldStatusDto | null;
  readonly muted?: boolean;
}> = ({ status, muted = true }) => {
  const { t } = useT();
  const line = worldAudienceLine(t, status);
  if (!line) return null;
  return (
    <Text
      type={muted ? 'secondary' : undefined}
      style={{ fontSize: 12, display: 'block' }}
    >
      {line}
    </Text>
  );
};
