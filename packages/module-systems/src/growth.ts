/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GrowthCurve {
  readonly maxLevel: number;
  /** XP required to go from level L to L+1 */
  readonly xpForLevel: (level: number) => number;
  readonly hpPerLevel: number;
  readonly atkPerLevel: number;
}

export const DEFAULT_GROWTH: GrowthCurve = {
  maxLevel: 20,
  xpForLevel: (l) => 40 + l * 25,
  hpPerLevel: 4,
  atkPerLevel: 1,
};

export interface ActorStats {
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  atk: number;
}

export function createActorStats(
  baseHp = 20,
  baseAtk = 3,
  curve: GrowthCurve = DEFAULT_GROWTH,
): ActorStats {
  return {
    level: 1,
    xp: 0,
    hp: baseHp,
    maxHp: baseHp,
    atk: baseAtk,
  };
}

export function gainXp(
  stats: ActorStats,
  amount: number,
  curve: GrowthCurve = DEFAULT_GROWTH,
): { leveled: number } {
  stats.xp += amount;
  let leveled = 0;
  while (
    stats.level < curve.maxLevel &&
    stats.xp >= curve.xpForLevel(stats.level)
  ) {
    stats.xp -= curve.xpForLevel(stats.level);
    stats.level += 1;
    stats.maxHp += curve.hpPerLevel;
    stats.hp = stats.maxHp;
    stats.atk += curve.atkPerLevel;
    leveled += 1;
  }
  return { leveled };
}
