/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Combatant {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  atk: number;
  /** ATB gauge 0–100; turn ready at 100. */
  gauge: number;
  speed: number;
  statuses: StatusEffect[];
}

export interface StatusEffect {
  readonly id: string;
  readonly name: string;
  remainingTurns: number;
  readonly atkMul?: number;
  readonly dot?: number;
}

export type CombatAction =
  | { kind: 'attack'; targetId: string }
  | { kind: 'skill'; skillId: string; targetId: string }
  | { kind: 'defend' };

export interface SkillDef {
  readonly id: string;
  readonly name: string;
  readonly power: number;
  readonly status?: Omit<StatusEffect, 'remainingTurns'> & {
    turns: number;
  };
}

export class TurnCombat {
  constructor(
    readonly allies: Combatant[],
    readonly enemies: Combatant[],
    readonly skills: readonly SkillDef[] = [],
  ) {}

  living(side: 'allies' | 'enemies'): Combatant[] {
    return (side === 'allies' ? this.allies : this.enemies).filter(
      (c) => c.hp > 0,
    );
  }

  /** Advance ATB until someone is ready; returns ready combatant or null if ended. */
  tickGauges(): Combatant | null {
    if (!this.living('allies').length || !this.living('enemies').length) {
      return null;
    }
    for (let guard = 0; guard < 500; guard++) {
      for (const c of [...this.allies, ...this.enemies]) {
        if (c.hp <= 0) continue;
        c.gauge += c.speed;
        if (c.gauge >= 100) {
          c.gauge -= 100;
          return c;
        }
      }
    }
    return null;
  }

  applyAction(actor: Combatant, action: CombatAction): string {
    this.tickStatuses(actor);
    if (action.kind === 'defend') {
      actor.statuses.push({
        id: 'defend',
        name: 'Defend',
        remainingTurns: 1,
        atkMul: 0.5,
      });
      return `${actor.name} defends`;
    }
    const target =
      [...this.allies, ...this.enemies].find(
        (c) =>
          c.id ===
          (action.kind === 'attack' || action.kind === 'skill'
            ? action.targetId
            : ''),
      ) ?? null;
    if (!target || target.hp <= 0) return `${actor.name} wasted action`;

    let power = actor.atk;
    if (action.kind === 'skill') {
      const sk = this.skills.find((s) => s.id === action.skillId);
      power = actor.atk + (sk?.power ?? 0);
      if (sk?.status) {
        target.statuses.push({
          id: sk.status.id,
          name: sk.status.name,
          remainingTurns: sk.status.turns,
          atkMul: sk.status.atkMul,
          dot: sk.status.dot,
        });
      }
    }
    const defend = target.statuses.find((s) => s.id === 'defend');
    const dmg = Math.max(1, Math.floor(power * (defend ? 0.5 : 1)));
    target.hp = Math.max(0, target.hp - dmg);
    return `${actor.name} hits ${target.name} for ${dmg}`;
  }

  private tickStatuses(c: Combatant): void {
    for (const s of c.statuses) {
      if (s.dot) c.hp = Math.max(0, c.hp - s.dot);
      s.remainingTurns -= 1;
    }
    c.statuses = c.statuses.filter((s) => s.remainingTurns > 0);
  }

  outcome(): 'ongoing' | 'win' | 'lose' {
    if (!this.living('enemies').length) return 'win';
    if (!this.living('allies').length) return 'lose';
    return 'ongoing';
  }
}
