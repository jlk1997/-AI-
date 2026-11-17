/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * L2-β structural + light sim probe — reject worlds whose quests cannot fire.
 */

import type { Condition, WorldSpec } from '@opengame/world-spec';

import type { Effect } from '@opengame/world-spec';
import { WorldSimulator, evalCondition } from './simulator.js';

export interface PlayabilityProbeResult {
  readonly ok: boolean;
  readonly issues: string[];
  readonly completedQuestIds: string[];
  readonly startedQuestIds: string[];
}

function collectItemIds(world: WorldSpec): Set<string> {
  const ids = new Set<string>();
  for (const e of world.entities) {
    if (e.kind === 'item' && typeof e.attrs['itemId'] === 'string') {
      ids.add(String(e.attrs['itemId']));
    }
    for (const i of e.inventory) ids.add(i);
  }
  return ids;
}

function conditionMentionsMissingItem(
  world: WorldSpec,
  cond: Condition,
  items: Set<string>,
): string | null {
  switch (cond.op) {
    case 'has_item':
      return items.has(cond.itemId)
        ? null
        : `has_item references missing itemId=${cond.itemId}`;
    case 'and':
      for (const c of cond.all) {
        const m = conditionMentionsMissingItem(world, c, items);
        if (m) return m;
      }
      return null;
    case 'or':
      // ok if any branch is viable — only flag if all miss
      {
        const misses = cond.any
          .map((c) => conditionMentionsMissingItem(world, c, items))
          .filter(Boolean);
        return misses.length === cond.any.length ? misses[0]! : null;
      }
    case 'not':
      return conditionMentionsMissingItem(world, cond.not, items);
    default:
      return null;
  }
}

/**
 * Force-feed common player progress signals then tick rules/quests.
 * Not a full planner — catches obviously dead quest graphs.
 */
export function probeWorldPlayability(world: WorldSpec): PlayabilityProbeResult {
  const issues: string[] = [];
  const items = collectItemIds(world);
  const quests = world.narrative.quests;

  if (quests.length === 0) {
    const npcs = world.entities.filter((e) => e.kind === 'npc').length;
    if (npcs >= 2) {
      return {
        ok: true,
        issues: [],
        completedQuestIds: [],
        startedQuestIds: [],
      };
    }
    return {
      ok: false,
      issues: ['社会探测：零任务且 NPC < 2'],
      completedQuestIds: [],
      startedQuestIds: [],
    };
  }

  for (const q of quests) {
    if (!q.steps?.length) {
      issues.push(`任务 ${q.id} 无 steps`);
      continue;
    }
    for (const step of q.steps) {
      const miss = conditionMentionsMissingItem(world, step.when, items);
      if (miss) issues.push(`任务 ${q.id} / ${step.id}: ${miss}`);
    }
  }

  const sim = new WorldSimulator(world);
  const boost: Effect[] = [];
  const player = world.entities.find((e) => e.kind === 'player');
  if (player) {
    for (const id of items) {
      boost.push({ kind: 'give_item', entityId: player.id, itemId: id });
    }
  }
  // Seed common talk flags so start_quest rules can fire
  for (const e of world.entities) {
    if (e.kind === 'npc') {
      boost.push({ kind: 'set_flag', flag: `talked_${e.id}`, value: true });
    }
    if (e.kind === 'enemy') {
      boost.push({
        kind: 'set_flag',
        flag: `defeated_${e.id}`,
        value: true,
      });
    }
  }

  let result = sim.applyPlayerEffects(boost);
  for (let i = 0; i < 8; i++) {
    result = sim.tick(1);
  }

  const started = result.world.narrative.quests
    .filter((q) => q.status === 'active' || q.status === 'completed')
    .map((q) => q.id);
  const completed = result.world.narrative.quests
    .filter((q) => q.status === 'completed')
    .map((q) => q.id);

  // At least one quest should become active or completed under boost
  if (started.length === 0 && completed.length === 0) {
    // Check if any quest is already available with always-true path
    const available = result.world.narrative.quests.filter(
      (q) => q.status === 'available',
    );
    let anyStepTrue = false;
    for (const q of available) {
      for (const step of q.steps ?? []) {
        if (evalCondition(result.world, step.when)) {
          anyStepTrue = true;
          break;
        }
      }
    }
    if (!anyStepTrue) {
      issues.push(
        '仿真探测：注入物品/对话/击败旗标后仍无任务启动或完成 — 检查 start_quest 规则与 step.when',
      );
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    completedQuestIds: completed,
    startedQuestIds: started,
  };
}
