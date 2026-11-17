/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Drawer,
  Empty,
  Spin,
  Table,
  Typography,
  Tag,
  message,
} from 'antd';
import { HomeOutlined, BarChartOutlined } from '@ant-design/icons';

import { api } from '../services/api';
import { useT } from '../services/i18n';

const { Title, Text, Paragraph } = Typography;

interface BenchDetail {
  id: string;
  label: string | null;
  status: string;
  scores: Record<string, unknown> | null;
  jobId: string | null;
  project: { id: string; name: string } | null;
  createdAt: string;
}

interface BenchRow {
  id: string;
  projectId: string;
  publicLabel: string | null;
  scores: unknown;
  createdAt: string;
}

function summarizeScores(scores: unknown): string {
  if (!scores || typeof scores !== 'object') return '—';
  const entries = Object.entries(scores as Record<string, unknown>).filter(([, v]) =>
    typeof v === 'number',
  );
  if (entries.length === 0) return '—';
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}=${(v as number).toFixed(2)}`)
    .join('  ');
}

export default function BenchBoardPage(): React.ReactElement {
  const navigate = useNavigate();
  const { t } = useT();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BenchRow[]>([]);
  const [detail, setDetail] = useState<BenchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = async (id: string): Promise<void> => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await api.ecosystem.publicBenchRun(id);
      setDetail(res);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'failed to load bench detail');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    api.ecosystem
      .publicBench({ limit: 100 })
      .then((res) => {
        if (cancelled) return;
        setRows(res.runs as BenchRow[]);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const text = err instanceof Error ? err.message : 'failed to load bench';
        message.error(text);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          <BarChartOutlined /> {t('bench.public.title')}
        </Title>
        <Button icon={<HomeOutlined />} onClick={() => navigate('/')}>
          {t('common.home')}
        </Button>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin tip={t('common.loading')} />
        </div>
      ) : rows.length === 0 ? (
        <Empty description="No public bench runs yet." />
      ) : (
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={{ pageSize: 25 }}
          onRow={(record) => ({
            onClick: () => void openDetail(record.id),
            style: { cursor: 'pointer' },
          })}
          columns={[
            {
              title: '#',
              dataIndex: 'index',
              render: (_v, _r, i) => <Text>{i + 1}</Text>,
              width: 60,
            },
            {
              title: 'Label',
              dataIndex: 'publicLabel',
              render: (v: string | null, r) =>
                v ? <Tag color="blue">{v}</Tag> : <Text code>{r.id.slice(0, 8)}</Text>,
            },
            {
              title: 'Scores',
              dataIndex: 'scores',
              render: (v: unknown) => <Text>{summarizeScores(v)}</Text>,
            },
            {
              title: 'Submitted',
              dataIndex: 'createdAt',
              render: (v: string) => new Date(v).toLocaleString(),
              width: 180,
            },
          ]}
        />
      )}

      <Drawer
        title="Bench run detail"
        placement="right"
        width={520}
        open={detail !== null || detailLoading}
        onClose={() => setDetail(null)}
      >
        {detailLoading ? (
          <Spin tip={t('common.loading')} />
        ) : detail ? (
          <div>
            <Paragraph>
              <Text strong>Label:</Text>{' '}
              {detail.label ? <Tag color="blue">{detail.label}</Tag> : <Text type="secondary">—</Text>}
            </Paragraph>
            <Paragraph>
              <Text strong>Status:</Text> <Tag>{detail.status}</Tag>
            </Paragraph>
            <Paragraph>
              <Text strong>Project:</Text> {detail.project?.name ?? '—'}
            </Paragraph>
            <Paragraph>
              <Text strong>Submitted:</Text> {new Date(detail.createdAt).toLocaleString()}
            </Paragraph>
            <Paragraph>
              <Text strong>Job ID:</Text>{' '}
              {detail.jobId ? <Text code>{detail.jobId}</Text> : '—'}
            </Paragraph>
            <Paragraph>
              <Text strong>Scores:</Text>
            </Paragraph>
            <pre
              style={{
                background: '#0b0b0b',
                color: '#e5e5e5',
                padding: 12,
                borderRadius: 4,
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {JSON.stringify(detail.scores ?? {}, null, 2)}
            </pre>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
