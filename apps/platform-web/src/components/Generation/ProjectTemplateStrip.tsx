/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Studio Quality pin for official scaffolds. Community marketplace stays
 * behind VITE_SHOW_ECOSYSTEM; this strip is the generate-lane loop.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, List, Modal, Tag, Typography } from 'antd';
import { PushpinOutlined, SyncOutlined } from '@ant-design/icons';
import { api } from '../../services/api';
import { useT } from '../../services/i18n';

const { Text } = Typography;

type OfficialTemplate = {
  id: string;
  slug: string;
  name: string | null;
  description: string | null;
  version: string;
};

type AppliedPin = {
  templateId: string;
  slug: string;
  version: string;
  official: boolean;
  appliedAt: string;
};

export const ProjectTemplateStrip: React.FC<{
  readonly projectId: string;
  readonly refreshToken?: number;
}> = ({ projectId, refreshToken = 0 }) => {
  const { t } = useT();
  const [catalog, setCatalog] = useState<OfficialTemplate[]>([]);
  const [applied, setApplied] = useState<AppliedPin | null>(null);
  const [versions, setVersions] = useState<Array<{ id: string; version: string }>>([]);
  const [rescaffoldAt, setRescaffoldAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [rescaffolding, setRescaffolding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cat, pin] = await Promise.all([
        api.templates.catalog('official'),
        api.projects.templates(projectId),
      ]);
      setCatalog(cat.templates);
      setApplied(pin.applied);
      setVersions(pin.versions);
      setRescaffoldAt(pin.rescaffoldRequestedAt ?? null);
    } catch {
      setCatalog([]);
      setApplied(null);
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const pin = async (slug: string, version?: string): Promise<void> => {
    setBusySlug(`${slug}@${version ?? ''}`);
    setError(null);
    try {
      await api.templates.apply(slug, projectId, version);
      await load();
    } catch {
      setError(t('generate.templates.applyFailed'));
    } finally {
      setBusySlug(null);
    }
  };

  const requestRescaffold = (): void => {
    Modal.confirm({
      title: t('generate.templates.rescaffold'),
      content: t('generate.templates.rescaffoldConfirm'),
      okText: t('generate.templates.rescaffold'),
      onOk: async () => {
        setRescaffolding(true);
        setError(null);
        try {
          const res = await api.projects.rescaffold(projectId);
          setRescaffoldAt(res.rescaffoldRequestedAt);
        } catch {
          setError(t('generate.templates.rescaffoldFailed'));
        } finally {
          setRescaffolding(false);
        }
      },
    });
  };

  const cancelRescaffold = async (): Promise<void> => {
    setRescaffolding(true);
    setError(null);
    try {
      await api.projects.rescaffold(projectId, { cancel: true });
      setRescaffoldAt(null);
    } catch {
      setError(t('generate.templates.rescaffoldFailed'));
    } finally {
      setRescaffolding(false);
    }
  };

  const older = versions.filter((row) => row.version !== applied?.version);

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
          {t('generate.templates.title')}
        </Text>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {applied ? (
            <Tag color="blue">
              {t('generate.templates.applied', {
                slug: applied.slug,
                version: applied.version,
              })}
            </Tag>
          ) : null}
          {rescaffoldAt ? <Tag color="orange">{t('generate.templates.rescaffoldQueued')}</Tag> : null}
        </div>
      </div>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
        {t('generate.templates.hint')}{' '}
        {t('generate.templates.rescaffoldHint')}
      </Text>
      {error ? (
        <Text type="danger" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
          {error}
        </Text>
      ) : null}
      <List
        size="small"
        loading={loading}
        locale={{ emptyText: t('generate.templates.empty') }}
        dataSource={catalog}
        renderItem={(row) => {
          const pinned = applied?.slug === row.slug && applied.version === row.version;
          return (
            <List.Item
              style={{ padding: '4px 0' }}
              actions={[
                <Button
                  key="pin"
                  size="small"
                  type={pinned ? 'default' : 'primary'}
                  ghost={!pinned}
                  icon={<PushpinOutlined />}
                  disabled={pinned}
                  loading={busySlug === `${row.slug}@`}
                  onClick={() => void pin(row.slug, row.version)}
                >
                  {t('generate.templates.apply')}
                </Button>,
              ]}
            >
              <div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Text style={{ fontSize: 12 }}>
                    {row.name ?? row.slug} @{row.version}
                  </Text>
                  <Tag>{t('generate.templates.official')}</Tag>
                </div>
                {row.description ? (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {row.description}
                  </Text>
                ) : null}
              </div>
            </List.Item>
          );
        }}
      />
      {applied ? (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {rescaffoldAt ? (
            <Button size="small" loading={rescaffolding} onClick={() => void cancelRescaffold()}>
              {t('generate.templates.rescaffoldCancel')}
            </Button>
          ) : (
            <Button
              size="small"
              icon={<SyncOutlined />}
              loading={rescaffolding}
              onClick={requestRescaffold}
            >
              {t('generate.templates.rescaffold')}
            </Button>
          )}
        </div>
      ) : null}
      {older.length > 0 ? (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {older.map((row) => (
            <Button
              key={row.id}
              size="small"
              loading={busySlug === `${applied?.slug ?? ''}@${row.version}`}
              onClick={() => void pin(applied!.slug, row.version)}
            >
              {t('generate.templates.rollback', { version: row.version })}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
