/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Locale-aware observatory inspector helpers (talk titles, memory filters,
 * commitment chips). Kept out of the React tree so tests can cover English
 * crew/cloister copy without mounting the stage.
 */

export type InspectorT = (
  key: string,
  vars?: Record<string, string>,
) => string;

export type CommitmentChip = {
  readonly kind: 'plaza' | 'reply' | 'promise' | 'conflict' | 'adopt' | 'rumor';
  readonly who: string;
  readonly detail?: string;
};

export type InspectorTalkLine = {
  readonly who?: string;
  readonly to?: string;
  readonly text: string;
  readonly kind?: string;
  readonly interview?: boolean;
};

const TOWN_SPEAKER_RE = /^(全镇|全舰|全院|Town|Whole crew|House)$/i;

export function isTownWideSpeaker(name: string | undefined): boolean {
  return Boolean(name && TOWN_SPEAKER_RE.test(name.trim()));
}

export function townWideSpeakerLabel(input: {
  readonly ascii: boolean;
  readonly packId?: string;
}): string {
  const pack = input.packId ?? '';
  if (pack === 'society.crew') return input.ascii ? 'Whole crew' : '全舰';
  if (pack === 'society.cloister') return input.ascii ? 'House' : '全院';
  return input.ascii ? 'Town' : '全镇';
}

export function isBeliefMemory(text: string): boolean {
  return /^【信念】|^Belief:/i.test(text);
}

export function isWitnessMemory(text: string): boolean {
  return /在[^，,]{1,16}，正在/.test(text) || / is at /i.test(text);
}

export function isPaidTraceMemory(text: string): boolean {
  return (
    text.includes('有人悄悄对你说') ||
    text.includes('Someone whispered') ||
    text.includes('镇上在传') ||
    text.includes('Word is out') ||
    text.includes('【认养】') ||
    /^Adopted /i.test(text)
  );
}

export type PaidTraceKind = 'whisper' | 'rumor' | 'adopt';

export function paidTraceKind(text: string): PaidTraceKind | null {
  if (text.includes('【认养】') || /^Adopted /i.test(text)) return 'adopt';
  if (text.includes('有人悄悄对你说') || text.includes('Someone whispered')) {
    return 'whisper';
  }
  if (text.includes('镇上在传') || text.includes('Word is out')) return 'rumor';
  return null;
}

export function isBookkeepingMemory(text: string): boolean {
  return (
    /^【(?:信念|身份|碰面|熟人)】/.test(text) ||
    /^Belief:/i.test(text) ||
    /^看见\s/.test(text) ||
    /在附近，自己正在/.test(text) ||
    /^自己正在/.test(text) ||
    /·\s*第\d+\s*步/.test(text) ||
    /^有人采访我/.test(text) ||
    /^saw\s/i.test(text) ||
    /nearby, I am/i.test(text) ||
    /^recalling rumor/i.test(text) ||
    /^Someone interviewed me/i.test(text)
  );
}

export function displayMemoryText(text: string): string {
  return text
    .replace(/^【往事】/, '')
    .replace(/^【信念】\s*/, '')
    .replace(/^Belief:\s*/i, '');
}

export function talkingWithOf(action: string): string | undefined {
  const m =
    action.match(/^与(.+?)交谈/) ?? action.match(/^talking with (.+)/i);
  const name = m?.[1]?.trim();
  return name || undefined;
}

export function talkNameJoin(
  names: readonly string[],
  locale: string,
): string {
  return locale === 'en' ? names.join(', ') : names.join('、');
}

export function talkColon(locale: string): string {
  return locale === 'en' ? ': ' : '：';
}

const TURN_MARKS = '①②③④⑤⑥⑦⑧⑨⑩';

export function talkTurnMark(index: number): string {
  return TURN_MARKS[index] ?? `${index + 1}.`;
}

export function talkSeqOfLine(
  line: { talkSeq?: number } | undefined,
): number {
  const n = Number(line?.talkSeq);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function compareSocietyEvtOrder(
  a: {
    id: string;
    simTime: number;
    payload?: Record<string, unknown>;
    createdAtMs?: number;
  },
  b: {
    id: string;
    simTime: number;
    payload?: Record<string, unknown>;
    createdAtMs?: number;
  },
): number {
  if (a.simTime !== b.simTime) return a.simTime - b.simTime;
  const sa = talkSeqOfLine({ talkSeq: Number(a.payload?.['talkSeq']) });
  const sb = talkSeqOfLine({ talkSeq: Number(b.payload?.['talkSeq']) });
  if (sa !== sb) return sa - sb;
  const ca = Number(a.createdAtMs) || 0;
  const cb = Number(b.createdAtMs) || 0;
  if (ca !== cb) return ca - cb;
  return String(a.id).localeCompare(String(b.id));
}

export function compareTalkLines(
  a: { talkSeq?: number; simTime: number; turnIndex: number; id: string },
  b: { talkSeq?: number; simTime: number; turnIndex: number; id: string },
): number {
  const sa = talkSeqOfLine(a);
  const sb = talkSeqOfLine(b);
  if (sa !== sb) return sa - sb;
  if (a.simTime !== b.simTime) return a.simTime - b.simTime;
  if (a.turnIndex !== b.turnIndex) return a.turnIndex - b.turnIndex;
  return a.id.localeCompare(b.id);
}

/** Newest lines first. A stack of model-failure markers keeps only the latest one.
 * An intervention stays pinned even when its clock is behind the live tip.
 */
export function visibleTalkGroups<
  T extends {
    simTime: number;
    kind?: string;
    lines: ReadonlyArray<{ skipReason?: string }>;
  },
>(groups: readonly T[], limit = 8): T[] {
  const spoken = groups.filter(
    (group) => !group.lines.length || group.lines.some((line) => !line.skipReason),
  );
  const failures = groups.filter(
    (group) => group.lines.length > 0 && group.lines.every((line) => Boolean(line.skipReason)),
  );
  const latestFail = [...failures].sort((a, b) => a.simTime - b.simTime).slice(-1);
  const ranked = [...spoken, ...latestFail].sort((a, b) => b.simTime - a.simTime);
  const pinned = [...groups]
    .filter((group) => group.kind === 'intervene')
    .sort((a, b) => b.simTime - a.simTime)[0];
  const rest = pinned ? ranked.filter((group) => group !== pinned) : ranked;
  return (pinned ? [pinned, ...rest] : rest).slice(0, limit);
}

export function orderTalkGroups<
  T extends { talkSeq?: number; simTime: number; id: string },
>(groups: readonly T[], currentTalkSeq?: number | null): T[] {
  const sorted = [...groups].sort((a, b) => {
    const sa = talkSeqOfLine(a);
    const sb = talkSeqOfLine(b);
    if (sa !== sb) return sa - sb;
    if (a.simTime !== b.simTime) return a.simTime - b.simTime;
    return a.id.localeCompare(b.id);
  });
  if (currentTalkSeq == null || currentTalkSeq <= 0) return sorted;
  const current = sorted.filter((g) => talkSeqOfLine(g) === currentTalkSeq);
  const rest = sorted.filter((g) => talkSeqOfLine(g) !== currentTalkSeq);
  return [...current, ...rest];
}

export function talkGroupTitle(
  lines: ReadonlyArray<Pick<InspectorTalkLine, 'who' | 'to'>>,
  t: InspectorT,
): string {
  const names = [
    ...new Set(
      lines
        .flatMap((l) => [
          l.who,
          ...(l.to ? l.to.split(/[、,，]/).map((s) => s.trim()) : []),
        ])
        .filter((n): n is string => Boolean(n) && !isTownWideSpeaker(n)),
    ),
  ];
  if (names.length >= 3) {
    return t('product.obs.talkWithGroup', { a: names[0]!, b: names[1]! });
  }
  if (names.length === 2) {
    return t('product.obs.talkWithPair', { a: names[0]!, b: names[1]! });
  }
  return names[0] ?? '';
}

export function overlayTalkText(
  line: InspectorTalkLine,
  t: InspectorT,
  locale: string,
): string {
  const tag = line.interview
    ? `(${t('product.obs.interviewTag')}) `
    : line.kind === 'intervene'
      ? `(${t('product.obs.rumorTag')}) `
      : '';
  const colon = talkColon(locale);
  if (line.to && line.who && !isTownWideSpeaker(line.who)) {
    return `${tag}${line.who} → ${line.to}${colon}${line.text}`;
  }
  if (line.who) return `${tag}${line.who}${colon}${line.text}`;
  return `${tag}${line.text}`;
}

export function commitmentChips(
  relations: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly summary: string;
    readonly kind?: string;
  }>,
  agentId: string,
  nameOf: (id: string) => string,
): CommitmentChip[] {
  const out: CommitmentChip[] = [];
  const seen = new Set<string>();
  for (const r of relations) {
    if (r.from !== agentId && r.to !== agentId) continue;
    const other = r.from === agentId ? r.to : r.from;
    const who = nameOf(other) || other.slice(0, 8);
    const body = r.summary.replace(/^【[^】]+】\s*/u, '').trim();
    const kind = r.kind ?? '';
    let chip: CommitmentChip | undefined;
    if (kind === 'promise' || /有约定|promise/i.test(r.summary)) {
      if (
        /今晚|广场|聚会|交班|晚课|碰面|tonight|gathering|handoff|vespers|meet at|plaza|square|bridge|chapel/i.test(
          body,
        )
      ) {
        chip = { kind: 'plaza', who };
      } else if (/答应|回话|回你|reply|answer|owes/i.test(body)) {
        chip = { kind: 'reply', who };
      } else {
        chip = { kind: 'promise', who, detail: body.slice(0, 18) };
      }
    } else if (
      kind === 'conflict' ||
      /闹过别扭|at odds|conflict/i.test(r.summary)
    ) {
      chip = { kind: 'conflict', who };
    } else if (kind === 'adopted' || /【认养】/.test(r.summary)) {
      chip = { kind: 'adopt', who };
    } else if (kind === 'rumor' || /【巷议】/.test(r.summary)) {
      chip = { kind: 'rumor', who };
    }
    if (!chip) continue;
    const key = `${chip.kind}:${chip.who}:${chip.detail ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chip);
    if (out.length >= 4) break;
  }
  return out;
}

export function isOwnedPlaceName(name: string): boolean {
  return (
    /的(家|铺|炉|案板|工位|课桌|诊桌|网位|窑口)$/.test(name) ||
    /'s (home|shop|bunk|cell|galley|forge|desk|oven|pew|station)\b/i.test(name)
  );
}

export type RosterHonesty = {
  readonly plannerSource: string | null;
  readonly npcCount: number;
  readonly paddedCount: number;
  readonly authoredCount: number;
};

export function rosterHonesty(spec: {
  readonly entities?: ReadonlyArray<{
    readonly kind?: string;
    readonly tags?: readonly string[];
  }>;
  readonly presentation?: { readonly plannerSource?: string };
}): RosterHonesty {
  const npcs = (spec.entities ?? []).filter((e) => e.kind === 'npc');
  const paddedCount = npcs.filter((e) =>
    (e.tags ?? []).includes('padded'),
  ).length;
  return {
    plannerSource: spec.presentation?.plannerSource ?? null,
    npcCount: npcs.length,
    paddedCount,
    authoredCount: Math.max(0, npcs.length - paddedCount),
  };
}

export function plannerSourceLabelKey(
  source: string | null | undefined,
): string | null {
  if (source === 'llm') return 'product.obs.plannerLlm';
  if (source === 'heuristic') return 'product.obs.plannerHeuristic';
  if (source === 'heuristic_merged') return 'product.obs.plannerMerged';
  return null;
}

/** Status line for the observatory clock — never call template remainder a parse failure. */
export function clockHonestyKey(input: {
  readonly skipReason?: string | null;
  readonly dialogueKind?: string | null;
  readonly llm?: boolean | null;
  readonly degraded?: boolean;
  readonly authorPaused?: boolean;
  readonly joining?: boolean;
  readonly isGenerating?: boolean;
}): string | null {
  if (input.isGenerating || input.skipReason === 'generate') {
    return 'product.obs.llmGenerateMute';
  }
  if (input.authorPaused) return 'product.obs.authorPaused';
  if (input.skipReason === 'no_key') return 'product.obs.llmDegraded';
  if (input.skipReason === 'budget') return 'product.obs.fundingWalk';
  if (input.skipReason === 'keys_exhausted') return 'product.obs.llmKeysExhausted';
  if (input.skipReason === 'no_permit') return 'product.obs.fundingWalk';
  if (input.skipReason === 'unwatched') {
    return input.joining ? 'product.obs.guestJoining' : 'product.obs.guestIdle';
  }
  if (input.dialogueKind === 'template' || input.degraded) {
    return 'product.obs.llmTemplate';
  }
  if (input.llm === false) return 'product.obs.llmDegraded';
  if (input.llm) return 'product.obs.llmOk';
  return null;
}
