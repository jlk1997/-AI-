/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimal i18n shim. We deliberately avoid pulling in `i18next` here — the
 * platform-web UI has < 200 user-facing strings, and a 5kb dictionary lookup
 * is plenty. We expose:
 *
 *   - `t(key)` for inline string lookups
 *   - `setLocale(...)` for runtime switching (also persists to localStorage)
 *   - `useT()` React hook that re-renders on locale change
 *
 * Conventions:
 *   - Keys are dot-namespaced: `profile.title`, `profile.achievements.empty`.
 *   - Missing keys fall back to the key itself (visible to translators).
 *   - English is the authoritative source; other locales merge against `en`.
 */

import React from 'react';
import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';

export type Locale = 'en' | 'zh-CN';

type Dictionary = Record<string, string>;

const LOCALE_KEY = 'opengame_locale';

const SUPPORTED: ReadonlyArray<Locale> = ['en', 'zh-CN'];

const DICTIONARIES: Record<Locale, Dictionary> = {
  en,
  'zh-CN': zhCN,
};

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(LOCALE_KEY);
  if (stored && (SUPPORTED as ReadonlyArray<string>).includes(stored)) {
    return stored as Locale;
  }
  const nav = window.navigator.language;
  if (nav?.toLowerCase().startsWith('zh')) return 'zh-CN';
  return 'en';
}

let currentLocale: Locale = detectInitialLocale();
const listeners = new Set<(loc: Locale) => void>();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(loc: Locale): void {
  if (!(SUPPORTED as ReadonlyArray<string>).includes(loc)) return;
  if (loc === currentLocale) return;
  currentLocale = loc;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LOCALE_KEY, loc);
  }
  for (const fn of listeners) fn(loc);
}

export function supportedLocales(): ReadonlyArray<Locale> {
  return SUPPORTED;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTIONARIES[currentLocale] ?? en;
  const raw = dict[key] ?? en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ''));
}

/**
 * Translates a backend `ApiError` (or any error) into a localized string.
 * Falls back to the raw message if the code is unknown.
 */
export function isPublishUnfundedError(err: unknown): boolean {
  const e = err as { details?: Record<string, unknown> };
  return e.details?.reason === 'publish_unfunded';
}

export function translateApiError(err: unknown): string {
  if (!err) return t('error.internal');
  const e = err as {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
  if (e.code) {
    if (
      e.code.toUpperCase() === 'FORBIDDEN' &&
      e.details?.reason === 'visitor_sku'
    ) {
      const sku = t('community.world.visitorSku');
      if (sku !== 'community.world.visitorSku') return sku;
    }
    if (e.code.toUpperCase() === 'FORBIDDEN' && isPublishUnfundedError(e)) {
      const unfunded = t('community.publish.unfunded');
      if (unfunded !== 'community.publish.unfunded') return unfunded;
    }
    if (
      e.code.toUpperCase() === 'FORBIDDEN' &&
      e.details?.reason === 'publish_legal'
    ) {
      const age = Number(e.details.minAge);
      const legal = t('community.publish.needLegal', {
        age: Number.isFinite(age) && age > 0 ? age : 16,
      });
      if (legal !== 'community.publish.needLegal') return legal;
    }
    const retryAfter = Number(e.details?.retryAfter);
    if (
      e.code.toUpperCase() === 'RATE_LIMITED' &&
      Number.isFinite(retryAfter) &&
      retryAfter > 0
    ) {
      const wait = t('error.rate_limited_wait', {
        seconds: Math.ceil(retryAfter),
      });
      if (wait !== 'error.rate_limited_wait') return wait;
    }
    const key = `error.${e.code.toLowerCase()}`;
    const localized = t(key);
    if (localized !== key) return localized;
  }
  return e.message ?? t('error.internal');
}

export function useT(): {
  t: typeof t;
  locale: Locale;
  setLocale: typeof setLocale;
} {
  const [loc, setLoc] = React.useState<Locale>(currentLocale);
  React.useEffect(() => {
    const listener = (next: Locale): void => setLoc(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { t, locale: loc, setLocale };
}

