/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createTalkScheduler, laneForParticipants } from './talkScheduler.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('talkScheduler', () => {
  it('holds a second world until a parallel slot frees', async () => {
    const started: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sched = createTalkScheduler({ cap: () => 1 });
    sched.enqueue('w1', async () => {
      started.push('w1');
      await firstGate;
    });
    sched.enqueue('w2', async () => {
      started.push('w2');
    });
    await wait(20);
    expect(sched.isBusy('w1')).toBe(true);
    expect(started).toEqual(['w1']);
    releaseFirst();
    await wait(40);
    expect(started).toEqual(['w1', 'w2']);
    expect(sched.isBusy('w1')).toBe(false);
    expect(sched.isBusy('w2')).toBe(false);
  });

  it('serializes two jobs on the same world', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sched = createTalkScheduler({ cap: () => 3 });
    sched.enqueue('w', async () => {
      order.push('a');
      await firstGate;
      order.push('a-done');
    });
    sched.enqueue('w', async () => {
      order.push('b');
    });
    await wait(20);
    expect(order).toEqual(['a']);
    expect(sched.isBusy('w')).toBe(true);
    releaseFirst();
    await wait(40);
    expect(order).toEqual(['a', 'a-done', 'b']);
    expect(sched.isBusy('w')).toBe(false);
  });

  it('runs different lanes of one world in parallel', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sched = createTalkScheduler({ cap: () => 3 });
    sched.enqueue(
      'w',
      async () => {
        order.push('ada-bo');
        await firstGate;
        order.push('ada-bo-done');
      },
      { lane: laneForParticipants(['ada', 'bo']) },
    );
    sched.enqueue(
      'w',
      async () => {
        order.push('cai-dee');
      },
      { lane: laneForParticipants(['cai', 'dee']) },
    );
    await wait(20);
    // The second pair must not wait for the first pair's model call.
    expect(order).toEqual(['ada-bo', 'cai-dee']);
    expect(sched.inflight('w')).toBe(1);
    releaseFirst();
    await wait(40);
    expect(order).toEqual(['ada-bo', 'cai-dee', 'ada-bo-done']);
    expect(sched.inflight('w')).toBe(0);
  });

  it('keeps the same participants in order regardless of listed order', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sched = createTalkScheduler({ cap: () => 3 });
    sched.enqueue(
      'w',
      async () => {
        order.push('first');
        await firstGate;
      },
      { lane: laneForParticipants(['ada', 'bo']) },
    );
    sched.enqueue(
      'w',
      async () => {
        order.push('second');
      },
      { lane: laneForParticipants(['bo', 'ada']) },
    );
    await wait(20);
    expect(order).toEqual(['first']);
    releaseFirst();
    await wait(40);
    expect(order).toEqual(['first', 'second']);
  });
});

describe('laneForParticipants', () => {
  it('is order- and duplicate-insensitive', () => {
    expect(laneForParticipants(['b', 'a'])).toBe(laneForParticipants(['a', 'b']));
    expect(laneForParticipants(['a', 'a', 'b'])).toBe('a,b');
  });
});
