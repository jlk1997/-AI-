/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Paid 认养 / 巷议 change the living graph, not only MemoryStream.
 * Edges go to a synthetic visitor peer so Postgres stays a pair table.
 */

import { isAsciiCopy } from './copyLocale.js';
import type { MemoryEntry, MemoryStream } from './memory.js';
import { maybeReflect } from './reflect.js';
import {
  formatRelationSummary,
  type SocietyRelation,
} from './relations.js';

/** Observatory already labels this id as product.obs.visitor. */
export const VISITOR_AGENT_ID = 'visitor';

/** One importance-13 认养 memory is enough to write an insight. */
export const ADOPT_REFLECTION_THRESHOLD = 8;

export function influencePairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export function stampAdoptedRelation(
  relations: Map<string, SocietyRelation>,
  agentId: string,
  opts?: { readonly ascii?: boolean },
): SocietyRelation {
  const key = influencePairKey(agentId, VISITOR_AGENT_ID);
  const prev = relations.get(key);
  const ascii = opts?.ascii ?? isAsciiCopy(prev?.summary ?? '');
  const next: SocietyRelation = {
    kind: 'adopted',
    affinity: Math.min(1, Math.max(0.55, prev?.affinity ?? 0)),
    summary: formatRelationSummary(
      'adopted',
      ascii ? 'someone adopted you' : '有人认养了你',
    ),
  };
  relations.set(key, next);
  return next;
}

export function stampRumorRelation(
  relations: Map<string, SocietyRelation>,
  agentId: string,
  rumorText: string,
  opts?: { readonly ascii?: boolean },
): SocietyRelation {
  const key = influencePairKey(agentId, VISITOR_AGENT_ID);
  const prev = relations.get(key);
  if (prev?.kind === 'adopted') {
    return prev;
  }
  const ascii = opts?.ascii ?? isAsciiCopy(`${rumorText}${prev?.summary ?? ''}`);
  const body = rumorText.replace(/^【[^】]+】\s*/u, '').trim().slice(0, 80);
  const next: SocietyRelation = {
    kind: 'rumor',
    affinity: Math.min(1, Math.max(0.35, prev?.affinity ?? 0)),
    summary: formatRelationSummary(
      'rumor',
      body || (ascii ? 'word is out' : '镇上在传'),
    ),
  };
  relations.set(key, next);
  return next;
}

export function stampPaidInfluence(
  relations: Map<string, SocietyRelation>,
  input: {
    readonly agentIds: readonly string[];
    readonly adopt?: boolean;
    readonly rumorText?: string;
    readonly ascii?: boolean;
  },
): void {
  for (const id of input.agentIds) {
    if (input.adopt) {
      stampAdoptedRelation(relations, id, { ascii: input.ascii });
    } else {
      stampRumorRelation(relations, id, input.rumorText ?? '', {
        ascii: input.ascii,
      });
    }
  }
}

/**
 * Persist only resident↔visitor pairs. Do not put every target in
 * `participants` — that would dirty N² NPC pairs on a town rumor.
 */
export function paidInterveneTouch(input: {
  readonly town: boolean;
  readonly targetIds: readonly string[];
  readonly adopt?: boolean;
}): {
  readonly with: string;
  readonly influenceOf: string;
  readonly influenceTargets: readonly string[];
  readonly participants: readonly string[];
  readonly adopt: boolean;
  readonly paid: true;
} {
  const first = input.targetIds[0];
  return {
    with: VISITOR_AGENT_ID,
    influenceOf: VISITOR_AGENT_ID,
    influenceTargets: [...input.targetIds],
    participants: input.town
      ? [VISITOR_AGENT_ID]
      : first
        ? [first, VISITOR_AGENT_ID]
        : [VISITOR_AGENT_ID],
    adopt: Boolean(input.adopt),
    paid: true,
  };
}

export async function maybeReflectAfterAdopt(input: {
  readonly stream: MemoryStream;
  readonly agentId: string;
  readonly agentName: string;
  readonly nowSimTime: number;
  readonly idFactory: () => string;
}): Promise<readonly MemoryEntry[]> {
  const hit = await maybeReflect({
    stream: input.stream,
    agentId: input.agentId,
    agentName: input.agentName,
    nowSimTime: input.nowSimTime,
    sinceSimTime: input.nowSimTime,
    threshold: ADOPT_REFLECTION_THRESHOLD,
    idFactory: input.idFactory,
  });
  return hit?.reflections ?? [];
}
