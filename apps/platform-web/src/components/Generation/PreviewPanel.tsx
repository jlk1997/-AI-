/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Typography, Space, Spin } from 'antd';
import {
  RocketOutlined,
 ReloadOutlined,
  WarningOutlined,
  BulbOutlined,
} from '@ant-design/icons';
import type { GenerationState } from '../../hooks/useGeneration';
import { previewIframeAllow, previewIframeSandbox } from '../../utils/previewIframeSandbox';

const { Text, Title } = Typography;

interface PreviewPanelProps {
  state: GenerationState;
  previewUrl: string | null;
  errorMessage: string | null;
  onRetry: () => void;
  onViewLog?: () => void;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({
  state,
  previewUrl,
  errorMessage,
  onRetry,
  onViewLog,
}) => {
  // 空状态 - 展示示例引导
  if (state === 'idle') {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(90% 70% at 20% 0%, rgba(224, 178, 90, 0.28), transparent 55%), linear-gradient(160deg, #2a2118, var(--color-night))',
          borderRadius: 'var(--radius-lg)',
          padding: 40,
        }}
      >
        <BulbOutlined style={{ fontSize: 64, color: 'var(--color-gold)', marginBottom: 24 }} />
        <Title level={4} style={{ color: '#fff', marginBottom: 8 }}>
          AI 游戏生成器
        </Title>
        <Text style={{ color: '#a1a1aa', textAlign: 'center', maxWidth: 400 }}>
          在下方输入框描述你想要的游戏，AI 将自动为你生成可运行的游戏代码并部署预览
        </Text>
        <div
          style={{
            marginTop: 32,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            justifyContent: 'center',
          }}
        >
          {['打砖块游戏', '俄罗斯方块', '贪吃蛇', 'Flappy Bird', '太空侵略者'].map(
            (example) => (
              <Button
                key={example}
                type="default"
                size="small"
                style={{
                  borderColor: 'var(--color-ember)',
                  color: 'var(--color-ember)',
                }}
                onClick={() => {
                  const input = document.querySelector(
                    'textarea'
                  ) as HTMLTextAreaElement;
                  if (input) input.value = `帮我做一个${example}`;
                }}
              >
                {example}
              </Button>
            )
          )}
        </div>
      </div>
    );
  }

  // 生成中状态
  if (state === 'generating' || state === 'building' || state === 'deploying') {
    const message =
      state === 'generating'
        ? 'AI 正在理解你的需求并生成游戏代码...'
        : state === 'building'
        ? '正在安装依赖并构建项目...'
        : '正在部署到云端...';

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        <Spin size="large" tip="" />
        <div
          style={{
            marginTop: 24,
            textAlign: 'center',
          }}
        >
          <Title level={5} style={{ marginBottom: 8 }}>
            {state === 'generating'
              ? '代码生成中'
              : state === 'building'
              ? '构建中'
              : '部署中'}
          </Title>
          <Text type="secondary">{message}</Text>
        </div>
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            gap: 8,
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--color-ember)',
                animation: `pulse 1.4s infinite`,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  // 错误状态
  if (state === 'error') {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          padding: 40,
        }}
      >
        <WarningOutlined style={{ fontSize: 64, color: '#ef4444', marginBottom: 24 }} />
        <Title level={4} style={{ color: '#ef4444', marginBottom: 8 }}>
          生成失败
        </Title>
        <Text
          style={{
            color: '#a1a1aa',
            textAlign: 'center',
            maxWidth: 500,
            marginBottom: 24,
            fontFamily: 'monospace',
            fontSize: 12,
            background: '#262626',
            padding: 12,
            borderRadius: 8,
            wordBreak: 'break-all',
          }}
        >
          {errorMessage || '未知错误，请查看日志或重试'}
        </Text>
        <Space>
          {onViewLog && (
            <Button icon={<BulbOutlined />} onClick={onViewLog}>
              查看日志
            </Button>
          )}
          <Button type="primary" icon={<ReloadOutlined />} onClick={onRetry}>
            重新生成
          </Button>
        </Space>
      </div>
    );
  }

  // 预览状态 - 显示 iframe
  if (state === 'preview' && previewUrl) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#000',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <iframe
          src={previewUrl}
          title="Game Preview"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          sandbox={previewIframeSandbox(previewUrl)}
          allow={previewIframeAllow()}
        />
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 4,
            display: 'flex',
            gap: 8,
            pointerEvents: 'auto',
          }}
        >
          <Button
            type="primary"
            icon={<RocketOutlined />}
            href={previewUrl}
            target="_blank"
          >
            新窗口打开
          </Button>
        </div>
      </div>
    );
  }

  return null;
};
