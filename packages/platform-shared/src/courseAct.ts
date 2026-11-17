/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 「一夜三幕」— act index, author replace policy, settlement posture.
 */

export type CourseAct = 1 | 2 | 3;

export type CourseActView = {
  readonly status: string;
  readonly bettingClosesAt: string;
  readonly opensAt?: string;
  readonly contested?: boolean;
  readonly evidenceHealth?: 'none' | 'living' | 'muted';
  readonly reachability?: 'high' | 'medium' | 'low';
  readonly myOptionId?: string | null;
  readonly myPoints?: number;
  readonly winningOptionId?: string | null;
  readonly voidReason?: string | null;
};

export type CourseSettlementState = 'win' | 'lose' | 'void' | 'pending';

export function courseInEvidencePhase(input: {
  readonly status: string;
  readonly bettingClosesAt: string;
  readonly nowMs?: number;
}): boolean {
  if (input.status === 'closed') return true;
  if (input.status !== 'open') return false;
  const closesAtMs = Date.parse(input.bettingClosesAt);
  if (!Number.isFinite(closesAtMs)) return false;
  return (input.nowMs ?? Date.now()) >= closesAtMs;
}

export function courseActIndex(
  view: CourseActView | null | undefined,
  nowMs = Date.now(),
): CourseAct | null {
  if (!view) return null;
  if (view.status === 'settled' || view.status === 'void' || view.status === 'voided') {
    return 3;
  }
  if (courseInEvidencePhase({ ...view, nowMs })) return 2;
  if (view.status === 'open') return 1;
  return null;
}

export function courseActLabelKey(act: CourseAct): string {
  if (act === 2) return 'product.obs.course.act.evidence';
  if (act === 3) return 'product.obs.course.act.result';
  return 'product.obs.course.act.bet';
}

export function courseCanAuthorReplace(
  view: Pick<CourseActView, 'status' | 'contested'> | null | undefined,
): { readonly ok: boolean; readonly reasonKey?: string } {
  if (!view) return { ok: true };
  if (view.status === 'settled' || view.status === 'void' || view.status === 'voided') {
    return { ok: true };
  }
  if (view.contested) {
    return {
      ok: false,
      reasonKey: 'product.obs.course.replace.blockedContested',
    };
  }
  return { ok: true };
}

/** Queue the next board while the current one is live (mutually exclusive with replace). */
export function courseCanAuthorQueue(input: {
  readonly current: Pick<CourseActView, 'status'> | null | undefined;
  readonly queued: unknown | null | undefined;
}): { readonly ok: boolean; readonly reasonKey?: string } {
  if (!input.current) {
    return {
      ok: false,
      reasonKey: 'product.obs.course.queue.noActive',
    };
  }
  if (input.queued) {
    return {
      ok: false,
      reasonKey: 'product.obs.course.queue.full',
    };
  }
  return { ok: true };
}

export function courseActPrimaryNoteKey(input: {
  readonly view: CourseActView;
  readonly isAuthor?: boolean;
  readonly inEvidence: boolean;
  readonly stakedEvidenceKey?: string | null;
  readonly evidenceQuietKey?: string | null;
  readonly nowMs?: number;
}): string | null {
  const act = courseActIndex(input.view, input.nowMs);
  if (!act || act === 3) return null;
  if (act === 1) {
    if (!input.isAuthor && input.view.reachability === 'low') {
      return 'product.obs.course.reachability.low';
    }
    if (!input.isAuthor && input.view.reachability === 'medium') {
      return 'product.obs.course.reachability.mediumGuest';
    }
    return 'product.obs.course.playLine';
  }
  if (input.stakedEvidenceKey && !input.isAuthor) {
    return input.stakedEvidenceKey;
  }
  if (input.evidenceQuietKey) return input.evidenceQuietKey;
  if (input.view.evidenceHealth === 'muted') {
    return 'product.obs.course.evidenceHealth.muted';
  }
  if (input.view.evidenceHealth === 'none') {
    return 'product.obs.course.evidenceHealth.none';
  }
  return 'product.obs.course.playLineEvidence';
}

export function courseSettlementState(
  view: Pick<
    CourseActView,
    'status' | 'myOptionId' | 'myPoints' | 'winningOptionId' | 'voidReason'
  >,
): CourseSettlementState {
  if (view.status !== 'settled' && view.status !== 'void' && view.status !== 'voided') {
    return 'pending';
  }
  if (view.status === 'void' || view.status === 'voided' || view.voidReason) {
    return 'void';
  }
  if ((view.myPoints ?? 0) <= 0 || !view.myOptionId) return 'pending';
  if (view.winningOptionId && view.winningOptionId === view.myOptionId) {
    return 'win';
  }
  return 'lose';
}

export function courseSettlementTitleKey(
  state: CourseSettlementState,
): string | null {
  if (state === 'win') return 'product.obs.course.settlement.win';
  if (state === 'lose') return 'product.obs.course.settlement.lose';
  if (state === 'void') return 'product.obs.course.settlement.void';
  return null;
}

/**
 * 展示用的 5 幕进度：开盘 → 即将封盘 → 取证 → 结算 → 出结果。
 * 与 {@link CourseAct}（3 段内部状态枚举）独立，新旧共存以便回滚。
 */
export type CourseActDisplay = 1 | 2 | 3 | 4 | 5;

export type CourseActDisplayView = CourseActView & {
  readonly settlesAt?: string;
};

const CLOSING_SOON_MS = 5 * 60_000;
const SETTLING_SOON_MS = 30_000;

export function courseActDisplay(
  view: CourseActDisplayView | CourseActView | null | undefined,
  nowMs = Date.now(),
): CourseActDisplay | null {
  if (!view) return null;
  const status = view.status;
  if (status === 'settled' || status === 'void' || status === 'voided') {
    return 5;
  }
  const closesAt = Date.parse(view.bettingClosesAt);
  const closesRemainMs = Number.isFinite(closesAt) ? closesAt - nowMs : Infinity;
  // 5 分钟 = 即将封盘
  if (
    status === 'open'
    && closesRemainMs <= CLOSING_SOON_MS
    && closesRemainMs > 0
  ) {
    return 2;
  }
  if (courseInEvidencePhase({ status, bettingClosesAt: view.bettingClosesAt, nowMs })) {
    const settlesAt = (view as CourseActDisplayView).settlesAt;
    if (settlesAt) {
      const settlesAtMs = Date.parse(settlesAt);
      if (Number.isFinite(settlesAtMs) && settlesAtMs - nowMs <= SETTLING_SOON_MS) {
        return 4;
      }
    }
    return 3;
  }
  if (status === 'open') return 1;
  return null;
}

export function courseActDisplayLabelKey(act: CourseActDisplay): string {
  switch (act) {
    case 1:
      return 'product.obs.course.act5.open';
    case 2:
      return 'product.obs.course.act5.closing';
    case 3:
      return 'product.obs.course.act5.evidence';
    case 4:
      return 'product.obs.course.act5.settling';
    case 5:
      return 'product.obs.course.act5.done';
  }
}
