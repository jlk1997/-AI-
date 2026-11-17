/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly stackable?: boolean;
  readonly maxStack?: number;
  readonly price?: number;
  readonly tags?: readonly string[];
}

export interface InventorySlot {
  itemId: string;
  qty: number;
}

export class Inventory {
  readonly slots: InventorySlot[] = [];
  constructor(readonly capacity = 24) {}

  count(itemId: string): number {
    return this.slots
      .filter((s) => s.itemId === itemId)
      .reduce((n, s) => n + s.qty, 0);
  }

  add(itemId: string, qty = 1): boolean {
    if (qty <= 0) return true;
    const existing = this.slots.find((s) => s.itemId === itemId);
    if (existing) {
      existing.qty += qty;
      return true;
    }
    if (this.slots.length >= this.capacity) return false;
    this.slots.push({ itemId, qty });
    return true;
  }

  remove(itemId: string, qty = 1): boolean {
    let left = qty;
    for (const s of this.slots) {
      if (s.itemId !== itemId) continue;
      const take = Math.min(s.qty, left);
      s.qty -= take;
      left -= take;
      if (left <= 0) break;
    }
    for (let i = this.slots.length - 1; i >= 0; i--) {
      if (this.slots[i]!.qty <= 0) this.slots.splice(i, 1);
    }
    return left <= 0;
  }

  toJSON(): InventorySlot[] {
    return this.slots.map((s) => ({ ...s }));
  }

  static fromJSON(slots: InventorySlot[], capacity = 24): Inventory {
    const inv = new Inventory(capacity);
    for (const s of slots) inv.slots.push({ ...s });
    return inv;
  }
}
