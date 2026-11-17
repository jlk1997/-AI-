/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Theory of mind: each resident tracks "I already told them fact X".
 * Stored as 【信念】 memories so it hydrates with the stream (no extra table).
 */

import { createMemoryEntry, type MemoryStream } from './memory.js';
import { isAsciiCopy } from './copyLocale.js';

const HEARSAY_PREFIX =
  /^(听同伴说|镇上在传|有人悄悄对你说|从同行听说|heard from peer|word is out|someone whispered)[：:]\s*/iu;
const BELIEF_PREFIX = /^【信念】/;

export function stripHearsay(text: string): string {
  let out = text.trim();
  for (let i = 0; i < 8 && HEARSAY_PREFIX.test(out); i++) {
    out = out.replace(HEARSAY_PREFIX, '').trim();
  }
  return out;
}

function normalizeFact(text: string): string {
  return stripHearsay(
    text
      .replace(BELIEF_PREFIX, '')
      .replace(/^[^：:]+已经知道：/, '')
      .replace(/^[^:]+\salready knows:\s*/i, ''),
  )
    .toLowerCase()
    .replace(/[\s,，。.!？?；;：:「」""''()（）]+/g, ' ')
    .trim();
}

function shortFactHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
}

/** Identity of a fact, independent of how many mouths it passed through. */
export function factKey(text: string): string {
  const full = normalizeFact(text);
  if (full.length <= 80) return full;
  return `${full.slice(0, 72)}#${shortFactHash(full)}`;
}

/** Topic tokens for CJK + spaced languages — used to detect same-topic disagreement. */
export function topicTokens(key: string): string[] {
  const words = key
    .split(/[\s,，。.!？?；;：:\-/]+/)
    .filter((t) => t.length >= 2);
  const compact = key.replace(/\s+/g, '');
  const grams: string[] = [];
  for (let i = 0; i < compact.length - 1; i++) {
    const pair = compact.slice(i, i + 2);
    if (/[\u4e00-\u9fff]/.test(pair)) grams.push(pair);
  }
  return [...new Set([...words, ...grams])].slice(0, 16);
}

function sameTopicDifferentKey(leftKey: string, rightKey: string): boolean {
  if (!leftKey || !rightKey || leftKey === rightKey) return false;
  const left = topicTokens(leftKey);
  const right = topicTokens(rightKey);
  if (!left.length || !right.length) return false;
  const hits = left.filter((t) =>
    right.some((r) => r === t || r.includes(t) || t.includes(r)),
  ).length;
  return hits >= 2;
}

export function agentKnowsFact(
  stream: MemoryStream,
  agentId: string,
  fact: string,
): boolean {
  const key = factKey(fact);
  if (!key) return false;
  return stream.list(agentId).some((m) => {
    if (BELIEF_PREFIX.test(m.text) || m.text.startsWith('【身份】')) return false;
    return factKey(m.text) === key || m.text.toLowerCase().includes(key.slice(0, 24));
  });
}

/** True when `self` already recorded that `other` has heard this fact. */
export function believesOtherKnows(
  stream: MemoryStream,
  selfId: string,
  otherId: string,
  fact: string,
): boolean {
  const key = factKey(fact);
  if (!key) return false;
  const slice = key.slice(0, 24);
  const needleZh = `已经知道：${slice}`;
  const needleEn = `already knows: ${slice}`.toLowerCase();
  return stream.list(selfId).some((m) => {
    if (!BELIEF_PREFIX.test(m.text)) return false;
    if (!m.text.includes(otherId)) return false;
    return (
      m.text.includes(needleZh) || m.text.toLowerCase().includes(needleEn)
    );
  });
}

export function rememberTold(input: {
  readonly stream: MemoryStream;
  readonly selfId: string;
  readonly otherId: string;
  readonly otherName: string;
  readonly fact: string;
  readonly nowSimTime: number;
  readonly idFactory: () => string;
}): void {
  const key = factKey(input.fact);
  if (!key) return;
  if (
    believesOtherKnows(
      input.stream,
      input.selfId,
      input.otherId,
      input.fact,
    )
  ) {
    return;
  }
  const ascii = isAsciiCopy(`${input.otherName}${input.fact}`);
  input.stream.add(
    createMemoryEntry({
      id: input.idFactory(),
      agentId: input.selfId,
      kind: 'observation',
      text: ascii
        ? `【信念】${input.otherName} (${input.otherId}) already knows: ${key}`
        : `【信念】${input.otherName}（${input.otherId}）已经知道：${key}`,
      simTime: input.nowSimTime,
      importance: 3,
    }),
  );
}

export interface StanceCard {
  readonly secret?: string;
  readonly stance?: string;
  readonly withholdFrom?: readonly string[];
  /** People this resident already ties to — used by “don't pass rumors to outsiders”. */
  readonly knownIds?: readonly string[];
}

export function withholdsFromOutsiders(stance?: string): boolean {
  return /闲话不传给外人|不传给外人|do not pass rumors to outsiders|not pass rumors/i.test(
    stance ?? '',
  );
}

export function shouldTell(
  stream: MemoryStream,
  selfId: string,
  otherId: string,
  fact: string,
  card?: StanceCard,
): boolean {
  if (card?.withholdFrom?.some((id) => id === otherId || id.length > 1 && fact.includes(id))) {
    return false;
  }
  if (card?.withholdFrom?.includes(otherId)) return false;
  if (withholdsFromOutsiders(card?.stance)) {
    const known = card?.knownIds;
    // Missing knownIds used to leak gossip to strangers. Fail closed.
    if (!known || !known.includes(otherId)) return false;
  }
  if (card?.secret) {
    const secretKey = factKey(card.secret);
    if (secretKey && (factKey(fact) === secretKey || fact.includes(card.secret.slice(0, 12)))) {
      return false;
    }
  }
  if (agentKnowsFact(stream, otherId, fact)) return false;
  if (believesOtherKnows(stream, selfId, otherId, fact)) return false;
  return true;
}

/** Same topic, different factKey — interview and converse must admit the split. */
export function findConflictingMemories(
  stream: MemoryStream,
  agentId: string,
): ReadonlyArray<{ readonly a: string; readonly b: string }> {
  const facts = stream
    .list(agentId)
    .filter(
      (m) =>
        m.importance >= 6 &&
        !m.text.startsWith('【') &&
        m.kind !== 'reflection',
    );
  const out: Array<{ a: string; b: string }> = [];
  for (let i = 0; i < facts.length; i++) {
    const left = facts[i]!;
    const leftKey = factKey(left.text);
    for (let j = i + 1; j < facts.length; j++) {
      const right = facts[j]!;
      const rightKey = factKey(right.text);
      if (sameTopicDifferentKey(leftKey, rightKey)) {
        out.push({ a: left.text, b: right.text });
      }
    }
  }
  return out.slice(0, 4);
}

export interface TownDisagreement {
  readonly leftId: string;
  readonly rightId: string;
  readonly a: string;
  readonly b: string;
}

/** Two residents hold opposite facts on the same topic — must be spoken, not overwritten. */
export function findTownDisagreements(
  stream: MemoryStream,
  agentIds: readonly string[],
): readonly TownDisagreement[] {
  const facts: Array<{ agentId: string; text: string; key: string }> = [];
  for (const id of agentIds) {
    for (const m of stream.list(id)) {
      if (m.importance < 6 || m.text.startsWith('【') || m.kind === 'reflection') {
        continue;
      }
      const key = factKey(m.text);
      if (key) facts.push({ agentId: id, text: m.text, key });
    }
  }
  const out: TownDisagreement[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < facts.length; i++) {
    const left = facts[i]!;
    for (let j = i + 1; j < facts.length; j++) {
      const right = facts[j]!;
      if (left.agentId === right.agentId) continue;
      if (!sameTopicDifferentKey(left.key, right.key)) continue;
      const pair = [left.agentId, right.agentId].sort().join(':');
      const sig = `${pair}:${left.key.slice(0, 24)}:${right.key.slice(0, 24)}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({
        leftId: left.agentId,
        rightId: right.agentId,
        a: left.text,
        b: right.text,
      });
    }
  }
  return out.slice(0, 6);
}
