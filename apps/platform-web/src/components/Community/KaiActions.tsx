/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Visitor spend on a published game: 喝彩 / 加戏. Worlds do not render this.
 * Generation is not sold here.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input, InputNumber, Select, Space, Switch, Tag, Typography, message } from 'antd';
import {
  FireOutlined,
  GiftOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  api,
  type JiaxiCard,
  type SandboxReport,
  type TownContributor,
  type TownEventOffer,
  type TownLamp,
  type WorkCommerce,
} from '../../services/api';
import { useT, translateApiError } from '../../services/i18n';
import { useTheme } from '../../hooks/useTheme';
import { landPaidJiaxi, openWalletForPaywall, paywallNeedCopy } from '../../utils/kaiPaywall';

const { Text, Paragraph } = Typography;

export interface KaiActionsProps {
  gameId: string;
  isWorld: boolean;
  commerce: WorkCommerce;
  viewerIsAuthor?: boolean;
  canSpend: boolean;
  onRequireLogin: () => void;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
  onTownMoved?: (info?: {
    townTimeUntil?: string | null;
    lamp?: TownLamp | null;
    contributors?: TownContributor[];
    watcherCount?: number;
  }) => void;
  /** Sit inside the town inspector instead of a second card on the page. */
  embedded?: boolean;
  /** Worlds hide this component; leftover for older game desks. */
  omitTownTime?: boolean;
}

function handlePaywall(
  err: unknown,
  navigate: (path: string) => void,
  t: (k: string, vars?: Record<string, string | number>) => string,
): boolean {
  const wall = openWalletForPaywall(err, navigate);
  if (!wall) return false;
  message.warning(paywallNeedCopy(t, wall));
  return true;
}

export const KaiActions: React.FC<KaiActionsProps> = ({
  gameId,
  isWorld,
  commerce,
  viewerIsAuthor,
  canSpend,
  onRequireLogin,
  iframeRef,
  onTownMoved,
  embedded = false,
  omitTownTime = false,
}) => {
  const { t } = useT();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [jiaxiEnabled, setJiaxiEnabled] = useState(commerce.jiaxiEnabled);
  const [xiangyiEnabled, setXiangyiEnabled] = useState(commerce.xiangyiEnabled);
  const [sandboxLine, setSandboxLine] = useState('');
  const [report, setReport] = useState<SandboxReport | null>(null);
  const [firstJiaxi, setFirstJiaxi] = useState(false);
  const [tipCoupon, setTipCoupon] = useState(false);
  const [weekend, setWeekend] = useState(false);
  const [residents, setResidents] = useState<Array<{ key: string; name: string }>>([]);
  const [adoptKey, setAdoptKey] = useState<string | null>(null);
  const [adopted, setAdopted] = useState<Array<{ agentName: string; until: string }>>([]);
  const [sandboxRuns, setSandboxRuns] = useState<
    Array<{ id: string; stimulus: string; report: SandboxReport; createdAt: string }>
  >([]);
  const [jiaxiCost, setJiaxiCost] = useState(commerce.jiaxiCost);
  const [stackToday, setStackToday] = useState(0);
  const [xiangyiCost, setXiangyiCost] = useState(commerce.xiangyiCost);
  const [eventDraft, setEventDraft] = useState<TownEventOffer[]>(commerce.events);

  useEffect(() => {
    if (canSpend) {
      void api.billing
        .market(gameId)
        .then((m) => {
          setFirstJiaxi(m.firstJiaxi);
          setTipCoupon(Boolean(m.daily?.tipCoupon));
          if (typeof m.jiaxiStackToday === 'number') setStackToday(m.jiaxiStackToday);
        })
        .catch(() => undefined);
    }
    void api.community
      .offers()
      .then((o) => setWeekend((o.campaigns ?? []).some((c) => c.id === 'weekend-night-market')))
      .catch(() => undefined);
  }, [canSpend, gameId]);

  useEffect(() => {
    if (!isWorld) return;
    void api.community
      .residents(gameId)
      .then((res) => {
        setResidents(res.residents);
        setAdoptKey((cur) => cur ?? res.residents[0]?.key ?? null);
      })
      .catch(() => undefined);
    void api.community
      .adoptions(gameId)
      .then((res) => setAdopted(res.adoptions))
      .catch(() => undefined);
    void api.community
      .listSandbox(gameId)
      .then((res) => setSandboxRuns(res.runs))
      .catch(() => undefined);
  }, [gameId, isWorld]);

  const cardBg = isDark ? '#18181b' : '#ffffff';
  const cardBorder = isDark ? '#27272a' : '#e2e8f0';

  const guard = (): boolean => {
    if (!canSpend) {
      onRequireLogin();
      return false;
    }
    return true;
  };

  const run = async (key: string, fn: () => Promise<void>): Promise<void> => {
    if (!guard()) return;
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      if (!handlePaywall(err, navigate, t)) {
        message.error(translateApiError(err));
      }
    } finally {
      setBusy(null);
    }
  };

  const tip = (points: number, coupon = false): void => {
    void run(coupon ? 'tip-coupon' : `tip-${points}`, async () => {
      await api.community.tip(gameId, points, coupon);
      message.success(coupon ? t('kai.tip.couponOk') : t('kai.tip.ok'));
      if (coupon) setTipCoupon(false);
    });
  };

  const jiaxiPay = (card?: JiaxiCard): number => {
    const list = card?.points && card.points > 0 ? card.points : commerce.jiaxiCost;
    if (firstJiaxi) return Math.max(1, Math.floor(list * 0.5));
    if (stackToday >= 1) {
      return Math.max(1, Math.round(list * (commerce.jiaxiStackRate ?? 1.5)));
    }
    return list;
  };

  const landJiaxi = async (res: {
    card: JiaxiCard;
    cards?: JiaxiCard[];
    stackToday?: number;
  }): Promise<void> => {
    const landed = res.cards?.length ? res.cards : [res.card];
    message.success(t('kai.jiaxi.ok', { label: landed.map((c) => c.label).join(' · ') }));
    if (typeof res.stackToday === 'number') setStackToday(res.stackToday);
    else setStackToday((n) => n + 1);
    if (res.card.id) setFirstJiaxi(false);
    await landPaidJiaxi(iframeRef?.current, landed, () =>
      api.community.jiaxiConsume(gameId),
    );
  };

  const throwCard = (card: JiaxiCard): void => {
    void run(`jiaxi-${card.id}`, async () => {
      await landJiaxi(await api.community.jiaxi(gameId, card.id));
    });
  };

  const throwRun = (): void => {
    void run('jiaxi-run', async () => {
      await landJiaxi(await api.community.jiaxi(gameId, undefined, 'run'));
    });
  };

  const runPay = (): number => {
    const list = commerce.runBundle?.list ?? 0;
    if (list <= 0) return 0;
    if (firstJiaxi) return Math.max(1, Math.floor(list * 0.5));
    if (stackToday >= 1) {
      return Math.max(1, Math.round(list * (commerce.jiaxiStackRate ?? 1.5)));
    }
    return list;
  };

  const keepAlive = (sku: 'day' | 'week' | 'month'): void => {
    void run(`time-${sku}`, async () => {
      const res = await api.community.townTime(gameId, sku);
      message.success(t('kai.townTime.ok'));
      onTownMoved?.({
        townTimeUntil: res.townTimeUntil,
        lamp: res.lamp,
        contributors: res.contributors,
        watcherCount: res.watcherCount,
      });
    });
  };

  const buyEvent = (event: TownEventOffer): void => {
    void run(`event-${event.id}`, async () => {
      const landed = await api.community.buyEvent(gameId, event.id);
      message.success(
        landed.hang?.optionId
          ? t('kai.event.hung', { label: event.label })
          : t('kai.event.ok', { label: event.label }),
      );
      onTownMoved?.();
    });
  };

  const runSandbox = (): void => {
    const stimulus = sandboxLine.trim();
    if (stimulus.length < 2) return;
    void run('sandbox', async () => {
      const res = await api.community.runSandbox(gameId, stimulus, true);
      setReport(res.report);
      message.success(t('kai.sandbox.ok'));
      const fresh = await api.community.listSandbox(gameId).catch(() => null);
      if (fresh) setSandboxRuns(fresh.runs);
      onTownMoved?.();
    });
  };

  const saveGates = async (next: {
    jiaxiEnabled?: boolean;
    xiangyiEnabled?: boolean;
    jiaxiCost?: number;
    xiangyiCost?: number;
    eventMenu?: TownEventOffer[];
  }): Promise<void> => {
    try {
      const res = await api.community.setCommerce(gameId, next);
      setJiaxiEnabled(res.commerce.jiaxiEnabled);
      setXiangyiEnabled(res.commerce.xiangyiEnabled);
      setJiaxiCost(res.commerce.jiaxiCost);
      setXiangyiCost(res.commerce.xiangyiCost);
      setEventDraft(res.commerce.events);
      message.success(t('community.authorSettings.saved'));
    } catch (err) {
      message.error(translateApiError(err));
    }
  };

  if (isWorld) return null;

  return (
    <Card
      size={embedded ? 'small' : 'default'}
      title={
        embedded ? undefined : (
        <Space>
          <ThunderboltOutlined style={{ color: '#f59e0b' }} />
          <span>{isWorld ? t('kai.xiangyi.title') : t('kai.jiaxi.title')}</span>
        </Space>
        )
      }
      style={
        embedded
          ? { background: 'transparent', border: 'none', marginBottom: 0 }
          : { background: cardBg, border: `1px solid ${cardBorder}`, marginBottom: 24 }
      }
      styles={embedded ? { body: { padding: 0 } } : undefined}
    >
      {embedded ? null : (
      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        {isWorld ? t('kai.xiangyi.hint') : t('kai.jiaxi.hint')}
      </Paragraph>
      )}

      {embedded && isWorld ? null : (
      <Space wrap style={{ marginBottom: 12 }}>
        {tipCoupon ? (
          <Button
            size="small"
            type="primary"
            icon={<GiftOutlined />}
            loading={busy === 'tip-coupon'}
            onClick={() => tip(5, true)}
          >
            {t('kai.tip.coupon')}
          </Button>
        ) : null}
        {(commerce.tipPresets ?? [5, 12, 30]).map((n) => (
          <Button
            key={n}
            size="small"
            icon={<GiftOutlined />}
            loading={busy === `tip-${n}`}
            onClick={() => tip(n)}
          >
            {t('kai.tip.btn', { points: n })}
          </Button>
        ))}
      </Space>
      )}

      {!isWorld && jiaxiEnabled ? (
        <Space wrap style={{ marginBottom: 12 }}>
          {commerce.runBundle && commerce.runBundle.cardIds.length > 1 ? (
            <Button
              size="small"
              type="primary"
              icon={<FireOutlined />}
              loading={busy === 'jiaxi-run'}
              onClick={() => throwRun()}
            >
              {t('kai.jiaxi.run')} · {runPay()}
              {t('wallet.points')}
              {firstJiaxi
                ? ` ${t('kai.jiaxi.half')}`
                : stackToday >= 1
                  ? ` ${t('kai.jiaxi.stack')}`
                  : ` ${t('kai.jiaxi.runHint')}`}
            </Button>
          ) : null}
          {commerce.cards.map((card) => (
            <Button
              key={card.id}
              size="small"
              type="primary"
              ghost
              icon={<FireOutlined />}
              loading={busy === `jiaxi-${card.id}`}
              onClick={() => throwCard(card)}
            >
              {card.label} · {jiaxiPay(card)}
              {t('wallet.points')}
              {firstJiaxi
                ? ` ${t('kai.jiaxi.half')}`
                : stackToday >= 1
                  ? ` ${t('kai.jiaxi.stack')}`
                  : ''}
            </Button>
          ))}
        </Space>
      ) : null}

      {!isWorld && !jiaxiEnabled ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('kai.jiaxi.closed')}
        </Text>
      ) : null}

      {isWorld ? (
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          {omitTownTime ? null : (
          <Space wrap>
            <Button
              size="small"
              loading={busy === 'time-day'}
              onClick={() => keepAlive('day')}
            >
              {t('kai.townTime.day', { points: commerce.townTimeDay })}
            </Button>
            <Button
              size="small"
              loading={busy === 'time-week'}
              onClick={() => keepAlive('week')}
            >
              {t('kai.townTime.week', { points: commerce.townTimeWeek })}
            </Button>
            <Button
              size="small"
              type="primary"
              ghost
              loading={busy === 'time-month'}
              onClick={() => keepAlive('month')}
            >
              {t('kai.townTime.month', { points: commerce.townTimeMonth ?? 240 })}
            </Button>
          </Space>
          )}
          {xiangyiEnabled ? (
            <Space wrap>
              {commerce.events.map((event) => (
                <Button
                  key={event.id}
                  size="small"
                  loading={busy === `event-${event.id}`}
                  onClick={() => buyEvent(event)}
                >
                  {event.label} ·{' '}
                  {weekend ? Math.max(1, Math.floor(event.points * 0.8)) : event.points}
                  {t('wallet.points')}
                  {weekend ? ` ${t('kai.event.weekend')}` : ''}
                </Button>
              ))}
            </Space>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('kai.xiangyi.closed')}
            </Text>
          )}
          {embedded ? null : (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('kai.sandbox.hint')}
            </Text>
            <Input.TextArea
              rows={2}
              style={{ marginTop: 6 }}
              maxLength={400}
              value={sandboxLine}
              onChange={(e) => setSandboxLine(e.target.value)}
              placeholder={t('kai.sandbox.placeholder')}
            />
            <Button
              style={{ marginTop: 8 }}
              size="small"
              type="primary"
              loading={busy === 'sandbox'}
              disabled={sandboxLine.trim().length < 2}
              onClick={runSandbox}
            >
              {t('kai.sandbox.go', { points: commerce.sandbox })}
            </Button>
          </div>
          )}
          {residents.length > 0 ? (
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('kai.adopt.hint')}
              </Text>
              {adopted.length > 0 ? (
                <Text style={{ fontSize: 12 }}>
                  {t('kai.adopt.mine', {
                    names: adopted.map((a) => a.agentName).join('、'),
                  })}
                </Text>
              ) : null}
              <Space wrap>
                <Select
                  size="small"
                  style={{ minWidth: 140 }}
                  value={adoptKey ?? undefined}
                  onChange={setAdoptKey}
                  options={residents.map((r) => ({ value: r.key, label: r.name }))}
                />
                <Button
                  size="small"
                  loading={busy === 'adopt'}
                  disabled={!adoptKey}
                  onClick={() => {
                    if (!adoptKey) return;
                    void run('adopt', async () => {
                      const res = await api.community.adopt(gameId, adoptKey);
                      message.success(t('kai.adopt.ok', { name: res.agentName }));
                      const fresh = await api.community.adoptions(gameId).catch(() => null);
                      if (fresh) setAdopted(fresh.adoptions);
                      onTownMoved?.();
                    });
                  }}
                >
                  {t('kai.adopt.go', { points: commerce.adopt ?? 25 })}
                </Button>
              </Space>
            </Space>
          ) : null}
          {!embedded && report ? (
            <div>
              <Text strong>{report.headline}</Text>
              <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                {report.firstCrack} · {t('kai.sandbox.recovery', { hours: report.recoveryHours })}
              </Paragraph>
              {report.control ? (
                <Tag color="blue">{report.control.headline}</Tag>
              ) : null}
            </div>
          ) : null}
          {!embedded && sandboxRuns.length > 0 ? (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('kai.sandbox.history')}
              </Text>
              {sandboxRuns.slice(0, 5).map((run) => (
                <Paragraph key={run.id} type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
                  {new Date(run.createdAt).toLocaleString()} · {run.stimulus} — {run.report.headline}
                </Paragraph>
              ))}
            </div>
          ) : null}
        </Space>
      ) : null}

      {viewerIsAuthor && !embedded ? (
        <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('kai.author.gates')}
          </Text>
          {!isWorld ? (
            <Space wrap>
              <Switch
                checked={jiaxiEnabled}
                onChange={(checked) => void saveGates({ jiaxiEnabled: checked })}
              />
              <Text>{t('kai.jiaxi.title')}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('kai.author.price')}
              </Text>
              <InputNumber
                size="small"
                min={1}
                max={99}
                value={jiaxiCost}
                onChange={(v) => setJiaxiCost(typeof v === 'number' ? v : jiaxiCost)}
                onBlur={() => {
                  if (jiaxiCost !== commerce.jiaxiCost) void saveGates({ jiaxiCost });
                }}
              />
            </Space>
          ) : (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Space wrap>
                <Switch
                  checked={xiangyiEnabled}
                  onChange={(checked) => void saveGates({ xiangyiEnabled: checked })}
                />
                <Text>{t('kai.xiangyi.title')}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('kai.author.price')}
                </Text>
                <InputNumber
                  size="small"
                  min={1}
                  max={99}
                  value={xiangyiCost}
                  onChange={(v) => setXiangyiCost(typeof v === 'number' ? v : xiangyiCost)}
                  onBlur={() => {
                    if (xiangyiCost !== commerce.xiangyiCost) void saveGates({ xiangyiCost });
                  }}
                />
              </Space>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('kai.author.events')}
              </Text>
              {eventDraft.map((event, index) => (
                <Space key={event.id} wrap>
                  <Input
                    size="small"
                    style={{ width: 88 }}
                    value={event.label}
                    onChange={(e) => {
                      const next = eventDraft.map((row, i) =>
                        i === index ? { ...row, label: e.target.value } : row,
                      );
                      setEventDraft(next);
                    }}
                  />
                  <InputNumber
                    size="small"
                    min={1}
                    max={99}
                    value={event.points}
                    onChange={(v) => {
                      const next = eventDraft.map((row, i) =>
                        i === index ? { ...row, points: typeof v === 'number' ? v : row.points } : row,
                      );
                      setEventDraft(next);
                    }}
                  />
                  <Input
                    size="small"
                    style={{ minWidth: 180 }}
                    value={event.stimulus}
                    onChange={(e) => {
                      const next = eventDraft.map((row, i) =>
                        i === index ? { ...row, stimulus: e.target.value } : row,
                      );
                      setEventDraft(next);
                    }}
                  />
                </Space>
              ))}
              <Button size="small" onClick={() => void saveGates({ eventMenu: eventDraft })}>
                {t('kai.author.saveEvents')}
              </Button>
            </Space>
          )}
        </Space>
      ) : null}
    </Card>
  );
};
