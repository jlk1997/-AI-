/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 点亮世界: paid extra hourly talks for this town only.
 */

import React, { useEffect, useState } from 'react';
import { Button, Space, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';

import { api, ApiError } from '../../services/api';
import { useT, translateApiError } from '../../services/i18n';
import {
  openWalletForPaywall,
  paywallFromError,
  paywallNeedCopy,
  walletPathForPaywall,
} from '../../utils/kaiPaywall';
import { WORLD_LIGHT_DESK_ID } from './societyTownTimeDesk';
import {
  worldLightUntilLine,
  type SocietyTalkBudgetView,
} from './societyTownGating';

const { Text } = Typography;

export type WorldLightSku = 'hour' | 'day' | 'week';

const DEFAULT_COST: Record<WorldLightSku, number> = {
  hour: 15,
  day: 40,
  week: 160,
};

export type SocietyTownLightDeskProps = {
  readonly gameId?: string;
  readonly projectId?: string;
  readonly canSpend: boolean;
  readonly onRequireLogin: () => void;
  readonly costs?: {
    readonly hour?: number;
    readonly day?: number;
    readonly week?: number;
  };
  readonly talkBudget?: SocietyTalkBudgetView | null;
  readonly urge?: boolean;
  readonly dense?: boolean;
  readonly now?: number;
  readonly onLit?: (info: {
    lightUntil?: string | null;
    lightBonusPerHour?: number;
    talkBudget?: unknown;
  }) => void;
};

export const SocietyTownLightDesk: React.FC<SocietyTownLightDeskProps> = ({
  gameId,
  projectId,
  canSpend,
  onRequireLogin,
  costs,
  talkBudget,
  urge = false,
  dense = false,
  now,
  onLit,
}) => {
  const { t } = useT();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<WorldLightSku | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const price = (sku: WorldLightSku) =>
    costs?.[sku] ?? DEFAULT_COST[sku];

  useEffect(() => {
    if (!canSpend) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    void api.billing
      .wallet()
      .then((w) => {
        if (!cancelled) setBalance(w.balance);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canSpend, gameId, projectId]);

  const buy = (sku: WorldLightSku): void => {
    if (!canSpend) {
      onRequireLogin();
      return;
    }
    setBusy(sku);
    void (async () => {
      try {
        const res = gameId
          ? await api.community.worldLight(gameId, sku)
          : projectId
            ? await api.world.worldLight(projectId, sku)
            : null;
        if (!res) return;
        message.success(t('kai.worldLight.ok'));
        void api.billing
          .wallet()
          .then((w) => setBalance(w.balance))
          .catch(() => undefined);
        onLit?.({
          lightUntil: res.lightUntil,
          lightBonusPerHour: res.lightBonusPerHour,
          talkBudget: res.talkBudget,
        });
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        const code = (err as { code?: string }).code;
        if (status === 402 || code === 'QUOTA_EXCEEDED') {
          const wall = openWalletForPaywall(err, navigate);
          message.warning(paywallNeedCopy(t, wall ?? paywallFromError(err)));
          return;
        }
        message.error(translateApiError(err));
      } finally {
        setBusy(null);
      }
    })();
  };

  const until = worldLightUntilLine({
    litUntil: talkBudget?.litUntil,
    litBonus: talkBudget?.litBonus,
    now,
  });
  const lit = until != null || (talkBudget?.litBonus ?? 0) > 0;
  const untilText =
    until?.key === 'thisHour'
      ? t('product.obs.worldLightThisHour')
      : until?.key === 'minutes'
        ? t('product.obs.worldLightUntil', {
            until: t('product.obs.worldLightRemainMinutes', {
              minutes: String(until.minutes),
            }),
          })
        : until?.key === 'hours'
          ? t('product.obs.worldLightUntil', {
              until: t('product.obs.worldLightRemainHours', {
                hours: String(until.hours),
                minutes: String(until.minutes),
              }),
            })
          : until?.key === 'days'
            ? t('product.obs.worldLightUntil', {
                until: t('product.obs.worldLightRemainDays', {
                  days: String(until.days),
                }),
              })
            : null;

  return (
    <div
      id={WORLD_LIGHT_DESK_ID}
      style={{
        padding: 10,
        borderRadius: 8,
        border: '1px solid #38bdf866',
        background: 'color-mix(in srgb, #0ea5e9 10%, var(--bg-elevated))',
      }}
    >
      <Text strong>{t('product.obs.worldLightTitle')}</Text>
      <Text
        type="secondary"
        style={{ fontSize: 12, display: 'block', margin: '4px 0 8px' }}
      >
        {t(
          lit
            ? 'product.obs.worldLightGuideLit'
            : dense
              ? 'product.obs.worldLightGuideShort'
              : 'product.obs.worldLightGuide',
        )}
      </Text>
      {untilText ? (
        <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          {untilText}
        </Text>
      ) : (
        <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          {t('product.obs.lightNone')}
        </Text>
      )}
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        {t('product.obs.sharedTalk')}
      </Text>
      <Space wrap size={6}>
        <Button
          size="small"
          type={urge ? 'primary' : 'default'}
          loading={busy === 'hour'}
          onClick={() => buy('hour')}
        >
          {t(
            lit ? 'product.obs.worldLightHourAgain' : 'product.obs.worldLightHour',
            { points: String(price('hour')) },
          )}
        </Button>
        <Button
          size="small"
          type={urge ? 'primary' : 'default'}
          ghost={urge}
          loading={busy === 'day'}
          onClick={() => buy('day')}
        >
          {t(
            lit ? 'product.obs.worldLightDayAgain' : 'product.obs.worldLightDay',
            { points: String(price('day')) },
          )}
        </Button>
        <Button
          size="small"
          type="primary"
          ghost={!urge}
          loading={busy === 'week'}
          onClick={() => buy('week')}
        >
          {t(
            lit
              ? 'product.obs.worldLightWeekAgain'
              : 'product.obs.worldLightWeek',
            { points: String(price('week')) },
          )}
        </Button>
      </Space>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
        {t('product.obs.worldLightHourHint', { n: '12' })}
        {' · '}
        {t('product.obs.worldLightDayHint', { n: '12' })}
        {' · '}
        {t('product.obs.worldLightWeekHint', { n: '24' })}
      </Text>
      {canSpend && balance != null ? (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
          {t('product.obs.balanceHint', { n: String(balance) })}
          {balance < price('hour') ? (
            <>
              {' · '}
              <Button
                type="link"
                size="small"
                style={{ padding: 0, height: 'auto', fontSize: 12 }}
                onClick={() =>
                  navigate(
                    walletPathForPaywall({
                      sku: 'pack_kai',
                      needPoints: price('hour') - balance,
                    }),
                  )
                }
              >
                {t('product.obs.shortForLight', {
                  need: String(price('hour') - balance),
                })}
              </Button>
            </>
          ) : null}
        </Text>
      ) : null}
      {!canSpend ? (
        <Button
          type="link"
          size="small"
          style={{ padding: 0, height: 'auto', fontSize: 12, marginTop: 4 }}
          onClick={() => onRequireLogin()}
        >
          {t('product.obs.worldLightCta')}
        </Button>
      ) : null}
    </div>
  );
};
