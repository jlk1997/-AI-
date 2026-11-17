/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One tab = one presence ticket. sessionStorage is per-tab, so closing
 * this window cannot evict another tab of the same account.
 */

const KEY = 'og_watch_tab';
const TAB_RE = /^[a-zA-Z0-9_-]{4,40}$/;

export function societyWatchTabId(): string {
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing && TAB_RE.test(existing)) return existing;
    const next =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
        : `tab${Date.now().toString(36)}`;
    sessionStorage.setItem(KEY, next);
    return next;
  } catch {
    return 'main';
  }
}
