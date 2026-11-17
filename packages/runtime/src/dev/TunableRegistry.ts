/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TunableSpec } from '../dsl/schema.js';

export interface TunableEntry {
  readonly entityId: string;
  readonly key: string;
  readonly spec: TunableSpec;
}

/**
 * Lightweight global so games and the IDE share a single source of truth for
 * tunables without coupling to Phaser internals. The DSL loader populates the
 * registry during scene setup; the IDE can then `list()` to render its
 * parameter panel and `set()` to apply changes (typically arrives via
 * `postMessage` from `HotReload.ts`).
 */
class TunableRegistry {
  private readonly entries = new Map<string, TunableEntry>();
  private readonly subscribers = new Set<(e: TunableEntry) => void>();

  private id(entityId: string, key: string): string {
    return `${entityId}::${key}`;
  }

  register(entityId: string, key: string, spec: TunableSpec): void {
    this.entries.set(this.id(entityId, key), { entityId, key, spec });
  }

  unregister(entityId: string, key: string): void {
    this.entries.delete(this.id(entityId, key));
  }

  set(entityId: string, key: string, value: TunableSpec['value']): void {
    const id = this.id(entityId, key);
    const cur = this.entries.get(id);
    if (!cur) return;
    const updated: TunableEntry = {
      entityId,
      key,
      spec: { ...cur.spec, value },
    };
    this.entries.set(id, updated);
    for (const sub of this.subscribers) sub(updated);
  }

  list(): TunableEntry[] {
    return [...this.entries.values()];
  }

  subscribe(fn: (e: TunableEntry) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }
}

export const tunables = new TunableRegistry();
