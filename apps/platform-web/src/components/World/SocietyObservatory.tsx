/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @deprecated Prefer SocietyTownStage (map + side inspector). Kept for reference /
 * advanced timeline UI that has not been fully ported (scrubber, reflection tree).
 *
 * Society Observatory — observe / replay / intervene (not "play to win").
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Input,
  InputNumber,
  List,
  Progress,
  Row,
  Select,
  Slider,
  Space,
  Statistic,
  Tag,
  Tree,
  Typography,
  message,
} from 'antd';
import { useT } from '../../services/i18n';
import type { DataNode } from 'antd/es/tree';
import {
  ExperimentOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { api } from '../../services/api';

const { Text, Title, Paragraph } = Typography;

export interface SocietyObservatoryProps {
  readonly projectId: string;
}

type SocietyEvent = {
  id: string;
  simTime: number;
  kind: string;
  agentId?: string | null;
  payload: Record<string, unknown>;
};

type EmergenceReport = {
  summary: string;
  informationSpread: { rate: number; awareCount?: number; totalAgents?: number };
  relationshipFormation: { newRelations: number; avgAffinity?: number };
  coordination: {
    attendanceRate: number;
    peakGathering?: number;
    peakGatheringRate?: number;
    peakRegionId?: string;
  };
  scheduleDiversity?: { rate: number; distinctRoutes?: number };
  dialogueNovelty?: { rate: number; groupDialogues?: number };
};

export function SocietyObservatory({ projectId }: SocietyObservatoryProps) {
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<SocietyEvent[]>([]);
  const [agents, setAgents] = useState<
    Array<{
      id: string;
      name: string;
      regionId: string;
      x: number;
      y: number;
      currentAction: string;
    }>
  >([]);
  const [relations, setRelations] = useState<
    Array<{ from: string; to: string; summary: string; affinity: number }>
  >([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [memories, setMemories] = useState<
    Array<{
      id?: string;
      kind: string;
      text: string;
      simTime: number;
      importance: number;
      pointers: unknown;
    }>
  >([]);
  const [plans, setPlans] = useState<
    Array<{ dayIndex: number; segments: unknown }>
  >([]);
  const [whisper, setWhisper] = useState('');
  const [report, setReport] = useState<EmergenceReport | null>(null);
  const [hours, setHours] = useState(8);
  const isEmpty = !loading && events.length === 0;

  const maxTime = useMemo(
    () => (events.length ? Math.max(...events.map((e) => e.simTime)) : 24),
    [events],
  );

  const visibleEvents = useMemo(
    () => events.filter((e) => e.simTime <= cursor),
    [events, cursor],
  );

  const reflectionTree = useMemo((): DataNode[] => {
    const visited = new Set<string>();
    const childOf = (
      pointers: unknown,
      parentKey: string,
      depth: number,
    ): DataNode[] => {
      if (depth > 3 || !Array.isArray(pointers)) return [];
      const children: DataNode[] = [];
      for (const pid of pointers as unknown[]) {
        if (typeof pid !== 'string') continue;
        const key = `${parentKey}_${pid}_${depth}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const ev = memories.find((x) => x.id === pid);
        children.push({
          key,
          title: ev
            ? `[${ev.kind}] ${ev.text.slice(0, 80)}`
            : `evidence:${pid}`,
          children:
            ev?.kind === 'reflection'
              ? childOf(ev.pointers, key, depth + 1)
              : [],
        });
      }
      return children;
    };
    return memories
      .filter((m) => m.kind === 'reflection')
      .map((m, i) => {
        const mid = m.id ?? `ref_${i}`;
        return {
          key: mid,
          title: `💭 ${m.text.slice(0, 100)}`,
          children: childOf(m.pointers, mid, 1),
        };
      });
  }, [memories]);

  /** Derive agent poses at cursor from move/action events (timeline replay). */
  const replayAgents = useMemo(() => {
    const pose = new Map(
      agents.map((a) => [
        a.id,
        {
          ...a,
          x: a.x,
          y: a.y,
          currentAction: a.currentAction,
          regionId: a.regionId,
        },
      ]),
    );
    for (const e of events) {
      if (e.simTime > cursor) break;
      if (!e.agentId) continue;
      const cur = pose.get(e.agentId);
      if (!cur) continue;
      if (e.kind === 'move' || e.kind === 'action') {
        if (typeof e.payload['x'] === 'number') cur.x = Number(e.payload['x']);
        if (typeof e.payload['y'] === 'number') cur.y = Number(e.payload['y']);
        if (typeof e.payload['regionId'] === 'string') {
          cur.regionId = String(e.payload['regionId']);
        }
        if (typeof e.payload['activity'] === 'string') {
          cur.currentAction = String(e.payload['activity']);
        }
      }
      if (e.kind === 'dialogue') {
        cur.currentAction = `talking: ${String(e.payload['summary'] ?? '').slice(0, 40)}`;
      }
    }
    return [...pose.values()];
  }, [agents, events, cursor]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.world.societyEvents(projectId, 0, 1e9);
      setEvents(res.events.filter((e) => e.kind !== 'emergence_report'));
      setAgents(res.agents);
      setRelations(res.relations);
      if (res.events.length) {
        setCursor(res.events[0]!.simTime);
      }
      try {
        const rr = await api.world.societyReport(projectId);
        if (rr.report) setReport(rr.report as EmergenceReport);
      } catch {
        /* optional */
      }
    } catch (err) {
      message.warning(
        err instanceof Error ? err.message : '暂无社会事件 — 请先快进模拟',
      );
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!playing || !events.length) return;
    const id = window.setInterval(() => {
      setCursor((c) => {
        const next = c + 0.5;
        if (next >= maxTime) {
          setPlaying(false);
          return maxTime;
        }
        return next;
      });
    }, 400);
    return () => window.clearInterval(id);
  }, [playing, events.length, maxTime]);

  const runSociety = async (hoursOverride?: number) => {
    const runHours = hoursOverride ?? hours;
    setLoading(true);
    try {
      const res = await api.world.societyRun(projectId, {
        hours: runHours,
        sync: true,
      });
      if (res.report) setReport(res.report as EmergenceReport);
      if (res.gateFailed || res.spreadOk === false) {
        message.warning(
          res.error ??
            `涌现门禁未过：信息扩散未达标（已写入 ${res.events ?? 0} 事件，可继续干预重算）`,
        );
      } else {
        message.success(
          `社会快进完成 · ${res.events ?? 0} 事件 · t=${res.simTime?.toFixed?.(1) ?? res.simTime}`,
        );
      }
      await reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadAgent = async (agentKey: string) => {
    setSelectedAgent(agentKey);
    try {
      const res = await api.world.societyAgent(projectId, agentKey);
      setMemories(res.memories);
      setPlans(res.plans ?? []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  const intervene = async () => {
    if (!whisper.trim()) {
      message.warning(t('product.obs.whisperPlaceholder'));
      return;
    }
    setLoading(true);
    try {
      const res = await api.world.societyIntervene(projectId, {
        fromSimTime: cursor,
        kind: 'whisper',
        agentKey: selectedAgent ?? undefined,
        text: whisper.trim(),
      });
      message.success(
        res.rumor ? t('product.obs.rumorDone') : t('product.obs.intervene'),
      );
      setWhisper('');
      await reload();
      const focus = res.focusAgentId ?? selectedAgent;
      if (focus) await loadAgent(focus);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <ExperimentOutlined />
          {t('product.obs.title')}
          <Tag color="purple">{t('product.obs.notPlay')}</Tag>
        </Space>
      }
      extra={
        <Space>
          <InputNumber
            min={1}
            max={48}
            value={hours}
            onChange={(v) => setHours(Number(v ?? 8))}
            addonAfter={t('product.obs.hours')}
            size="small"
          />
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={loading}
            onClick={() => void runSociety()}
          >
            {t('product.obs.fastForward')}
          </Button>
          <Button onClick={() => void reload()} loading={loading}>
            {t('product.obs.refresh')}
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t('product.obs.alertTitle')}
        description={t('product.obs.alertDesc')}
      />

      {isEmpty ? (
        <Card size="small" style={{ marginBottom: 12, textAlign: 'center' }}>
          <Paragraph type="secondary" style={{ marginBottom: 12 }}>
            {t('product.obs.empty')}
          </Paragraph>
          <Button
            type="primary"
            size="large"
            icon={<ThunderboltOutlined />}
            loading={loading}
            onClick={() => {
              setHours(8);
              void runSociety(8);
            }}
          >
            {t('product.obs.emptyCta')}
          </Button>
        </Card>
      ) : null}

      <Card
        size="small"
        style={{ marginBottom: 12 }}
        title={t('product.obs.emergence')}
      >
        {report ? (
          <>
            <Row gutter={16}>
              <Col span={8}>
                <Statistic
                  title={t('product.obs.spread')}
                  value={Math.round(report.informationSpread.rate * 100)}
                  suffix="%"
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={t('product.obs.relations')}
                  value={report.relationshipFormation.newRelations}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={t('product.obs.attendance')}
                  value={Math.round(
                    (report.coordination.peakGatheringRate ??
                      report.coordination.attendanceRate) * 100,
                  )}
                  suffix="%"
                />
              </Col>
            </Row>
            {(report.scheduleDiversity || report.dialogueNovelty) && (
              <Row gutter={16}>
                {report.scheduleDiversity && (
                  <Col span={8}>
                    <Statistic
                      title={t('product.obs.routeVariety')}
                      value={Math.round(report.scheduleDiversity.rate * 100)}
                      suffix="%"
                    />
                  </Col>
                )}
                {report.dialogueNovelty && (
                  <Col span={8}>
                    <Statistic
                      title={t('product.obs.lineNovelty')}
                      value={Math.round(report.dialogueNovelty.rate * 100)}
                      suffix="%"
                    />
                  </Col>
                )}
                {report.dialogueNovelty?.groupDialogues !== undefined && (
                  <Col span={8}>
                    <Statistic
                      title={t('product.obs.groupTalks')}
                      value={report.dialogueNovelty.groupDialogues}
                    />
                  </Col>
                )}
              </Row>
            )}
            <Text type="secondary">{report.summary}</Text>
          </>
        ) : (
          <Text type="secondary">{t('product.obs.emergenceEmpty')}</Text>
        )}
      </Card>

      <Row gutter={12}>
        <Col xs={24} lg={14}>
          <Title level={5} style={{ marginTop: 0 }}>
            {t('product.obs.timeline')}
          </Title>
          <Space style={{ width: '100%', marginBottom: 8 }} wrap>
            <Button
              icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={() => setPlaying((p) => !p)}
              disabled={!events.length}
            >
              {playing ? t('product.obs.pause') : t('product.obs.replay')}
            </Button>
            <Text type="secondary">
              t={cursor.toFixed(1)} / {maxTime.toFixed(1)} · {visibleEvents.length}/
              {events.length}
            </Text>
          </Space>
          <Slider
            min={0}
            max={maxTime}
            step={0.5}
            value={cursor}
            onChange={(v) => setCursor(Number(v))}
            disabled={!events.length}
          />
          <div
            style={{
              height: 160,
              background: '#0f172a',
              borderRadius: 8,
              position: 'relative',
              overflow: 'hidden',
              marginBottom: 8,
            }}
          >
            {replayAgents.map((a) => (
              <div
                key={a.id}
                title={`${a.name}: ${a.currentAction} @ ${a.regionId}`}
                onClick={() => void loadAgent(a.id)}
                style={{
                  position: 'absolute',
                  left: `${8 + (a.x % 20) * 4}%`,
                  top: `${10 + (a.y % 14) * 5}%`,
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background:
                    selectedAgent === a.id ? '#a78bfa' : '#38bdf8',
                  color: '#0f172a',
                  fontSize: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  border: '2px solid #fff',
                  transition: 'left 0.3s, top 0.3s',
                }}
              >
                {a.name.slice(0, 1)}
              </div>
            ))}
            {!replayAgents.length ? (
              <Text
                style={{
                  color: '#94a3b8',
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {t('product.obs.noPoses')}
              </Text>
            ) : null}
          </div>
          <List
            size="small"
            header={t('product.obs.events')}
            bordered
            dataSource={visibleEvents.slice(-12).reverse()}
            locale={{ emptyText: t('product.obs.eventsEmpty') }}
            renderItem={(e) => (
              <List.Item>
                <Space wrap>
                  <Tag>{e.kind}</Tag>
                  <Text type="secondary">t={e.simTime}</Text>
                  <Text>
                    {e.agentId ?? ''}{' '}
                    {String(
                      e.payload['activity'] ??
                        e.payload['summary'] ??
                        e.payload['text'] ??
                        '',
                    ).slice(0, 80)}
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        </Col>
        <Col xs={24} lg={10}>
          <Title level={5} style={{ marginTop: 0 }}>
            {t('product.obs.agents')}
          </Title>
          <Select
            style={{ width: '100%', marginBottom: 8 }}
            placeholder={t('product.obs.selectAgent')}
            value={selectedAgent ?? undefined}
            options={agents.map((a) => ({ value: a.id, label: a.name }))}
            onChange={(v) => void loadAgent(v)}
          />
          <List
            size="small"
            bordered
            header={t('product.obs.memory')}
            style={{ maxHeight: 200, overflow: 'auto', marginBottom: 8 }}
            dataSource={memories}
            locale={{ emptyText: t('product.obs.memoryEmpty') }}
            renderItem={(m) => (
              <List.Item>
                <Space direction="vertical" size={0} style={{ width: '100%' }}>
                  <Space>
                    <Tag color={m.kind === 'reflection' ? 'gold' : 'blue'}>
                      {m.kind}
                    </Tag>
                    <Text type="secondary">
                      t={m.simTime} · imp={m.importance}
                    </Text>
                  </Space>
                  <Text>{m.text}</Text>
                </Space>
              </List.Item>
            )}
          />
          <Paragraph strong style={{ marginBottom: 4 }}>
            {t('product.obs.whisper')}
          </Paragraph>
          <Input.TextArea
            rows={2}
            value={whisper}
            onChange={(e) => setWhisper(e.target.value)}
            placeholder={t('product.obs.whisperPlaceholder')}
          />
          <Button
            block
            style={{ marginTop: 8 }}
            type="dashed"
            loading={loading}
            onClick={() => void intervene()}
          >
            {t('product.obs.intervene')}
          </Button>

          <Collapse
            size="small"
            style={{ marginTop: 12 }}
            items={[
              {
                key: 'advanced',
                label: t('product.obs.advanced'),
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    {plans.length ? (
                      <Alert
                        type="success"
                        message={`${t('product.obs.plan')} day=${plans[0]!.dayIndex}`}
                        description={
                          Array.isArray(plans[0]!.segments)
                            ? (plans[0]!.segments as Array<{ activity?: string }>)
                                .map((s) => s.activity)
                                .filter(Boolean)
                                .slice(0, 4)
                                .join(' → ')
                            : undefined
                        }
                      />
                    ) : null}
                    {reflectionTree.length ? (
                      <>
                        <Text strong>{t('product.obs.reflection')}</Text>
                        <Tree
                          treeData={reflectionTree}
                          defaultExpandAll
                          style={{ maxHeight: 160, overflow: 'auto' }}
                        />
                      </>
                    ) : null}
                    <Text strong>{t('product.obs.relationGraph')}</Text>
                    {relations.length ? (
                      <>
                        <svg
                          width="100%"
                          height="140"
                          viewBox="0 0 320 140"
                          style={{
                            background: '#0f172a',
                            borderRadius: 8,
                          }}
                        >
                          {relations.map((r, i) => {
                            const fromIdx = agents.findIndex((a) => a.id === r.from);
                            const toIdx = agents.findIndex((a) => a.id === r.to);
                            const fi = fromIdx >= 0 ? fromIdx : i;
                            const ti = toIdx >= 0 ? toIdx : i + 1;
                            const n = Math.max(agents.length, 2);
                            const fx = 40 + (fi % n) * (240 / Math.max(1, n - 1));
                            const fy = 40 + Math.floor(fi / n) * 50;
                            const tx = 40 + (ti % n) * (240 / Math.max(1, n - 1));
                            const ty = 40 + Math.floor(ti / n) * 50;
                            return (
                              <line
                                key={`${r.from}-${r.to}`}
                                x1={fx}
                                y1={fy}
                                x2={tx}
                                y2={ty}
                                stroke={`rgba(167,139,250,${0.3 + Math.max(0, r.affinity) * 0.7})`}
                                strokeWidth={1 + r.affinity * 3}
                              />
                            );
                          })}
                          {agents.map((a, i) => {
                            const n = Math.max(agents.length, 2);
                            const x = 40 + (i % n) * (240 / Math.max(1, n - 1));
                            const y = 40 + Math.floor(i / n) * 50;
                            return (
                              <g
                                key={a.id}
                                onClick={() => void loadAgent(a.id)}
                                style={{ cursor: 'pointer' }}
                              >
                                <circle
                                  cx={x}
                                  cy={y}
                                  r={14}
                                  fill={
                                    selectedAgent === a.id ? '#a78bfa' : '#38bdf8'
                                  }
                                />
                                <text
                                  x={x}
                                  y={y + 4}
                                  textAnchor="middle"
                                  fontSize="10"
                                  fill="#0f172a"
                                >
                                  {a.name.slice(0, 1)}
                                </text>
                              </g>
                            );
                          })}
                        </svg>
                        {relations.map((r) => (
                          <div key={`${r.from}-${r.to}`} style={{ marginBottom: 6 }}>
                            <Text>
                              {r.from} ↔ {r.to}
                            </Text>
                            <Progress
                              percent={Math.round(Math.max(0, r.affinity) * 100)}
                              size="small"
                            />
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {r.summary.slice(0, 100)}
                            </Text>
                          </div>
                        ))}
                      </>
                    ) : (
                      <Text type="secondary">{t('product.obs.relationEmpty')}</Text>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </Col>
      </Row>
    </Card>
  );
}
