/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Full-page author observatory — the world-mode "new window" target.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Result, Spin, Typography, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';

import { SocietyTownStage } from '../components/World/SocietyTownStage';
import {
  latestWorldJobFailed,
  pickLatestWorldJob,
  requeuedToOf,
} from '../hooks/useGenerationJobs';
import { api, ApiError, TOKEN_KEY } from '../services/api';
import { followRetryJobId } from '../utils/jobRetryFollow';
import { useT } from '../services/i18n';
import { rememberLoginReturnTo } from '../utils/loginIntent';

const { Text } = Typography;

export function ObservatoryPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { t } = useT();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hasWorld, setHasWorld] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateFailed, setGenerateFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStage = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    const [worldRes, deps, jobsRes] = await Promise.all([
      api.world.get(projectId),
      api.deployments.list(projectId),
      api.jobs.list(projectId).catch(() => ({ jobs: [] })),
    ]);
    setHasWorld(Boolean(worldRes.world));
    setIsGenerating(
      jobsRes.jobs.some(
        (job) => job.status === 'queued' || job.status === 'running',
      ),
    );
    setGenerateFailed(latestWorldJobFailed(jobsRes.jobs));
    const preview =
      deps.deployments.find((d) => d.channel === 'preview') ?? deps.deployments[0];
    if (!preview) {
      setPreviewUrl(null);
      return;
    }
    const signed = await api.deployments.getPreviewUrl(preview.id);
    setPreviewUrl(signed.url);
  }, [projectId]);

  const retryFailedWorldJob = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    try {
      const jobsRes = await api.jobs.list(projectId);
      const latest = pickLatestWorldJob(jobsRes.jobs);
      if (!latest) return;
      if (latest.status === 'succeeded') {
        setGenerateFailed(false);
        await loadStage();
        return;
      }
      if (latest.status === 'queued' || latest.status === 'running') {
        setIsGenerating(true);
        await loadStage();
        return;
      }
      const alreadyChild = requeuedToOf(latest);
      if (alreadyChild) {
        message.success(t('generate.jobs.alreadyRequeued'));
        setGenerateFailed(false);
        setIsGenerating(true);
        await loadStage();
        return;
      }
      if (latest.status !== 'failed') return;
      try {
        const queued = await api.jobs.retry(projectId, latest.id);
        message.success(
          queued.already
            ? t('generate.jobs.alreadyRequeued')
            : t('generate.jobs.retried'),
        );
      } catch (err) {
        const childId = followRetryJobId(err);
        if (!childId) throw err;
        message.success(t('generate.jobs.alreadyRequeued'));
      }
      setGenerateFailed(false);
      setIsGenerating(true);
      await loadStage();
    } catch {
      message.error(t('generate.jobs.retryFailed'));
    }
  }, [projectId, loadStage, t]);

  useEffect(() => {
    if (!projectId) return;
    if (!localStorage.getItem(TOKEN_KEY)) {
      rememberLoginReturnTo(`/observatory/${projectId}`);
      navigate('/login', { replace: true });
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadStage()
      .catch((err) => {
        if (!cancelled) {
          if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
            setError(err.status === 403 ? 'forbidden' : 'missing');
          } else {
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadStage, navigate, projectId]);

  useEffect(() => {
    if (!projectId || !isGenerating) return;
    const timer = window.setInterval(() => {
      void loadStage().catch(() => undefined);
    }, previewUrl ? 8_000 : 3_000);
    return () => window.clearInterval(timer);
  }, [isGenerating, loadStage, previewUrl, projectId]);

  if (!projectId) {
    return <Result status="404" title={t('product.obs.lockedTitle')} />;
  }

  if (error) {
    return (
      <Result
        status="403"
        title={
          error === 'forbidden'
            ? t('product.obs.forbiddenTitle')
            : t('product.obs.lockedTitle')
        }
        subTitle={
          error === 'forbidden'
            ? t('product.obs.forbiddenDesc')
            : error === 'missing'
              ? t('product.obs.lockedDesc')
              : error
        }
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            {t('nav.goCreate')}
          </Button>
        }
      />
    );
  }

  return (
    <div
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-layout)',
      }}
    >
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-card)',
        }}
      >
        <Button
          type="text"
          size="small"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/?project=${projectId}&mode=world`)}
        >
          {t('nav.goCreate')}
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('generate.preview.openObservatory')}
        </Text>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {loading ? (
          <div style={{ margin: 'auto' }}>
            <Spin description={t('generate.preview.generating')} />
          </div>
        ) : (
          <SocietyTownStage
            role="author"
            projectId={projectId}
            previewUrl={previewUrl}
            hasWorld={hasWorld}
            isGenerating={isGenerating}
            generateFailed={generateFailed}
            autoloadMap
            onRefreshPreview={() => void loadStage()}
            onRetryFailedJob={() => void retryFailedWorldJob()}
          />
        )}
      </div>
    </div>
  );
}
