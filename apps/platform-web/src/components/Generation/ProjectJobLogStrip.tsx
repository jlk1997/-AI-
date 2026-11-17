/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Last jobs' full CLI / build logs. Reads through the API proxy so S3 CORS
 * cannot hide the transcript.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Drawer, List, Tag, Typography } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { api } from '../../services/api';
import { useT } from '../../services/i18n';
import type { JobRow } from '../../types';

const { Text } = Typography;

export const ProjectJobLogStrip: React.FC<{
  readonly projectId: string;
  readonly refreshToken?: number;
}> = ({ projectId, refreshToken = 0 }) => {
  const { t } = useT();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [logTitle, setLogTitle] = useState('');
  const [logText, setLogText] = useState('');
  const [logLoading, setLogLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.jobs.list(projectId);
      setJobs(res.jobs.slice(0, 8));
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const view = async (job: JobRow): Promise<void> => {
    setOpen(true);
    setLogTitle(t('generate.logs.full', { type: job.type }));
    setLogLoading(true);
    setLogText(t('common.loading'));
    try {
      const res = await api.jobs.getLog(job.id);
      setLogText(res.text || t('generate.failedJobs.logEmpty'));
    } catch (err) {
      setLogText(
        t('generate.failedJobs.logFetchFailed', {
          msg: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setLogLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
        {t('generate.logs.title')}
      </Text>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
        {t('generate.logs.hint')}
      </Text>
      <List
        size="small"
        loading={loading}
        locale={{ emptyText: t('generate.logs.empty') }}
        dataSource={jobs.filter((job) => job.logKey)}
        renderItem={(job) => (
          <List.Item
            style={{ padding: '4px 0' }}
            actions={[
              <Button
                key="log"
                size="small"
                icon={<FileTextOutlined />}
                onClick={() => void view(job)}
              >
                {t('generate.logs.view')}
              </Button>,
            ]}
          >
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <Tag color={job.status === 'succeeded' ? 'success' : job.status === 'failed' ? 'error' : 'default'}>
                {job.status}
              </Tag>
              <Text style={{ fontSize: 12 }}>{job.type}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {new Date(job.createdAt).toLocaleString()}
              </Text>
            </div>
          </List.Item>
        )}
      />
      <Drawer
        title={logTitle}
        open={open}
        onClose={() => setOpen(false)}
        size="large"
      >
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 12,
            margin: 0,
            opacity: logLoading ? 0.6 : 1,
          }}
        >
          {logText}
        </pre>
      </Drawer>
    </div>
  );
};
