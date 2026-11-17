/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Typography, Collapse, Tag, Button, Space, Empty } from 'antd';
import {
  FileTextOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CaretDownOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface FileChange {
  filename: string;
  type: 'added' | 'modified' | 'deleted';
  summary?: string;
  diff?: string;
}

interface CodeChangesProps {
  changes: FileChange[];
  onViewDiff?: (filename: string, diff: string) => void;
  collapsible?: boolean;
}

export const CodeChanges: React.FC<CodeChangesProps> = ({
  changes,
  onViewDiff,
  collapsible = true,
}) => {
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  if (changes.length === 0) {
    return null;
  }

  const getFileIcon = (type: FileChange['type']) => {
    switch (type) {
      case 'added':
        return <PlusOutlined style={{ color: '#22c55e' }} />;
      case 'modified':
        return <EditOutlined style={{ color: '#f59e0b' }} />;
      case 'deleted':
        return <DeleteOutlined style={{ color: '#ef4444' }} />;
    }
  };

  const getFileTagColor = (type: FileChange['type']) => {
    switch (type) {
      case 'added':
        return 'green';
      case 'modified':
        return 'orange';
      case 'deleted':
        return 'red';
    }
  };

  const getFileTypeLabel = (filename: string) => {
    if (filename.endsWith('.html')) return 'HTML';
    if (filename.endsWith('.css')) return 'CSS';
    if (filename.endsWith('.js') || filename.endsWith('.mjs')) return 'JS';
    if (filename.endsWith('.ts') || filename.endsWith('.tsx')) return 'TS';
    if (filename.endsWith('.json')) return 'JSON';
    if (filename.endsWith('.md')) return 'DOC';
    return 'FILE';
  };

  const collapseItems = changes.map((change) => ({
    key: change.filename,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {getFileIcon(change.type)}
        <Text code style={{ fontSize: 12 }}>{change.filename}</Text>
        <Tag color={getFileTagColor(change.type)} style={{ marginLeft: 4 }}>
          {change.type === 'added' ? '新增' : change.type === 'modified' ? '修改' : '删除'}
        </Tag>
        {change.summary && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {change.summary}
          </Text>
        )}
      </div>
    ),
    children: (
      <div>
        {change.diff ? (
          <pre
            style={{
              background: '#1f1f1f',
              padding: 12,
              borderRadius: 6,
              fontSize: 11,
              overflow: 'auto',
              maxHeight: 300,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {change.diff}
          </pre>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无变更详情"
          />
        )}
        {change.diff && onViewDiff && (
          <Button
            type="link"
            size="small"
            onClick={() => onViewDiff(change.filename, change.diff!)}
          >
            查看完整 Diff
          </Button>
        )}
      </div>
    ),
  }));

  return (
    <div
      style={{
        padding: '12px 16px',
        background: '#1a1a1a',
        borderTop: '1px solid #303030',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: collapsible ? 8 : 0,
        }}
      >
        <Space>
          <FileTextOutlined style={{ color: 'var(--color-ember)' }} />
          <Text strong style={{ color: '#e4e4e7', fontSize: 13 }}>
            代码变更
          </Text>
          <Tag>{changes.length} 个文件</Tag>
        </Space>

        <div style={{ display: 'flex', gap: 8 }}>
          {changes.filter((c) => c.type === 'added').length > 0 && (
            <Tag color="green">
              +{changes.filter((c) => c.type === 'added').length}
            </Tag>
          )}
          {changes.filter((c) => c.type === 'modified').length > 0 && (
            <Tag color="orange">
              ~{changes.filter((c) => c.type === 'modified').length}
            </Tag>
          )}
          {changes.filter((c) => c.type === 'deleted').length > 0 && (
            <Tag color="red">
              -{changes.filter((c) => c.type === 'deleted').length}
            </Tag>
          )}
        </div>
      </div>

      {collapsible ? (
        <Collapse
          items={collapseItems}
          activeKey={expandedKeys}
          onChange={(keys) => setExpandedKeys(keys as string[])}
          ghost
          expandIcon={({ isActive }) => (
            <CaretDownOutlined
              rotate={isActive ? 90 : 0}
              style={{ color: '#a1a1aa' }}
            />
          )}
        />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {changes.map((change) => (
            <Tag
              key={change.filename}
              icon={getFileIcon(change.type)}
              color={getFileTagColor(change.type)}
              style={{ padding: '4px 8px' }}
            >
              {change.filename}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
};
