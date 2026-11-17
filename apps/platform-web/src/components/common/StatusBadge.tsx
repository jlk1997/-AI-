/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Badge } from 'antd';
import type { CSSProperties } from 'react';

type BadgeStatus = 'success' | 'warning' | 'error' | 'default' | 'processing';

interface StatusBadgeProps {
  status: string;
  map?: Record<string, { color: BadgeStatus; text: string }>;
  style?: CSSProperties;
}

const defaultStatusMap: Record<string, { color: BadgeStatus; text: string }> = {
  completed: { color: 'success', text: '已完成' },
  running: { color: 'processing', text: '运行中' },
  pending: { color: 'default', text: '等待中' },
  failed: { color: 'error', text: '失败' },
  active: { color: 'success', text: '活跃' },
  inactive: { color: 'default', text: '未激活' },
  deploying: { color: 'processing', text: '部署中' },
};

export function StatusBadge({ status, map = defaultStatusMap, style }: StatusBadgeProps): React.ReactElement {
  const config = map[status.toLowerCase()] || { color: 'default' as BadgeStatus, text: status };

  return (
    <Badge status={config.color} text={config.text} style={style} />
  );
}
