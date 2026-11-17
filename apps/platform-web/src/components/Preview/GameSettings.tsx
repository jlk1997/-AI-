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
  Select,
  InputNumber,
  Space,
  Typography,
  Divider,
  Button,
  message,
} from 'antd';
import { SettingOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

interface GameSettingsProps {
  open: boolean;
  onClose: () => void;
  onApply: (settings: GameSettings) => void;
}

export interface GameSettings {
  difficulty: number;
  soundEnabled: boolean;
  musicVolume: number;
  effectsVolume: number;
  gameSpeed: number;
  showFPS: boolean;
  fullscreen: boolean;
}

const defaultSettings: GameSettings = {
  difficulty: 1,
  soundEnabled: true,
  musicVolume: 50,
  effectsVolume: 70,
  gameSpeed: 1,
  showFPS: false,
  fullscreen: false,
};

export const GameSettings: React.FC<GameSettingsProps> = ({
  open,
  onClose,
  onApply,
}) => {
  const [settings, setSettings] = useState<GameSettings>(defaultSettings);

  const handleApply = () => {
    onApply(settings);
    message.success('设置已应用');
    onClose();
  };

  const handleReset = () => {
    setSettings(defaultSettings);
    message.info('已恢复默认设置');
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <SettingOutlined />
          <span>游戏设置</span>
        </Space>
      }
      footer={[
        <Button key="reset" onClick={handleReset}>
          恢复默认
        </Button>,
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="apply" type="primary" onClick={handleApply}>
          应用设置
        </Button>,
      ]}
      width={500}
    >
      <Form layout="vertical" style={{ marginTop: 16 }}>
        {/* 游戏设置 */}
        <Title level={5}>游戏设置</Title>

        <Form.Item label="游戏难度">
          <Slider
            min={1}
            max={5}
            marks={{ 1: '简单', 2: '普通', 3: '困难', 4: '困难', 5: '噩梦' }}
            value={settings.difficulty}
            onChange={(v) => setSettings({ ...settings, difficulty: v })}
          />
        </Form.Item>

        <Form.Item label="游戏速度">
          <Slider
            min={0.5}
            max={2}
            step={0.1}
            marks={{ 0.5: '0.5x', 1: '1x', 1.5: '1.5x', 2: '2x' }}
            value={settings.gameSpeed}
            onChange={(v) => setSettings({ ...settings, gameSpeed: v })}
          />
        </Form.Item>

        <Divider />

        {/* 音频设置 */}
        <Title level={5}>音频设置</Title>

        <Form.Item label="启用音效">
          <Switch
            checked={settings.soundEnabled}
            onChange={(v) => setSettings({ ...settings, soundEnabled: v })}
          />
        </Form.Item>

        {settings.soundEnabled && (
          <>
            <Form.Item label="音乐音量">
              <Slider
                min={0}
                max={100}
                value={settings.musicVolume}
                onChange={(v) => setSettings({ ...settings, musicVolume: v })}
              />
            </Form.Item>

            <Form.Item label="音效音量">
              <Slider
                min={0}
                max={100}
                value={settings.effectsVolume}
                onChange={(v) => setSettings({ ...settings, effectsVolume: v })}
              />
            </Form.Item>
          </>
        )}

        <Divider />

        {/* 显示设置 */}
        <Title level={5}>显示设置</Title>

        <Form.Item label="显示 FPS">
          <Switch
            checked={settings.showFPS}
            onChange={(v) => setSettings({ ...settings, showFPS: v })}
          />
        </Form.Item>

        <Form.Item label="全屏模式启动">
          <Switch
            checked={settings.fullscreen}
            onChange={(v) => setSettings({ ...settings, fullscreen: v })}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};
