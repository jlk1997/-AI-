/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SaveBlob {
  readonly slot: string;
  readonly savedAt: string;
  readonly payload: Record<string, unknown>;
}

export class SaveStore {
  private readonly slots = new Map<string, SaveBlob>();

  write(slot: string, payload: Record<string, unknown>): SaveBlob {
    const blob: SaveBlob = {
      slot,
      savedAt: new Date().toISOString(),
      payload: structuredClone(payload),
    };
    this.slots.set(slot, blob);
    return blob;
  }

  read(slot: string): SaveBlob | null {
    return this.slots.get(slot) ?? null;
  }

  list(): string[] {
    return [...this.slots.keys()];
  }
}
