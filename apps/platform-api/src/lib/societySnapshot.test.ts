/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { societyInspectorClock } from './societySnapshot.js';

describe('societyInspectorClock', () => {
  it('reads the genre clock so a guest sidebar can label the current hour', () => {
    expect(
      societyInspectorClock({
        presentation: { genreProfile: { clock: { kind: 'watch', shifts: 3 } } },
        space: { startRegionId: 'plaza' },
      }),
    ).toEqual({
      clock: { kind: 'watch', shifts: 3 },
      space: { startRegionId: 'plaza' },
      presentation: { genreProfile: { clock: { kind: 'watch', shifts: 3 } } },
    });
  });

  it('tolerates a missing spec', () => {
    expect(societyInspectorClock(null)).toEqual({});
  });
});
