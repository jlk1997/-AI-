/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Empty,
  Segmented,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  AudioOutlined,
  CustomerServiceOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SoundOutlined,
} from '@ant-design/icons';

import { api } from '../../services/api';
import type { AssetModality, AssetRow } from '../../types';

const { Text } = Typography;

interface AssetGalleryProps {
  readonly projectId: string | null;
}

const FILTERS: ReadonlyArray<{ value: AssetModality | 'all'; label: React.ReactNode }> = [
  { value: 'all', label: '全部' },
  { value: 'image', label: <Space size={4}><PictureOutlined /> 图像</Space> },
  { value: 'audio', label: <Space size={4}><AudioOutlined /> 音效</Space> },
  { value: 'music', label: <Space size={4}><CustomerServiceOutlined /> 音乐</Space> },
  { value: 'video', label: <Space size={4}><PlayCircleOutlined /> 视频</Space> },
  { value: 'speech', label: <Space size={4}><SoundOutlined /> 语音</Space> },
];

/**
 * Read-only grid of all multi-modal generation outputs registered to a
 * project. We never auto-play audio/video — clicking a card opens a tooltip
 * with the prompt, license and cost so the user can decide whether to retain.
 */
export const AssetGallery: React.FC<AssetGalleryProps> = ({ projectId }) => {
  const [filter, setFilter] = useState<AssetModality | 'all'>('all');
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAssets = useMemo(
    () => async (): Promise<void> => {
      if (!projectId) {
        setRows([]);
        return;
      }
      setLoading(true);
      try {
        const res = await api.assets.list(projectId, filter === 'all' ? undefined : filter);
        setRows(res.assets);
      } catch (err) {
        message.error(`资产加载失败: ${(err as Error).message}`);
      } finally {
        setLoading(false);
      }
    },
    [projectId, filter],
  );

  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  if (!projectId) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="尚未选择项目"
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <Space style={{ padding: '4px 8px' }}>
        <Segmented
          size="small"
          options={FILTERS.map((f) => ({ label: f.label, value: f.value }))}
          value={filter}
          onChange={(v) => setFilter(v as AssetModality | 'all')}
        />
        <Tooltip title="刷新">
          <ReloadOutlined onClick={() => void fetchAssets()} />
        </Tooltip>
      </Space>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : rows.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="本项目暂无生成资产"
          style={{ marginTop: 24 }}
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 8,
            padding: '0 8px 8px',
            overflowY: 'auto',
            flex: 1,
            minHeight: 0,
          }}
        >
          {rows.map((row) => (
            <Card
              key={row.id}
              size="small"
              hoverable
              cover={renderCover(row)}
              styles={{ body: { padding: 8 } }}
            >
              <Tooltip title={row.prompt ?? '(无 prompt)'}>
                <Text ellipsis style={{ fontSize: 11, color: '#a1a1aa' }}>
                  {row.prompt ?? `${row.modality}/${row.externalId ?? row.id.slice(0, 6)}`}
                </Text>
              </Tooltip>
              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <Tag style={{ margin: 0, fontSize: 10 }}>{row.modality}</Tag>
                {row.licenseTag && (
                  <Tag color="purple" style={{ margin: 0, fontSize: 10 }}>
                    {row.licenseTag}
                  </Tag>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

function renderCover(row: AssetRow): React.ReactNode {
  const url = row.publicThumbnailUrl ?? row.publicUrl;
  if (row.modality === 'image' && url) {
    return (
      <img
        src={url}
        alt={row.prompt ?? row.id}
        style={{ width: '100%', height: 96, objectFit: 'cover' }}
      />
    );
  }
  if (row.modality === 'video' && url) {
    return (
      <video
        src={url}
        style={{ width: '100%', height: 96, objectFit: 'cover', background: '#000' }}
        muted
      />
    );
  }
  return (
    <div
      style={{
        height: 96,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(99,102,241,0.08)',
        color: '#a5b4fc',
        fontSize: 24,
      }}
    >
      {row.modality === 'audio' ? <AudioOutlined /> : row.modality === 'music' ? <CustomerServiceOutlined /> : row.modality === 'speech' ? <SoundOutlined /> : <PictureOutlined />}
    </div>
  );
}
