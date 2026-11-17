/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export class ReputationBoard {
  private readonly scores = new Map<string, number>();

  get(factionId: string): number {
    return this.scores.get(factionId) ?? 0;
  }

  adjust(factionId: string, delta: number): number {
    const next = Math.max(-100, Math.min(100, this.get(factionId) + delta));
    this.scores.set(factionId, next);
    return next;
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries(this.scores);
  }

  static fromJSON(data: Record<string, number>): ReputationBoard {
    const b = new ReputationBoard();
    for (const [k, v] of Object.entries(data)) b.scores.set(k, v);
    return b;
  }
}
