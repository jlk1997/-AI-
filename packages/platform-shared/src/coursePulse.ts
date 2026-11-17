/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-side board diffs. Never invent a win — only report what changed.
 */

export type CoursePulseKind =
  | 'opposed'
  | 'author_contested'
  | 'closed'
  | 'won'
  | 'lost'
  | 'voided'
  | 'next';

export type CoursePulseView = {
  readonly id: string;
  readonly status: string;
  readonly pool: number;
  readonly contested?: boolean;
  readonly myPoints: number;
  readonly myOptionId: string | null;
  readonly winningOptionId: string | null;
  readonly voidReason: string | null;
};

export type CoursePulseBoard = {
  readonly current: CoursePulseView | null;
  readonly history: readonly CoursePulseView[];
};

export type CoursePulse = {
  readonly kind: CoursePulseKind;
  readonly voidReason?: string | null;
};

function winLose(
  was: CoursePulseView,
  settled: CoursePulseView,
): CoursePulse | null {
  if (was.myPoints <= 0) return null;
  if (
    settled.winningOptionId &&
    was.myOptionId &&
    settled.winningOptionId === was.myOptionId
  ) {
    return { kind: 'won' };
  }
  return { kind: 'lost' };
}

/**
 * What the desk should shout after a refetch. First load (no prev) is silent.
 */
export function courseBoardPulse(
  prev: CoursePulseBoard | null,
  next: CoursePulseBoard | null,
  opts?: { readonly isAuthor?: boolean },
): CoursePulse | null {
  const was = prev?.current;
  if (!was) return null;
  const now = next?.current ?? null;
  if (now && now.id === was.id) {
    if (was.status === 'open' && now.status === 'closed') {
      return { kind: 'closed' };
    }
    if (was.status !== 'settled' && now.status === 'settled') {
      return winLose(was, now);
    }
    if (was.status !== 'void' && now.status === 'void') {
      return { kind: 'voided', voidReason: now.voidReason };
    }
    if (!was.contested && now.contested) {
      if (was.myPoints > 0) return { kind: 'opposed' };
      if (opts?.isAuthor) return { kind: 'author_contested' };
    }
    return null;
  }
  const settled = next?.history.find((row) => row.id === was.id);
  if (settled) {
    if (settled.status === 'void') {
      return { kind: 'voided', voidReason: settled.voidReason };
    }
    if (settled.status === 'settled') {
      return winLose(was, settled);
    }
  }
  if (
    (was.status === 'settled' || was.status === 'void') &&
    now &&
    now.status === 'open' &&
    now.id !== was.id
  ) {
    return { kind: 'next' };
  }
  return null;
}

export function courseLocationLooksAway(
  raw: string | null | undefined,
): boolean {
  if (!raw || !raw.trim()) return false;
  const hay = raw.toLowerCase();
  if (
    ['镇外', '城外', '出镇', '出城', '城门外', '官道', '荒野', '村外'].some(
      (needle) => hay.includes(needle),
    )
  ) {
    return true;
  }
  if (
    hay.includes('left-town') ||
    hay.includes('left_town') ||
    hay.includes('lefttown') ||
    hay.includes('wilderness') ||
    hay.includes('countryside')
  ) {
    return true;
  }
  return (
    /(^|[^a-z])away([^a-z]|$)/.test(hay) ||
    /(^|[^a-z])outside([^a-z]|$)/.test(hay)
  );
}

export type AwayPoseAgentSnapshot = {
  readonly agentKey: string;
  readonly regionId?: string;
  readonly regionName?: string;
  readonly lastMoveText?: string;
};

/** Synthetic leave facts when a presence-board resident is posed away at settle. */
export function buildAwayPoseCourseFacts(input: {
  readonly agents: readonly AwayPoseAgentSnapshot[];
  readonly agentKeys: readonly string[];
  readonly settlesAtMs: number;
  readonly looksAway?: (place: string) => boolean;
}): ReadonlyArray<{
  readonly id: string;
  readonly kind: 'move';
  readonly agentKey: string;
  readonly createdAtMs: number;
  readonly text: string;
}> {
  const looksAway = input.looksAway ?? courseLocationLooksAway;
  const keys = new Set(input.agentKeys);
  const out: Array<{
    id: string;
    kind: 'move';
    agentKey: string;
    createdAtMs: number;
    text: string;
  }> = [];
  for (const agent of input.agents) {
    if (!keys.has(agent.agentKey)) continue;
    const place = [
      agent.regionId,
      agent.regionName,
      agent.lastMoveText,
    ]
      .filter((part) => part?.trim())
      .join(' ');
    if (!looksAway(place)) continue;
    out.push({
      id: `pose-away:${agent.agentKey}`,
      kind: 'move',
      agentKey: agent.agentKey,
      createdAtMs: input.settlesAtMs - 1,
      text: `${place} 出镇`,
    });
  }
  return out;
}
