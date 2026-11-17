/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Space, Typography, Progress, Badge, Tooltip } from 'antd';
import {
  ClockCircleOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { api } from '../../services/api';

const { Text } = Typography;

interface BuildProgressProps {
  projectId: string;
  jobId: string;
  onComplete?: (previewUrl: string) => void;
  onError?: (error: string) => void;
}

interface ProgressInfo {
  jobId: string;
  status: string;
  type: string;
  stage: 'queued' | 'installing' | 'building' | 'optimizing' | 'uploading' | 'done' | 'failed';
  progress: number;
  buildCacheKey?: string;
  createdAt: string;
  updatedAt: string;
}

const stageLabels: Record<string, { label: string; icon: React.ReactNode }> = {
  queued: { label: '等待中', icon: <ClockCircleOutlined /> },
  installing: { label: '安装依赖', icon: <DownloadOutlined /> },
  building: { label: '编译代码', icon: <ThunderboltOutlined /> },
  optimizing: { label: '优化压缩', icon: <DownloadOutlined /> },
  uploading: { label: '上传产物', icon: <DownloadOutlined /> },
  done: { label: '构建完成', icon: <CheckCircleOutlined /> },
  failed: { label: '构建失败', icon: <CloseCircleOutlined /> },
};

export const BuildProgress: React.FC<BuildProgressProps> = ({
  projectId,
  jobId,
  onComplete,
  onError,
}) => {
  const [progressInfo, setProgressInfo] = useState<ProgressInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let pollingTimer: NodeJS.Timeout | null = null;

    const pollProgress = async () => {
      try {
        const info = await api.jobs.getProgress(projectId, jobId);
        setProgressInfo(info);

        if (info.status === 'succeeded') {
          if (pollingTimer) {
            clearInterval(pollingTimer);
            pollingTimer = null;
          }
          // 获取预览 URL
          try {
            const deployments = await api.deployments.list(projectId);
            if (deployments.deployments.length > 0) {
              const latestDeployment = deployments.deployments[0];
              const previewData = await api.deployments.getPreviewUrl(latestDeployment.id);
              onComplete?.(previewData.url);
            }
          } catch (e) {
            // 忽略预览 URL 获取错误
          }
        } else if (info.status === 'failed') {
          if (pollingTimer) {
            clearInterval(pollingTimer);
            pollingTimer = null;
          }
          setErrorMsg('构建失败，请查看日志了解详情');
          onError?.('Build failed');
        }
      } catch (err) {
        console.error('Failed to poll build progress:', err);
      }
    };

    // 立即查询一次
    pollProgress();

    // 每 3 秒轮询一次
    pollingTimer = setInterval(pollProgress, 3000);

    return () => {
      if (pollingTimer) {
        clearInterval(pollingTimer);
      }
    };
  }, [projectId, jobId, onComplete, onError]);

  if (!progressInfo) {
    return (
      <div
        style={{
          padding: 16,
          background: 'rgba(99, 102, 241, 0.1)',
          borderRadius: 8,
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">正在获取构建状态...</Text>
          <Progress percent={0} status="active" showInfo={false} />
        </Space>
      </div>
    );
  }

  const currentStage = stageLabels[progressInfo.stage] || stageLabels.queued;
  const isFailed = progressInfo.stage === 'failed';
  const isDone = progressInfo.stage === 'done';

  return (
    <div
      style={{
        padding: 16,
        background: isFailed
          ? 'rgba(239, 68, 68, 0.1)'
          : isDone
            ? 'rgba(34, 197, 94, 0.1)'
            : 'rgba(99, 102, 241, 0.1)',
        borderRadius: 8,
        border: `1px solid ${isFailed ? 'rgba(239, 68, 68, 0.3)' : isDone ? 'rgba(34, 197, 94, 0.3)' : 'rgba(99, 102, 241, 0.3)'}`,
      }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {/* 阶段状态 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Badge
              status={
                isFailed ? 'error' : isDone ? 'success' : 'processing'
              }
            />
            <Text strong style={{ color: isFailed ? '#ef4444' : isDone ? '#22c55e' : 'var(--color-ember)' }}>
              {currentStage.label}
            </Text>
          </Space>
          {progressInfo.buildCacheKey && (
            <Tooltip title="构建缓存 Key，相同配置可复用">
              <Text type="secondary" style={{ fontSize: 11 }}>
                缓存: {progressInfo.buildCacheKey}
              </Text>
            </Tooltip>
          )}
        </div>

        {/* 进度条 */}
        <Progress
          percent={progressInfo.progress}
          status={isFailed ? 'exception' : isDone ? 'success' : 'active'}
          strokeColor={isFailed ? '#ef4444' : isDone ? '#22c55e' : 'var(--color-ember)'}
        />

        {/* 时间信息 */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            开始时间: {new Date(progressInfo.createdAt).toLocaleTimeString()}
          </Text>
          {progressInfo.updatedAt !== progressInfo.createdAt && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              更新时间: {new Date(progressInfo.updatedAt).toLocaleTimeString()}
            </Text>
          )}
        </div>

        {/* 错误信息 */}
        {errorMsg && (
          <Text type="danger" style={{ fontSize: 12 }}>
            {errorMsg}
          </Text>
        )}
      </Space>
    </div>
  );
};
