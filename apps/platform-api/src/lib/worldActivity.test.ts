/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  headlineFromPayload,
  isUsableHeadline,
  pickActivityFeed,
  type WorldActivityItem,
} from './worldActivity.js';

describe('isUsableHeadline', () => {
  it('keeps a spoken line', () => {
    expect(isUsableHeadline('阿禾，炭火我盯着，你放心把就是。')).toBe(true);
  });

  it('drops census and occupancy recitals', () => {
    expect(isUsableHeadline('位于竹棚闲逛')).toBe(false);
    expect(isUsableHeadline('census of the square')).toBe(false);
  });

  it('drops empty crumbs', () => {
    expect(isUsableHeadline('  嗯  ')).toBe(false);
  });
});

describe('headlineFromPayload', () => {
  it('uses the first spoken turn of a dialogue', () => {
    const hit = headlineFromPayload(
      'dialogue',
      {
        turns: [
          { speakerName: '织娘', text: '阿禾那边人已凑齐，咱们快去竹棚！' },
          { speakerName: '林嫂', text: '走。' },
        ],
      },
      18,
    );
    expect(hit).toEqual({
      kind: 'talk',
      line: '阿禾那边人已凑齐，咱们快去竹棚！',
      speakerName: '织娘',
      simTime: 18,
    });
  });

  it('marks a town-wide rumor from a spoken turn', () => {
    const hit = headlineFromPayload(
      'dialogue',
      {
        kind: 'rumor',
        turns: [{ speakerName: '阿禾', text: '镇上在传：井水见底了' }],
      },
      20,
    );
    expect(hit?.kind).toBe('rumor');
    expect(hit?.line).toContain('井水');
  });

  it('drops stock dialogue summaries without spoken turns', () => {
    expect(
      headlineFromPayload(
        'dialogue',
        { summary: '阿禾、阿秀 擦肩而过' },
        12,
      ),
    ).toBeNull();
  });

  it('treats an intervene as a whisper', () => {
    const hit = headlineFromPayload(
      'intervene',
      { text: '告诉铁匠井水被下了毒' },
      12,
    );
    expect(hit).toEqual({
      kind: 'whisper',
      line: '告诉铁匠井水被下了毒',
      simTime: 12,
    });
  });

  it('skips degraded beats', () => {
    expect(
      headlineFromPayload('dialogue', { degraded: true, summary: 'something' }, 1),
    ).toBeNull();
  });

  it('skips turns that are only census', () => {
    expect(
      headlineFromPayload(
        'dialogue',
        { turns: [{ speakerName: 'A', text: '位于广场工作' }] },
        1,
      ),
    ).toBeNull();
  });
});

describe('pickActivityFeed', () => {
  const item = (
    slug: string,
    line: string,
    i: number,
  ): WorldActivityItem => ({
    kind: 'talk',
    line,
    simTime: i,
    gameId: slug,
    slug,
    title: slug,
    at: new Date(i * 1000).toISOString(),
    deploymentId: `dep-${slug}`,
  });

  it('caps beats from the same town so one loud world cannot fill the feed', () => {
    const rows = [
      item('a', 'one', 1),
      item('a', 'two', 2),
      item('a', 'three', 3),
      item('b', 'four', 4),
    ];
    const picked = pickActivityFeed(rows, 8);
    expect(picked.map((r) => r.line)).toEqual(['one', 'two', 'four']);
  });
});
