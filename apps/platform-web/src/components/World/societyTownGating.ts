/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Author desk vs visitor desk. Visitors must not stop the shared clock.
 */

import { authorFundingOpen } from '@opengame/platform-shared';

export type SocietyTownRole = 'author' | 'guest';

export function societyTownCapabilities(role: SocietyTownRole): {
  readonly canFastForward: boolean;
  readonly canPauseSharedClock: boolean;
  readonly canRebuild: boolean;
  readonly canInterview: boolean;
  readonly canAuthorWhisper: boolean;
  readonly keepPresenceWhileLocallyPaused: boolean;
} {
  const isAuthor = role !== 'guest';
  return {
    canFastForward: isAuthor,
    canPauseSharedClock: isAuthor,
    canRebuild: isAuthor,
    canInterview: isAuthor,
    canAuthorWhisper: isAuthor,
    keepPresenceWhileLocallyPaused: !isAuthor,
  };
}

/** Community / observatory should not hide the map behind a second click. */
export function shouldAutoloadTownMap(input: {
  readonly role: SocietyTownRole;
  readonly autoloadMap?: boolean;
  readonly hasPreview: boolean;
  readonly mapPrepReady: boolean;
  readonly broken?: boolean;
  readonly bundleReady?: boolean;
}): boolean {
  if (!input.hasPreview || !input.mapPrepReady) return false;
  return input.role === 'guest' || input.autoloadMap === true;
}

/**
 * Guests never see author 「继续推演」 copy. A local pause is “your view”,
 * not a request to resume the shared town clock.
 */
export function livePausedHintKey(input: {
  readonly role: SocietyTownRole;
  readonly iframeReady: boolean;
  readonly userStopped?: boolean;
}): string | null {
  if (input.role === 'guest') {
    return input.userStopped ? 'product.obs.viewPaused' : null;
  }
  return input.iframeReady
    ? 'product.obs.liveReadyHint'
    : 'product.obs.livePausedHint';
}

/** Heartbeat “常驻推演” is author-desk jargon. */
export function showAuthorServerClock(input: {
  readonly role: SocietyTownRole;
  readonly serverClock: boolean;
}): boolean {
  return input.role !== 'guest' && input.serverClock;
}

/**
 * Visitors on the community page already have tonight’s board beside /
 * under the map. Do not steal half the stage for an observatory sidebar.
 */
export function showTownInspector(input: {
  readonly role: SocietyTownRole;
  readonly courseHost?: 'stage' | 'page';
}): boolean {
  if (input.role !== 'guest') return true;
  return input.courseHost !== 'page';
}

/**
 * Published packs often ship `?mode=play`. Guests must still open as
 * observe, or Phaser keeps the author “继续推演 / 空格暂停” chrome.
 */
export function applyObserveModeParam(url: string, force = false): string {
  try {
    const absolute = /^https?:\/\//i.test(url);
    const parsed = new URL(url, 'https://og.local/');
    if (force || !parsed.searchParams.has('mode')) {
      parsed.searchParams.set('mode', 'observe');
    }
    if (absolute) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

/** Visitors (and an opened observatory) start following the shared clock. */
export function shouldAutostartPlayback(input: {
  readonly role: SocietyTownRole;
  readonly autoloadMap?: boolean;
  readonly userStopped: boolean;
  readonly locked: boolean;
  readonly broken?: boolean;
  readonly stageLive?: boolean;
  readonly clockPaused?: boolean;
}): boolean {
  if (input.userStopped || input.locked) return false;
  // Author remount must not press play on a clock they already froze.
  if (input.role === 'author' && input.clockPaused) return false;
  return input.role === 'guest' || input.autoloadMap === true;
}

const TOWN_ALIVE_MESSAGES = new Set([
  'opengame-society-ready',
  'opengame-society-cursor',
  'opengame-society-hover',
  'opengame-society-select-agent',
  'opengame-society-bgm-status',
  'opengame-society-live-pause',
]);

/** Any of these from the iframe means Phaser parsed and is painting. */
export function isTownStageAliveMessage(type: string | undefined): boolean {
  return Boolean(type && TOWN_ALIVE_MESSAGES.has(type));
}

export function shouldBootstrapInspectorNow(input: {
  readonly role: SocietyTownRole;
  readonly gameId?: string;
  readonly locked: boolean;
}): boolean {
  return input.role === 'guest' && Boolean(input.gameId) && !input.locked;
}

/**
 * Guest local pause only freezes their view. The shared clock and talk
 * stream must keep running so they still hear the same town as everyone else.
 */
export function shouldKeepSocietyStream(input: {
  readonly role: SocietyTownRole;
  readonly livePaused: boolean;
  readonly disabled?: boolean;
  readonly dead?: boolean;
}): boolean {
  if (input.disabled || input.dead) return false;
  if (input.livePaused && input.role !== 'guest') return false;
  return true;
}

/** Snapshot often lands before Phaser is listening — replay once the iframe is up. */
export function shouldHydrateIframeReplay(input: {
  readonly iframeReady: boolean;
  readonly inspectorBooted: boolean;
  readonly alreadyHydrated: boolean;
}): boolean {
  return input.iframeReady && input.inspectorBooted && !input.alreadyHydrated;
}

/** Guests stay on the shared tip unless they froze their own view. */
export function shouldFollowSharedCursor(input: {
  readonly role: SocietyTownRole;
  readonly viewPaused: boolean;
  readonly scrubbing?: boolean;
}): boolean {
  if (input.scrubbing) return false;
  if (input.role === 'guest') return !input.viewPaused;
  return true;
}

export type SocietyReloadOpts = {
  readonly quiet?: boolean;
  readonly iframe?: 'replay' | 'append' | 'none';
};

/**
 * Two reloads in flight used to drop the second call. Keep the stronger
 * iframe mode (none < append < replay) and only stay quiet if both were.
 */
export function mergeSocietyReloadOpts(
  prev: SocietyReloadOpts | null | undefined,
  next: SocietyReloadOpts | null | undefined,
): SocietyReloadOpts {
  const a = prev ?? {};
  const b = next ?? {};
  const rank = { none: 0, append: 1, replay: 2 } as const;
  const modeOf = (o: SocietyReloadOpts): keyof typeof rank =>
    o.iframe ?? (o.quiet ? 'append' : 'replay');
  const iframe = rank[modeOf(a)] >= rank[modeOf(b)] ? modeOf(a) : modeOf(b);
  return {
    quiet: a.quiet === true && b.quiet === true,
    iframe,
  };
}

/** Snapshots in flight can land after live SSE has already moved the tip forward. */
export const SOCIETY_SIM_STALE_GRACE = 0.05;

export function isSocietySnapshotBehindLive(
  liveCursor: number,
  snapshotMaxT: number,
  grace = SOCIETY_SIM_STALE_GRACE,
): boolean {
  if (!Number.isFinite(liveCursor) || liveCursor <= 0) return false;
  if (!Number.isFinite(snapshotMaxT)) return false;
  return snapshotMaxT + grace < liveCursor;
}

/** Never let a quiet reload or hydrate rewind the shared tip during live play. */
export function societyReloadCursor(input: {
  readonly liveCursor: number;
  readonly snapshotMaxT: number;
  readonly followTip: boolean;
  readonly grace?: number;
}): number {
  const grace = input.grace ?? SOCIETY_SIM_STALE_GRACE;
  const live = input.liveCursor;
  const snap = input.snapshotMaxT;
  if (isSocietySnapshotBehindLive(live, snap, grace)) return live;
  if (input.followTip) return snap;
  if (live > 0 && live <= snap) return live;
  return snap;
}

export function shouldPushSocietySnapshotToIframe(input: {
  readonly liveCursor: number;
  readonly snapshotMaxT: number;
  readonly liveReady: boolean;
  readonly grace?: number;
}): boolean {
  if (!input.liveReady) return true;
  return !isSocietySnapshotBehindLive(
    input.liveCursor,
    input.snapshotMaxT,
    input.grace,
  );
}

export function shouldHydrateWithFullReplay(input: {
  readonly liveCursor: number;
  readonly stashSimTime: number;
  readonly grace?: number;
}): boolean {
  if (input.liveCursor <= 0) return true;
  return !isSocietySnapshotBehindLive(
    input.liveCursor,
    input.stashSimTime,
    input.grace,
  );
}

export function leaseRemainingMs(
  until: Date | string | null | undefined,
  now = Date.now(),
): number {
  if (until == null) return 0;
  const t = until instanceof Date ? until.getTime() : Date.parse(String(until));
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, t - now);
}

export type GuestTownFace = 'idle' | 'walking' | 'speaking';

export function guestTownFace(input: {
  readonly living?: boolean;
  readonly speaking?: boolean;
}): GuestTownFace {
  if (input.speaking) return 'speaking';
  if (input.living) return 'walking';
  return 'idle';
}

export function permitRemainParts(ms: number): {
  readonly kind: 'none' | 'minutes' | 'hours' | 'days';
  readonly days?: number;
  readonly hours?: number;
  readonly minutes?: number;
} {
  if (ms <= 0) return { kind: 'none' };
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return { kind: 'minutes', minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { kind: 'hours', hours, minutes: minutes % 60 };
  return { kind: 'days', days: Math.max(1, Math.round(hours / 24)) };
}

export type SocietyTalkBudgetView = {
  readonly used: number;
  readonly cap: number;
  readonly remaining: number;
  readonly resetsAt: string;
  readonly litBonus: number;
  readonly litUntil: string | null;
};

export function readTalkBudget(raw: unknown): SocietyTalkBudgetView | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const used = Number(o.used);
  const cap = Number(o.cap);
  const remaining = Number(o.remaining);
  if (!Number.isFinite(used) || !Number.isFinite(cap) || !Number.isFinite(remaining)) {
    return null;
  }
  const litBonus = Number(o.litBonus);
  return {
    used,
    cap,
    remaining: Math.max(0, remaining),
    resetsAt: typeof o.resetsAt === 'string' ? o.resetsAt : '',
    litBonus: Number.isFinite(litBonus) ? Math.max(0, litBonus) : 0,
    litUntil: typeof o.litUntil === 'string' ? o.litUntil : null,
  };
}

/**
 * Living + not speaking is not a visitor 开口许可 problem.
 * Hour pack can still talk while the speaking badge is lease-only.
 * Lamp out and no leftover hour talks → 资助过期.
 */
export function quietTownSkipReason(input: {
  readonly living?: boolean;
  readonly speaking?: boolean;
  readonly litUntil?: string | Date | null;
  readonly remaining?: number;
  readonly litBonus?: number;
}): 'budget' | null {
  if (!input.living || input.speaking) return null;
  const hourPackTalks =
    (input.litBonus ?? 0) > 0 && (input.remaining ?? 0) > 0;
  if (authorFundingOpen(input.litUntil) || hourPackTalks) return null;
  return 'budget';
}

/** Guest map overlay — keys empty is not 资助过期. */
export function guestMuteOverlayKey(skip: string | null | undefined): string | null {
  if (skip === 'keys_exhausted') return 'product.obs.llmKeysExhausted';
  if (skip === 'budget' || skip === 'no_permit') return 'product.obs.talkFloorEmpty';
  return null;
}

export function talkBudgetTone(
  budget: Pick<SocietyTalkBudgetView, 'remaining' | 'cap'> | null,
): 'none' | 'ok' | 'low' | 'empty' {
  if (!budget) return 'none';
  if (budget.remaining <= 0) return 'empty';
  const low = Math.max(1, Math.min(6, Math.ceil(budget.cap * 0.15)));
  return budget.remaining <= low ? 'low' : 'ok';
}

export function urgeWorldLight(
  tone: ReturnType<typeof talkBudgetTone>,
  hasOpenCourseStake = false,
): boolean {
  return hasOpenCourseStake || tone === 'empty' || tone === 'low';
}

export type AuthorTownPulse = 'paused' | 'fund' | 'seed';

/** Map chips only — do not jam these into the author sidebar. */
export function authorTownPulses(input: {
  readonly paused?: boolean;
  readonly funded?: boolean;
  readonly hasBoard?: boolean;
}): readonly AuthorTownPulse[] {
  const out: AuthorTownPulse[] = [];
  if (input.paused) out.push('paused');
  if (!input.funded) out.push('fund');
  if (!input.hasBoard) out.push('seed');
  return out;
}

/** Lamp-strip line — guests never see n/cap. Authors still skip 36/80. */
export function talkBudgetStripLine(input: {
  readonly tone: ReturnType<typeof talkBudgetTone>;
  readonly remaining: number;
  readonly cap: number;
  readonly litBonus: number;
  readonly audience?: 'guest' | 'author';
}): { readonly key: string; readonly vars?: Record<string, string> } | null {
  if (input.tone === 'none') return null;
  const guest = input.audience !== 'author';
  if (input.tone === 'empty') {
    return { key: guest ? 'product.obs.fundingWalk' : 'product.obs.lightNone' };
  }
  if (guest) {
    return { key: 'product.obs.guestSpeaking' };
  }
  return { key: 'product.obs.sharedTalk' };
}

export function talkHourResetMinutes(
  resetsAt: string | undefined,
  now = Date.now(),
): number | null {
  if (!resetsAt) return null;
  const t = Date.parse(resetsAt);
  if (!Number.isFinite(t)) return null;
  const minutes = Math.ceil((t - now) / 60_000);
  return minutes > 0 ? minutes : null;
}

/** Only hide the budget banner after lighting actually added talks. */
export function shouldClearBudgetMute(
  view: Pick<SocietyTalkBudgetView, 'remaining'> | null,
): boolean {
  return (view?.remaining ?? 0) > 0;
}

export function worldLightUntilLine(input: {
  readonly litUntil?: string | null;
  readonly litBonus?: number;
  readonly now?: number;
}):
  | { readonly key: 'thisHour' }
  | { readonly key: 'minutes'; readonly minutes: number }
  | { readonly key: 'hours'; readonly hours: number; readonly minutes: number }
  | { readonly key: 'days'; readonly days: number }
  | null {
  const parts = permitRemainParts(leaseRemainingMs(input.litUntil, input.now));
  if (parts.kind === 'minutes') {
    return { key: 'minutes', minutes: parts.minutes ?? 1 };
  }
  if (parts.kind === 'hours') {
    return { key: 'hours', hours: parts.hours ?? 1, minutes: parts.minutes ?? 0 };
  }
  if (parts.kind === 'days') {
    return { key: 'days', days: parts.days ?? 1 };
  }
  return (input.litBonus ?? 0) > 0 ? { key: 'thisHour' } : null;
}

/** Why the town is quiet — generate mute beats a local pause overlay. */
export function townTalkQuietOverlay(input: {
  readonly isGenerating?: boolean;
  readonly skipReason?: string | null;
  readonly livePaused?: boolean;
  readonly authorClockPaused?: boolean;
  readonly isAuthor?: boolean;
}): { readonly key: string } | null {
  const generating =
    input.isGenerating === true || input.skipReason === 'generate';
  const paused =
    input.authorClockPaused === true ||
    (input.isAuthor === true && input.livePaused === true);
  if (generating && paused) return { key: 'product.obs.llmGenerateMutePaused' };
  if (generating) return { key: 'product.obs.llmGenerateMute' };
  return null;
}

export function talkLogNodKey(input: {
  readonly isGenerating?: boolean;
  readonly skipReason?: string | null;
}): string {
  if (input.isGenerating || input.skipReason === 'generate') {
    return 'product.obs.talkNodGenerate';
  }
  return 'product.obs.talkNodOnly';
}
