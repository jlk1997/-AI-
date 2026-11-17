/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  compileWorldToGameSeed,
  createDungeonWorld,
  createEmptyTownWorld,
  parseWorldSpec,
} from '@opengame/world-spec';
import { collectTrajectories } from './collect.js';
import { encodeAction, encodeWorldState, STATE_DIM } from './encode.js';
import { createMlp, predictNextState, trainMlp } from './mlp.js';
import { HybridWorldModel } from './hybrid.js';
import { encodeSocietyCrowd, fitSocietyDynamics } from './society.js';

describe('world-neural', () => {
  it('encodes fixed-size state', () => {
    const v = encodeWorldState(createEmptyTownWorld());
    expect(v.length).toBe(STATE_DIM);
  });

  it('collects trajectories and trains MLP', () => {
    const traj = collectTrajectories({
      episodes: 4,
      stepsPerEpisode: 16,
      policy: 'scripted',
    });
    expect(traj.length).toBe(64);
    const samples = traj.map((t) => ({
      x: [...t.obs, ...t.actionVec],
      y: t.nextObs,
    }));
    const result = trainMlp(samples, { epochs: 8, lr: 0.05, batchSize: 16 });
    expect(result.finalLoss).toBeLessThan(result.losses[0]! * 1.5 + 0.5);
    const pred = predictNextState(
      result.weights,
      traj[0]!.obs,
      encodeAction(traj[0]!.action),
    );
    expect(pred.length).toBe(STATE_DIM);
  });

  it('hybrid imagination ranks actions', () => {
    const traj = collectTrajectories({
      episodes: 2,
      stepsPerEpisode: 12,
      policy: 'scripted',
    });
    const samples = traj.map((t) => ({
      x: [...t.obs, ...t.actionVec],
      y: t.nextObs,
    }));
    const { weights } = trainMlp(samples, { epochs: 5, batchSize: 8 });
    const hybrid = new HybridWorldModel(
      createEmptyTownWorld(),
      JSON.stringify(weights),
    );
    const ranked = hybrid.imagine(['move_e', 'tick', 'give_ore']);
    expect(ranked.length).toBe(3);
    expect(ranked[0]!.surprise).toBeLessThanOrEqual(ranked[2]!.surprise);
  });

  it('proposes difficulty tunables that reach compiled game.json', () => {
    const traj = collectTrajectories({
      episodes: 3,
      stepsPerEpisode: 12,
      policy: 'scripted',
    });
    const samples = traj.map((t) => ({
      x: [...t.obs, ...t.actionVec],
      y: t.nextObs,
    }));
    const { weights } = trainMlp(samples, { epochs: 6, batchSize: 8 });
    const world = createDungeonWorld({ id: 'w_neural' });
    const hybrid = new HybridWorldModel(world, JSON.stringify(weights));

    const proposal = hybrid.proposeDifficultyTunables();
    expect(proposal).not.toBeNull();
    expect(proposal!.source).toBe('l2-hybrid-world-model');
    expect(proposal!.confidence).toBeGreaterThan(0);
    expect(proposal!.confidence).toBeLessThanOrEqual(1);
    expect(proposal!.tunables.enemyHpScale).toBeGreaterThanOrEqual(0.5);
    expect(proposal!.tunables.enemyHpScale).toBeLessThanOrEqual(1.6);
    expect(proposal!.rationale.length).toBeGreaterThan(0);

    // The knobs must survive Spec round-trip and land in the compiled DSL.
    const stamped = parseWorldSpec({
      ...world,
      presentation: {
        ...world.presentation,
        difficultyTunables: proposal!.tunables,
        difficultyTunablesSource: proposal!.source,
      },
    });
    const seed = compileWorldToGameSeed(stamped);
    expect(seed.tunablesSource).toBe('l2-hybrid-world-model');
    expect(seed.tunables['enemySpeed']).toBe(proposal!.tunables.enemySpeed);

    const warden = seed.game.scenes
      .flatMap((s) => s.entities)
      .find((e) => e.id === 'enemy_warden');
    const chase = (warden?.behaviors ?? []).find((b) => b.kind === 'chase');
    expect(chase?.options?.['speed']).toBe(proposal!.tunables.enemySpeed);
    const dmg = (warden?.behaviors ?? []).find((b) => b.kind === 'damageOnTouch');
    expect(dmg).toBeTruthy();
    expect(dmg?.options?.['amount']).toBe(proposal!.tunables.contactDamage);
    expect(dmg?.options?.['initialHp']).toBe(proposal!.tunables.playerHp);
  });

  it('returns null without trained weights so defaults stay in charge', () => {
    const hybrid = new HybridWorldModel(createEmptyTownWorld());
    expect(hybrid.proposeDifficultyTunables()).toBeNull();
  });

  it('fits society occupancy dynamics and reports surprise', () => {
    const sequence = [0, 1, 2, 3, 4].map((i) => ({
      hourOfDay: 8 + i,
      occupancy: [0.2 + i * 0.1, 0.3, 0.1],
      meanAffinity: 0.4,
      talkRate: 0.1 * i,
    }));
    const fit = fitSocietyDynamics(sequence, { epochs: 6, lr: 0.08 });
    expect(fit).not.toBeNull();
    expect(fit!.surprise).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(fit!.finalLoss)).toBe(true);
    const encoded = encodeSocietyCrowd(sequence[0]!);
    expect(encoded.length).toBe(STATE_DIM);
  });
});
