/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Play-loop SSOT. Archetype is a camera / physics hint, never a product SKU.
 */

export type GameArchetypeHint =
  | 'platformer'
  | 'top_down'
  | 'grid_logic'
  | 'tower_defense'
  | 'ui_heavy';

export type ArcadeCarrier =
  | 'snake'
  | 'flappy'
  | 'g2048'
  | 'board_turn'
  | 'match3'
  | 'generic';

export type MechanicSpace = 'side' | 'top_down' | 'grid' | 'ui' | 'path';
export type MechanicTime = 'realtime' | 'turn' | 'step' | 'wave';
export type MechanicInput = 'keys' | 'pointer' | 'cell-select' | 'place' | 'choice';
export type MechanicWin =
  | 'score'
  | 'flag'
  | 'checkmate'
  | 'quest'
  | 'survive'
  | 'custom';

export type MechanicModule =
  | 'platform'
  | 'dialogue'
  | 'combat'
  | 'td'
  | 'world'
  | 'systems'
  | 'board'
  | 'match'
  | 'cards'
  | 'emitter';

export type BoardKind = 'xiangqi' | 'gomoku' | 'chess' | 'generic';

export type NamedLoop = {
  readonly id: string;
  readonly label: string;
  readonly signals: readonly string[];
  readonly source: 'lexicon' | 'custom';
  readonly hint?: string;
};

export type MechanicSpec = {
  readonly schema: 'opengame-mechanic-v1';
  readonly prompt: string;
  readonly space: MechanicSpace;
  readonly time: MechanicTime;
  readonly input: MechanicInput;
  readonly win: MechanicWin;
  readonly loops: readonly NamedLoop[];
  readonly modules: readonly MechanicModule[];
  readonly archetypeHint: GameArchetypeHint;
  readonly boardKind?: BoardKind;
  readonly arcadeVariant?: ArcadeCarrier;
  /** Scene keys added by GameOps or mixed composition — coder must register extraScenes. */
  readonly extraScenes?: readonly string[];
  readonly updatedAt: string;
};

export type GameIntent = {
  readonly schema: 'opengame-game-intent-v1';
  readonly prompt: string;
  readonly redo: boolean;
  readonly boardKind: BoardKind | null;
  readonly arcadeHint: ArcadeCarrier | null;
  readonly spaceHints: readonly MechanicSpace[];
  readonly timeHints: readonly MechanicTime[];
  readonly inputHints: readonly MechanicInput[];
  readonly winHints: readonly MechanicWin[];
  readonly moduleHints: readonly MechanicModule[];
  readonly loopSeeds: readonly NamedLoop[];
  readonly archetypeHint: GameArchetypeHint;
  /** Walkable world + board (or other overlapping capabilities) in one prompt. */
  readonly mixed: boolean;
};

export type GameOp =
  | { readonly op: 'add_loop'; readonly loop: NamedLoop }
  | { readonly op: 'retarget_win'; readonly win: MechanicWin }
  | { readonly op: 'add_scene'; readonly sceneKey: string }
  | { readonly op: 'bind_module'; readonly module: MechanicModule }
  | { readonly op: 'retarget_space'; readonly space: MechanicSpace }
  | { readonly op: 'retarget_time'; readonly time: MechanicTime }
  | { readonly op: 'retarget_input'; readonly input: MechanicInput };

export type CapabilityEntry = {
  readonly id: MechanicModule;
  readonly pkg: string;
  readonly useWhen: string;
  readonly api: string;
};

export const GAME_INTENT_SCHEMA = 'opengame-game-intent-v1' as const;
export const MECHANIC_SPEC_SCHEMA = 'opengame-mechanic-v1' as const;
