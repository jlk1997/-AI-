/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Space, Typography, Tooltip } from 'antd';
import {
  CheckCircleFilled,
  LoadingOutlined,
  CloseCircleFilled,
  ClockCircleOutlined,
} from '@ant-design/icons';
import type { StageStatus } from '../../hooks/useGeneration';

const { Text } = Typography;

interface Stage {
  key: 'generate' | 'build' | 'deploy';
  label: string;
  description: string;
}

const stages: Stage[] = [
  {
    key: 'generate',
    label: '代码生成',
    description: 'AI 理解需求并生成游戏代码',
  },
  {
    key: 'build',
    label: '构建部署',
    description: '安装依赖并打包游戏',
  },
  {
    key: 'deploy',
    label: '预览发布',
    description: '上传到云端生成可预览链接',
  },
];

interface StatusFlowProps {
  statuses: {
    generate: StageStatus;
    build: StageStatus;
    deploy: StageStatus;
  };
  onViewLog?: (logKey: string) => void;
  logKey?: string | null;
}

export const StatusFlow: React.FC<StatusFlowProps> = ({ statuses, logKey }) => {
  const getStageIcon = (status: StageStatus) => {
    switch (status) {
      case 'success':
        return <CheckCircleFilled style={{ color: '#22c55e', fontSize: 18 }} />;
      case 'active':
        return <LoadingOutlined spin style={{ color: 'var(--color-ember)', fontSize: 18 }} />;
      case 'error':
        return <CloseCircleFilled style={{ color: '#ef4444', fontSize: 18 }} />;
      default:
        return <ClockCircleOutlined style={{ color: '#a1a1aa', fontSize: 18 }} />;
    }
  };

  const getStatusText = (status: StageStatus) => {
    switch (status) {
      case 'success':
        return '完成';
      case 'active':
        return '进行中...';
      case 'error':
        return '失败';
      default:
        return '等待中';
    }
  };

  const getStatusColor = (status: StageStatus) => {
    switch (status) {
      case 'success':
        return '#22c55e';
      case 'active':
        return 'var(--color-ember)';
      case 'error':
        return '#ef4444';
      default:
        return '#a1a1aa';
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
        padding: '16px 24px',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {stages.map((stage, index) => {
        const status = statuses[stage.key];
        const isLast = index === stages.length - 1;

        return (
          <React.Fragment key={stage.key}>
            <Tooltip title={stage.description}>
              <Space
                direction="vertical"
                align="center"
                style={{
                  minWidth: 80,
                  cursor: status === 'error' && logKey ? 'pointer' : 'default',
                }}
              >
                {getStageIcon(status)}
                <Text
                  strong
                  style={{
                    color: getStatusColor(status),
                    fontSize: 13,
                  }}
                >
                  {stage.label}
                </Text>
                <Text
                  style={{
                    color: getStatusColor(status),
                    fontSize: 11,
                    opacity: 0.8,
                  }}
                >
                  {getStatusText(status)}
                </Text>
              </Space>
            </Tooltip>

            {!isLast && (
              <div
                style={{
                  width: 60,
                  height: 2,
                  background:
                    status === 'success' && statuses[stages[index + 1].key] !== 'pending'
                      ? '#22c55e'
                      : '#303030',
                  margin: '0 8px',
                  marginBottom: 28,
                  transition: 'background 0.3s ease',
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
