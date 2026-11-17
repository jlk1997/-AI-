/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Author 出题 is three steps: pick a town-bound source, edit, confirm wins.
 */

import {
  courseInEvidencePhase as sharedCourseInEvidencePhase,
  type CourseAct,
} from '@opengame/platform-shared';

export type { CourseAct };
export {
  courseActIndex,
  courseActLabelKey,
  courseActPrimaryNoteKey,
  courseCanAuthorReplace,
  courseSettlementState,
  courseSettlementTitleKey,
  type CourseActView,
  type CourseSettlementState,
} from '@opengame/platform-shared';

export type CourseSeedPick =
  | 'auto'
  | 'village'
  | 'resident'
  | 'places'
  | 'talks'
  | 'custom';

export function availableCourseSeedPicks(input: {
  readonly villagePack?: boolean;
  readonly residentCount?: number;
  readonly placeCount?: number;
  readonly hasTalks?: boolean;
}): readonly CourseSeedPick[] {
  const out: CourseSeedPick[] = ['auto'];
  if (input.villagePack) out.push('village');
  if ((input.residentCount ?? 0) > 0) out.push('resident');
  if ((input.placeCount ?? 0) >= 2) out.push('places');
  if (input.hasTalks) out.push('talks');
  out.push('custom');
  return out;
}

export function courseSeedPickNeedsForm(pick: CourseSeedPick): boolean {
  return pick === 'resident' || pick === 'places' || pick === 'talks' || pick === 'custom';
}

export function courseSeedPickLabelKey(pick: CourseSeedPick): string {
  if (pick === 'village') return 'product.obs.course.modal.village';
  if (pick === 'resident') return 'product.obs.course.modal.resident';
  if (pick === 'places') return 'product.obs.course.modal.place';
  if (pick === 'talks') return 'product.obs.course.modal.talks';
  if (pick === 'custom') return 'product.obs.course.modal.custom';
  return 'product.obs.course.modal.auto';
}

/** Maps author pick to GET course/recommend `kind` (custom has no server preview). */
export function courseSeedPickRecommendKind(
  pick: CourseSeedPick,
): 'auto' | 'night_market' | 'binary' | 'places' | 'talks' | null {
  if (pick === 'auto') return 'auto';
  if (pick === 'village') return 'night_market';
  if (pick === 'resident') return 'binary';
  if (pick === 'places') return 'places';
  if (pick === 'talks') return 'talks';
  return null;
}

/** POST course/recommend when prompt + options must be sent in body. */
export function courseRecommendNeedsPost(input: {
  readonly prompt?: string;
  readonly options?: ReadonlyArray<unknown>;
}): boolean {
  return Boolean(input.prompt?.trim() && (input.options?.length ?? 0) >= 2);
}

export function authorSeedCtaKey(status?: string | null): string {
  if (!status) return 'product.obs.course.authorTitle';
  if (status === 'settled' || status === 'void' || status === 'voided') {
    return 'product.obs.course.seedNext';
  }
  return 'product.obs.course.modal.replaceShort';
}

export function guestDeskOpenFolds(status?: string | null): readonly string[] {
  return status === 'closed' ? ['whisper'] : [];
}

export function guestCourseChromeKey(status?: string | null): string {
  if (status === 'closed') return 'product.obs.course.goBoard';
  return 'product.obs.course.goStake';
}

export function coursePromptPreview(prompt: string, max = 36): string {
  const line = prompt.trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

export type CourseReachabilityTag =
  | 'talks'
  | 'resident'
  | 'places'
  | 'high'
  | 'medium'
  | 'low';

export function courseReachabilityTagKey(tag: CourseReachabilityTag): string {
  if (tag === 'talks') return 'product.obs.course.reachability.talks';
  if (tag === 'resident') return 'product.obs.course.reachability.resident';
  if (tag === 'places') return 'product.obs.course.reachability.places';
  return `product.obs.course.reachability.${tag}`;
}

export function courseReachabilityTagForPick(input: {
  readonly pick: CourseSeedPick;
  readonly reachability: 'high' | 'medium' | 'low';
}): CourseReachabilityTag {
  if (input.pick === 'talks') return 'talks';
  if (input.pick === 'resident') return 'resident';
  if (input.pick === 'places') return 'places';
  return input.reachability;
}

export function courseWhisperPlaceholder(input: {
  readonly course: {
    readonly status: string;
    readonly myOptionId: string | null;
    readonly options: ReadonlyArray<{
      readonly id: string;
      readonly winHint?: string;
    }>;
  } | null;
  readonly t: (key: string, vars?: Record<string, string | number>) => string;
}): string {
  const course = input.course;
  if (!course || (course.status !== 'closed' && course.status !== 'open')) {
    return input.t('community.whisper.placeholder');
  }
  if (course.status === 'open' && course.myOptionId) {
    return input.t('product.obs.course.whisperHint.openStaked');
  }
  if (course.status !== 'closed') {
    return input.t('community.whisper.placeholder');
  }
  const mine = course.options.find((row) => row.id === course.myOptionId);
  if (!mine?.winHint?.trim()) {
    return input.t('product.obs.course.whisperHint.generic');
  }
  return input.t('product.obs.course.whisperHint.staked', {
    hint: mine.winHint.trim(),
  });
}

export function courseEvidenceQuietWarning(input: {
  readonly status: string;
  readonly evidenceHealth?: string;
  readonly opensAt: string;
  readonly bettingClosesAt?: string;
  readonly nowMs?: number;
}): boolean {
  if (input.status !== 'open' && input.status !== 'closed') return false;
  if (input.evidenceHealth === 'living' || input.evidenceHealth === 'muted') {
    return false;
  }
  const nowMs = input.nowMs ?? Date.now();
  const inEvidence = courseInEvidencePhase({
    status: input.status,
    bettingClosesAt: input.bettingClosesAt ?? input.opensAt,
    nowMs,
  });
  const anchorMs = inEvidence
    ? Date.parse(input.bettingClosesAt ?? '')
    : Date.parse(input.opensAt);
  if (!Number.isFinite(anchorMs)) return false;
  return nowMs - anchorMs >= 30 * 60_000;
}

export function courseEvidenceQuietKey(input: {
  readonly status: string;
  readonly bettingClosesAt?: string;
  readonly opensAt: string;
  readonly nowMs?: number;
}): string {
  const inEvidence = courseInEvidencePhase({
    status: input.status,
    bettingClosesAt: input.bettingClosesAt ?? input.opensAt,
    nowMs: input.nowMs,
  });
  return inEvidence
    ? 'product.obs.course.evidenceQuietEvidence'
    : 'product.obs.course.evidenceQuiet';
}

export function courseReachabilityDeskKey(
  reachability: 'high' | 'medium' | 'low' | undefined,
): string | null {
  if (!reachability) return null;
  return `product.obs.course.reachability.${reachability}`;
}

export function courseSeedSourceKey(
  seedSource: string | undefined,
): string | null {
  if (!seedSource || seedSource === 'custom' || seedSource === 'auto') return null;
  return `product.obs.course.seedSource.${seedSource}`;
}

export function courseBoardEmptyKey(input: {
  readonly skipReason?: 'unfunded';
  readonly isAuthor?: boolean;
}): string {
  if (input.skipReason === 'unfunded') {
    return input.isAuthor
      ? 'product.obs.course.skipUnfundedAuthor'
      : 'product.obs.course.skipUnfunded';
  }
  return 'product.obs.course.empty';
}

export function courseGuestReachabilityWarning(input: {
  readonly status?: string;
  readonly reachability?: 'high' | 'medium' | 'low';
  readonly isAuthor?: boolean;
}): boolean {
  if (input.isAuthor) return false;
  return input.status === 'open' && input.reachability === 'low';
}

export function courseGuestReachabilityNoteKey(input: {
  readonly status?: string;
  readonly reachability?: 'high' | 'medium' | 'low';
  readonly isAuthor?: boolean;
}): string | null {
  if (input.isAuthor || input.status !== 'open') return null;
  if (input.reachability === 'low') {
    return 'product.obs.course.reachability.low';
  }
  if (input.reachability === 'medium') {
    return 'product.obs.course.reachability.mediumGuest';
  }
  return null;
}

export function coursePlayLineKey(input: {
  readonly status: string;
  readonly bettingClosesAt: string;
  readonly nowMs?: number;
}): string {
  if (
    courseInEvidencePhase({
      status: input.status,
      bettingClosesAt: input.bettingClosesAt,
      nowMs: input.nowMs,
    })
  ) {
    return 'product.obs.course.playLineEvidence';
  }
  return 'product.obs.course.playLine';
}

export function coursePollingIntervalMs(input: {
  readonly status?: string;
  readonly bettingClosesAt?: string;
  readonly myPoints?: number;
  readonly nowMs?: number;
}): number {
  const inEvidence =
    input.status === 'closed'
    || (input.status === 'open'
      && courseInEvidencePhase({
        status: input.status,
        bettingClosesAt: input.bettingClosesAt ?? '',
        nowMs: input.nowMs,
      }));
  if (inEvidence) return 2_500;
  if (input.status === 'open' && (input.myPoints ?? 0) > 0) return 3_000;
  return 4_000;
}

export function courseStakedEvidenceKey(input: {
  readonly inEvidence: boolean;
  readonly myOptionId: string | null;
  readonly myPoints: number;
  readonly leadingOptionId: string | null;
  readonly hitsByOption: Readonly<Record<string, number>>;
}): string | null {
  if (!input.inEvidence || !input.myOptionId || input.myPoints <= 0) {
    return null;
  }
  const mineHits = input.hitsByOption[input.myOptionId] ?? 0;
  if (input.leadingOptionId === input.myOptionId) {
    return 'product.obs.course.stakedLeading';
  }
  if (mineHits > 0) {
    return 'product.obs.course.stakedHit';
  }
  if (input.leadingOptionId && input.leadingOptionId !== input.myOptionId) {
    return 'product.obs.course.stakedBehind';
  }
  return 'product.obs.course.stakedWatch';
}

export function courseInEvidencePhase(input: {
  readonly status: string;
  readonly bettingClosesAt: string;
  readonly nowMs?: number;
}): boolean {
  return sharedCourseInEvidencePhase(input);
}

export function courseEvidenceHealthKey(
  health: 'none' | 'living' | 'muted' | undefined,
): string | null {
  if (!health) return null;
  if (health === 'living') return 'product.obs.course.evidenceHealth.living';
  if (health === 'muted') return 'product.obs.course.evidenceHealth.muted';
  return 'product.obs.course.evidenceHealth.none';
}

export function authorSeedTownMeta(input: {
  readonly talkCount: number;
  readonly placeCount: number;
  readonly residentCount: number;
  readonly villagePack: boolean;
}): string {
  const parts: string[] = [];
  if (input.talkCount > 0) {
    parts.push(`product.obs.course.modal.talkCount:${input.talkCount}`);
  } else {
    parts.push('product.obs.course.modal.noTalksYet');
  }
  if (input.placeCount >= 2) {
    parts.push(`product.obs.course.modal.placeCount:${input.placeCount}`);
  }
  if (input.residentCount > 0) {
    parts.push(`product.obs.course.modal.residentCount:${input.residentCount}`);
  }
  if (input.villagePack) {
    parts.push('product.obs.course.modal.villagePack');
  }
  return parts.join('|');
}

export function courseRecommendEmptyHintKey(meta: {
  readonly talkCount: number;
  readonly placeCount: number;
  readonly residentCount: number;
}): string {
  if (meta.talkCount === 0 && meta.residentCount === 0) {
    return 'product.obs.course.recommend.emptyNoTalks';
  }
  if (meta.placeCount < 2) {
    return 'product.obs.course.recommend.emptyNoPlaces';
  }
  return 'product.obs.course.recommend.empty';
}

export function formatAuthorSeedTownMeta(
  meta: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  return meta
    .split('|')
    .filter(Boolean)
    .map((part) => {
      const [key, raw] = part.split(':');
      if (!key) return '';
      if (raw) return t(key, { n: raw });
      return t(key);
    })
    .filter(Boolean)
    .join(' · ');
}

export function coursePulseShouldFocusDesk(
  pulse: { readonly kind: string },
  hadStake: boolean,
): boolean {
  if (pulse.kind === 'opposed' || pulse.kind === 'next' || pulse.kind === 'author_contested') {
    return true;
  }
  if (!hadStake) return pulse.kind === 'next';
  return (
    pulse.kind === 'closed'
    || pulse.kind === 'won'
    || pulse.kind === 'lost'
    || pulse.kind === 'voided'
    || pulse.kind === 'next'
  );
}

export function coursePulseShouldOpenSheet(
  pulse: { readonly kind: string },
  hadStake: boolean,
): boolean {
  if (!hadStake) return false;
  return (
    pulse.kind === 'closed'
    || pulse.kind === 'won'
    || pulse.kind === 'lost'
    || pulse.kind === 'voided'
    || pulse.kind === 'next'
    || pulse.kind === 'opposed'
  );
}

export function authorReplacePreviewPrompt(input: {
  readonly pick: CourseSeedPick;
  readonly prompt: string;
  readonly pickLabel: string;
}): string {
  if (input.pick === 'auto' || input.pick === 'village') {
    return input.pickLabel;
  }
  return input.prompt.trim() || input.pickLabel;
}

export function genreProfileFromWorldSpec(
  worldSpec: unknown,
): { readonly genreId?: string; readonly packId?: string } {
  const spec = worldSpec as {
    presentation?: { genreProfile?: { id?: string } };
    society?: { id?: string };
    id?: string;
  } | null;
  return {
    genreId: spec?.presentation?.genreProfile?.id,
    packId: spec?.society?.id ?? spec?.id,
  };
}

export function courseAuthorRecommendHintKey(input: {
  readonly genreId?: string | null;
  readonly packId?: string | null;
  readonly villagePack?: boolean;
}): string {
  if (input.villagePack) {
    return 'product.obs.course.recommend.genre.village';
  }
  const genre = (input.genreId ?? '').toLowerCase();
  const pack = (input.packId ?? '').toLowerCase();
  if (
    genre.includes('horror')
    || genre.includes('mystery')
    || genre.includes('thriller')
  ) {
    return 'product.obs.course.recommend.genre.mystery';
  }
  if (
    pack.includes('crew')
    || genre.includes('crew')
    || genre.includes('spaceship')
  ) {
    return 'product.obs.course.recommend.genre.crew';
  }
  if (
    genre.includes('school')
    || genre.includes('campus')
    || genre.includes('academy')
  ) {
    return 'product.obs.course.recommend.genre.school';
  }
  if (genre.includes('wuxia') || genre.includes('jianghu')) {
    return 'product.obs.course.recommend.genre.wuxia';
  }
  return 'product.obs.course.recommend.genre.town';
}

/** Minimal spec slice for modal / OpsBar when full world spec is not in memory. */
export function minimalWorldSpecFromProfile(input: {
  readonly genreId?: string | null;
  readonly packId?: string | null;
}): unknown {
  const genreId = input.genreId?.trim();
  const packId = input.packId?.trim();
  if (!genreId && !packId) return undefined;
  return {
    ...(packId ? { society: { id: packId } } : {}),
    ...(genreId ? { presentation: { genreProfile: { id: genreId } } } : {}),
  };
}
