/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Context-aware copy for the global return capsule.
 */

import type { MyCourseStakeRow, MyCourseWatchRow } from '../../services/api';
import {
  shouldPulseWatch,
  watchPulseKind,
} from './courseWatchSignals';

export type ReturnCapsuleCopy = {
  readonly key: string;
  readonly vars?: Record<string, string>;
};

export function courseReturnCapsuleCopy(input: {
  readonly unseen: number;
  readonly activeStakes: readonly MyCourseStakeRow[];
  readonly watchOnly: readonly MyCourseWatchRow[];
  readonly liveWatches: readonly MyCourseWatchRow[];
}): ReturnCapsuleCopy {
  const pulsingOpen = input.watchOnly.filter(
    (row) => shouldPulseWatch(row) && watchPulseKind(row) === 'open',
  );
  const pulsingSettled = input.watchOnly.filter(
    (row) => shouldPulseWatch(row) && watchPulseKind(row) === 'settled',
  );

  // Results first — matches hub rank and「出结果了」urgency.
  if (pulsingSettled.length === 1) {
    return {
      key: 'product.obs.course.returnCapsule.watchSettledOne',
      vars: { town: pulsingSettled[0]?.title ?? '' },
    };
  }
  if (pulsingSettled.length > 1) {
    return {
      key: 'product.obs.course.returnCapsule.watchSettled',
      vars: { n: String(pulsingSettled.length) },
    };
  }
  if (pulsingOpen.length === 1) {
    return {
      key: 'product.obs.course.returnCapsule.watchOpenOne',
      vars: { town: pulsingOpen[0]?.title ?? '' },
    };
  }
  if (pulsingOpen.length > 1) {
    return {
      key: 'product.obs.course.returnCapsule.watchOpen',
      vars: { n: String(pulsingOpen.length) },
    };
  }
  if (input.unseen > 0) {
    return {
      key: 'product.obs.course.returnCapsule.outcomes',
      vars: { n: String(input.unseen) },
    };
  }

  const revisitCount = input.activeStakes.length + input.liveWatches.length;
  const fallback = Math.max(revisitCount, input.watchOnly.length, input.activeStakes.length);
  return {
    key: 'product.obs.course.returnCapsule',
    vars: { n: String(fallback) },
  };
}
