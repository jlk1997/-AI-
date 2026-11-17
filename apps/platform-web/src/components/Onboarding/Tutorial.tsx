/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Modal, Button, Space, Typography, Steps, message } from 'antd';
import {
  RocketOutlined,
  MessageOutlined,
  AimOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  GlobalOutlined,
} from '@ant-design/icons';

const { Text, Title, Paragraph } = Typography;

interface TutorialProps {
  open: boolean;
  onClose: () => void;
  onStart: () => void;
}

/** Compact dual-path tutorial: Game Studio vs Society World. */
const steps = [
  {
    title: '选模式',
    description: '游戏工作室 或 社会世界',
    icon: <AimOutlined />,
    content:
      '顶栏切换：游戏工作室 = 做能通关的游戏；社会世界 = 做能观察的社会（不是通关）。',
  },
  {
    title: '描述并生成',
    description: '自然语言或一键模板',
    icon: <MessageOutlined />,
    content:
      '游戏：描述玩法。世界：点「演示小镇社会」或描述一座小镇。',
  },
  {
    title: '右侧主舞台',
    description: '试玩 或 观测台',
    icon: <RocketOutlined />,
    content:
      '游戏：右侧满高试玩 iframe。世界：默认社会观测台 — 快进 / 耳语 / 涌现；地图漫游是次要 Tab。',
  },
  {
    title: '工具不占位',
    description: '质检 / 代码 / 设定',
    icon: <ThunderboltOutlined />,
    content:
      '顶栏「工具」打开质检、代码变更、资产与世界设定（含科研实验室）。它们不占首屏主舞台。',
  },
];

export const Tutorial: React.FC<TutorialProps> = ({ open, onClose, onStart }) => {
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onClose();
      onStart();
      message.success('开始创作吧！');
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={520}
      title={
        <Space>
          <GlobalOutlined />
          <span>快速上手</span>
        </Space>
      }
    >
      <Steps
        current={currentStep}
        size="small"
        items={steps.map((s) => ({
          title: s.title,
          description: s.description,
          icon: s.icon,
        }))}
        style={{ marginBottom: 20 }}
      />
      <Paragraph>{steps[currentStep].content}</Paragraph>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Button
          disabled={currentStep === 0}
          onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
        >
          上一步
        </Button>
        <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleNext}>
          {currentStep >= steps.length - 1 ? '开始' : '下一步'}
        </Button>
      </Space>
    </Modal>
  );
};
