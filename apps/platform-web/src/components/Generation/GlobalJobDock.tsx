/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Floating dock showing project-wide queued/running jobs so "排队" is
 * diagnosable (blocked behind another job vs worker not picking up).
 */

import React, { useMemo, useState } from 'react';
import { Badge, Button, Card, Space, Tag, Tooltip, Typography } from 'antd';
import {
  CloseOutlined,
  CloudServerOutlined,
  LoadingOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  UpOutlined,
} from '@ant-design/icons';
import type { JobRow } from '../../types';
import { useT } from '../../services/i18n';
import { estimateJobRemainMinutes } from '../../utils/jobEta';

const { Text } = Typography;

interface GlobalJobDockProps {
  readonly jobs: JobRow[];
  readonly runningElsewhere?: number;
  readonly activeJobId?: string | null;
  readonly onRefresh: () => void;
  readonly onRecoverStale: () => void;
  readonly onCancelActive?: () => void;
  readonly canCancelActive?: boolean;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function typeLabel(
  type: string,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  const key = `generate.failedJobs.type.${type}`;
  const label = t(key);
  return label === key ? type : label;
}

export const GlobalJobDock: React.FC<GlobalJobDockProps> = ({
  jobs,
  runningElsewhere = 0,
  activeJobId = null,
  onRefresh,
  onRecoverStale,
  onCancelActive,
  canCancelActive = false,
}) => {
  const { t } = useT();
  const [expanded, setExpanded] = useState(true);

  const running = useMemo(
    () => jobs.filter((j) => j.status === 'running'),
    [jobs],
  );
  const queued = useMemo(
    () => jobs.filter((j) => j.status === 'queued'),
    [jobs],
  );
  const count = running.length + queued.length;

  if (count === 0) return null;

  const diagnosis =
    running.length > 0 && queued.length > 0
      ? t('generate.liveJobs.blockedByRunning', { count: running.length })
      : queued.length > 0 && runningElsewhere > 0
        ? t('generate.progress.queuedBehindOther', { count: runningElsewhere })
      : queued.length > 0 && running.length === 0
        ? t('generate.liveJobs.waitingWorker')
        : t('generate.liveJobs.runningOnly', { count: running.length });

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 1100,
        width: expanded ? 320 : 'auto',
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      {!expanded ? (
        <Button
          type="primary"
          shape="round"
          icon={<CloudServerOutlined />}
          onClick={() => setExpanded(true)}
          style={{ boxShadow: '0 8px 24px rgba(15,23,42,0.18)' }}
        >
          <Badge
            count={count}
            size="small"
            offset={[6, -2]}
            style={{ background: '#f59e0b' }}
          />
          {t('generate.liveJobs.pill', { count })}
        </Button>
      ) : (
        <Card
          size="small"
          className="og-job-dock"
          title={
            <Space size={6}>
              <CloudServerOutlined />
              <span>{t('generate.liveJobs.title')}</span>
              <Tag color="orange" style={{ margin: 0 }}>
                {count}
              </Tag>
            </Space>
          }
          extra={
            <Button
              type="text"
              size="small"
              icon={<UpOutlined />}
              onClick={() => setExpanded(false)}
              aria-label="collapse"
            />
          }
          styles={{
            body: { paddingTop: 8, maxHeight: 280, overflowY: 'auto' },
          }}
          style={{
            boxShadow: 'var(--shadow-md)',
            borderRadius: 12,
            background: 'var(--bg-card)',
            borderColor: 'var(--border-color)',
          }}
        >
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            {diagnosis}
          </Text>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {jobs.map((job) => {
              const isActive = job.id === activeJobId;
              return (
                <div
                  key={job.id}
                  style={{
                    border: `1px solid ${isActive ? 'var(--color-ember)' : 'var(--border-color)'}`,
                    borderRadius: 8,
                    padding: '6px 8px',
                    background: isActive
                      ? 'color-mix(in srgb, var(--color-ember) 10%, transparent)'
                      : undefined,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    <Space size={4} wrap>
                      <Tag
                        color={job.status === 'running' ? 'processing' : 'default'}
                        icon={
                          job.status === 'running' ? <LoadingOutlined /> : undefined
                        }
                        style={{ margin: 0 }}
                      >
                        {job.status === 'running'
                          ? t('generate.liveJobs.statusRunning')
                          : t('generate.liveJobs.statusQueued')}
                      </Tag>
                      <Text style={{ fontSize: 12 }}>
                        {typeLabel(job.type, t)}
                      </Text>
                      {(() => {
                        const eta = estimateJobRemainMinutes({
                          lifecycle: job.status,
                          jobType: job.type,
                          startedAt: job.createdAt,
                          percent: job.status === 'queued' ? 0 : 35,
                        });
                        return eta.remainMin > 0 ? (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {t('generate.liveJobs.remain', { min: eta.remainMin })}
                          </Text>
                        ) : null;
                      })()}
                      {isActive ? (
                        <Tag color="blue" style={{ margin: 0 }}>
                          {t('generate.liveJobs.current')}
                        </Tag>
                      ) : null}
                    </Space>
                    <Tooltip title={job.id}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {shortId(job.id)}
                      </Text>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>

          <Space wrap style={{ marginTop: 10 }} size={6}>
            <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh}>
              {t('generate.liveJobs.refresh')}
            </Button>
            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              onClick={onRecoverStale}
            >
              {t('generate.liveJobs.recoverStale')}
            </Button>
            {canCancelActive && onCancelActive ? (
              <Button
                size="small"
                danger
                icon={<CloseOutlined />}
                onClick={onCancelActive}
              >
                {t('generate.cancel')}
              </Button>
            ) : null}
          </Space>
        </Card>
      )}
    </div>
  );
};
