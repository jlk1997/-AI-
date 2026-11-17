/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tonight-on-the-street: one sentence + three actions. Extra campaigns
 * stay behind a fold so the community home is not a coupon wall.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Typography, message } from 'antd';
import { GiftOutlined } from '@ant-design/icons';

import { api, type KaiCampaign, type KaiMarket } from '../../services/api';
import { translateApiError, useT } from '../../services/i18n';
import { useAppStore } from '../../store';
import { dailyClaimFeedback } from '../../utils/kaiDailyClaim';
import { claimPendingInvite, rememberMyInviteHandle } from '../../utils/kaiPaywall';

const { Text } = Typography;

const GUIDE_KEY = 'kai_guide_dismissed';

export const KaiMarketBar: React.FC<{
  compact?: boolean;
  onClaimed?: () => void;
}> = ({ compact, onClaimed }) => {
  const { t } = useT();
  const navigate = useNavigate();
  const { isAuthenticated } = useAppStore();
  const [campaigns, setCampaigns] = useState<KaiCampaign[]>([]);
  const [market, setMarket] = useState<KaiMarket | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [guide, setGuide] = useState(() => {
    try {
      return localStorage.getItem(GUIDE_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const [openMore, setOpenMore] = useState(false);

  useEffect(() => {
    void api.community
      .offers()
      .then((res) => setCampaigns(res.campaigns ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    void (async () => {
      const invited = await claimPendingInvite();
      if (invited) message.success(t('kai.invite.ok', { points: invited }));
      const next = await api.billing.market().catch(() => null);
      if (next) {
        setMarket(next);
        if (next.inviteHandle) rememberMyInviteHandle(next.inviteHandle);
      }
    })();
  }, [isAuthenticated, t]);

  const claimToday = async (): Promise<void> => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    setClaiming(true);
    try {
      const next = await api.billing.market();
      setMarket(next);
      if (next.inviteHandle) rememberMyInviteHandle(next.inviteHandle);
      const fb = dailyClaimFeedback(next);
      const text = t(fb.key, { points: fb.points });
      if (fb.tone === 'success') message.success(text);
      else message.info(text);
      onClaimed?.();
    } catch (err) {
      message.error(translateApiError(err) || t('kai.daily.fail'));
    } finally {
      setClaiming(false);
    }
  };

  const daily = market?.daily;
  const extras = campaigns.filter((c) => c.lane !== 'jiaxi' && c.lane !== 'xiangyi');
  if (!isAuthenticated) return null;

  return (
    <section className="og-alley-card" style={{ marginBottom: compact ? 12 : 20 }}>
      <div className="og-alley-card__title">{t('kai.alley.title')}</div>
      {guide ? (
        <div className="og-alley-card__body">
          {t('kai.guide.body')}
          <Button
            size="small"
            type="link"
            onClick={() => {
              try {
                localStorage.setItem(GUIDE_KEY, '1');
              } catch {
                /* ignore */
              }
              setGuide(false);
            }}
          >
            {t('kai.guide.dismiss')}
          </Button>
        </div>
      ) : daily ? (
        <div className="og-alley-card__body">
          {daily.justGranted
            ? t('kai.daily.just', { points: daily.justGranted })
            : t('kai.daily.in', { points: daily.loginPoints })}
        </div>
      ) : (
        <div className="og-alley-card__body">{t('kai.guide.body')}</div>
      )}

      <div className="og-alley-actions">
        <Button
          size="small"
          type="primary"
          icon={<GiftOutlined />}
          loading={claiming}
          onClick={() => void claimToday()}
        >
          {t('kai.guide.wallet')}
        </Button>
      </div>

      {market?.inviteHandle || extras.length > 0 || (daily?.streak ?? 0) > 1 ? (
        <div style={{ marginTop: 10 }}>
          <Button size="small" type="link" onClick={() => setOpenMore((v) => !v)}>
            {t('kai.alley.more')}
          </Button>
          {openMore ? (
            <div className="og-alley-card__body">
              {daily && (daily.streak ?? market?.loginStreak ?? 0) > 0
                ? t('kai.streak.in', { days: daily.streak ?? market?.loginStreak ?? 0 })
                : null}
              {extras.map((c) => (
                <div key={c.id}>
                  <Text style={{ fontSize: 12 }}>{c.title}</Text>
                </div>
              ))}
              {market?.inviteHandle ? (
                <Button
                  size="small"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    const url = `${window.location.origin}/community?invite=${market.inviteHandle}`;
                    void navigator.clipboard.writeText(url);
                  }}
                >
                  {t('kai.invite.copy')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
