/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compact L1/L2/L3 + game-quality explainer for GeneratePage.
 */

import React from 'react';
import { Alert, Button, Space, Tag, Typography } from 'antd';
import {
  ExperimentOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { useT } from '../../services/i18n';

const { Text } = Typography;

export interface TechFriendlyStripProps {
  readonly mode: 'game' | 'world';
  readonly onOpenResearch?: () => void;
  readonly onOpenWorld?: () => void;
  readonly lingbotMode?: string | null;
  readonly weightsReady?: boolean | null;
  readonly readyReal?: boolean | null;
  /** Game mode: the project's World Spec was compiled into this game (L1). */
  readonly worldCompiled?: boolean;
  /** Game mode: difficulty came from the L2 neural model. */
  readonly worldTunablesSource?: string | null;
}

export const TechFriendlyStrip: React.FC<TechFriendlyStripProps> = ({
  mode,
  onOpenResearch,
  onOpenWorld,
  lingbotMode,
  weightsReady,
  readyReal,
  worldCompiled,
  worldTunablesSource,
}) => {
  const { t } = useT();

  if (mode === 'game') {
    const l2FromWorld = worldTunablesSource === 'l2-hybrid-world-model';
    return (
      <Alert
        type="info"
        showIcon
        icon={<ThunderboltOutlined />}
        style={{ borderRadius: 8, marginBottom: 0 }}
        message={
          <Space
            wrap
            size={[8, 4]}
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            <Space wrap size={[8, 4]}>
              <Text strong>{t('tech.strip.gameTitle')}</Text>
              {worldCompiled ? <Tag color="cyan">L1 Spec → 游戏结构</Tag> : null}
              {l2FromWorld ? <Tag color="purple">L2 难度调参</Tag> : null}
              <Tag>Template Skill</Tag>
              <Tag>ArtDirector</Tag>
              <Tag color="blue">strict gate</Tag>
              <Tag>smoke</Tag>
            </Space>
            {worldCompiled && onOpenWorld ? (
              <Button size="small" onClick={onOpenWorld}>
                {t('world.mode.openPanel')}
              </Button>
            ) : null}
          </Space>
        }
        description={t('tech.strip.gameDesc')}
      />
    );
  }

  return (
    <Alert
      type="success"
      showIcon
      icon={<GlobalOutlined />}
      style={{ borderRadius: 8, marginBottom: 0 }}
      message={
        <Space wrap size={[8, 4]} style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap size={[8, 4]}>
            <Text strong>{t('tech.strip.worldTitle')}</Text>
            <Tag color="cyan">L1 Spec</Tag>
            <Tag color="purple">L2 Agentic</Tag>
            {readyReal || lingbotMode === 'real' ? (
              <Tag color="green">
                L3 LingBot
                {lingbotMode ? ` · ${lingbotMode}` : ''}
              </Tag>
            ) : (
              <Tag>{t('tech.strip.l3Optional')}</Tag>
            )}
            {weightsReady ? <Tag color="processing">weights 8/8</Tag> : null}
            {readyReal ? <Tag color="success">readyReal</Tag> : null}
          </Space>
          <Space size={6}>
            {onOpenWorld ? (
              <Button size="small" onClick={onOpenWorld}>
                {t('world.mode.openPanel')}
              </Button>
            ) : null}
            {onOpenResearch ? (
              <Button
                size="small"
                type="primary"
                ghost
                icon={<ExperimentOutlined />}
                onClick={onOpenResearch}
              >
                {t('world.research.open')}
              </Button>
            ) : null}
          </Space>
        </Space>
      }
      description={t('tech.strip.worldDesc')}
    />
  );
};
