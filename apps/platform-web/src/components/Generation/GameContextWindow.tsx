/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Typography, Space, Tag, Button, Collapse, Badge, Input, message } from 'antd';
import {
  DatabaseOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  ClockCircleOutlined,
  BookOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface GameContextWindowProps {
  gameContext: {
    theme?: string;
    variant?: string;
    difficulty?: number;
    gameSpeed?: number;
    lives?: number;
    musicStyle?: string;
    canvasSize?: { width: number; height: number };
    gameType?: string;
  };
  conversationSummary: string;
  lastModifiedFiles: string[];
  iterationCount: number;
  brief?: Record<string, unknown> | null;
  memories?: string[];
  projectId?: string | null;
  onSaveBrief?: (brief: Record<string, unknown>) => Promise<void>;
}

export const GameContextWindow: React.FC<GameContextWindowProps> = ({
  gameContext,
  conversationSummary,
  lastModifiedFiles,
  iterationCount,
  brief,
  memories = [],
  onSaveBrief,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [briefDraft, setBriefDraft] = useState('');
  const [savingBrief, setSavingBrief] = useState(false);

  const themeIcons: Record<string, string> = {
    cyberpunk: '🌃',
    pixel: '👾',
    neon: '✨',
    minimal: '⬜',
    nature: '🌿',
    space: '🚀',
    retro: '🕹️',
    fantasy: '🔮',
  };

  const themeNames: Record<string, string> = {
    cyberpunk: '赛博朋克',
    pixel: '像素复古',
    neon: '霓虹炫彩',
    minimal: '极简主义',
    nature: '自然森系',
    space: '太空科幻',
    retro: '复古街机',
    fantasy: '奇幻魔法',
  };

  const briefGameplay =
    typeof brief?.gameplay === 'string' ? brief.gameplay : '';
  const briefTitle = typeof brief?.title === 'string' ? brief.title : '';

  const collapseItems = [
    {
      key: 'brief',
      label: (
        <Space>
          <BookOutlined />
          <span>项目简报</span>
        </Space>
      ),
      children: (
        <Space orientation="vertical" style={{ width: '100%' }} size={8}>
          {briefTitle ? (
            <Text style={{ fontSize: 12 }} strong>
              {briefTitle}
            </Text>
          ) : null}
          <Input.TextArea
            rows={3}
            placeholder="玩法、风格、禁忌等要点（AI 每轮生成都会参考）"
            value={briefDraft || briefGameplay}
            onChange={(e) => setBriefDraft(e.target.value)}
            style={{ fontSize: 12 }}
          />
          {onSaveBrief ? (
            <Button
              size="small"
              loading={savingBrief}
              onClick={async () => {
                if (!onSaveBrief) return;
                setSavingBrief(true);
                try {
                  await onSaveBrief({
                    ...(brief ?? {}),
                    gameplay: briefDraft || briefGameplay,
                  });
                  message.success('简报已保存');
                } catch {
                  message.error('保存失败');
                } finally {
                  setSavingBrief(false);
                }
              }}
            >
              保存要点
            </Button>
          ) : null}
        </Space>
      ),
    },
    {
      key: 'summary',
      label: (
        <Space>
          <InfoCircleOutlined />
          <span>对话摘要</span>
        </Space>
      ),
      children: (
        <Paragraph
          type="secondary"
          style={{ fontSize: 12, marginBottom: 0 }}
          ellipsis={{ rows: 3, expandable: true, symbol: '更多' }}
        >
          {conversationSummary || '暂无摘要，AI 会根据最新消息理解你的需求。'}
        </Paragraph>
      ),
    },
    {
      key: 'memories',
      label: (
        <Space>
          <DatabaseOutlined />
          <span>项目记忆 ({memories.length})</span>
        </Space>
      ),
      children: (
        <Space size={[4, 4]} wrap>
          {memories.length > 0 ? (
            memories.slice(0, 8).map((fact) => (
              <Tag key={fact.slice(0, 40)} style={{ fontSize: 11 }}>
                {fact.slice(0, 60)}
              </Tag>
            ))
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              暂无长期记忆
            </Text>
          )}
        </Space>
      ),
    },
    {
      key: 'files',
      label: (
        <Space>
          <DatabaseOutlined />
          <span>最近修改 ({lastModifiedFiles.length})</span>
        </Space>
      ),
      children: (
        <Space size={[4, 4]} wrap>
          {lastModifiedFiles.length > 0 ? (
            lastModifiedFiles.map((file) => (
              <Tag key={file} style={{ fontSize: 11 }}>
                {file}
              </Tag>
            ))
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              暂无文件修改记录
            </Text>
          )}
        </Space>
      ),
    },
    {
      key: 'params',
      label: (
        <Space>
          <SettingOutlined />
          <span>当前参数</span>
        </Space>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {gameContext.theme && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>主题</Text>
              <Text style={{ fontSize: 12 }}>
                {themeIcons[gameContext.theme] || ''}{' '}
                {themeNames[gameContext.theme] || gameContext.theme}
              </Text>
            </div>
          )}
          {gameContext.variant && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>玩法</Text>
              <Text style={{ fontSize: 12 }}>{gameContext.variant}</Text>
            </div>
          )}
          {gameContext.difficulty && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>难度</Text>
              <Text style={{ fontSize: 12 }}>
                {'★'.repeat(gameContext.difficulty)}
                {'☆'.repeat(5 - gameContext.difficulty)}
              </Text>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div
      style={{
        padding: '8px 16px',
        background: 'rgba(99, 102, 241, 0.05)',
        borderBottom: '1px solid #303030',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Space>
          <Badge count={iterationCount} size="small" style={{ backgroundColor: 'var(--color-ember)' }}>
            <ClockCircleOutlined style={{ color: 'var(--color-ember)' }} />
          </Badge>
          <Text strong style={{ fontSize: 12, color: '#a1a1aa' }}>
            游戏上下文
          </Text>
          {(conversationSummary || briefTitle) && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {(briefTitle || conversationSummary).slice(0, 30)}...
            </Text>
          )}
        </Space>
        <Button type="text" size="small" style={{ fontSize: 11 }}>
          {isExpanded ? '收起' : '展开'}
        </Button>
      </div>

      {isExpanded && (
        <div style={{ marginTop: 12 }}>
          <Collapse
            items={collapseItems}
            defaultActiveKey={['brief', 'summary']}
            ghost
            size="small"
          />
        </div>
      )}
    </div>
  );
};
