/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generative Agents–style memory stream (Park et al., 2023).
 */

import { ensureEmbedding } from './embed.js';

export type MemoryKind = 'observation' | 'reflection' | 'plan' | 'dialogue';

export interface MemoryEntry {
  readonly id: string;
  readonly agentId: string;
  readonly kind: MemoryKind;
  readonly text: string;
  /** Simulation time in hours (fractional ok). */
  readonly simTime: number;
  /** 1–16 importance. Everyday life stays ≤10; paid 巷议 / 认养 / 夜市 may be 13–16. */
  readonly importance: number;
  readonly embedding?: readonly number[];
  lastAccessSimTime: number;
  /** Evidence pointers for reflections (memory ids). */
  readonly pointers: readonly string[];
}

export function createMemoryEntry(input: {
  readonly id: string;
  readonly agentId: string;
  readonly kind: MemoryKind;
  readonly text: string;
  readonly simTime: number;
  readonly importance?: number;
  readonly embedding?: readonly number[];
  readonly pointers?: readonly string[];
}): MemoryEntry {
  return {
    id: input.id,
    agentId: input.agentId,
    kind: input.kind,
    text: input.text,
    simTime: input.simTime,
    importance: Math.max(1, Math.min(16, input.importance ?? 3)),
    embedding: ensureEmbedding(input.text, input.embedding),
    lastAccessSimTime: input.simTime,
    pointers: input.pointers ?? [],
  };
}

export class MemoryStream {
  private readonly byAgent = new Map<string, MemoryEntry[]>();

  add(entry: MemoryEntry): void {
    const list = this.byAgent.get(entry.agentId) ?? [];
    list.push(entry);
    this.byAgent.set(entry.agentId, list);
  }

  list(agentId: string): readonly MemoryEntry[] {
    return this.byAgent.get(agentId) ?? [];
  }

  agentIds(): readonly string[] {
    return [...this.byAgent.keys()];
  }

  get(agentId: string, id: string): MemoryEntry | undefined {
    return this.list(agentId).find((m) => m.id === id);
  }

  /** Replace an entry's vector once a real embedding provider returns. */
  setEmbedding(agentId: string, id: string, embedding: readonly number[]): void {
    const list = this.byAgent.get(agentId);
    if (!list) return;
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return;
    list[idx] = { ...list[idx]!, embedding };
  }

  /** Sum of importance for recent memories (reflection trigger). */
  recentImportanceSum(agentId: string, sinceSimTime: number): number {
    return this.list(agentId)
      .filter((m) => m.simTime >= sinceSimTime && m.kind !== 'reflection')
      .reduce((s, m) => s + m.importance, 0);
  }

  all(): MemoryEntry[] {
    return [...this.byAgent.values()].flat();
  }

  /** Serialize for DB / checkpoints. */
  toJSON(): MemoryEntry[] {
    return this.all();
  }

  static fromJSON(entries: readonly MemoryEntry[]): MemoryStream {
    const s = new MemoryStream();
    for (const e of entries) s.add({ ...e, lastAccessSimTime: e.lastAccessSimTime });
    return s;
  }
}
