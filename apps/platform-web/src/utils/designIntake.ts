/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * First-create design intake — clarify play shape before enqueue.
 */

import {
  ART_STYLES,
  DEFAULT_ART_STYLE_ID,
  isArtStyleId,
  resolveArtStyle,
  type ArtStyleId,
} from '@opengame/world-spec';

export type IntakeArchetype =
  | 'top_down'
  | 'ui_heavy'
  | 'platformer'
  | 'tower_defense'
  | 'grid_logic';

export interface DesignIntakeAnswers {
  readonly preferredArchetype: IntakeArchetype;
  /**
   * The picked art style profile id. Used to be loose tone tags like
   * `'warm_pixel'` that no asset prompt ever read, which is why everything came
   * out pixel art regardless of the answer.
   */
  readonly artTone: ArtStyleId;
  readonly winFeel: string;
  readonly cameraNote: string;
}

export const INTAKE_ARCHETYPE_OPTIONS: ReadonlyArray<{
  readonly id: IntakeArchetype;
  readonly titleKey: string;
  readonly descKey: string;
}> = [
  {
    id: 'top_down',
    titleKey: 'intake.arch.top_down.title',
    descKey: 'intake.arch.top_down.desc',
  },
  {
    id: 'ui_heavy',
    titleKey: 'intake.arch.ui_heavy.title',
    descKey: 'intake.arch.ui_heavy.desc',
  },
  {
    id: 'platformer',
    titleKey: 'intake.arch.platformer.title',
    descKey: 'intake.arch.platformer.desc',
  },
  {
    id: 'tower_defense',
    titleKey: 'intake.arch.tower_defense.title',
    descKey: 'intake.arch.tower_defense.desc',
  },
  {
    id: 'grid_logic',
    titleKey: 'intake.arch.grid_logic.title',
    descKey: 'intake.arch.grid_logic.desc',
  },
];

/**
 * The art style picker. Order matters — the first entry is the default the card
 * pre-selects, and it must be a high-fidelity style.
 */
export const INTAKE_ART_TONES: ReadonlyArray<{
  readonly id: ArtStyleId;
  readonly labelKey: string;
  readonly descKey: string;
}> = ART_STYLES.map((p) => ({
  id: p.id,
  labelKey: `intake.art.${p.id}`,
  descKey: `intake.art.${p.id}.desc`,
}));

export const INTAKE_WIN_FEELS: ReadonlyArray<{
  readonly id: string;
  readonly labelKey: string;
}> = [
  { id: 'story_ending', labelKey: 'intake.win.story' },
  { id: 'clear_level', labelKey: 'intake.win.clear' },
  { id: 'survive_waves', labelKey: 'intake.win.waves' },
  { id: 'high_score', labelKey: 'intake.win.score' },
];

/** Guess intake defaults from a free-form prompt (can still be overridden). */
export function inferIntakeDefaults(prompt: string): DesignIntakeAnswers {
  const p = prompt.trim();
  let preferredArchetype: IntakeArchetype = 'platformer';
  if (/视觉小说|纯对话|galgame/i.test(p)) preferredArchetype = 'ui_heavy';
  else if (/塔防|tower\s*defense/i.test(p)) preferredArchetype = 'tower_defense';
  else if (
    /棋盘|五子棋|gomoku|象棋|xiangqi|\bchess\b|消消乐|三消|卡牌|弹幕/i.test(p) &&
    /rpg|角色扮演|武侠|江湖|小镇|探索|走动|找人|俯视/i.test(p)
  ) {
    preferredArchetype = 'top_down';
  } else if (
    /贪吃蛇|2048|消消乐|棋盘|五子棋|gomoku|象棋|xiangqi|\bchess\b/i.test(p)
  ) {
    preferredArchetype = 'grid_logic';
  } else if (
    /rpg|角色扮演|武侠|江湖|小镇|探索|走动|找人|俯视/i.test(p)
  ) {
    preferredArchetype = 'top_down';
  } else if (/横版|跑酷|跳跃|platform/i.test(p)) {
    preferredArchetype = 'platformer';
  }

  // Only honour an explicit style request; an unmentioned style defaults to
  // high fidelity rather than the old pixel guess.
  const artTone = /像素|pixel|8-?bit|赛博|neon|霓虹|水墨|ink|插画|illustration|水彩|painter|油画|2\.5d|isometric/i.test(
    p,
  )
    ? resolveArtStyle({ text: p }).id
    : DEFAULT_ART_STYLE_ID;

  let winFeel = 'clear_level';
  if (preferredArchetype === 'ui_heavy' || preferredArchetype === 'top_down') {
    winFeel = 'story_ending';
  } else if (preferredArchetype === 'tower_defense') {
    winFeel = 'survive_waves';
  } else if (preferredArchetype === 'grid_logic') {
    winFeel = /象棋|xiangqi|\bchess\b|五子棋|gomoku|棋盘|将死/i.test(p)
      ? 'clear_level'
      : 'high_score';
  }

  let cameraNote = 'follow_player';
  if (preferredArchetype === 'ui_heavy') cameraNote = 'fixed_ui';
  else if (preferredArchetype === 'top_down') cameraNote = 'top_down_follow';
  else if (preferredArchetype === 'tower_defense') cameraNote = 'fixed_battlefield';

  return { preferredArchetype, artTone, winFeel, cameraNote };
}

export function formatDesignBrief(answers: DesignIntakeAnswers): string {
  return [
    `preferredArchetype=${answers.preferredArchetype}`,
    `artStyle=${answers.artTone}`,
    `winFeel=${answers.winFeel}`,
    `camera=${answers.cameraNote}`,
  ].join('; ');
}

/** Normalize a persisted / legacy answer into a valid profile id. */
export function artStyleIdOf(value: unknown): ArtStyleId {
  if (isArtStyleId(value)) return value;
  return resolveArtStyle({ text: typeof value === 'string' ? value : null }).id;
}
