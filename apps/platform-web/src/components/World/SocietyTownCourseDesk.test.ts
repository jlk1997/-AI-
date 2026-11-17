import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { courseBoardPulse } from '@opengame/platform-shared';

import { evidenceHits } from './SocietyTownCourseClockHud.js';
import {
  courseDeskClockLine,
  courseKeepAliveNeeded,
  coursePhaseCopyKey,
  coursePulseToastKey,
  courseStakeCtaLine,
} from './SocietyTownCourseDesk.js';
import {
  courseEvidenceHealthKey,
  courseEvidenceQuietWarning,
  courseWhisperPlaceholder,
} from './courseAuthorFlow.js';

describe('courseKeepAliveNeeded', () => {
  it('only warns a mute board when a live contested stake is open', () => {
    expect(courseKeepAliveNeeded(null)).toBe(false);
    expect(
      courseKeepAliveNeeded({
        current: {
          id: 'n',
          worldId: 'w',
          gameId: 'g',
          prompt: '今夜',
          kind: 'night_market',
          status: 'open',
          opensAt: '',
          bettingClosesAt: '',
          settlesAt: '',
          mutedHint: true,
          pool: 12,
          minStake: 12,
          myPoints: 12,
          myOptionId: 'o',
          options: [],
          winningOptionId: null,
          voidReason: null,
          transcriptHash: null,
          canon: null,
          maxAdd: 200,
          addSteps: [12, 24, 48],
          hangs: [],
          contested: true,
        },
        history: [],
      }),
    ).toBe(true);
    expect(
      courseKeepAliveNeeded({
        current: {
          id: 'n',
          worldId: 'w',
          gameId: 'g',
          prompt: '今夜',
          kind: 'night_market',
          status: 'open',
          opensAt: '',
          bettingClosesAt: '',
          settlesAt: '',
          mutedHint: true,
          pool: 12,
          minStake: 12,
          myPoints: 12,
          myOptionId: 'o',
          options: [],
          winningOptionId: null,
          voidReason: null,
          transcriptHash: null,
          canon: null,
          maxAdd: 200,
          addSteps: [12, 24, 48],
          hangs: [],
          contested: false,
        },
        history: [],
      }),
    ).toBe(false);
    expect(
      courseKeepAliveNeeded({
        current: {
          id: 'n',
          worldId: 'w',
          gameId: 'g',
          prompt: '今夜',
          kind: 'night_market',
          status: 'open',
          opensAt: '',
          bettingClosesAt: '',
          settlesAt: '',
          mutedHint: false,
          pool: 24,
          minStake: 12,
          myPoints: 12,
          myOptionId: 'o',
          options: [],
          winningOptionId: null,
          voidReason: null,
          transcriptHash: null,
          canon: null,
          maxAdd: 200,
          addSteps: [12, 24, 48],
          hangs: [],
          contested: true,
        },
        history: [],
      }),
    ).toBe(false);
    expect(
      courseKeepAliveNeeded({
        current: {
          id: 'n',
          worldId: 'w',
          gameId: 'g',
          prompt: '今夜',
          kind: 'night_market',
          status: 'settled',
          opensAt: '',
          bettingClosesAt: '',
          settlesAt: '',
          mutedHint: false,
          pool: 12,
          minStake: 12,
          myPoints: 12,
          myOptionId: 'o',
          options: [],
          winningOptionId: 'o',
          voidReason: null,
          transcriptHash: 'abcd',
          canon: '成了',
          maxAdd: 0,
          addSteps: [],
          hangs: [],
        },
        history: [],
      }),
    ).toBe(false);
  });

  it('names the board phase without jargon', () => {
    expect(coursePhaseCopyKey('open')).toBe('product.obs.course.phase.open');
    expect(coursePhaseCopyKey('closed')).toBe('product.obs.course.phase.closed');
    expect(coursePhaseCopyKey('settled')).toBe('product.obs.course.phase.settled');
    expect(coursePhaseCopyKey('voided')).toBe('product.obs.course.phase.voided');
  });

  it('names remaining time and never tells the visitor to wait for the hour', () => {
    const t = (key: string, vars?: Record<string, string | number>) => {
      if (key === 'product.obs.course.clock.betting') return `封盘还有 ${vars?.n ?? ''}`;
      if (key === 'product.obs.course.remain.hours') return `${vars?.h} 小时`;
      if (key === 'product.obs.course.clock.china') return '中国今晚 UTC+8';
      if (key === 'product.obs.course.clock.evidenceUntil') {
        return `取证到 ${vars?.day ?? ''} ${vars?.clock ?? ''}`;
      }
      if (key === 'product.obs.course.clock.day.tonight') return '今晚';
      if (key === 'product.obs.course.clock.day.tomorrow') return '明早';
      if (key === 'product.obs.course.clock.day.later') return '后天以后';
      return key;
    };
    const line = courseDeskClockLine(
      t,
      {
        status: 'open',
        bettingClosesAt: new Date(1_000_000 + 120 * 60_000).toISOString(),
        settlesAt: new Date(1_000_000 + 400 * 60_000).toISOString(),
      },
      1_000_000,
    );
    expect(line).toContain('封盘还有');
    expect(line).toContain('取证到');
    expect(line).toContain('UTC+8');
    expect(line).not.toMatch(/等到整点|wait for the hour/i);
  });

  it('names the chip and the payout so a visitor can see what the tap spends', () => {
    const t = (key: string, vars?: Record<string, string | number>) => {
      if (key === 'product.obs.course.stakeCta') return `压 ${vars?.n ?? ''} 点`;
      if (key === 'product.obs.course.ifWin') return `此刻若赢约 ${vars?.n ?? ''} 点`;
      return key;
    };
    const line = courseStakeCtaLine(t, { stake: 50, pool: 950, optionPoints: 150 });
    expect(line).toContain('压 50 点');
    expect(line).toContain('212');
    expect(line).not.toMatch(/等到整点/);

    const solo = courseStakeCtaLine(
      (key) =>
        key === 'product.obs.course.needOpponentInvite'
          ? '还差一边，你来定调'
          : key === 'product.obs.course.stakeCta'
            ? '压 12 点'
            : key,
      { stake: 12, pool: 0, optionPoints: 0 },
    );
    expect(solo).toContain('还差一边，你来定调');
    expect(solo).not.toContain('此刻若赢');
  });

  it('toasts only after the pool or status actually changes', () => {
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
    expect(courseBoardPulse(null, { current: open, history: [] })).toBeNull();
    expect(
      courseBoardPulse(
        { current: open, history: [] },
        { current: { ...open, pool: 12, contested: false }, history: [] },
      ),
    ).toBeNull();
    const opposed = courseBoardPulse(
      { current: open, history: [] },
      { current: { ...open, pool: 24, contested: true }, history: [] },
    );
    expect(opposed?.kind).toBe('opposed');
    expect(coursePulseToastKey(opposed!)).toBe('product.obs.course.toast.opposed');
  });

  it('flashes evidence hits while the board is open or closed', () => {
    const talks = [
      {
        id: '1',
        eventId: 'e',
        turnIndex: 0,
        simTime: 0,
        kind: 'dialogue',
        who: '桂花',
        text: '桂花还在客栈',
        createdAtMs: Date.now(),
      },
    ];
    const board = {
      status: 'closed',
      kind: 'custom',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      settlesAt: new Date(Date.now() + 3_600_000).toISOString(),
      options: [
        {
          id: 'a',
          key: 'a',
          label: '桂花',
          points: 12,
          share: 1,
          needles: ['桂花'],
        },
      ],
    };
    expect(evidenceHits(board, talks)).toEqual(['桂花']);
    expect(
      evidenceHits(
        { ...board, status: 'open' },
        talks,
      ),
    ).toEqual(['桂花']);
    expect(
      evidenceHits(
        { ...board, status: 'settled' },
        talks,
      ),
    ).toEqual([]);
  });

  it('ignores neutral night-market lines when previewing evidence hits', () => {
    const talks = [
      {
        id: '1',
        eventId: 'e',
        turnIndex: 0,
        simTime: 0,
        kind: 'intervene',
        who: '镇',
        text: '今夜失火',
        neutral: true,
        createdAtMs: Date.now(),
      },
    ];
    expect(
      evidenceHits(
        {
          status: 'closed',
          kind: 'night_market',
          opensAt: new Date(Date.now() - 60_000).toISOString(),
          settlesAt: new Date(Date.now() + 3_600_000).toISOString(),
          options: [
            {
              id: 'fire',
              key: 'fire',
              label: '失火',
              points: 12,
              share: 1,
              needles: ['失火'],
            },
          ],
        },
        talks,
      ),
    ).toEqual([]);
  });

  it('always teaches the play in one line and never dumps seed jargon on the desk', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'SocietyTownCourseDesk.tsx'),
      'utf8',
    );
    expect(src).toMatch(/courseActPrimaryNoteKey/);
    expect(src).toMatch(/CourseActProgressBar/);
    expect(src).toMatch(/CourseQueuedPreview/);
    expect(src).toMatch(/optionHit/);
    expect(src).toMatch(/stakePriority/);
    expect(src).toMatch(/evidenceHealth/);
    expect(src).toMatch(/courseStakedEvidenceKey/);
    expect(src).toMatch(/courseEvidenceHitPulse/);
    expect(src).toMatch(/coursePulseShouldFocusDesk/);
    expect(src).toMatch(/onPulse/);
    expect(src).toMatch(/is-flash/);
    expect(src).not.toMatch(/CourseSeedPanel|SEED_KINDS|night_market/);
  });

  it('warns when an open board stays speechless for half an hour', () => {
    const opensAt = new Date(Date.now() - 31 * 60_000).toISOString();
    expect(
      courseEvidenceQuietWarning({
        status: 'open',
        evidenceHealth: 'none',
        opensAt,
        bettingClosesAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toBe(true);
    expect(
      courseEvidenceQuietWarning({
        status: 'open',
        evidenceHealth: 'living',
        opensAt,
      }),
    ).toBe(false);
  });

  it('hints open-staked whispers before betting closes', () => {
    const t = (key: string) => key;
    expect(
      courseWhisperPlaceholder({
        course: {
          status: 'open',
          myOptionId: 'a',
          options: [{ id: 'a' }],
        },
        t,
      }),
    ).toBe('product.obs.course.whisperHint.openStaked');
  });

  it('names evidence health for the desk bar', () => {
    expect(courseEvidenceHealthKey('living')).toContain('living');
    expect(courseEvidenceHealthKey('none')).toContain('none');
    expect(courseEvidenceHealthKey(undefined)).toBeNull();
  });

  it('hints whisper placeholders from the staked side win line', () => {
    const t = (key: string, vars?: Record<string, string | number>) =>
      key === 'product.obs.course.whisperHint.staked'
        ? `side: ${vars?.hint ?? ''}`
        : key;
    const line = courseWhisperPlaceholder({
      course: {
        status: 'closed',
        myOptionId: 'a',
        options: [{ id: 'a', winHint: '窗内提到桂花' }],
      },
      t,
    });
    expect(line).toContain('桂花');
  });
});
