/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Active residents spend the model. Everyone else keeps walking.
 * Small towns stay fully active so the old loop does not change.
 */

export const COGNITION_TIER_MIN_AGENTS = 36;
export const ACTIVE_AGENT_CAP = 48;

/** Appraisal and reflection stay on the cheap lane. Talks can opt into the expensive one. */
export function preferredTaskLane(
  task: 'appraisal' | 'talk' | 'reflect',
  talkLane?: 'floor' | 'lit',
): 'floor' | 'lit' {
  if (task === 'talk' && talkLane === 'lit') return 'lit';
  return 'floor';
}

export function activeAgentIds(input: {
  readonly agentCount: number;
  readonly agentIds: readonly string[];
  readonly regionOf: (id: string) => string | undefined;
  readonly leaderIds?: readonly string[];
  readonly policyTags?: readonly string[];
  readonly occupationOf?: (id: string) => string | undefined;
  readonly nameOf?: (id: string) => string | undefined;
  readonly collectiveRegionId?: string;
}): string[] | undefined {
  if (input.agentCount <= COGNITION_TIER_MIN_AGENTS) return undefined;
  const tags = (input.policyTags ?? []).map((t) => t.trim()).filter(Boolean);
  const wanted = new Set<string>(input.leaderIds ?? []);
  for (const id of input.agentIds) {
    if (wanted.size >= ACTIVE_AGENT_CAP) break;
    const region = input.regionOf(id);
    if (input.collectiveRegionId && region === input.collectiveRegionId) {
      wanted.add(id);
      continue;
    }
    if (!tags.length) continue;
    const hay = `${input.occupationOf?.(id) ?? ''} ${region ?? ''} ${input.nameOf?.(id) ?? ''}`;
    if (tags.some((tag) => hay.includes(tag))) wanted.add(id);
  }
  if (wanted.size < 8) {
    for (const id of input.agentIds) {
      wanted.add(id);
      if (wanted.size >= 8) break;
    }
  }
  return [...wanted].slice(0, ACTIVE_AGENT_CAP);
}
