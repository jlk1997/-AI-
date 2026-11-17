/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared observatory copy helpers — roster, memory pad, and the stage.
 */

import { paidTraceKind } from './societyInspectorCopy';

export type PlanSegment = {
  startHour?: number;
  endHour?: number;
  activity?: string;
  locationId?: string;
  locationName?: string;
};

export function regionLabel(id?: string, name?: string): string {
  if (name && name !== id) return name;
  if (!id) return '';
  return id.replace(/_/g, ' ');
}

export function paidTraceLabelKey(kind: ReturnType<typeof paidTraceKind>): string | null {
  if (kind === 'adopt') return 'product.obs.paidAdopt';
  if (kind === 'whisper') return 'product.obs.paidWhisper';
  if (kind === 'rumor') return 'product.obs.paidRumor';
  return null;
}

export function driveLabelOf(
  drive: string | undefined,
  t: (key: string) => string,
): string {
  if (drive === 'hunger') return t('product.obs.whyHunger');
  if (drive === 'energy') return t('product.obs.whyEnergy');
  if (drive === 'social') return t('product.obs.whySocial');
  if (drive === 'curiosity') return t('product.obs.whyCuriosity');
  return drive ?? '';
}

const GOAL_REASON_KEYS: Record<string, string> = {
  plan: 'product.obs.whyPlan',
  named: 'product.obs.whyNamed',
  crowd: 'product.obs.whyCrowd',
  hub: 'product.obs.whyHub',
  kind: 'product.obs.whyKind',
  'home-base': 'product.obs.whyHome',
  centre: 'product.obs.whyCentre',
  portal: 'product.obs.whyPortalShort',
  drive: 'product.obs.whyDriveNeed',
  'stay-talk': 'product.obs.whyStayTalk',
};

export function goalReasonLabel(
  reason: string | undefined,
  t: (key: string) => string,
): string {
  const raw = reason?.trim() ?? '';
  if (!raw) return '';
  const key = GOAL_REASON_KEYS[raw];
  return key ? t(key) : raw;
}

export function stillHeading(input: {
  readonly x?: number;
  readonly y?: number;
  readonly goalX?: number;
  readonly goalY?: number;
}): boolean {
  if (input.goalX == null || input.goalY == null) return false;
  if (input.x == null || input.y == null) return true;
  return Math.abs(input.x - input.goalX) + Math.abs(input.y - input.goalY) > 2;
}

const HEADING_ACTION_RE = /往.+走|前往|heading to|on the way|去路口|去找|去赴约|去看热闹/i;

export function readableResidentAction(input: {
  goalPlace?: string;
  goalReason?: string;
  currentAction?: string;
  x?: number;
  y?: number;
  goalX?: number;
  goalY?: number;
  t: (key: string, vars?: Record<string, string>) => string;
}): string {
  const action = (input.currentAction ?? '').trim();
  if (/交谈|talking with|talking to/i.test(action)) return action;
  if (HEADING_ACTION_RE.test(action)) return action;
  const place = input.goalPlace?.trim();
  const heading =
    Boolean(place) &&
    (input.goalReason === 'portal' ||
      stillHeading({
        x: input.x,
        y: input.y,
        goalX: input.goalX,
        goalY: input.goalY,
      }));
  if (heading && place && !action.includes(place)) {
    return input.t('product.obs.headingTo', { place });
  }
  return action;
}

export function whyLine(input: {
  goalPlace?: string;
  goalReason?: string;
  drive?: string;
  currentAction?: string;
  t: (key: string, vars?: Record<string, string>) => string;
}): string | null {
  const place = input.goalPlace?.trim();
  if (input.goalReason === 'portal') {
    return input.t('product.obs.whyPortal', {
      place: place || input.t('product.obs.crossing'),
    });
  }
  const blob = `${input.goalReason ?? ''} ${input.currentAction ?? ''}`;
  if (/熄了|灭了|坏了|改去别处|broken|\bout\b/i.test(blob)) {
    const reason = (input.goalReason || input.currentAction || '').slice(0, 40);
    return place
      ? input.t('product.obs.whyBroken', { place, reason: reason || input.t('product.obs.objectOff') })
      : reason || input.t('product.obs.objectOff');
  }
  const reason = goalReasonLabel(input.goalReason, input.t);
  const drive = driveLabelOf(input.drive, input.t);
  if (!place && !drive && !reason) return null;
  if (drive && place) {
    return input.t('product.obs.whyLine', { drive, place, reason: reason || place });
  }
  if (place && reason) {
    return input.t('product.obs.whyToPlace', { reason, place });
  }
  if (place) return input.t('product.obs.headingTo', { place });
  return reason || drive || null;
}

export function placeLabel(
  id?: string,
  name?: string,
  objects?: ReadonlyArray<{ id: string; name: string; areaId?: string; areaName?: string }>,
): string {
  const named = name && name !== id ? name : '';
  if (named && !/^[a-z0-9_]+$/i.test(named)) return named;
  if (!id) return named;
  const obj = objects?.find((o) => o.id === id || o.areaId === id);
  if (obj?.areaName) return obj.areaName;
  if (obj?.name) return obj.name;
  return named || id.replace(/_/g, ' ');
}

export function currentPlanPlace(
  plan: { segments: PlanSegment[] } | null,
  cursor: number,
  objects: ReadonlyArray<{ id: string; name: string; areaId?: string; areaName?: string }>,
): string {
  if (!plan) return '';
  const hourNow = Math.floor(((cursor % 24) + 24) % 24);
  const seg = plan.segments.find(
    (s) =>
      typeof s.startHour === 'number' &&
      typeof s.endHour === 'number' &&
      hourNow >= s.startHour &&
      hourNow < s.endHour,
  );
  return placeLabel(seg?.locationId, seg?.locationName, objects);
}
