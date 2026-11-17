/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Modal,
  Form,
  Slider,
  Switch,
  InputNumber,
  Select,
  Space,
  Typography,
  Card,
  Row,
  Col,
  Divider,
  Button,
  message,
} from 'antd';
import { SettingOutlined, SaveOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

interface GameParamsConfigProps {
  open: boolean;
  onClose: () => void;
  onApply: (params: GameConfigParams) => void;
}

export interface GameConfigParams {
  // 通用设置
  gameTitle: string;
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;
  targetFPS: number;

  // 物理参数
  gravity: number;
  friction: number;
  bounce: number;

  // 游戏规则
  initialLives: number;
  timeLimit: number;
  scorePerItem: number;
  difficulty: number;

  // 音效
  musicEnabled: boolean;
  effectsEnabled: boolean;
  musicVolume: number;
  effectsVolume: number;
}

const defaultParams: GameConfigParams = {
  gameTitle: '我的游戏',
  canvasWidth: 800,
  canvasHeight: 600,
  backgroundColor: '#1a1a2e',
  targetFPS: 60,
  gravity: 0.5,
  friction: 0.98,
  bounce: 0.8,
  initialLives: 3,
  timeLimit: 60,
  scorePerItem: 10,
  difficulty: 1,
  musicEnabled: true,
  effectsEnabled: true,
  musicVolume: 50,
  effectsVolume: 70,
};

export const GameParamsConfig: React.FC<GameParamsConfigProps> = ({
  open,
  onClose,
  onApply,
}) => {
  const [params, setParams] = useState<GameConfigParams>(defaultParams);
  const [preset, setPreset] = useState<string>('custom');

  const handlePresetChange = (presetName: string) => {
    setPreset(presetName);
    const presets: Record<string, GameConfigParams> = {
      easy: {
        ...defaultParams,
        gameTitle: '简单模式',
        difficulty: 1,
        initialLives: 5,
        timeLimit: 90,
        gravity: 0.3,
        bounce: 0.9,
      },
      normal: {
        ...defaultParams,
        gameTitle: '普通模式',
        difficulty: 2,
        initialLives: 3,
        timeLimit: 60,
        gravity: 0.5,
        bounce: 0.8,
      },
      hard: {
        ...defaultParams,
        gameTitle: '困难模式',
        difficulty: 3,
        initialLives: 1,
        timeLimit: 30,
        gravity: 0.8,
        bounce: 0.6,
      },
      custom: params,
    };

    if (presets[presetName]) {
      setParams(presets[presetName]);
    }
  };

  const handleApply = () => {
    onApply(params);
    message.success('游戏参数已应用');
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <SettingOutlined style={{ color: '#6366f1' }} />
          <span>游戏参数配置</span>
        </Space>
      }
      footer={[
        <Button key="reset" onClick={() => setParams(defaultParams)}>
          恢复默认
        </Button>,
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="apply" type="primary" icon={<SaveOutlined />} onClick={handleApply}>
          应用参数
        </Button>,
      ]}
      width={800}
    >
      {/* 预设选择 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <Text>快速预设：</Text>
          <Select
            value={preset}
            onChange={handlePresetChange}
            style={{ width: 150 }}
            options={[
              { value: 'easy', label: '简单模式' },
              { value: 'normal', label: '普通模式' },
              { value: 'hard', label: '困难模式' },
              { value: 'custom', label: '自定义' },
            ]}
          />
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col span={12}>
          {/* 基础设置 */}
          <Title level={5}>基础设置</Title>

          <Form layout="vertical">
            <Form.Item label="游戏标题">
              <InputNumber
                value={params.gameTitle}
                onChange={(v) => setParams({ ...params, gameTitle: String(v) })}
                style={{ width: '100%' }}
              />
            </Form.Item>

            <Form.Item label={`画布宽度: ${params.canvasWidth}px`}>
              <Slider
                min={400}
                max={1920}
                step={10}
                value={params.canvasWidth}
                onChange={(v) => setParams({ ...params, canvasWidth: v })}
              />
            </Form.Item>

            <Form.Item label={`画布高度: ${params.canvasHeight}px`}>
              <Slider
                min={300}
                max={1080}
                step={10}
                value={params.canvasHeight}
                onChange={(v) => setParams({ ...params, canvasHeight: v })}
              />
            </Form.Item>

            <Form.Item label={`目标 FPS: ${params.targetFPS}`}>
              <Slider
                min={30}
                max={120}
                value={params.targetFPS}
                onChange={(v) => setParams({ ...params, targetFPS: v })}
                marks={{ 30: '30', 60: '60', 120: '120' }}
              />
            </Form.Item>
          </Form>
        </Col>

        <Col span={12}>
          {/* 游戏规则 */}
          <Title level={5}>游戏规则</Title>

          <Form layout="vertical">
            <Form.Item label={`初始生命: ${params.initialLives}`}>
              <Slider
                min={1}
                max={10}
                value={params.initialLives}
                onChange={(v) => setParams({ ...params, initialLives: v })}
              />
            </Form.Item>

            <Form.Item label={`时间限制: ${params.timeLimit}秒`}>
              <Slider
                min={30}
                max={300}
                step={10}
                value={params.timeLimit}
                onChange={(v) => setParams({ ...params, timeLimit: v })}
                marks={{ 30: '30s', 60: '60s', 120: '120s', 300: '300s' }}
              />
            </Form.Item>

            <Form.Item label={`每个物品得分: ${params.scorePerItem}`}>
              <Slider
                min={1}
                max={100}
                value={params.scorePerItem}
                onChange={(v) => setParams({ ...params, scorePerItem: v })}
              />
            </Form.Item>

            <Form.Item label={`难度等级: ${params.difficulty}`}>
              <Slider
                min={1}
                max={5}
                value={params.difficulty}
                onChange={(v) => setParams({ ...params, difficulty: v })}
                marks={{ 1: '简单', 2: '普通', 3: '困难', 4: '噩梦', 5: '地狱' }}
              />
            </Form.Item>
          </Form>
        </Col>
      </Row>

      <Divider />

      <Row gutter={[16, 16]}>
        <Col span={12}>
          {/* 物理参数 */}
          <Title level={5}>物理参数</Title>

          <Form layout="vertical">
            <Form.Item label={`重力: ${params.gravity.toFixed(2)}`}>
              <Slider
                min={0}
                max={2}
                step={0.1}
                value={params.gravity}
                onChange={(v) => setParams({ ...params, gravity: v })}
              />
            </Form.Item>

            <Form.Item label={`摩擦力: ${params.friction.toFixed(2)}`}>
              <Slider
                min={0.8}
                max={1}
                step={0.01}
                value={params.friction}
                onChange={(v) => setParams({ ...params, friction: v })}
              />
            </Form.Item>

            <Form.Item label={`弹性: ${params.bounce.toFixed(2)}`}>
              <Slider
                min={0}
                max={1}
                step={0.1}
                value={params.bounce}
                onChange={(v) => setParams({ ...params, bounce: v })}
              />
            </Form.Item>
          </Form>
        </Col>

        <Col span={12}>
          {/* 音效设置 */}
          <Title level={5}>音效设置</Title>

          <Form layout="vertical">
            <Form.Item label="启用背景音乐">
              <Switch
                checked={params.musicEnabled}
                onChange={(v) => setParams({ ...params, musicEnabled: v })}
              />
            </Form.Item>

            {params.musicEnabled && (
              <Form.Item label={`音乐音量: ${params.musicVolume}%`}>
                <Slider
                  min={0}
                  max={100}
                  value={params.musicVolume}
                  onChange={(v) => setParams({ ...params, musicVolume: v })}
                />
              </Form.Item>
            )}

            <Form.Item label="启用音效">
              <Switch
                checked={params.effectsEnabled}
                onChange={(v) => setParams({ ...params, effectsEnabled: v })}
              />
            </Form.Item>

            {params.effectsEnabled && (
              <Form.Item label={`音效音量: ${params.effectsVolume}%`}>
                <Slider
                  min={0}
                  max={100}
                  value={params.effectsVolume}
                  onChange={(v) => setParams({ ...params, effectsVolume: v })}
                />
              </Form.Item>
            )}
          </Form>
        </Col>
      </Row>
    </Modal>
  );
};
