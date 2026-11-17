/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Button,
  Typography,
  Space,
  Dropdown,
  Tooltip,
} from 'antd';
import {
  ThunderboltOutlined,
  FireOutlined,
  CrownOutlined,
  BulbOutlined,
  SkinOutlined,
  AudioOutlined,
  AimOutlined,
  HeartOutlined,
  StarOutlined,
  TeamOutlined,
  CompassOutlined,
  BookOutlined,
  RobotOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

interface QuickActionsProps {
  onAction: (action: GameAction) => void;
  disabled?: boolean;
}

export interface GameAction {
  type: string;
  params?: Record<string, any>;
  /** Concrete iterate prompt when provided by the menu. */
  prompt?: string;
}

// RPG/故事向的快捷操作
const actionGroups = [
  {
    title: '剧情系统',
    actions: [
      { key: 'main-quest', icon: <CrownOutlined />, name: '主线任务', desc: '添加主线剧情和关卡' },
      { key: 'side-quest', icon: <StarOutlined />, name: '支线任务', desc: '添加可选支线剧情' },
      { key: 'dialogue', icon: <BookOutlined />, name: '对话系统', desc: 'NPC 对话和选择分支' },
    ],
  },
  {
    title: '角色系统',
    actions: [
      { key: 'player-stats', icon: <HeartOutlined />, name: '角色属性', desc: 'HP、MP、等级、经验' },
      { key: 'inventory', icon: <SkinOutlined />, name: '背包系统', desc: '物品栏和装备系统' },
      { key: 'skills', icon: <ThunderboltOutlined />, name: '技能树', desc: '职业技能和升级' },
    ],
  },
  {
    title: '战斗系统',
    actions: [
      { key: 'battle', icon: <CompassOutlined />, name: '回合战斗', desc: '经典 RPG 回合制' },
      { key: 'real-time', icon: <AimOutlined />, name: '即时战斗', desc: 'ARPG 动作战斗' },
      { key: 'enemies', icon: <RobotOutlined />, name: '敌人 AI', desc: '怪物行为和掉落' },
    ],
  },
  {
    title: '世界系统',
    actions: [
      { key: 'world-map', icon: <StarOutlined />, name: '世界地图', desc: '大地图和传送点' },
      { key: 'save-system', icon: <TeamOutlined />, name: '存档系统', desc: '存档和读档功能' },
      { key: 'audio', icon: <AudioOutlined />, name: '音效音乐', desc: '背景音乐和环境音' },
    ],
  },
  {
    title: '多轮改口',
    actions: [
      { key: 'harder', icon: <FireOutlined />, name: '加难', desc: '敌人更多/更硬' },
      { key: 'boss', icon: <CrownOutlined />, name: '加 Boss', desc: '主关卡出现 Boss' },
      { key: 'cyber', icon: <BulbOutlined />, name: '赛博画风', desc: '强制重生美术资产' },
      { key: 'dialogue', icon: <BookOutlined />, name: '加对话', desc: '点名场景加台词' },
    ],
  },
];

export const QuickActions: React.FC<QuickActionsProps> = ({ onAction, disabled }) => {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const handleAction = (key: string, _name: string) => {
    onAction({ type: key });
    setActiveDropdown(null);
  };

  return (
    <div
      style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-layout)',
      }}
    >
      <Text type="secondary" style={{
        fontSize: 10,
        marginBottom: 10,
        display: 'block',
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
      }}>
        快速添加
      </Text>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {actionGroups.map((group) => (
          <Dropdown
            key={group.title}
            trigger={['click']}
            open={activeDropdown === group.title}
            onOpenChange={(open) => setActiveDropdown(open ? group.title : null)}
            popupRender={() => (
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 12,
                  padding: 12,
                  minWidth: 200,
                  boxShadow: 'var(--shadow-md)',
                }}
              >
                <Text strong style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  display: 'block',
                  marginBottom: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  {group.title}
                </Text>
                {group.actions.map((action) => (
                  <Button
                    key={action.key}
                    type="text"
                    block
                    onClick={() => handleAction(action.key, action.name)}
                    disabled={disabled}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      height: 'auto',
                      justifyContent: 'flex-start',
                      borderRadius: 8,
                      marginBottom: 4,
                      background: 'var(--bg-lane)',
                    }}
                  >
                    <span style={{ color: 'var(--color-ember)', fontSize: 16 }}>{action.icon}</span>
                    <div>
                      <div style={{
                        color: 'var(--text-primary)',
                        fontSize: 13,
                        lineHeight: 1.3,
                        fontWeight: 500,
                      }}>{action.name}</div>
                      <div style={{
                        color: 'var(--text-secondary)',
                        fontSize: 11,
                        lineHeight: 1.3,
                      }}>{action.desc}</div>
                    </div>
                  </Button>
                ))}
              </div>
            )}
          >
            <Button
              size="small"
              disabled={disabled}
              style={{
                fontSize: 12,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-lane)',
                borderRadius: 8,
              }}
            >
              <ThunderboltOutlined style={{ fontSize: 11, color: 'var(--color-ember)' }} />
              {group.title}
            </Button>
          </Dropdown>
        ))}
      </div>
    </div>
  );
};
