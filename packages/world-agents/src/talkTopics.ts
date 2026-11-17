/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Parallel talk circles at one simTime used to share one rumor topic. Assign
 * one forced rumor per region, then rotate witness / object / stance / activity.
 */

import { agentKnowsFact, factKey } from './beliefs.js';
import { rumorClaim } from './copyLocale.js';
import type { MemoryStream } from './memory.js';

/** Share of the town that already knows a rumor — past this, stop forcing it. */
export const RUMOR_SATURATION_RATE = 0.6;
/** MiniMax circles per region per beat — the rest fall back to everyday topics. */
export const MAX_REGION_LLM_TALKS = 8;

export function rumorIsSaturated(
  awareCount: number,
  totalAgents: number,
): boolean {
  if (totalAgents <= 0) return true;
  return awareCount / totalAgents >= RUMOR_SATURATION_RATE;
}

export function rumorAwareness(input: {
  readonly stream: MemoryStream;
  readonly agentIds: readonly string[];
  readonly rumorText: string;
}): {
  readonly awareCount: number;
  readonly total: number;
  readonly saturated: boolean;
} {
  const awareCount = input.agentIds.filter((id) =>
    agentKnowsFact(input.stream, id, input.rumorText),
  ).length;
  return {
    awareCount,
    total: input.agentIds.length,
    saturated: rumorIsSaturated(awareCount, input.agentIds.length),
  };
}

/** Reaction bookkeeping that must never become the spoken topic line. */
export function isRumorRecallTopic(topic: string): boolean {
  return /想起传闻|recalling rumor|镇上在传|Word is out|Someone whispered|Heard from peer/i.test(
    topic,
  );
}

export interface TalkTopicCircle {
  readonly regionId: string;
  readonly participantIds: readonly string[];
  readonly rumorText?: string;
  readonly rumorHasUnknownListener: boolean;
  /** Still inside the reaction window — talk about it even if everyone heard. */
  readonly rumorFresh?: boolean;
  readonly witness?: string;
  readonly objectState?: string;
  readonly stanceSplit?: string;
  readonly activity?: string;
  readonly existingHint?: string;
  readonly ascii?: boolean;
}

export interface AssignedTalkTopic {
  readonly topicHint: string;
  readonly forceRumor: boolean;
  readonly kind: 'rumor' | 'witness' | 'object' | 'stance' | 'activity' | 'present';
}

function presentFallback(ascii: boolean): string {
  return ascii ? 'what is happening right now' : '眼前正在做的事';
}

function cleanHint(text: string | undefined, max = 72): string | undefined {
  const t = text?.trim();
  if (!t) return undefined;
  if (isRumorRecallTopic(t)) return undefined;
  return t.slice(0, max);
}

export function talkTopicKey(text: string): string {
  return factKey(text) || text.slice(0, 24);
}

function topicDedupeKey(text: string): string {
  return talkTopicKey(text);
}

/**
 * One assignment per queued circle. First eligible circle in a region may
 * carry the seed rumor; everyone else gets a different local beat.
 */
export function assignTalkTopics(
  circles: readonly TalkTopicCircle[],
  opts?: {
    readonly rumorSaturated?: boolean;
    /** Topic keys already heard — prefer a beat that is not in this set. */
    readonly recentKeys?: ReadonlySet<string>;
  },
): AssignedTalkTopic[] {
  const saturated = Boolean(opts?.rumorSaturated);
  const rumorUsed = new Set<string>();
  const usedKeys = new Set<string>();
  const out: AssignedTalkTopic[] = [];

  for (const circle of circles) {
    const ascii = Boolean(circle.ascii);
    const region = circle.regionId || '_';
    const rumor = circle.rumorText?.trim();
    const canForce =
      Boolean(rumor) &&
      !rumorUsed.has(region) &&
      (circle.rumorFresh || (!saturated && circle.rumorHasUnknownListener));

    if (canForce && rumor) {
      const claim = rumorClaim(rumor).slice(0, 72);
      rumorUsed.add(region);
      usedKeys.add(topicDedupeKey(claim));
      out.push({
        topicHint: claim,
        forceRumor: true,
        kind: 'rumor',
      });
      continue;
    }

    const candidates: Array<{
      kind: AssignedTalkTopic['kind'];
      text: string;
    }> = [];
    const existing = cleanHint(circle.existingHint);
    if (existing) candidates.push({ kind: 'activity', text: existing });
    const witness = cleanHint(circle.witness);
    if (witness) candidates.push({ kind: 'witness', text: witness });
    const objectState = cleanHint(circle.objectState);
    if (objectState) candidates.push({ kind: 'object', text: objectState });
    const stance = cleanHint(circle.stanceSplit);
    if (stance) {
      candidates.push({
        kind: 'stance',
        text: ascii ? `they disagree: ${stance}` : `看法不一：${stance}`,
      });
    }
    const activity = cleanHint(circle.activity);
    if (activity) candidates.push({ kind: 'activity', text: activity });

    const fresh = candidates.find(
      (c) =>
        !usedKeys.has(topicDedupeKey(c.text)) &&
        !opts?.recentKeys?.has(topicDedupeKey(c.text)),
    );
    const unused = candidates.find((c) => !usedKeys.has(topicDedupeKey(c.text)));
    const pick = fresh ?? unused ?? candidates[0];
    if (pick) {
      usedKeys.add(topicDedupeKey(pick.text));
      out.push({
        topicHint: pick.text,
        forceRumor: false,
        kind: pick.kind,
      });
    } else {
      out.push({
        topicHint: presentFallback(ascii),
        forceRumor: false,
        kind: 'present',
      });
    }
  }
  return out;
}
