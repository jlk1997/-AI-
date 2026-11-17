/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Inventory, ItemDef } from './inventory.js';

export class Shop {
  constructor(
    readonly catalog: readonly ItemDef[],
    public gold: number,
  ) {}

  buy(itemId: string, inv: Inventory, qty = 1): boolean {
    const def = this.catalog.find((c) => c.id === itemId);
    if (!def?.price) return false;
    const cost = def.price * qty;
    if (this.gold < cost) return false;
    if (!inv.add(itemId, qty)) return false;
    this.gold -= cost;
    return true;
  }

  sell(itemId: string, inv: Inventory, qty = 1): boolean {
    const def = this.catalog.find((c) => c.id === itemId);
    if (!def?.price) return false;
    if (!inv.remove(itemId, qty)) return false;
    this.gold += Math.floor(def.price * 0.5) * qty;
    return true;
  }
}

export interface Recipe {
  readonly id: string;
  readonly inputs: readonly { itemId: string; qty: number }[];
  readonly output: { itemId: string; qty: number };
}

export function craft(recipe: Recipe, inv: Inventory): boolean {
  for (const i of recipe.inputs) {
    if (inv.count(i.itemId) < i.qty) return false;
  }
  for (const i of recipe.inputs) inv.remove(i.itemId, i.qty);
  return inv.add(recipe.output.itemId, recipe.output.qty);
}
