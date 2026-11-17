/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Collapse,
  Drawer,
  Empty,
  List,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';

import { AssetGallery } from '../../components/Asset/AssetGallery.js';
import { IterationHistory } from '../../components/Conversation/IterationHistory.js';
import type { IterationRecord } from '../../components/Conversation/IterationHistory.js';
import type { FileChange } from '../../hooks/useGeneration.js';
import { useT } from '../../services/i18n.js';
import type { AgentEventRow } from '../../types/index.js';
import { collectPipelineStagePayload } from '../../utils/creationPipeline.js';

const { Text, Paragraph } = Typography;

/** Monaco is ~1 MB. A phone only pays for it if someone opens the diff. */
const CodeChangesPanel = React.lazy(() =>
  import('../../components/Code/CodeChangesPanel.js').then((m) => ({
    default: m.CodeChangesPanel,
  })),
);

const SocietyTownAuthorSheet = React.lazy(() =>
  import('./SocietyTownAuthorSheet.js').then((m) => ({
    default: m.SocietyTownAuthorSheet,
  })),
);

export type ToolsTab = 'assets' | 'code' | 'quality' | 'history' | 'observatory';

export interface ToolsSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly tab: ToolsTab;
  readonly onTabChange: (tab: ToolsTab) => void;
  readonly projectId: string | null;
  readonly mode: 'game' | 'world';
  readonly codeChanges: FileChange[];
  readonly agentEvents: AgentEventRow[];
  readonly activeJobId: string | null;
  readonly iterationRecords: IterationRecord[];
  readonly failedJobs: ReadonlyArray<{ id: string; type: string; logKey: string | null }>;
  readonly onRetryJob: (jobId: string) => void;
}

const TYPE_COLOR: Record<FileChange['type'], string> = {
  added: 'green',
  modified: 'blue',
  deleted: 'red',
};

/**
 * Everything the desktop keeps in side panels, folded into one sheet. The
 * ordering is deliberate: a phone author wants to see what the agent made
 * (assets) and whether it works (quality) far more often than a diff.
 */
export const ToolsSheet: React.FC<ToolsSheetProps> = ({
  open,
  onClose,
  tab,
  onTabChange,
  projectId,
  mode,
  codeChanges,
  agentEvents,
  activeJobId,
  iterationRecords,
  failedJobs,
  onRetryJob,
}) => {
  const { t } = useT();
  const [diffOpen, setDiffOpen] = useState(false);

  const payload = useMemo(
    () => collectPipelineStagePayload(agentEvents, activeJobId),
    [agentEvents, activeJobId],
  );

  const options = useMemo(() => {
    const base: Array<{ label: string; value: ToolsTab }> = [
      { label: t('mobile.studio.tools.assets'), value: 'assets' },
      { label: t('mobile.studio.tools.quality'), value: 'quality' },
      { label: t('mobile.studio.tools.code'), value: 'code' },
      { label: t('mobile.studio.tools.history'), value: 'history' },
    ];
    if (mode === 'world') {
      base.push({ label: t('mobile.studio.tools.observatory'), value: 'observatory' });
    }
    return base;
  }, [mode, t]);

  return (
    <Drawer
      className="og-sheet"
      placement="bottom"
      size="84%"
      open={open}
      onClose={onClose}
      title={t('mobile.studio.tools.title')}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Segmented
          block
          value={tab}
          options={options}
          onChange={(v) => onTabChange(v as ToolsTab)}
        />

        {tab === 'assets' && <AssetGallery projectId={projectId} />}

        {tab === 'quality' && (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {payload.smokeOk === false || payload.playable === false ? (
              <Alert
                type="warning"
                showIcon
                message={t('mobile.studio.quality.unplayable')}
                description={
                  payload.qaIssues.length > 0 ? payload.qaIssues.join('\n') : undefined
                }
              />
            ) : payload.smokeOk ? (
              <Alert type="success" showIcon message={t('mobile.studio.quality.ok')} />
            ) : (
              <Alert type="info" showIcon message={t('mobile.studio.quality.unknown')} />
            )}

            <Space wrap size={6}>
              {payload.archetype && <Tag>{payload.archetype}</Tag>}
              {payload.sceneCount != null && (
                <Tag>
                  {t('mobile.studio.quality.scenes', { count: String(payload.sceneCount) })}
                </Tag>
              )}
              <Tag>
                {t('mobile.studio.quality.images', {
                  count: String(payload.imageFiles.length),
                })}
              </Tag>
              <Tag>
                {t('mobile.studio.quality.audio', {
                  count: String(payload.audioFiles.length),
                })}
              </Tag>
              {payload.model && <Tag color="purple">{payload.model}</Tag>}
            </Space>

            {payload.failoverNotes.length > 0 && (
              <Alert
                type="info"
                showIcon
                message={payload.failoverNotes.join(' · ')}
              />
            )}

            {failedJobs.length > 0 && (
              <List
                size="small"
                header={<Text strong>{t('mobile.studio.quality.failedJobs')}</Text>}
                dataSource={[...failedJobs]}
                renderItem={(job) => (
                  <List.Item
                    actions={[
                      <Button
                        key="retry"
                        size="small"
                        onClick={() => onRetryJob(job.id)}
                      >
                        {t('mobile.studio.quality.retry')}
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={job.type}
                      description={
                        <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                          {job.logKey ?? ''}
                        </Text>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Space>
        )}

        {tab === 'code' &&
          (codeChanges.length === 0 ? (
            <Empty description={t('mobile.studio.code.empty')} />
          ) : (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('mobile.studio.code.summary', { count: String(codeChanges.length) })}
              </Text>
              <List
                size="small"
                dataSource={codeChanges}
                renderItem={(c) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space size={6}>
                          <Tag color={TYPE_COLOR[c.type]}>
                            {t(`mobile.studio.code.type.${c.type}`)}
                          </Tag>
                          <Text style={{ fontSize: 13 }}>
                            {c.filename.split('/').pop()}
                          </Text>
                        </Space>
                      }
                      description={
                        <Paragraph
                          type="secondary"
                          style={{ fontSize: 12, marginBottom: 0 }}
                          ellipsis={{ rows: 2 }}
                        >
                          {c.summary ?? c.filename}
                        </Paragraph>
                      }
                    />
                  </List.Item>
                )}
              />
              <Collapse
                ghost
                activeKey={diffOpen ? ['diff'] : []}
                onChange={(keys) => setDiffOpen(keys.length > 0)}
                items={[
                  {
                    key: 'diff',
                    label: t('mobile.studio.code.openDiff'),
                    children: diffOpen ? (
                      <Suspense fallback={<Spin />}>
                        <div style={{ height: 360 }}>
                          <CodeChangesPanel changes={codeChanges} />
                        </div>
                      </Suspense>
                    ) : null,
                  },
                ]}
              />
            </Space>
          ))}

        {tab === 'history' &&
          (iterationRecords.length === 0 ? (
            <Empty description={t('mobile.studio.history.empty')} />
          ) : (
            <IterationHistory
              iterations={iterationRecords}
              currentVersion={iterationRecords.length}
            />
          ))}

        {tab === 'observatory' &&
          (projectId ? (
            <Suspense fallback={<Spin />}>
              <SocietyTownAuthorSheet projectId={projectId} />
            </Suspense>
          ) : (
            <Empty description={t('mobile.studio.observatory.empty')} />
          ))}
      </Space>
    </Drawer>
  );
};

export default ToolsSheet;
