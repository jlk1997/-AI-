/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Modal, Form, Input, Button, Space, Typography, Tag, Tabs, Divider } from 'antd';
import {
  BugOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  ConsoleSqlOutlined,
  ApiOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface GameDebugPanelProps {
  open: boolean;
  onClose: () => void;
  previewUrl: string | null;
}

export const GameDebugPanel: React.FC<GameDebugPanelProps> = ({
  open,
  onClose,
  previewUrl,
}) => {
  const [consoleOutput, setConsoleOutput] = useState<string[]>([
    '[Game] 游戏已加载',
    '[Game] 等待玩家输入...',
  ]);
  const [command, setCommand] = useState('');

  const handleSendCommand = () => {
    if (!command.trim()) return;

    // 模拟发送命令到游戏
    setConsoleOutput((prev) => [...prev, `[Player] ${command}`]);

    // 模拟游戏响应
    const responses = [
      '[Game] 命令已执行',
      '[Game] 分数 +10',
      '[Game] 游戏暂停中...',
      '[Game] 已重新开始',
    ];
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];

    setTimeout(() => {
      setConsoleOutput((prev) => [...prev, randomResponse]);
    }, 500);

    setCommand('');
  };

  const handleClearConsole = () => {
    setConsoleOutput([]);
  };

  const handleRefresh = () => {
    setConsoleOutput((prev) => [...prev, '[System] 正在刷新预览...']);
    setTimeout(() => {
      setConsoleOutput((prev) => [...prev, '[System] 预览已刷新']);
    }, 1000);
  };

  const tabItems = [
    {
      key: 'console',
      label: (
        <span>
          <ConsoleSqlOutlined /> 控制台
        </span>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', height: 300 }}>
          {/* 控制台输出 */}
          <div
            style={{
              flex: 1,
              background: '#0d1117',
              borderRadius: 8,
              padding: 12,
              overflow: 'auto',
              fontFamily: "'Fira Code', monospace",
              fontSize: 12,
            }}
          >
            {consoleOutput.map((line, index) => (
              <div
                key={index}
                style={{
                  color: line.includes('[Game]')
                    ? '#22c55e'
                    : line.includes('[Player]')
                    ? '#6366f1'
                    : line.includes('[Error]')
                    ? '#ef4444'
                    : '#a1a1aa',
                  marginBottom: 4,
                }}
              >
                {line}
              </div>
            ))}
          </div>

          {/* 命令输入 */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="输入调试命令..."
              onPressEnter={handleSendCommand}
              style={{ flex: 1 }}
            />
            <Button type="primary" onClick={handleSendCommand}>
              发送
            </Button>
            <Button onClick={handleClearConsole}>清空</Button>
          </div>
        </div>
      ),
    },
    {
      key: 'info',
      label: (
        <span>
          <ApiOutlined /> 游戏信息
        </span>
      ),
      children: (
        <div style={{ padding: 12 }}>
          <Form layout="vertical">
            <Form.Item label="预览 URL">
              <Input value={previewUrl || '无'} disabled />
            </Form.Item>

            <Divider>游戏状态</Divider>

            <Form.Item label="FPS">
              <Tag color="green">60</Tag>
            </Form.Item>

            <Form.Item label="内存使用">
              <Tag color="blue">128 MB</Tag>
            </Form.Item>

            <Form.Item label="游戏状态">
              <Tag color="cyan">运行中</Tag>
            </Form.Item>

            <Divider>可用命令</Divider>

            <div style={{ fontSize: 12, color: '#a1a1aa' }}>
              <Paragraph>
                <code style={{ background: '#262626', padding: '2px 6px', borderRadius: 4 }}>
                    reset
                  </code>{' '}
                - 重置游戏
              </Paragraph>
              <Paragraph>
                <code style={{ background: '#262626', padding: '2px 6px', borderRadius: 4 }}>
                    pause
                  </code>{' '}
                - 暂停游戏
              </Paragraph>
              <Paragraph>
                <code style={{ background: '#262626', padding: '2px 6px', borderRadius: 4 }}>
                    resume
                  </code>{' '}
                - 继续游戏
              </Paragraph>
              <Paragraph>
                <code style={{ background: '#262626', padding: '2px 6px', borderRadius: 4 }}>
                    setScore [n]
                  </code>{' '}
                - 设置分数
              </Paragraph>
              <Paragraph>
                <code style={{ background: '#262626', padding: '2px 6px', borderRadius: 4 }}>
                    addTime [n]
                  </code>{' '}
                - 增加时间
              </Paragraph>
            </div>
          </Form>
        </div>
      ),
    },
    {
      key: 'network',
      label: (
        <span>
          <BugOutlined /> 网络请求
        </span>
      ),
      children: (
        <div style={{ padding: 12 }}>
          <div
            style={{
              background: '#1f1f1f',
              borderRadius: 8,
              padding: 12,
              fontFamily: "'Fira Code', monospace",
              fontSize: 12,
            }}
          >
            <div style={{ color: '#22c55e', marginBottom: 8 }}>GET /preview 200 OK</div>
            <div style={{ color: '#22c55e', marginBottom: 8 }}>GET /game.js 200 OK</div>
            <div style={{ color: '#22c55e' }}>GET /assets/sprites.png 200 OK</div>
          </div>

          <Divider />

          <Text type="secondary" style={{ fontSize: 12 }}>
            共 3 个请求，0 个失败
          </Text>
        </div>
      ),
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <BugOutlined style={{ color: '#6366f1' }} />
          <span>游戏调试面板</span>
        </Space>
      }
      footer={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
            刷新预览
          </Button>
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
      width={600}
    >
      <Tabs items={tabItems} defaultActiveKey="console" />
    </Modal>
  );
};
