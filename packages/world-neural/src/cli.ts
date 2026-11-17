/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { collectTrajectories, trajectoriesToJsonl } from './collect.js';
import { STATE_DIM, ACTION_DIM } from './encode.js';
import { trainMlp, serializeWeights } from './mlp.js';

function usage(): void {
  console.log(`opengame-world-train

Commands:
  collect [--out data/traj.jsonl] [--episodes 40] [--steps 32]
  train   [--data data/traj.jsonl] [--out models/dynamics.json] [--epochs 50]

Env-free pure-TS path. For research-scale RSSM/Dreamer, see python/train_rssm.py
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === '-h' || cmd === '--help') {
    usage();
    return;
  }

  const get = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
  };

  if (cmd === 'collect') {
    const out = get('--out', 'data/traj.jsonl');
    const episodes = Number(get('--episodes', '40'));
    const steps = Number(get('--steps', '32'));
    const stepsData = collectTrajectories({
      episodes,
      stepsPerEpisode: steps,
      policy: 'scripted',
    });
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, trajectoriesToJsonl(stepsData), 'utf8');
    console.log(
      `Wrote ${stepsData.length} steps → ${out} (state=${STATE_DIM} action=${ACTION_DIM})`,
    );
    return;
  }

  if (cmd === 'train') {
    const dataPath = get('--data', 'data/traj.jsonl');
    const out = get('--out', 'models/dynamics.json');
    const epochs = Number(get('--epochs', '50'));
    const raw = fs.readFileSync(dataPath, 'utf8');
    const samples = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const row = JSON.parse(line) as {
          obs: number[];
          actionVec: number[];
          nextObs: number[];
        };
        return { x: [...row.obs, ...row.actionVec], y: row.nextObs };
      });
    console.log(`Training on ${samples.length} samples, epochs=${epochs}`);
    const result = trainMlp(samples, { epochs, lr: 0.02, batchSize: 64 });
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          format: 'opengame-world-mlp-v1',
          stateDim: STATE_DIM,
          actionDim: ACTION_DIM,
          finalLoss: result.finalLoss,
          losses: result.losses,
          weights: result.weights,
          trainedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`Saved model → ${out} (finalLoss=${result.finalLoss.toFixed(6)})`);
    console.log(`Also: ${serializeWeights(result.weights).slice(0, 80)}…`);
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
