/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';

import { applyThemeToDocument, readThemeMode, THEME_KEY } from './themeStore.js';

describe('theme store helpers', () => {
  afterEach(() => {
    localStorage.removeItem(THEME_KEY);
    document.documentElement.removeAttribute('data-theme');
  });

  it('reads a saved night desk', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    expect(readThemeMode()).toBe('dark');
  });

  it('paints data-theme so CSS tokens and Ant stay on the same side', () => {
    applyThemeToDocument('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--bg-layout')).toBe('#14121a');
  });
});
