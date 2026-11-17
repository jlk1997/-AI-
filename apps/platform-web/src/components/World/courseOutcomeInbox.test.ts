/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach } from 'vitest';

import {
  listUnseenCourseOutcomes,
  markCourseOutcomeSeen,
  pushCourseOutcome,
} from './courseOutcomeInbox';

describe('courseOutcomeInbox', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores unseen outcomes per game', () => {
    pushCourseOutcome({
      gameId: 'g1',
      nodeId: 'n1',
      kind: 'won',
      prompt: '题',
      at: Date.now(),
    });
    const rows = listUnseenCourseOutcomes('g1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('won');
  });

  it('marks outcomes seen', () => {
    pushCourseOutcome({
      gameId: 'g1',
      nodeId: 'n1',
      kind: 'lost',
      at: Date.now(),
    });
    markCourseOutcomeSeen('g1', 'n1');
    expect(listUnseenCourseOutcomes('g1')).toHaveLength(0);
  });

  it('preserves seen when the same outcome is pushed again', () => {
    pushCourseOutcome({
      gameId: 'g1',
      nodeId: 'n1',
      kind: 'watch_settled',
      canon: '阿禾走了',
      at: 1,
    });
    markCourseOutcomeSeen('g1', 'n1');
    pushCourseOutcome({
      gameId: 'g1',
      nodeId: 'n1',
      kind: 'watch_settled',
      canon: '阿禾走了',
      at: Date.now(),
    });
    expect(listUnseenCourseOutcomes('g1')).toHaveLength(0);
  });
});
