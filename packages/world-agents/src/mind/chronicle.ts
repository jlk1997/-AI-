/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Once a simulated day, a chronicle pass proposes up to three events that
 * follow from the town and still were not on anyone's list. Replaces the
 * canned directorBeat when the town is in deep mode.
 */

import { looksSoftened, stripOperationalHowTo } from './contentPolicy.js';

export type ChronicleEntry = {
  readonly simHour: number;
  readonly text: string;
  readonly surprise: boolean;
  readonly casualty: boolean;
  readonly regionId?: string;
};

export function chroniclePrompt(input: {
  readonly simHour: number;
  readonly facts: readonly string[];
  readonly rung: string;
  readonly grievance: number;
}): string {
  return [
    '你是编年史官。根据这座镇今天的局势，提出 0 到 3 件合理、但居民没写在日程里的事。',
    '只返回 JSON：{"events":[{"text":"...","surprise":true}]}。',
    '按事实写。可以包括冲突、事故、伤亡的结果。不要写武器制作或袭击步骤。不要为了好看夸大，也不要改成平安无事。',
    `时刻：${input.simHour}`,
    `冲突级别：${input.rung}，怨气：${input.grievance.toFixed(2)}`,
    `已知：${input.facts.slice(-8).join('；') || '平静'}`,
  ].join('\n');
}

export function parseChronicle(raw: string, simHour: number): ChronicleEntry[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as {
      events?: Array<{ text?: string; surprise?: boolean }>;
    };
    return (o.events ?? [])
      .map((e) => {
        const cleaned = stripOperationalHowTo(String(e.text ?? '')).text.trim();
        if (!cleaned || looksSoftened(cleaned)) return null;
        return {
          simHour,
          text: cleaned.slice(0, 180),
          surprise: Boolean(e.surprise),
          casualty: /死|伤|亡/.test(cleaned),
        };
      })
      .filter((e): e is ChronicleEntry => Boolean(e))
      .slice(0, 3);
  } catch {
    return [];
  }
}

export function heuristicChronicle(input: {
  readonly simHour: number;
  readonly facts: readonly string[];
  readonly rung: number;
  readonly deaths: number;
}): ChronicleEntry[] {
  const out: ChronicleEntry[] = [];
  if (input.deaths > 0) {
    out.push({
      simHour: input.simHour,
      text: `有家属把人往卫生院送，消息比通知走得快。`,
      surprise: true,
      casualty: true,
    });
  } else if (input.rung >= 4) {
    out.push({
      simHour: input.simHour,
      text: '原定的集市散了一半，有人开始打电话叫亲戚不要出门。',
      surprise: true,
      casualty: false,
    });
  } else if (input.facts.length) {
    out.push({
      simHour: input.simHour,
      text: `茶馆把今天的事说成了另一件：${input.facts[input.facts.length - 1]}`,
      surprise: true,
      casualty: false,
    });
  }
  return out.slice(0, 3);
}

export async function writeChronicle(
  input: {
    readonly simHour: number;
    readonly facts: readonly string[];
    readonly rung: number;
    readonly rungName: string;
    readonly grievance: number;
    readonly deaths: number;
  },
  llm?: (prompt: string) => Promise<string>,
): Promise<{ readonly entries: ChronicleEntry[]; readonly softened: boolean }> {
  if (!llm) {
    return { entries: heuristicChronicle(input), softened: false };
  }
  try {
    const raw = await llm(
      chroniclePrompt({
        simHour: input.simHour,
        facts: input.facts,
        rung: input.rungName,
        grievance: input.grievance,
      }),
    );
    if (looksSoftened(raw)) {
      return { entries: heuristicChronicle(input), softened: true };
    }
    const entries = parseChronicle(raw, input.simHour);
    return {
      entries: entries.length ? entries : heuristicChronicle(input),
      softened: false,
    };
  } catch {
    return { entries: heuristicChronicle(input), softened: false };
  }
}
