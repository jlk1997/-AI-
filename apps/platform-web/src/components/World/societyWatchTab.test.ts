/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';

import { societyWatchTabId } from './societyWatchTab';

describe('societyWatchTabId', () => {
  it('reuses the same tab token inside one sessionStorage', () => {
    sessionStorage.clear();
    const first = societyWatchTabId();
    const second = societyWatchTabId();
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(4);
  });
});
