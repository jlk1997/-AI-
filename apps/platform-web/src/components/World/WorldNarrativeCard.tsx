/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 批次 3：展示世界叙事 (meta.summary + presentation.openingRumor) + 「再润色一次」按钮。
 * 仅调用新 API /world/:id/refresh-narrative；其他面板不受影响。
 */

import React, { useState } from 'react';
import { Button, Card, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

import { api } from '../../services/api';
import { useT } from '../../services/i18n';
import { trackCourseEvent } from './courseTelemetry';

export type WorldNarrativeCardProps = {
  readonly projectId: string | null;
  readonly summary: string | null | undefined;
  readonly openingRumor: string | null | undefined;
  /** Tip revision that this narrative came from; bumped after a successful refresh. */
  readonly tipRevision?: number | null;
  /** Optional callback fired after a successful refresh so the parent can refresh data. */
  readonly onRefreshed?: (next: {
    readonly tipRevision: number;
    readonly summary?: string;
    readonly openingRumor?: string;
  }) => void;
};

export type SpecLintIssue = {
  readonly severity: 'info' | 'warn' | 'error';
  readonly code: string;
  readonly path: string;
  readonly detail: string;
  readonly hit?: string;
};

export const WorldNarrativeCard: React.FC<WorldNarrativeCardProps> = ({
  projectId,
  summary,
  openingRumor,
  tipRevision,
  onRefreshed,
}) => {
  const { t, locale: localeTag } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastBumped, setLastBumped] = useState<number | null>(null);
  const [lintIssues, setLintIssues] = useState<readonly SpecLintIssue[]>([]);

  const onPolish = async (): Promise<void> => {
    if (!projectId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.world.refreshNarrative(projectId, {
        fields: ['meta.summary', 'presentation.openingRumor'],
        locale: localeTag === 'en' ? 'en' : 'zh',
      });
      trackCourseEvent('narrative_refresh_result', {
        result: res.changed ? 'changed' : 'noop',
        tipRevision: res.tipRevision,
      });
      setLintIssues(res.lint ?? []);
      if (res.changed) {
        setLastBumped(res.tipRevision);
        onRefreshed?.({
          tipRevision: res.tipRevision,
          summary: res.summary,
          openingRumor: res.openingRumor,
        });
      } else {
        setLastBumped(res.tipRevision);
      }
    } catch (err) {
      trackCourseEvent('narrative_refresh_result', {
        result: 'error',
        message: err instanceof Error ? err.message : 'unknown',
      });
      setError(err instanceof Error ? err.message : 'unknown');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={
        <Space>
          <span id="world-narrative-title">{t('world.narrative.title')}</span>
          {tipRevision != null ? (
            <Tag color="default" style={{ marginInlineStart: 4 }}>
              v{tipRevision}
            </Tag>
          ) : null}
        </Space>
      }
      size="small"
      style={{ marginBottom: 16 }}
      aria-labelledby="world-narrative-title"
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={busy}
          onClick={onPolish}
          disabled={!projectId}
          aria-label={t('world.refreshNarrative.ariaLabel')}
          aria-busy={busy}
        >
          {busy ? t('world.refreshNarrative.busy') : t('world.refreshNarrative.button')}
        </Button>
      }
    >
      <Space orientation="vertical" size={6} style={{ width: '100%' }}>
        <Typography.Paragraph
          style={{ margin: 0 }}
          aria-label={t('world.narrative.summaryAriaLabel')}
        >
          {summary || '—'}
        </Typography.Paragraph>
        {openingRumor ? (
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12 }}
            aria-label={t('world.narrative.openingRumorAriaLabel')}
          >
            {openingRumor}
          </Typography.Text>
        ) : null}
        {lintIssues.length > 0 ? (
          <div
            className="og-narrative-lint"
            role="note"
            aria-label={t('world.narrative.lintAriaLabel')}
          >
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              {t('world.narrative.lintTitle')}
            </Typography.Text>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12 }}>
              {lintIssues.slice(0, 3).map((i, idx) => (
                <li key={`${i.code}-${idx}`}>
                  <Typography.Text type={i.severity === 'error' ? 'danger' : 'warning'}>
                    [{i.path}] {i.detail}
                  </Typography.Text>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <span
          className="og-visually-hidden"
          role="status"
          aria-live={error ? 'assertive' : 'polite'}
        >
          {error
            ? `${t('world.refreshNarrative.fail')}：${error}`
            : lastBumped != null
              ? t('world.refreshNarrative.done', { n: String(lastBumped) })
              : ''}
        </span>
        {error ? (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            {t('world.refreshNarrative.fail')}：{error}
          </Typography.Text>
        ) : null}
        {lastBumped != null ? (
          <Typography.Text type="success" style={{ fontSize: 12 }}>
            {t('world.refreshNarrative.done', { n: String(lastBumped) })}
          </Typography.Text>
        ) : null}
      </Space>
    </Card>
  );
};