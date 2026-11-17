/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  markCourseFollowCoachSeen,
  shouldShowCourseFollowCoach,
} from './courseFollowCoach';

describe('courseFollowCoach', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows once per town', () => {
    expect(shouldShowCourseFollowCoach('town-a')).toBe(true);
    markCourseFollowCoachSeen('town-a');
    expect(shouldShowCourseFollowCoach('town-a')).toBe(false);
    expect(shouldShowCourseFollowCoach('town-b')).toBe(true);
  });
});
