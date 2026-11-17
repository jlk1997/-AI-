/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MechanicSpec, NamedLoop } from './types.js';

export function mergeNamedLoops(
  spec: MechanicSpec,
  extra: readonly NamedLoop[],
): MechanicSpec {
  const loops = [...spec.loops];
  for (const loop of extra) {
    if (!loops.some((l) => l.id === loop.id)) loops.push(loop);
  }
  return { ...spec, loops, updatedAt: new Date().toISOString() };
}

/** Thin loops get a hint. Custom loops keep the user's phrase as the only
 * required signal — do not pad registry.won (that would let any win flag pass). */
export function padThinLoops(spec: MechanicSpec): MechanicSpec {
  const loops = spec.loops.map((loop) => {
    const hint =
      loop.hint ?? `实现「${loop.label}」可重复循环 + 胜负，不要用无关街机冒充`;
    if (loop.source === 'custom') {
      return { ...loop, hint };
    }
    if (loop.signals.length >= 2 && loop.hint) return loop;
    const extra = 'playJuice';
    const signals = loop.signals.includes(extra)
      ? loop.signals
      : [...loop.signals, extra];
    return { ...loop, signals, hint };
  });
  return { ...spec, loops, updatedAt: new Date().toISOString() };
}

const LEXICON_COVERED =
  /画面|好看|音乐|美术|象棋|棋盘|走子|对话|商店|钓鱼|塔防|贪吃蛇|消消乐|三消|卡牌|手牌|弹幕|探索|走动|跳跃|选项|将死|五子|2048|flappy/i;

function alreadyCovered(raw: string, existing: readonly NamedLoop[]): boolean {
  return existing.some(
    (l) => l.label.includes(raw) || raw.includes(l.label) || l.id.includes(raw),
  );
}

export function extractCustomLoops(
  hay: string,
  existing: readonly NamedLoop[],
): NamedLoop[] {
  const found: NamedLoop[] = [];
  const seen = new Set<string>();
  const patterns = [
    /可以(.{1,8}?)的游戏/g,
    /可以(.{1,8}?)的/g,
    /加一个(.{1,8}?)循环/g,
    /加上(.{1,8}?)循环/g,
    /要有(.{1,8}?)玩法/g,
    /还能(.{1,8}?)(?:，|。|$)/g,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay)) !== null) {
      const raw = m[1]?.trim();
      if (!raw || raw.length < 2) continue;
      if (LEXICON_COVERED.test(raw)) continue;
      if (alreadyCovered(raw, existing) || alreadyCovered(raw, found)) continue;
      const id = `custom-${raw.replace(/\s+/g, '').slice(0, 12)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      found.push({
        id,
        label: raw,
        signals: [raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')],
        source: 'custom',
        hint: `实现「${raw}」循环，不要用无关街机壳冒充`,
      });
    }
  }
  return found;
}

/** First custom loop, if any. Lexicon loops no longer hide custom promises. */
export function extractCustomLoop(
  hay: string,
  existing: readonly NamedLoop[],
): NamedLoop | null {
  return extractCustomLoops(hay, existing)[0] ?? null;
}

export function uniqModules<T>(list: readonly T[]): T[] {
  return [...new Set(list)];
}
