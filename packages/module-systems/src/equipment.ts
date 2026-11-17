/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Inventory } from './inventory.js';

export type EquipSlot = 'weapon' | 'armor' | 'accessory';

export interface EquipmentDef {
  readonly id: string;
  readonly slot: EquipSlot;
  readonly atkBonus?: number;
  readonly hpBonus?: number;
}

export class EquipmentLoadout {
  weapon: string | null = null;
  armor: string | null = null;
  accessory: string | null = null;

  equip(slot: EquipSlot, itemId: string, inv: Inventory): boolean {
    if (inv.count(itemId) < 1) return false;
    const prev = this[slot];
    this[slot] = itemId;
    inv.remove(itemId, 1);
    if (prev) inv.add(prev, 1);
    return true;
  }

  bonuses(defs: readonly EquipmentDef[]): { atk: number; hp: number } {
    let atk = 0;
    let hp = 0;
    for (const id of [this.weapon, this.armor, this.accessory]) {
      if (!id) continue;
      const d = defs.find((x) => x.id === id);
      if (!d) continue;
      atk += d.atkBonus ?? 0;
      hp += d.hpBonus ?? 0;
    }
    return { atk, hp };
  }
}
