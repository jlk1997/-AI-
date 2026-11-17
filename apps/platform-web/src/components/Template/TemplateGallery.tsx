/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Modal, Card, Typography, Space, Tag, Button, Row, Col, message } from 'antd';
import {
  RocketOutlined,
  ThunderboltOutlined,
  AimOutlined,
  CustomerServiceOutlined,
  RocketTwoTone,
} from '@ant-design/icons';

const { Text, Title } = Typography;

interface Template {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  prompt: string;
  tags: string[];
}

const templates: Template[] = [
  {
    id: 'snake',
    name: '贪吃蛇',
    description: '经典贪吃蛇游戏，支持方向键控制，吃食物增长',
    icon: <RocketOutlined style={{ fontSize: 32 }} />,
    color: '#22c55e',
    prompt: '帮我做一个贪吃蛇游戏，蛇可以上下左右移动，吃到食物会变长，得分越高速度越快',
    tags: ['经典', '休闲', '简单'],
  },
  {
    id: 'breakout',
    name: '打砖块',
    description: '经典打砖块游戏，用挡板反弹小球击碎砖块',
    icon: <AimOutlined style={{ fontSize: 32 }} />,
    color: '#f59e0b',
    prompt: '帮我做一个打砖块游戏，有挡板可以移动反弹小球，击碎上方的砖块得分',
    tags: ['经典', '弹跳', '休闲'],
  },
  {
    id: 'tetris',
    name: '俄罗斯方块',
    description: '经典俄罗斯方块，支持旋转、下落、消除',
    icon: <ThunderboltOutlined style={{ fontSize: 32 }} />,
    color: 'var(--color-ember)',
    prompt: '帮我做一个俄罗斯方块游戏，方块可以从上方下落，可以旋转，填满一行会消除',
    tags: ['经典', '益智', '挑战'],
  },
  {
    id: 'flappy',
    name: 'Flappy Bird',
    description: '控制小鸟穿过障碍物，点击飞翔',
    icon: <RocketTwoTone style={{ fontSize: 32 }} twoToneColor="#06b6d4" />,
    color: '#06b6d4',
    prompt: '帮我做一个 Flappy Bird 类型的游戏，小鸟点击会向上飞，要穿过随机生成的管道',
    tags: ['热门', '挑战', '虐心'],
  },
  {
    id: 'space-shooter',
    name: '太空射击',
    description: '控制飞船射击敌人，支持道具和技能',
    icon: <CustomerServiceOutlined style={{ fontSize: 32 }} />,
    color: '#8b5cf6',
    prompt: '帮我做一个太空射击游戏，控制飞船左右移动和射击，击毁敌人得分，有道具掉落',
    tags: ['射击', '动作', '道具'],
  },
  {
    id: 'pong',
    name: '乒乓球',
    description: '经典乒乓球对战游戏，支持双人对战',
    icon: <RocketOutlined style={{ fontSize: 32 }} />,
    color: '#ec4899',
    prompt: '帮我做一个乒乓球游戏，左右两个挡板，可以双人对战，有计分系统',
    tags: ['对战', '经典', '双人'],
  },
];

interface TemplateGalleryProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (prompt: string) => void;
}

export const TemplateGallery: React.FC<TemplateGalleryProps> = ({
  open,
  onClose,
  onSelectTemplate,
}) => {
  const handleSelect = (template: Template) => {
    onSelectTemplate(template.prompt);
    message.success(`已选择「${template.name}」，开始生成...`);
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <RocketOutlined style={{ color: 'var(--color-ember)' }} />
          <span>游戏模板画廊</span>
        </Space>
      }
      footer={null}
      width={800}
      styles={{ body: { padding: 24 } }}
    >
      <Text type="secondary" style={{ marginBottom: 16, display: 'block' }}>
        选择一个模板快速开始，或直接描述你想要的游戏
      </Text>

      <Row gutter={[16, 16]}>
        {templates.map((template) => (
          <Col xs={24} sm={12} md={8} key={template.id}>
            <Card
              hoverable
              onClick={() => handleSelect(template)}
              style={{
                borderColor: template.color,
                height: '100%',
              }}
              styles={{
                body: { padding: 16 },
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 16,
                    background: `${template.color}20`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 12,
                    color: template.color,
                  }}
                >
                  {template.icon}
                </div>

                <Title level={5} style={{ marginBottom: 4 }}>
                  {template.name}
                </Title>

                <Text
                  type="secondary"
                  style={{ fontSize: 12, marginBottom: 8 }}
                >
                  {template.description}
                </Text>

                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {template.tags.map((tag) => (
                    <Tag key={tag} style={{ margin: 0 }}>
                      {tag}
                    </Tag>
                  ))}
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <div
        style={{
          marginTop: 16,
          padding: 12,
          background: '#1f1f1f',
          borderRadius: 8,
          textAlign: 'center',
        }}
      >
        <Text type="secondary">
          更多模板持续添加中... 也可以直接输入你想要的游戏描述
        </Text>
      </div>
    </Modal>
  );
};
