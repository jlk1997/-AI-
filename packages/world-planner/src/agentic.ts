/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Agentic harness inspired by LingBot-World-v2 Pilot + Director roles.
 * Operates on World Spec / WorldOp — does NOT require LingBot GPU weights.
 *
 * @see https://github.com/Robbyant/lingbot-world-v2 (Agentic Harness)
 */

import {
  applyWorldOp,
  WorldOpSchema,
  type WorldOp,
} from '@opengame/world-ops';
import {
  parseWorldSpec,
  summarizeWorldSpec,
  type WorldSpec,
} from '@opengame/world-spec';

import { chatCompletion, extractJsonObject, resolveChatEnv } from './chat.js';

export type AgenticRole = 'pilot' | 'director';

export interface AgenticTurnInput {
  readonly world: WorldSpec;
  /** Player intent / recent events (natural language). */
  readonly intent: string;
  readonly signal?: AbortSignal;
}

export interface AgenticProposal {
  readonly role: AgenticRole;
  readonly rationale: string;
  readonly ops: WorldOp[];
  readonly source: 'llm' | 'heuristic';
}

export interface AgenticHarnessResult {
  readonly world: WorldSpec;
  readonly proposals: AgenticProposal[];
  readonly applied: WorldOp[];
  readonly issues: string[];
}

function heuristicPilot(world: WorldSpec, intent: string): AgenticProposal {
  const ops: WorldOp[] = [];
  const enemy = world.entities.find((e) => e.kind === 'enemy');
  const npc = world.entities.find((e) => e.kind === 'npc');
  if (/attack|fight|combat|战斗|攻击/i.test(intent) && enemy) {
    ops.push({
      op: 'edit_entity',
      entityId: enemy.id,
      patch: {
        attrs: { ...enemy.attrs, aggro: true, hp: Number(enemy.attrs['hp'] ?? 3) },
      },
    });
  } else if (npc) {
    ops.push({
      op: 'edit_entity',
      entityId: npc.id,
      patch: {
        dialogueSeed:
          npc.dialogueSeed ?? `Responding to: ${intent.slice(0, 80)}`,
        attrs: { ...npc.attrs, lastIntent: intent.slice(0, 60) },
      },
    });
  } else {
    ops.push({ op: 'set_flag', flag: 'pilot_tick', value: true });
  }
  return {
    role: 'pilot',
    rationale: 'Heuristic pilot: nudge NPC/enemy toward player intent.',
    ops,
    source: 'heuristic',
  };
}

function heuristicDirector(world: WorldSpec, intent: string): AgenticProposal {
  const ops: WorldOp[] = [];
  if (/storm|暴雨|事件|event|mystery|神秘/i.test(intent)) {
    ops.push({
      op: 'set_flag',
      flag: `event_${Date.now().toString(36)}`,
      value: true,
    });
    const start = world.space.startRegionId;
    ops.push({
      op: 'add_entity',
      entity: {
        id: `prop_event_${Date.now().toString(36)}`,
        kind: 'prop',
        name: 'Strange Omens',
        regionId: start,
        pos: { x: 4, y: 4 },
        attrs: { scenic: true },
        inventory: [],
        tags: ['director', 'event'],
        schedule: [],
      },
    });
  } else if (
    /expand|new area|新区域|forest|森林|cave|洞穴/i.test(intent) ||
    world.space.regions.length < 3
  ) {
    const id = `dir_region_${Date.now().toString(36)}`;
    ops.push({
      op: 'add_region',
      region: {
        id,
        name: /cave|洞穴/i.test(intent) ? 'Whispering Cave' : 'Frontier Reach',
        kind: /cave|地牢|dungeon/i.test(intent) ? 'dungeon' : 'wilderness',
        width: 16,
        height: 12,
        description: `Director-synthesized space for: ${intent.slice(0, 100)}`,
        tags: ['director'],
      },
    });
  } else {
    ops.push({
      op: 'set_flag',
      flag: 'director_ambient',
      value: true,
    });
  }
  return {
    role: 'director',
    rationale: 'Heuristic director: synthesize ambient event or frontier space.',
    ops,
    source: 'heuristic',
  };
}

async function llmPropose(
  role: AgenticRole,
  world: WorldSpec,
  intent: string,
  signal?: AbortSignal,
): Promise<AgenticProposal | null> {
  const env = resolveChatEnv();
  if (!env || process.env['WORLD_PLANNER_HEURISTIC'] === 'true') return null;

  const system =
    role === 'pilot'
      ? `You are the Pilot agent in an interactive world model (LingBot-style harness).
Plan character behaviors as 1-3 WorldOps. Prefer edit_entity / set_flag.
Return ONLY JSON: { "rationale": string, "ops": WorldOp[] }`
      : `You are the Director agent in an interactive world model (LingBot-style harness).
Synthesize novel environmental elements as 1-3 WorldOps (add_region, expand_region, add_entity, set_flag, edit_region).
Return ONLY JSON: { "rationale": string, "ops": WorldOp[] }`;

  try {
    const raw = await chatCompletion({
      ...env,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `World:\n${summarizeWorldSpec(world, 900)}\n\nPlayer/scene intent:\n${intent}`,
        },
      ],
      temperature: role === 'director' ? 0.7 : 0.4,
      maxTokens: 1800,
      jsonMode: true,
      signal,
    });
    const obj = extractJsonObject(raw) as {
      rationale?: string;
      ops?: unknown[];
    };
    const ops: WorldOp[] = [];
    for (const item of obj.ops ?? []) {
      const parsed = WorldOpSchema.safeParse(item);
      if (parsed.success) ops.push(parsed.data);
    }
    if (!ops.length) return null;
    return {
      role,
      rationale: obj.rationale ?? `${role} proposal`,
      ops,
      source: 'llm',
    };
  } catch {
    return null;
  }
}

/**
 * Run one Pilot + Director turn and apply successful ops sequentially.
 */
export async function runAgenticHarness(
  input: AgenticTurnInput,
): Promise<AgenticHarnessResult> {
  const issues: string[] = [];
  const proposals: AgenticProposal[] = [];

  const pilot =
    (await llmPropose('pilot', input.world, input.intent, input.signal)) ??
    heuristicPilot(input.world, input.intent);
  proposals.push(pilot);

  const director =
    (await llmPropose('director', input.world, input.intent, input.signal)) ??
    heuristicDirector(input.world, input.intent);
  proposals.push(director);

  let world = parseWorldSpec(input.world);
  const applied: WorldOp[] = [];
  for (const proposal of proposals) {
    for (const op of proposal.ops) {
      const result = applyWorldOp(world, op);
      if (!result.ok || !result.world) {
        issues.push(
          `${proposal.role}:${op.op} failed — ${result.issues?.join('; ') ?? 'unknown'}`,
        );
        continue;
      }
      world = result.world;
      applied.push(op);
    }
  }

  return { world, proposals, applied, issues };
}

export { heuristicPilot, heuristicDirector };
