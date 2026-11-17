/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { message } from 'antd';

import { api } from '../../services/api';
import { useT } from '../../services/i18n';
import { notifyCourseWatchChanged } from './courseTelemetry';

export function useCourseUnwatch(): {
  readonly unwatch: (gameId: string) => Promise<boolean>;
  readonly busyGameId: string | null;
} {
  const { t } = useT();
  const [busyGameId, setBusyGameId] = useState<string | null>(null);

  const unwatch = useCallback(
    async (gameId: string): Promise<boolean> => {
      if (busyGameId) return false;
      setBusyGameId(gameId);
      try {
        await api.me.courseUnwatch(gameId);
        notifyCourseWatchChanged();
        message.success(t('product.obs.course.watch.disabled'));
        return true;
      } catch {
        message.error(t('product.obs.course.watch.fail'));
        return false;
      } finally {
        setBusyGameId(null);
      }
    },
    [busyGameId, t],
  );

  return { unwatch, busyGameId };
}
