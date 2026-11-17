/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

const ONBOARDING_KEY = 'og.course.onboarding.v1';

export function courseOnboardingSeen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    return true;
  }
}

export function markCourseOnboardingSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    /* ignore quota */
  }
}

const GUEST_COACH_KEY = 'og.course.guestCoach.v1';

export function courseGuestCoachSeen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(GUEST_COACH_KEY) === '1';
  } catch {
    return true;
  }
}

export function markCourseGuestCoachSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GUEST_COACH_KEY, '1');
  } catch {
    /* ignore quota */
  }
}

export function trackCourseEvent(
  name: string,
  props?: Record<string, string | number | boolean>,
): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & {
    ogCourseEvents?: Array<{
      name: string;
      props?: Record<string, string | number | boolean>;
      at: number;
    }>;
  };
  w.ogCourseEvents = w.ogCourseEvents ?? [];
  w.ogCourseEvents.push({ name, props, at: Date.now() });
  if (import.meta.env?.DEV) {
    console.debug('[course-event]', name, props);
  }
}

const onceKeys = new Set<string>();

/** Fire at most once per page session — avoids banner impression spam. */
export function trackCourseEventOnce(
  key: string,
  name: string,
  props?: Record<string, string | number | boolean>,
): void {
  if (onceKeys.has(key)) return;
  onceKeys.add(key);
  trackCourseEvent(name, props);
}

const WATCH_CHANGED_EVENT = 'og.course.watchChanged';

/** Notify strips / profile cards to refetch course watches. */
export function notifyCourseWatchChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WATCH_CHANGED_EVENT));
}

export function onCourseWatchChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(WATCH_CHANGED_EVENT, listener);
  return () => window.removeEventListener(WATCH_CHANGED_EVENT, listener);
}

const STAKE_CHANGED_EVENT = 'og.course.stakeChanged';

/** Notify strips / capsules to refetch active stakes. */
export function notifyCourseStakeChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STAKE_CHANGED_EVENT));
}

export function onCourseStakeChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(STAKE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(STAKE_CHANGED_EVENT, listener);
}
