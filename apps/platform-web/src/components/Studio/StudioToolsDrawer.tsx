/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Secondary tools rail — quality, code, assets, world settings, feedback.
 * Kept off the primary stage so Game iframe / Society Observatory stay full height.
 */

import React from 'react';
import { Drawer, Tabs } from 'antd';
import {
  ExperimentOutlined,
  DiffOutlined,
  PictureOutlined,
  GlobalOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import { useT } from '../../services/i18n';
import type {
  GenerationState,
  JobLifecycleStatus,
} from '../../hooks/useGeneration';
import type { GenerationMode } from '../World/worldTemplates';
import type { AgentEventRow } from '../../types';
import type { FileTreeChange } from '../Code/FileTree';
import { AgentQualityPanel } from '../Generation/AgentQualityPanel';
import { CodeChangesPanel } from '../Code/CodeChangesPanel';
import { AssetGallery } from '../Asset/AssetGallery';
import { WorldPanel } from '../World/WorldPanel';
import { JobFeedbackPanel } from '../Generation/JobFeedbackPanel';

export type StudioToolsTab = 'quality' | 'code' | 'assets' | 'world' | 'feedback';

interface StudioToolsDrawerProps {
  open: boolean;
  onClose: () => void;
  activeTab: StudioToolsTab;
  onTabChange: (tab: StudioToolsTab) => void;
  generationMode: GenerationMode;
  projectId: string | null;
  agentEvents: AgentEventRow[];
  generationState: GenerationState;
  isLoading: boolean;
  jobLifecycleStatus: JobLifecycleStatus;
  queuedTimeoutHint: boolean;
  activeJobId: string | null;
  qualityTabRequest: number;
  previewUrl: string | null;
  liveProjectJobs: Array<{ id: string; status: string; type?: string }>;
  runningElsewhere?: number;
  jobType?: string | null;
  jobStartedAt?: string | null;
  jobCosts?: Record<string, number>;
  codeChanges: ReadonlyArray<FileTreeChange>;
  worldRefreshToken: number;
  researchFocusToken: number;
  onPreviewRemount: () => void;
  onRequestWorldGenerate: (prompt?: string) => void;
  onRequestWorldEdit: (prompt: string) => void;
  lastSuccessJobId: string | null;
}

export const StudioToolsDrawer: React.FC<StudioToolsDrawerProps> = ({
  open,
  onClose,
  activeTab,
  onTabChange,
  generationMode,
  projectId,
  agentEvents,
  generationState,
  isLoading,
  jobLifecycleStatus,
  queuedTimeoutHint,
  activeJobId,
  qualityTabRequest,
  previewUrl,
  liveProjectJobs,
  runningElsewhere = 0,
  jobType = null,
  jobStartedAt = null,
  jobCosts = {},
  codeChanges,
  worldRefreshToken,
  researchFocusToken,
  onPreviewRemount,
  onRequestWorldGenerate,
  onRequestWorldEdit,
  lastSuccessJobId,
}) => {
  const { t } = useT();

  const items = [
    {
      key: 'quality',
      label: (
        <span>
          <ExperimentOutlined /> {t('product.tools.quality')}
        </span>
      ),
      children: (
        <AgentQualityPanel
          projectId={projectId}
          agentEvents={agentEvents}
          generationState={generationState}
          isLoading={isLoading}
          jobLifecycleStatus={jobLifecycleStatus}
          queuedTimeoutHint={queuedTimeoutHint}
          generationMode={generationMode}
          activeJobId={activeJobId}
          qualityTabRequest={qualityTabRequest}
          previewUrl={previewUrl}
          liveProjectJobs={liveProjectJobs}
          runningElsewhere={runningElsewhere}
          jobType={jobType}
          jobStartedAt={jobStartedAt}
          jobCosts={jobCosts}
        />
      ),
    },
    {
      key: 'code',
      label: (
        <span>
          <DiffOutlined /> {t('product.tools.code')}
        </span>
      ),
      children: <CodeChangesPanel changes={codeChanges} />,
    },
    {
      key: 'assets',
      label: (
        <span>
          <PictureOutlined /> {t('product.tools.assets')}
        </span>
      ),
      children: <AssetGallery projectId={projectId} />,
    },
    ...(generationMode === 'world'
      ? [
          {
            key: 'world' as const,
            label: (
              <span>
                <GlobalOutlined /> {t('product.tools.world')}
              </span>
            ),
            children: (
              <WorldPanel
                key={worldRefreshToken}
                projectId={projectId}
                refreshToken={worldRefreshToken}
                researchFocusToken={researchFocusToken}
                onPreviewRemount={onPreviewRemount}
                onRequestWorldGenerate={onRequestWorldGenerate}
                onRequestWorldEdit={onRequestWorldEdit}
              />
            ),
          },
        ]
      : []),
    {
      key: 'feedback',
      label: (
        <span>
          <MessageOutlined /> {t('product.tools.feedback')}
        </span>
      ),
      children:
        projectId && lastSuccessJobId ? (
          <JobFeedbackPanel projectId={projectId} jobId={lastSuccessJobId} />
        ) : (
          <div style={{ padding: 16, color: '#94a3b8' }}>
            {t('product.tools.feedbackEmpty')}
          </div>
        ),
    },
  ];

  return (
    <Drawer
      title={t('product.tools.title')}
      placement="right"
      size={Math.min(720, typeof window !== 'undefined' ? window.innerWidth - 40 : 720)}
      open={open}
      onClose={onClose}
      destroyOnHidden={false}
      styles={{ body: { paddingTop: 8 } }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={(k) => onTabChange(k as StudioToolsTab)}
        items={items}
        size="small"
      />
    </Drawer>
  );
};
