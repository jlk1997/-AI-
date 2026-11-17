/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Nameplates and speech bubbles must sit above the resident, not on the chest
 * or through the head. When several people share a cell, fan names and bubbles
 * so their rectangles do not sit on the same pixel. Camera follow of a new
 * exchange must yield when the observer has pinned someone, pinned a region,
 * or dragged the map.
 */

/** Tallest walk sprite, origin (0.5, 1). Portrait fallbacks are shorter. */
export const AGENT_SPRITE_HEIGHT_TILES = 1.25;
/** Nameplate bottom sits at least this far above the feet. */
export const AGENT_NAME_LIFT_TILES = 1.45;
/** Extra air between the body top and the nameplate. */
export const AGENT_NAME_GAP_TILES = 0.2;
/** Room for the nameplate plus the bubble pointer above it. */
export const AGENT_BUBBLE_ABOVE_NAME_TILES = 0.7;
/** Vertical gap between stacked bubbles in a crowd. */
export const AGENT_BUBBLE_TIER_TILES = 1.05;
/** How many vertical bubble slots a cluster may use. */
export const AGENT_BUBBLE_TIERS = 5;
/** Horizontal gap between compact nameplates in a pile. */
export const AGENT_NAME_CLUSTER_GAP_TILES = 1.4;
/** Horizontal gap between speech bubbles in a pile. */
export const AGENT_BUBBLE_CLUSTER_GAP_TILES = 1.6;
/** From this many stacked residents, nameplates drop the partner tag. */
export const AGENT_CROWD_COMPACT_AT = 3;
export const CROWD_SPREAD_RADIUS = 18;
export const CROWD_SPREAD_RING = 14;

export interface AgentChromeLift {
  /** Pixels above the feet (`by`) for the nameplate origin (0.5, 1). */
  readonly nameLift: number;
  /** Pixels above the feet for a bubble origin (0.5, 1) on this stagger tier. */
  bubbleLift(tier: number): number;
}

export interface ChromeClusterSlot {
  readonly nameDx: number;
  readonly nameDy: number;
  readonly bubbleDx: number;
  readonly bubbleDy: number;
  readonly bubbleTier: number;
}

export interface ChromeRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function usableTile(tileSize: number): number {
  return Number.isFinite(tileSize) && tileSize > 0 ? tileSize : 48;
}

export function agentSpriteHeight(tileSize: number): number {
  return usableTile(tileSize) * AGENT_SPRITE_HEIGHT_TILES;
}

/**
 * Vertical lifts so name / bubble `y` is above `by - spriteHeight`.
 *
 * Feet are at `(bx, by)` with body origin `(0.5, 1)`.
 */
export function agentChromeLift(
  tileSize: number,
  spriteHeight = agentSpriteHeight(tileSize),
): AgentChromeLift {
  const ts = usableTile(tileSize);
  const body = Number.isFinite(spriteHeight) && spriteHeight > 0
    ? spriteHeight
    : agentSpriteHeight(ts);
  const nameLift = Math.max(
    ts * AGENT_NAME_LIFT_TILES,
    body + ts * AGENT_NAME_GAP_TILES,
  );
  return {
    nameLift,
    bubbleLift(tier: number): number {
      const slot =
        ((Math.trunc(tier) % AGENT_BUBBLE_TIERS) + AGENT_BUBBLE_TIERS) %
        AGENT_BUBBLE_TIERS;
      return (
        nameLift +
        ts * AGENT_BUBBLE_ABOVE_NAME_TILES +
        slot * ts * AGENT_BUBBLE_TIER_TILES
      );
    },
  };
}

/** Fan names and bubbles so a workshop pile does not stack on one pixel. */
export function chromeClusterSlot(
  index: number,
  count: number,
  tileSize: number,
): ChromeClusterSlot {
  const ts = usableTile(tileSize);
  const n = Math.max(1, Math.trunc(count) || 1);
  const i = ((Math.trunc(index) % n) + n) % n;
  const mid = (n - 1) / 2;
  const nameDx = (i - mid) * ts * AGENT_NAME_CLUSTER_GAP_TILES;
  const nameDy = i % 2 === 0 ? 0 : ts * 0.28;
  const bubbleTier = i % AGENT_BUBBLE_TIERS;
  const bubbleDx = (i - mid) * ts * AGENT_BUBBLE_CLUSTER_GAP_TILES;
  const bubbleDy = bubbleTier * ts * AGENT_BUBBLE_TIER_TILES;
  return { nameDx, nameDy, bubbleDx, bubbleDy, bubbleTier };
}

export function chromeRectsOverlap(
  a: ChromeRect,
  b: ChromeRect,
  pad = 2,
): boolean {
  const aL = a.x - a.w / 2 - pad;
  const aR = a.x + a.w / 2 + pad;
  const aT = a.y - a.h - pad;
  const aB = a.y + pad;
  const bL = b.x - b.w / 2;
  const bR = b.x + b.w / 2;
  const bT = b.y - b.h;
  const bB = b.y;
  return aL < bR && aR > bL && aT < bB && aB > bT;
}

export function crowdSpreadOffset(
  index: number,
  count: number,
  extra = 0,
): { dx: number; dy: number } {
  if (count < 2) return { dx: 0, dy: 0 };
  const perRing = 8;
  const ring = Math.floor(Math.max(0, index) / perRing);
  const onRing = Math.min(perRing, count - ring * perRing);
  const slot = Math.max(0, index) % perRing;
  const ang =
    ((slot + 0.5) / Math.max(1, onRing)) * Math.PI * 2 + extra;
  const radius = CROWD_SPREAD_RADIUS + ring * CROWD_SPREAD_RING;
  return { dx: Math.cos(ang) * radius, dy: Math.sin(ang) * radius * 0.72 };
}

export function agentLabelText(input: {
  readonly name: string;
  readonly partner?: string;
  readonly action?: string;
  readonly selected?: boolean;
  readonly hovered?: boolean;
  readonly speech?: boolean;
  readonly clusterSize?: number;
}): string {
  const compact = (input.clusterSize ?? 1) >= AGENT_CROWD_COMPACT_AT;
  const showPartner =
    Boolean(input.partner) &&
    (!compact || Boolean(input.selected || input.hovered));
  if (showPartner) return `${input.name} · 💬${input.partner}`;
  if (compact) return input.name;
  const act = (input.action ?? '').replace(/^idle$/i, '').trim();
  if (
    act === 'talking' ||
    act.includes('交谈') ||
    /talking with/i.test(act) ||
    input.speech
  ) {
    return `${input.name} · 💬`;
  }
  if ((input.selected || input.hovered) && act) {
    return `${input.name} · ${act.slice(0, input.selected ? 12 : 8)}`;
  }
  if (/往.+走|前往|heading to|去找|去赴约|去看热闹/i.test(act)) {
    return `${input.name} · ${act.slice(0, 10)}`;
  }
  return input.name;
}

export function shouldDrawTalkArc(input: {
  readonly speakerId: string;
  readonly partnerId: string;
  readonly selectedId?: string | null;
  readonly liveSpeechIds: ReadonlySet<string>;
  readonly clusterSize: number;
}): boolean {
  const selected =
    input.selectedId === input.speakerId ||
    input.selectedId === input.partnerId;
  const live =
    input.liveSpeechIds.has(input.speakerId) ||
    input.liveSpeechIds.has(input.partnerId);
  void input.clusterSize;
  return selected || live;
}

export function shouldShowObjectLabel(input: {
  readonly hot: boolean;
  readonly hovered: boolean;
  readonly crowdAtCell: number;
}): boolean {
  if (input.hovered) return true;
  if (input.crowdAtCell >= AGENT_CROWD_COMPACT_AT) return false;
  return input.hot;
}

export interface SpeechFollowGate {
  readonly pinnedAgentId?: string | null;
  readonly regionPinned?: string | null;
  readonly userSteeredCamera?: boolean;
}

/** New dialogue moves the camera onto the speakers.
 * A drag does not keep the view away from the next line. Pinning a person
 * or a region still holds the frame.
 */
export function shouldFollowSpeech(gate: SpeechFollowGate): boolean {
  return !gate.pinnedAgentId && !gate.regionPinned;
}

/**
 * Bias the follow point downward so the pair sits above the HTML caption
 * instead of having the bar paint over their legs.
 */
export const SPEECH_FOLLOW_BIAS_Y = 64;

export function speechFocusPoint(
  x: number,
  y: number,
  biasY = SPEECH_FOLLOW_BIAS_Y,
): { x: number; y: number } {
  return { x, y: y + Math.max(0, biasY) };
}

/** Region tabs hide harder when the followed pair sits under the top strip. */
export function regionNavAlpha(input: {
  readonly following: boolean;
  readonly followScreenY?: number;
}): number {
  if (!input.following) return 1;
  if (input.followScreenY != null && input.followScreenY < 72) return 0.14;
  return 0.38;
}

/**
 * Yellow talk arcs sit above the body and below the bubble so they do not
 * paint over faces or the line being read.
 */
export function talkArcDepth(bodyDepth: number): number {
  return bodyDepth + 0.5;
}

/** Nameplates stay with the body so a front resident does not cover a rear one. */
export const NAMEPLATE_DEPTH_OFFSET = 1;
/**
 * Speech lives above every nameplate. Y-sort alone used to let a nearer
 * person's tag (depth ≈ feetY + 1) paint over a farther speaker's bubble
 * (depth ≈ theirFeetY + 3).
 */
export const SPEECH_BUBBLE_LAYER = 8000;

export function nameplateDepth(bodyDepth: number): number {
  return bodyDepth + NAMEPLATE_DEPTH_OFFSET;
}

export function speechBubbleBgDepth(bodyDepth: number): number {
  return SPEECH_BUBBLE_LAYER + bodyDepth;
}

export function speechBubbleTextDepth(bodyDepth: number): number {
  return SPEECH_BUBBLE_LAYER + bodyDepth + 1;
}

/** Phaser Text/Graphics here use origin (0.5, 1): `y` is the bottom edge. */
export function chromeOriginBottomRect(
  x: number,
  y: number,
  w: number,
  h: number,
): ChromeRect {
  return { x, y, w, h };
}

/** A name sitting on the bubble must yield — reading the line comes first. */
export function shouldHideNameUnderSpeech(
  name: ChromeRect,
  bubbles: readonly ChromeRect[],
  pad = 6,
): boolean {
  return bubbles.some((b) => chromeRectsOverlap(name, b, pad));
}

/** Shared crowd stamp — never a named resident's face. */
export function isSharedNpcAsset(fileOrKey: string): boolean {
  const s = fileOrKey.trim().toLowerCase().replace(/\\/g, '/');
  return s === 'npc' || /(?:^|\/)npc\.png$/.test(s);
}

/** Walk sheet PNG is not a still portrait. */
export function isWalkSheetAsset(file: string): boolean {
  return /_walk\.png$/i.test(file.trim().replace(/\\/g, '/'));
}

/**
 * Prefer this person's own file. Drop the shared npc.png and walk sheets so
 * later townsfolk do not collapse into one stamp.
 */
export function preferUniquePortraitFile(
  file: string | undefined,
): string | undefined {
  if (!file) return undefined;
  const trimmed = file.trim();
  if (!trimmed) return undefined;
  if (isSharedNpcAsset(trimmed) || isWalkSheetAsset(trimmed)) return undefined;
  return trimmed;
}

export const MINIMAP_WIDTH = 132;
export const MINIMAP_HEIGHT = 96;
export const MINIMAP_PAD = 12;
/** Air under the HUD / region strip when the minimap docks top-right. */
export const MINIMAP_TOP_CLEAR = 48;

export type MinimapDock = 'bottom-right' | 'top-right';

export function minimapBox(
  viewW: number,
  viewH: number,
  dock: MinimapDock,
): { x: number; y: number; w: number; h: number } {
  const w = MINIMAP_WIDTH;
  const h = MINIMAP_HEIGHT;
  const pad = MINIMAP_PAD;
  const x = Math.max(pad, viewW - w - pad);
  const y =
    dock === 'top-right'
      ? MINIMAP_TOP_CLEAR
      : Math.max(pad, viewH - h - pad);
  return { x, y, w, h };
}

/**
 * When the followed pair sits under the default bottom-right minimap, dock
 * the map top-right so chrome does not cover their bodies.
 */
export function minimapDockForFollow(input: {
  readonly following: boolean;
  readonly screenX: number;
  readonly screenY: number;
  readonly viewW: number;
  readonly viewH: number;
}): MinimapDock {
  if (!input.following) return 'bottom-right';
  const box = minimapBox(input.viewW, input.viewH, 'bottom-right');
  const pad = 28;
  const hits =
    input.screenX >= box.x - pad &&
    input.screenX <= box.x + box.w + pad &&
    input.screenY >= box.y - pad &&
    input.screenY <= box.y + box.h + pad;
  return hits ? 'top-right' : 'bottom-right';
}
