/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Select, Typography } from 'antd';
import { variants } from './variants';

const { Text } = Typography;

interface VariantSelectorProps {
  value?: string;
  onChange: (variantId: string) => void;
}

export const VariantSelector: React.FC<VariantSelectorProps> = ({
  value,
  onChange,
}) => {
  const options = variants.map((v) => ({
    value: v.id,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>{v.icon}</span>
        <div>
          <div style={{ fontWeight: 500 }}>{v.name}</div>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {v.description}
          </Text>
        </div>
      </div>
    ),
  }));

  return (
    <Select
      value={value || 'classic'}
      onChange={onChange}
      options={options}
      style={{ width: '100%' }}
      placeholder="选择玩法变体"
    />
  );
};
