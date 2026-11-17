/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createMemoryEntry, type MemoryEntry, type MemoryStream } from './memory.js';
import { retrieveMemories } from './retrieval.js';
import { isAsciiCopy } from './copyLocale.js';

export const DEFAULT_REFLECTION_THRESHOLD = 150;

export type LlmTextFn = (prompt: string) => Promise<string>;

export interface ReflectResult {
  readonly reflections: MemoryEntry[];
  readonly questions: string[];
}

/**
 * When recent importance sum exceeds threshold, ask high-level questions,
 * retrieve evidence, synthesize insights with pointers (reflection tree).
 */
export async function maybeReflect(input: {
  readonly stream: MemoryStream;
  readonly agentId: string;
  readonly agentName: string;
  readonly nowSimTime: number;
  readonly sinceSimTime: number;
  readonly threshold?: number;
  readonly idFactory: () => string;
  readonly llm?: LlmTextFn;
}): Promise<ReflectResult | null> {
  const threshold = input.threshold ?? DEFAULT_REFLECTION_THRESHOLD;
  const sum = input.stream.recentImportanceSum(
    input.agentId,
    input.sinceSimTime,
  );
  if (sum < threshold) return null;

  const memories = input.stream.list(input.agentId);
  const recent = memories.filter((m) => m.simTime >= input.sinceSimTime);

  let questions: string[];
  if (input.llm) {
    const ascii = isAsciiCopy(input.agentName);
    const prompt = ascii
      ? `Recent memories of agent ${input.agentName}:\n${recent
          .slice(-40)
          .map((m) => `- ${m.text}`)
          .join('\n')}\n\nFrom these memories, ask the 3 most important high-level questions. Answer in English. Return a JSON string array only.`
      : `智能体 ${input.agentName} 最近的记忆：\n${recent
          .slice(-40)
          .map((m) => `- ${m.text}`)
          .join('\n')}\n\n根据这些记忆，提出 3 个最重要的高层次问题。用中文回答，只返回 JSON 字符串数组。`;
    const raw = await input.llm(prompt);
    try {
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      questions = JSON.parse(raw.slice(start, end + 1)) as string[];
    } catch {
      questions = heuristicQuestions(input.agentName, recent);
    }
  } else {
    questions = heuristicQuestions(input.agentName, recent);
  }

  // Park trees let a later insight cite an earlier one. Grounding still prefers
  // observations so heuristic text does not collapse into reflection boilerplate.
  const grounded = memories.filter((m) => m.kind !== 'reflection');
  const priorReflections = memories
    .filter((m) => m.kind === 'reflection')
    .slice(-3);

  const reflections: MemoryEntry[] = [];
  for (const q of questions.slice(0, 3)) {
    const evidence = [
      ...retrieveMemories(grounded, q, input.nowSimTime, { limit: 4 }),
    ];
    const priors = [
      ...priorReflections.slice(-2),
      ...reflections.slice(-1),
    ];
    for (const prior of priors) {
      if (!evidence.some((e) => e.id === prior.id)) evidence.push(prior);
    }
    let insight: string;
    if (input.llm) {
      const ascii = isAsciiCopy(input.agentName);
      const prompt = ascii
        ? `Question: ${q}\nEvidence:\n${evidence
            .map((e) => `- ${e.text}`)
            .join('\n')}\nWrite one English sentence of insight about ${input.agentName}.`
        : `问题：${q}\n证据：\n${evidence
            .map((e) => `- ${e.text}`)
            .join('\n')}\n用一句中文写出关于 ${input.agentName} 的洞察。`;
      insight = (await input.llm(prompt)).trim().slice(0, 280);
    } else {
      insight = heuristicInsight(input.agentName, q, evidence);
    }
    const entry = createMemoryEntry({
      id: input.idFactory(),
      agentId: input.agentId,
      kind: 'reflection',
      text: insight,
      simTime: input.nowSimTime,
      importance: 6,
      pointers: evidence.map((e) => e.id),
    });
    input.stream.add(entry);
    reflections.push(entry);
  }

  return { reflections, questions };
}

/**
 * Seed-end judgment: the default 150-importance threshold almost never fires
 * in a one-day seed. Force the three busiest residents to write one insight.
 */
export async function forceSeedReflections(input: {
  readonly stream: MemoryStream;
  readonly agents: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly nowSimTime: number;
  readonly sinceSimTime: number;
  readonly llm?: LlmTextFn;
  readonly count?: number;
  readonly idFactory: () => string;
}): Promise<number> {
  const ranked = [...input.agents]
    .map((a) => ({
      ...a,
      sum: input.stream.recentImportanceSum(a.id, input.sinceSimTime),
    }))
    .sort((a, b) => b.sum - a.sum)
    .slice(0, Math.max(1, input.count ?? 3));
  let n = 0;
  for (const a of ranked) {
    const hit = await maybeReflect({
      stream: input.stream,
      agentId: a.id,
      agentName: a.name,
      nowSimTime: input.nowSimTime,
      sinceSimTime: input.sinceSimTime,
      threshold: 0,
      idFactory: input.idFactory,
      llm: input.llm,
    });
    if (hit?.reflections.length) n += hit.reflections.length;
  }
  return n;
}

function heuristicQuestions(name: string, recent: readonly MemoryEntry[]): string[] {
  const texts = recent.map((m) => m.text).join(' ');
  const ascii = isAsciiCopy(`${name}${texts}`);
  const adopted = /【认养】|adopted you/i.test(texts);
  if (ascii) {
    return [
      adopted
        ? `What should ${name} remember after being adopted?`
        : `What does ${name} care about most right now?`,
      `Who has ${name} been spending time with?`,
      texts.includes('party') || texts.includes('gathering')
        ? `Is ${name} organizing a gathering?`
        : `What schedule is ${name} following today?`,
    ];
  }
  return [
    adopted
      ? `${name} 被认养之后最该记住什么？`
      : `${name} 现在最在意什么？`,
    `${name} 最近在和谁来往？`,
    texts.includes('party') || texts.includes('聚会')
      ? `${name} 是不是在张罗社交活动？`
      : `${name} 今天在按什么日程过？`,
  ];
}

/**
 * Reflections get quoted verbatim in template dialogue, so the text has to read
 * like something a person would say. Echoing the question back with raw memory
 * text appended produced unusable lines.
 */
function heuristicInsight(
  name: string,
  question: string,
  evidence: readonly MemoryEntry[],
): string {
  const ascii = isAsciiCopy(`${name}${question}`);
  const facts = evidence
    .slice(0, 2)
    .map((e) => cleanFact(e.text, name))
    .filter((t) => t.length > 0);
  if (!facts.length) {
    return ascii
      ? `${name} has not settled on a conclusion yet.`
      : `${name} 心里还没个定论。`;
  }
  const lead = ascii
    ? question.toLowerCase().includes('who')
      ? 'The people around most lately are '
      : question.toLowerCase().includes('schedule')
        ? 'The day really comes down to '
        : 'What matters most right now is '
    : question.includes('谁')
      ? '这两天打交道最多的是'
      : question.includes('日程')
        ? '今天的事说到底就是'
        : '眼下最要紧的是';
  return `${lead}${facts.join(ascii ? ', and ' : '，还有')}。`;
}

/** Strip speaker prefixes and question wrappers left by earlier passes. */
function cleanFact(text: string, name: string): string {
  return text
    .replace(/^[^：:]{0,12}[：:]\s*/u, '')
    .replace(/关于「[^」]*」——?/gu, '')
    .replace(new RegExp(`^${name}\\s*`, 'u'), '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 60);
}
