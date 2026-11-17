/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hybrid: symbolic WorldSimulator is SSOT; neural model proposes NPC intents /
 * "imagination" rollouts for planning without rewriting Spec.
 */

import type { WorldSpec } from '@opengame/world-spec';
import { WorldSimulator } from '@opengame/world-sim';

import {
  encodeAction,
  encodeWorldState,
  type WorldActionKind,
} from './encode.js';
import {
  deserializeWeights,
  predictNextState,
  type MlpWeights,
} from './mlp.js';

/**
 * Difficulty knobs the L2 model proposes for the compiled game. Keys match
 * `compileWorldToGameSeed`'s tunables so the neural pass changes real gameplay
 * instead of only producing a log line.
 */
export interface WorldDifficultyTunables {
  readonly playerSpeed: number;
  readonly enemySpeed: number;
  readonly enemyChaseRange: number;
  readonly enemyHpScale: number;
  readonly itemScore: number;
  readonly playerHp: number;
  readonly contactDamage: number;
}

export interface WorldDifficultyProposal {
  readonly tunables: WorldDifficultyTunables;
  readonly source: 'l2-hybrid-world-model';
  readonly preferredAction: WorldActionKind;
  /** Mean L2 distance between predicted and symbolic next state. */
  readonly meanSurprise: number;
  /** `1 / (1 + meanSurprise)` — how well the dynamics model tracks the world. */
  readonly confidence: number;
  /** Enemy pressure inferred from the Spec (enemies per region × hp ratio). */
  readonly combatPressure: number;
  readonly rationale: string[];
}

export interface ImaginationResult {
  readonly action: WorldActionKind;
  readonly predictedState: number[];
  /** L2 distance between predicted next and actual next after symbolic step. */
  readonly surprise: number;
  readonly actualEvents: string[];
}

function l2(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
}

export class HybridWorldModel {
  readonly sim: WorldSimulator;
  private weights: MlpWeights | null;

  constructor(world: WorldSpec, weightsJson?: string | null) {
    this.sim = new WorldSimulator(world);
    this.weights = weightsJson ? deserializeWeights(weightsJson) : null;
  }

  loadWeights(json: string): void {
    this.weights = deserializeWeights(json);
  }

  get world(): WorldSpec {
    return this.sim.getWorld();
  }

  /**
   * Score candidate actions by neural surprise vs symbolic next state.
   * Low surprise ⇒ dynamics model "understands" the transition.
   */
  imagine(
    candidates: readonly WorldActionKind[] = [
      'move_e',
      'move_w',
      'talk',
      'tick',
      'give_ore',
    ],
  ): ImaginationResult[] {
    if (!this.weights) {
      return candidates.map((action) => ({
        action,
        predictedState: [],
        surprise: Infinity,
        actualEvents: [],
      }));
    }
    const results: ImaginationResult[] = [];
    const snapshot = JSON.stringify(this.sim.getWorld());

    for (const action of candidates) {
      this.sim.load(JSON.parse(snapshot) as WorldSpec);
      const obs = encodeWorldState(this.sim.getWorld());
      const act = encodeAction(action);
      const predicted = predictNextState(this.weights, obs, act);

      // Apply loosely via tick/move for actual
      let events: string[] = [];
      if (action.startsWith('move_')) {
        const player = this.sim.getWorld().entities.find((e) => e.kind === 'player');
        if (player) {
          const dx = action === 'move_e' ? 1 : action === 'move_w' ? -1 : 0;
          const dy = action === 'move_s' ? 1 : action === 'move_n' ? -1 : 0;
          const r = this.sim.applyPlayerEffects([
            {
              kind: 'move_entity',
              entityId: player.id,
              regionId: player.regionId,
              pos: { x: player.pos.x + dx, y: player.pos.y + dy },
            },
          ]);
          events = r.events.map((e) => e.type);
        }
      } else if (action === 'give_ore') {
        const player = this.sim.getWorld().entities.find((e) => e.kind === 'player');
        if (player) {
          const r = this.sim.applyPlayerEffects([
            { kind: 'give_item', entityId: player.id, itemId: 'iron_ore' },
          ]);
          events = r.events.map((e) => e.type);
        }
      } else if (action === 'tick') {
        events = this.sim.tick(1).events.map((e) => e.type);
      } else {
        events = this.sim.tick(0).events.map((e) => e.type);
      }

      const actual = encodeWorldState(this.sim.getWorld());
      results.push({
        action,
        predictedState: Array.from(predicted),
        surprise: l2(predicted, actual),
        actualEvents: events,
      });
    }

    // restore tip world
    this.sim.load(JSON.parse(snapshot) as WorldSpec);
    return results.sort((a, b) => a.surprise - b.surprise);
  }

  /** Best action under neural imagination (lowest surprise). */
  preferAction(candidates?: readonly WorldActionKind[]): WorldActionKind {
    const ranked = this.imagine(candidates);
    return ranked[0]?.action ?? 'noop';
  }

  /**
   * Turns imagination surprise + Spec composition into difficulty knobs.
   *
   * Reasoning: low surprise means the learned dynamics track the symbolic
   * simulator, so the world behaves predictably and can carry more pressure.
   * High surprise (or an already crowded, high-HP world) pulls the numbers back
   * so the first playable build stays winnable.
   *
   * Returns `null` when no weights are loaded — callers then keep the compiler
   * defaults rather than guessing.
   */
  proposeDifficultyTunables(): WorldDifficultyProposal | null {
    if (!this.weights) return null;
    const ranked = this.imagine();
    const finite = ranked
      .map((r) => r.surprise)
      .filter((s) => Number.isFinite(s));
    if (finite.length === 0) return null;
    const meanSurprise = finite.reduce((a, b) => a + b, 0) / finite.length;
    const confidence = 1 / (1 + meanSurprise);

    const world = this.world;
    const regions = Math.max(1, world.space.regions.length);
    const enemies = world.entities.filter((e) => e.kind === 'enemy');
    const player = world.entities.find((e) => e.kind === 'player');
    const playerHp = numericAttr(player?.attrs, 'hp', 12);
    const meanEnemyHp =
      enemies.length > 0
        ? enemies.reduce((s, e) => s + numericAttr(e.attrs, 'hp', 8), 0) /
          enemies.length
        : 0;
    const hpRatio = playerHp > 0 ? meanEnemyHp / playerHp : 0;
    const enemiesPerRegion = enemies.length / regions;
    // 0 = empty world, 1 = crowded and tanky.
    const combatPressure = clamp01(enemiesPerRegion / 2 + hpRatio / 2);

    const tunables: WorldDifficultyTunables = {
      playerSpeed: round(180 + 40 * (1 - confidence) + 20 * combatPressure),
      enemySpeed: round(34 + 30 * confidence - 14 * combatPressure),
      enemyChaseRange: round(240 + 200 * confidence - 60 * combatPressure),
      enemyHpScale: round2(
        clamp(0.75 + 0.5 * confidence - 0.3 * combatPressure, 0.5, 1.6),
      ),
      itemScore: round(10 + 4 * combatPressure),
      // High combat pressure → more player HP and softer contact hits so the
      // first compiled build stays finishable; confident models push harder.
      playerHp: round(clamp(10 + 8 * combatPressure + 4 * (1 - confidence), 6, 28)),
      contactDamage: round(clamp(1 + confidence - 0.4 * combatPressure, 1, 4)),
    };

    const rationale = [
      `neural surprise 均值 ${meanSurprise.toFixed(3)} → 置信度 ${(confidence * 100).toFixed(0)}%`,
      `世界战斗压力 ${(combatPressure * 100).toFixed(0)}%（${enemies.length} 敌人 / ${regions} 区域，血量比 ${hpRatio.toFixed(2)}）`,
      `敌人速度 ${tunables.enemySpeed}、血量系数 ${tunables.enemyHpScale}、追击距离 ${tunables.enemyChaseRange}`,
      `玩家 HP ${tunables.playerHp}、接触伤害 ${tunables.contactDamage}`,
    ];

    return {
      tunables,
      source: 'l2-hybrid-world-model',
      preferredAction: ranked[0]?.action ?? 'noop',
      meanSurprise,
      confidence,
      combatPressure,
      rationale,
    };
  }
}

function numericAttr(
  attrs: Record<string, string | number | boolean> | undefined,
  key: string,
  fallback: number,
): number {
  const raw = attrs?.[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function round(value: number): number {
  return Math.round(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
