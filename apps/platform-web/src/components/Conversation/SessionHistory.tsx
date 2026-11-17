/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Typography, Button, Space, Empty, Tooltip } from 'antd';
import {
  HistoryOutlined,
  PlusOutlined,
  MessageOutlined,
  DeleteOutlined,
  ForkOutlined,
} from '@ant-design/icons';
import { getLocale, useT } from '../../services/i18n';
import { orderSessionsAsTree } from '../../utils/sessionTree';

const { Text } = Typography;

export interface SessionInfo {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  parentId?: string | null;
}

interface SessionHistoryProps {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession?: (sessionId: string) => void;
  onForkSession?: (sessionId: string) => void;
}

export const SessionHistory: React.FC<SessionHistoryProps> = ({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onForkSession,
}) => {
  const { t } = useT();
  const tree = orderSessionsAsTree(sessions);
  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return t('generate.sessions.justNow');
    if (diff < 3600000) return t('generate.sessions.minutesAgo', { n: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('generate.sessions.hoursAgo', { n: Math.floor(diff / 3600000) });
    if (diff < 604800000) return t('generate.sessions.daysAgo', { n: Math.floor(diff / 86400000) });

    return date.toLocaleDateString(getLocale() === 'zh-CN' ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const getPreviewText = (title: string) => {
    // 从标题中提取预览文字
    const match = title.match(/^(.{20})/);
    return match ? match[1] + (title.length > 20 ? '...' : '') : title;
  };

  return (
    <div
      style={{
        width: 280,
        height: '100%',
        background: '#141414',
        borderRight: '1px solid #303030',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid #303030',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Space>
          <HistoryOutlined style={{ color: 'var(--color-ember)' }} />
          <Text strong style={{ color: '#e4e4e7' }}>
            {t('generate.sessions.title')}
          </Text>
        </Space>
        <Tooltip title={t('generate.sessions.new')}>
          <Button
            type="primary"
            shape="circle"
            size="small"
            icon={<PlusOutlined />}
            onClick={onNewSession}
          />
        </Tooltip>
      </div>

      {/* 会话列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
        {sessions.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span style={{ color: '#a1a1aa', fontSize: 12 }}>
                {t('generate.sessions.empty')}
              </span>
            }
            style={{ marginTop: 40 }}
          />
        ) : (
          tree.map((session) => (
            <div
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              style={{
                padding: '12px',
                paddingLeft: 12 + session.depth * 16,
                borderRadius: 8,
                marginBottom: 4,
                cursor: 'pointer',
                background:
                  session.id === currentSessionId ? '#262626' : 'transparent',
                border:
                  session.id === currentSessionId
                    ? '1px solid var(--color-ember)'
                    : '1px solid transparent',
                transition: 'all 0.2s',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 4,
                    }}
                  >
                    <MessageOutlined
                      style={{ color: '#a1a1aa', fontSize: 12 }}
                    />
                    <Text
                      ellipsis
                      style={{
                        color: '#e4e4e7',
                        fontSize: 13,
                        fontWeight:
                          session.id === currentSessionId ? 600 : 400,
                      }}
                    >
                      {getPreviewText(session.title)}
                    </Text>
                  </div>
                  {session.parentTitle ? (
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                      {t('generate.sessions.forkedFrom', { title: session.parentTitle })}
                    </Text>
                  ) : null}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {formatTime(session.updatedAt)}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {t('generate.sessions.messages', { count: session.messageCount })}
                    </Text>
                  </div>
                </div>

                <Space size={0}>
                  {onForkSession ? (
                    <Tooltip title={t('generate.sessions.fork')}>
                      <Button
                        type="text"
                        size="small"
                        icon={<ForkOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          onForkSession(session.id);
                        }}
                        style={{ color: '#a1a1aa', opacity: 0.6 }}
                      />
                    </Tooltip>
                  ) : null}
                  {onDeleteSession ? (
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                      style={{ color: '#a1a1aa', opacity: 0.6 }}
                    />
                  ) : null}
                </Space>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
