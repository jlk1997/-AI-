/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Header mode switch — Game Studio vs Society World (Mode-first IA).
 */

import React from 'react';
import { Segmented } from 'antd';
import { RocketOutlined, GlobalOutlined } from '@ant-design/icons';
import { useT } from '../../services/i18n';
import type { GenerationMode } from '../World/worldTemplates';

export interface StudioModeSwitchProps {
  readonly mode: GenerationMode;
  readonly onChange: (mode: GenerationMode) => void;
}

export const StudioModeSwitch: React.FC<StudioModeSwitchProps> = ({
  mode,
  onChange,
}) => {
  const { t } = useT();
  return (
    <Segmented
      size="middle"
      value={mode}
      onChange={(v) => onChange(v as GenerationMode)}
      options={[
        {
          value: 'game',
          icon: <RocketOutlined />,
          label: t('product.mode.game'),
        },
        {
          value: 'world',
          icon: <GlobalOutlined />,
          label: t('product.mode.world'),
        },
      ]}
    />
  );
};
