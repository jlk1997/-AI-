/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Intent → MechanicSpec. Overlapping modules are allowed. Exclusive buckets
 * are not. GDD is written from this spec, not the other way around.
 */

import { inferGameIntent } from './intent.js';
import { ensureGameDepth } from './ensureDepth.js';
import type {
  ArcadeCarrier,
  GameArchetypeHint,
  GameIntent,
  MechanicInput,
  MechanicSpace,
  MechanicSpec,
  MechanicTime,
  MechanicWin,
} from './types.js';

export function inferMechanicSpec(
  userPrompt: string,
  options?: {
    readonly designBrief?: string | null;
    readonly archetype?: GameArchetypeHint | null;
  },
): MechanicSpec {
  const intent = inferGameIntent(userPrompt, options?.designBrief);
  return synthesizeMechanicSpec(intent, { archetype: options?.archetype });
}

/** Intent → MechanicSpec. Never invent a sixth exclusive archetype. */
export function synthesizeMechanicSpec(
  intent: GameIntent,
  options?: { readonly archetype?: GameArchetypeHint | null },
): MechanicSpec {
  const archetype = options?.archetype ?? intent.archetypeHint;
  const mixed = intent.mixed;
  const space = pickSpace(intent, archetype, mixed);
  const time = pickTime(intent, archetype);
  const input = pickInput(intent, mixed);
  const win = pickWin(intent, archetype);
  const arcadeVariant = pickArcade(intent, mixed, archetype, space);
  const extraScenes: string[] = [];
  if (
    (intent.boardKind || intent.moduleHints.includes('board')) &&
    !intent.moduleHints.includes('match')
  ) {
    extraScenes.push('BoardTurnScene');
  }

  const spec: MechanicSpec = {
    schema: 'opengame-mechanic-v1',
    prompt: intent.prompt,
    space,
    time,
    input,
    win,
    loops: intent.loopSeeds,
    modules: [...intent.moduleHints],
    archetypeHint: mixed ? 'top_down' : archetype,
    ...(intent.boardKind ? { boardKind: intent.boardKind } : {}),
    ...(arcadeVariant ? { arcadeVariant } : {}),
    ...(extraScenes.length > 0 ? { extraScenes } : {}),
    updatedAt: new Date().toISOString(),
  };
  return ensureGameDepth(spec);
}

function pickSpace(
  intent: GameIntent,
  archetype: GameArchetypeHint,
  mixed: boolean,
): MechanicSpace {
  if (mixed) return 'top_down';
  if (archetype === 'tower_defense') return 'top_down';
  if (archetype === 'ui_heavy') return 'ui';
  if (archetype === 'grid_logic') return 'grid';
  if (intent.spaceHints.includes('grid') && !intent.spaceHints.includes('top_down')) {
    return 'grid';
  }
  if (intent.spaceHints.includes('top_down')) return 'top_down';
  if (intent.spaceHints.includes('ui')) return 'ui';
  if (intent.spaceHints.includes('path')) return 'path';
  if (intent.spaceHints.includes('side')) return 'side';
  if (archetype === 'platformer') return 'side';
  return 'side';
}

function pickTime(intent: GameIntent, archetype: GameArchetypeHint): MechanicTime {
  if (intent.timeHints.includes('turn')) return 'turn';
  if (intent.timeHints.includes('wave') || archetype === 'tower_defense') return 'wave';
  if (intent.timeHints.includes('step')) return 'step';
  if (intent.timeHints.includes('realtime')) return 'realtime';
  if (intent.boardKind) return 'turn';
  return 'realtime';
}

function pickInput(intent: GameIntent, mixed: boolean): MechanicInput {
  if (mixed) return 'keys';
  if (intent.arcadeHint === 'match3') return 'pointer';
  if (intent.inputHints.includes('cell-select')) return 'cell-select';
  if (intent.inputHints.includes('place')) return 'place';
  if (intent.inputHints.includes('choice')) return 'choice';
  if (intent.inputHints.includes('pointer')) return 'pointer';
  if (intent.boardKind) return 'cell-select';
  return 'keys';
}

function pickWin(intent: GameIntent, archetype: GameArchetypeHint): MechanicWin {
  if (intent.winHints.includes('checkmate')) return 'checkmate';
  if (intent.winHints.includes('survive') || archetype === 'tower_defense') {
    return 'survive';
  }
  if (intent.winHints.includes('quest') || archetype === 'ui_heavy') return 'quest';
  if (intent.winHints.includes('score')) return 'score';
  if (intent.winHints.includes('flag')) return 'flag';
  if (intent.boardKind) return 'checkmate';
  if (intent.arcadeHint && intent.arcadeHint !== 'board_turn') return 'score';
  if (archetype === 'top_down') return 'quest';
  return 'flag';
}

function pickArcade(
  intent: GameIntent,
  mixed: boolean,
  archetype: GameArchetypeHint,
  space: MechanicSpace,
): ArcadeCarrier | undefined {
  if (mixed) return undefined;
  if (intent.arcadeHint) return intent.arcadeHint;
  if (intent.boardKind && space === 'grid') return 'board_turn';
  if (archetype === 'grid_logic' && !intent.boardKind) return 'generic';
  return undefined;
}
