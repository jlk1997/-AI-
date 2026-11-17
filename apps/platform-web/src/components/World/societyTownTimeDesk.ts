/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guest 镇时 strip lives in the inspector footer. The brown map banner
 * jumps here instead of pretending it is a clock or a dead bar.
 */

export const TOWN_TIME_DESK_ID = 'og-town-time-desk';
export const WORLD_LIGHT_DESK_ID = 'og-world-light-desk';
export const COURSE_DESK_ID = 'og-course-desk';
export const COURSE_HISTORY_ID = 'og-course-history';
export const WHISPER_DESK_ID = 'og-whisper-desk';

export function townLampTitleKey(
  sku: 'day' | 'week' | 'month' | null | undefined,
): 'product.obs.lampDay' | 'product.obs.lampWeek' | 'product.obs.lampMonth' {
  if (sku === 'month') return 'product.obs.lampMonth';
  if (sku === 'week') return 'product.obs.lampWeek';
  return 'product.obs.lampDay';
}

export function scrollOffsetToChild(
  scrollerTop: number,
  scrollerRectTop: number,
  childRectTop: number,
  pad = 12,
): number {
  return Math.max(0, scrollerTop + (childRectTop - scrollerRectTop) - pad);
}

function nearestScrollParent(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      parent.scrollHeight > parent.clientHeight + 4
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

function flashDesk(id: string, color: string): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id);
  if (!el) return;
  const scroller = nearestScrollParent(el);
  if (scroller) {
    const next = scrollOffsetToChild(
      scroller.scrollTop,
      scroller.getBoundingClientRect().top,
      el.getBoundingClientRect().top,
    );
    scroller.scrollTo({ top: next, behavior: 'smooth' });
  } else {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const prev = el.style.boxShadow;
  el.style.boxShadow = `0 0 0 2px ${color}`;
  window.setTimeout(() => {
    el.style.boxShadow = prev;
  }, 1400);
}

export function scrollToTownTimeDesk(): void {
  flashDesk(TOWN_TIME_DESK_ID, '#f59e0b');
}

export function scrollToWorldLightDesk(): void {
  flashDesk(WORLD_LIGHT_DESK_ID, '#38bdf8');
}

export function scrollToCourseDesk(): void {
  flashDesk(COURSE_DESK_ID, '#eab308');
}

export function scrollToCourseHistory(): void {
  flashDesk(COURSE_HISTORY_ID, '#eab308');
}

export function scrollToWhisperDesk(): void {
  flashDesk(WHISPER_DESK_ID, '#2A9D8F');
}
