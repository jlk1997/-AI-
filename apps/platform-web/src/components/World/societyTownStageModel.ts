/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure helpers for the town stage. Keep SocietyTownStage.tsx to observe /
 * lighthouse / map wiring so a later UI change does not re-open this file.
 */

import type { DataNode } from 'antd/es/tree';
import {
  anonymousLeadName,
  formatWorldClock,
  isGenericGatheringLine,
  openingRumorFromSpec,
  type WorldLike,
} from '@opengame/world-spec';

import { applyObserveModeParam } from './societyTownGating';
import {
  compareSocietyEvtOrder,
  compareTalkLines,
  displayMemoryText,
  isBeliefMemory,
  isBookkeepingMemory,
  isOwnedPlaceName,
  isPaidTraceMemory,
  isWitnessMemory,
} from './societyInspectorCopy';

export type TalkLine = {
  id: string;
  eventId: string;
  turnIndex: number;
  simTime: number;
  kind: string;
  who: string;
  to?: string;
  text: string;
  agentId?: string;
  degraded?: boolean;
  neutral?: boolean;
  createdAtMs?: number;
  skipReason?: string;
  retryQueued?: boolean;
  interview?: boolean;
  talkSeq?: number;
  circleIndex?: number;
};

export type TalkCopyOpts = {
  nodText: string;
  townLabel: string;
  locale: string;
  skipText: (reason: string, retryQueued: boolean) => string;
};

export type SocietyEvt = {
  id: string;
  simTime: number;
  kind: string;
  agentId?: string | null;
  payload: Record<string, unknown>;
  createdAtMs?: number;
};

export type RelationEdge = {
  from: string;
  to: string;
  summary: string;
  affinity: number;
  kind?: string;
  lastInteractSimTime?: number;
};

export type TownNeeds = {
  hunger: number;
  energy: number;
  social: number;
  curiosity: number;
};

export type TownAgent = {
  id: string;
  name: string;
  currentAction: string;
  regionId?: string;
  areaId?: string;
  areaName?: string;
  regionName?: string;
  goalPlace?: string;
  goalReason?: string;
  drive?: string;
  goalX?: number;
  goalY?: number;
  needs?: TownNeeds;
  padded?: boolean;
  identity?: string;
};

export type TownObject = {
  id: string;
  name: string;
  state: string;
  regionId?: string;
  areaId?: string;
  areaName?: string;
  kind?: string;
  x?: number;
  y?: number;
};

export type EmergenceReport = {
  summary: string;
  informationSpread: {
    rate: number;
    awareCount?: number;
    totalAgents?: number;
    seedText?: string;
    awareIds?: string[];
  };
  relationshipFormation: { newRelations: number };
  coordination: {
    attendanceRate: number;
    peakGathering?: number;
    peakGatheringRate?: number;
    peakRegionId?: string;
  };
  scheduleDiversity?: { rate: number };
  dialogueNovelty?: { rate: number; groupDialogues?: number };
  dialogueQuality?: {
    inCharacter: number;
    citesMemory: number;
    followsLast: number;
    summary: string;
  };
  seed?: {
    hours?: number;
    dialogues?: number;
    degraded?: boolean;
    spreadOk?: boolean;
    gateFailed?: boolean;
    reason?: string;
    retrievalDegraded?: boolean;
  };
};

export type SocietyFrame = {
  simTime: number;
  events: SocietyEvt[];
  agents: Array<{
    id: string;
    name: string;
    regionId?: string;
    areaId?: string;
    areaName?: string;
    regionName?: string;
    currentAction: string;
    goalPlace?: string;
    goalReason?: string;
    drive?: string;
    goalX?: number;
    goalY?: number;
    needs?: TownNeeds;
    padded?: boolean;
  }>;
  relations?: RelationEdge[];
  objects?: TownObject[];
  report?: EmergenceReport | null;
  llm?: boolean;
  degraded?: boolean;
  skipReason?:
    | 'budget'
    | 'no_key'
    | 'generate'
    | 'unwatched'
    | 'no_permit'
    | 'keys_exhausted';
  dialogueKind?: 'model' | 'template' | 'none';
  talksMuted?: boolean;
  retrievalDegraded?: boolean;
  talkBudget?: unknown;
  agentsDelta?: boolean;
  opinion?: import('./SocietyOpinionBoard').OpinionBoardView;
  crowd?: Array<{ regionId: string; x: number; y: number; stance: number }>;
};

export function generatingRumorLine(worldLike?: WorldLike): string | undefined {
  if (!worldLike) return undefined;
  const rumor = openingRumorFromSpec(
    anonymousLeadName(worldLike),
    worldLike,
  ).trim();
  if (rumor.length < 6 || isGenericGatheringLine(rumor)) return undefined;
  return rumor.slice(0, 72);
}

export function withObserveMode(url: string, force = false): string {
  try {
    const u = new URL(url, window.location.href);
    if (force || !u.searchParams.has('mode')) u.searchParams.set('mode', 'observe');
    return u.toString();
  } catch {
    return applyObserveModeParam(url, force);
  }
}

export function townAgentFrom(a: TownAgent): TownAgent {
  return {
    id: a.id,
    name: a.name,
    currentAction: a.currentAction,
    regionId: a.regionId,
    areaId: a.areaId,
    areaName: a.areaName,
    regionName: a.regionName,
    goalPlace: a.goalPlace,
    goalReason: a.goalReason,
    drive: a.drive,
    goalX: a.goalX,
    goalY: a.goalY,
    needs: a.needs,
    padded: a.padded,
    identity: a.identity,
  };
}

export function clipNeeds(raw: unknown): TownNeeds | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const n = (k: string): number => {
    const v = o[k];
    return typeof v === 'number' && Number.isFinite(v)
      ? Math.max(0, Math.min(1, v))
      : 0;
  };
  return {
    hunger: n('hunger'),
    energy: n('energy'),
    social: n('social'),
    curiosity: n('curiosity'),
  };
}

export function isMapEventKind(kind: string): boolean {
  return (
    kind === 'move' ||
    kind === 'action' ||
    kind === 'use-object' ||
    kind === 'dialogue' ||
    kind === 'intervene' ||
    kind === 'plan' ||
    kind === 'reflection'
  );
}

export function pinMapEvents(events: SocietyEvt[]): SocietyEvt[] {
  const map = [...events.filter((e) => isMapEventKind(e.kind))].sort(
    compareSocietyEvtOrder,
  );
  const recent = map.slice(-80);
  const talks = events
    .filter((e) => e.kind === 'intervene' || e.kind === 'dialogue')
    .sort(compareSocietyEvtOrder);
  const extra = [
    ...talks.filter((e) => e.kind === 'intervene'),
    ...talks.slice(-32),
  ];
  const byId = new Map(recent.map((e) => [e.id, e]));
  for (const e of extra) byId.set(e.id, e);
  return [...byId.values()].sort(compareSocietyEvtOrder);
}

export function isCourseCanonEvent(e: Pick<SocietyEvt, 'kind' | 'payload'>): boolean {
  return e.kind === 'observation' && e.payload['course'] === true;
}

export function pinTalkEvents(events: SocietyEvt[]): SocietyEvt[] {
  const talks = events
    .filter(
      (e) =>
        e.kind === 'dialogue' || e.kind === 'intervene' || isCourseCanonEvent(e),
    )
    .sort(compareSocietyEvtOrder);
  const recent = talks.slice(-32);
  const extra = talks.filter((e) => e.kind === 'intervene');
  const byId = new Map(recent.map((e) => [e.id, e]));
  for (const e of extra) byId.set(e.id, e);
  return [...byId.values()].sort(compareSocietyEvtOrder);
}

export function objectLooksBroken(state: string | undefined): boolean {
  return /熄|灭了|坏了|关了|broken|\bout\b|offline/i.test(state ?? '');
}

export function compactReportPayload(report: EmergenceReport | null | undefined) {
  if (!report) return null;
  return {
    summary: report.summary,
    informationSpread: report.informationSpread,
    relationshipFormation: report.relationshipFormation,
    coordination: report.coordination,
    dialogueQuality: report.dialogueQuality,
    scheduleDiversity: report.scheduleDiversity,
  };
}

export function formatTownClock(
  t: number,
  clock?: { kind?: string; shifts?: number },
  ascii = false,
): string {
  return formatWorldClock(t, clock, { ascii });
}

export function visibleMemoriesOf<T extends { kind: string; text: string }>(
  memories: ReadonlyArray<T>,
  filter: 'all' | 'witness' | 'belief' | 'reflection' | 'paid',
): T[] {
  return memories.filter((m) =>
    filter === 'belief'
      ? isBeliefMemory(m.text)
      : filter === 'reflection'
        ? m.kind === 'reflection'
        : filter === 'witness'
          ? isWitnessMemory(m.text)
          : filter === 'paid'
            ? isPaidTraceMemory(m.text)
            : !isBookkeepingMemory(m.text) || isPaidTraceMemory(m.text),
  );
}

export function reflectionTreeNodes(
  memories: ReadonlyArray<{
    id?: string;
    kind: string;
    text: string;
    pointers?: unknown;
  }>,
): DataNode[] {
  const visited = new Set<string>();
  const childOf = (
    pointers: unknown,
    parentKey: string,
    depth: number,
  ): DataNode[] => {
    if (depth > 3 || !Array.isArray(pointers)) return [];
    const children: DataNode[] = [];
    for (const pid of pointers as unknown[]) {
      if (typeof pid !== 'string') continue;
      const key = `${parentKey}_${pid}_${depth}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const ev = memories.find((x) => x.id === pid);
      children.push({
        key,
        title: ev
          ? `[${ev.kind}] ${displayMemoryText(ev.text).slice(0, 80)}`
          : `evidence:${pid.slice(0, 8)}`,
        children:
          ev?.kind === 'reflection' ? childOf(ev.pointers, key, depth + 1) : [],
      });
    }
    return children;
  };
  return memories
    .filter((m) => m.kind === 'reflection')
    .map((m, i) => {
      const mid = m.id ?? `ref_${i}`;
      return {
        key: mid,
        title: `💭 ${displayMemoryText(m.text).slice(0, 100)}`,
        children: childOf(m.pointers, mid, 1),
      };
    });
}

export function ownedPlacesOf(
  agents: readonly TownAgent[],
  objects: readonly TownObject[],
): Array<{
  id: string;
  name: string;
  regionId: string;
  who: string[];
}> {
  const map = new Map<
    string,
    { id: string; name: string; regionId: string; who: string[] }
  >();
  const add = (
    id: string | undefined,
    name: string | undefined,
    regionId: string | undefined,
    who?: string,
  ) => {
    if (!id || !name) return;
    const cur = map.get(id);
    if (cur) {
      if (who && !cur.who.includes(who)) cur.who.push(who);
      return;
    }
    map.set(id, {
      id,
      name,
      regionId: regionId ?? '',
      who: who ? [who] : [],
    });
  };
  for (const o of objects) add(o.areaId, o.areaName, o.regionId);
  for (const a of agents) add(a.areaId, a.areaName, a.regionId, a.name);
  const all = [...map.values()];
  const owned = all.filter((p) => isOwnedPlaceName(p.name));
  const rest = all.filter((p) => !isOwnedPlaceName(p.name));
  return [...rest, ...owned].slice(0, 20);
}

export function pointerSnippets(
  pointers: unknown,
  memories: ReadonlyArray<{
    id?: string;
    kind: string;
    text: string;
    pointers?: unknown;
  }>,
  depth = 1,
): string[] {
  if (depth > 3 || !Array.isArray(pointers)) return [];
  const out: string[] = [];
  for (const pid of pointers) {
    if (typeof pid !== 'string') continue;
    const hit = memories.find((x) => x.id === pid);
    const label = hit?.text.slice(0, 28) ?? pid.slice(0, 8);
    out.push(`${'　'.repeat(depth - 1)}${label}`);
    if (hit?.kind === 'reflection' && hit.pointers) {
      out.push(...pointerSnippets(hit.pointers, memories, depth + 1));
    }
  }
  return out.slice(0, 8);
}

export function talkStampOf(e: SocietyEvt): { talkSeq?: number; circleIndex?: number } {
  const talkSeq = Number(e.payload['talkSeq']);
  const circleIndex = Number(e.payload['circleIndex']);
  return {
    ...(Number.isFinite(talkSeq) && talkSeq > 0 ? { talkSeq } : {}),
    ...(Number.isFinite(circleIndex) && circleIndex > 0
      ? { circleIndex }
      : {}),
  };
}

export function talkMetaFromEvent(
  e: SocietyEvt,
): Partial<Pick<TalkLine, 'agentId' | 'degraded' | 'neutral' | 'createdAtMs'>> {
  return {
    ...(e.agentId ? { agentId: String(e.agentId) } : {}),
    ...(e.payload['degraded'] === true ? { degraded: true } : {}),
    ...(e.payload['courseNeutral'] === true ? { neutral: true } : {}),
    ...(typeof e.createdAtMs === 'number' && e.createdAtMs > 0
      ? { createdAtMs: e.createdAtMs }
      : {}),
  };
}

export function talkLineFromEvent(
  e: SocietyEvt,
  nameOf: (id: string) => string,
  opts: TalkCopyOpts,
): TalkLine | null {
  if (e.kind !== 'dialogue' && e.kind !== 'intervene') return null;
  const turns = e.payload['turns'];
  let text = '';
  if (Array.isArray(turns) && turns[0] && typeof turns[0] === 'object') {
    const t0 = (turns[0] as { text?: unknown }).text;
    if (typeof t0 === 'string') text = t0;
  }
  if (!text) {
    text = String(e.payload['summary'] ?? e.payload['text'] ?? '').split(
      /[。/]/,
    )[0] ?? '';
  }
  if (!text.trim()) return null;
  const town = e.payload['town'] === true || e.payload['kind'] === 'rumor';
  const withName =
    typeof e.payload['with'] === 'string'
      ? nameOf(String(e.payload['with']))
      : '';
  let speakerFromTurn: string | undefined;
  if (Array.isArray(turns) && turns[0] && typeof turns[0] === 'object') {
    const name = (turns[0] as { speakerName?: unknown }).speakerName;
    if (typeof name === 'string' && name.trim()) speakerFromTurn = name;
  }
  const who = town
    ? (speakerFromTurn ?? opts.townLabel)
    : nameOf(String(e.agentId ?? ''));
  const interview = e.payload['interview'] === true;
  const meta = talkMetaFromEvent(e);
  return {
    id: e.id,
    eventId: e.id,
    turnIndex: 0,
    simTime: e.simTime,
    kind: e.kind,
    who,
    to: town ? undefined : withName || undefined,
    text: text.slice(0, 140),
    interview,
    ...meta,
    ...talkStampOf(e),
  };
}

export function talkLinesFromEvent(
  e: SocietyEvt,
  nameOf: (id: string) => string,
  opts: TalkCopyOpts,
): TalkLine[] {
  const sep = opts.locale === 'en' ? ', ' : '、';
  if (isCourseCanonEvent(e)) {
    const text = String(e.payload['text'] ?? '').trim();
    if (!text) return [];
    return [
      {
        id: e.id,
        eventId: e.id,
        turnIndex: 0,
        simTime: e.simTime,
        kind: 'observation',
        who: opts.townLabel,
        text: text.slice(0, 140),
      },
    ];
  }
  if (e.kind === 'dialogue') {
    const turns = e.payload['turns'];
    const participantIds = Array.isArray(e.payload['participants'])
      ? (e.payload['participants'] as unknown[]).filter(
          (id): id is string => typeof id === 'string',
        )
      : [];
    const withName =
      typeof e.payload['with'] === 'string'
        ? nameOf(String(e.payload['with']))
        : '';
    const circleNames = [
      ...new Set(
        [...participantIds.map(nameOf), withName].filter(Boolean),
      ),
    ];
    if (e.payload['degraded'] === true) {
      const who = circleNames[0] || nameOf(String(e.agentId ?? ''));
      const to = circleNames.filter((n) => n !== who).join(sep);
      const skipped = e.payload['skipped'] === true;
      const skipReason = skipped
        ? String(e.payload['skipReason'] ?? 'error')
        : undefined;
      const retryQueued = e.payload['retryQueued'] === true;
      return [
        {
          id: `${e.id}:0`,
          eventId: e.id,
          turnIndex: 0,
          simTime: e.simTime,
          kind: e.kind,
          who,
          to: to || undefined,
          text: skipReason
            ? opts.skipText(skipReason, retryQueued)
            : opts.nodText,
          degraded: true,
          ...talkMetaFromEvent(e),
          ...talkStampOf(e),
          ...(skipReason ? { skipReason, retryQueued } : {}),
        },
      ];
    }
    if (Array.isArray(turns) && turns.length) {
      const lines: TalkLine[] = [];
      turns.forEach((row, i) => {
        if (!row || typeof row !== 'object') return;
        const rec = row as { text?: unknown; speakerName?: unknown };
        const text = typeof rec.text === 'string' ? rec.text.trim() : '';
        if (!text) return;
        const who =
          typeof rec.speakerName === 'string' && rec.speakerName.trim()
            ? rec.speakerName
            : nameOf(String(e.agentId ?? ''));
        const to =
          circleNames.filter((n) => n !== who).join(sep) ||
          (withName && withName !== who ? withName : '');
        lines.push({
          id: `${e.id}:${i}`,
          eventId: e.id,
          turnIndex: i,
          simTime: e.simTime,
          kind: e.kind,
          who,
          to: to || undefined,
          text: text.slice(0, 140),
          ...talkMetaFromEvent(e),
          ...talkStampOf(e),
        });
      });
      if (lines.length) {
        const spoken = [...new Set(lines.map((l) => l.who))];
        if (spoken.length >= 2) {
          for (const line of lines) {
            if (!line.to) {
              line.to = spoken.filter((n) => n !== line.who).join(sep);
            }
          }
        }
        return lines;
      }
    }
  }
  const one = talkLineFromEvent(e, nameOf, opts);
  return one ? [one] : [];
}

export function mergeTalkLog(prev: TalkLine[], extra: TalkLine[]): TalkLine[] {
  const byId = new Map<string, TalkLine>();
  for (const line of prev) byId.set(line.id, line);
  for (const line of extra) byId.set(line.id, line);
  const all = [...byId.values()].sort(compareTalkLines);
  // Author lines must survive the live dialogue flood. A watched town now
  // speaks often enough to push a whisper out of a 40-line window in seconds.
  const said = all.filter((line) => line.kind === 'intervene').slice(-8);
  const saidIds = new Set(said.map((line) => line.id));
  const rest = all.filter((line) => !saidIds.has(line.id));
  return [...rest.slice(-(40 - said.length)), ...said].sort(compareTalkLines);
}
