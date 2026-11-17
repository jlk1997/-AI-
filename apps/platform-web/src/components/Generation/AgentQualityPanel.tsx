/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Card,
  Statistic,
  Row,
  Col,
  Typography,
  Spin,
  Badge,
  List,
  Tag,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import { api } from '../../services/api';
import { useT } from '../../services/i18n';
import type { AgentEventRow } from '../../types';
import type { GenerationState, JobLifecycleStatus } from '../../hooks/useGeneration';
import { GenerationProgressFeed } from './GenerationProgressFeed';
import { ProjectBenchStrip } from './ProjectBenchStrip';
import { ProjectTemplateStrip } from './ProjectTemplateStrip';
import { ProjectJobLogStrip } from './ProjectJobLogStrip';
import { ProjectCollaboratorsStrip } from './ProjectCollaboratorsStrip';
import { ProjectOpsStrip } from './ProjectOpsStrip';
import {
  deriveAcceptanceChecks,
  type AcceptanceCheckItem,
} from '../../utils/acceptanceChecks';

const { Text } = Typography;

type TabKey = 'progress' | 'quality';

interface AgentQualityPanelProps {
  projectId: string | null;
  agentEvents: AgentEventRow[];
  generationState: GenerationState;
  isLoading: boolean;
  jobLifecycleStatus: JobLifecycleStatus;
  queuedTimeoutHint: boolean;
  generationMode?: 'game' | 'world';
  activeJobId?: string | null;
  /** Bump to force Quality tab (e.g. LivePreview acceptance click). */
  qualityTabRequest?: number;
  previewUrl?: string | null;
  liveProjectJobs?: Array<{ id: string; status: string; type?: string }>;
  runningElsewhere?: number;
  jobType?: string | null;
  jobStartedAt?: string | null;
  jobCosts?: Record<string, number>;
}

type CheckItem = AcceptanceCheckItem;

const CheckRow: React.FC<{ status: CheckItem['status']; label: string }> = ({
  status,
  label,
}) => {
  const icon =
    status === 'pass' ? (
      <CheckCircleOutlined style={{ color: '#22c55e' }} />
    ) : status === 'fail' ? (
      <CloseCircleOutlined style={{ color: '#ef4444' }} />
    ) : (
      <MinusCircleOutlined style={{ color: '#94a3b8' }} />
    );
  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 8,
        alignItems: 'center',
        fontSize: 12,
      }}
    >
      {icon}
      <span>{label}</span>
      <Tag
        color={
          status === 'pass' ? 'success' : status === 'fail' ? 'error' : 'default'
        }
      >
        {status}
      </Tag>
    </span>
  );
};

const QualityMetricsBody: React.FC<{
  loading: boolean;
  metrics: {
    generateJobs?: { total: number; succeeded: number; failed: number };
    feedback?: { avgRating: string | null; count: number };
    ragChunksIndexed?: number;
  } | null;
  checks: CheckItem[];
}> = ({ loading, metrics, checks }) => {
  const total = metrics?.generateJobs?.total ?? 0;
  const succeeded = Number(metrics?.generateJobs?.succeeded ?? 0);
  const rate = total > 0 ? Math.round((succeeded / total) * 100) : 0;

  return (
    <>
      <Text strong style={{ fontSize: 12 }}>
        Acceptance checklist
      </Text>
      <List
        size="small"
        style={{ marginBottom: 12, marginTop: 4 }}
        dataSource={checks}
        renderItem={(item) => (
          <List.Item style={{ padding: '4px 0' }}>
            <CheckRow status={item.status} label={item.label} />
          </List.Item>
        )}
      />
      {loading ? (
        <Spin size="small" />
      ) : !metrics ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          —
        </Text>
      ) : (
        <>
          <Row gutter={12}>
            <Col span={8}>
              <Statistic title="生成任务" value={total} />
            </Col>
            <Col span={8}>
              <Statistic title="成功率" value={rate} suffix="%" />
            </Col>
            <Col span={8}>
              <Statistic title="RAG 索引" value={metrics.ragChunksIndexed ?? 0} />
            </Col>
          </Row>
          {metrics.feedback?.count ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              用户反馈 {metrics.feedback.count} 条，均分{' '}
              {metrics.feedback.avgRating ?? '-'}
            </Text>
          ) : null}
        </>
      )}
    </>
  );
};

const QualityMetricsBodyWithBench: React.FC<{
  loading: boolean;
  metrics: {
    generateJobs?: { total: number; succeeded: number; failed: number };
    feedback?: { avgRating: string | null; count: number };
    ragChunksIndexed?: number;
  } | null;
  checks: CheckItem[];
  projectId: string;
}> = ({ loading, metrics, checks, projectId }) => (
  <>
    <QualityMetricsBody loading={loading} metrics={metrics} checks={checks} />
    <ProjectTemplateStrip projectId={projectId} />
    <ProjectJobLogStrip projectId={projectId} />
    <ProjectOpsStrip projectId={projectId} />
    <ProjectCollaboratorsStrip projectId={projectId} />
    <ProjectBenchStrip projectId={projectId} />
  </>
);

export const AgentQualityPanel: React.FC<AgentQualityPanelProps> = ({
  projectId,
  agentEvents,
  generationState,
  isLoading,
  jobLifecycleStatus,
  queuedTimeoutHint,
  generationMode = 'game',
  activeJobId = null,
  qualityTabRequest = 0,
  previewUrl = null,
  liveProjectJobs = [],
  runningElsewhere = 0,
  jobType = null,
  jobStartedAt = null,
  jobCosts = {},
}) => {
  const { t } = useT();
  const [activeTab, setActiveTab] = useState<TabKey>('progress');
  const userPickedTabRef = useRef(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metrics, setMetrics] = useState<{
    generateJobs?: { total: number; succeeded: number; failed: number };
    feedback?: { avgRating: string | null; count: number };
    ragChunksIndexed?: number;
  } | null>(null);

  const checks = useMemo(
    () =>
      deriveAcceptanceChecks(agentEvents, generationMode, jobLifecycleStatus),
    [agentEvents, generationMode, jobLifecycleStatus],
  );

  useEffect(() => {
    if (userPickedTabRef.current) return;
    if (
      jobLifecycleStatus === 'failed' ||
      checks.some((c) => c.status === 'fail')
    ) {
      setActiveTab('quality');
    }
  }, [jobLifecycleStatus, checks]);

  useEffect(() => {
    if (!qualityTabRequest) return;
    setActiveTab('quality');
  }, [qualityTabRequest]);

  useEffect(() => {
    if (!projectId) return;
    setMetricsLoading(true);
    api.agent
      .metrics(projectId)
      .then(setMetrics)
      .catch(() => setMetrics(null))
      .finally(() => setMetricsLoading(false));
  }, [projectId]);

  useEffect(() => {
    if (!isLoading) {
      userPickedTabRef.current = false;
      return;
    }
    if (!userPickedTabRef.current) {
      setActiveTab('progress');
    }
  }, [isLoading]);

  if (!projectId) return null;

  const progressTabLabel = isLoading ? (
    <Badge status="processing" text={t('generate.progress.tab.progress')} />
  ) : (
    t('generate.progress.tab.progress')
  );

  return (
    <Card
      size="small"
      style={{ marginTop: 8 }}
      tabList={[
        { key: 'progress', tab: progressTabLabel },
        { key: 'quality', tab: t('generate.progress.tab.quality') },
      ]}
      activeTabKey={activeTab}
      onTabChange={(key) => {
        userPickedTabRef.current = true;
        setActiveTab(key as TabKey);
      }}
    >
      {activeTab === 'progress' ? (
        <GenerationProgressFeed
          agentEvents={agentEvents}
          generationState={generationState}
          isLoading={isLoading}
          jobLifecycleStatus={jobLifecycleStatus}
          queuedTimeoutHint={queuedTimeoutHint}
          generationMode={generationMode}
          activeJobId={activeJobId}
          previewUrl={previewUrl}
          liveProjectJobs={liveProjectJobs}
          runningElsewhere={runningElsewhere}
          jobType={jobType}
          jobStartedAt={jobStartedAt}
          jobCosts={jobCosts}
        />
      ) : (
        <QualityMetricsBodyWithBench
          loading={metricsLoading}
          metrics={metrics}
          checks={checks}
          projectId={projectId}
        />
      )}
    </Card>
  );
};
