/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Folded visitor tip: stacks the same world lamp. Not a lighting shop.
 */

import React, { useEffect, useState } from 'react';
import { Button, Space, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';

import { api } from '../../services/api';
import { translateApiError, useT } from '../../services/i18n';
import {
  openWalletForPaywall,
  paywallNeedCopy,
} from '../../utils/kaiPaywall';

const { Text } = Typography;

export const SocietyTownTipFold: React.FC<{
  readonly gameId: string;
  readonly canSpend: boolean;
  readonly presets?: readonly number[];
  readonly onRequireLogin: () => void;
  readonly onTipped?: (info: {
    lightUntil?: string | null;
    balance?: number;
  }) => void;
}> = ({
  gameId,
  canSpend,
  presets = [5, 12, 30],
  onRequireLogin,
  onTipped,
}) => {
  const { t } = useT();
  const navigate = useNavigate();
  const [tipCoupon, setTipCoupon] = useState(false);

  useEffect(() => {
    if (!canSpend) {
      setTipCoupon(false);
      return;
    }
    let cancelled = false;
    void api.billing
      .market(gameId)
      .then((m) => {
        if (!cancelled) setTipCoupon(Boolean(m.daily?.tipCoupon));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canSpend, gameId]);

  const send = (points: number, coupon = false): void => {
    if (!canSpend) {
      onRequireLogin();
      return;
    }
    void api.community
      .tip(gameId, points, coupon)
      .then((res) => {
        if (coupon) setTipCoupon(false);
        message.success(t('product.obs.tipLightOk'));
        onTipped?.({
          lightUntil: res.lightUntil,
          balance: res.balance,
        });
      })
      .catch((err: unknown) => {
        const wall = openWalletForPaywall(err, navigate);
        message.warning(
          wall ? paywallNeedCopy(t, wall) : translateApiError(err),
        );
      });
  };

  return (
    <Space orientation="vertical" size={6} style={{ width: '100%' }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('product.obs.tipLightHint')}
      </Text>
      <Space wrap>
        {tipCoupon ? (
          <Button size="small" onClick={() => send(5, true)}>
            {t('product.obs.tipLightCoupon')}
          </Button>
        ) : null}
        {presets.map((n) => (
          <Button key={n} size="small" onClick={() => send(n)}>
            {t('kai.tip.btn', { points: n })}
          </Button>
        ))}
      </Space>
    </Space>
  );
};
