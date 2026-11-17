/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  markWatchAfterStakePromptSeen,
  shouldShowWatchAfterStakePrompt,
} from './courseWatchStakePrompt';

const KEY = 'og.course.watchStakePrompt.v1';

describe('courseWatchStakePrompt', () => {
  afterEach(() => {
    window.localStorage.removeItem(KEY);
  });

  it('shows once per town', () => {
    expect(shouldShowWatchAfterStakePrompt('town-a')).toBe(true);
    markWatchAfterStakePromptSeen('town-a');
    expect(shouldShowWatchAfterStakePrompt('town-a')).toBe(false);
    expect(shouldShowWatchAfterStakePrompt('town-b')).toBe(true);
  });
});
