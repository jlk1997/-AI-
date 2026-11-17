/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';

import { detectShell, MOBILE_MAX_WIDTH, readShellOverride } from './deviceShell.js';

afterEach(() => {
  window.history.replaceState({}, '', '/');
  localStorage.clear();
});

describe('detectShell', () => {
  it('picks mobile below the studio breakpoint', () => {
    expect(detectShell(MOBILE_MAX_WIDTH)).toBe('mobile');
    expect(detectShell(MOBILE_MAX_WIDTH + 200)).toBe('desktop');
  });

  it('lets ?shell=mobile stick for a reviewer on a laptop', () => {
    window.history.replaceState({}, '', '/?shell=mobile');
    expect(readShellOverride()).toBe('mobile');
    expect(detectShell(1400)).toBe('mobile');
  });
});
