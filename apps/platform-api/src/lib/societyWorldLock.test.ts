/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  isSocietyTickTimeoutError,
  withSocietyWorldLock,
} from './societyLive.js';

describe('withSocietyWorldLock', () => {
  it('does not start a second writer until a timed-out body finishes', async () => {
    let firstDone = false;
    let secondSawFirstStillRunning = false;
    const first = withSocietyWorldLock(
      'lock-timeout',
      async () => {
        await new Promise((r) => setTimeout(r, 80));
        firstDone = true;
        return 'one';
      },
      { holdMs: 15 },
    );
    await new Promise((r) => setTimeout(r, 5));
    const second = withSocietyWorldLock('lock-timeout', async () => {
      secondSawFirstStillRunning = !firstDone;
      return 'two';
    });
    await expect(first).rejects.toSatisfy((err: unknown) =>
      isSocietyTickTimeoutError(err),
    );
    await expect(second).resolves.toBe('two');
    expect(firstDone).toBe(true);
    expect(secondSawFirstStillRunning).toBe(false);
  });
});
