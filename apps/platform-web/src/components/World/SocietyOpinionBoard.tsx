/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Opinion board: policy timeline, support curves, leaders, and a forecast band.
 */

import React, { useEffect, useState } from 'react';
import { Button, Input, Select, Space, Typography } from 'antd';

import { api } from '../../services/api';
import { useT } from '../../services/i18n';

const { Text } = Typography;

export type OpinionTick = {
  t: number;
  support: number;
  oppose: number;
  neutral: number;
  crowdSupport: number;
  crowdOppose: number;
};

export type OpinionBoardView = {
  policies?: Array<{
    id: string;
    title: string;
    body: string;
    channel: string;
    at: number;
    pending?: boolean;
  }>;
  history?: OpinionTick[];
  leaders?: Array<{ agentId: string; stance: number; reason: string }>;
  reasons?: Array<{ text: string; count: number }>;
  regions?: Array<{ regionId: string; support: number; oppose: number }>;
  quotes?: string[];
  crowdSize?: number;
  forecastBands?: ForecastBand[];
  collective?: { action: string; regionId: string; count: number };
  arcs?: Array<{ phase: string; beat: string }>;
};

export type ForecastBand = {
  t: number;
  supportLo: number;
  supportHi: number;
  opposeLo: number;
  opposeHi: number;
};

const TEMPLATES: Array<{ id: string; title: string; body: string; tags: string[] }> = [
  {
    id: 'fee',
    title: '夜市下周起征收摊位费',
    body: '每个摊位每周收费。低收入摊主暂无减免。',
    tags: ['摊'],
  },
  {
    id: 'ban',
    title: '夜市临时禁令',
    body: '本周夜市提前收摊，广场不得摆卖。',
    tags: [],
  },
  {
    id: 'subsidy',
    title: '摊位补贴',
    body: '本月摊位费减半，先到先登记。',
    tags: ['摊'],
  },
  {
    id: 'shock',
    title: '突发停水',
    body: '主干管维修，集市停水一天。',
    tags: [],
  },
  {
    id: 'clarify',
    title: '官方澄清：低收入摊主减免',
    body: '摊位费仍要收，但低收入摊主减免。',
    tags: ['摊'],
  },
];

function Curve({
  history,
  band,
}: {
  history: OpinionTick[];
  band: ForecastBand[];
}) {
  const w = 280;
  const h = 72;
  const pts = history.slice(-24);
  const line = (pick: (row: OpinionTick) => number, color: string) => {
    if (pts.length < 2) return null;
    const d = pts
      .map((row, i) => {
        const x = (i / Math.max(1, pts.length - 1)) * w;
        const y = h - Math.max(0, Math.min(1, pick(row))) * h;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return <path d={d} fill="none" stroke={color} strokeWidth="1.6" />;
  };
  const bandPath = () => {
    if (band.length < 2) return null;
    const top = band.map((b, i) => {
      const x = (i / (band.length - 1)) * w;
      const y = h - b.supportHi * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const bot = [...band].reverse().map((b) => {
      const i = band.indexOf(b);
      const x = (i / (band.length - 1)) * w;
      const y = h - b.supportLo * h;
      return `L${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return (
      <path
        d={`${top.join(' ')} ${bot.join(' ')} Z`}
        fill="#16a34a"
        opacity="0.18"
      />
    );
  };
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img">
      {bandPath()}
      {line((r) => r.support, '#15803d')}
      {line((r) => r.oppose, '#b91c1c')}
      {line((r) => r.crowdSupport, '#4ade80')}
      {line((r) => r.crowdOppose, '#f87171')}
    </svg>
  );
}

export function SocietyOpinionBoard({
  projectId,
  live,
}: {
  projectId?: string;
  live?: OpinionBoardView | null;
}) {
  const { t } = useT();
  const [board, setBoard] = useState<OpinionBoardView | null>(live ?? null);
  const [band, setBand] = useState<ForecastBand[]>([]);
  const [altBand, setAltBand] = useState<ForecastBand[]>([]);
  const [supportDraft, setSupportDraft] = useState('0.35');
  const [opposeDraft, setOpposeDraft] = useState('0.4');
  const [title, setTitle] = useState(TEMPLATES[0]!.title);
  const [body, setBody] = useState(TEMPLATES[0]!.body);
  const [tags, setTags] = useState(TEMPLATES[0]!.tags.join(','));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    setBoard(live);
    if (live.forecastBands?.length) setBand(live.forecastBands);
  }, [live]);

  useEffect(() => {
    if (!projectId) return;
    let stop = false;
    const pull = () => {
      void api.world
        .societyOpinion(projectId)
        .then((next) => {
          if (stop) return;
          setBoard(next);
          if (next.forecastBands?.length) setBand(next.forecastBands);
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

  const publish = async () => {
    if (!projectId || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.world.societyIntervene(projectId, {
        fromSimTime: 0,
        kind: 'policy',
        title: title.trim(),
        text: body.trim() || title.trim(),
        tags: tags
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        channel: 'notice',
      });
      if (res.opinion) setBoard(res.opinion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'publish failed');
    } finally {
      setBusy(false);
    }
  };

  const forecast = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await api.world.societyForecast(projectId, 8);
      setBand(res.bands ?? []);
      setAltBand([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'forecast failed');
    } finally {
      setBusy(false);
    }
  };

  const compare = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await api.world.societyForecast(projectId, 8, [
        { id: 'tighten', delta: -1 },
        { id: 'ease', delta: 1 },
      ]);
      setBand(res.bands ?? []);
      setAltBand(res.scenarios?.[1]?.bands ?? res.scenarios?.[0]?.bands ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'forecast failed');
    } finally {
      setBusy(false);
    }
  };

  const exportReport = async () => {
    if (!projectId) return;
    const report = await api.world.societyOpinionReport(projectId);
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'opinion-report.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const calibrate = async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.world.societyCalibrate(projectId, {
        support: Number(supportDraft),
        oppose: Number(opposeDraft),
        trust: 0.25,
      });
      setBoard(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'calibrate failed');
    } finally {
      setBusy(false);
    }
  };

  const enactVote = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await api.world.societyScenario(projectId, {
        kind: 'election',
        enact: true,
        topic: title.trim() || '动议',
      });
      if (res.opinion) setBoard(res.opinion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'election failed');
    } finally {
      setBusy(false);
    }
  };

  const shockPrice = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await api.world.societyScenario(projectId, {
        kind: 'price',
        enact: true,
        base: 10,
        stance: -1,
      });
      if (res.opinion) setBoard(res.opinion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'price failed');
    } finally {
      setBusy(false);
    }
  };

  const raiseAlarm = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await api.world.societyScenario(projectId, {
        kind: 'disaster',
        regionId: 'market',
      });
      if (res.opinion) setBoard(res.opinion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'scenario failed');
    } finally {
      setBusy(false);
    }
  };

  const history = board?.history ?? [];
  return (
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
      {projectId ? (
        <Space orientation="vertical" size={4} style={{ width: '100%' }}>
          <Select
            size="small"
            style={{ width: '100%' }}
            value={TEMPLATES.find((tpl) => tpl.title === title)?.id}
            placeholder={t('product.obs.opinion')}
            options={TEMPLATES.map((tpl) => ({ value: tpl.id, label: tpl.title }))}
            onChange={(id) => {
              const tpl = TEMPLATES.find((row) => row.id === id);
              if (!tpl) return;
              setTitle(tpl.title);
              setBody(tpl.body);
              setTags(tpl.tags.join(','));
            }}
          />
          <Input
            size="small"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input.TextArea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Space>
            <Button size="small" type="primary" loading={busy} onClick={() => void publish()}>
              {t('product.obs.publishPolicy')}
            </Button>
            <Button size="small" loading={busy} onClick={() => void forecast()}>
              {t('product.obs.forecast')}
            </Button>
            <Button size="small" loading={busy} onClick={() => void compare()}>
              {t('product.obs.compare')}
            </Button>
            <Button size="small" onClick={() => void exportReport()}>
              {t('product.obs.exportReport')}
            </Button>
            <Button size="small" loading={busy} onClick={() => void raiseAlarm()}>
              {t('product.obs.disaster')}
            </Button>
            <Button size="small" loading={busy} onClick={() => void enactVote()}>
              {t('product.obs.election')}
            </Button>
            <Button size="small" loading={busy} onClick={() => void shockPrice()}>
              {t('product.obs.price')}
            </Button>
          </Space>
        </Space>
      ) : null}
      {projectId ? (
        <Space size={4}>
          <Input
            size="small"
            style={{ width: 64 }}
            value={supportDraft}
            onChange={(e) => setSupportDraft(e.target.value)}
          />
          <Input
            size="small"
            style={{ width: 64 }}
            value={opposeDraft}
            onChange={(e) => setOpposeDraft(e.target.value)}
          />
          <Button size="small" loading={busy} onClick={() => void calibrate()}>
            {t('product.obs.calibrate')}
          </Button>
        </Space>
      ) : null}
      {error ? <Text type="danger">{error}</Text> : null}
      {board?.policies?.length ? (
        <Space orientation="vertical" size={2}>
          {board.policies.slice(-4).map((p) => (
            <Text key={p.id} style={{ fontSize: 12 }}>
              {p.title}
              {p.pending ? ' · …' : ''}
            </Text>
          ))}
        </Space>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('product.obs.opinionEmpty')}
        </Text>
      )}
      {board?.collective ? (
        <Text style={{ fontSize: 12 }}>
          {board.collective.regionId} · {board.collective.action} · {board.collective.count}
        </Text>
      ) : null}
      {history.length > 1 || band.length > 1 ? (
        <Curve history={history} band={band} />
      ) : null}
      {altBand.length ? (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {t('product.obs.compare')} {(altBand.at(-1)!.supportLo * 100).toFixed(0)}–
          {(altBand.at(-1)!.supportHi * 100).toFixed(0)}%
        </Text>
      ) : null}
      <Text type="secondary" style={{ fontSize: 11 }}>
        {t('product.obs.support')} / {t('product.obs.oppose')}
        {board?.crowdSize ? ` · ${board.crowdSize}` : ''}
      </Text>
      {board?.leaders?.length ? (
        <div>
          <Text style={{ fontSize: 12 }}>{t('product.obs.leaders')}</Text>
          {board.leaders.slice(0, 5).map((row) => (
            <div key={row.agentId} style={{ fontSize: 12 }}>
              {row.agentId.slice(0, 8)} {row.stance > 0 ? '+' : ''}
              {row.stance.toFixed(0)} {row.reason}
            </div>
          ))}
        </div>
      ) : null}
      {board?.reasons?.length ? (
        <div>
          <Text style={{ fontSize: 12 }}>{t('product.obs.reasons')}</Text>
          {board.reasons.map((row) => (
            <div key={row.text} style={{ fontSize: 12 }}>
              {row.text} · {row.count}
            </div>
          ))}
        </div>
      ) : null}
      {board?.regions?.length ? (
        <div>
          <Text style={{ fontSize: 12 }}>{t('product.obs.regions')}</Text>
          {board.regions.map((row) => (
            <div key={row.regionId} style={{ fontSize: 12 }}>
              {row.regionId} {t('product.obs.support')} {(row.support * 100).toFixed(0)}%{' '}
              {t('product.obs.oppose')} {(row.oppose * 100).toFixed(0)}%
            </div>
          ))}
        </div>
      ) : null}
      {board?.quotes?.length ? (
        <div>
          <Text style={{ fontSize: 12 }}>{t('product.obs.quotes')}</Text>
          {board.quotes.slice(0, 4).map((q) => (
            <div key={q} style={{ fontSize: 12 }}>
              「{q}」
            </div>
          ))}
        </div>
      ) : null}
      {board?.arcs?.slice(-2).map((arc) => (
        <Text key={arc.beat} type="secondary" style={{ fontSize: 12 }}>
          {arc.phase} · {arc.beat}
        </Text>
      ))}
    </Space>
  );
}
