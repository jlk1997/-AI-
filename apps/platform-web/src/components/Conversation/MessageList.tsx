/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { Spin, Empty } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { MessageItem, Message } from './MessageItem';

interface MessageListProps {
  messages: Message[];
  loading?: boolean;
  onUseSuggestion?: (prompt: string) => void;
  onSendSuggestion?: (prompt: string) => void;
  onRegenerate?: () => void;
  onShareToCommunity?: () => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  loading,
  onUseSuggestion,
  onSendSuggestion,
  onRegenerate,
  onShareToCommunity,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0 && !loading) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ color: '#a1a1aa' }}>
              输入游戏需求，开始创建你的游戏
            </span>
          }
        />
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '16px 24px',
      }}
    >
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          onUseSuggestion={onUseSuggestion}
          onSendSuggestion={onSendSuggestion}
          onRegenerate={onRegenerate}
          onShareToCommunity={onShareToCommunity}
        />
      ))}

      {loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 0',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: '#22c55e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LoadingOutlined spin style={{ color: '#fff' }} />
          </div>
          <div
            style={{
              display: 'flex',
              gap: 4,
            }}
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--color-ember)',
                  animation: `pulse 1.4s infinite`,
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};
