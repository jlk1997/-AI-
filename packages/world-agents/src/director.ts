/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Story director. Scans tension and records a three-beat arc.
 */

import { directorBeat, type SocietyMind, type StoryArc } from './societyMind.js';

export { directorBeat, type StoryArc };

export function storyArcEvent(arc: StoryArc): {
  id: string;
  simTime: number;
  kind: 'story_arc';
  payload: { phase: StoryArc['phase']; beat: string };
} {
  return {
    id: arc.id,
    simTime: arc.at,
    kind: 'story_arc',
    payload: { phase: arc.phase, beat: arc.beat },
  };
}

export function directStory(
  mind: SocietyMind,
  input: {
    readonly at: number;
    readonly lowAffinityPairs: number;
    readonly stanceClash: boolean;
    readonly openCommitments: number;
  },
): {
  mind: SocietyMind;
  event?: ReturnType<typeof storyArcEvent>;
} {
  const next = directorBeat(mind, input);
  const arc = next.arcs.at(-1);
  const prev = mind.arcs.at(-1);
  if (!arc || prev?.id === arc.id) return { mind: next };
  return { mind: next, event: storyArcEvent(arc) };
}
