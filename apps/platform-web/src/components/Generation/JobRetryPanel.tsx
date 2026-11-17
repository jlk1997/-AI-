/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Card, Typography, Button, Space, Tag, Divider } from 'antd';
import {
  ReloadOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  FormOutlined,
} from '@ant-design/icons';
import { api } from '../../services/api';
import { useT } from '../../services/i18n';
import { attachDeadLetters } from '../../hooks/useGenerationJobs';
import { parseRecoverySuggestedPrompts } from '../../utils/jobFailureText';

const { Text } = Typography;

export interface FailedJob {
  id: string;
  type: 'generate' | 'build' | 'publish' | 'bench' | 'world_generate' | 'world_edit';
  status: 'failed';
  logKey: string | null;
  retryCount: number;
  createdAt: string;
  errorMessage?: string;
  deadLetter?: boolean;
  deadLetterId?: string;
}

interface JobRetryPanelProps {
  projectId?: string | null;
  failedJobs: FailedJob[];
  onRetry: (jobId: string) => Promise<void>;
  onViewLog: (jobId: string, logKey: string | null) => void;
  /** Fill chat input with a recovery suggested prompt (Phase-34). */
  onUseSuggestion?: (prompt: string) => void;
  /** Send recovery suggestion immediately (Phase-35). */
  onSendSuggestion?: (prompt: string) => void;
  loading?: boolean;
}

export const JobRetryPanel: React.FC<JobRetryPanelProps> = ({
  projectId = null,
  failedJobs,
  onRetry,
  onViewLog,
  onUseSuggestion,
  onSendSuggestion,
  loading = false,
}) => {
  const { t, locale } = useT();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [rows, setRows] = useState(failedJobs);

  useEffect(() => {
    setRows(failedJobs);
    if (!projectId || failedJobs.length === 0) return;
    let cancelled = false;
    void api.projects
      .deadLetters(projectId)
      .then((res) => {
        if (!cancelled) setRows(attachDeadLetters(failedJobs, res.letters));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, failedJobs]);

  if (rows.length === 0) {
    return null;
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const localeTag = locale === 'zh-CN' ? 'zh-CN' : 'en-US';
    return date.toLocaleString(localeTag, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getJobTypeName = (type: string) => {
    const key = `generate.failedJobs.type.${type}`;
    const label = t(key);
    return label !== key ? label : type;
  };

  const getJobTypeIcon = (type: string) => {
    const icons: Record<string, React.ReactNode> = {
      generate: <ThunderboltOutlined style={{ color: '#a855f7' }} />,
      build: <ReloadOutlined style={{ color: '#f59e0b' }} />,
      publish: <CheckCircleOutlined style={{ color: '#22c55e' }} />,
      bench: <ClockCircleOutlined style={{ color: '#6366f1' }} />,
      world_generate: <ThunderboltOutlined style={{ color: '#14b8a6' }} />,
      world_edit: <FormOutlined style={{ color: '#0d9488' }} />,
    };
    return icons[type] || <ExclamationCircleOutlined />;
  };

  const handleRetry = async (jobId: string) => {
    setRetryingId(jobId);
    try {
      await onRetry(jobId);
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <ExclamationCircleOutlined style={{ color: '#ef4444' }} />
          <Text>{t('generate.failedJobs.cardTitle', { count: rows.length })}</Text>
        </Space>
      }
      styles={{ body: { padding: 0 } }}
    >
      {rows.some((job) => job.deadLetter) ? (
        <div className="og-author-alert">
          {t('generate.failedJobs.deadAlert', {
            n: rows.filter((job) => job.deadLetter).length,
          })}
        </div>
      ) : null}
      {rows.map((job, index) => {
        const suggestions = parseRecoverySuggestedPrompts(
          job.errorMessage || job.logKey,
        );
        return (
          <div key={job.id}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                padding: '8px 12px',
                alignItems: 'flex-start',
              }}
            >
              <div style={{ flexShrink: 0, lineHeight: 1 }}>{getJobTypeIcon(job.type)}</div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <Space wrap>
                  <Text>{getJobTypeName(job.type)}</Text>
                  {job.retryCount > 0 && (
                    <Tag color="orange" style={{ fontSize: 10 }}>
                      {t('generate.failedJobs.retried', { count: job.retryCount })}
                    </Tag>
                  )}
                  {job.deadLetter ? (
                    <Tag color="red" style={{ fontSize: 10 }}>
                      {t('generate.failedJobs.deadLetter')}
                    </Tag>
                  ) : null}
                </Space>
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {formatTime(job.createdAt)}
                  </Text>
                  {(job.errorMessage || job.logKey) && (
                    <Text
                      type="danger"
                      style={{
                        fontSize: 11,
                        display: 'block',
                        marginTop: 4,
                        whiteSpace: 'pre-wrap',
                        maxHeight: 96,
                        overflow: 'auto',
                      }}
                    >
                      {job.errorMessage || job.logKey}
                    </Text>
                  )}
                  {suggestions.length > 0 &&
                  (onUseSuggestion || onSendSuggestion) ? (
                    <div style={{ marginTop: 8 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {t('generate.failedJobs.useSuggestionHint')}
                      </Text>
                      <Space
                        orientation="vertical"
                        size={4}
                        style={{ marginTop: 4, width: '100%' }}
                      >
                        {suggestions.map((prompt, i) => (
                          <Space key={`${job.id}-s-${i}`} wrap size={[4, 4]}>
                            <Text
                              style={{ fontSize: 11, maxWidth: 280 }}
                              ellipsis={{ tooltip: prompt }}
                            >
                              {i + 1}. {prompt}
                            </Text>
                            {onUseSuggestion ? (
                              <Button
                                size="small"
                                type="dashed"
                                icon={<FormOutlined />}
                                disabled={loading}
                                onClick={() => onUseSuggestion(prompt)}
                              >
                                {t('generate.failedJobs.useSuggestion', {
                                  n: i + 1,
                                })}
                              </Button>
                            ) : null}
                            {onSendSuggestion ? (
                              <Button
                                size="small"
                                type="primary"
                                ghost
                                icon={<ThunderboltOutlined />}
                                disabled={loading}
                                onClick={() => onSendSuggestion(prompt)}
                              >
                                {t('generate.failedJobs.sendSuggestion')}
                              </Button>
                            ) : null}
                          </Space>
                        ))}
                      </Space>
                    </div>
                  ) : null}
                </div>
              </div>
              <Space wrap style={{ flexShrink: 0, marginLeft: 'auto' }}>
                <Button
                  type="default"
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={loading || retryingId === job.id}
                  disabled={loading || (retryingId !== null && retryingId !== job.id)}
                  onClick={() => void handleRetry(job.id)}
                >
                  {t('generate.failedJobs.retry')}
                </Button>
                <Button
                  type="default"
                  size="small"
                  icon={<FileTextOutlined />}
                  onClick={() => onViewLog(job.id, job.logKey)}
                >
                  {t('generate.failedJobs.log')}
                </Button>
              </Space>
            </div>
            {index < rows.length - 1 ? <Divider style={{ margin: 0 }} /> : null}
          </div>
        );
      })}
    </Card>
  );
};
