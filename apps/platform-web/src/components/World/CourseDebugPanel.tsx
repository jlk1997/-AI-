/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dev/ops 调试面板（批次 8）。
 *
 * 仅当 import.meta.env.DEV 或 VITE_COURSE_DEBUG=true 时渲染。
 * 读取 window.ogCourseEvents 实时展示指标事件，无需新增埋点 SDK。
 */

import React, { useEffect, useState } from 'react';
import { Button, Drawer, Space, Table, Tag, Typography } from 'antd';

import { useT } from '../../services/i18n';

type CourseEvent = {
  name: string;
  props?: Record<string, string | number | boolean>;
  at: number;
};

type Aggregates = {
  voidByReason: Record<string, number>;
  actDistribution: Record<string, number>;
  refreshResult: Record<string, number>;
};

function readEvents(): CourseEvent[] {
  if (typeof window === 'undefined') return [];
  const w = window as Window & { ogCourseEvents?: CourseEvent[] };
  return w.ogCourseEvents ?? [];
}

function aggregate(events: CourseEvent[]): Aggregates {
  const out: Aggregates = {
    voidByReason: {},
    actDistribution: {},
    refreshResult: {},
  };
  for (const ev of events) {
    if (ev.name === 'course_void_kind') {
      const reason = String(ev.props?.['reason'] ?? 'unknown');
      out.voidByReason[reason] = (out.voidByReason[reason] ?? 0) + 1;
    } else if (ev.name === 'course_act_display') {
      const act = String(ev.props?.['act'] ?? 'unknown');
      out.actDistribution[act] = (out.actDistribution[act] ?? 0) + 1;
    } else if (ev.name === 'narrative_refresh_result') {
      const result = String(ev.props?.['result'] ?? 'unknown');
      out.refreshResult[result] = (out.refreshResult[result] ?? 0) + 1;
    }
  }
  return out;
}

export const CourseDebugPanel: React.FC<{ readonly projectId?: string | null }> = () => {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<CourseEvent[]>([]);

  // 仅 dev / 显式开启才渲染
  const enabled =
    import.meta.env.DEV || import.meta.env['VITE_COURSE_DEBUG'] === 'true';
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    setEvents(readEvents());
    const id = window.setInterval(() => setEvents(readEvents()), 2000);
    return () => window.clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  const aggregates = aggregate(events);
  const interesting = events
    .filter(
      (ev) =>
        ev.name === 'course_void_kind' ||
        ev.name === 'course_act_display' ||
        ev.name === 'narrative_refresh_result',
    )
    .slice(-50)
    .reverse();

  return (
    <>
      <Button
        size="small"
        onClick={() => setOpen(true)}
        style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 1000 }}
      >
        {t('world.debug.open')}
      </Button>
      <Drawer
        title={t('world.debug.title')}
        open={open}
        onClose={() => setOpen(false)}
        width={520}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text strong>{t('world.debug.voidByReason')}</Typography.Text>
          <Space wrap>
            {Object.entries(aggregates.voidByReason).length === 0 ? (
              <Typography.Text type="secondary">{t('world.debug.empty')}</Typography.Text>
            ) : (
              Object.entries(aggregates.voidByReason).map(([reason, n]) => (
                <Tag key={reason} color="red">
                  {reason}: {n}
                </Tag>
              ))
            )}
          </Space>

          <Typography.Text strong>{t('world.debug.actDistribution')}</Typography.Text>
          <Space wrap>
            {Object.entries(aggregates.actDistribution).length === 0 ? (
              <Typography.Text type="secondary">{t('world.debug.empty')}</Typography.Text>
            ) : (
              Object.entries(aggregates.actDistribution).map(([act, n]) => (
                <Tag key={act} color="cyan">
                  act {act}: {n}
                </Tag>
              ))
            )}
          </Space>

          <Typography.Text strong>{t('world.debug.refreshResult')}</Typography.Text>
          <Space wrap>
            {Object.entries(aggregates.refreshResult).length === 0 ? (
              <Typography.Text type="secondary">{t('world.debug.empty')}</Typography.Text>
            ) : (
              Object.entries(aggregates.refreshResult).map(([result, n]) => (
                <Tag key={result} color="gold">
                  {result}: {n}
                </Tag>
              ))
            )}
          </Space>

          <Typography.Text strong>{t('world.debug.recent')}</Typography.Text>
          <Table
            size="small"
            rowKey={(row) => `${row.at}-${row.name}`}
            pagination={false}
            dataSource={interesting}
            columns={[
              { title: 'name', dataIndex: 'name', width: 120 },
              {
                title: 'props',
                dataIndex: 'props',
                render: (props) =>
                  props ? (
                    <code style={{ fontSize: 11 }}>{JSON.stringify(props)}</code>
                  ) : null,
              },
              {
                title: 'at',
                dataIndex: 'at',
                width: 100,
                render: (at) =>
                  new Date(Number(at)).toISOString().slice(11, 19),
              },
            ]}
          />
        </Space>
      </Drawer>
    </>
  );
};