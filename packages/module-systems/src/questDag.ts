/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export type QuestNodeStatus = 'locked' | 'available' | 'active' | 'done' | 'failed';

export interface QuestNode {
  readonly id: string;
  readonly title: string;
  readonly requires: readonly string[];
  readonly description?: string;
  status: QuestNodeStatus;
}

/** DAG quest runtime — unlock dependents when prerequisites are done. */
export class QuestDag {
  constructor(readonly nodes: QuestNode[]) {
    this.refreshAvailability();
  }

  get(id: string): QuestNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  start(id: string): boolean {
    const n = this.get(id);
    if (!n || n.status !== 'available') return false;
    n.status = 'active';
    return true;
  }

  complete(id: string): boolean {
    const n = this.get(id);
    if (!n || n.status !== 'active') return false;
    n.status = 'done';
    this.refreshAvailability();
    return true;
  }

  fail(id: string): boolean {
    const n = this.get(id);
    if (!n || (n.status !== 'active' && n.status !== 'available')) return false;
    n.status = 'failed';
    return true;
  }

  refreshAvailability(): void {
    for (const n of this.nodes) {
      if (n.status === 'done' || n.status === 'failed' || n.status === 'active') {
        continue;
      }
      const ok = n.requires.every((r) => this.get(r)?.status === 'done');
      n.status = ok ? 'available' : 'locked';
    }
  }

  activeCount(): number {
    return this.nodes.filter((n) => n.status === 'active').length;
  }

  doneCount(): number {
    return this.nodes.filter((n) => n.status === 'done').length;
  }
}
