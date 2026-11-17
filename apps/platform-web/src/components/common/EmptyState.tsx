/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Empty, Button } from 'antd';
import type { CSSProperties } from 'react';

interface EmptyStateProps {
  description?: string;
  icon?: React.ReactNode;
  actionText?: string;
  onAction?: () => void;
  style?: CSSProperties;
}

export function EmptyState({
  description = '暂无数据',
  icon,
  actionText,
  onAction,
  style,
}: EmptyStateProps): React.ReactElement {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={description}
      style={{ padding: '40px 0', ...style }}
    >
      {actionText && onAction && (
        <Button type="primary" onClick={onAction}>
          {actionText}
        </Button>
      )}
    </Empty>
  );
}
