/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Observatory "why" bar: demand, surprise, cited memory — not marketing copy.
 */

import React from 'react';
import { Space, Tag, Typography } from 'antd';

const { Text } = Typography;

export interface SocietyWhyStripProps {
  readonly demand?: string | null;
  readonly surprise?: string | null;
  readonly citedMemoryIds?: readonly string[] | null;
  readonly retrievalDegraded?: boolean;
}

export function SocietyWhyStrip(props: SocietyWhyStripProps): React.ReactElement | null {
  const { demand, surprise, citedMemoryIds, retrievalDegraded } = props;
  if (!demand && !surprise && !citedMemoryIds?.length && !retrievalDegraded) {
    return null;
  }
  return (
    <div
      data-testid="society-why-strip"
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        background: 'rgba(15,23,42,0.04)',
        marginBottom: 8,
      }}
    >
      <Text strong style={{ fontSize: 12 }}>
        为什么条 · Why
      </Text>
      <Space wrap size={[4, 4]} style={{ display: 'flex', marginTop: 6 }}>
        {demand ? <Tag color="blue">需求 {demand}</Tag> : null}
        {surprise ? <Tag color="orange">惊讶 {surprise}</Tag> : null}
        {citedMemoryIds?.length ? (
          <Tag>记忆 {citedMemoryIds.slice(0, 3).join(' · ')}</Tag>
        ) : null}
        {retrievalDegraded ? <Tag color="gold">检索降级</Tag> : null}
      </Space>
    </div>
  );
}
