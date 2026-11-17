/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  coalesceSocietyFrames,
  MAX_COALESCED_FRAME_EVENTS,
  type CoalescableFrame,
} from './societyFrames';

interface Frame extends CoalescableFrame {
  readonly simTime: number;
  readonly events: ReadonlyArray<{
    id: string;
    simTime: number;
    payload?: Record<string, unknown>;
  }>;
  readonly relations?: readonly string[];
  readonly objects?: readonly string[];
  readonly report?: string | null;
}

const frame = (over: Partial<Frame>): Frame => ({
  simTime: 0,
  events: [],
  ...over,
});

const evt = (id: string, simTime: number) => ({ id, simTime });

describe('coalesceSocietyFrames', () => {
  it('passes the first frame through untouched', () => {
    const f = frame({ simTime: 3 });
    expect(coalesceSocietyFrames(null, f)).toBe(f);
  });

  it('keeps every event from a burst so no dialogue is lost', () => {
    const merged = coalesceSocietyFrames(
      frame({ simTime: 1, events: [evt('e1', 1)] }),
      frame({ simTime: 2, events: [evt('e2', 2)] }),
    );
    expect(merged.events.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(merged.simTime).toBe(2);
  });

  it('dedupes events that a reconnect replays', () => {
    const merged = coalesceSocietyFrames(
      frame({ simTime: 1, events: [evt('e1', 1)] }),
      frame({ simTime: 1, events: [evt('e1', 1), evt('e2', 2)] }),
    );
    expect(merged.events).toHaveLength(2);
  });

  it('never lets simTime go backwards on an out-of-order frame', () => {
    const merged = coalesceSocietyFrames(
      frame({ simTime: 9 }),
      frame({ simTime: 4 }),
    );
    expect(merged.simTime).toBe(9);
  });

  it('holds on to previous relations/objects/report when a frame omits them', () => {
    const merged = coalesceSocietyFrames(
      frame({ simTime: 1, relations: ['a|b'], objects: ['anvil'], report: 'r1' }),
      frame({ simTime: 2 }),
    );
    expect(merged.relations).toEqual(['a|b']);
    expect(merged.objects).toEqual(['anvil']);
    expect(merged.report).toBe('r1');
  });

  it('keeps retrievalDegraded and report.seed when the next frame omits them', () => {
    const merged = coalesceSocietyFrames(
      {
        simTime: 1,
        events: [],
        retrievalDegraded: true,
        dialogueKind: 'template',
        report: { seed: { hours: 16, dialogues: 8, gateFailed: false } },
      },
      { simTime: 2, events: [] },
    );
    expect(merged.retrievalDegraded).toBe(true);
    expect(merged.dialogueKind).toBe('template');
    expect(
      (merged.report as { seed?: { hours?: number } } | undefined)?.seed?.hours,
    ).toBe(16);
  });

  it('orders same-hour talks by talkSeq so a burst does not shuffle circles', () => {
    const merged = coalesceSocietyFrames(
      frame({
        simTime: 14,
        events: [{ id: 'c3', simTime: 14, payload: { talkSeq: 3 } }],
      }),
      frame({
        simTime: 14,
        events: [
          { id: 'c1', simTime: 14, payload: { talkSeq: 1 } },
          { id: 'c2', simTime: 14, payload: { talkSeq: 2 } },
        ],
      }),
    );
    expect(merged.events.map((e) => e.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('caps a long backlog so one flush cannot grow without bound', () => {
    let acc: Frame | null = null;
    for (let i = 0; i < 400; i += 1) {
      acc = coalesceSocietyFrames(acc, frame({ simTime: i, events: [evt(`e${i}`, i)] }));
    }
    expect(acc!.events).toHaveLength(MAX_COALESCED_FRAME_EVENTS);
    // Newest events survive the cap.
    expect(acc!.events[acc!.events.length - 1]?.id).toBe('e399');
  });
});
