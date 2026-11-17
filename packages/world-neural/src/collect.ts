/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Roll out symbolic WorldSimulator to collect (obs, action, next_obs) for training.
 */

import {
  createEmptyTownWorld,
  type WorldSpec,
} from '@opengame/world-spec';
import { WorldSimulator } from '@opengame/world-sim';

import {
  encodeAction,
  encodeWorldState,
  type TrajectoryStep,
  type WorldActionKind,
} from './encode.js';

const ACTION_SPACE: WorldActionKind[] = [
  'noop',
  'move_n',
  'move_s',
  'move_e',
  'move_w',
  'talk',
  'wait',
  'tick',
  'give_ore',
];

function applyAction(
  sim: WorldSimulator,
  action: WorldActionKind,
): { events: string[] } {
  const events: string[] = [];
  const world = sim.getWorld();
  const player = world.entities.find((e) => e.kind === 'player');
  if (!player) return { events };

  switch (action) {
    case 'move_n':
    case 'move_s':
    case 'move_e':
    case 'move_w': {
      const dx = action === 'move_e' ? 1 : action === 'move_w' ? -1 : 0;
      const dy = action === 'move_s' ? 1 : action === 'move_n' ? -1 : 0;
      const region = world.space.regions.find((r) => r.id === player.regionId);
      const nx = Math.max(
        0,
        Math.min((region?.width ?? 32) - 1, player.pos.x + dx),
      );
      const ny = Math.max(
        0,
        Math.min((region?.height ?? 24) - 1, player.pos.y + dy),
      );
      const r = sim.applyPlayerEffects([
        {
          kind: 'move_entity',
          entityId: player.id,
          regionId: player.regionId,
          pos: { x: nx, y: ny },
        },
      ]);
      events.push(...r.events.map((e) => e.type));
      break;
    }
    case 'talk': {
      const r = sim.tick(0);
      events.push(...r.events.map((e) => e.type));
      break;
    }
    case 'tick':
    case 'wait': {
      const r = sim.tick(1);
      events.push(...r.events.map((e) => e.type));
      break;
    }
    case 'give_ore': {
      const r = sim.applyPlayerEffects([
        { kind: 'give_item', entityId: player.id, itemId: 'iron_ore' },
      ]);
      events.push(...r.events.map((e) => e.type));
      break;
    }
    default: {
      const r = sim.tick(0);
      events.push(...r.events.map((e) => e.type));
    }
  }
  return { events };
}

export interface CollectOptions {
  readonly episodes?: number;
  readonly stepsPerEpisode?: number;
  readonly seedWorld?: WorldSpec;
  readonly policy?: 'random' | 'scripted';
}

export function collectTrajectories(
  options: CollectOptions = {},
): TrajectoryStep[] {
  const episodes = options.episodes ?? 20;
  const steps = options.stepsPerEpisode ?? 32;
  const out: TrajectoryStep[] = [];

  for (let ep = 0; ep < episodes; ep++) {
    const base =
      options.seedWorld ??
      createEmptyTownWorld({
        title: `TrainEp${ep}`,
        id: `train_ep_${ep}`,
      });
    const sim = new WorldSimulator(JSON.parse(JSON.stringify(base)) as WorldSpec);
    // Fire initial rules
    sim.tick(0);

    for (let t = 0; t < steps; t++) {
      const obs = encodeWorldState(sim.getWorld());
      let action: WorldActionKind;
      if (options.policy === 'scripted') {
        // Scripted curriculum: explore → talk → give ore → wait
        const phase = t % 16;
        if (phase < 4) action = 'move_e';
        else if (phase < 6) action = 'talk';
        else if (phase === 6) action = 'give_ore';
        else if (phase < 10) action = 'tick';
        else action = ACTION_SPACE[Math.floor(Math.random() * ACTION_SPACE.length)]!;
      } else {
        action =
          ACTION_SPACE[Math.floor(Math.random() * ACTION_SPACE.length)]!;
      }
      const { events } = applyAction(sim, action);
      const nextObs = encodeWorldState(sim.getWorld());
      const reward =
        events.includes('quest_completed') || events.includes('quest_started')
          ? 1
          : events.includes('flag_set')
            ? 0.3
            : 0;
      out.push({
        obs: Array.from(obs),
        action,
        actionVec: Array.from(encodeAction(action)),
        nextObs: Array.from(nextObs),
        reward,
        events,
        meta: { episode: ep, step: t },
      });
    }
  }
  return out;
}

export function trajectoriesToJsonl(steps: readonly TrajectoryStep[]): string {
  return steps.map((s) => JSON.stringify(s)).join('\n') + '\n';
}
