/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed ties (family / coworker / neighbor / rival / promise / conflict /
 * adopted / rumor), not just a scalar affinity. Summaries persist the kind
 * as a 【label】 prefix so Postgres does not need a new column.
 */

import { isAsciiCopy, MEETING_HINT_RE } from './copyLocale.js';

export const RELATION_KINDS = [
  'family',
  'coworker',
  'neighbor',
  'rival',
  'acquaintance',
  'promise',
  'conflict',
  'adopted',
  'rumor',
] as const;

export type RelationKind = (typeof RELATION_KINDS)[number];

export interface SocietyRelation {
  summary: string;
  affinity: number;
  kind: RelationKind;
}

const KIND_LABEL: Record<RelationKind, string> = {
  family: '家人',
  coworker: '同事',
  neighbor: '邻居',
  rival: '对头',
  acquaintance: '相识',
  promise: '有约定',
  conflict: '闹过别扭',
  adopted: '认养',
  rumor: '巷议',
};

const LABEL_KIND: Record<string, RelationKind> = Object.fromEntries(
  (Object.entries(KIND_LABEL) as Array<[RelationKind, string]>).map(
    ([k, v]) => [v, k],
  ),
) as Record<string, RelationKind>;

const PREFIX = /^【([^】]+)】\s*/u;

export function relationKindLabel(kind: RelationKind): string {
  return KIND_LABEL[kind];
}

export function specRelationKind(input: {
  readonly type?: string;
  readonly meta?: Record<string, unknown>;
  readonly sameRegion?: boolean;
  readonly sameOccupation?: boolean;
}): RelationKind {
  const kinship = String(input.meta?.['kinship'] ?? '');
  const label = String(input.meta?.['label'] ?? '');
  if (
    /parent|child|family|kin|母|父|子|女|兄|弟|姐|妹|夫妻/i.test(
      `${kinship} ${label}`,
    )
  ) {
    return 'family';
  }
  if (input.type === 'rivals') return 'rival';
  if (input.sameOccupation && input.type === 'allies') return 'coworker';
  if (input.type === 'allies' && input.sameRegion) return 'neighbor';
  if (input.sameRegion && input.type === 'knows') return 'neighbor';
  if (input.type === 'allies') return 'coworker';
  return 'acquaintance';
}

export function formatRelationSummary(
  kind: RelationKind,
  summary: string,
): string {
  const stripped = summary.replace(PREFIX, '').trim();
  return `【${KIND_LABEL[kind]}】${stripped}`;
}

export function parseRelation(
  summary: string,
  affinity: number,
  fallback: RelationKind = 'acquaintance',
): SocietyRelation {
  const m = PREFIX.exec(summary);
  const kind = (m && LABEL_KIND[m[1]!]) || fallback;
  return {
    kind,
    affinity,
    summary: formatRelationSummary(kind, summary),
  };
}

/**
 * Talking changes more than +0.05. Promises and fights stick; family stays family.
 */
/**
 * Inspector chips: promises and fights the observer can act on.
 * Chinese lines match the observatory copy ("欠她一句回话 / 约了今晚碰面").
 */
export function formatCommitmentLines(
  relations: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly kind?: string;
    readonly summary: string;
  }>,
  agentId: string,
  nameOf: (id: string) => string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of relations) {
    if (r.from !== agentId && r.to !== agentId) continue;
    const other = r.from === agentId ? r.to : r.from;
    const who = nameOf(other) || other.slice(0, 8);
    const body = r.summary.replace(PREFIX, '').trim();
    const kind = r.kind ?? '';
    const ascii = isAsciiCopy(`${who}${body}`);
    let line: string | undefined;
    if (kind === 'promise' || /有约定|promise/i.test(r.summary)) {
      if (MEETING_HINT_RE.test(body)) {
        line = ascii ? `meeting ${who} tonight` : `约了${who}今晚碰面`;
      } else if (/答应|回话|回你|reply|answer/i.test(body)) {
        line = ascii ? `owes ${who} a reply` : `欠${who}一句回话`;
      } else {
        line = ascii
          ? `promised ${who}${body ? `: ${body.slice(0, 18)}` : ''}`
          : `约了${who}${body ? `：${body.slice(0, 18)}` : ''}`;
      }
    } else if (kind === 'conflict' || /闹过别扭/.test(r.summary)) {
      line = ascii ? `still at odds with ${who}` : `和${who}还没和好`;
    } else if (kind === 'adopted' || /【认养】/.test(r.summary)) {
      line = ascii ? `adopted by ${who}` : `被${who}认养`;
    } else if (kind === 'rumor' || /【巷议】/.test(r.summary)) {
      line = ascii ? `town rumor reached ${who}` : `巷议到了${who}这儿`;
    }
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= 4) break;
  }
  return out;
}

export function evolveRelation(
  prev: SocietyRelation | undefined,
  input: { readonly summary: string; readonly spreadCount: number },
): SocietyRelation {
  const text = `${input.summary} ${prev?.summary ?? ''}`;
  let kind = prev?.kind ?? 'acquaintance';
  let affinity = prev?.affinity ?? 0;
  // Paid 认养 / 巷议 edges are explicit. Do not reclassify via 答应 / 吵架 regex.
  if (kind === 'adopted' || kind === 'rumor') {
    affinity += 0.03 + input.spreadCount * 0.01;
  } else if (kind !== 'family') {
    if (/【认养】/.test(input.summary)) {
      kind = 'adopted';
      affinity = Math.max(affinity, 0.55);
    } else if (/【巷议】/.test(input.summary)) {
      kind = 'rumor';
      affinity = Math.max(affinity, 0.35);
    } else if (/吵|骂|翻脸|对头|绝交|不高兴|生气|冲突|yell|angry|fight|feud/i.test(text)) {
      kind = 'conflict';
      affinity -= 0.08;
    } else if (/答应|约定|一起|合作|帮你|明天见|agreed|promise|meet|together|handoff/i.test(text)) {
      kind = 'promise';
      affinity += 0.08;
    } else {
      affinity += 0.05 + input.spreadCount * 0.02;
    }
  } else {
    affinity += 0.03 + input.spreadCount * 0.01;
  }
  const body = input.summary.replace(PREFIX, '').slice(0, 140);
  return {
    kind,
    affinity: Math.max(-1, Math.min(1, affinity)),
    summary: formatRelationSummary(kind, body || prev?.summary || '相识'),
  };
}
