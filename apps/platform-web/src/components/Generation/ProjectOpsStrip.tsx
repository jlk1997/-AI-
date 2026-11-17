/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Honest ops for the studio Quality tab: last workspace snapshot, standalone
 * build, cache hits, and one-click dead-letter requeue.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, List, Tag, Typography } from 'antd';
import { BuildOutlined, ReloadOutlined } from '@ant-design/icons';
import { ApiError, api } from '../../services/api';
import { useT } from '../../services/i18n';

const { Text } = Typography;

type BuildRow = {
  jobId: string;
  status: string;
  contentHash: string | null;
  cacheHit: boolean;
  createdAt: string;
};

type LetterRow = {
  id: string;
  jobId: string | null;
  jobType: string | null;
  attempts: number;
  error: string | null;
  createdAt: string;
};

export const ProjectOpsStrip: React.FC<{
  readonly projectId: string;
  readonly refreshToken?: number;
}> = ({ projectId, refreshToken = 0 }) => {
  const { t } = useT();
  const [archive, setArchive] = useState<{
    enabled: boolean;
    savedAt: string | null;
    fileCount: number;
  } | null>(null);
  const [builds, setBuilds] = useState<BuildRow[]>([]);
  const [letters, setLetters] = useState<LetterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [arch, cache, dead] = await Promise.all([
        api.projects.workspaceArchive(projectId),
        api.projects.buildCache(projectId),
        api.projects.deadLetters(projectId),
      ]);
      setArchive({
        enabled: arch.enabled,
        savedAt: arch.savedAt,
        fileCount: arch.fileCount,
      });
      setBuilds(cache.builds);
      setLetters(dead.letters);
    } catch {
      setArchive(null);
      setBuilds([]);
      setLetters([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const runBuild = async (): Promise<void> => {
    setBuilding(true);
    setError(null);
    try {
      await api.projects.runBuild(projectId);
      await load();
    } catch {
      setError(t('generate.ops.buildFailed'));
    } finally {
      setBuilding(false);
    }
  };

  const requeue = async (letterId: string): Promise<void> => {
    setBusyId(letterId);
    setError(null);
    try {
      await api.projects.requeueDeadLetter(projectId, letterId);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        await load();
        setError(t('generate.ops.requeueAlready'));
        return;
      }
      setError(t('generate.ops.requeueFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const archiveLine = !archive
    ? '—'
    : !archive.enabled
      ? t('generate.ops.archiveOff')
      : archive.savedAt
        ? t('generate.ops.archiveSaved', {
            time: new Date(archive.savedAt).toLocaleString(),
            files: archive.fileCount,
          })
        : t('generate.ops.archiveEmpty');

  return (
    <div style={{ marginTop: 16 }}>
      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
        {t('generate.ops.title')}
      </Text>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
        {t('generate.ops.hint')}
      </Text>
      <Text style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>{archiveLine}</Text>
      {error ? (
        <Text type="danger" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
          {error}
        </Text>
      ) : null}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <Text type="secondary" style={{ fontSize: 11 }}>
          {t('generate.ops.cache')}
        </Text>
        <Button
          size="small"
          icon={<BuildOutlined />}
          loading={building}
          onClick={() => void runBuild()}
        >
          {t('generate.ops.build')}
        </Button>
      </div>
      <List
        size="small"
        loading={loading}
        locale={{ emptyText: t('generate.ops.cacheEmpty') }}
        dataSource={builds.slice(0, 5)}
        renderItem={(row) => (
          <List.Item style={{ padding: '4px 0' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <Tag color={row.cacheHit ? 'success' : 'default'}>
                {row.cacheHit ? t('generate.ops.cacheHit') : t('generate.ops.cacheMiss')}
              </Tag>
              <Text style={{ fontSize: 12 }}>{row.status}</Text>
              {row.contentHash ? (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {row.contentHash.slice(0, 8)}
                </Text>
              ) : null}
              <Text type="secondary" style={{ fontSize: 11 }}>
                {new Date(row.createdAt).toLocaleString()}
              </Text>
            </div>
          </List.Item>
        )}
      />
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
        {t('generate.ops.dead')}
      </Text>
      {letters.length > 0 ? (
        <div className="og-author-alert">{t('generate.ops.deadAlert', { n: letters.length })}</div>
      ) : null}
      <List
        size="small"
        loading={loading}
        locale={{ emptyText: t('generate.ops.deadEmpty') }}
        dataSource={letters.slice(0, 6)}
        renderItem={(row) => (
          <List.Item
            style={{ padding: '4px 0' }}
            actions={[
              <Button
                key="rq"
                size="small"
                icon={<ReloadOutlined />}
                loading={busyId === row.id}
                disabled={!row.jobId}
                onClick={() => void requeue(row.id)}
              >
                {t('generate.ops.requeue')}
              </Button>,
            ]}
          >
            <div>
              <Text style={{ fontSize: 12 }}>{row.jobType ?? 'job'}</Text>
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                {t('generate.ops.attempts', { n: row.attempts })} ·{' '}
                {new Date(row.createdAt).toLocaleString()}
              </Text>
            </div>
          </List.Item>
        )}
      />
    </div>
  );
};
