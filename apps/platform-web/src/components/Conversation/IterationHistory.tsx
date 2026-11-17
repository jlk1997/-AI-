/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Card, Typography, Timeline, Tag, Button, Space, Tooltip, Modal, message, Badge } from 'antd';
import {
  HistoryOutlined,
  UndoOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  MessageOutlined,
  FileTextOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

export interface IterationRecord {
  id: string;
  version: number;
  timestamp: string;
  prompt: string;
  changes: Array<{
    filename: string;
    type: 'added' | 'modified' | 'deleted';
  }>;
  status: 'success' | 'failed';
  contentHash?: string;
}

interface IterationHistoryProps {
  iterations: IterationRecord[];
  currentVersion: number;
  onRestoreVersion?: (version: number) => void;
  messages?: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    codeChanges?: {
      files: string[];
      summary: string;
    };
  }>;
}

export const IterationHistory: React.FC<IterationHistoryProps> = ({
  iterations,
  currentVersion,
  onRestoreVersion,
  messages = [],
}) => {
  const [modalVisible, setModalVisible] = useState(false);

  // 从消息中生成迭代记录
  const generatedIterations = useMemo(() => {
    const records: IterationRecord[] = [];
    let version = 1;

    // 按时间顺序遍历消息，找到所有有代码变更的 AI 回复
    messages.forEach((msg) => {
      if (msg.role === 'assistant' && msg.codeChanges && msg.codeChanges.files.length > 0) {
        records.push({
          id: `iter-${version}`,
          version: version++,
          timestamp: new Date().toISOString(),
          prompt: messages.find((m, i) => i < messages.indexOf(msg) && m.role === 'user')?.content || '首次生成',
          changes: msg.codeChanges.files.map((filename) => ({
            filename,
            type: 'added' as const,
          })),
          status: 'success',
        });
      }
    });

    return records;
  }, [messages]);

  // 合并传入的迭代记录和从消息生成的记录
  const allIterations = useMemo(() => {
    if (iterations.length > 0) return iterations;
    return generatedIterations;
  }, [iterations, generatedIterations]);

  const handleRestore = (version: number) => {
    Modal.confirm({
      title: '恢复版本',
      content: `确定要恢复到第 ${version} 版吗？当前版本之后的修改将会丢失。`,
      okText: '确定恢复',
      cancelText: '取消',
      onOk: () => {
        onRestoreVersion?.(version);
        message.success(`已恢复到第 ${version} 版`);
        setModalVisible(false);
      },
    });
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} 小时前`;
    return date.toLocaleDateString();
  };

  const getChangeTypeTag = (type: 'added' | 'modified' | 'deleted') => {
    const config = {
      added: { color: '#22c55e', icon: <PlusOutlined />, text: '新增' },
      modified: { color: '#3b82f6', icon: <EditOutlined />, text: '修改' },
      deleted: { color: '#ef4444', icon: <DeleteOutlined />, text: '删除' },
    };
    const c = config[type];
    return (
      <Tag key={type} color={c.color} icon={c.icon} style={{ marginRight: 4 }}>
        {c.text}
      </Tag>
    );
  };

  return (
    <>
      <Tooltip title="查看迭代历史">
        <Badge count={allIterations.length} size="small" offset={[5, 0]}>
          <Button
            type="text"
            icon={<HistoryOutlined />}
            onClick={() => setModalVisible(true)}
            style={{ color: '#a1a1aa' }}
          >
            迭代
          </Button>
        </Badge>
      </Tooltip>

      <Modal
        title={
          <Space>
            <HistoryOutlined />
            <span>游戏迭代历史</span>
          </Space>
        }
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={700}
        styles={{ body: { maxHeight: 500, overflow: 'auto' } }}
      >
        {allIterations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#71717a' }}>
            <FileTextOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }} />
            <div>暂无迭代历史</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              开始你的第一次创作，AI 会记录每一次修改
            </Text>
          </div>
        ) : (
          <Timeline
            items={allIterations.map((iter) => ({
              color: iter.status === 'success' ? 'green' : 'red',
              icon: iter.status === 'success' ? (
                <CheckCircleOutlined style={{ color: '#22c55e' }} />
              ) : (
                <ClockCircleOutlined style={{ color: '#ef4444' }} />
              ),
              content: (
                <div
                  style={{
                    padding: '12px 16px',
                    background:
                      iter.version === currentVersion
                        ? 'rgba(99, 102, 241, 0.1)'
                        : 'transparent',
                    borderRadius: 8,
                    border:
                      iter.version === currentVersion
                        ? '1px solid rgba(99, 102, 241, 0.3)'
                        : '1px solid transparent',
                    marginBottom: 8,
                  }}
                >
                  {/* 版本号和时间 */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <Space>
                      <Tag
                        color={iter.status === 'success' ? 'green' : 'red'}
                        style={{ marginRight: 0 }}
                      >
                        v{iter.version}
                      </Tag>
                      {iter.version === currentVersion && (
                        <Tag color="blue" style={{ marginRight: 0 }}>
                          当前版本
                        </Tag>
                      )}
                      {iter.contentHash ? (
                        <Tooltip title={iter.contentHash}>
                          <Tag style={{ marginRight: 0, fontSize: 10 }}>
                            #{iter.contentHash.slice(0, 8)}
                          </Tag>
                        </Tooltip>
                      ) : null}
                    </Space>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {formatTime(iter.timestamp)}
                    </Text>
                  </div>

                  {/* 用户 prompt */}
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>
                      <MessageOutlined style={{ marginRight: 4 }} />
                      用户需求
                    </Text>
<Text
                        style={{
                          fontSize: 13,
                          color: '#e4e4e7',
                          display: 'block',
                          lineHeight: 1.5,
                        }}
                        ellipsis
                        title={iter.prompt}
                      >
                        {iter.prompt}
                      </Text>
                  </div>

                  {/* 文件变更 */}
                  {iter.changes.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                        <FileTextOutlined style={{ marginRight: 4 }} />
                        文件变更 ({iter.changes.length})
                      </Text>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {iter.changes.slice(0, 5).map((change, idx) => (
                          <Tag
                            key={idx}
                            style={{
                              fontSize: 11,
                              background:
                                change.type === 'added'
                                  ? 'rgba(34, 197, 94, 0.1)'
                                  : change.type === 'modified'
                                    ? 'rgba(59, 130, 246, 0.1)'
                                    : 'rgba(239, 68, 68, 0.1)',
                              border: 'none',
                            }}
                          >
                            {getChangeTypeTag(change.type)}
                            {change.filename.split('/').pop()}
                          </Tag>
                        ))}
                        {iter.changes.length > 5 && (
                          <Tag style={{ fontSize: 11 }}>+{iter.changes.length - 5} 更多</Tag>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 操作按钮 */}
                  {iter.version !== currentVersion && (
                    <div style={{ marginTop: 8 }}>
                      <Button
                        size="small"
                        icon={<UndoOutlined />}
                        onClick={() => handleRestore(iter.version)}
                      >
                        恢复此版本
                      </Button>
                    </div>
                  )}
                </div>
              ),
            }))}
          />
        )}
      </Modal>
    </>
  );
};
