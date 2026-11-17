/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** Per-entity numeric state (HP, MP, etc.) — replaces scene-wide single-key hacks. */
export class EntityStateRegistry {
  private readonly values = new Map<string, Map<string, number>>();

  applyFromSpec(entityId: string, state: Record<string, number> | undefined): void {
    if (!state) return;
    const row = new Map<string, number>();
    for (const [key, value] of Object.entries(state)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        row.set(key, value);
      }
    }
    if (row.size > 0) {
      this.values.set(entityId, row);
    }
  }

  get(entityId: string, key: string): number | undefined {
    return this.values.get(entityId)?.get(key);
  }

  set(entityId: string, key: string, value: number): void {
    let row = this.values.get(entityId);
    if (!row) {
      row = new Map();
      this.values.set(entityId, row);
    }
    row.set(key, value);
  }

  adjust(entityId: string, key: string, delta: number): number {
    const current = this.get(entityId, key) ?? 0;
    const next = current + delta;
    this.set(entityId, key, next);
    return next;
  }

  removeEntity(entityId: string): void {
    this.values.delete(entityId);
  }

  snapshot(entityId: string): Record<string, number> {
    const row = this.values.get(entityId);
    if (!row) return {};
    return Object.fromEntries(row.entries());
  }
}
