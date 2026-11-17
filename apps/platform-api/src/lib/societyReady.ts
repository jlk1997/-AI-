/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Author-facing seed / roster snapshot for GET /world and the generate strip.
 * Lives next to the live tick so generate and observatory read one contract.
 */

export type SocietySeedSnapshot = {
  readonly hours?: number;
  readonly dialogues: number;
  readonly spread: number;
  readonly degraded: boolean;
  readonly gateFailed: boolean;
  readonly retrievalDegraded: boolean;
  readonly spreadOk?: boolean;
};

export type WorldRosterSnapshot = {
  readonly authoredNpcs: number;
  readonly paddedNpcs: number;
  readonly authoredNames: string[];
  readonly paddedNames: string[];
};

export type WorldBriefSnapshot = {
  readonly packId?: string;
  readonly useCase?: string;
  readonly venues: string[];
  readonly scale?: string;
  readonly livedIn?: string;
  readonly note?: string;
};

export function worldBriefFromSpec(spec: {
  readonly presentation?: {
    readonly worldBrief?: {
      readonly packId?: string;
      readonly useCase?: string;
      readonly venues?: readonly string[];
      readonly scale?: string;
      readonly livedIn?: string;
      readonly note?: string;
    };
  };
}): WorldBriefSnapshot | null {
  const brief = spec.presentation?.worldBrief;
  if (!brief) return null;
  const venues = (brief.venues ?? [])
    .map((v) => String(v).trim())
    .filter((v) => v.length >= 2);
  const note = brief.note?.trim().slice(0, 200);
  if (
    !brief.packId &&
    !brief.useCase &&
    !venues.length &&
    !brief.scale &&
    !brief.livedIn &&
    !note
  ) {
    return null;
  }
  return {
    ...(brief.packId ? { packId: String(brief.packId) } : {}),
    ...(brief.useCase ? { useCase: String(brief.useCase) } : {}),
    venues,
    ...(brief.scale ? { scale: String(brief.scale) } : {}),
    ...(brief.livedIn ? { livedIn: String(brief.livedIn) } : {}),
    ...(note ? { note } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function societySeedFromJobResult(
  result: unknown,
): Partial<SocietySeedSnapshot> | null {
  const row = asRecord(result);
  const raw = asRecord(row?.['societySeed']) ?? asRecord(asRecord(row?.['details'])?.['societySeed']);
  if (!raw) return null;
  return {
    hours: asFiniteNumber(raw['hours']),
    dialogues: asFiniteNumber(raw['dialogues']),
    spread: asFiniteNumber(raw['spread']),
    degraded: asBoolean(raw['degraded']),
    gateFailed: asBoolean(raw['gateFailed']),
    retrievalDegraded: asBoolean(raw['retrievalDegraded']),
    spreadOk: asBoolean(raw['spreadOk']),
  };
}

export function societySeedSnapshot(
  report: Record<string, unknown> | null | undefined,
  jobSeed?: Partial<SocietySeedSnapshot> | null,
): SocietySeedSnapshot | null {
  const seed = asRecord(report?.['seed']) ?? {};
  const spreadRow = asRecord(report?.['informationSpread']);
  const hours = asFiniteNumber(seed['hours']) ?? jobSeed?.hours;
  const dialogues =
    asFiniteNumber(seed['dialogues']) ?? jobSeed?.dialogues ?? 0;
  const spread =
    asFiniteNumber(spreadRow?.['rate']) ?? jobSeed?.spread ?? 0;
  const degraded =
    asBoolean(seed['degraded']) ?? jobSeed?.degraded ?? false;
  const gateFailed =
    asBoolean(seed['gateFailed']) ?? jobSeed?.gateFailed ?? false;
  const retrievalDegraded =
    asBoolean(seed['retrievalDegraded']) ??
    jobSeed?.retrievalDegraded ??
    false;
  const spreadOk = asBoolean(seed['spreadOk']) ?? jobSeed?.spreadOk;
  const hasContract =
    hours != null ||
    seed['dialogues'] != null ||
    jobSeed?.dialogues != null ||
    spreadRow?.['rate'] != null ||
    jobSeed?.spread != null ||
    seed['gateFailed'] != null ||
    jobSeed?.gateFailed != null;
  if (!hasContract) return null;
  return {
    ...(hours != null ? { hours } : {}),
    dialogues,
    spread,
    degraded,
    gateFailed,
    retrievalDegraded,
    ...(spreadOk != null ? { spreadOk } : {}),
  };
}

export function worldRosterFromSpec(spec: {
  readonly entities?: ReadonlyArray<{
    readonly kind?: string;
    readonly name?: string;
    readonly tags?: readonly string[];
  }>;
}): WorldRosterSnapshot {
  const npcs = (spec.entities ?? []).filter((e) => e.kind === 'npc');
  const authored = npcs.filter((e) => !(e.tags ?? []).includes('padded'));
  const padded = npcs.filter((e) => (e.tags ?? []).includes('padded'));
  const names = (
    list: ReadonlyArray<{ readonly name?: string }>,
  ): string[] =>
    list
      .map((e) => e.name)
      .filter((n): n is string => Boolean(n && n.trim()));
  return {
    authoredNpcs: authored.length,
    paddedNpcs: padded.length,
    authoredNames: names(authored),
    paddedNames: names(padded),
  };
}

export function identityFromSpecEntity(entity: {
  readonly identity?: {
    readonly secret?: string;
    readonly stance?: string;
    readonly withholdFrom?: readonly string[];
    readonly occupation?: string;
    readonly backstory?: string;
  };
} | null | undefined): {
  secret?: string;
  stance?: string;
  withholdFrom?: string[];
  occupation?: string;
} {
  const ident = entity?.identity;
  if (!ident) return {};
  const withhold = Array.isArray(ident.withholdFrom)
    ? ident.withholdFrom.filter((id) => typeof id === 'string' && id.trim())
    : [];
  return {
    ...(ident.secret ? { secret: ident.secret } : {}),
    ...(ident.stance ? { stance: ident.stance } : {}),
    ...(withhold.length ? { withholdFrom: withhold } : {}),
    ...(ident.occupation ? { occupation: ident.occupation } : {}),
  };
}
