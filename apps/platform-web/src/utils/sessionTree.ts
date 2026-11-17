/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Order chat sessions so forks sit under the parent they were copied from.
 */

export type SessionTreeInput = {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly parentId?: string | null;
};

export type SessionTreeRow = SessionTreeInput & {
  readonly parentId: string | null;
  readonly depth: number;
  readonly parentTitle: string | null;
};

export function orderSessionsAsTree(
  sessions: readonly SessionTreeInput[],
): SessionTreeRow[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const children = new Map<string, SessionTreeInput[]>();
  const roots: SessionTreeInput[] = [];
  for (const session of sessions) {
    const parentId = session.parentId ?? null;
    if (parentId && byId.has(parentId)) {
      const list = children.get(parentId) ?? [];
      list.push(session);
      children.set(parentId, list);
    } else {
      roots.push(session);
    }
  }
  const out: SessionTreeRow[] = [];
  const walk = (node: SessionTreeInput, depth: number): void => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    out.push({
      ...node,
      parentId: node.parentId ?? null,
      depth,
      parentTitle: parent?.title ?? null,
    });
    for (const child of children.get(node.id) ?? []) {
      walk(child, depth + 1);
    }
  };
  for (const root of roots) walk(root, 0);
  return out;
}
