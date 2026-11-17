/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One theme mode for the whole app. Local useState in useTheme used to fork:
 * GeneratePage would paint CSS variables night, while LivePreview / Ant
 * ConfigProvider stayed on paper — the studio looked split in half.
 */

import { create } from 'zustand';

import { cssVariables } from '../styles/theme';

export type ThemeMode = 'light' | 'dark';

export const THEME_KEY = 'opengame_theme_mode';

export function readThemeMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'light';
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

export function applyThemeToDocument(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(cssVariables[mode])) {
    root.style.setProperty(key, value);
  }
  root.setAttribute('data-theme', mode);
}

interface ThemeState {
  themeMode: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  followSystem: (prefersDark: boolean) => void;
}

function createThemeStore() {
  return create<ThemeState>((set, get) => ({
    themeMode: readThemeMode(),
    setTheme: (mode) => {
      try {
        localStorage.setItem(THEME_KEY, mode);
      } catch {
        /* private mode */
      }
      applyThemeToDocument(mode);
      set({ themeMode: mode });
    },
    toggleTheme: () => {
      get().setTheme(get().themeMode === 'light' ? 'dark' : 'light');
    },
    followSystem: (prefersDark) => {
      try {
        if (localStorage.getItem(THEME_KEY)) return;
      } catch {
        return;
      }
      const mode: ThemeMode = prefersDark ? 'dark' : 'light';
      applyThemeToDocument(mode);
      set({ themeMode: mode });
    },
  }));
}

const hot = import.meta.hot;
export const useThemeStore =
  (hot?.data?.themeStore as ReturnType<typeof createThemeStore> | undefined) ??
  createThemeStore();

if (hot?.data) {
  hot.data.themeStore = useThemeStore;
}

if (typeof document !== 'undefined') {
  applyThemeToDocument(useThemeStore.getState().themeMode);
}
