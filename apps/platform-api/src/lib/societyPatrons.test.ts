/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  asTownTimeSku,
  publicDisplayName,
  societyCoursePulsePayload,
  societyPatronPayload,
  societyStreamEventName,
} from './societyPatrons.js';

describe('society patrons', () => {
  it('only treats day/week/month as a 镇时 sku', () => {
    expect(asTownTimeSku('day')).toBe('day');
    expect(asTownTimeSku('week')).toBe('week');
    expect(asTownTimeSku('month')).toBe('month');
    expect(asTownTimeSku('year')).toBeNull();
    expect(asTownTimeSku(null)).toBeNull();
  });

  it('never publishes a raw user id as the lamp name', () => {
    expect(publicDisplayName('阿禾', 'he')).toBe('阿禾');
    expect(publicDisplayName('  ', 'he')).toBe('he');
    expect(publicDisplayName(null, null)).toBe('有人');
  });

  it('keeps the latest buyer as lamp while earlier spend stays on the board', () => {
    const first = {
      displayName: '先到',
      avatarUrl: null,
      points: 20,
      lastSku: 'day' as const,
    };
    const latest = {
      displayName: '后买',
      avatarUrl: null,
      points: 240,
      lastSku: 'month' as const,
    };
    const lamp = {
      displayName: latest.displayName,
      avatarUrl: null,
      sku: 'month' as const,
      townTimeUntil: '2026-09-19T00:00:00.000Z',
    };
    const payload = societyPatronPayload({
      lamp,
      contributors: [latest, first],
      watcherCount: 3,
    });
    expect(payload.og).toBe('patron');
    expect(payload.lamp.sku).toBe('month');
    expect(payload.contributors.map((row) => row.displayName)).toEqual([
      '后买',
      '先到',
    ]);
    expect(societyStreamEventName(JSON.stringify(payload))).toBe('society-patron');
    expect(societyStreamEventName(JSON.stringify({ agents: [] }))).toBe(
      'society-frame',
    );
    expect(societyStreamEventName('not-json')).toBe('society-frame');
    const course = societyCoursePulsePayload({
      nodeId: 'n',
      status: 'open',
      pool: 24,
      contested: true,
      options: [{ id: 'stay', points: 12 }],
    });
    expect(course.og).toBe('course');
    expect(course.options[0]?.points).toBe(12);
    expect(societyStreamEventName(JSON.stringify(course))).toBe('society-course');
  });
});
