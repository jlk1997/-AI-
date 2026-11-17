/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Empty,
  List,
  Segmented,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import { ArrowLeftOutlined, GiftOutlined } from '@ant-design/icons';

import {
  api,
  type BillingCatalog,
  type CheckoutOrder,
  type UsageSummary,
  type WalletSummary,
} from '../services/api.js';
import { translateApiError, useT } from '../services/i18n.js';
import { useAppStore } from '../store/index.js';
import { useDeviceShell } from '../mobile/useDeviceShell';
import { isWeChatBrowser } from '../mobile/deviceShell.js';
import { payWithWeChatBridge } from '../mobile/wechat.js';
import { KaiMarketBar } from '../components/Community/KaiMarketBar.js';
import { featureFlags } from '../utils/featureFlags.js';
import {
  packTitleKey,
  rememberWalletArrivalBalance,
  safeWalletReturn,
  walletArrivalStorageKey,
  walletShowsReady,
} from '../utils/kaiPaywall.js';

const { Text, Title } = Typography;

function yuan(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

/**
 * Which provider to open by default. Inside WeChat the JSAPI flow is the only
 * one that works without bouncing the user out of the app; elsewhere Alipay's
 * WAP page is the shortest path on a phone.
 */
function preferredProvider(
  available: readonly string[],
  locale: string,
): string | null {
  if (available.length === 0) return null;
  if (isWeChatBrowser() && available.includes('wechat')) return 'wechat';
  if (locale !== 'zh-CN' && available.includes('stripe')) return 'stripe';
  for (const candidate of ['alipay', 'wechat', 'stripe', 'mock']) {
    if (available.includes(candidate)) return candidate;
  }
  return available[0] ?? null;
}

/** Ledger rows read as sentences, not enum names. */
function ledgerLabel(t: (k: string) => string, kind: string): string {
  const known = [
    'topup',
    'grant',
    'spend',
    'royalty',
    'refund',
    'adjust',
    'tip',
    'purchase',
    'sale',
    'course_stake',
    'course_payout',
    'course_void',
    'course_rake',
  ];
  return known.includes(kind) ? t(`wallet.ledger.${kind}`) : kind;
}

function usageJobLabel(
  t: (k: string, vars?: Record<string, string | number>) => string,
  jobType: string,
): string {
  const key = `wallet.usage.job.${jobType}`;
  const label = t(key);
  return label !== key ? label : jobType;
}

function packHint(t: (k: string, vars?: Record<string, string | number>) => string): string {
  return t('wallet.packHint.general');
}

export const Wallet: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t, locale } = useT();
  const { isAuthenticated } = useAppStore();
  const compact = useDeviceShell() === 'mobile';
  const highlightSku = params.get('sku');
  const needPoints = Number(params.get('need') ?? '');
  const returnTo = safeWalletReturn(params.get('from'));
  const shortfall =
    Number.isFinite(needPoints) && needPoints > 0 ? Math.round(needPoints) : 0;

  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [credited, setCredited] = useState(false);
  const [arrivalBalance, setArrivalBalance] = useState<number | null>(null);
  const arrivalKey = walletArrivalStorageKey(shortfall, returnTo);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [c, w, u] = await Promise.all([
        api.billing.catalog(),
        isAuthenticated ? api.billing.wallet() : Promise.resolve(null),
        isAuthenticated ? api.billing.usage().catch(() => null) : Promise.resolve(null),
      ]);
      const visible = c.providers.filter(
        (p) =>
          p !== 'stripe' ||
          featureFlags.stripe ||
          locale !== 'zh-CN' ||
          c.stripeStorefront === true,
      );
      setCatalog({ ...c, providers: visible });
      setWallet(w);
      setUsage(u);
      if (shortfall > 0 && w) {
        setArrivalBalance((prev) =>
          prev ?? rememberWalletArrivalBalance(arrivalKey, w.balance),
        );
      }
      setProvider((current) => current ?? preferredProvider(visible, locale));
    } catch {
      /* the page still renders the plan table without a session */
    } finally {
      setLoading(false);
    }
  }, [arrivalKey, isAuthenticated, locale, shortfall]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const cs = params.get('cs');
    if (cs) {
      void (async () => {
        try {
          const settled = await api.billing.confirmStripe(cs);
          if (settled.status === 'credited' || settled.status === 'already-paid') {
            setCredited(true);
            message.success(t('wallet.paid'));
          } else {
            message.info(t('wallet.stripe.returning'));
          }
        } catch {
          message.info(t('wallet.stripe.returning'));
        }
        await load();
      })();
    }
    if (params.get('checkout') === 'cancel') {
      message.warning(t('wallet.stripe.cancelled'));
    }
  }, [load, params, t]);


  useEffect(() => {
    const welcome = wallet?.market?.welcomeJustGranted;
    const daily = wallet?.market?.daily?.justGranted;
    if (welcome) {
      message.success(t('kai.welcome.just', { points: welcome }));
    } else if (daily) {
      message.success(t('kai.daily.just', { points: daily }));
    }
  }, [t, wallet?.market?.daily?.justGranted, wallet?.market?.welcomeJustGranted]);

  /**
   * Redirect and JSAPI checkouts both leave the page (or the JS context), so
   * the balance is re-read on the way back rather than optimistically bumped.
   */
  const handoff = useCallback(
    async (order: CheckoutOrder): Promise<void> => {
      const prepay = order.prepay;
      if (prepay.kind === 'mock') {
        await api.billing.mockPay(order.orderId);
        setCredited(true);
        message.success(t('wallet.paid'));
        await load();
        return;
      }
      if (prepay.kind === 'jsapi') {
        await payWithWeChatBridge(prepay);
        // WeChat confirms out of band; the notify may land after the bridge
        // resolves, so poll a couple of times before giving up on the update.
        for (let i = 0; i < 5; i += 1) {
          await new Promise((r) => setTimeout(r, 1200));
          if (i === 2) {
            const replay = await api.billing.reconcile(order.orderId).catch(() => null);
            if (replay?.status === 'credited' || replay?.status === 'already-paid') {
              setCredited(true);
              message.success(t('wallet.reconcile.ok'));
              break;
            }
          }
          const status = await api.billing.order(order.orderId).catch(() => null);
          if (status?.status === 'paid') {
            setCredited(true);
            message.success(t('wallet.paid'));
            break;
          }
        }
        await load();
        return;
      }
      const url = prepay.kind === 'redirect' ? prepay.url : prepay.h5Url;
      window.location.href = url;
    },
    [load, t],
  );

  const buy = useCallback(
    async (sku: string): Promise<void> => {
      if (!isAuthenticated) {
        navigate('/login');
        return;
      }
      if (!provider) {
        message.warning(t('wallet.noProvider'));
        return;
      }
      setBuying(sku);
      try {
        const order = await api.billing.createOrder({
          sku,
          provider,
          ...(provider === 'wechat'
            ? { channel: isWeChatBrowser() ? 'jsapi' : 'h5' }
            : {}),
          returnUrl: `${window.location.origin}${window.location.pathname}${window.location.search}`,
        });
        await handoff(order);
      } catch (err) {
        message.error(translateApiError(err) || t('wallet.failed'));
      } finally {
        setBuying(null);
      }
    },
    [handoff, isAuthenticated, navigate, provider, t],
  );

  const providerOptions = useMemo(
    () =>
      (catalog?.providers ?? []).map((p) => ({
        value: p,
        label: t(`wallet.provider.${p}`),
      })),
    [catalog?.providers, t],
  );

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', padding: 64 }}>
        <Spin />
      </div>
    );
  }

  const pad = compact ? 12 : 24;
  const justFunded = walletShowsReady({
    credited,
    shortfall,
    balance: wallet?.balance,
    arrivalBalance,
  });

  return (
    <div className="og-wallet-page" style={{ padding: pad, maxWidth: 880, margin: '0 auto' }}>
      <Space style={{ marginBottom: 12 }}>
        {compact && (
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(-1)}
          />
        )}
        <Title level={compact ? 5 : 4} style={{ margin: 0 }}>
          {t('wallet.title')}
        </Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('wallet.lede')} {t('wallet.pricedCny')}
        </Text>
      </Space>

      <KaiMarketBar compact onClaimed={() => void load()} />

      {shortfall > 0 || returnTo ? (
        <Alert
          type={justFunded ? 'success' : 'info'}
          showIcon
          style={{ marginBottom: 12 }}
          message={
            justFunded
              ? t('wallet.paywall.ready')
              : shortfall > 0
                ? t('wallet.paywall.need', {
                    need: shortfall,
                    pack: t(packTitleKey(highlightSku)),
                  })
                : t('wallet.paywall.backHint')
          }
          action={
            returnTo ? (
              <Button size="small" type="primary" onClick={() => navigate(returnTo)}>
                {t('wallet.paywall.back')}
              </Button>
            ) : null
          }
        />
      ) : null}

      {wallet && usage ? (
        <Card variant="borderless" style={{ borderRadius: 12, marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('wallet.usage')}
          </Text>
          {usage.byModality.length === 0 ? (
            <div>
              <Text type="secondary">{t('wallet.usage.empty')}</Text>
            </div>
          ) : (
            <>
              <Space wrap style={{ marginTop: 8 }}>
              {(usage.byJobType ?? usage.byModality).map((row) => {
                const typeKey = row.jobType ?? row.modality ?? 'generate';
                return (
                  <Tag key={typeKey}>
                    {t('wallet.usage.line', {
                      modality: usageJobLabel(t, typeKey),
                      jobs: row.jobs,
                      units: row.units,
                    })}
                  </Tag>
                );
              })}
              </Space>
              {usage.recent && usage.recent.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('wallet.usage.recent')}
                  </Text>
                  <List
                    size="small"
                    dataSource={usage.recent.slice(0, 8)}
                    renderItem={(row) => (
                      <List.Item style={{ padding: '4px 0' }}>
                        <Text style={{ fontSize: 12 }}>
                          {usageJobLabel(t, row.jobType)}
                          {row.ms != null
                            ? ` · ${t('wallet.usage.ms', { sec: Math.max(1, Math.round(row.ms / 1000)) })}`
                            : ''}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {new Date(row.createdAt).toLocaleString()}
                        </Text>
                      </List.Item>
                    )}
                  />
                </div>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      <Card variant="borderless" style={{ borderRadius: 12, marginBottom: 12 }}>
        {wallet ? (
          <Space
            size={compact ? 24 : 48}
            wrap
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            <Statistic
              title={t('wallet.balance')}
              value={wallet.balance}
              prefix={<GiftOutlined />}
            />
            <Statistic title={t('wallet.spent')} value={wallet.lifetimeSpent} />
            {wallet.market && wallet.market.authorTonight > 0 ? (
              <Space orientation="vertical" size={2}>
                <Statistic
                  title={t('kai.author.earnedTitle')}
                  value={wallet.market.authorTonight}
                />
                {wallet.market.authorTonightByKind ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('kai.author.tonightKind', {
                      tip: wallet.market.authorTonightByKind.tip,
                      jiaxi: wallet.market.authorTonightByKind.jiaxi,
                      xiangyi: wallet.market.authorTonightByKind.xiangyi,
                      townTime: wallet.market.authorTonightByKind.townTime ?? 0,
                      worldLight: wallet.market.authorTonightByKind.worldLight ?? 0,
                    })}
                  </Text>
                ) : null}
                {wallet.market.jiaxiByCardTonight &&
                Object.keys(wallet.market.jiaxiByCardTonight).length > 0 ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('kai.author.tonightCards', {
                      cards: Object.entries(wallet.market.jiaxiByCardTonight)
                        .map(([id, n]) => `${id}×${n}`)
                        .join(' '),
                    })}
                  </Text>
                ) : null}
              </Space>
            ) : null}
            <Space orientation="vertical" size={2}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('wallet.plan')}
              </Text>
              <Space>
                <Tag color={wallet.plan === 'free' ? undefined : 'gold'}>
                  {wallet.plan}
                </Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('wallet.dailyJobs')}: {wallet.dailyJobLimit}
                </Text>
              </Space>
            </Space>
          </Space>
        ) : (
          <Empty description={t('wallet.signInHint')}>
            <Button type="primary" onClick={() => navigate('/login')}>
              {t('wallet.signIn')}
            </Button>
          </Empty>
        )}
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          {t('wallet.lane.hint')}
        </Text>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          {t('wallet.notEnforced')}
        </Text>
      </Card>

      {providerOptions.length > 1 && (
        <Space style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('wallet.payWith')}
          </Text>
          <Segmented
            size="small"
            value={provider ?? undefined}
            options={providerOptions}
            onChange={(v) => setProvider(String(v))}
          />
        </Space>
      )}

      <Card
        size="small"
        variant="borderless"
        title={t('wallet.packs')}
        style={{ borderRadius: 12, marginBottom: 12 }}
      >
        {(catalog?.packs.length ?? 0) === 0 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('wallet.noPacks')}
          </Text>
        ) : (
          <List
            dataSource={[...(catalog?.packs ?? [])].sort((a, b) => {
              if (a.id === highlightSku) return -1;
              if (b.id === highlightSku) return 1;
              return a.points - b.points;
            })}
            renderItem={(pack) => (
              <List.Item
                actions={[
                  <Button
                    key="buy"
                    type="primary"
                    size="small"
                    loading={buying === pack.id}
                    onClick={() => void buy(pack.id)}
                  >
                    ¥{yuan(pack.priceCents)}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <span>
                        {pack.points} {t('wallet.points')}
                      </span>
                      {highlightSku === pack.id ? (
                        <Tag color="red">{t('wallet.pack.recommended')}</Tag>
                      ) : null}
                      {wallet?.market?.firstTopupAvailable ? (
                        <Tag color="gold">{t('wallet.pack.firstTopup')}</Tag>
                      ) : null}
                    </Space>
                  }
                  description={
                    highlightSku === pack.id && shortfall > 0
                      ? t('wallet.paywall.enough', { need: shortfall })
                      : packHint(t)
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <Card
        size="small"
        variant="borderless"
        title={t('wallet.plans')}
        style={{ borderRadius: 12, marginBottom: 12 }}
      >
        <List
          dataSource={catalog?.plans ?? []}
          renderItem={(plan) => {
            const current = wallet?.plan === plan.id;
            return (
              <List.Item
                actions={[
                  plan.priceCents > 0 && !current ? (
                    <Button
                      key="buy"
                      size="small"
                      loading={buying === `plan:${plan.id}`}
                      onClick={() => void buy(`plan:${plan.id}`)}
                    >
                      ¥{yuan(plan.priceCents)}/{t('wallet.month')}
                    </Button>
                  ) : (
                    <Tag key="tag" color={current ? 'green' : undefined}>
                      {current ? t('wallet.current') : t('wallet.free')}
                    </Tag>
                  ),
                ]}
              >
                <List.Item.Meta
                  title={plan.id}
                  description={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('wallet.planHint')} · {plan.monthlyPoints}{' '}
                      {t('wallet.pointsPerMonth')} · {plan.dailyJobLimit}{' '}
                      {t('wallet.jobsPerDay')} · {plan.maxConcurrentJobs}{' '}
                      {t('wallet.concurrent')}
                    </Text>
                  }
                />
              </List.Item>
            );
          }}
        />
      </Card>

      {wallet && (
        <Card
          size="small"
          variant="borderless"
          title={t('wallet.history')}
          style={{ borderRadius: 12 }}
        >
          {wallet.entries.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('wallet.noHistory')}
            </Text>
          ) : (
            <List
              size="small"
              dataSource={wallet.entries}
              renderItem={(entry) => (
                <List.Item style={{ paddingInline: 0 }}>
                  <Space orientation="vertical" size={0}>
                    <Text>{ledgerLabel(t, entry.kind)}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {new Date(entry.createdAt).toLocaleString()}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </Text>
                  </Space>
                  <Text
                    strong
                    type={entry.points >= 0 ? 'success' : undefined}
                  >
                    {entry.points >= 0 ? '+' : ''}
                    {entry.points}
                  </Text>
                </List.Item>
              )}
            />
          )}
        </Card>
      )}
      <div style={{ height: 24 }} />
    </div>
  );
};

export default Wallet;
