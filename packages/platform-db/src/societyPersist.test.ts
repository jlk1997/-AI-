/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  loadSocietyMemoriesForAgents,
  relationKeysTouchedBy,
  isSocietyMetaEventKey,
  comparePersistedSocietyEvents,
  type PersistableSocietyEvent,
} from './societyPersist.js';

const ev = (
  kind: string,
  agentId: string | undefined,
  payload: Record<string, unknown>,
): PersistableSocietyEvent => ({
  id: `${kind}_${Math.random()}`,
  simTime: 10,
  kind,
  ...(agentId ? { agentId } : {}),
  payload,
});

describe('relationKeysTouchedBy', () => {
  it('is empty for a step with no social events', () => {
    const keys = relationKeysTouchedBy([
      ev('move', 'a', { regionId: 'town' }),
      ev('action', 'a', { activity: '干活' }),
      ev('plan', 'a', { dayIndex: 0 }),
      ev('reflection', 'a', { text: '想通了' }),
    ]);
    // This is the whole point: a quiet step must not rewrite the graph.
    expect(keys.size).toBe(0);
  });

  it('pairs everyone in a group conversation', () => {
    const keys = relationKeysTouchedBy([
      ev('dialogue', 'a', { participants: ['a', 'b', 'c'] }),
    ]);
    expect([...keys].sort()).toEqual(['a|b', 'a|c', 'b|c']);
  });

  it('normalizes pair order so a|b and b|a are one key', () => {
    const keys = relationKeysTouchedBy([
      ev('dialogue', 'b', { participants: ['b', 'a'] }),
      ev('dialogue', 'a', { participants: ['a', 'b'] }),
    ]);
    expect([...keys]).toEqual(['a|b']);
  });

  it('reads the legacy two-person `with` payload', () => {
    const keys = relationKeysTouchedBy([ev('dialogue', 'a', { with: 'b' })]);
    expect([...keys]).toEqual(['a|b']);
  });

  it('counts interventions, which also change how agents see each other', () => {
    const keys = relationKeysTouchedBy([
      ev('intervene', 'a', { participants: ['a', 'b'], kind: 'whisper' }),
    ]);
    expect([...keys]).toEqual(['a|b']);
  });

  it('ignores self-pairs and malformed participant lists', () => {
    const keys = relationKeysTouchedBy([
      ev('dialogue', 'a', { participants: ['a', 'a'] }),
      ev('dialogue', 'b', { participants: [1, null, 'b'] }),
      ev('dialogue', undefined, { participants: [] }),
    ]);
    expect(keys.size).toBe(0);
  });

  it('pairs paid 认养 / 巷议 targets with the visitor only', () => {
    const keys = relationKeysTouchedBy([
      ev('intervene', undefined, {
        kind: 'rumor',
        town: true,
        with: 'visitor',
        influenceOf: 'visitor',
        influenceTargets: ['a', 'b', 'c'],
        participants: ['visitor'],
      }),
    ]);
    expect([...keys].sort()).toEqual(['a|visitor', 'b|visitor', 'c|visitor']);
  });

  it('grows linearly with talk, not quadratically with population', () => {
    // 14 residents would be 91 pairs if we wrote the whole graph; two circles
    // that actually talked are 4 pairs.
    const keys = relationKeysTouchedBy([
      ev('dialogue', 'a', { participants: ['a', 'b', 'c'] }),
      ev('dialogue', 'd', { participants: ['d', 'e'] }),
    ]);
    expect(keys.size).toBe(4);
  });
});

describe('society meta event keys', () => {
  it('treats occupancy EMA and object tip like the emergence report singleton', () => {
    expect(isSocietyMetaEventKey('emergence_report_latest')).toBe(true);
    expect(isSocietyMetaEventKey('society_occupancy_ema')).toBe(true);
    expect(isSocietyMetaEventKey('society_object_tip')).toBe(true);
    expect(isSocietyMetaEventKey('evt_walk_1')).toBe(false);
  });
});

describe('loadSocietyMemoriesForAgents', () => {
  type Row = {
    id: string;
    memoryKey: string | null;
    agentKey: string;
    kind: string;
    text: string;
    simTime: number;
    importance: number;
    embedding: unknown;
    lastAccessSimTime: number;
    pointersJson: unknown;
  };

  const row = (id: string, importance: number, simTime: number): Row => ({
    id,
    memoryKey: id,
    agentKey: 'a1',
    kind: 'observation',
    text: id,
    simTime,
    importance,
    embedding: null,
    lastAccessSimTime: simTime,
    pointersJson: null,
  });

  /**
   * Minimal drizzle stand-in. The loader issues the importance slice first and
   * the recency slice second per agent, so the call index picks the sort order.
   */
  function fakeDb(rows: readonly Row[]) {
    const calls: Array<{ by: 'importance' | 'simTime'; limit: number }> = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: (n: number) => {
                const by = calls.length % 2 === 0 ? 'importance' : 'simTime';
                calls.push({ by, limit: n });
                const sorted = [...rows].sort((x, y) =>
                  by === 'simTime'
                    ? y.simTime - x.simTime
                    : y.importance - x.importance,
                );
                return Promise.resolve(sorted.slice(0, n));
              },
            }),
          }),
        }),
      }),
    };
    return { db, calls };
  }

  it('layers a recency slice on top of the importance slice, deduped', async () => {
    const rows = [
      row('old_important', 9, 1),
      row('older_important', 8, 2),
      row('recent_mundane', 1, 99),
      row('recent_mundane_2', 1, 98),
    ];
    const { db, calls } = fakeDb(rows);
    const out = await loadSocietyMemoriesForAgents(
      db as never,
      'w1',
      ['a1'],
      { perAgent: 2, recentPerAgent: 2 },
    );
    expect(calls).toHaveLength(2);
    const ids = out.map((m) => m.id).sort();
    // Importance-only hydration would have dropped both recent mundane rows —
    // exactly the context a resident needs to say something new.
    expect(ids).toEqual([
      'old_important',
      'older_important',
      'recent_mundane',
      'recent_mundane_2',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('skips the second query when the recency slice is disabled', async () => {
    const { db, calls } = fakeDb([row('m1', 5, 5)]);
    await loadSocietyMemoriesForAgents(db as never, 'w1', ['a1'], {
      perAgent: 8,
      recentPerAgent: 0,
    });
    expect(calls).toHaveLength(1);
  });

  it('is a no-op without agents', async () => {
    const { db, calls } = fakeDb([row('m1', 5, 5)]);
    expect(await loadSocietyMemoriesForAgents(db as never, 'w1', [])).toEqual(
      [],
    );
    expect(calls).toHaveLength(0);
  });
});

describe('mergeEmergenceReport', () => {
  it('keeps seed hours when a live tick omits seed', async () => {
    const { mergeEmergenceReport } = await import('./societyPersist.js');
    const merged = mergeEmergenceReport(
      {
        summary: 'live',
        informationSpread: { rate: 0.4 },
      },
      {
        summary: 'seed',
        seed: { hours: 16, dialogues: 12, gateFailed: false },
      },
    );
    expect(merged['seed']).toEqual({
      hours: 16,
      dialogues: 12,
      gateFailed: false,
    });
    expect(merged['summary']).toBe('live');
  });

  it('lets a new seed run overwrite hours and gateFailed', async () => {
    const { mergeEmergenceReport } = await import('./societyPersist.js');
    const merged = mergeEmergenceReport(
      { seed: { hours: 16, dialogues: 0, gateFailed: true } },
      { seed: { hours: 8, dialogues: 4, gateFailed: false } },
    );
    expect(merged['seed']).toEqual({
      hours: 16,
      dialogues: 0,
      gateFailed: true,
    });
  });
});

describe('comparePersistedSocietyEvents', () => {
  it('orders same simTime by talkSeq then createdAt', () => {
    const a = ev('dialogue', 'a', { talkSeq: 3 });
    const b = ev('dialogue', 'b', { talkSeq: 1 });
    const c = ev('dialogue', 'c', { talkSeq: 2 });
    a.simTime = 14;
    b.simTime = 14;
    c.simTime = 14;
    expect(
      [a, b, c]
        .sort(comparePersistedSocietyEvents)
        .map((e) => e.payload['talkSeq']),
    ).toEqual([1, 2, 3]);
    const older = ev('dialogue', 'x', {});
    const newer = ev('dialogue', 'y', {});
    older.simTime = 8;
    newer.simTime = 8;
    older.createdAtMs = 10;
    newer.createdAtMs = 20;
    older.id = 'z';
    newer.id = 'a';
    expect(
      [newer, older].sort(comparePersistedSocietyEvents).map((e) => e.id),
    ).toEqual(['z', 'a']);
  });

  it('sorts a live-tip bag the way loadSocietyLiveTip now does', () => {
    const late = ev('dialogue', 'late', { talkSeq: 3 });
    const early = ev('dialogue', 'early', { talkSeq: 1 });
    late.simTime = 20;
    early.simTime = 20;
    late.createdAtMs = 1;
    early.createdAtMs = 2;
    expect(
      [late, early]
        .sort(comparePersistedSocietyEvents)
        .map((e) => e.payload['talkSeq']),
    ).toEqual([1, 3]);
  });
});

describe('societyEditSyncMode', () => {
  it('defaults to patch and only restarts on an explicit wipe', async () => {
    const { societyEditSyncMode } = await import('./societyPersist.js');
    expect(societyEditSyncMode('把铁匠改成叛徒')).toBe('patch');
    expect(societyEditSyncMode('扩一块码头')).toBe('patch');
    expect(societyEditSyncMode('重开社会，清空传闻')).toBe('restart');
    expect(societyEditSyncMode('restart the society and wipe gossip')).toBe(
      'restart',
    );
  });
});
