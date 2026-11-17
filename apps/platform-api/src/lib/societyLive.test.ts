/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createSocietyTownWorld } from '@opengame/world-spec';
import {
  annotateAgentsWithAreas,
  slimSocietyEventPayload,
  stampSocietyPlansFromSpec,
  mergePinnedSocietyEvents,
  objectSnapshotFromSpec,
  societyClockMeta,
  societySeedHours,
} from './societyLive.js';

describe('societyLive pose annotations', () => {
  it('keeps goalPlace and locationName when slimming events', () => {
    const action = slimSocietyEventPayload('action', {
      regionId: 'town_square',
      x: 3,
      y: 4,
      activity: '去喷泉',
      goalX: 8,
      goalY: 5,
      goalPlace: '喷泉广场',
      goalReason: '饿了去炉边',
      drive: 'hunger',
    });
    expect(action['goalPlace']).toBe('喷泉广场');
    expect(action['goalReason']).toBe('饿了去炉边');
    expect(action['drive']).toBe('hunger');
    expect(action['goalX']).toBe(8);
    expect(action['goalY']).toBe(5);

    const talk = slimSocietyEventPayload('dialogue', {
      with: 'b',
      participants: ['a', 'b', 'c'],
      degraded: false,
      talkSeq: 4,
      circleIndex: 2,
      turns: [{ speakerName: '甲', text: '今晚广场见' }],
    });
    expect(talk['participants']).toEqual(['a', 'b', 'c']);
    expect(talk['degraded']).toBe(false);
    expect(talk['talkSeq']).toBe(4);
    expect(talk['circleIndex']).toBe(2);

    const paid = slimSocietyEventPayload('intervene', {
      kind: 'whisper',
      with: 'visitor',
      adopt: true,
      paid: true,
      town: false,
      text: '认养林嫂',
    });
    expect(paid['adopt']).toBe(true);
    expect(paid['paid']).toBe(true);
    expect(paid['with']).toBe('visitor');

    const plan = slimSocietyEventPayload('plan', {
      dayIndex: 0,
      replan: true,
      reason: '烤炉熄了，改去别处',
      objectId: 'obj_oven',
      segments: [
        {
          startHour: 8,
          endHour: 12,
          activity: '烤面包',
          locationId: 'obj_oven',
          locationName: '烤炉前',
        },
      ],
    });
    expect(plan['replan']).toBe(true);
    expect(plan['reason']).toBe('烤炉熄了，改去别处');
    const segs = plan['segments'] as Array<Record<string, unknown>>;
    expect(segs[0]?.['locationName']).toBe('烤炉前');
  });

  it('stamps area names and latest goals onto event-GET agents', () => {
    const world = createSocietyTownWorld({ title: 'Annotate' });
    const start = world.space.startRegionId;
    const region = world.space.regions.find((r) => r.id === start) ??
      world.space.regions[0]!;
    const annotated = annotateAgentsWithAreas(
      world,
      [
        {
          id: 'n1',
          regionId: region.id,
          x: 4,
          y: 4,
        },
      ],
      [
        {
          kind: 'action',
          agentId: 'n1',
          simTime: 11,
          payload: { goalPlace: '喷泉广场', goalX: 6, goalY: 3 },
        },
      ],
    );
    expect(annotated[0]?.areaId || annotated[0]?.areaName).toBeTruthy();
    expect(annotated[0]?.goalPlace).toBe('喷泉广场');
    expect(annotated[0]?.goalX).toBe(6);
    expect(annotated[0]?.goalY).toBe(3);
    expect(annotated[0]?.regionName).toBeTruthy();
  });

  it('stamps Spec place names onto inspector day plans', () => {
    const world = createSocietyTownWorld({ title: 'StampPlans' });
    const obj = world.space.areas
      ?.flatMap((a) => a.objects ?? [])
      .find((o) => o.id && o.name);
    expect(obj).toBeTruthy();
    const stamped = stampSocietyPlansFromSpec(world, [
      {
        dayIndex: 0,
        segments: [
          {
            startHour: 8,
            endHour: 12,
            activity: '干活',
            locationId: obj!.id,
          },
        ],
      },
    ]);
    const segs = stamped[0]?.segments as Array<{ locationName?: string }>;
    expect(segs[0]?.locationName).toBe(obj!.name);
  });

  it('stamps region names when a plan stores a region id', () => {
    const world = createSocietyTownWorld({ title: 'StampRegion' });
    const region = world.space.regions[0]!;
    const stamped = stampSocietyPlansFromSpec(world, [
      {
        dayIndex: 0,
        segments: [
          {
            startHour: 8,
            endHour: 12,
            activity: '闲逛',
            locationId: region.id,
          },
        ],
      },
    ]);
    const segs = stamped[0]?.segments as Array<{ locationName?: string }>;
    expect(segs[0]?.locationName).toBe(region.name);
  });

  it('does not let older observe events overwrite a persisted object tip', () => {
    const world = createSocietyTownWorld({ title: 'ObjectTip' });
    const obj = world.space.areas
      ?.flatMap((a) => a.objects ?? [])
      .find((o) => o.id && o.name);
    expect(obj).toBeTruthy();
    const snap = objectSnapshotFromSpec(
      world,
      [
        {
          kind: 'observe',
          simTime: 4,
          payload: { objectId: obj!.id, state: '热着' },
        },
      ],
      { simTime: 12, objects: [{ id: obj!.id, state: '熄了' }] },
    );
    const hit = snap.find((o) => o.id === obj!.id);
    expect(hit?.state).toBe('熄了');
  });
});

describe('mergePinnedSocietyEvents', () => {
  it('keeps early rumors inside a last-N walk window', () => {
    const recent = [
      { id: 'm1', kind: 'move', simTime: 10 },
      { id: 'm2', kind: 'action', simTime: 11 },
      { id: 'm3', kind: 'move', simTime: 12 },
    ];
    const extra = [
      { id: 'i1', kind: 'intervene', simTime: 1 },
      { id: 'd1', kind: 'dialogue', simTime: 2 },
      { id: 'm1', kind: 'move', simTime: 10 },
    ];
    const merged = mergePinnedSocietyEvents(recent, extra);
    expect(merged.map((e) => e.id)).toEqual(['i1', 'd1', 'm1', 'm2', 'm3']);
    expect(merged.filter((e) => e.kind === 'intervene')).toHaveLength(1);
  });

  it('orders same-hour community talks by talkSeq', () => {
    const merged = mergePinnedSocietyEvents(
      [
        { id: 'c3', kind: 'dialogue', simTime: 14, payload: { talkSeq: 3 } },
        { id: 'c1', kind: 'dialogue', simTime: 14, payload: { talkSeq: 1 } },
      ],
      [{ id: 'c2', kind: 'dialogue', simTime: 14, payload: { talkSeq: 2 } }],
    );
    expect(merged.map((e) => e.id)).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('societyLive town-wide rumor speaker', () => {
  it('is not always 全镇 when copyAscii', async () => {
    const { townWideSpeaker } = await import('@opengame/world-agents');
    expect(townWideSpeaker({ ascii: true, packId: 'society.crew' })).toBe(
      'Whole crew',
    );
    expect(townWideSpeaker({ ascii: true, packId: 'society.crew' })).not.toBe(
      '全镇',
    );
    expect(townWideSpeaker({ ascii: true, packId: 'society.cloister' })).toBe(
      'House',
    );
    expect(townWideSpeaker({ ascii: true })).toBe('Town');
    expect(townWideSpeaker({ ascii: false })).toBe('全镇');
  });
});

describe('societyClockMeta', () => {
  it('marks generate-busy as muted, not llm-ok', () => {
    const meta = societyClockMeta({
      llmConfigured: true,
      useLlm: true,
      generateBusy: true,
      events: [],
    });
    expect(meta.llm).toBe(false);
    expect(meta.skipReason).toBe('generate');
    expect(meta.talksMuted).toBe(true);
  });

  it('labels degraded dialogue as template, not a parse failure', () => {
    const meta = societyClockMeta({
      llmConfigured: true,
      useLlm: false,
      events: [
        {
          id: 'd1',
          simTime: 8,
          kind: 'dialogue',
          payload: { degraded: true },
        },
      ],
    });
    expect(meta.dialogueKind).toBe('template');
    expect(meta.degraded).toBe(true);
    expect(meta.skipReason).toBe('budget');
    expect(meta.retrievalDegraded).toBe(false);
  });

  it('keeps a lease mute distinct from the per-beat budget', () => {
    const meta = societyClockMeta({
      llmConfigured: true,
      useLlm: true,
      muteReason: 'no_permit',
      events: [],
    });
    expect(meta.llm).toBe(false);
    expect(meta.skipReason).toBe('no_permit');
    expect(meta.talksMuted).toBe(true);
  });

  it('surfaces hash-fallback retrieval on the live clock', () => {
    const meta = societyClockMeta({
      llmConfigured: true,
      useLlm: true,
      events: [],
      retrievalDegraded: true,
    });
    expect(meta.retrievalDegraded).toBe(true);
    expect(meta.llm).toBe(true);
  });
});

describe('paidTraceStamp', () => {
  it('is stable for the same hour and text so retries upsert', async () => {
    const { paidTraceStamp } = await import('./societyLive.js');
    expect(paidTraceStamp('夜市加一场灯会', 16.2)).toBe(
      paidTraceStamp('夜市加一场灯会', 16.8),
    );
    expect(paidTraceStamp('夜市加一场灯会', 16)).not.toBe(
      paidTraceStamp('码头加班', 16),
    );
    expect(paidTraceStamp('夜市加一场灯会', 16)).not.toBe(
      paidTraceStamp('夜市加一场灯会', 17),
    );
  });
});

describe('societySeedHours', () => {
  it('defaults to a 16h China day, not a 6h cap', () => {
    const prev = process.env['PLATFORM_SOCIETY_SEED_HOURS'];
    delete process.env['PLATFORM_SOCIETY_SEED_HOURS'];
    try {
      expect(societySeedHours()).toBe(16);
      process.env['PLATFORM_SOCIETY_SEED_HOURS'] = '24';
      expect(societySeedHours()).toBe(24);
    } finally {
      if (prev === undefined) delete process.env['PLATFORM_SOCIETY_SEED_HOURS'];
      else process.env['PLATFORM_SOCIETY_SEED_HOURS'] = prev;
    }
  });
});
