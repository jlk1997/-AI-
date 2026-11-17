/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phone studio observatory. Same living stage as desktop — including 走向盘.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Result, Spin } from 'antd';

import { SocietyTownStage } from '../../components/World/SocietyTownStage.js';
import {
  latestWorldJobFailed,
  pickLatestWorldJob,
  requeuedToOf,
} from '../../hooks/useGenerationJobs.js';
import { api, ApiError } from '../../services/api.js';
import { useT } from '../../services/i18n.js';
import { followRetryJobId } from '../../utils/jobRetryFollow.js';

export const SocietyTownAuthorSheet: React.FC<{
  readonly projectId: string;
}> = ({ projectId }) => {
  const { t } = useT();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hasWorld, setHasWorld] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateFailed, setGenerateFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStage = useCallback(async (): Promise<void> => {
    const [worldRes, deps, jobsRes] = await Promise.all([
      api.world.get(projectId),
      api.deployments.list(projectId),
      api.jobs.list(projectId).catch(() => ({ jobs: [] })),
    ]);
    setHasWorld(Boolean(worldRes.world));
    setIsGenerating(
      jobsRes.jobs.some((job) => job.status === 'queued' || job.status === 'running'),
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
        setGenerateFailed(false);
        setIsGenerating(true);
        await loadStage();
        return;
      }
      if (latest.status !== 'failed') return;
      try {
        await api.jobs.retry(projectId, latest.id);
      } catch (err) {
        const childId = followRetryJobId(err);
        if (!childId) throw err;
      }
      setGenerateFailed(false);
      setIsGenerating(true);
      await loadStage();
    } catch {
      /* sheet stays on the failed map; desktop observatory has the toast */
    }
  }, [loadStage, projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadStage()
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          setError(err.status === 403 ? 'forbidden' : 'missing');
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadStage]);

  useEffect(() => {
    if (!isGenerating) return;
    const timer = window.setInterval(() => {
      void loadStage().catch(() => undefined);
    }, previewUrl ? 8_000 : 3_000);
    return () => window.clearInterval(timer);
  }, [isGenerating, loadStage, previewUrl]);

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin description={t('generate.preview.generating')} />
      </div>
    );
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
      />
    );
  }

  return (
    <div style={{ height: 'min(70vh, 640px)', minHeight: 360 }}>
      <SocietyTownStage
        role="author"
        projectId={projectId}
        previewUrl={previewUrl}
        hasWorld={hasWorld}
        isGenerating={isGenerating}
        generateFailed={generateFailed}
        compact
        autoloadMap
        onRefreshPreview={() => void loadStage()}
        onRetryFailedJob={() => void retryFailedWorldJob()}
      />
    </div>
  );
};
