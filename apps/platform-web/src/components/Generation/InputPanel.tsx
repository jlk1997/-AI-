/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { Input, Button, Space, Typography } from 'antd';
import { SendOutlined, LoadingOutlined } from '@ant-design/icons';
import type { GenerationState } from '../../hooks/useGeneration';

const { TextArea } = Input;
const { Text } = Typography;

interface InputPanelProps {
  state: GenerationState;
  onSubmit: (prompt: string) => void;
}

export const InputPanel: React.FC<InputPanelProps> = ({ state, onSubmit }) => {
  const [value, setValue] = useState('');

  const isGenerating = state !== 'idle' && state !== 'error' && state !== 'preview';
  const canSubmit = value.trim().length > 0 && !isGenerating;

  const handleSubmit = useCallback(() => {
    if (canSubmit) {
      onSubmit(value.trim());
      setValue('');
    }
  }, [canSubmit, onSubmit, value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div
      style={{
        width: '100%',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: 20,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <TextArea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="描述你想要的游戏，例如：帮我做一个打砖块游戏，要有得分系统和关卡..."
          autoSize={{ minRows: 3, maxRows: 6 }}
          disabled={isGenerating}
          style={{
            fontSize: 15,
            borderRadius: 'var(--radius-md)',
            resize: 'none',
          }}
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text type="secondary" style={{ fontSize: 12 }}>
            按 Ctrl + Enter 快速发送
          </Text>

          <Button
            type="primary"
            size="large"
            icon={isGenerating ? <LoadingOutlined /> : <SendOutlined />}
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              minWidth: 120,
              height: 44,
              borderRadius: 'var(--radius-md)',
              fontWeight: 500,
            }}
          >
            {isGenerating ? '生成中...' : '生成游戏'}
          </Button>
        </div>
      </Space>
    </div>
  );
};
