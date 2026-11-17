/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Policy consequences: objects, needs, and a fresh plan for the people named.
 */

import type { AnchorKind } from './anchors.js';
import { insertCommitment, replanFromNow, type PlanPlace, type PlanRelation } from './plan.js';
import type { LlmTextFn } from './reflect.js';
import {
  markPolicyEffectsApplied,
  type PolicyRecord,
  type SocietyMind,
} from './societyMind.js';
import type { SocietyState } from './tick.js';

const REPLAN_CAP = 8;

function affectedAgents(state: SocietyState, policy: PolicyRecord) {
  const tags = policy.tags.map((t) => t.trim()).filter(Boolean);
  const pool = state.agents.filter((a) => {
    if (!tags.length) return true;
    const hay = `${a.occupation ?? ''} ${a.regionId} ${a.name}`;
    return tags.some((t) => hay.includes(t));
  });
  return pool.length ? pool : state.agents;
}

function placesOf(state: SocietyState): PlanPlace[] {
  const out: PlanPlace[] = [];
  for (const [id, anchor] of state.anchors ?? []) {
    out.push({
      id,
      name: anchor.name ?? id,
      kind: (anchor.kind ?? 'other') as AnchorKind,
      regionId: anchor.regionId,
    });
  }
  return out;
}

function relationsOf(state: SocietyState, agentId: string): PlanRelation[] {
  const out: PlanRelation[] = [];
  for (const [key, rel] of state.relations) {
    const [a, b] = key.split('|');
    if (a !== agentId && b !== agentId) continue;
    const otherId = a === agentId ? b : a;
    const other = state.agents.find((x) => x.id === otherId);
    if (!other) continue;
    out.push({ name: other.name, summary: rel.summary, affinity: rel.affinity });
  }
  return out.sort((x, y) => y.affinity - x.affinity).slice(0, 6);
}

function dayIndexOf(simTime: number): number {
  return Math.max(0, Math.floor(simTime / 24));
}

/**
 * Apply a policy's world effects and replan the residents it names.
 * Residents past the replan cap still get the errand inserted into today's plan.
 */
export async function applyPolicyEffects(input: {
  readonly state: SocietyState;
  readonly policy: PolicyRecord;
  readonly llm?: LlmTextFn;
  readonly idFactory?: () => string;
}): Promise<SocietyMind | void> {
  const { state, policy } = input;
  const effects = policy.effects;
  const people = affectedAgents(state, policy);
  const hour = state.simTime % 24;
  const urgent =
    effects?.urgentActivity?.trim() ||
    `议论「${policy.title.slice(0, 24)}」`;
  if (effects?.objectId) {
    const objectId = effects.objectId;
    const nextState = effects.objectState ?? 'changed';
    const idx = state.objects.findIndex((o) => o.id === objectId);
    if (idx >= 0) {
      const prev = state.objects[idx]!;
      state.objects[idx] = { ...prev, state: nextState };
    }
  }
  if (effects?.needMul && effects.needMul > 0) {
    const mul = effects.needMul;
    for (const agent of people) {
      agent.needs ??= {
        hunger: 0.2,
        energy: 0.6,
        social: 0.3,
        curiosity: 0.3,
      };
      agent.needs.hunger = Math.max(0, Math.min(1, agent.needs.hunger * mul));
    }
  }
  const closed = effects?.regionId;
  const gather = [...(state.anchors ?? []).values()].find(
    (a) => a.kind === 'social' && (!closed || a.regionId !== closed),
  );
  let replanned = 0;
  for (const agent of people) {
    const plan = state.plans.get(agent.id);
    if (plan) {
      state.plans.set(
        agent.id,
        insertCommitment(plan, {
          hour,
          activity: urgent,
          ...(gather ? { locationId: gather.regionId } : {}),
        }),
      );
    }
    if (gather) {
      agent.goalX = gather.x;
      agent.goalY = gather.y;
      agent.goalPlace = gather.name ?? '广场';
      agent.goalReason = policy.title.slice(0, 40);
    }
    agent.currentAction = urgent;
    if (!input.llm || replanned >= REPLAN_CAP) continue;
    replanned += 1;
    const next = await replanFromNow({
      stream: state.stream,
      agentId: agent.id,
      agentName: agent.name,
      identitySummary: agent.identitySummary,
      dayIndex: dayIndexOf(state.simTime),
      nowSimTime: state.simTime,
      idFactory: input.idFactory ?? (() => `pol_${agent.id}_${state.simTime}`),
      llm: input.llm,
      homeRegionId: agent.regionId,
      homeAreaId: agent.homeAreaId,
      workAreaId: agent.workAreaId,
      occupation: agent.occupation,
      schedule: agent.schedule,
      places: placesOf(state),
      hubRegionId: state.hubRegionId,
      clockKind: state.clockKind,
      relations: relationsOf(state, agent.id),
      reason: policy.title.slice(0, 48),
      hourOfDay: hour,
      urgentActivity: urgent,
      ...(gather ? { urgentLocationId: gather.regionId } : {}),
    });
    state.plans.set(agent.id, next);
  }
}

export function withEffectsApplied(mind: SocietyMind, policyId: string): SocietyMind {
  return markPolicyEffectsApplied(mind, policyId);
}
