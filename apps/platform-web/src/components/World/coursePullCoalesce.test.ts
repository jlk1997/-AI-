/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { coalescePendingSilent, stageOwnsCoursePoll } from './coursePullCoalesce';

describe('coalescePendingSilent', () => {
  it('keeps a loud pull when a silent one arrives later', () => {
    expect(coalescePendingSilent(false, true)).toBe(false);
  });

  it('upgrades a pending silent pull to loud', () => {
    expect(coalescePendingSilent(true, false)).toBe(false);
  });

  it('stays silent when both are silent', () => {
    expect(coalescePendingSilent(true, true)).toBe(true);
    expect(coalescePendingSilent(null, true)).toBe(true);
  });
});

describe('stageOwnsCoursePoll', () => {
  it('lets the stage poll when it embeds the desk', () => {
    expect(stageOwnsCoursePoll({ courseHost: 'stage', courseDeskActive: false })).toBe(
      true,
    );
    expect(stageOwnsCoursePoll({ courseHost: 'stage', courseDeskActive: true })).toBe(
      true,
    );
  });

  it('yields to an active page desk and keeps HUD poll when the desk is idle', () => {
    expect(stageOwnsCoursePoll({ courseHost: 'page', courseDeskActive: true })).toBe(
      false,
    );
    expect(stageOwnsCoursePoll({ courseHost: 'page', courseDeskActive: false })).toBe(
      true,
    );
  });
});
