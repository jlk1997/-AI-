/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The smallest operations desk that still counts as one: the open reports, and
 * two buttons per report. Hosting other people's work means someone has to be
 * able to answer "this is stolen" with a decision — and a takedown here hides
 * the work without deleting the author's project, so an appeal can undo it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Empty,
  List,
  Result,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { HomeOutlined } from '@ant-design/icons';

import { api, type OpenReport } from '../services/api';
import { useT } from '../services/i18n';
import { useAppStore } from '../store';

const { Title, Text, Paragraph } = Typography;

const REASON_COLORS: Record<string, string> = {
  stolen: 'red',
  nsfw: 'magenta',
  illegal: 'volcano',
  broken: 'orange',
  spam: 'gold',
  other: 'default',
};

export default function AdminReportsPage(): React.ReactElement {
  const navigate = useNavigate();
  const { t } = useT();
  const { isAuthenticated } = useAppStore();
  const [curator, setCurator] = useState<boolean | null>(null);
  const [reports, setReports] = useState<OpenReport[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setCurator(false);
      setLoading(false);
      return;
    }
    api.me
      .capabilities()
      .then((res) => setCurator(res.curator))
      .catch(() => setCurator(false));
  }, [isAuthenticated]);

  const load = useCallback(() => {
    if (!curator) return;
    setLoading(true);
    api.admin
      .reports(status)
      .then((res) => {
        setReports(res.reports);
        setOpenCount(res.openCount);
      })
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, [curator, status]);

  useEffect(() => {
    if (curator === null) return;
    if (!curator) {
      setLoading(false);
      return;
    }
    load();
  }, [curator, load]);

  const decide = async (
    report: OpenReport,
    action: 'uphold' | 'reject',
  ): Promise<void> => {
    setActing(report.id);
    try {
      const res = await api.admin.resolveReport(report.id, action);
      message.success(t('admin.reports.resolved', { count: res.resolved }));
      load();
    } catch {
      message.error(t('admin.reports.failed'));
    } finally {
      setActing(null);
    }
  };

  const restore = async (gameId: string): Promise<void> => {
    setActing(gameId);
    try {
      await api.admin.restoreGame(gameId);
      load();
    } catch {
      message.error(t('admin.reports.failed'));
    } finally {
      setActing(null);
    }
  };

  if (curator === null || (loading && reports.length === 0 && curator)) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin tip={t('common.loading')} />
      </div>
    );
  }

  if (!curator) {
    return (
      <Result
        status="403"
        title="403"
        subTitle={t('error.forbidden')}
        extra={
          <Button type="primary" onClick={() => navigate('/community')}>
            {t('nav.goPlay')}
          </Button>
        }
      />
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto', overflow: 'auto' }}>
      <Space
        align="center"
        style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}
      >
        <Title level={3} style={{ margin: 0 }}>
          {t('admin.reports.title')}
        </Title>
        <Space>
          <Segmented
            value={status}
            onChange={(v) => setStatus(v as 'open' | 'all')}
            options={[
              { label: t('admin.reports.open', { count: openCount }), value: 'open' },
              { label: t('admin.reports.all'), value: 'all' },
            ]}
          />
          <Button icon={<HomeOutlined />} onClick={() => navigate('/community')}>
            {t('common.home')}
          </Button>
        </Space>
      </Space>

      {reports.length === 0 ? (
        <Card>
          <Empty
            description={t('admin.reports.empty')}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </Card>
      ) : (
        <List
          dataSource={reports}
          renderItem={(report) => {
            const takenDown = Boolean(report.game?.takenDownAt);
            return (
              <Card key={report.id} size="small" style={{ marginBottom: 12 }}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space size={8} wrap>
                    <Tag color={REASON_COLORS[report.reason] ?? 'default'}>
                      {t(`report.reason.${report.reason}`)}
                    </Tag>
                    {report.status !== 'open' ? <Tag>{report.status}</Tag> : null}
                    {takenDown ? (
                      <Tag color="red">{t('admin.reports.takenDown')}</Tag>
                    ) : null}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(report.createdAt).toLocaleString()}
                    </Text>
                  </Space>

                  {report.game ? (
                    <a
                      onClick={() => navigate(`/community/game/${report.game?.slug ?? ''}`)}
                    >
                      {report.game.title}
                    </a>
                  ) : null}
                  {report.comment ? (
                    <Paragraph
                      type="secondary"
                      style={{ marginBottom: 0 }}
                      ellipsis={{ rows: 3 }}
                    >
                      “{report.comment.content}”
                    </Paragraph>
                  ) : null}
                  {report.detail ? <Text>{report.detail}</Text> : null}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('admin.reports.reporter', {
                      name: report.reporter?.displayName ?? '—',
                    })}
                  </Text>

                  <Space>
                    {report.status === 'open' ? (
                      <>
                        <Button
                          danger
                          size="small"
                          loading={acting === report.id}
                          onClick={() => void decide(report, 'uphold')}
                        >
                          {t('admin.reports.uphold')}
                        </Button>
                        <Button
                          size="small"
                          loading={acting === report.id}
                          onClick={() => void decide(report, 'reject')}
                        >
                          {t('admin.reports.reject')}
                        </Button>
                      </>
                    ) : null}
                    {takenDown && report.game ? (
                      <Button
                        size="small"
                        loading={acting === report.game.id}
                        onClick={() => void restore(report.game?.id ?? '')}
                      >
                        {t('admin.reports.restore')}
                      </Button>
                    ) : null}
                  </Space>
                </Space>
              </Card>
            );
          }}
        />
      )}
    </div>
  );
}
