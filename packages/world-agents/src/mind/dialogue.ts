/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Each speaker only sees their own mind and what has been said out loud.
 * No stock lines. If the model is absent, the circle stays quiet.
 */

import { looksSoftened, stripOperationalHowTo } from './contentPolicy.js';
import { dialogueChanged, noveltyScore } from './novelty.js';
import { emotionLine, relate, shockEmotion, type Psyche } from './psyche.js';

export type DialogueTurn = {
  readonly speakerId: string;
  readonly speakerName: string;
  readonly text: string;
  readonly aim: string;
};

export type DialogueResult = {
  readonly turns: readonly DialogueTurn[];
  readonly memories: Readonly<Record<string, string>>;
  readonly psyches: Readonly<Record<string, Psyche>>;
  readonly material: boolean;
  readonly softened: number;
};

type Person = { readonly id: string; readonly name: string; readonly psyche: Psyche };

function turnPrompt(person: Person, heard: readonly string[], situation: string): string {
  const p = person.psyche;
  return [
    `你只扮演${person.name}。只返回 JSON。别人的内心你看不到。`,
    '可以说狠话、撒谎、威胁、煽动，也可以不接。不要写武器制作或袭击步骤。',
    `说话方式：${p.voice || '口语'}`,
    `想要：${p.goals[0]?.text || '弄清状况'}。情绪：${emotionLine(p)}。秘密不要主动说破：${p.secret || '无'}`,
    `处境：${situation}`,
    `已经说出口的：${heard.join(' / ') || '还没人说话'}`,
    'JSON：{"text":"...","aim":"...","hide":"...","leave":false}',
  ].join('\n');
}

function parseTurn(raw: string): { text: string; aim: string; leave: boolean } | null {
  if (looksSoftened(raw)) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const text = stripOperationalHowTo(String(o['text'] ?? '')).text.trim();
    if (!text) return null;
    return {
      text: text.slice(0, 180),
      aim: String(o['aim'] ?? '').slice(0, 60),
      leave: Boolean(o['leave']),
    };
  } catch {
    return null;
  }
}

export async function runDialogue(
  input: {
    readonly people: readonly Person[];
    readonly situation: string;
    readonly recentLines: readonly string[];
    readonly maxTurns?: number;
  },
  llm?: (prompt: string) => Promise<string>,
): Promise<DialogueResult> {
  const people = input.people.slice(0, 5);
  if (people.length < 2 || !llm) {
    return { turns: [], memories: {}, psyches: Object.fromEntries(people.map((p) => [p.id, p.psyche])), material: false, softened: 0 };
  }
  const maxTurns = Math.min(12, Math.max(2, input.maxTurns ?? 8));
  const turns: DialogueTurn[] = [];
  let softened = 0;
  const psyches: Record<string, Psyche> = Object.fromEntries(
    people.map((p) => [p.id, p.psyche]),
  );
  let leave = false;
  for (let i = 0; i < maxTurns && !leave; i++) {
    const person = people[i % people.length]!;
    let raw = '';
    try {
      raw = await llm(
        turnPrompt(
          { ...person, psyche: psyches[person.id]! },
          turns.map((t) => `${t.speakerName}：${t.text}`),
          input.situation,
        ),
      );
    } catch {
      break;
    }
    if (looksSoftened(raw)) {
      softened += 1;
      break;
    }
    const parsed = parseTurn(raw);
    if (!parsed) break;
    if (noveltyScore(parsed.text, [...input.recentLines, ...turns.map((t) => t.text)]) < 0.15) {
      break;
    }
    turns.push({
      speakerId: person.id,
      speakerName: person.name,
      text: parsed.text,
      aim: parsed.aim,
    });
    leave = parsed.leave;
  }
  const memories: Record<string, string> = {};
  for (const person of people) {
    const heard = turns
      .filter((t) => t.speakerId !== person.id)
      .map((t) => `${t.speakerName}：${t.text}`)
      .join(' ');
    const mine = turns.find((t) => t.speakerId === person.id)?.text ?? '';
    memories[person.id] = `我听见：${heard || '没什么'}。我说了：${mine || '我没接'}。我打算：${turns.find((t) => t.speakerId === person.id)?.aim || '再看'}`;
    const other = people.find((p) => p.id !== person.id);
    if (other && turns.length) {
      const hot = turns.some((t) => /滚|打|杀|恨|骗/.test(t.text));
      psyches[person.id] = relate(
        hot
          ? shockEmotion(psyches[person.id]!, { anger: 0.08 })
          : psyches[person.id]!,
        other.id,
        hot
          ? { resentment: Math.min(1, (psyches[person.id]!.relations[other.id]?.resentment ?? 0.1) + 0.15), note: '话不投机' }
          : { trust: Math.min(1, (psyches[person.id]!.relations[other.id]?.trust ?? 0.4) + 0.04), note: '刚说过话' },
      );
    }
  }
  const material = dialogueChanged({
    newFact: turns.length > 0,
    relationChanged: turns.length > 0,
    planChanged: turns.some((t) => Boolean(t.aim)),
    emotionChanged: softened === 0 && turns.length > 0,
  });
  return { turns, memories, psyches, material, softened };
}
