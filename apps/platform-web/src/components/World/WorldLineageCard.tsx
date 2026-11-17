/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Where did this game come from?" card. Reads the WORLD agent events the
 * worker emits (world→game compile + lineage gate) so players can see the world
 * model actually shaped the game instead of taking it on faith.
 */

import React from 'react';
import { Alert, Button, Space, Tag, Tooltip, Typography } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';

import type { LineageCoverage, WorldLineageSnapshot } from '../../utils/worldLineage';

const { Text } = Typography;

export interface WorldLineageCardProps {
  readonly snapshot: WorldLineageSnapshot;
  readonly onOpenWorld?: () => void;
}

function coverageTag(
  label: string,
  coverage: LineageCoverage | undefined,
): React.ReactNode {
  if (!coverage || coverage.total === 0) return null;
  const complete = coverage.present >= coverage.total;
  const missing = coverage.missing?.slice(0, 6).join(', ');
  const tag = (
    <Tag color={complete ? 'green' : 'orange'} style={{ margin: 0 }}>
      {label} {coverage.present}/{coverage.total}
    </Tag>
  );
  return missing ? (
    <Tooltip key={label} title={`缺失：${missing}`}>
      {tag}
    </Tooltip>
  ) : (
    <React.Fragment key={label}>{tag}</React.Fragment>
  );
}

export const WorldLineageCard: React.FC<WorldLineageCardProps> = ({
  snapshot,
  onOpenWorld,
}) => {
  const { stats, coverage } = snapshot;
  const title = snapshot.worldTitle ?? '关联世界';
  const headline =
    snapshot.summaryLines[0] ??
    (stats
      ? `由世界《${title}》编译：${stats.regions} 区域 / ${stats.entities} 实体 / ${stats.quests} 任务`
      : `由世界《${title}》编译`);

  return (
    <Alert
      type={snapshot.gateOk === false ? 'warning' : 'success'}
      showIcon
      icon={<GlobalOutlined />}
      style={{ borderRadius: 8 }}
      title={
        <Space
          wrap
          size={[8, 4]}
          style={{ width: '100%', justifyContent: 'space-between' }}
        >
          <Space wrap size={[8, 4]}>
            <Text strong style={{ fontSize: 12 }}>
              {headline}
            </Text>
            {coverageTag('区域', coverage?.scenes)}
            {coverageTag('实体', coverage?.entities)}
            {coverageTag('任务', coverage?.quests)}
            {coverageTag('传送点', coverage?.portals)}
          </Space>
          {onOpenWorld ? (
            <Button size="small" onClick={onOpenWorld}>
              对照世界面板
            </Button>
          ) : null}
        </Space>
      }
      description={
        <Space orientation="vertical" size={2} style={{ fontSize: 11 }}>
          {snapshot.initialSceneId ? (
            <Text type="secondary" style={{ fontSize: 11 }}>
              起始场景 {snapshot.initialSceneId}
              {snapshot.scenes.length > 1
                ? ` · 全部场景 ${snapshot.scenes.join(', ')}`
                : ''}
            </Text>
          ) : null}
          {snapshot.tunables && snapshot.tunablesSource ? (
            <Text type="secondary" style={{ fontSize: 11 }}>
              难度由 {snapshot.tunablesSource} 调参：
              {Object.entries(snapshot.tunables)
                .map(([k, v]) => `${k}=${v}`)
                .join(' · ')}
            </Text>
          ) : null}
          {snapshot.gateOk === false ? (
            <Text type="warning" style={{ fontSize: 11 }}>
              世界血缘校验未通过 — Agent 正在补回缺失的区域 / 任务。
            </Text>
          ) : null}
        </Space>
      }
    />
  );
};
