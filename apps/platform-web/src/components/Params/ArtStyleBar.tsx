/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Art style picker for both tracks.
 *
 * The world track had no style control at all and the game track only had a
 * loose "visual tone" tag that no asset prompt read, so everything came out
 * coarse pixel art. This picks an {@link ArtStyleId} profile that drives the
 * asset prompts, target resolutions and renderer pixel-snapping.
 */

import React from 'react';
import { Select, Tooltip, Typography } from 'antd';
import { ART_STYLES, type ArtStyleId } from '@opengame/world-spec';

import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../services/i18n';

const { Text } = Typography;

const STORE_KEY = 'opengame_art_style_id';

export function readStoredArtStyleId(): ArtStyleId | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return ART_STYLES.some((p) => p.id === raw) ? (raw as ArtStyleId) : null;
  } catch {
    return null;
  }
}

export function storeArtStyleId(id: ArtStyleId): void {
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* ignore */
  }
}

interface ArtStyleBarProps {
  readonly value: ArtStyleId;
  readonly onChange: (next: ArtStyleId) => void;
  readonly disabled?: boolean;
}

export const ArtStyleBar: React.FC<ArtStyleBarProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const { isDark } = useTheme();
  const { t } = useT();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <Text
        style={{
          fontSize: 12,
          color: isDark ? '#a1a1aa' : '#64748b',
          whiteSpace: 'nowrap',
        }}
      >
        {t('intake.q.artTone')}
      </Text>
      <Tooltip title={t('intake.art.hint')}>
        <Select<ArtStyleId>
          size="small"
          value={value}
          disabled={disabled}
          onChange={onChange}
          style={{ minWidth: 148 }}
          options={ART_STYLES.map((p) => ({
            value: p.id,
            label: t(`intake.art.${p.id}`),
          }))}
        />
      </Tooltip>
      <Text
        type="secondary"
        style={{ fontSize: 11, flex: '1 1 160px', minWidth: 0 }}
        ellipsis
      >
        {t(`intake.art.${value}.desc`)}
      </Text>
    </div>
  );
};
