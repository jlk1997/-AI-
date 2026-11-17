/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One-line mode hint under chat (ModeSwitch lives in the header).
 */

import React from 'react';
import { Typography } from 'antd';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../services/i18n';
import type { GenerationMode } from './worldTemplates';

const { Text } = Typography;

export interface GenerationModeBarProps {
  readonly mode: GenerationMode;
  readonly onChange?: (mode: GenerationMode) => void;
  readonly onOpenWorldPanel?: () => void;
}

/** Hint-only strip — primary mode control is StudioModeSwitch in the header. */
export const GenerationModeBar: React.FC<GenerationModeBarProps> = ({
  mode,
  onOpenWorldPanel,
}) => {
  const { isDark } = useTheme();
  const { t } = useT();

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        marginBottom: 10,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          color: isDark ? '#a1a1aa' : '#64748b',
          flex: '1 1 180px',
        }}
      >
        {mode === 'world'
          ? t('product.hint.world')
          : t('product.hint.game')}
      </Text>
      {mode === 'world' && onOpenWorldPanel ? (
        <Typography.Link
          style={{ fontSize: 12, whiteSpace: 'nowrap' }}
          onClick={onOpenWorldPanel}
        >
          {t('product.tools.world')}
        </Typography.Link>
      ) : null}
    </div>
  );
};
