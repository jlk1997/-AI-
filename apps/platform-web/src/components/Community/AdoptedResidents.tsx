/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Observatory sidebar: residents this org adopted in the published town.
 */

import React, { useEffect, useState } from 'react';
import { Space, Typography } from 'antd';
import { api } from '../../services/api';
import { useT } from '../../services/i18n';
import { useAppStore } from '../../store';

const { Text } = Typography;

export const AdoptedResidents: React.FC<{
  projectId?: string;
  gameId?: string;
}> = ({ projectId, gameId }) => {
  const { t } = useT();
  const { isAuthenticated } = useAppStore();
  const [rows, setRows] = useState<Array<{ agentName: string; until: string }>>([]);

  useEffect(() => {
    if (!isAuthenticated || (!projectId && !gameId)) return;
    let cancelled = false;
    void (async () => {
      if (gameId) return api.community.adoptions(gameId);
      if (!projectId) return { adoptions: [] as Array<{ agentName: string; until: string }> };
      const res = await api.projects.communityGame(projectId);
      if (!res.gameId) return { adoptions: [] };
      return api.community.adoptions(res.gameId);
    })()
      .then((res) => {
        if (!cancelled && res?.adoptions) {
          setRows(res.adoptions.map((a) => ({ agentName: a.agentName, until: a.until })));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, projectId, gameId]);

  if (!isAuthenticated) return null;
  if (rows.length === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('kai.adopt.empty')}
      </Text>
    );
  }
  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      {rows.map((row) => (
        <Text key={`${row.agentName}-${row.until}`} style={{ fontSize: 12 }}>
          {row.agentName}
          <Text type="secondary">
            {' '}
            · {t('kai.adopt.until', { date: new Date(row.until).toLocaleDateString() })}
            {' · '}
            {t('kai.adopt.remembered')}
          </Text>
        </Text>
      ))}
    </Space>
  );
};
