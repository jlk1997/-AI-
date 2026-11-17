/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Natural-language interview of one resident (Park et al. main eval).
 * Observatory-only — never mixed into RPG generate.
 */

import { embedQuery } from './embedProvider.js';
import type { EmbedTextsFn } from './embedProvider.js';
import { createMemoryEntry, type MemoryEntry, type MemoryStream } from './memory.js';
import type { LlmTextFn } from './reflect.js';
import { retrieveMemories } from './retrieval.js';
import { isBookkeepingMemory, isRepeatLine, layeredTalkMemories } from './converse.js';
import { findConflictingMemories, findTownDisagreements } from './beliefs.js';
import {
  interviewMemory,
  isAdoptMemoryText,
  isAsciiCopy,
  isInterviewEcho,
  isPaidTraceMemory,
} from './copyLocale.js';

const SAME_DAY_HOURS = 16;

function parseInterviewMemory(
  text: string,
): { q: string; a: string } | undefined {
  const zh = /问：「([^」]*)」。我答：「([^」]*)」/.exec(text);
  if (zh) return { q: zh[1]!, a: zh[2]! };
  const en = /asked: "([^"]*)"\. I said: "([^"]*)"/.exec(text);
  if (en) return { q: en[1]!, a: en[2]! };
  return undefined;
}

export interface InterviewResult {
  readonly agentId: string;
  readonly agentName: string;
  readonly question: string;
  readonly answer: string;
  readonly cited: readonly string[];
  readonly citedMemoryIds: readonly string[];
  /** MiniMax answer, or a memory recitation when the hourly talk cap is spent. */
  readonly source?: 'model' | 'memory';
}

/** First-person recitation from memories — no MiniMax, no talk-cap spend. */
export function composeMemoryInterviewAnswer(input: {
  readonly question: string;
  readonly memories: readonly string[];
  readonly ascii: boolean;
}): string {
  const q = input.question.trim().slice(0, 40);
  const bits = input.memories.map((m) => m.trim()).filter(Boolean).slice(0, 3);
  if (!bits.length) {
    return input.ascii
      ? `I don't remember enough about that yet. People are still walking; ask me again after I've lived a bit more of this hour.`
      : `这件事我这阵子没记下什么。人还在走，等我再记下新的，你再问我。`;
  }
  if (input.ascii) {
    const body = bits.map((b, i) => (i === 0 ? b : `Also, ${b}`)).join(' ');
    return `You asked about "${q}". ${body} That's what I can stand on for now.`;
  }
  const body = bits.map((b, i) => (i === 0 ? b : `另外，${b}`)).join('');
  return `你问「${q}」。我还记得：${body} 眼下只能先说到这儿。`;
}

function gatherInterviewMemories(input: {
  readonly stream: MemoryStream;
  readonly agentId: string;
  readonly question: string;
  readonly nowSimTime: number;
  readonly queryEmbedding?: number[];
}): MemoryEntry[] {
  const q = input.question.trim().slice(0, 200);
  const all = input.stream.list(input.agentId);
  const retrieved = retrieveMemories(all, q, input.nowSimTime, {
    limit: 8,
    queryEmbedding: input.queryEmbedding,
  }).filter((m) => !isBookkeepingMemory(m.text));
  const paid = all.filter(
    (m) => isPaidTraceMemory(m.text) && !isBookkeepingMemory(m.text),
  );
  const adoptAsked = /认养|adopt/i.test(q);
  const adoptMems = adoptAsked
    ? all.filter(
        (m) => isAdoptMemoryText(m.text) && !isBookkeepingMemory(m.text),
      )
    : [];
  return layeredTalkMemories(all, [...adoptMems, ...paid, ...retrieved], 8);
}

/** Observatory fallback when the hourly MiniMax cap is spent. */
export function interviewFromMemories(input: {
  readonly stream: MemoryStream;
  readonly agentId: string;
  readonly agentName: string;
  readonly identity: string;
  readonly occupation?: string;
  readonly question: string;
  readonly nowSimTime: number;
}): InterviewResult {
  const q = input.question.trim().slice(0, 200);
  const cited = gatherInterviewMemories({
    stream: input.stream,
    agentId: input.agentId,
    question: q,
    nowSimTime: input.nowSimTime,
  });
  const ascii = isAsciiCopy(
    `${input.agentName}${input.identity}${input.occupation ?? ''}${q}`,
  );
  const usable = cited
    .filter((m) => !isInterviewEcho(m.text) && !isBookkeepingMemory(m.text))
    .map((m) => m.text.slice(0, 72));
  const answer = composeMemoryInterviewAnswer({
    question: q,
    memories: usable,
    ascii,
  });
  if (answer) {
    rememberInterview({
      stream: input.stream,
      agentId: input.agentId,
      question: q,
      answer,
      nowSimTime: input.nowSimTime,
    });
  }
  return {
    agentId: input.agentId,
    agentName: input.agentName,
    question: q,
    answer,
    cited: cited.map((m) => m.text).slice(0, 6),
    citedMemoryIds: cited.map((m) => m.id).slice(0, 6),
    source: 'memory',
  };
}

export async function interviewAgent(input: {
  readonly stream: MemoryStream;
  readonly agentId: string;
  readonly agentName: string;
  readonly identity: string;
  readonly occupation?: string;
  readonly question: string;
  readonly nowSimTime: number;
  readonly llm: LlmTextFn;
  readonly embed?: EmbedTextsFn;
}): Promise<InterviewResult> {
  const q = input.question.trim().slice(0, 200);
  if (!q) {
    return {
      agentId: input.agentId,
      agentName: input.agentName,
      question: q,
      answer: '',
      cited: [],
      citedMemoryIds: [],
    };
  }
  const queryEmb = await embedQuery(q, input.embed);
  const cited = gatherInterviewMemories({
    stream: input.stream,
    agentId: input.agentId,
    question: q,
    nowSimTime: input.nowSimTime,
    queryEmbedding: queryEmb,
  });
  const ascii = isAsciiCopy(
    `${input.agentName}${input.identity}${input.occupation ?? ''}${q}`,
  );
  const selfConflicts = findConflictingMemories(input.stream, input.agentId);
  const townConflicts = findTownDisagreements(input.stream, [
    input.agentId,
    ...input.stream.agentIds(),
  ]).map((c) => ({ a: c.a, b: c.b }));
  const conflicts = [...selfConflicts, ...townConflicts].slice(0, 6);
  const conflictCue = conflicts.length
    ? ascii
      ? `\nPeople disagree. Admit it; do not silently overwrite:\n${conflicts
          .map((c) => `- "${c.a.slice(0, 48)}" vs "${c.b.slice(0, 48)}"`)
          .join('\n')}`
      : `\n镇上有人看法不一样，必须承认分歧，不得静默覆盖：\n${conflicts
          .map((c) => `- 「${c.a.slice(0, 48)}」对「${c.b.slice(0, 48)}」`)
          .join('\n')}`
    : '';
  const lastIv = input.stream
    .list(input.agentId)
    .filter((m) => isInterviewEcho(m.text))
    .sort((a, b) => b.simTime - a.simTime)[0];
  const lastPair = lastIv ? parseInterviewMemory(lastIv.text) : undefined;
  const sameDay = Boolean(
    lastIv && input.nowSimTime - lastIv.simTime < SAME_DAY_HOURS,
  );
  if (sameDay && lastPair?.q && isRepeatLine(q, [lastPair.q])) {
    const answer = ascii
      ? 'I already answered that today. Ask another way.'
      : '我今天已经答过了，换个问法。';
    return {
      agentId: input.agentId,
      agentName: input.agentName,
      question: q,
      answer,
      cited: cited.map((m) => m.text).slice(0, 6),
      citedMemoryIds: cited.map((m) => m.id).slice(0, 6),
    };
  }
  const recitationCue =
    lastPair?.a && sameDay
      ? ascii
        ? `\nDo not repeat this earlier answer verbatim: "${lastPair.a.slice(0, 48)}"`
        : `\n不要原句复读上次的回答：「${lastPair.a.slice(0, 48)}」`
      : '';
  const all = input.stream.list(input.agentId);
  const paid = all.filter(
    (m) => isPaidTraceMemory(m.text) && !isBookkeepingMemory(m.text),
  );
  const adoptAsked = /认养|adopt/i.test(q);
  const adoptMems = adoptAsked
    ? all.filter(
        (m) => isAdoptMemoryText(m.text) && !isBookkeepingMemory(m.text),
      )
    : [];
  const paidCue = adoptAsked && adoptMems.length
    ? ascii
      ? `\nYou were adopted. You must mention that memory in your own words.`
      : `\n你被认养过。必须用自己的口吻提到这件事，不要装没听见。`
    : paid.length
      ? ascii
        ? `\nIf any whisper / town rumor / adoption memory is listed, mention at least one in your own words.`
        : `\n若记得耳语、巷议或认养，必须用自己的口吻提到至少一件，不要装没听见。`
      : '';
  const prompt = ascii
    ? `You are ${input.agentName} (${input.occupation ?? 'resident'}). Answer the interview in first-person English, like yourself speaking, no narrator.
Identity: ${input.identity.slice(0, 160)}
What you remember:
${cited.map((m) => `- [${m.id}] ${m.text.slice(0, 80)}`).join('\n') || '- (nothing much lately)'}
Question: ${q}${conflictCue}${recitationCue}${paidCue}
Write 2–5 sentences. Cite at least one memory above if any. Do not invent a town-wide script. Return the answer body only.`
    : `你就是${input.agentName}（${input.occupation ?? '镇民'}）。用第一人称中文回答采访，像本人在说话，不要旁白。
身份：${input.identity.slice(0, 160)}
你记得的事：
${cited.map((m) => `- [${m.id}] ${m.text.slice(0, 80)}`).join('\n') || '- （这阵子没记下什么）'}
采访问题：${q}${conflictCue}${recitationCue}${paidCue}
要求：2–5 句，引用上面至少一件记得的事（若有）。不要编造全镇剧本。只返回回答正文。`;
  const raw = (await input.llm(prompt)).trim();
  let answer = raw
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/```$/i, '')
    .slice(0, 600);
  if (sameDay && lastPair?.a && answer && isRepeatLine(answer, [lastPair.a])) {
    answer = ascii
      ? 'I already answered that today. Ask another way.'
      : '我今天已经答过了，换个问法。';
  }
  if (answer) {
    rememberInterview({
      stream: input.stream,
      agentId: input.agentId,
      question: q,
      answer,
      nowSimTime: input.nowSimTime,
    });
  }
  return {
    agentId: input.agentId,
    agentName: input.agentName,
    question: q,
    answer,
    cited: cited.map((m) => m.text).slice(0, 6),
    citedMemoryIds: cited.map((m) => m.id).slice(0, 6),
    source: 'model',
  };
}

/** Observatory plus: the resident remembers being asked, so a later chat can cite it. */
export function rememberInterview(input: {
  readonly stream: MemoryStream;
  readonly agentId: string;
  readonly question: string;
  readonly answer: string;
  readonly nowSimTime: number;
  readonly id?: string;
}): MemoryEntry | undefined {
  const q = input.question.trim().slice(0, 80);
  const a = input.answer.trim().slice(0, 80);
  if (!q || !a) return undefined;
  const entry = createMemoryEntry({
    id:
      input.id ??
      `iv_${input.agentId}_${Math.round(input.nowSimTime * 100)}_${q.length}`,
    agentId: input.agentId,
    kind: 'observation',
    text: interviewMemory(q, a, isAsciiCopy(`${q}${a}`)),
    simTime: input.nowSimTime,
    importance: 7,
  });
  input.stream.add(entry);
  return entry;
}
