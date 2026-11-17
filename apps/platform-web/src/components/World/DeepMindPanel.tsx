/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inner life, chronicle, and a forecast report for a deep town.
 */

import React, { useEffect, useState } from 'react';
import { Button, Input, Space, Switch, Typography } from 'antd';

import { api } from '../../services/api';

const { Text, Paragraph } = Typography;

export type EnsembleReport = {
  title?: string;
  decision?: string;
  violentProbability: number;
  violentLow: number;
  violentHigh: number;
  casualties: {
    dead: { p10: number; p50: number; p90: number };
    light: { p10: number; p50: number; p90: number };
    serious: { p10: number; p50: number; p90: number };
  };
  participants: { p50: number };
  ifViolent?: {
    n: number;
    deathShare?: number;
    light: { p50: number };
    serious: { p50: number };
    dead: { p10: number; p50: number; p90: number };
  } | null;
  chains: Array<{ text: string; count: number }>;
  alternatives: Array<{ id: string; title: string; violentProbability: number; deathsP50: number }>;
  sensitivity: Array<{ variable: string; deltaViolent: number }>;
  calibration: { status: string; note: string };
  assumptions: string[];
  hotRegions: Array<{ regionId: string; risk: number }>;
  levelTimeline: Array<{ t: number; rungP50: number }>;
  traces: Array<{ seed: number; chain: string[] }>;
  sampleSize: number;
  opinion?: { oppose: number; afraid: number; wouldShow: number; wouldForce: number };
};

export type DeepMindView = {
  cognition: string;
  violencePublic: boolean;
  containsViolence: boolean;
  shareBlocked: boolean;
  simHour: number;
  residents: Array<{
    id: string;
    away?: boolean;
    narrative: string;
    monologue: string;
    grievance: number;
    legitimacy: number;
    goals: Array<{ text: string; progress: number }>;
    relations: Record<string, { note?: string }>;
  }>;
  institutions: Array<{ id: string; name: string; kind: string; goal?: string }>;
  conflict: Array<{ regionId: string; rung: number; mobilized: number; deaths: number; injured: number }>;
  chronicle: Array<{ simHour: number; text: string; surprise?: boolean; casualty?: boolean }>;
  facts: string[];
  writings?: Array<{ simHour: number; authorName: string; kind: string; text: string }>;
  culture?: string[];
  polls?: Array<{ n: number; oppose: number; afraid: number; wouldShow: number; wouldForce: number }>;
  paper?: Array<{ simHour: number; title: string; lines: string[] }>;
  outside?: string[];
  mood?: { grievance: number; legitimacy: number; population: number; rung: number };
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function DeepMindPanel({ projectId }: { projectId?: string }) {
  const [view, setView] = useState<DeepMindView | null>(null);
  const [report, setReport] = useState<EnsembleReport | null>(null);
  const [trace, setTrace] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState('');
  const [who, setWho] = useState('');

  useEffect(() => {
    if (!projectId) return;
    let stop = false;
    const pull = () => {
      void api.world
        .societyDeep(projectId)
        .then((next) => {
          if (!stop) setView(next);
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 8000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [projectId]);

  const setMode = async (deep: boolean) => {
    if (!projectId) return;
    setBusy(true);
    try {
      await api.world.societyCognition(projectId, deep ? 'deep' : 'classic', view?.violencePublic);
      const next = await api.world.societyDeep(projectId);
      setView(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换失败');
    } finally {
      setBusy(false);
    }
  };

  const setPublic = async (violencePublic: boolean) => {
    if (!projectId) return;
    setBusy(true);
    try {
      await api.world.societyCognition(
        projectId,
        view?.cognition === 'deep' ? 'deep' : 'classic',
        violencePublic,
      );
      const next = await api.world.societyDeep(projectId);
      setView(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const forecast = async (
    preset: 'contested' | 'exercise',
    extra?: {
      title?: string;
      decision?: string;
      grievance?: number;
      legitimacy?: number;
      population?: number;
      windowHours?: number;
    },
  ) => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    setTrace(null);
    try {
      const queued = await api.world.societyEnsemble(projectId, { preset, ...extra });
      setReport(queued.report);
      const started = Date.now();
      const tick = async () => {
        const row = await api.world.societyForecastRun(projectId, queued.runId);
        if (row.report && row.status === 'done') {
          setReport(row.report as EnsembleReport);
          return;
        }
        if (Date.now() - started < 90_000 && row.status !== 'failed') {
          window.setTimeout(() => void tick(), 4000);
        }
      };
      window.setTimeout(() => void tick(), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '推演失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Space orientation="vertical" size={10} style={{ width: '100%' }}>
      <Space>
        <Text>深度推演</Text>
        <Switch
          checked={view?.cognition === 'deep'}
          disabled={!projectId || busy}
          onChange={(checked) => void setMode(checked)}
        />
        <Text type="secondary">模拟第 {(view?.simHour ?? 0).toFixed(1)} 小时</Text>
      </Space>
      <Space>
        <Text>含暴力内容可公开</Text>
        <Switch
          checked={Boolean(view?.violencePublic)}
          disabled={!projectId || busy}
          onChange={(checked) => void setPublic(checked)}
        />
        {view?.shareBlocked ? <Text type="warning">默认仅项目成员可见</Text> : null}
      </Space>
      {error ? <Text type="danger">{error}</Text> : null}
      {(view?.residents ?? []).slice(0, 8).map((person) => (
        <div key={person.id}>
          <Text strong>
            {person.id}
            {person.away ? '（已离开）' : ''}
          </Text>
          <Paragraph style={{ marginBottom: 4 }}>{person.monologue || person.narrative}</Paragraph>
          <Text type="secondary">
            目标 {(person.goals ?? []).map((goal) => goal.text).join('、') || '未写'}
            {' · '}怨气 {person.grievance.toFixed(2)} · 认可 {person.legitimacy.toFixed(2)}
          </Text>
          <div>
            {Object.entries(person.relations ?? {})
              .slice(0, 3)
              .map(([id, rel]) => (
                <Text key={id} type="secondary">
                  对 {id}：{rel.note || '还没定论'}{' '}
                </Text>
              ))}
          </div>
        </div>
      ))}
      <Text strong>民调</Text>
      {(view?.polls ?? []).slice(-1).map((poll, index) => (
        <Paragraph key={`poll-${index}`} style={{ marginBottom: 4 }}>
          问了 {poll.n} 个在场的人：反对 {pct(poll.oppose)}，害怕 {pct(poll.afraid)}，会出门{' '}
          {pct(poll.wouldShow)}，会动手 {pct(poll.wouldForce)}
        </Paragraph>
      ))}
      <Text strong>镇报</Text>
      {(view?.paper ?? []).slice(-1).map((issue) => (
        <div key={`${issue.simHour}-${issue.title}`}>
          <Text strong>{issue.title}</Text>
          {issue.lines.map((line) => (
            <Paragraph key={line} style={{ marginBottom: 4 }}>
              {line}
            </Paragraph>
          ))}
        </div>
      ))}
      {(view?.outside ?? []).slice(-2).map((line) => (
        <Text key={line} type="secondary">
          邻镇：{line}{' '}
        </Text>
      ))}
      <Text strong>他们写下的</Text>
      {(view?.writings ?? []).slice(-6).map((row, index) => (
        <Paragraph key={`${row.authorName}-${index}`} style={{ marginBottom: 4 }}>
          {row.authorName}：{row.text}
        </Paragraph>
      ))}
      {(view?.culture ?? []).slice(-3).map((row) => (
        <Text key={row} type="secondary">
          {row}{' '}
        </Text>
      ))}
      <Space.Compact style={{ width: '100%' }}>
        <Input
          placeholder="以谁的身份（居民或机构名，可空）"
          value={who}
          onChange={(event) => setWho(event.target.value)}
          style={{ width: '40%' }}
        />
        <Input
          placeholder="你亲自说的一句话或一道命令"
          value={line}
          onChange={(event) => setLine(event.target.value)}
        />
        <Button
          disabled={!projectId || busy || !line.trim()}
          onClick={() => {
            if (!projectId) return;
            setBusy(true);
            void api.world
              .societyStepIn(projectId, { who: who.trim() || undefined, text: line.trim() })
              .then(() => api.world.societyDeep(projectId))
              .then((next) => {
                setView(next);
                setLine('');
              })
              .catch((err) => setError(err instanceof Error ? err.message : '没有写进去'))
              .finally(() => setBusy(false));
          }}
        >
          下场
        </Button>
      </Space.Compact>
      <Text strong>大事记</Text>
      {(view?.chronicle ?? []).slice(-8).map((row, index) => (
        <Paragraph key={`${row.simHour}-${index}`} style={{ marginBottom: 4 }}>
          <Text type={row.surprise || row.casualty ? 'warning' : 'secondary'}>
            {row.simHour.toFixed(0)}时 {row.text}
          </Text>
        </Paragraph>
      ))}
      <Text type="secondary">
        冲突{' '}
        {(view?.conflict ?? [])
          .map((cell) => `${cell.regionId} 级别${cell.rung} 动员${cell.mobilized} 死亡${cell.deaths}`)
          .join('；') || '还没有'}
      </Text>
      <Space wrap>
        <Button size="small" disabled={!projectId || busy} onClick={() => void forecast('contested')}>
          推演一项争议决策
        </Button>
        <Button size="small" disabled={!projectId || busy} onClick={() => void forecast('exercise')}>
          推演临近居民区的演训
        </Button>
        <Button
          size="small"
          disabled={!projectId || busy || !view?.mood}
          onClick={() =>
            void forecast('contested', {
              title: '按镇上现在的局面',
              decision: '照现在的怨气和认可，这件事再往下走三天',
              grievance: view?.mood?.grievance,
              legitimacy: view?.mood?.legitimacy,
              population: view?.mood?.population,
              windowHours: 72,
            })
          }
        >
          按镇上现在推演
        </Button>
      </Space>
      {report ? (
        <div>
          <Paragraph>
            {report.title}：暴力反抗 {pct(report.violentProbability)}（{pct(report.violentLow)}–
            {pct(report.violentHigh)}），死亡 {report.casualties.dead.p10}/{report.casualties.dead.p50}/
            {report.casualties.dead.p90}，轻伤中位数 {report.casualties.light.p50}，重伤中位数{' '}
            {report.casualties.serious.p50}，参与中位数 {report.participants.p50}
            {report.ifViolent
              ? `。若闹起来（${report.ifViolent.n}次）：轻伤中位数 ${report.ifViolent.light.p50}，重伤中位数 ${report.ifViolent.serious.p50}，死亡 ${report.ifViolent.dead.p10}/${report.ifViolent.dead.p50}/${report.ifViolent.dead.p90}，其中出现死亡的占 ${pct(report.ifViolent.deathShare ?? 0)}`
              : ''}
            {report.opinion
              ? `。推演结束时，反对 ${pct(report.opinion.oppose)}，害怕 ${pct(report.opinion.afraid)}，会出门 ${pct(report.opinion.wouldShow)}，会动手 ${pct(report.opinion.wouldForce)}`
              : ''}
          </Paragraph>
          <Text type="secondary">
            {report.calibration.status === 'calibrated' ? '已对照案例' : '外推'} · {report.calibration.note}
          </Text>
          <div>
            热区{' '}
            {(report.hotRegions ?? []).map((region) => `${region.regionId} ${pct(region.risk)}`).join('，')}
          </div>
          {(report.levelTimeline ?? []).slice(0, 6).map((row) => (
            <Text key={row.t} type="secondary">
              {row.t}时级别{row.rungP50}{' '}
            </Text>
          ))}
          {(report.chains ?? []).map((chain) => (
            <Paragraph key={chain.text} style={{ marginBottom: 4 }}>
              {chain.text}（{chain.count}）
            </Paragraph>
          ))}
          {(report.alternatives ?? []).map((alt) => (
            <div key={alt.id}>
              {alt.title}：暴力 {pct(alt.violentProbability)}，死亡中位数 {alt.deathsP50}
            </div>
          ))}
          {(report.sensitivity ?? []).map((row) => (
            <div key={row.variable}>
              {row.variable}：暴力概率变化 {row.deltaViolent.toFixed(2)}
            </div>
          ))}
          {(report.assumptions ?? []).map((line) => (
            <Paragraph key={line} type="secondary" style={{ marginBottom: 2 }}>
              {line}
            </Paragraph>
          ))}
          <Space wrap>
            {(report.traces ?? []).map((item, index) => (
              <Button key={item.seed} size="small" onClick={() => setTrace(index)}>
                第 {index + 1} 次深推演
              </Button>
            ))}
          </Space>
          {trace != null && report.traces?.[trace] ? (
            <Paragraph>{report.traces[trace].chain.join(' / ')}</Paragraph>
          ) : null}
        </div>
      ) : null}
    </Space>
  );
}
