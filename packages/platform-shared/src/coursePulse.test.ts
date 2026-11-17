import { describe, expect, it } from 'vitest';

import { judgeCourseWindow } from './courseMarket.js';
import { courseBoardPulse, courseLocationLooksAway, buildAwayPoseCourseFacts } from './coursePulse.js';

const open = {
  id: 'n1',
  status: 'open',
  pool: 12,
  contested: false,
  myPoints: 12,
  myOptionId: 'stay',
  winningOptionId: null,
  voidReason: null,
};

describe('courseBoardPulse', () => {
  it('stays quiet on the first fetch', () => {
    expect(courseBoardPulse(null, { current: open, history: [] })).toBeNull();
  });

  it('shouts when someone opposes, betting closes, or the board pays', () => {
    expect(
      courseBoardPulse(
        { current: open, history: [] },
        { current: { ...open, contested: true, pool: 24 }, history: [] },
      ),
    ).toEqual({ kind: 'opposed' });
    expect(
      courseBoardPulse(
        { current: { ...open, myPoints: 0, myOptionId: null }, history: [] },
        { current: { ...open, myPoints: 0, contested: true, pool: 24 }, history: [] },
        { isAuthor: true },
      ),
    ).toEqual({ kind: 'author_contested' });
    expect(
      courseBoardPulse(
        { current: { ...open, myPoints: 0, myOptionId: null }, history: [] },
        { current: { ...open, myPoints: 0, contested: true, pool: 24 }, history: [] },
      ),
    ).toBeNull();
    expect(
      courseBoardPulse(
        { current: open, history: [] },
        { current: { ...open, status: 'closed' }, history: [] },
      ),
    ).toEqual({ kind: 'closed' });
    expect(
      courseBoardPulse(
        { current: { ...open, contested: true }, history: [] },
        {
          current: {
            ...open,
            status: 'settled',
            winningOptionId: 'stay',
          },
          history: [],
        },
      ),
    ).toEqual({ kind: 'won' });
    expect(
      courseBoardPulse(
        { current: { ...open, contested: true }, history: [] },
        {
          current: null,
          history: [
            {
              ...open,
              status: 'settled',
              winningOptionId: 'leave',
            },
          ],
        },
      ),
    ).toEqual({ kind: 'lost' });
    expect(
      courseBoardPulse(
        { current: open, history: [] },
        {
          current: { ...open, id: 'n2', status: 'open', myPoints: 0, myOptionId: null },
          history: [{ ...open, status: 'void', voidReason: 'uncontested' }],
        },
      ),
    ).toEqual({ kind: 'voided', voidReason: 'uncontested' });
    expect(
      courseBoardPulse(
        { current: { ...open, contested: true }, history: [] },
        {
          current: { ...open, id: 'n2', status: 'open', myPoints: 0, myOptionId: null },
          history: [{ ...open, status: 'settled', winningOptionId: 'stay' }],
        },
      ),
    ).toEqual({ kind: 'won' });
  });

  it('treats 镇外 pose text as away', () => {
    expect(courseLocationLooksAway('镇外-北门')).toBe(true);
    expect(courseLocationLooksAway('城门外')).toBe(true);
    expect(courseLocationLooksAway('inn_square')).toBe(false);
    expect(courseLocationLooksAway('hallway')).toBe(false);
    expect(courseLocationLooksAway('away_gate')).toBe(true);
  });

  it('builds synthetic leave facts for away poses at settle', () => {
    const facts = buildAwayPoseCourseFacts({
      agentKeys: ['lin'],
      settlesAtMs: 1000,
      agents: [
        {
          agentKey: 'lin',
          regionId: 'north_gate',
          regionName: '镇外-北门',
          lastMoveText: '往官道走',
        },
      ],
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      kind: 'move',
      agentKey: 'lin',
      createdAtMs: 999,
    });
    expect(facts[0]?.text).toContain('出镇');
  });

  it('settles presence boards from away-pose facts at window end', () => {
    const facts = buildAwayPoseCourseFacts({
      agentKeys: ['lin'],
      settlesAtMs: 10_000,
      agents: [
        {
          agentKey: 'lin',
          regionId: 'north_gate',
          regionName: '镇外-北门',
          lastMoveText: '往官道走',
        },
      ],
    });
    const options = [
      {
        id: 'stay',
        predicate: {
          type: 'agent_presence' as const,
          agentKey: 'lin',
          name: '林老板',
          present: true,
        },
      },
      {
        id: 'leave',
        predicate: {
          type: 'agent_presence' as const,
          agentKey: 'lin',
          name: '林老板',
          present: false,
        },
      },
    ];
    const judged = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 10_000,
      options,
      events: [
        {
          id: 'd',
          kind: 'dialogue',
          agentKey: 'lin',
          createdAtMs: 100,
          text: '今晚风大，酒窖该加盖。',
        },
        ...facts.map((fact) => ({
          id: `pose-${fact.agentKey}`,
          kind: fact.kind,
          agentKey: fact.agentKey,
          createdAtMs: fact.createdAtMs,
          text: fact.text,
        })),
      ],
    });
    expect(judged.winningOptionId).toBe('leave');
  });
});
