import { describe, expect, it } from 'vitest';

import {
  COURSE,
  NIGHT_MARKET_COURSE_OPTIONS,
  alleyCourseOverlapsChinaDay,
  buildCustomCourseSeed,
  canAddStake,
  canWithdrawCourseStake,
  courseCanonLine,
  courseWinLine,
  courseVoidCanonLine,
  chinaWallClock,
  placesFromWorldSpec,
  scoreCourseLabelHits,
  suggestCourseFromPlaces,
  suggestCourseFromTalks,
  worldCoursePrefersNightMarket,
  nextWorldCourseSeedKind,
  courseContest,
  coursePhaseClock,
  courseSettleForceVoid,
  courseShouldSettleNow,
  courseStakeSteps,
  courseVoidReasonKey,
  decideCourseOutcome,
  judgeCourseWindow,
  matchCourseOptionKey,
  maxAdditionalStake,
  needlesFromLine,
  previewCoursePayout,
  previewCourseEvidenceHits,
  settlePariMutuel,
  talksToCourseFacts,
  beatsEligibleForCourse,
  courseBoardReachability,
  validateCourseSeedReachability,
  courseSteeringPromptBlock,
  courseSteeringWindowOpen,
  courseEvidenceHealthOf,
  courseTownReadyForSeed,
  WORLD_COURSE_SEED_ATTEMPTS,
  courseSettlementTelemetry,
} from './courseMarket.js';

describe('courseMarket', () => {
  it('keeps 镇时 / 点亮 SKUs out of the course constants', () => {
    expect(COURSE.minStake).toBe(12);
    expect(COURSE.rakeRate).toBe(0.15);
    expect(COURSE.maxPayoutMultiple).toBe(8);
    expect(COURSE.maxShareOfPool).toBe(0.2);
  });

  it('lets the first chip in, then caps one org at 20% of the pool', () => {
    expect(maxAdditionalStake(0, 0)).toBe(COURSE.firstStakeCap);
    expect(maxAdditionalStake(100, 0)).toBe(25);
    expect(canAddStake({ points: 12, poolBefore: 0, already: 0 }).ok).toBe(true);
    expect(canAddStake({ points: 11, poolBefore: 0, already: 0 }).ok).toBe(false);
    expect(canAddStake({ points: 26, poolBefore: 100, already: 0 }).reason).toBe(
      'share_cap',
    );
    expect(maxAdditionalStake(12, 0)).toBeGreaterThanOrEqual(COURSE.minStake);
    expect(canAddStake({ points: 12, poolBefore: 12, already: 0 }).ok).toBe(true);
    expect(maxAdditionalStake(12, 12)).toBe(0);
  });

  it('splits the pool after 15% rake and caps a dust-side win at 8x', () => {
    const settled = settlePariMutuel({
      winningOptionId: 'leave',
      voided: false,
      stakes: [
        { organizationId: 'a', optionId: 'leave', points: 50 },
        { organizationId: 'b', optionId: 'leave', points: 150 },
        { organizationId: 'c', optionId: 'stay', points: 800 },
      ],
    });
    expect(settled.pool).toBe(1000);
    expect(settled.rake).toBe(150);
    expect(settled.authorRake).toBe(105);
    expect(settled.platformRake).toBe(45);
    expect(settled.payouts).toEqual([
      { organizationId: 'a', points: 212, kind: 'payout' },
      { organizationId: 'b', points: 637, kind: 'payout' },
    ]);

    const dust = settlePariMutuel({
      winningOptionId: 'rare',
      voided: false,
      stakes: [
        { organizationId: 'a', optionId: 'rare', points: 12 },
        { organizationId: 'b', optionId: 'common', points: 988 },
      ],
    });
    const aPay = dust.payouts.find((row) => row.organizationId === 'a');
    expect(aPay?.points).toBe(96);
    expect(dust.leftover).toBe(754);
    expect(settled.leftover).toBe(1);
  });

  it('treats a one-sided pile as no contest', () => {
    expect(
      courseContest([{ organizationId: 'a', optionId: 'fire', points: 48 }]),
    ).toMatchObject({ sides: 1, contested: false });
    expect(
      courseContest([
        { organizationId: 'a', optionId: 'fire', points: 12 },
        { organizationId: 'b', optionId: 'harvest', points: 12 },
      ]),
    ).toMatchObject({ sides: 2, contested: true });
    expect(
      canWithdrawCourseStake({ status: 'open', contested: false, myPoints: 12 }),
    ).toBe(true);
    expect(
      canWithdrawCourseStake({ status: 'open', contested: true, myPoints: 12 }),
    ).toBe(false);
    expect(
      canWithdrawCourseStake({ status: 'closed', contested: false, myPoints: 12 }),
    ).toBe(false);

    const solo = decideCourseOutcome({
      judged: {
        muted: false,
        unclear: false,
        winningOptionId: 'fire',
        fingerprint: 'solo',
      },
      uncontested: true,
    });
    expect(solo).toMatchObject({
      voided: true,
      voidReason: 'uncontested',
      winningOptionId: null,
    });
  });

  it('settles one-sided piles only after betting ends; contests wait for settlesAt', () => {
    const openOneSide = {
      status: 'open',
      settlesAtMs: 200,
      bettingClosesAtMs: 100,
      contested: false,
    };
    expect(courseShouldSettleNow({ ...openOneSide, nowMs: 50 })).toBe(false);
    expect(courseSettleForceVoid({ ...openOneSide, sides: 1, nowMs: 50 })).toBeUndefined();
    expect(courseShouldSettleNow({ ...openOneSide, nowMs: 100 })).toBe(true);
    expect(courseSettleForceVoid({ ...openOneSide, sides: 1, nowMs: 100 })).toBe(
      'uncontested',
    );
    expect(courseSettleForceVoid({ ...openOneSide, sides: 0, nowMs: 100 })).toBe(
      'no_winner',
    );

    const closedContest = {
      status: 'closed',
      settlesAtMs: 200,
      bettingClosesAtMs: 100,
      contested: true,
    };
    expect(courseShouldSettleNow({ ...closedContest, nowMs: 150 })).toBe(false);
    expect(courseShouldSettleNow({ ...closedContest, nowMs: 200 })).toBe(true);
    expect(
      courseSettleForceVoid({ ...closedContest, sides: 2, nowMs: 200 }),
    ).toBeUndefined();

    expect(
      courseShouldSettleNow({
        status: 'settled',
        settlesAtMs: 0,
        bettingClosesAtMs: 0,
        contested: true,
        nowMs: 9_999,
      }),
    ).toBe(false);
  });

  it('refunds everyone when voided or the winning side is empty', () => {
    const voided = settlePariMutuel({
      winningOptionId: 'leave',
      voided: true,
      stakes: [{ organizationId: 'a', optionId: 'leave', points: 40 }],
    });
    expect(voided.rake).toBe(0);
    expect(voided.payouts).toEqual([
      { organizationId: 'a', points: 40, kind: 'void' },
    ]);
  });

  it('lets a paid night-market intervene settle without fake dialogue', () => {
    const fire = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options: [
        { id: 'fire', predicate: { type: 'event_needle', needles: ['失火', '火光'] } },
        { id: 'harvest', predicate: { type: 'event_needle', needles: ['丰收'] } },
      ],
      events: [
        {
          id: 'e',
          kind: 'intervene',
          agentKey: null,
          createdAtMs: 10,
          text: '马厩夜里走了水，火光照亮半条街。',
        },
      ],
    });
    expect(fire.muted).toBe(false);
    expect(fire.winningOptionId).toBe('fire');

    const spokenFire = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options: NIGHT_MARKET_COURSE_OPTIONS.map((row) => ({
        id: row.key,
        predicate: row.predicate,
      })),
      events: [
        {
          id: 'd',
          kind: 'dialogue',
          agentKey: 'lin',
          createdAtMs: 12,
          text: '马厩着火了，半条街都亮着。',
        },
      ],
    });
    expect(spokenFire.muted).toBe(false);
    expect(spokenFire.winningOptionId).toBe('fire');
  });

  it('settles a stay/leave board on the resident’s last living signal', () => {
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
    const talked = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options,
      events: [
        {
          id: 'd',
          kind: 'dialogue',
          agentKey: 'lin',
          createdAtMs: 10,
          text: '今晚风大，酒窖该加盖。',
        },
      ],
    });
    expect(talked.muted).toBe(false);
    expect(talked.winningOptionId).toBe('stay');

    const leftAfter = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options,
      events: [
        {
          id: 'd',
          kind: 'dialogue',
          agentKey: 'lin',
          createdAtMs: 10,
          text: '今晚风大，酒窖该加盖。',
        },
        {
          id: 'g',
          kind: 'dialogue',
          agentKey: 'lin',
          createdAtMs: 40,
          text: '我决定离开这座镇。',
        },
      ],
    });
    expect(leftAfter.winningOptionId).toBe('leave');

    const whispered = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options,
      events: [
        {
          id: 'w',
          kind: 'intervene',
          agentKey: null,
          createdAtMs: 20,
          text: '林老板今夜出走，铺子上了锁。',
        },
      ],
    });
    expect(whispered.winningOptionId).toBe('leave');

    const posedAway = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options,
      events: [
        {
          id: 'd',
          kind: 'dialogue',
          agentKey: 'lin',
          createdAtMs: 10,
          text: '今晚风大，酒窖该加盖。',
        },
        {
          id: 'pose-away:lin',
          kind: 'move',
          agentKey: 'lin',
          createdAtMs: 90,
          text: '镇外-北门 出镇',
        },
      ],
    });
    expect(posedAway.winningOptionId).toBe('leave');

    const emptyWalk = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options,
      events: [
        {
          id: 'g',
          kind: 'dialogue',
          agentKey: 'lin',
          createdAtMs: 40,
          text: '我决定离开这座镇。',
        },
        {
          id: 'm',
          kind: 'move',
          agentKey: 'lin',
          createdAtMs: 50,
          text: '',
        },
      ],
    });
    expect(emptyWalk.winningOptionId).toBe('leave');

    const walkedHome = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options,
      events: [
        {
          id: 'g',
          kind: 'dialogue',
          agentKey: 'lin',
          createdAtMs: 40,
          text: '我决定离开这座镇。',
        },
        {
          id: 'm',
          kind: 'move',
          agentKey: 'lin',
          createdAtMs: 50,
          text: 'inn_square',
        },
      ],
    });
    expect(walkedHome.winningOptionId).toBe('stay');

    const legacyNeedles = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options: [
        {
          id: 'stay',
          predicate: {
            type: 'event_needle',
            agentKey: 'lin',
            needles: ['留下', '还在'],
          },
        },
        {
          id: 'leave',
          predicate: {
            type: 'event_needle',
            agentKey: 'lin',
            needles: ['出走', '离开'],
          },
        },
      ],
      events: [
        {
          id: 'd',
          kind: 'dialogue',
          agentKey: 'lin',
          createdAtMs: 10,
          text: '酒窖该加盖。',
        },
      ],
    });
    expect(legacyNeedles.winningOptionId).toBe('stay');
  });

  it('voids a mute window and a tie, and fingerprints the transcript', () => {
    const mute = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options: [
        { id: 'fire', predicate: { type: 'event_needle', needles: ['失火'] } },
      ],
      events: [
        {
          id: '1',
          kind: 'move',
          agentKey: 'ada',
          createdAtMs: 10,
          text: '走路',
        },
      ],
    });
    expect(mute.muted).toBe(true);
    expect(mute.winningOptionId).toBeNull();

    const fire = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options: [
        { id: 'fire', predicate: { type: 'event_needle', needles: ['失火'] } },
        { id: 'harvest', predicate: { type: 'event_needle', needles: ['丰收'] } },
      ],
      events: [
        {
          id: 'd',
          kind: 'dialogue',
          agentKey: 'ada',
          createdAtMs: 10,
          text: '马厩失火了',
        },
      ],
    });
    expect(fire.winningOptionId).toBe('fire');
    expect(fire.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(
      courseCanonLine({
        locale: 'zh-CN',
        prompt: '今夜哪件事会成为正史',
        winningLabel: '失火',
      }),
    ).toContain('失火成了');
    expect(
      courseVoidCanonLine({
        locale: 'en',
        prompt: 'What becomes canon in this town tonight',
      }),
    ).toContain('voided');
    expect(
      worldCoursePrefersNightMarket({
        space: { regions: [{ id: 'inn_lane', name: '客栈巷' }] },
      }),
    ).toBe(true);
    expect(
      worldCoursePrefersNightMarket({
        space: { regions: [{ id: 'inn', name: '学堂客栈' }] },
      }),
    ).toBe(false);
    expect(
      worldCoursePrefersNightMarket({
        space: { regions: [{ id: 'bridge', name: '舰桥' }] },
      }),
    ).toBe(false);
    expect(
      nextWorldCourseSeedKind({
        space: { regions: [{ id: 'inn', name: '学堂客栈' }] },
      }),
    ).toBe('binary');
    expect(
      nextWorldCourseSeedKind({
        space: { regions: [{ id: 'inn_lane', name: '客栈巷' }] },
      }),
    ).toBe('night_market');
    expect(
      nextWorldCourseSeedKind({
        space: { regions: [{ id: 'barn', name: '粮仓' }] },
      }),
    ).toBe('night_market');
    expect(needlesFromLine('林老板今夜还在镇上')).toContain('林老板');
    expect(courseStakeSteps(20)).toEqual([12]);
    expect(courseStakeSteps(48)).toEqual([12, 24, 48]);
  });

  it('ignores template dialogue so a mute town cannot settle on padded lines', () => {
    const judged = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options: [
        { id: 'fire', predicate: { type: 'event_needle', needles: ['失火'] } },
      ],
      events: [
        {
          id: 't',
          kind: 'dialogue',
          agentKey: 'ada',
          createdAtMs: 10,
          text: '马厩失火了',
          degraded: true,
        },
      ],
    });
    expect(judged.muted).toBe(true);
    expect(judged.winningOptionId).toBeNull();
  });

  it('lets windowed memories break a tie without counting as living talk', () => {
    const judged = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options: [
        { id: 'leave', predicate: { type: 'event_needle', needles: ['离开'] } },
        { id: 'stay', predicate: { type: 'event_needle', needles: ['留下'] } },
      ],
      events: [
        {
          id: 'a',
          kind: 'dialogue',
          agentKey: 'lin',
          createdAtMs: 10,
          text: '有人说要离开，也有人说留下。',
        },
        {
          id: 'b',
          kind: 'dialogue',
          agentKey: 'ada',
          createdAtMs: 12,
          text: '有人说要离开，也有人说留下。',
        },
        {
          id: 'm',
          kind: 'memory',
          agentKey: 'lin',
          createdAtMs: 20,
          text: '他决定离开这座镇',
        },
      ],
    });
    expect(judged.muted).toBe(false);
    expect(judged.winningOptionId).toBe('leave');

    const livingHolds = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options: [
        { id: 'fire', predicate: { type: 'event_needle', needles: ['失火'] } },
        { id: 'harvest', predicate: { type: 'event_needle', needles: ['丰收'] } },
      ],
      events: [
        {
          id: 'e',
          kind: 'intervene',
          agentKey: null,
          createdAtMs: 10,
          text: '马厩失火了',
        },
        {
          id: 'm',
          kind: 'memory',
          agentKey: 'ada',
          createdAtMs: 11,
          text: '粮仓丰收了',
        },
      ],
    });
    expect(livingHolds.winningOptionId).toBe('fire');

    const rumorOnly = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options: NIGHT_MARKET_COURSE_OPTIONS.map((row) => ({
        id: row.key,
        predicate: row.predicate,
      })),
      events: [
        {
          id: 'buy',
          kind: 'intervene',
          agentKey: null,
          createdAtMs: 10,
          text: '马厩夜里走了水，火光照亮半条街。',
          neutral: true,
        },
        {
          id: 'm',
          kind: 'memory',
          agentKey: 'ada',
          createdAtMs: 11,
          text: '马厩夜里走了水，火光照亮半条街。',
        },
      ],
    });
    expect(rumorOnly.muted).toBe(false);
    expect(rumorOnly.winningOptionId).toBeNull();
    expect(rumorOnly.unclear).toBe(true);

    const townTalked = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options: NIGHT_MARKET_COURSE_OPTIONS.map((row) => ({
        id: row.key,
        predicate: row.predicate,
      })),
      events: [
        {
          id: 'buy',
          kind: 'intervene',
          agentKey: null,
          createdAtMs: 10,
          text: '马厩夜里走了水，火光照亮半条街。',
          neutral: true,
        },
        {
          id: 'd',
          kind: 'dialogue',
          agentKey: 'lin',
          createdAtMs: 40,
          text: '马厩着火了，半条街都亮着。',
        },
      ],
    });
    expect(townTalked.winningOptionId).toBe('fire');
  });

  it('voids pause-when-mute and takedown, and keeps China-tonight overlap honest', () => {
    const muted = decideCourseOutcome({
      judged: {
        muted: true,
        unclear: false,
        winningOptionId: null,
        fingerprint: 'aaaa',
      },
      clockPaused: true,
    });
    expect(muted).toMatchObject({ voided: true, voidReason: 'paused' });

    const pausedWin = decideCourseOutcome({
      judged: {
        muted: false,
        unclear: false,
        winningOptionId: 'fire',
        fingerprint: 'aaab',
      },
      clockPaused: true,
    });
    expect(pausedWin).toMatchObject({
      voided: true,
      voidReason: 'paused',
      winningOptionId: null,
    });

    const taken = decideCourseOutcome({
      judged: {
        muted: false,
        unclear: false,
        winningOptionId: 'fire',
        fingerprint: 'bbbb',
      },
      takenDown: true,
    });
    expect(taken).toMatchObject({
      voided: true,
      voidReason: 'takedown',
      winningOptionId: null,
    });

    const win = decideCourseOutcome({
      judged: {
        muted: false,
        unclear: false,
        winningOptionId: 'fire',
        fingerprint: 'cccc',
      },
    });
    expect(win).toMatchObject({ voided: false, winningOptionId: 'fire' });

    const dayStart = Date.parse('2026-08-21T16:00:00.000Z');
    expect(
      alleyCourseOverlapsChinaDay({
        opensAtMs: dayStart + 60_000,
        settlesAtMs: dayStart + 8 * 3600_000,
        dayStartMs: dayStart,
      }),
    ).toBe(true);
    expect(
      alleyCourseOverlapsChinaDay({
        opensAtMs: dayStart - 48 * 3600_000,
        settlesAtMs: dayStart - 40 * 3600_000,
        dayStartMs: dayStart,
      }),
    ).toBe(false);
  });

  it('shows remaining minutes on the three clocks and never invents an hour mark', () => {
    const now = 1_000_000;
    const betting = coursePhaseClock({
      status: 'open',
      bettingClosesAtMs: now + 90 * 60_000,
      settlesAtMs: now + 300 * 60_000,
      nowMs: now,
    });
    expect(betting.phase).toBe('betting');
    expect(betting.remainMinutes).toBe(90);

    const evidence = coursePhaseClock({
      status: 'closed',
      bettingClosesAtMs: now - 10_000,
      settlesAtMs: now + 45 * 60_000,
      nowMs: now,
    });
    expect(evidence.phase).toBe('evidence');
    expect(evidence.remainMinutes).toBe(45);

    expect(
      coursePhaseClock({
        status: 'closed',
        bettingClosesAtMs: now - 10_000,
        settlesAtMs: now - 1,
        nowMs: now,
      }).phase,
    ).toBe('due');
    expect(courseVoidReasonKey('muted')).toBe('product.obs.course.void.muted');
    expect(courseVoidReasonKey('weird')).toBe('product.obs.course.voided');
    expect(matchCourseOptionKey('fire', ['harvest', 'fire', 'guest'])).toBe('fire');
    expect(matchCourseOptionKey('unknown', ['harvest', 'fire'])).toBeNull();

    const preview = previewCoursePayout({
      pool: 950,
      optionPoints: 150,
      stake: 50,
    });
    expect(preview).toMatchObject({ payout: 212 });
    expect(
      previewCoursePayout({ pool: 0, optionPoints: 0, stake: 12 })?.payout,
    ).toBe(11);
    expect(buildCustomCourseSeed('今夜谁走', ['留下', '出走'])).toMatchObject({
      kind: 'custom',
      prompt: '今夜谁走',
    });
    expect(buildCustomCourseSeed('', ['只'])).toBeNull();
  });

  it('explains how a side wins and suggests the next board from living talks', () => {
    expect(
      courseWinLine({
        locale: 'zh-CN',
        predicate: { type: 'agent_presence', present: true, name: '桂花' },
      }),
    ).toContain('桂花');
    expect(
      courseWinLine({
        locale: 'zh-CN',
        predicate: { type: 'event_needle', needles: ['失火'] },
      }),
    ).toContain('失火');
    expect(
      placesFromWorldSpec({
        space: { regions: [{ id: 'inn', name: '学堂客栈' }] },
      }),
    ).toEqual([{ id: 'inn', name: '学堂客栈' }]);
    const suggested = suggestCourseFromTalks(
      [
        { who: '桂花', text: '我还在客栈门口', kind: 'dialogue' },
        { who: '林老板', text: '粮仓今晚上锁', kind: 'dialogue' },
      ],
      'zh-CN',
    );
    expect(suggested?.options.map((row) => row.label)).toEqual(['桂花', '林老板']);
    expect(
      scoreCourseLabelHits(
        [{ id: 'a', label: '桂花', needles: ['桂花'] }],
        ['桂花还在客栈'],
      )[0]?.hits,
    ).toBe(1);
  });

  it('names China wall-clock day buckets in UTC+8', () => {
    const now = Date.parse('2026-08-22T10:00:00.000Z');
    expect(chinaWallClock('2026-08-22T14:00:00.000Z', now)).toMatchObject({
      clock: '22:00',
      day: 'tonight',
    });
    expect(chinaWallClock('2026-08-23T02:00:00.000Z', now)).toMatchObject({
      clock: '10:00',
      day: 'tomorrow',
    });
    expect(chinaWallClock('2026-08-24T02:00:00.000Z', now)?.day).toBe('later');
    expect(chinaWallClock('not-a-date', now)).toBeNull();
  });

  it('seeds a place board from 2–4 named places and refuses a fake negative', () => {
    expect(
      suggestCourseFromPlaces([{ id: 'inn', name: '学堂客栈' }], 'zh-CN'),
    ).toBeNull();
    const two = suggestCourseFromPlaces(
      [
        { id: 'inn', name: '学堂客栈' },
        { id: 'yard', name: '操场' },
        { id: 'lab', name: '实验室' },
      ],
      'zh-CN',
    );
    expect(two?.options.map((row) => row.label)).toEqual([
      '学堂客栈',
      '操场',
      '实验室',
    ]);
    expect(two?.options[0]?.needles).toContain('学堂客栈');
    expect(two?.options.map((row) => row.label).join(' ')).not.toMatch(/没提到/);
  });

  it('previews evidence hits with the same matcher settlement uses', () => {
    const now = Date.now();
    const preview = previewCourseEvidenceHits({
      boardKind: 'custom',
      windowStartMs: now - 60_000,
      windowEndMs: now + 3_600_000,
      options: [
        { id: 'a', label: '失火', needles: ['失火'] },
        { id: 'b', label: '丰收', needles: ['丰收'] },
      ],
      talks: [
        {
          id: 'e1',
          kind: 'dialogue',
          text: '马厩失火了',
          createdAtMs: now,
        },
      ],
    });
    expect(preview.find((row) => row.optionId === 'a')).toMatchObject({
      hits: 1,
      leading: true,
    });
    expect(preview.find((row) => row.optionId === 'b')?.hits).toBe(0);
  });

  it('previews binary presence boards from the last living signal', () => {
    const now = Date.now();
    const preview = previewCourseEvidenceHits({
      boardKind: 'binary',
      windowStartMs: now - 60_000,
      windowEndMs: now + 3_600_000,
      options: [
        {
          id: 'stay',
          label: '还在',
          predicateType: 'agent_presence',
          agentKey: 'guihua',
          agentName: '桂花',
          present: true,
        },
        {
          id: 'leave',
          label: '离开',
          predicateType: 'agent_presence',
          agentKey: 'guihua',
          agentName: '桂花',
          present: false,
        },
      ],
      talks: [
        {
          id: 'e1',
          kind: 'dialogue',
          text: '桂花还在客栈',
          who: '桂花',
          agentId: 'guihua',
          createdAtMs: now,
        },
      ],
    });
    expect(preview.find((row) => row.optionId === 'stay')).toMatchObject({
      leading: true,
    });
  });

  it('treats a move to an away region as leave after the resident spoke', () => {
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
    const movedAway = judgeCourseWindow({
      windowStartMs: 0,
      windowEndMs: 100,
      options,
      events: [
        {
          id: 'd',
          kind: 'dialogue',
          agentKey: 'lin',
          createdAtMs: 10,
          text: '酒还在温着。',
        },
        {
          id: 'm',
          kind: 'move',
          agentKey: 'lin',
          createdAtMs: 50,
          text: '镇外-北门 出镇',
        },
      ],
    });
    expect(movedAway.muted).toBe(false);
    expect(movedAway.winningOptionId).toBe('leave');
    const preview = previewCourseEvidenceHits({
      boardKind: 'binary',
      options: options.map((row) => ({
        id: row.id,
        label: row.id,
        predicateType: row.predicate.type,
        agentKey: row.predicate.agentKey,
        agentName: row.predicate.name,
        present: row.predicate.present,
      })),
      talks: [
        {
          id: 'd',
          kind: 'dialogue',
          text: '酒还在温着。',
          agentKey: 'lin',
          createdAtMs: 10,
        },
        {
          id: 'm',
          kind: 'move',
          text: '镇外-北门 出镇',
          agentKey: 'lin',
          createdAtMs: 50,
        },
      ],
      windowStartMs: 0,
      windowEndMs: 100,
    });
    expect(preview.find((row) => row.optionId === 'leave')?.leading).toBe(true);
  });

  it('gates beats seeding on town voice already carrying beat needles', () => {
    const spec = {
      narrative: {
        beats: [{ text: '桂花还在客栈' }, { text: '驿站还亮着' }],
      },
    };
    expect(beatsEligibleForCourse(spec, [])).toBe(false);
    expect(
      beatsEligibleForCourse(spec, [{ text: '桂花还在客栈', kind: 'dialogue' }]),
    ).toBe(true);
    expect(
      beatsEligibleForCourse(
        {
          narrative: {
            beats: [{ text: '桂花还在客栈' }, { text: '驿站还亮着' }],
          },
          presentation: { openingRumor: '桂花还在客栈' },
        },
        [],
      ),
    ).toBe(true);
  });

  it('scores board reachability from seed kind and recent talk haystack', () => {
    expect(
      courseBoardReachability({
        seedKind: 'talks',
        options: [{ needles: ['桂花'] }],
        recentTalks: [],
      }),
    ).toBe('high');
    expect(
      validateCourseSeedReachability({
        seedPick: 'custom',
        options: [{ label: '桂花', needles: ['桂花'] }],
        recentTalks: [{ text: '桂花还在', kind: 'dialogue' }],
      }),
    ).toMatchObject({ ok: true, reachability: 'medium' });
    expect(
      validateCourseSeedReachability({
        seedPick: 'custom',
        options: [{ label: '失火', needles: ['失火'] }],
        recentTalks: [{ text: '天气不错', kind: 'dialogue' }],
      }),
    ).toMatchObject({ ok: false, reachability: 'low' });
  });

  it('builds evidence-phase steering without exposing needles', () => {
    const block = courseSteeringPromptBlock(
      { prompt: '桂花今夜还在吗', labels: ['还在', '离开'], phase: 'evidence' },
      false,
    );
    expect(block).toContain('桂花今夜还在吗');
    expect(block).toContain('还在');
    expect(block).not.toContain('needle');
  });

  it('opens steering only after betting closes while the board is live', () => {
    const bettingClosesAtMs = 1_000;
    expect(
      courseSteeringWindowOpen({
        status: 'open',
        bettingClosesAtMs,
        nowMs: bettingClosesAtMs - 1,
      }),
    ).toBe(false);
    expect(
      courseSteeringWindowOpen({
        status: 'open',
        bettingClosesAtMs,
        nowMs: bettingClosesAtMs,
      }),
    ).toBe(true);
    expect(
      courseSteeringWindowOpen({
        status: 'closed',
        bettingClosesAtMs,
        nowMs: bettingClosesAtMs + 60_000,
      }),
    ).toBe(true);
    expect(
      courseSteeringWindowOpen({
        status: 'settled',
        bettingClosesAtMs,
        nowMs: bettingClosesAtMs + 60_000,
      }),
    ).toBe(false);
  });

  it('maps living evidence to health labels', () => {
    expect(
      courseEvidenceHealthOf({ hasLivingEvidence: true, mutedHint: false }),
    ).toBe('living');
    expect(
      courseEvidenceHealthOf({ hasLivingEvidence: false, mutedHint: true }),
    ).toBe('muted');
    expect(
      courseEvidenceHealthOf({ hasLivingEvidence: false, mutedHint: false }),
    ).toBe('none');
  });

  it('blocks auto-seed when the lamp is out or nobody is watching', () => {
    const lit = Date.now() + 60_000;
    expect(
      courseTownReadyForSeed({
        lightUntilMs: lit,
        heartbeatUntil: new Date(Date.now() + 60_000),
      }),
    ).toBe(true);
    expect(
      courseTownReadyForSeed({
        lightUntilMs: Date.now() - 1,
        heartbeatUntil: new Date(Date.now() + 60_000),
      }),
    ).toBe(false);
    expect(
      courseTownReadyForSeed({
        lightUntilMs: lit,
        heartbeatUntil: new Date(Date.now() - 1),
      }),
    ).toBe(false);
    expect(WORLD_COURSE_SEED_ATTEMPTS[0]).toBe('talks');
    expect(
      courseTownReadyForSeed({
        lightUntilMs: null,
        heartbeatUntil: new Date(Date.now() + 60_000),
        openWorld: true,
      }),
    ).toBe(true);
  });

  it('maps move events into course facts for live preview', () => {
    const facts = talksToCourseFacts([
      {
        id: 'm',
        kind: 'move',
        text: '镇外-北门 出镇',
        agentKey: 'lin',
        createdAtMs: 50,
      },
    ]);
    expect(facts[0]).toMatchObject({
      kind: 'move',
      agentKey: 'lin',
      text: '镇外-北门 出镇',
    });
  });

  it('formats settlement telemetry for observability logs', () => {
    const row = courseSettlementTelemetry({
      nodeId: 'n1',
      worldId: 'w1',
      seedKind: 'talks',
      pool: 48,
      contested: true,
      judged: { muted: false, unclear: false, winningOptionId: 'a' },
      outcome: { voided: false, voidReason: null, winningOptionId: 'a' },
    });
    expect(row).toMatchObject({
      seedKind: 'talks',
      voided: false,
      muted: false,
      winningOptionId: 'a',
    });
    const voided = courseSettlementTelemetry({
      nodeId: 'n2',
      worldId: 'w1',
      seedKind: 'custom',
      pool: 12,
      contested: true,
      judged: { muted: true, unclear: false, winningOptionId: null },
      outcome: { voided: true, voidReason: 'muted', winningOptionId: null },
    });
    expect(voided).toMatchObject({ voidReason: 'muted', muted: true });
  });
});
