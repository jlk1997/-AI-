/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Drawer, Rate, Slider, Space, Typography } from 'antd';
import type { ArtStyleId } from '@opengame/world-spec';

import { ArtStyleBar } from '../../components/Params/ArtStyleBar.js';
import type { GameThemeParams } from '../../components/Params/GameParamsPanel.js';
import { themes } from '../../components/Theme/themes.js';
import { variants } from '../../components/Variant/variants.js';
import { WorldCreateGuide } from '../../components/World/WorldCreateGuide.js';
import type { WorldCreatePrefs } from '../../components/World/worldCreatePrefs.js';
import { useT } from '../../services/i18n.js';

const { Text } = Typography;

export interface ConfigSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly mode: 'game' | 'world';
  readonly artStyleId: ArtStyleId;
  readonly onArtStyleChange: (next: ArtStyleId) => void;
  readonly params: GameThemeParams;
  readonly onParamsChange: (next: GameThemeParams) => void;
  readonly worldPrefs: WorldCreatePrefs;
  readonly onWorldPrefsChange: (next: WorldCreatePrefs) => void;
  readonly disabled: boolean;
}

function ChipRow<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  readonly value: T;
  readonly options: ReadonlyArray<{ id: T; label: string; icon?: string }>;
  readonly onChange: (next: T) => void;
  readonly disabled: boolean;
}): React.ReactElement {
  return (
    <div className="og-chip-rail" style={{ padding: 0 }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={disabled}
          className={`og-config-chip${o.id === value ? ' og-config-chip--on' : ''}`}
          onClick={() => onChange(o.id)}
        >
          {o.icon ? `${o.icon} ` : ''}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The desktop packs theme, variant, difficulty and art style into a strip above
 * the chat box. On a phone that strip becomes unreadable, so the same controls
 * get a full sheet with one decision per row.
 */
export const ConfigSheet: React.FC<ConfigSheetProps> = ({
  open,
  onClose,
  mode,
  artStyleId,
  onArtStyleChange,
  params,
  onParamsChange,
  worldPrefs,
  onWorldPrefsChange,
  disabled,
}) => {
  const { t } = useT();

  return (
    <Drawer
      className="og-sheet"
      placement="bottom"
      size="auto"
      open={open}
      onClose={onClose}
      title={t('mobile.studio.config.title')}
    >
      {mode === 'world' ? (
        <WorldCreateGuide
          value={worldPrefs}
          onChange={onWorldPrefsChange}
          disabled={disabled}
        />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Text strong style={{ fontSize: 13 }}>
              {t('mobile.studio.config.theme')}
            </Text>
            <ChipRow
              value={params.theme}
              disabled={disabled}
              options={themes.map((x) => ({
                id: x.id,
                label: x.name,
                icon: x.preview,
              }))}
              onChange={(theme) => onParamsChange({ ...params, theme })}
            />
          </div>

          <div>
            <Text strong style={{ fontSize: 13 }}>
              {t('mobile.studio.config.variant')}
            </Text>
            <ChipRow
              value={params.variant}
              disabled={disabled}
              options={variants.map((x) => ({
                id: x.id,
                label: x.name,
                icon: x.icon,
              }))}
              onChange={(variant) => onParamsChange({ ...params, variant })}
            />
          </div>

          <div>
            <Text strong style={{ fontSize: 13 }}>
              {t('mobile.studio.config.difficulty')}
            </Text>
            <div style={{ marginTop: 6 }}>
              <Rate
                count={5}
                value={params.difficulty}
                disabled={disabled}
                onChange={(difficulty) =>
                  onParamsChange({ ...params, difficulty: difficulty || 1 })
                }
              />
            </div>
          </div>

          <div>
            <Text strong style={{ fontSize: 13 }}>
              {t('mobile.studio.config.speed')}
            </Text>
            <Slider
              min={0.5}
              max={2}
              step={0.1}
              value={params.gameSpeed}
              disabled={disabled}
              onChange={(gameSpeed) => onParamsChange({ ...params, gameSpeed })}
            />
          </div>

          <ArtStyleBar
            value={artStyleId}
            onChange={onArtStyleChange}
            disabled={disabled}
          />
        </Space>
      )}
    </Drawer>
  );
};

export default ConfigSheet;
