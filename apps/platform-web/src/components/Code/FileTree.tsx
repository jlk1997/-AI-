/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Typography, Tag, Empty } from 'antd';
import {
  FileOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

export interface FileTreeChange {
  readonly filename: string;
  readonly type: 'added' | 'modified' | 'deleted';
  readonly summary?: string;
  readonly diff?: string;
}

interface FileTreeProps {
  readonly changes: ReadonlyArray<FileTreeChange>;
  readonly selectedPath?: string | null;
  readonly onSelect?: (change: FileTreeChange) => void;
}

interface DirNode {
  readonly name: string;
  readonly fullPath: string;
  readonly dirs: Map<string, DirNode>;
  readonly files: FileTreeChange[];
}

function makeDir(name: string, fullPath: string): DirNode {
  return { name, fullPath, dirs: new Map(), files: [] };
}

function buildTree(changes: ReadonlyArray<FileTreeChange>): DirNode {
  const root = makeDir('', '');
  for (const change of changes) {
    const parts = change.filename.split(/[\\/]/).filter(Boolean);
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!;
      const path = parts.slice(0, i + 1).join('/');
      let next = cursor.dirs.get(seg);
      if (!next) {
        next = makeDir(seg, path);
        cursor.dirs.set(seg, next);
      }
      cursor = next;
    }
    cursor.files.push(change);
  }
  return root;
}

function changeIcon(type: FileTreeChange['type']): React.ReactNode {
  switch (type) {
    case 'added':
      return <PlusOutlined style={{ color: '#22c55e', fontSize: 10 }} />;
    case 'modified':
      return <EditOutlined style={{ color: '#f59e0b', fontSize: 10 }} />;
    case 'deleted':
      return <DeleteOutlined style={{ color: '#ef4444', fontSize: 10 }} />;
  }
}

interface DirRowProps {
  readonly node: DirNode;
  readonly depth: number;
  readonly selectedPath?: string | null;
  readonly onSelect: (c: FileTreeChange) => void;
  readonly forceOpen: boolean;
}

const DirRow: React.FC<DirRowProps> = ({ node, depth, selectedPath, onSelect, forceOpen }) => {
  const [open, setOpen] = useState<boolean>(forceOpen || depth === 0);
  const indent = depth * 12;
  return (
    <div>
      {node.name && (
        <div
          onClick={() => setOpen((v) => !v)}
          style={{
            padding: `4px ${8 + indent}px`,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
            color: '#a1a1aa',
            fontSize: 12,
            userSelect: 'none',
          }}
        >
          {open ? <FolderOpenOutlined /> : <FolderOutlined />}
          <span>{node.name}</span>
        </div>
      )}
      {open && (
        <div>
          {Array.from(node.dirs.values()).map((child) => (
            <DirRow
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              forceOpen={false}
            />
          ))}
          {node.files.map((file) => {
            const selected = selectedPath === file.filename;
            return (
              <div
                key={file.filename}
                onClick={() => onSelect(file)}
                style={{
                  padding: `4px 8px 4px ${8 + (depth + 1) * 12}px`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  background: selected ? 'rgba(99,102,241,0.16)' : 'transparent',
                  color: selected ? '#a5b4fc' : '#e4e4e7',
                  fontSize: 12,
                  borderRadius: 4,
                }}
              >
                <FileOutlined style={{ fontSize: 11 }} />
                <span style={{ flex: 1 }}>
                  {file.filename.split(/[\\/]/).pop()}
                </span>
                {changeIcon(file.type)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Renders the result of `parseCodeChangesFromOutput` as a collapsible tree. We
 * intentionally avoid `antd`'s `Tree` to keep the visual closer to a real IDE
 * file panel (compact rows, change indicators inline, no expand icons cluttering
 * the gutter). Selection bubbles up via `onSelect` so the parent can drive the
 * DiffViewer.
 */
export const FileTree: React.FC<FileTreeProps> = ({ changes, selectedPath, onSelect }) => {
  const tree = useMemo(() => buildTree(changes), [changes]);
  const summary = useMemo(() => {
    let added = 0;
    let modified = 0;
    let deleted = 0;
    for (const c of changes) {
      if (c.type === 'added') added++;
      else if (c.type === 'modified') modified++;
      else if (c.type === 'deleted') deleted++;
    }
    return { added, modified, deleted };
  }, [changes]);

  if (changes.length === 0) {
    return (
      <div style={{ padding: 12 }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text type="secondary" style={{ fontSize: 12 }}>
              本次生成尚未报告文件变更
            </Text>
          }
        />
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 4,
        background: 'rgba(15, 23, 42, 0.4)',
        border: '1px solid rgba(99,102,241,0.18)',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          borderBottom: '1px solid rgba(99,102,241,0.18)',
        }}
      >
        <Text strong style={{ fontSize: 11, color: '#a5b4fc' }}>
          文件变更
        </Text>
        <Tag color="green" style={{ fontSize: 10, lineHeight: '14px', margin: 0 }}>
          +{summary.added}
        </Tag>
        <Tag color="orange" style={{ fontSize: 10, lineHeight: '14px', margin: 0 }}>
          ~{summary.modified}
        </Tag>
        <Tag color="red" style={{ fontSize: 10, lineHeight: '14px', margin: 0 }}>
          -{summary.deleted}
        </Tag>
      </div>
      <DirRow
        node={tree}
        depth={0}
        selectedPath={selectedPath}
        onSelect={(c) => onSelect?.(c)}
        forceOpen
      />
    </div>
  );
};
