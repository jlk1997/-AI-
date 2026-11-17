/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which shell renders a route. The desktop studio and the phone H5 talk to the
 * same API with the same account — only the frame around them differs.
 */
export type ShellKind = 'desktop' | 'mobile';

const SHELL_OVERRIDE_KEY = 'opengame_shell';

/** Below this the desktop SplitPane stops being usable at all. */
export const MOBILE_MAX_WIDTH = 820;

const MOBILE_UA =
  /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|MicroMessenger/i;

/** iPadOS 13+ reports a desktop UA; a coarse pointer plus touch gives it away. */
function isTabletLikeTouch(): boolean {
  if (typeof navigator === 'undefined') return false;
  const maxTouch = (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  return maxTouch > 1 && /Macintosh/.test(navigator.userAgent);
}

export function isWeChatBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /MicroMessenger/i.test(navigator.userAgent);
}

export function isWeChatMiniProgramWebview(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /miniProgram/i.test(navigator.userAgent);
}

/**
 * `?shell=mobile|desktop` wins and sticks, so a reviewer on a laptop can open
 * the phone build and an author on a tablet can force the full studio back.
 */
export function readShellOverride(search?: string): ShellKind | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(search ?? window.location.search).get('shell');
  if (raw === 'mobile' || raw === 'desktop') {
    try {
      localStorage.setItem(SHELL_OVERRIDE_KEY, raw);
    } catch {
      /* private mode */
    }
    return raw;
  }
  try {
    const stored = localStorage.getItem(SHELL_OVERRIDE_KEY);
    if (stored === 'mobile' || stored === 'desktop') return stored;
  } catch {
    /* private mode */
  }
  return null;
}

export function clearShellOverride(): void {
  try {
    localStorage.removeItem(SHELL_OVERRIDE_KEY);
  } catch {
    /* private mode */
  }
}

export function setShellOverride(shell: ShellKind): void {
  try {
    localStorage.setItem(SHELL_OVERRIDE_KEY, shell);
  } catch {
    /* private mode */
  }
}

export function detectShell(width?: number): ShellKind {
  const override = readShellOverride();
  if (override) return override;
  if (typeof window === 'undefined') return 'desktop';
  const w = width ?? window.innerWidth;
  if (w <= MOBILE_MAX_WIDTH) return 'mobile';
  if (MOBILE_UA.test(navigator.userAgent) && w <= 1024) return 'mobile';
  if (isTabletLikeTouch() && w <= 1024) return 'mobile';
  return 'desktop';
}
