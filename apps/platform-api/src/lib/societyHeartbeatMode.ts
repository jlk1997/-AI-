/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Author observatory lease writes. 镇时 never lands here.
 */

import {
  authorWatchTtlMs,
  clampSocietyPresenceTtlMs,
} from '@opengame/platform-shared';

export type SocietyHeartbeatMode = 'always' | 'watching' | 'off' | 'leave';

/** Author pause voids tonight’s board immediately. Resume does not. */
export function shouldVoidCourseOnHeartbeat(mode: SocietyHeartbeatMode): boolean {
  return mode === 'off';
}

export function societyHeartbeatWrite(
  mode: SocietyHeartbeatMode,
  ttlMs: number,
  now = Date.now(),
  opts?: {
    readonly keepPresence?: boolean;
    readonly keepPaused?: boolean;
    readonly resumeClock?: boolean;
  },
): {
  heartbeatEnabled: boolean;
  heartbeatUntil?: Date | null;
  authorWatchUntil?: Date | null;
  clockPaused?: boolean;
  lastHeartbeatAt?: Date;
} {
  if (mode === 'off') {
    return {
      heartbeatEnabled: false,
      heartbeatUntil: null,
      authorWatchUntil: null,
      clockPaused: true,
    };
  }
  if (mode === 'leave') {
    return {
      // 只在仍有 watcher 时才认为 lease "enabled"；否则整列视为 0，避免
      // worker 端的 selectLiveWorlds 误以为存在观察者而继续打对话。
      heartbeatEnabled: Boolean(opts?.keepPresence),
      ...(opts?.keepPresence ? {} : { heartbeatUntil: null }),
      authorWatchUntil: null,
      // Closing the observatory must not resume a clock the author froze.
      ...(opts?.keepPaused ? { clockPaused: true } : {}),
    };
  }
  if (mode === 'always') {
    return {
      heartbeatEnabled: true,
      heartbeatUntil: null,
      clockPaused: false,
    };
  }
  const presenceMs = clampSocietyPresenceTtlMs(ttlMs);
  const until = new Date(now + presenceMs);
  return {
    heartbeatEnabled: true,
    heartbeatUntil: until,
    authorWatchUntil: new Date(now + authorWatchTtlMs(presenceMs)),
    lastHeartbeatAt: new Date(now),
    // Presence pings must not undo `off`. Only an explicit resume clears it.
    ...(opts?.resumeClock ? { clockPaused: false } : {}),
  };
}
