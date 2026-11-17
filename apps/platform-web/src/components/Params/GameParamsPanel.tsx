/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Card, Slider, Select, Button, Space, Typography, Segmented } from 'antd';
import { SoundOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { ThemeSelector } from '../Theme/ThemeSelector';
import { VariantSelector } from '../Variant/VariantSelector';
import { themes } from '../Theme/themes';
import { variants } from '../Variant/variants';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../services/i18n';

const { Text, Paragraph } = Typography;

export interface GameThemeParams {
  theme: string;
  variant: string;
  difficulty: number;
  musicStyle: string;
  effectsVolume: number;
  gameSpeed: number;
  lives: number;
  timeLimit?: number;
}

export type GameParams = GameThemeParams;

interface GameParamsPanelProps {
  value?: GameThemeParams;
  onChange: (params: GameThemeParams) => void;
}

export const defaultGameThemeParams: GameThemeParams = {
  theme: 'cyberpunk',
  variant: 'classic',
  difficulty: 2,
  musicStyle: 'synthwave',
  effectsVolume: 80,
  gameSpeed: 1,
  lives: 3,
};

/** Older UI stored volume as 0–1; the slider is 0–100. */
export function normalizeGameThemeParams(raw: GameThemeParams): GameThemeParams {
  const volume =
    raw.effectsVolume <= 1 ? Math.round(raw.effectsVolume * 100) : raw.effectsVolume;
  return {
    ...defaultGameThemeParams,
    ...raw,
    difficulty: Math.min(5, Math.max(1, Math.round(raw.difficulty || 2))),
    effectsVolume: Math.min(100, Math.max(0, volume)),
  };
}

export const GameParamsPanel: React.FC<GameParamsPanelProps> = ({
  value,
  onChange,
}) => {
  const { isDark } = useTheme();
  const { t } = useT();
  const params = normalizeGameThemeParams(value || defaultGameThemeParams);

  const surface: React.CSSProperties = {
    background: isDark ? '#18181b' : '#ffffff',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0'}`,
    borderRadius: 10,
    padding: 14,
  };
  const labelColor = isDark ? '#e4e4e7' : '#0f172a';
  const mutedColor = isDark ? '#a1a1aa' : '#64748b';
  const chipBg = isDark ? '#3f3f46' : '#e2e8f0';
  const chipFg = isDark ? '#fafafa' : '#0f172a';

  const updateParam = <K extends keyof GameThemeParams>(
    key: K,
    val: GameParams[K],
  ) => {
    onChange({ ...params, [key]: val });
  };

  const musicOptions = [
    { value: 'chiptune', label: t('product.params.music.chiptune') },
    { value: 'synthwave', label: t('product.params.music.synthwave') },
    { value: 'orchestra', label: t('product.params.music.orchestra') },
    { value: '8bit', label: t('product.params.music.8bit') },
    { value: 'none', label: t('product.params.music.none') },
  ];

  const difficultyName = t(`product.params.difficulty.${params.difficulty}`);
  const difficultyOptions = [1, 2, 3, 4, 5].map((n) => ({
    label: t(`product.params.difficulty.${n}`),
    value: n,
  }));

  return (
    <div style={{ padding: '0 4px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: 12,
        }}
      >
        <Button size="small" onClick={() => onChange(defaultGameThemeParams)}>
          {t('product.params.reset')}
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <section style={surface}>
          <Text strong style={{ display: 'block', marginBottom: 8, color: labelColor }}>
            {t('product.params.theme')}
          </Text>
          <Text style={{ display: 'block', marginBottom: 12, color: mutedColor, fontSize: 12 }}>
            {t('product.params.themeHint')}
          </Text>
          <ThemeSelector
            value={params.theme}
            onChange={(theme) => updateParam('theme', theme)}
          />
        </section>

        <section style={surface}>
          <Space align="center" style={{ marginBottom: 8 }}>
            <ThunderboltOutlined style={{ color: mutedColor }} />
            <Text strong style={{ color: labelColor }}>
              {t('product.params.play')}
            </Text>
          </Space>
          <div style={{ marginBottom: 16 }}>
            <Text style={{ display: 'block', marginBottom: 8, color: mutedColor, fontSize: 12 }}>
              {t('product.params.variant')}
            </Text>
            <VariantSelector
              value={params.variant}
              onChange={(variant) => updateParam('variant', variant)}
            />
          </div>

          <div style={{ marginBottom: 4 }}>
            <Text strong style={{ display: 'block', color: labelColor }}>
              {t('product.params.difficulty')} · {difficultyName} ({params.difficulty}/5)
            </Text>
            <Paragraph style={{ margin: '6px 0 10px', color: mutedColor, fontSize: 12 }}>
              {t('product.params.difficultyHint')}
            </Paragraph>
            <Segmented
              block
              value={params.difficulty}
              options={difficultyOptions}
              onChange={(val) => updateParam('difficulty', Number(val))}
            />
          </div>

          <div style={{ marginTop: 20 }}>
            <Text strong style={{ display: 'block', marginBottom: 8, color: labelColor }}>
              {t('product.params.speed')} ({params.gameSpeed}x)
            </Text>
            <Slider
              min={0.5}
              max={2}
              step={0.1}
              value={params.gameSpeed}
              onChange={(val) => updateParam('gameSpeed', val)}
              marks={{ 0.5: '0.5x', 1: '1x', 1.5: '1.5x', 2: '2x' }}
            />
          </div>

          <div style={{ marginTop: 8 }}>
            <Text strong style={{ display: 'block', marginBottom: 8, color: labelColor }}>
              {t('product.params.lives')}
            </Text>
            <Slider
              min={1}
              max={10}
              value={params.lives}
              onChange={(val) => updateParam('lives', val)}
              marks={{ 1: '1', 3: '3', 5: '5', 10: '10' }}
            />
          </div>

          {params.variant === 'time-attack' && (
            <div style={{ marginTop: 8 }}>
              <Text strong style={{ display: 'block', marginBottom: 8, color: labelColor }}>
                {t('product.params.timeLimit')}
              </Text>
              <Slider
                min={30}
                max={300}
                step={10}
                value={params.timeLimit || 60}
                onChange={(val) => updateParam('timeLimit', val)}
                marks={{ 30: '30s', 60: '60s', 120: '120s', 300: '300s' }}
              />
            </div>
          )}
        </section>

        <section style={surface}>
          <Space align="center" style={{ marginBottom: 12 }}>
            <SoundOutlined style={{ color: mutedColor }} />
            <Text strong style={{ color: labelColor }}>
              {t('product.params.audio')}
            </Text>
          </Space>
          <Text style={{ display: 'block', marginBottom: 8, color: mutedColor, fontSize: 12 }}>
            {t('product.params.music')}
          </Text>
          <Select
            value={params.musicStyle}
            onChange={(val) => updateParam('musicStyle', val)}
            options={musicOptions}
            style={{ width: '100%', marginBottom: 16 }}
          />
          <Text strong style={{ display: 'block', marginBottom: 8, color: labelColor }}>
            {t('product.params.volume')} ({params.effectsVolume}%)
          </Text>
          <Slider
            min={0}
            max={100}
            value={params.effectsVolume}
            onChange={(val) => updateParam('effectsVolume', val)}
          />
        </section>
      </div>

      <Card
        size="small"
        title={t('product.params.preview')}
        styles={{
          header: {
            color: labelColor,
            background: isDark ? '#18181b' : '#f8fafc',
          },
          body: {
            background: isDark ? '#18181b' : '#f8fafc',
          },
        }}
        style={{
          marginTop: 16,
          background: isDark ? '#18181b' : '#f8fafc',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0'}`,
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Text
            style={{
              padding: '4px 12px',
              background: chipBg,
              color: chipFg,
              borderRadius: 4,
              fontSize: 12,
              borderLeft: `3px solid ${themes.find((th) => th.id === params.theme)?.colors.primary ?? '#6366f1'}`,
            }}
          >
            {themes.find((th) => th.id === params.theme)?.name}
          </Text>
          <Text
            style={{
              padding: '4px 12px',
              background: chipBg,
              color: chipFg,
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {variants.find((v) => v.id === params.variant)?.icon}{' '}
            {variants.find((v) => v.id === params.variant)?.name}
          </Text>
          <Text
            style={{
              padding: '4px 12px',
              background: chipBg,
              color: chipFg,
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {t('product.params.difficulty')}: {difficultyName}
          </Text>
          <Text
            style={{
              padding: '4px 12px',
              background: chipBg,
              color: chipFg,
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {t('product.params.speed')}: {params.gameSpeed}x
          </Text>
        </div>
      </Card>
    </div>
  );
};
