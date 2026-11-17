/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared lamp strip for author ops. Visitors never see this on the community page.
 */

import React from 'react';
import { Typography } from 'antd';

import type { TownContributor, TownLamp } from '../../services/api';
import { useT } from '../../services/i18n';
import { TOWN_TIME_DESK_ID, townLampTitleKey } from './societyTownTimeDesk';

const { Text } = Typography;

export type SocietyTownLampStripProps = {
  readonly permitHint: string;
  readonly talkBudgetHint: string | null;
  readonly lamp?: TownLamp | null;
  readonly contributors?: readonly TownContributor[];
  readonly watcherCount?: number;
  readonly readOnly?: boolean;
  readonly dense?: boolean;
  readonly children?: React.ReactNode;
};

export const SocietyTownLampStrip: React.FC<SocietyTownLampStripProps> = ({
  permitHint,
  talkBudgetHint,
  lamp = null,
  contributors = [],
  watcherCount = 0,
  readOnly = false,
  dense = false,
  children,
}) => {
  const { t } = useT();
  return (
    <div
      id={readOnly ? undefined : TOWN_TIME_DESK_ID}
      style={{
        padding: 10,
        borderRadius: 8,
        border: '1px solid #f59e0a66',
        background: 'color-mix(in srgb, #f59e0b 10%, var(--bg-elevated))',
      }}
    >
      <Text strong>
        {readOnly ? t('product.obs.lampStrip') : t('product.obs.townTimeTitle')}
      </Text>
      {readOnly ? null : (
        <Text
          type="secondary"
          style={{ fontSize: 12, display: 'block', margin: '4px 0 8px' }}
        >
          {t(
            dense
              ? 'product.obs.townTimeGuideShort'
              : 'product.obs.townTimeGuide',
          )}
        </Text>
      )}
      <Text
        style={{
          fontSize: 12,
          display: 'block',
          marginBottom: 8,
          marginTop: readOnly ? 4 : 0,
        }}
      >
        {permitHint}
        {talkBudgetHint ? ` · ${talkBudgetHint}` : ''}
        {watcherCount > 0
          ? ` · ${
              watcherCount === 1
                ? t('product.obs.watchersOne')
                : t('product.obs.watchers', { n: String(watcherCount) })
            }`
          : ''}
      </Text>
      {lamp ? (
        <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
          {t('product.obs.lampBy', { name: lamp.displayName })}
          {' · '}
          {t(townLampTitleKey(lamp.sku))}
        </Text>
      ) : null}
      {children}
      {contributors.length ? (
        <div style={{ marginTop: children ? 10 : 0 }}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
            {t('product.obs.contributors')}
          </Text>
          {contributors.map((row, index) => (
            <Text
              key={`${row.displayName}-${row.points}-${index}`}
              style={{
                fontSize: 12,
                display: 'block',
                fontWeight:
                  lamp && row.displayName === lamp.displayName ? 600 : 400,
              }}
            >
              {row.displayName}
              {row.lastSku ? ` · ${t(townLampTitleKey(row.lastSku))}` : ''}
              {' · '}
              {row.points}
            </Text>
          ))}
        </div>
      ) : null}
    </div>
  );
};
