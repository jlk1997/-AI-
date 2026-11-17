/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compact traffic-light acceptance strip — details live in the quality drawer.
 */

import React, { useMemo } from 'react';
import { Button, Space, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../services/i18n';
import type { AcceptanceCheckItem } from '../../utils/acceptanceChecks';

const { Text } = Typography;

export interface GameAcceptanceStripProps {
  readonly checks: AcceptanceCheckItem[];
  readonly onOpenQuality?: () => void;
}

export const GameAcceptanceStrip: React.FC<GameAcceptanceStripProps> = ({
  checks,
  onOpenQuality,
}) => {
  const { isDark } = useTheme();
  const { t } = useT();

  const summary = useMemo(() => {
    if (!checks.length) return null;
    if (checks.some((c) => c.status === 'fail')) return 'fail' as const;
    if (checks.some((c) => c.status === 'pending')) return 'warn' as const;
    if (checks.every((c) => c.status === 'pass')) return 'pass' as const;
    return 'warn' as const;
  }, [checks]);

  if (!summary) return null;

  const icon =
    summary === 'pass' ? (
      <CheckCircleOutlined style={{ color: '#22c55e' }} />
    ) : summary === 'fail' ? (
      <CloseCircleOutlined style={{ color: '#ef4444' }} />
    ) : (
      <WarningOutlined style={{ color: '#eab308' }} />
    );

  const label =
    summary === 'pass'
      ? t('product.accept.pass')
      : summary === 'fail'
        ? t('product.accept.fail')
        : t('product.accept.warn');

  const req = checks.find((c) => c.id === 'requirements');

  return (
    <div
      style={{
        flexShrink: 0,
        padding: '4px 14px',
        background: isDark ? '#0f172a' : '#f8fafc',
        borderBottom: `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <Space size={6}>
        {icon}
        <Text style={{ fontSize: 12, color: isDark ? '#94a3b8' : '#64748b' }}>
          {t('product.accept.label')}: {label}
          {req
            ? ` · ${t('generate.acceptance.requirements')} ${req.label.replace(/^Named mechanics\s+/, '')}`
            : ''}
        </Text>
      </Space>
      {onOpenQuality ? (
        <Button type="link" size="small" onClick={onOpenQuality} style={{ padding: 0 }}>
          {t('product.accept.details')}
        </Button>
      ) : null}
    </div>
  );
};
