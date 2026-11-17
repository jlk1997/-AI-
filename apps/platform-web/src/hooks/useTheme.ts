/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import type { ThemeConfig } from 'antd';

import { darkTheme, lightTheme } from '../styles/theme';
import { useThemeStore } from '../store/themeStore';

export function useTheme() {
  const themeMode = useThemeStore((s) => s.themeMode);

  const themeConfig: ThemeConfig = themeMode === 'dark' ? darkTheme : lightTheme;

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      useThemeStore.getState().followSystem(e.matches);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return {
    themeMode,
    themeConfig,
    isDark: themeMode === 'dark',
    toggleTheme: () => useThemeStore.getState().toggleTheme(),
    setTheme: (mode: 'light' | 'dark') => useThemeStore.getState().setTheme(mode),
  };
}
