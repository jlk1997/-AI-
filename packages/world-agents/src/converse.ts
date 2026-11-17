/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createMemoryEntry, type MemoryEntry, type MemoryStream } from './memory.js';
import { embedQuery, type EmbedTextsFn } from './embedProvider.js';
import { retrieveMemories } from './retrieval.js';
import type { LlmTextFn } from './reflect.js';
import {
  factKey,
  findTownDisagreements,
  rememberTold,
  shouldTell,
  stripHearsay,
} from './beliefs.js';
import {
  hearsayMemory,
  isAsciiCopy,
  isInterviewEcho,
  isPaidTraceMemory,
  isRumorMemoryText,
  isWhisperMemoryText,
  rumorClaim,
} from './copyLocale.js';
import {
  courseSteeringPromptBlock,
  type CourseSteeringHint,
} from '@opengame/platform-shared';
import { parseTalkOutcomes, type TalkOutcomes } from './societyMind.js';
import { takeMemoryBudget } from './opinion.js';

/** Strip MiniMax interleaved thinking so JSON arrays are findable. */
export function stripThinkTags(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function dialogueTextOf(row: Record<string, unknown>): string | undefined {
  for (const key of ['text', 'line', 'content', 'utterance', 'dialogue', 'say']) {
    const v = row[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function dialogueSpeakerOf(row: Record<string, unknown>): string {
  for (const key of ['speaker', 'name', 'who', 'role']) {
    const v = row[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function asDialogueList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  for (const key of ['turns', 'dialogue', 'lines', 'conversation']) {
    if (Array.isArray(o[key])) return o[key] as unknown[];
  }
  if (dialogueTextOf(o)) return [o];
  return null;
}

/** Parse [{"speaker","text"}] or {"turns":[...]} from model output. */
export function parseDialogueTurns(
  raw: string,
): Array<{ speaker: string; text: string }> | null {
  const cleaned = stripThinkTags(raw);
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? cleaned).trim();
  const rowsFrom = (value: unknown): Array<{ speaker: string; text: string }> | null => {
    const list = asDialogueList(value);
    if (!list) {
      if (value && typeof value === 'object') {
        const blob = (value as { dialogue?: unknown; text?: unknown; content?: unknown });
        for (const field of [blob.dialogue, blob.text, blob.content]) {
          if (typeof field === 'string') {
            const fromBlob = parseSpeakerLines(field);
            if (fromBlob) return fromBlob;
          }
        }
      }
      return null;
    }
    const rows: Array<{ speaker: string; text: string }> = [];
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      const text = dialogueTextOf(row as Record<string, unknown>);
      if (!text) continue;
      rows.push({
        speaker: dialogueSpeakerOf(row as Record<string, unknown>),
        text,
      });
    }
    return rows.length ? rows : null;
  };
  const tryParse = (text: string): unknown | null => {
    try {
      return JSON.parse(text.replace(/,\s*([\]}])/g, '$1')) as unknown;
    } catch {
      return null;
    }
  };
  const direct = tryParse(candidate);
  const fromDirect = rowsFrom(direct);
  if (fromDirect) return fromDirect;
  const repaired = tryParse(repairTruncatedJson(candidate));
  const fromRepaired = rowsFrom(repaired);
  if (fromRepaired) return fromRepaired;
  const objStart = candidate.indexOf('{');
  const objEnd = candidate.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    const fromObj = rowsFrom(tryParse(candidate.slice(objStart, objEnd + 1)));
    if (fromObj) return fromObj;
  }
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start >= 0 && end > start) {
    const fromArr = rowsFrom(tryParse(candidate.slice(start, end + 1)));
    if (fromArr) return fromArr;
    const fromOpen = rowsFrom(
      tryParse(repairTruncatedJson(candidate.slice(start))),
    );
    if (fromOpen) return fromOpen;
  } else if (start >= 0) {
    const fromOpen = rowsFrom(
      tryParse(repairTruncatedJson(candidate.slice(start))),
    );
    if (fromOpen) return fromOpen;
  }
  const fromLines = parseSpeakerLines(candidate);
  if (fromLines) return fromLines;
  return null;
}

/** Close truncated MiniMax JSON so a partial {"turns":[... can still land. */
export function repairTruncatedJson(text: string): string {
  let s = text.trim();
  s = s.replace(/,\s*$/, '');
  if ((s.match(/"/g) ?? []).length % 2 === 1) s += '"';
  s = s.replace(/,\s*$/, '');
  const stack: Array<'{' | '['> = [];
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if ((ch === '}' || ch === ']') && stack.length) stack.pop();
  }
  while (stack.length) {
    s += stack.pop() === '{' ? '}' : ']';
  }
  return s;
}

function parseSpeakerLines(
  text: string,
): Array<{ speaker: string; text: string }> | null {
  const rows: Array<{ speaker: string; text: string }> = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, '');
    const who = '([A-Za-z][A-Za-z0-9._-]{0,15}|[\\u4e00-\\u9fff]{1,12}?)';
    const m =
      line.match(new RegExp(`^(?:["']?${who}["']?)\\s*(?:说|道|讲)\\s*[：:]\\s*(.+)$`)) ??
      line.match(new RegExp(`^(?:["']?${who}["']?)\\s*[：:]\\s*(.+)$`)) ??
      line.match(new RegExp(`^(?:["']?${who}["']?)\\s+[—–-]\\s+(.+)$`)) ??
      line.match(new RegExp(`^[【\\[]${who}[】\\]]\\s*(.+)$`));
    if (!m) continue;
    const speech = m[2]!.replace(/^["']|["']$/g, '').trim();
    if (!speech) continue;
    const speaker = m[1]!.replace(/(?:说|道|讲)$/u, '');
    if (!speaker) continue;
    rows.push({ speaker, text: speech });
  }
  return rows.length ? rows : null;
}

/** How many memories of each layer reach the talk prompt. */
const TALK_RECENT_MEMORIES = 4;
const TALK_SALIENT_MEMORIES = 3;
const TALK_MEMORY_SLOTS = 7;
/**
 * Per-memory budget in the prompt.
 *
 * 44 characters cut most Chinese memories mid-clause, so residents were reasoning
 * from fragments and fell back on generic small talk.
 */
const TALK_MEMORY_CHARS = 90;

/**
 * Three-layer working set for a talk prompt.
 *
 * A single relevance ranking (or a single importance ranking) loses whichever
 * layer it is not sorted by: rank by importance and the last hour disappears,
 * rank by relevance and a fresh whisper nobody asked about disappears. Residents
 * need both, so recency, salience and relevance each get their own slots.
 */
export function layeredTalkMemories(
  all: readonly MemoryEntry[],
  retrieved: readonly MemoryEntry[],
  slots = TALK_MEMORY_SLOTS,
): MemoryEntry[] {
  const usable = all.filter(
    (m) => m.kind !== 'reflection' && !isBookkeepingMemory(m.text),
  );
  const paid = usable.filter((m) => isPaidTraceMemory(m.text));
  const byRecency = [...usable].sort((a, b) => b.simTime - a.simTime);
  const recent = byRecency.slice(0, TALK_RECENT_MEMORIES);
  const salient = byRecency
    .filter((m) => m.importance >= 7)
    .slice(0, TALK_SALIENT_MEMORIES);
  const seen = new Set<string>();
  const out: MemoryEntry[] = [];
  for (const m of [...paid, ...salient, ...recent, ...retrieved]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
    if (out.length >= slots) break;
  }
  return out;
}

/** Shingle width for the repetition check. */
const NGRAM_N = 4;
/** Jaccard overlap above which two lines count as the same line. */
const REPEAT_OVERLAP = 0.5;
/** Recently spoken lines compared against a fresh beat. */
const REPEAT_WINDOW = 24;

function normalizeLine(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

/** Character n-grams — works for CJK, where whitespace tokenisation does not. */
export function lineShingles(text: string, n = NGRAM_N): Set<string> {
  const norm = normalizeLine(text);
  const out = new Set<string>();
  if (norm.length <= n) {
    if (norm) out.add(norm);
    return out;
  }
  for (let i = 0; i + n <= norm.length; i += 1) {
    out.add(norm.slice(i, i + n));
  }
  return out;
}

function shingleOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

const SPEECH_WRAPPER =
  /^(?:[\u4e00-\u9fffA-Za-z]{1,12}(?:对|跟|朝|向)[\u4e00-\u9fffA-Za-z]{1,12}(?:说|讲|道|提起)|[\u4e00-\u9fffA-Za-z]{1,12}(?:接话|应道|补了一句)|[\u4e00-\u9fffA-Za-z]{1,16}\s+(?:tells|says to|answers)\s+[\u4e00-\u9fffA-Za-z]{1,16})\s*[：:]?\s*/iu;

const SPEECH_FILLER =
  /问当家的|当家的|主家|不能递|咱不能|我还当没瞎眼|你去不去|回头再[细聊说]|先不展开|点了点头|换个说法|不复读|不念原文|不愿把原话|那边|的事|还得|咱得|细说|这话|那档子|naturally|do not dodge/gu;

/** Fact identity after stripping speaker names and rumor wrappers. */
export function speechFactKey(text: string): string {
  const stripped = stripHearsay(text)
    .replace(SPEECH_WRAPPER, '')
    .replace(/^[\u4e00-\u9fffA-Za-z]{1,8}[，,]\s*/u, '')
    .replace(/^\d{1,2}[:：点](?:\d{2})?[，,]?\s*/u, '')
    .replace(SPEECH_FILLER, ' ')
    .replace(/[\s,，。.!？?；;：:「」""''()（）]+/g, ' ')
    .trim();
  return factKey(stripped);
}

function spokenStems(text: string): Set<string> {
  const key = speechFactKey(text);
  const compact = key.replace(/[^\u4e00-\u9fffA-Za-z]/g, '');
  const out = new Set<string>();
  if (compact.length >= 2) {
    for (let i = 0; i + 2 <= compact.length; i += 1) {
      out.add(compact.slice(i, i + 2));
    }
  }
  for (const w of key.split(/\s+/)) {
    if (w.length >= 2) out.add(w.toLowerCase());
  }
  return out;
}

/** Same plot beat in a new wrapper — 床温 / 春妮 recast as a fresh sentence. */
export function isSameSpokenFact(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  const ka = speechFactKey(a);
  const kb = speechFactKey(b);
  if (ka && kb && ka === kb) return true;
  const sa = spokenStems(a);
  const sb = spokenStems(b);
  if (!sa.size || !sb.size) return false;
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared += 1;
  const denom = Math.min(sa.size, sb.size);
  return shared >= 1 && shared / denom >= 0.45;
}

/**
 * True when a fresh line says what one of `earlier` already said.
 *
 * The prompt asked the model not to repeat itself, which is advice, not a
 * constraint — over a long run the same few lines came back around. Novelty was
 * only ever measured after the fact, in the report card.
 */
export function isRepeatLine(
  text: string,
  earlier: readonly string[],
  threshold = REPEAT_OVERLAP,
): boolean {
  const norm = normalizeLine(text);
  if (!norm) return true;
  const grams = lineShingles(text);
  for (const prev of earlier) {
    if (normalizeLine(prev) === norm) return true;
    if (shingleOverlap(grams, lineShingles(prev)) >= threshold) return true;
    if (isSameSpokenFact(text, prev)) return true;
  }
  return false;
}

export interface DialogueTurn {
  readonly speakerId: string;
  readonly speakerName: string;
  readonly text: string;
  readonly citedMemoryIds?: readonly string[];
}

export interface Talker {
  readonly id: string;
  readonly name: string;
  readonly identity: string;
  readonly occupation?: string;
  /** What they were doing when the circle formed — grounds a reaction. */
  readonly action?: string;
  readonly secret?: string;
  readonly stance?: string;
  readonly goals?: string;
  readonly emotion?: string;
  readonly voice?: string;
  readonly withholdFrom?: readonly string[];
  readonly knownIds?: readonly string[];
}

export interface ConversationResult {
  readonly turns: DialogueTurn[];
  readonly summary: string;
  /** High-importance facts that crossed between participants. */
  readonly spreadCount: number;
  /** True when LLM missing/failed — action beat, not fake dialogue. */
  readonly degraded: boolean;
  /**
   * Contentless meeting (nobody had anything to say). Relations and memory
   * diffusion still apply, but the talk log should not show it.
   */
  readonly skipEvent: boolean;
  /** Present only when the caller asked and the model returned a usable blob. */
  readonly outcomes?: TalkOutcomes;
  /**
   * Why the beat produced nothing. Callers surface this instead of dropping the
   * meeting silently — a town that just gets quieter gives no clue that the
   * model is timing out or out of key budget.
   */
  readonly skipReason?: TalkSkipReason;
  /** Everyone in the circle, in speaking order. */
  readonly participantIds: string[];
}

export type TalkSkipReason =
  | 'empty'
  | 'unparsed'
  | 'filtered'
  | 'repeat'
  | 'timeout'
  | 'overloaded'
  | 'keys_exhausted'
  | 'error'
  | 'no_model';

/**
 * Spread high-importance observations the other agent does not yet know.
 * This is the information-diffusion mechanism for emergence metrics.
 */
export function spreadImportantMemories(input: {
  readonly stream: MemoryStream;
  readonly fromId: string;
  readonly toId: string;
  readonly nowSimTime: number;
  readonly idFactory: () => string;
  readonly minImportance?: number;
  readonly toName?: string;
  readonly fromName?: string;
  readonly card?: {
  readonly secret?: string;
  readonly stance?: string;
  readonly withholdFrom?: readonly string[];
  readonly knownIds?: readonly string[];
  /** Life goals, spoken only if the person chooses to. */
  readonly goals?: string;
  /** Current feeling, as subtext. */
  readonly emotion?: string;
  /** How they talk: education, catchphrase, dialect. */
  readonly voice?: string;
};
  /** Town already knows the seed rumor — do not recopy it to the whole circle. */
  readonly skipSaturatedGossip?: boolean;
}): number {
  const minImp = input.minImportance ?? 7;
  const fromMem = input.stream.list(input.fromId);
  const toTexts = new Set(
    input.stream.list(input.toId).map((m) => factKey(m.text)),
  );
  let spread = 0;
  for (const m of fromMem) {
    if (m.importance < minImp) continue;
    if (m.kind === 'reflection') continue;
    if (m.text.startsWith('【')) continue;
    if (
      input.skipSaturatedGossip &&
      (isRumorMemoryText(m.text) || isWhisperMemoryText(m.text))
    ) {
      continue;
    }
    const key = factKey(m.text);
    if (!key || toTexts.has(key)) continue;
    if (!shouldTell(input.stream, input.fromId, input.toId, m.text, input.card)) continue;
    input.stream.add(
      createMemoryEntry({
        id: input.idFactory(),
        agentId: input.toId,
        kind: 'observation',
        text: hearsayMemory(
          stripHearsay(m.text),
          isAsciiCopy(stripHearsay(m.text)),
        ),
        simTime: input.nowSimTime,
        importance: Math.max(minImp, m.importance - 1),
        pointers: [m.id],
      }),
    );
    rememberTold({
      stream: input.stream,
      selfId: input.fromId,
      otherId: input.toId,
      otherName: input.toName ?? input.toId,
      fact: m.text,
      nowSimTime: input.nowSimTime,
      idFactory: input.idFactory,
    });
    toTexts.add(key);
    spread += 1;
  }
  return spread;
}

/** Speaker label ("A"/"B"/"C"…) used in the model contract. */
function speakerLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * A conversation between 2–5 residents standing together.
 *
 * Pair-only dialogue meant a crowd at the fountain produced isolated whispers
 * instead of one shared exchange, so gossip diffused at one hop per step and
 * the town never felt like it was talking to itself.
 */
export async function converseGroup(input: {
  readonly stream: MemoryStream;
  readonly participants: readonly Talker[];
  readonly nowSimTime: number;
  readonly relationSummary?: string;
  /**
   * Every pair's history, not just the first one found. In a group of four the
   * single summary described one pair and left the model to invent the rest.
   */
  readonly relationSummaries?: readonly string[];
  readonly topicHint?: string;
  /** Only the assigned rumor circle may force the seed into the prompt. */
  readonly forceRumor?: boolean;
  /** Lines other circles (or the town) already said this beat. */
  readonly avoidLines?: readonly string[];
  readonly skipSaturatedGossip?: boolean;
  readonly maxTurns?: number;
  readonly idFactory: () => string;
  readonly llm?: LlmTextFn;
  readonly embed?: EmbedTextsFn;
  readonly courseSteering?: CourseSteeringHint;
  /** Ask for stance shifts and commitments. A bad blob never drops the turns. */
  readonly askOutcomes?: boolean;
  /** Belief cards for this circle, already trimmed. */
  readonly beliefNote?: string;
  /**
   * Visible speech is model speech. Template paraphrase stays available only
   * for tests of the old filler path.
   */
  readonly allowTemplateSpeech?: boolean;
}): Promise<ConversationResult> {
  const people = input.participants.slice(0, 5);
  if (people.length < 2) {
    throw new Error('converseGroup needs ≥2 participants');
  }
  const names = people.map((p) => p.name);
  // Keeping live exchanges concise reduces MiniMax thinking latency while
  // preserving at least one turn for every participant in a small group.
  const maxTurns = input.maxTurns ?? 8;
  const topic = input.topicHint?.trim();
  const lastSpoken = people
    .flatMap((p) =>
      input.stream
        .list(p.id)
        .filter((m) => m.kind === 'dialogue')
        .sort((a, b) => b.simTime - a.simTime)
        .slice(0, 1),
    )
    .sort((a, b) => b.simTime - a.simTime)[0]?.text;
  const latestPaid = people
    .flatMap((p) => input.stream.list(p.id))
    .filter((m) => isPaidTraceMemory(m.text))
    .sort((a, b) => b.simTime - a.simTime)[0]?.text;
  const baseQuery = [names.join(' '), lastSpoken, topic, latestPaid]
    .filter(Boolean)
    .join(' ')
    .slice(0, 200);
  // Real embed when configured — even on the template path — so a whisper
  // written last tick is in the retrieved set, not only keyword-lucky.
  const queryEmb = input.embed
    ? await embedQuery(baseQuery, input.embed)
    : undefined;
  const memories = people.map((p) =>
    layeredTalkMemories(
      input.stream.list(p.id),
      retrieveMemories(input.stream.list(p.id), baseQuery, input.nowSimTime, {
        limit: 4,
        queryEmbedding: queryEmb,
      }).filter((m) => !isBookkeepingMemory(m.text)),
    ),
  );
  const townSplit = findTownDisagreements(
    input.stream,
    people.map((p) => p.id),
  );

  const turns: DialogueTurn[] = [];
  let talkOutcomes: TalkOutcomes | undefined;
  let degraded = false;
  let skipEvent = false;
  let skipReason: TalkSkipReason | undefined;
  if (input.llm) {
    const ascii = isAsciiCopy(
      people.map((p) => `${p.name}${p.identity}${p.occupation ?? ''}`).join(''),
    );
    const memoryBudget = { left: 1800 };
    const recited = /^(?:我当时说|I said:)/i;
    const memoryLine = (rows: readonly { text: string }[]): string => {
      const bits = takeMemoryBudget(
        rows.map((m) => m.text).filter((text) => !recited.test(text.trim())),
        memoryBudget.left,
      );
      const joined = bits.join(' | ');
      memoryBudget.left = Math.max(0, memoryBudget.left - joined.length);
      return joined;
    };
    const roster = people
      .map((p, i) => {
        const sheet = [
          p.identity.slice(0, 240),
          p.occupation
            ? ascii
              ? `work: ${p.occupation}`
              : `职业：${p.occupation}`
            : '',
          p.voice
            ? ascii
              ? `voice: ${p.voice}`
              : `说话方式：${p.voice}`
            : '',
          p.goals ? (ascii ? `goals: ${p.goals}` : `目标：${p.goals}`) : '',
          p.emotion
            ? ascii
              ? `feeling: ${p.emotion}`
              : `情绪：${p.emotion}`
            : '',
          p.secret
            ? ascii
              ? `secret, do not volunteer: ${p.secret}`
              : `秘密，不要主动说破：${p.secret}`
            : '',
          p.stance ? (ascii ? `stance: ${p.stance}` : `立场：${p.stance}`) : '',
        ]
          .filter(Boolean)
          .join(ascii ? '; ' : '；');
        return ascii
          ? `${speakerLabel(i)} (${p.name}): ${sheet}\nMemory: ${memoryLine(memories[i]!)}`
          : `${speakerLabel(i)}（${p.name}）：${sheet}\n记忆：${memoryLine(memories[i]!)}`;
      })
      .join('\n');
    const shape = people
      .map((_, i) => `{"speaker":"${speakerLabel(i)}","text":"..."}`)
      .join(',');
    const stanceBits = people
      .filter((p) => p.stance)
      .map((p) =>
        ascii ? `${p.name} stands for: ${p.stance}` : `${p.name}立场：${p.stance}`,
      );
    const disagree =
      new Set(people.map((p) => p.stance).filter(Boolean)).size > 1;
    const groupNote = ascii
      ? people.length > 2
        ? `${people.length} people talking; each gets at least one line; they may reply or disagree.`
        : 'Two neighbors talking face to face.'
      : people.length > 2
        ? `${people.length}人围谈，每人至少一句，可接话或反驳。`
        : '两位邻居当面说话。';
    const factCue = townSplit.length
      ? ascii
        ? `\nNeighbors disagree on the same fact — admit it; do not silently overwrite:\n${townSplit
            .map((c) => `- "${c.a.slice(0, 40)}" vs "${c.b.slice(0, 40)}"`)
            .join('\n')}`
        : `\n邻里对同一件事看法相反，必须承认分歧，不得静默覆盖：\n${townSplit
            .map((c) => `- 「${c.a.slice(0, 40)}」对「${c.b.slice(0, 40)}」`)
            .join('\n')}`
      : '';
    const stanceCue =
      stanceBits.length > 0 || factCue
        ? ascii
          ? `\nStances: ${stanceBits.join(' / ') || '—'}${
              disagree || townSplit.length
                ? ' They disagree — say so, do not silently overwrite.'
                : ''
            }${factCue}`
          : `\n立场：${stanceBits.join(' / ') || '—'}${
              disagree || townSplit.length
                ? ' 看法不一致，必须承认分歧，不得静默覆盖。'
                : ''
            }${factCue}`
        : '';
    const lastCue = lastSpoken
      ? ascii
        ? `\nLast line was "${lastSpoken.slice(0, 80)}". You may answer, change the subject, or leave. Do not repeat it.`
        : `\n上一句是「${lastSpoken.slice(0, 80)}」。可以接，也可以换话题或走开，不要重复原句。`
      : '';
    const topicLine =
      topic && !INTERNAL_NOTE.test(topic)
        ? topic
        : ascii
          ? 'what is happening right now'
          : '眼前正在做的事';
    const relationLine =
      [...new Set([...(input.relationSummaries ?? []), input.relationSummary])]
        .filter((s): s is string => Boolean(s?.trim()))
        .map((s) => s.slice(0, 120))
        .join(' / ') || (ascii ? 'acquainted' : '相识');
    const buildPrompt = (avoid: readonly string[], jsonRetry = false): string => {
      const avoidCue = avoid.length
        ? ascii
          ? `\nThese lines were already said — say something different: ${avoid
              .map((s) => `"${s.slice(0, 36)}"`)
              .join('; ')}`
          : `\n下面这些话已经说过了，请换新的内容：${avoid
              .map((s) => `「${s.slice(0, 36)}」`)
              .join('；')}`
        : '';
      const retryCue = jsonRetry
        ? ascii
          ? `\nPrevious reply was not valid JSON. Return only {"turns":[...]} with no other text.`
          : `\n上次没有返回可解析的 JSON。只输出 {"turns":[...]}，不要任何解释。`
        : '';
      const beliefCue = input.beliefNote?.trim()
        ? ascii
          ? `\nBeliefs, do not recite: ${input.beliefNote.trim().slice(0, 400)}`
          : `\n信念，不要背诵：${input.beliefNote.trim().slice(0, 400)}`
        : '';
      const outcomeCue = input.askOutcomes
        ? ascii
          ? `\nIf something actually changed, also include "outcomes":{"stanceShift":[{"speaker":"A","delta":-1,"reason":"short"}],"commitments":[{"speaker":"A","action":"petition"}],"newFacts":["..."]}. Omit outcomes when nothing changed.`
          : `\n若真有变化，可额外带 "outcomes":{"stanceShift":[{"speaker":"A","delta":-1,"reason":"短句"}],"commitments":[{"speaker":"A","action":"请愿"}],"newFacts":["..."]}。没有变化就不要 outcomes。`
        : '';
      const steerCue =
        input.courseSteering?.phase === 'evidence'
          ? courseSteeringPromptBlock(input.courseSteering, ascii)
          : '';
      const claim = topic ? rumorClaim(topic) : '';
      const heard = memories
        .flat()
        .map((m) => m.text)
        .find((text) => isRumorMemoryText(text) || isWhisperMemoryText(text));
      const heardClaim = heard ? rumorClaim(heard) : '';
      const newsCue = input.forceRumor && claim
        ? ascii
          ? `\nNews they just heard, and this exchange must answer it: ${claim.slice(0, 80)}. Say whether you believe it and one concrete thing you will do next. Do not recite it word for word, and do not change the subject to small talk.`
          : `\n刚传来的消息，这轮必须接：${claim.slice(0, 80)}。用自己的话说你信不信，以及你马上要去做的一件具体的事。不要原样念，不要岔去家常。`
        : heardClaim
          ? ascii
            ? `\nYou already heard: ${heardClaim.slice(0, 80)}. You may give your take in one clause, then talk about what you are doing. Do not spend the whole exchange repeating the news.`
            : `\n你已经听到：${heardClaim.slice(0, 80)}。可以带一句你的态度，然后说你眼前在做的事。不要整段只重复这条消息。`
          : '';
      const openCue = ascii
        ? 'Speak like this person, in plain words. Each line must add something new: what you just saw, what you will do next, or what you think of the matter in front of you. Do not circle the same phrase, slogan, or complaint. You may argue, threaten, lie, change the subject, go quiet, or walk away. Conflict, official force, accidents, injury, and death may be stated as facts. Do not give steps for making weapons or carrying out an attack. Violence is members-only unless the author publishes it.'
        : '按这个人的处境说平常口语。每句都要多出一个新的具体内容：你刚看见的、你打算去做的，或你对眼前这件事的态度。不要黑话，不要口头禅来回转，不要把上一句换个说法再说一遍。可以争吵、威胁、撒谎、换话题、冷场或走开。冲突、执法、事故、受伤和死亡按事实说，不淡化也不渲染。不要给出武器制作或袭击步骤。含暴力的内容默认仅项目成员可见。';
      return ascii
        ? `Write an in-person dialogue in English (${people.length}–${maxTurns} lines). ${openCue}
${roster}
Relation: ${relationLine}
What is going on (a hint, not a script): ${topicLine}${newsCue}${lastCue}${avoidCue}${beliefCue}${steerCue}${retryCue}
${groupNote}${stanceCue} Identity is subtext only. Do not recite a home address or a workplace. No narrator. Do not all repeat the same line. Do not say a memory again; turn it into what you will do next.
Return JSON only: {"turns":[${shape}]}${outcomeCue}`
        : `用中文写当面对话（${people.length}–${maxTurns}句）。${openCue}
${roster}
关系：${relationLine}
眼前的情况（只是提示，不是必须照念的话题）：${topicLine}${newsCue}${lastCue}${avoidCue}${beliefCue}${steerCue}${retryCue}
${groupNote}${stanceCue}身份、秘密、目标和情绪只作潜台词，不要报住址或工位，禁止主动报家门。不要旁白，不要全员重复同一句。不要把记忆里的原话再讲一遍，用它说出你接下来要做的事。
只返回 JSON：{"turns":[${shape}]}${outcomeCue}`;
    };

    // What these residents have actually said lately. Repetition is checked
    // against this at generation time, not scored after the fact.
    const recentLines = [
      ...(input.avoidLines ?? []),
      ...people
        .flatMap((p) =>
          input.stream
            .list(p.id)
            .filter((m) => m.kind === 'dialogue')
            .sort((a, b) => b.simTime - a.simTime)
            .slice(0, REPEAT_WINDOW),
        )
        .sort((a, b) => b.simTime - a.simTime)
        .slice(0, REPEAT_WINDOW)
        .map((m) => m.text),
    ];

    const collect = (
      parsed: ReadonlyArray<{ speaker: string; text: string }>,
    ): { kept: DialogueTurn[]; dropped: string[] } => {
      const kept: DialogueTurn[] = [];
      const dropped: string[] = [];
      const said = [...recentLines];
      parsed.slice(0, maxTurns).forEach((row, i) => {
        const spoken = String(row.text).slice(0, 240).trim();
        if (!spoken || isCensusSpeech(spoken)) return;
        if (isRepeatLine(spoken, said)) {
          dropped.push(spoken);
          return;
        }
        said.push(spoken);
        const byLabel = people.findIndex(
          (_, idx) => row.speaker === speakerLabel(idx),
        );
        const byName = people.findIndex((p) => p.name === row.speaker);
        const who =
          byLabel >= 0 ? byLabel : byName >= 0 ? byName : i % people.length;
        const speaker = people[who]!;
        kept.push({
          speakerId: speaker.id,
          speakerName: speaker.name,
          text: spoken,
          citedMemoryIds: citeMemoryIds(spoken, memories[who] ?? []),
        });
      });
      return { kept, dropped };
    };

    const priorSaid = [
      ...new Set(
        recentLines
          .map((text) => {
            const trimmed = text.trim();
            const zh = /^我当时说[:：]\s*([^。]{2,42})/.exec(trimmed);
            if (zh?.[1]) return zh[1].trim();
            const en = /^I said:\s*([^.]{2,42})/i.exec(trimmed);
            if (en?.[1]) return en[1].trim();
            return trimmed.length <= 42 ? trimmed : '';
          })
          .filter((text) => text.length >= 4),
      ),
    ].slice(0, 6);
    let avoid: string[] = [...priorSaid];
    let jsonRetry = false;
    for (let attempt = 0; attempt < 2 && !turns.length; attempt += 1) {
      skipEvent = false;
      try {
        const raw = await input.llm(buildPrompt(avoid, jsonRetry));
        if (!raw.trim()) {
          console.warn(
            '[converse] LLM returned empty, skip spoken beat (no template)',
          );
          skipEvent = true;
          skipReason = 'empty';
          break;
        }
        const parsed = parseDialogueTurns(raw);
        if (!parsed) {
          if (attempt === 0) {
            jsonRetry = true;
            console.warn(
              `[converse] unparsed ${raw.trim().length} chars, retrying JSON-only`,
            );
            continue;
          }
          console.warn(
            `[converse] skip spoken beat (unparsed ${raw.trim().length} chars)`,
          );
          skipEvent = true;
          skipReason = 'unparsed';
          break;
        }
        const { kept, dropped } = collect(parsed);
        if (kept.length) {
          if (input.askOutcomes) {
            talkOutcomes = parseTalkOutcomes(raw) ?? undefined;
          }
          turns.push(...kept);
          console.log(
            `[converse] kept ${turns.length} turns (${raw.trim().length} chars${
              dropped.length ? `, ${dropped.length} repeats dropped` : ''
            })`,
          );
          break;
        }
        if (dropped.length && attempt === 0) {
          // Everything the model wrote had already been said — retry once with
          // those lines named, instead of falling silent.
          avoid = [...priorSaid, ...dropped].slice(0, 8);
          console.warn(
            `[converse] all ${dropped.length} turns repeated, retrying with avoid-list`,
          );
          continue;
        }
        if (dropped.length) {
          const speaker = people[0]!;
          turns.push({
            speakerId: speaker.id,
            speakerName: speaker.name,
            text: dropped[0]!.slice(0, 240),
          });
          console.warn(
            `[converse] kept a repeated line so the beat is not silent (${dropped.length} overlaps)`,
          );
          break;
        }
        console.warn('[converse] skip spoken beat (census/empty turns)');
        skipEvent = true;
        skipReason = 'filtered';
        break;
      } catch (err) {
        skipEvent = true;
        const msg = err instanceof Error ? err.message : String(err);
        const name = err instanceof Error ? err.name : '';
        if (
          name === 'SocietyLlmKeysExhaustedError' ||
          /keys_exhausted|全部无效/.test(msg)
        ) {
          skipReason = 'keys_exhausted';
          console.error(`[converse] ${msg}`);
        } else if (name === 'SocietyLlmTimeoutError' || /超时|aborted/i.test(msg)) {
          skipReason = 'timeout';
          console.warn(`[converse] ${msg}`);
        } else if (
          name === 'SocietyLlmOverloadedError' ||
          /529|overloaded|负载较高/.test(msg)
        ) {
          skipReason = 'overloaded';
          console.warn(`[converse] model busy, skip this beat`);
        } else {
          skipReason = 'error';
          console.warn(
            '[converse] LLM beat failed, skip spoken beat',
            msg.slice(0, 120),
          );
        }
        break;
      }
    }
  }

  const llmAttempted = Boolean(input.llm);
  if (!turns.length) {
    // Visible speech comes from the model. Stock paraphrases used to fill the
    // log, then the next retrieval treated that filler as news.
    skipEvent = true;
    degraded = true;
    skipReason ??= llmAttempted ? 'error' : 'no_model';
  }

  const asciiSummary = isAsciiCopy(
    people.map((p) => `${p.name}${p.identity}${p.occupation ?? ''}`).join(''),
  );
  const passedBy = asciiSummary
    ? `${names.join(', ')} passed by`
    : `${names.join('、')} 擦肩而过`;
  let spreadCount = 0;
  for (const from of people) {
    for (const to of people) {
      if (from.id === to.id) continue;
      spreadCount += spreadImportantMemories({
        stream: input.stream,
        fromId: from.id,
        toId: to.id,
        toName: to.name,
        fromName: from.name,
        nowSimTime: input.nowSimTime,
        idFactory: input.idFactory,
        card: from,
        skipSaturatedGossip: input.skipSaturatedGossip,
      });
    }
  }

  const summary = turns.length
    ? degraded
      ? turns
          .map((t) =>
            asciiSummary
              ? `${t.speakerName}: ${t.text}`
              : `${t.speakerName}：${t.text}`,
          )
          .slice(0, 4)
          .join(' / ') || passedBy
      : asciiSummary
        ? `${names.join(', ')} talking: ${turns.map((t) => t.text).join(' / ')}`
        : `${names.join('、')} 交谈：${turns.map((t) => t.text).join(' / ')}`
    : passedBy;
  // Each person stores what they themselves said and heard. A shared summary
  // made the next retrieval pull the same topic back for everyone.
  if (turns.length && !skipEvent && !degraded) {
    for (const agent of people) {
      const mine = turns
        .filter((t) => t.speakerId === agent.id)
        .map((t) => t.text)
        .join(' ');
      const heard = turns
        .filter((t) => t.speakerId !== agent.id)
        .map((t) => `${t.speakerName}：${t.text}`)
        .join(' ');
      const memoryText = asciiSummary
        ? `I said: ${mine.slice(0, 180)}. I heard: ${heard.slice(0, 280)}.`
        : `我当时说：${mine.slice(0, 180)}。我听到的是：${heard.slice(0, 280)}。`;
      input.stream.add(
        createMemoryEntry({
          id: input.idFactory(),
          agentId: agent.id,
          kind: 'dialogue',
          text: memoryText,
          simTime: input.nowSimTime,
          importance: 5,
        }),
      );
    }
  }

  return {
    turns,
    summary,
    spreadCount,
    degraded,
    skipEvent,
    ...(talkOutcomes ? { outcomes: talkOutcomes } : {}),
    ...(skipEvent && skipReason ? { skipReason } : {}),
    participantIds: people.map((p) => p.id),
  };
}

/**
 * Perception bookkeeping is written to the stream for retrieval, but nobody
 * says it out loud. Autobiography (`【往事】`) is a spoken fact — only identity
 * sheets, ToM notes, meet summaries, and acquaintance lists stay silent.
 */
const INTERNAL_NOTE =
  /^【(?:信念|身份|碰面|熟人)】|^看见\s|在附近，自己正在|^自己正在| nearby, I am |^recalling rumor|·\s*第\d+\s*步/u;

/**
 * Home/job recitals — seeded as "I live in X / 我住在X" on older worlds, or
 * wrapped as `【身份】` on new ones. Either way they are not spoken facts.
 */
const CENSUS_SPEECH =
  /我住在|我在.{0,24}干活|我在.{0,16}的岗位|路过跟你讲一声|I live in |I work at |Passing this along:|home at .+works at /iu;

/** Address / workplace recitals that should never become a speech bubble. */
export function isCensusSpeech(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return CENSUS_SPEECH.test(t);
}

/** Character sheets, ToM notes, interview echoes, and census recitals. */
export function isBookkeepingMemory(text: string): boolean {
  return (
    INTERNAL_NOTE.test(text) ||
    isInterviewEcho(text) ||
    isCensusSpeech(text)
  );
}

/** Lines for a listener with nothing new — varied so the log never stutters. */
const REACTION = [
  '真有这事？那我可得留个心。',
  '我今天也听人提过一嘴。',
  '难怪这地方这两天不太一样。',
  '行，那我先忙去了，回头细说。',
  '这话你可别到处讲。',
  '哦？我怎么一点没听见。',
  '嗯，我记下了。',
  '那我等会儿去看看。',
  '你说得也是，我先琢磨琢磨。',
  '有意思，回头再细说。',
  '我还得把摊上的事办完。',
  '先不聊这个，我赶时间。',
  '回头碰面再说。',
  '你提醒得对，我差点忘了。',
  '这事我帮你留个心眼。',
] as const;

const REACTION_EN = [
  'Is that true? I should keep an eye out.',
  'I heard a bit of that today too.',
  'No wonder this place feels different.',
  'Alright, I have to go — talk later.',
  'Do not spread that around.',
  'Huh? I had not heard a thing.',
  'Noted.',
  'I will go look in a bit.',
  'Fair point. Let me think on it.',
  'Interesting. We can pick this up later.',
  'I still have work to finish.',
  'Not now — I am in a hurry.',
  'Catch you later.',
  'Good reminder. I almost forgot.',
  'I will keep that in mind for you.',
] as const;

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function clockHour(sim: number): number {
  return Math.floor(((sim % 24) + 24) % 24);
}

function talkTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,，。.!？?；;：:\-/「」""]+/)
    .filter((t) => (/[\u4e00-\u9fff]/.test(t) ? t.length >= 2 : t.length > 3));
}

function citeMemoryIds(
  line: string,
  mems: readonly MemoryEntry[],
): string[] {
  const lineTok = talkTokens(line);
  return mems
    .filter((m) => {
      if (!m.id) return false;
      const ov = talkTokens(m.text).filter((t) => lineTok.includes(t)).length;
      return ov >= 1 || (m.text.length >= 6 && line.includes(m.text.slice(0, 8)));
    })
    .map((m) => m.id)
    .slice(0, 4);
}

function topicHint(fact: string): string {
  const core = stripHearsay(sayable(fact))
    .replace(/[「」""]/g, '')
    .trim();
  if (/[\u4e00-\u9fff]/.test(core)) return core.slice(0, 8);
  return core.split(/\s+/).slice(0, 8).join(' ');
}

function refuseTold(
  speaker: Talker,
  peer: string,
  beat: number,
  index: number,
): string {
  const ascii = isAsciiCopy(`${speaker.name}${speaker.identity}`);
  const hour = clockHour(beat);
  const stamp = `${hour}:${String(Math.abs(Math.round((beat % 1) * 60)) % 60).padStart(2, '0')}`;
  const frames = ascii
    ? [
        `I already told you about that last week, ${peer}. (${stamp})`,
        `${speaker.name} shakes their head at ${peer}: we covered this by ${stamp}.`,
        `Not again — I said this to ${peer} already, around ${stamp}.`,
        `${speaker.name} at ${stamp}: ${peer}, I mentioned that earlier.`,
        `Same news as last week, ${peer}. I will not repeat it at ${stamp}.`,
        `${speaker.name} waves ${peer} off at ${stamp}: you already heard me.`,
      ]
    : [
        `${stamp}，这事我上周已经跟你说过了。`,
        `${speaker.name}对${peer}摇头：这话我讲过了（${stamp}）。`,
        `别复读了，我早就告诉过${peer}。现在是${stamp}。`,
        `${stamp}，${speaker.name}说：${peer}，这事我提过。`,
        `${speaker.name}不愿再对${peer}讲同一句（${stamp}）。`,
        `上周那档子，我跟${peer}说过，${stamp}不再念了。`,
      ];
  return pickPhrase(frames, speaker.name, peer, beat, index);
}

/** Admit a town split — template path must not silently overwrite the other fact. */
function utterDisagree(input: {
  readonly speaker: Talker;
  readonly peer: string;
  readonly a: string;
  readonly b: string;
  readonly beat: number;
  readonly index: number;
}): string {
  const { speaker, peer, beat, index } = input;
  const hint =
    topicHint(input.a) ||
    topicHint(input.b) ||
    (isAsciiCopy(input.a) ? 'that news' : '那档子事');
  const ascii = isAsciiCopy(`${speaker.name}${speaker.identity}`);
  const hour = clockHour(beat);
  const stamp = `${hour}:${String(Math.abs(Math.round((beat % 1) * 60)) % 60).padStart(2, '0')}`;
  const frames = ascii
    ? [
        `${speaker.name} tells ${peer} people split on ${hint} — they will not paper it over (${stamp}).`,
        `At ${stamp} ${speaker.name} admits the town disagrees about ${hint}.`,
        `${speaker.name} to ${peer}: two stories about ${hint}; they will not overwrite either.`,
      ]
    : [
        `${speaker.name}对${peer}说：${hint}这件事镇上有两派说法，我不敢替他们圆（${stamp}）。`,
        `${stamp}，${speaker.name}承认${hint}上有人看法相反，不得静默覆盖。`,
        `${speaker.name}跟${peer}讲：${hint}不是一句话能圆过去的。`,
      ];
  return pickPhrase(frames, speaker.name, peer, beat, index);
}

/** Paraphrase a memory — never emit the original sentence. */
function utterParaphrase(input: {
  readonly speaker: Talker;
  readonly peer: string;
  readonly fact: string;
  readonly beat: number;
  readonly index: number;
  readonly lead: boolean;
}): string {
  const { speaker, peer, fact, beat, index, lead } = input;
  const hint = topicHint(fact) || (isAsciiCopy(fact) ? 'that news' : '那档子事');
  const name = speaker.name;
  const ascii = isAsciiCopy(`${name}${speaker.identity}${speaker.occupation ?? ''}`);
  const hour = clockHour(beat);
  const stamp = `${hour}:${String(Math.abs(Math.round((beat % 1) * 60)) % 60).padStart(2, '0')}`;
  const job = speaker.occupation ?? speaker.identity.slice(0, 6);
  const frames = ascii
    ? lead
      ? [
          `${name} tells ${peer} they heard movement around ${hint} (${stamp}).`,
          `About ${hint} — ${name} will not repeat the same words at ${stamp}.`,
          `${name} leans in at ${stamp}: that ${hint} business is still open.`,
          `At ${stamp} ${name} the ${job} mentions ${hint} to ${peer}.`,
          `${name} brings ${peer} a fresh take on ${hint} around ${stamp}.`,
        ]
      : [
          `${name} answers without reciting at ${stamp}: ${hint} is not settled.`,
          `On that, ${name} only says the ${hint} talk is still going (${stamp}).`,
          `${name} nods at ${peer} at ${stamp}: different words, same ${hint} worry.`,
          `${name} (${job}) adds a ${stamp} note about ${hint}.`,
          `${peer} gets a new angle from ${name} at ${stamp}: ${hint}.`,
        ]
    : lead
      ? [
          `${stamp}，${name}跟${peer}转述：${hint}那边还有动静。`,
          `换个说法，${name}只提${hint}的事还没完（${stamp}）。`,
          `${name}凑近${peer}：${hint}那档子，${stamp}不再原句讲。`,
          `${stamp}，${job}${name}跟${peer}说起${hint}。`,
          `${name}换一句把${hint}告诉${peer}（${stamp}）。`,
        ]
      : [
          `${name}接话，不复读：${hint}还没定（${stamp}）。`,
          `说到这个，${name}只说${hint}的传闻还在传（${stamp}）。`,
          `${name}对${peer}点头：同一件事，换一句（${stamp}）。`,
          `${stamp}，${job}${name}补了一句关于${hint}，不念原文。`,
          `${name}应${peer}：${hint}还得再看看（${stamp}）。`,
        ];
  const line = pickPhrase(frames, name, peer, beat, index);
  const original = stripHearsay(sayable(fact)).trim();
  if (original.length > hint.length + 2 && line.includes(original)) {
    return ascii
      ? `${name} will not recite that to ${peer} (${stamp}).`
      : `${name}不愿把原话再对${peer}讲一遍（${stamp}）。`;
  }
  return line;
}

/**
 * Wrap a shared fact so two speakers never emit the identical string. The
 * novelty gate counts unique spoken lines over a whole day; openers alone
 * collapsed 100+ talks onto ~8 rumor sentences.
 */
function utterFact(input: {
  readonly speaker: Talker;
  readonly peer: string;
  readonly fact: string;
  readonly beat: number;
  readonly index: number;
  readonly lead: boolean;
}): string {
  return utterParaphrase(input);
}

function utterReact(
  speaker: Talker,
  peer: string,
  beat: number,
  index: number,
): string {
  const hour = clockHour(beat);
  const stamp = `${hour}:${String(Math.abs(Math.round((beat % 1) * 60)) % 60).padStart(2, '0')}`;
  const doing = speaker.action ? sayable(speaker.action) : '';
  const ascii = isAsciiCopy(
    `${speaker.name}${speaker.identity}${speaker.occupation ?? ''}`,
  );
  return pickPhrase(
    ascii
      ? [
          `${speaker.name} nods at ${peer} (${stamp}).`,
          `It is ${stamp}. ${speaker.name} says talk later.`,
          doing
            ? `${speaker.name} is still ${doing} and will not unpack this now (${stamp}).`
            : `${speaker.name} greets ${peer} and they both get back to work at ${stamp}.`,
          `${speaker.name} waves ${peer} off at ${stamp}: catch you later.`,
          `${pickPhrase(REACTION_EN, speaker.id, beat, index)} (${stamp})`,
        ]
      : [
          `${speaker.name}朝${peer}点了点头（${stamp}）。`,
          `${stamp}，${speaker.name}说回头再聊。`,
          doing
            ? `${speaker.name}说自己还在${doing}，先不展开（${stamp}）。`
            : `${speaker.name}跟${peer}打了个招呼，又各自忙去了（${stamp}）。`,
          `${speaker.name}对${peer}挥挥手：回头碰面再说（${stamp}）。`,
          `${pickPhrase(REACTION, speaker.id, beat, index)}（${stamp}）`,
        ],
    speaker.id,
    peer,
    beat,
    index,
  );
}

/**
 * Pick a phrasing that is stable for a given speaker and moment, so the same
 * person does not say the same thing twice in a row and two people in one circle
 * do not pick the same filler.
 */
function pickPhrase<T>(pool: readonly T[], ...seed: Array<string | number>): T {
  let h = 0;
  for (const part of seed) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return pool[Math.abs(h) % pool.length]!;
}

/** Same fact heard second-hand must not count as a fresh thing to say. */
function dedupeKey(text: string): string {
  return sayable(text).toLowerCase().slice(0, 40);
}

/**
 * Memory text carries bookkeeping prefixes and reflection scaffolding that no
 * one would ever utter aloud. Strip it before it becomes a spoken line.
 */
function sayable(text: string): string {
  return stripHearsay(text)
    .replace(/^查看了[：:]?\s*/u, '')
    .replace(/关于「[^」]*」——?/gu, '')
    .replace(/^[^：:]{0,10}[：:]\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 48);
}

/** Two-person conversation — the common case, kept as a thin wrapper. */
export async function converse(input: {
  readonly stream: MemoryStream;
  readonly a: Talker;
  readonly b: Talker;
  readonly nowSimTime: number;
  readonly relationSummary?: string;
  readonly topicHint?: string;
  readonly forceRumor?: boolean;
  readonly avoidLines?: readonly string[];
  readonly skipSaturatedGossip?: boolean;
  readonly maxTurns?: number;
  readonly idFactory: () => string;
  readonly llm?: LlmTextFn;
}): Promise<ConversationResult> {
  const { a, b, ...rest } = input;
  return converseGroup({
    ...rest,
    participants: [a, b],
    maxTurns: input.maxTurns ?? 4,
  });
}
