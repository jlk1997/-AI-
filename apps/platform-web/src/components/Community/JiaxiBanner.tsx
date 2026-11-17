/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Host-side proof that a 加戏 card landed. Generated games may ignore
 * postMessage; the parent still shows the effect for this run.
 */

import React, { useEffect, useState } from 'react';
import { useT } from '../../services/i18n';

export interface JiaxiBannerCard {
  readonly label: string;
  readonly effect?: string;
}

export const JiaxiBanner: React.FC = () => {
  const { t } = useT();
  const [card, setCard] = useState<JiaxiBannerCard | null>(null);

  useEffect(() => {
    const onCustom = (event: Event): void => {
      const detail = (event as CustomEvent<JiaxiBannerCard>).detail;
      if (detail?.label) setCard(detail);
    };
    window.addEventListener('opengame:jiaxi', onCustom);
    return () => window.removeEventListener('opengame:jiaxi', onCustom);
  }, []);

  useEffect(() => {
    if (!card) return;
    const timer = window.setTimeout(() => setCard(null), 8000);
    return () => window.clearTimeout(timer);
  }, [card]);

  if (!card) return null;
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        right: 12,
        zIndex: 6,
        padding: '8px 12px',
        borderRadius: 8,
        background: 'rgba(15, 23, 42, 0.82)',
        color: '#fde68a',
        fontSize: 13,
        textAlign: 'center',
        pointerEvents: 'none',
      }}
    >
      {t('kai.jiaxi.live', { label: card.label })}
    </div>
  );
};
