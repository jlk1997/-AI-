/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Author-facing bench results for this project. Public leaderboard stays
 * behind the ecosystem flag; this strip is the studio quality loop.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, List, Tag, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { api } from '../../services/api';
import { useT } from '../../services/i18n';

const { Text } = Typography;

export type ProjectBenchRun = {
  id: string;
  status: string;
  scores: Record<string, unknown> | null;
  publicLabel: string | null;
  isPublic: boolean;
  createdAt: string;
};

function scoreLine(scores: Record<string, unknown> | null): string {
  if (!scores) return '—';
  const nums = Object.entries(scores).filter(([, v]) => typeof v === 'number');
  if (nums.length === 0) {
    const src = typeof scores.commandSource === 'string' ? scores.commandSource : '';
    const ms = typeof scores.elapsedMs === 'number' ? `${scores.elapsedMs}ms` : '';
    return [src, ms].filter(Boolean).join(' · ') || '—';
  }
  return nums
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v as number}`)
    .join('  ');
}

export const ProjectBenchStrip: React.FC<{
  readonly projectId: string;
  readonly refreshToken?: number;
}> = ({ projectId, refreshToken = 0 }) => {
  const { t } = useT();
  const [runs, setRuns] = useState<ProjectBenchRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.projects.benchRuns(projectId);
      setRuns(res.runs);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const run = async (): Promise<void> => {
    setRunning(true);
    try {
      await api.projects.runBench(projectId);
      await load();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <Text strong style={{ fontSize: 12 }}>
          {t('generate.bench.title')}
        </Text>
        <Button
          size="small"
          type="primary"
          ghost
          icon={<ThunderboltOutlined />}
          loading={running}
          onClick={() => void run()}
        >
          {t('generate.bench.run')}
        </Button>
      </div>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
        {t('generate.bench.hint')}
      </Text>
      <List
        size="small"
        loading={loading}
        locale={{ emptyText: t('generate.bench.empty') }}
        dataSource={runs.slice(0, 6)}
        renderItem={(runRow) => (
          <List.Item style={{ padding: '4px 0' }}>
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Tag color={runRow.status === 'succeeded' ? 'success' : 'default'}>
                  {runRow.status}
                </Tag>
                {runRow.publicLabel ? <Tag color="blue">{runRow.publicLabel}</Tag> : null}
                {runRow.isPublic ? <Tag>{t('generate.bench.public')}</Tag> : null}
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {new Date(runRow.createdAt).toLocaleString()}
                </Text>
              </div>
              <Text style={{ fontSize: 12 }}>{scoreLine(runRow.scores)}</Text>
            </div>
          </List.Item>
        )}
      />
    </div>
  );
};
