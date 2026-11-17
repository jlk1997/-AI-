/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compact params row under chat — light chips, full controls live in a drawer.
 */

import React, { useState } from 'react';
import {
  Space,
  Tooltip,
  Typography,
  Dropdown,
  Button,
  Drawer,
  Rate,
} from 'antd';
import {
  ThunderboltOutlined,
  ExperimentOutlined,
  SettingOutlined,
  DownOutlined,
} from '@ant-design/icons';
import { ThemeSelector } from '../Theme/ThemeSelector';
import { VariantSelector } from '../Variant/VariantSelector';
import { GameParamsPanel, GameThemeParams } from '../Params/GameParamsPanel';
import { themes } from '../Theme/themes';
import { variants } from '../Variant/variants';
import { useT } from '../../services/i18n';

const { Text } = Typography;

interface GameConfigBarProps {
  params: GameThemeParams;
  onChange: (params: GameThemeParams) => void;
  collapsed?: boolean;
}

export const GameConfigBar: React.FC<GameConfigBarProps> = ({
  params,
  onChange,
}) => {
  const { t } = useT();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const selectedTheme = themes.find((item) => item.id === params.theme);
  const selectedVariant = variants.find((item) => item.id === params.variant);
  const difficultyName = t(`product.params.difficulty.${params.difficulty}`);

  const chip: React.CSSProperties = {
    height: 28,
    padding: '0 10px',
    fontSize: 12,
    color: 'var(--text-secondary)',
    background: 'var(--bg-lane)',
    border: '1px solid var(--border-color)',
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  };

  const popupSurface: React.CSSProperties = {
    padding: 16,
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: 12,
    boxShadow: '0 12px 40px rgba(15,23,42,0.12)',
    maxHeight: 'min(70vh, 520px)',
    overflowY: 'auto',
  };

  const themeDropdownContent = (
    <div style={{ ...popupSurface, width: 400 }}>
      <Text strong style={{ display: 'block', marginBottom: 12 }}>
        {t('product.params.theme')}
      </Text>
      <ThemeSelector
        value={params.theme}
        onChange={(themeId) => onChange({ ...params, theme: themeId })}
      />
    </div>
  );

  const variantDropdownContent = (
    <div style={{ ...popupSurface, width: 280 }}>
      <Text strong style={{ display: 'block', marginBottom: 12 }}>
        {t('product.params.variant')}
      </Text>
      <VariantSelector
        value={params.variant}
        onChange={(variantId) => onChange({ ...params, variant: variantId })}
      />
    </div>
  );

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          padding: '4px 0',
        }}
      >
        <Space size={6} wrap>
          <Dropdown
            popupRender={() => themeDropdownContent}
            trigger={['click']}
            placement="topLeft"
            overlayStyle={{ zIndex: 1200 }}
          >
            <Button type="text" style={chip}>
              <ThunderboltOutlined style={{ fontSize: 11 }} />
              <span>
                {selectedTheme?.preview} {selectedTheme?.name}
              </span>
              <DownOutlined style={{ fontSize: 9 }} />
            </Button>
          </Dropdown>

          <Dropdown
            popupRender={() => variantDropdownContent}
            trigger={['click']}
            placement="topLeft"
            overlayStyle={{ zIndex: 1200 }}
          >
            <Button type="text" style={chip}>
              <ExperimentOutlined style={{ fontSize: 11 }} />
              <span>
                {selectedVariant?.icon} {selectedVariant?.name}
              </span>
              <DownOutlined style={{ fontSize: 9 }} />
            </Button>
          </Dropdown>

          <Tooltip title={t('product.params.difficultyHint')}>
            <span style={{ ...chip, gap: 6 }}>
              <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {t('product.params.difficulty')}
              </Text>
              <Rate
                count={5}
                value={params.difficulty}
                onChange={(val) =>
                  onChange({ ...params, difficulty: val || 1 })
                }
                style={{ fontSize: 13, lineHeight: 1, color: '#f59e0b' }}
              />
              <Text style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {difficultyName}
              </Text>
            </span>
          </Tooltip>
        </Space>

        <Button
          type="link"
          size="small"
          icon={<SettingOutlined />}
          onClick={() => setAdvancedOpen(true)}
          style={{ padding: 0, height: 28, fontSize: 12 }}
        >
          {t('product.params.more')}
        </Button>
      </div>

      <Drawer
        title={t('product.params.drawer')}
        placement="right"
        size={460}
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        destroyOnHidden={false}
        zIndex={1300}
        styles={{
          header: {
            background: 'var(--bg-card)',
            borderBottom: '1px solid var(--border-color)',
          },
          body: {
            background: 'var(--bg-layout)',
          },
        }}
      >
        <GameParamsPanel value={params} onChange={onChange} />
      </Drawer>
    </>
  );
};
