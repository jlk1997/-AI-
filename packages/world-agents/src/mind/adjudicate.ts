/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Neutral referee: what would follow, not a softer or louder version of it.
 * Counts come from the outcome table. This file does not describe how to do harm.
 */

import type { ForceKind } from './conflictBaseRates.js';
import { looksSoftened, stripOperationalHowTo } from './contentPolicy.js';
import type { ForceTag, OpenAction } from './deliberate.js';
import type { LedgerPatch } from './worldLedger.js';

export type Adjudication = {
  readonly feasible: boolean;
  readonly success: number;
  readonly narrative: string;
  readonly softened: boolean;
  readonly needsPhysical: boolean;
  readonly kind: ForceKind;
  readonly contact: number;
  readonly witnesses: readonly string[];
  readonly patches: readonly LedgerPatch[];
};

export function mapForce(force: ForceTag): ForceKind {
  if (force === 'push') return 'unarmed';
  if (force === 'throw') return 'thrown';
  if (force === 'nonlethal') return 'irritant';
  if (force === 'lethal') return 'firearm';
  if (force === 'property') return 'fire';
  return 'none';
}

export function adjudicatePrompt(action: OpenAction, situation: string): string {
  return [
    '你是中立裁判。只判断这件事在现实里会怎样，只返回 JSON。',
    '不要往安全的方向改写，也不要为了戏剧性加重。',
    '不要写武器制作或袭击步骤。叙事用事实口吻。',
    `行动：${action.what}`,
    `方式标签：${action.force}，地点：${action.place || '现场'}`,
    `处境：${situation}`,
    'JSON：{"feasible":true,"success":0.5,"narrative":"...","needsPhysical":false,"witnesses":[]}',
  ].join('\n');
}

export function parseAdjudication(raw: string, action: OpenAction): Adjudication | null {
  if (looksSoftened(raw)) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const narrative = stripOperationalHowTo(String(o['narrative'] ?? '')).text.trim();
    if (!narrative) return null;
    const kind = mapForce(action.force);
    const needs = Boolean(o['needsPhysical']) || kind !== 'none';
    return {
      feasible: o['feasible'] !== false,
      success: Math.max(0, Math.min(1, Number(o['success'] ?? 0.5) || 0)),
      narrative: narrative.slice(0, 240),
      softened: false,
      needsPhysical: needs,
      kind,
      contact: needs ? 12 : 0,
      witnesses: Array.isArray(o['witnesses'])
        ? o['witnesses'].map((w) => String(w)).slice(0, 6)
        : [],
      patches: [],
    };
  } catch {
    return null;
  }
}

export function heuristicAdjudicate(
  action: OpenAction,
  contact: number,
): Adjudication {
  const kind = mapForce(action.force);
  const physical = kind !== 'none' || action.force === 'flee';
  const narrative =
    action.force === 'flee'
      ? `${action.what}。人离开了原来的地方。`
      : physical
        ? `${action.what}。接触约 ${Math.max(0, contact)} 人，伤亡按基准概率另计，这里不写做法。`
        : `${action.what}。`;
  const patches: LedgerPatch[] = [];
  if (action.force === 'flee') {
    patches.push({ fact: narrative });
  } else if (!physical) {
    patches.push({ fact: action.what.slice(0, 120) });
  }
  return {
    feasible: true,
    success: action.force === 'lethal' ? 0.35 : action.force === 'none' ? 0.7 : 0.5,
    narrative,
    softened: false,
    needsPhysical: physical && action.force !== 'flee',
    kind: action.force === 'flee' ? 'none' : kind,
    contact: physical && action.force !== 'flee' ? Math.max(4, contact) : 0,
    witnesses: [],
    patches,
  };
}
