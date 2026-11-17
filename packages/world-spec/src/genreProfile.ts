/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Genre packs for the living-society compiler. Missing profile = society.town.
 */

import { z } from 'zod';

/** Region ids belonging to the Stanford-town scaffold — synthesizer must not reuse them. */
export const SCAFFOLD_TOWN_REGION_IDS = [
  'town_square',
  'market_row',
  'school_yard',
  'home_row',
  'inn_lane',
  'forest',
] as const;

export type ScaffoldTownRegionId = (typeof SCAFFOLD_TOWN_REGION_IDS)[number];

export const GenreClockSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('diurnal'),
    hoursPerDay: z.number().int().positive().default(24),
  }),
  z.object({
    kind: z.literal('watch'),
    shifts: z.number().int().positive().default(3),
  }),
  z.object({ kind: z.literal('event') }),
]);

export const GenreProfileSchema = z.object({
  id: z
    .enum(['society.town', 'society.crew', 'society.cloister'])
    .default('society.town'),
  clock: GenreClockSchema.default({ kind: 'diurnal', hoursPerDay: 24 }),
  viewer: z.enum(['observer']).default('observer'),
  population: z
    .object({
      min: z.number().int().nonnegative().default(18),
      max: z.number().int().positive().default(25),
    })
    .default({ min: 18, max: 25 }),
  topology: z
    .object({
      minRegions: z.number().int().positive().default(3),
      maxRegions: z.number().int().positive().default(8),
    })
    .default({ minRegions: 3, maxRegions: 8 }),
  verbs: z
    .array(z.enum(['whisper', 'set_object', 'host_gathering']))
    .default(['whisper', 'set_object', 'host_gathering']),
  hubKind: z.enum(['plaza', 'mess', 'bridge', 'none']).default('plaza'),
  /** Information-spread gate. Town is the Stanford 70%/24h bar; crew is looser. */
  emergence: z
    .object({
      minSpread: z.number().min(0).max(1).default(0.7),
      windowHours: z.number().positive().default(24),
    })
    .default({ minSpread: 0.7, windowHours: 24 }),
});

export type GenreProfile = z.infer<typeof GenreProfileSchema>;
export type GenreClock = z.infer<typeof GenreClockSchema>;

export const TOWN_GENRE_PROFILE: GenreProfile = GenreProfileSchema.parse({
  id: 'society.town',
  clock: { kind: 'diurnal', hoursPerDay: 24 },
  viewer: 'observer',
  population: { min: 18, max: 25 },
  topology: { minRegions: 3, maxRegions: 8 },
  verbs: ['whisper', 'set_object', 'host_gathering'],
  hubKind: 'plaza',
  emergence: { minSpread: 0.7, windowHours: 24 },
});

export const CREW_GENRE_PROFILE: GenreProfile = GenreProfileSchema.parse({
  id: 'society.crew',
  clock: { kind: 'watch', shifts: 3 },
  viewer: 'observer',
  population: { min: 6, max: 14 },
  topology: { minRegions: 2, maxRegions: 4 },
  verbs: ['whisper', 'set_object'],
  hubKind: 'bridge',
  emergence: { minSpread: 0.5, windowHours: 12 },
});

export const CLOISTER_GENRE_PROFILE: GenreProfile = GenreProfileSchema.parse({
  id: 'society.cloister',
  clock: { kind: 'diurnal', hoursPerDay: 24 },
  viewer: 'observer',
  population: { min: 8, max: 18 },
  topology: { minRegions: 3, maxRegions: 6 },
  verbs: ['whisper', 'set_object', 'host_gathering'],
  hubKind: 'mess',
  emergence: { minSpread: 0.6, windowHours: 18 },
});

export function genreProfileById(id: string | undefined): GenreProfile {
  if (id === 'society.crew') return CREW_GENRE_PROFILE;
  if (id === 'society.cloister') return CLOISTER_GENRE_PROFILE;
  return TOWN_GENRE_PROFILE;
}

const MIN_NAMED_RESIDENTS = 2;
const DEFAULT_MAX_NAMED_RESIDENTS = 80;
/** Hard ceiling so a bad env value cannot ask for tens of thousands of named agents. */
const ABSOLUTE_MAX_NAMED_RESIDENTS = 500;

/** Default 80. Raise with OPENGAME_MAX_NAMED_RESIDENTS (worker / planner). */
export function maxNamedResidents(): number {
  const raw =
    typeof process !== 'undefined'
      ? Number(process.env?.['OPENGAME_MAX_NAMED_RESIDENTS'])
      : Number.NaN;
  if (Number.isFinite(raw) && raw >= MIN_NAMED_RESIDENTS) {
    return Math.min(ABSOLUTE_MAX_NAMED_RESIDENTS, Math.floor(raw));
  }
  return DEFAULT_MAX_NAMED_RESIDENTS;
}

/** Named-resident target from the create-world scale picker. */
export function clampNamedResidentCount(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const n = Math.round(value);
  if (n < MIN_NAMED_RESIDENTS || n > maxNamedResidents()) return undefined;
  return n;
}

/**
 * Pin pack min/max to an explicit headcount so compact (10) is not expanded
 * to society.town's default 18–25, and crowded (36) is not clamped to 25.
 */
export function genreProfileWithPopulation(
  profile: GenreProfile,
  headcount: number,
): GenreProfile {
  const n = clampNamedResidentCount(headcount);
  if (n == null) return profile;
  return {
    ...profile,
    population: { min: n, max: n },
  };
}

export function resolveGenreProfile(world: {
  readonly presentation?: { readonly genreProfile?: unknown };
}): GenreProfile {
  const raw = world.presentation?.genreProfile;
  if (!raw) return TOWN_GENRE_PROFILE;
  const id =
    typeof raw === 'object' && raw && 'id' in raw && typeof raw.id === 'string'
      ? raw.id
      : undefined;
  const base = genreProfileById(id);
  const parsed = GenreProfileSchema.safeParse({ ...base, ...raw });
  return parsed.success ? parsed.data : base;
}

export function isScaffoldTownRegionId(id: string): boolean {
  return (SCAFFOLD_TOWN_REGION_IDS as readonly string[]).includes(id);
}

/** Observatory clock label. Watch clocks count shifts, not 凌晨. */
export function formatWorldClock(
  t: number,
  clock?: GenreClock | GenreProfile['clock'] | { kind?: string; shifts?: number },
  options?: { readonly ascii?: boolean },
): string {
  const ascii = options?.ascii === true;
  const kind = clock?.kind ?? 'diurnal';
  if (kind === 'watch') {
    const shifts = clock && 'shifts' in clock ? clock.shifts : 3;
    const n = Math.max(1, Number(shifts) || 3);
    const shiftLen = 24 / n;
    const elapsed = Math.max(0, t);
    const shiftIndex = Math.floor((elapsed % 24) / shiftLen);
    const watch = Math.floor(elapsed / 24) + 1;
    return ascii
      ? `Watch ${watch} · shift ${shiftIndex + 1}`
      : `第${watch}轮 第${shiftIndex + 1}班`;
  }
  if (kind === 'event') {
    const beat = Math.floor(Math.max(0, t));
    return ascii ? `Beat ${beat}` : `时点 ${beat}`;
  }
  const day = Math.floor(Math.max(0, t) / 24) + 1;
  const hour = Math.floor(((t % 24) + 24) % 24);
  if (ascii) {
    const slot =
      hour < 5
        ? 'dawn'
        : hour < 11
          ? 'morning'
          : hour < 13
            ? 'noon'
            : hour < 18
              ? 'afternoon'
              : 'evening';
    return `Day ${day} ${slot} ${hour}:00`;
  }
  const slot =
    hour < 5
      ? '凌晨'
      : hour < 11
        ? '上午'
        : hour < 13
          ? '中午'
          : hour < 18
            ? '下午'
            : '晚上';
  return `第${day}天 ${slot}${hour}点`;
}

export type WorldBriefLike = {
  readonly packId?: string;
  readonly useCase?: string;
  readonly venues?: readonly string[];
  readonly scale?: string;
  readonly livedIn?: string;
  readonly note?: string;
};

/** Minimal world shape for hub / gathering copy (Spec or Spec-like). */
export interface WorldLike {
  readonly space?: {
    readonly startRegionId?: string;
    readonly regions?: ReadonlyArray<{
      readonly id: string;
      readonly name?: string;
      readonly kind?: string;
    }>;
    readonly areas?: ReadonlyArray<{
      readonly name?: string;
      readonly objects?: ReadonlyArray<{
        readonly name?: string;
        readonly state?: string;
      }>;
    }>;
  };
  readonly presentation?: {
    readonly genreProfile?: unknown;
    readonly worldBrief?: WorldBriefLike;
    readonly openingRumor?: string;
    readonly narrativeSeed?: string;
  };
  readonly entities?: ReadonlyArray<{
    readonly kind?: string;
    readonly name?: string;
    readonly identity?: { readonly secret?: string };
  }>;
}

export function worldBriefOf(world?: WorldLike): WorldBriefLike | undefined {
  const brief = world?.presentation?.worldBrief;
  if (!brief || typeof brief !== 'object') return undefined;
  const venues = (brief.venues ?? [])
    .map((v) => String(v).trim())
    .filter((v) => v.length >= 2);
  if (
    !brief.packId &&
    !brief.useCase &&
    !venues.length &&
    !brief.scale &&
    !brief.livedIn &&
    !brief.note
  ) {
    return undefined;
  }
  return {
    ...(brief.packId ? { packId: String(brief.packId) } : {}),
    ...(brief.useCase ? { useCase: String(brief.useCase) } : {}),
    ...(venues.length ? { venues } : {}),
    ...(brief.scale ? { scale: String(brief.scale) } : {}),
    ...(brief.livedIn ? { livedIn: String(brief.livedIn) } : {}),
    ...(brief.note ? { note: String(brief.note).trim().slice(0, 200) } : {}),
  };
}

function hubFallbackName(profile: GenreProfile, ascii: boolean): string {
  if (profile.id === 'society.cloister') return ascii ? 'chapel' : '礼拜堂';
  if (profile.id === 'society.crew') {
    if (profile.hubKind === 'mess') return ascii ? 'mess' : '公共舱';
    return ascii ? 'bridge' : '舰桥';
  }
  return ascii ? 'gathering' : '集会处';
}

export function worldCopyAscii(world?: WorldLike): boolean {
  const letters = (world?.space?.regions ?? [])
    .map((r) => r.name ?? '')
    .join('')
    .replace(/\s/g, '');
  if (!letters.length) return false;
  return !/[^\x00-\x7F]/.test(letters);
}

/** Fallback speaker when a gathering has no named lead. */
export function anonymousLeadName(world?: WorldLike): string {
  return worldCopyAscii(world) ? 'Someone' : '有人';
}

function coversVenue(name: string, venue: string): boolean {
  const a = name.trim().toLowerCase();
  const b = venue.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** Start-region name, else a pack-aware hub label — never a hardcoded 广场. */
export function hubPlaceName(world?: WorldLike): string {
  const regions = world?.space?.regions ?? [];
  for (const venue of worldBriefOf(world)?.venues ?? []) {
    const hit = regions.find(
      (r) =>
        coversVenue(r.name ?? '', venue) ||
        coversVenue(r.id.replace(/_/g, ' '), venue),
    );
    if (hit?.name?.trim()) return hit.name.trim();
  }
  const firstVenue = worldBriefOf(world)?.venues?.[0]?.trim();
  if (firstVenue) return firstVenue;
  const startId = world?.space?.startRegionId;
  const start = startId
    ? regions.find((r) => r.id === startId)
    : undefined;
  if (start?.name?.trim()) return start.name.trim();
  const profile = resolveGenreProfile(world ?? {});
  const ascii = worldCopyAscii(world);
  const social = regions.find(
    (r) =>
      r.kind === 'town' ||
      (profile.hubKind === 'bridge' && /bridge|舰桥/i.test(`${r.id} ${r.name ?? ''}`)) ||
      (profile.hubKind === 'mess' && /mess|chapel|礼拜/i.test(`${r.id} ${r.name ?? ''}`)),
  );
  if (social?.name?.trim()) return social.name.trim();
  if (regions[0]?.name?.trim()) return regions[0].name.trim();
  return hubFallbackName(profile, ascii);
}

function briefUseCaseVerb(useCase: string | undefined, ascii: boolean): string | undefined {
  switch (useCase) {
    case 'xiangyi':
      return ascii ? "spreading tonight's rumor" : '散开今晚的巷议';
    case 'showcase':
      return ascii ? 'hosting a town showcase' : '招待开镇展示';
    case 'campus':
      return ascii ? 'calling a between-class gathering' : '张罗课间集合';
    case 'workplace':
      return ascii ? 'handing off the shift' : '组织交班';
    case 'scenic':
      return ascii ? 'walking guests through the grounds' : '带着人走一圈';
    case 'courtyard':
      return ascii ? 'pouring tea in the courtyard' : '在院里倒茶';
    default:
      return undefined;
  }
}

function briefInvitation(useCase: string | undefined, ascii: boolean): string | undefined {
  switch (useCase) {
    case 'xiangyi':
      return ascii ? 'town rumor' : '巷议';
    case 'showcase':
      return ascii ? 'showcase' : '开镇展示';
    case 'campus':
      return ascii ? 'class gathering' : '课间集合';
    case 'workplace':
      return ascii ? 'shift handoff' : '交班';
    case 'scenic':
      return ascii ? 'grounds walk' : '导览';
    case 'courtyard':
      return ascii ? 'courtyard tea' : '院里倒茶';
    default:
      return undefined;
  }
}

function gatheringVerb(profile: GenreProfile, ascii: boolean): string {
  if (!profile.verbs.includes('host_gathering')) {
    if (profile.id === 'society.crew') {
      return ascii ? 'organizing a watch handoff' : '组织交班';
    }
    return ascii ? 'passing the word' : '把话传开';
  }
  if (profile.id === 'society.cloister') {
    return ascii ? 'calling vespers' : '召集晚课';
  }
  return ascii ? 'hosting a gathering' : '组织一场聚会';
}

export function gatheringInvitationText(world?: WorldLike): string {
  const ascii = worldCopyAscii(world);
  const fromBrief = briefInvitation(worldBriefOf(world)?.useCase, ascii);
  if (fromBrief) return fromBrief;
  const profile = resolveGenreProfile(world ?? {});
  if (!profile.verbs.includes('host_gathering')) {
    if (profile.id === 'society.crew') return ascii ? 'handoff' : '交班';
    return ascii ? 'word of mouth' : '把话传开';
  }
  if (profile.id === 'society.cloister') return ascii ? 'vespers' : '晚课';
  return ascii ? 'gathering' : '聚会';
}

export function gatheringSeedText(leadName: string, world?: WorldLike): string {
  const hub = hubPlaceName(world);
  const profile = resolveGenreProfile(world ?? {});
  const ascii = worldCopyAscii(world);
  const verb =
    briefUseCaseVerb(worldBriefOf(world)?.useCase, ascii) ??
    gatheringVerb(profile, ascii);
  return ascii
    ? `${leadName} is ${verb} at ${hub}`
    : `${leadName} 正在${hub}${verb}`;
}

const EMPTY_OBJECT_STATE =
  /^(idle|闲着|刚有人来过|someone just passed through|someone was just talking|有人刚议论过|blankets folded|叠好了被子)$/i;

const GENERIC_GATHERING_LINE =
  /正在.{0,16}(组织一场聚会|组织交班|召集晚课|把话传开)|is (hosting a gathering|organizing a watch handoff|calling vespers|passing the word)( at\b)?/i;

/** Object / rumor text that can actually be spoken — not idle / 闲着. */
export function isConcreteWorldCue(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  return !EMPTY_OBJECT_STATE.test(t);
}

/** "{lead} is hosting a gathering" — the line that made every town recite filler. */
export function isGenericGatheringLine(text: string): boolean {
  return GENERIC_GATHERING_LINE.test(text.trim());
}

/**
 * Opening beat for society seed. Prefer a written fact (notice board, brief,
 * secret) over "{lead} is hosting a gathering" — that activity line is what
 * made every generated town recite the same empty gossip.
 */
export function openingRumorFromSpec(
  leadName: string,
  world?: WorldLike,
): string {
  const authored = [
    world?.presentation?.openingRumor,
    world?.presentation?.narrativeSeed,
    worldBriefOf(world)?.note,
  ]
    .map((s) => s?.trim() ?? '')
    .find(
      (s) =>
        s.length >= 6 &&
        !/^Padded/i.test(s) &&
        !/^[a-z][a-z0-9_-]{3,40}$/i.test(s) &&
        !isGenericGatheringLine(s),
    );
  if (authored) return authored.slice(0, 80);

  const objects = (world?.space?.areas ?? []).flatMap((a) => a.objects ?? []);
  const notice = objects.find(
    (o) =>
      isConcreteWorldCue(o.state ?? '') &&
      /布告|告示|notice|board|黑板|黑板/i.test(o.name ?? ''),
  );
  if (notice?.state) return notice.state.trim().slice(0, 80);
  const fact = objects.find((o) => isConcreteWorldCue(o.state ?? ''));
  if (fact?.state) return fact.state.trim().slice(0, 80);

  const secret = (world?.entities ?? [])
    .filter((e) => e.kind === 'npc')
    .map((e) => e.identity?.secret?.trim() ?? '')
    .find((s) => s.length >= 6);
  if (secret) {
    const ascii = worldCopyAscii(world);
    return ascii ? `Word is out: ${secret}` : `镇上在传：${secret}`;
  }
  return gatheringSeedText(leadName, world);
}

export function gatheringPromiseLine(
  fromName: string,
  toName: string,
  world?: WorldLike,
): string {
  const hub = hubPlaceName(world);
  const invite = gatheringInvitationText(world);
  const ascii = worldCopyAscii(world);
  return ascii
    ? `${fromName} asked ${toName} to meet at ${hub} for ${invite}`
    : `${fromName} 约了 ${toName} 今晚在${hub}${invite}`;
}

export function evaluateEmergenceGate(
  hours: number,
  rate: number,
  profile?: GenreProfile,
): {
  readonly spreadOk: boolean;
  readonly windowReached: boolean;
  readonly gateFailed: boolean;
  readonly minSpread: number;
  readonly windowHours: number;
} {
  const emergence = profile?.emergence ?? TOWN_GENRE_PROFILE.emergence;
  const spreadOk = rate >= emergence.minSpread;
  const windowReached = hours >= emergence.windowHours;
  return {
    spreadOk,
    windowReached,
    gateFailed: windowReached && !spreadOk,
    minSpread: emergence.minSpread,
    windowHours: emergence.windowHours,
  };
}

/**
 * Soft-pass for the generate-time seed contract. Matches game
 * `WORLD_QUALITY_GATE` — authors can ship a yellow town in CI, not a fake green.
 */
export function societySeedSoftEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const seed = env['PLATFORM_SOCIETY_SEED_SOFT'];
  if (seed === '1' || seed === 'true') return true;
  return env['PLATFORM_SOCIETY_SPREAD_SOFT'] === 'true';
}

/**
 * Yellow "seed used fallback" is for a seed with no MiniMax lines.
 * One overflow template / skip marker must not paint a passing seed as broken.
 */
export function societySeedUsedFallback(seed?: {
  readonly dialogues?: number;
  readonly degraded?: boolean;
  readonly reason?: string;
} | null): boolean {
  if (!seed) return false;
  if ((seed.dialogues ?? 0) > 0) return false;
  return (
    Boolean(seed.degraded) ||
    seed.reason === 'keys' ||
    seed.reason === 'dialogue'
  );
}

/**
 * Generate-time seed contract: a town with no real dialogue, or that never
 * spread the seed rumor, must not ship as a green success.
 * Soft pass is an env decision at the caller (`PLATFORM_SOCIETY_SEED_SOFT`).
 */
export function evaluateSocietySeedGate(input: {
  readonly hours: number;
  readonly spreadRate: number;
  readonly dialogues: number;
  readonly profile?: GenreProfile;
  /** Judge citesMemory (0–1). Recitation-only towns fail. */
  readonly citesMemory?: number;
  /** Judge followsLast (0–1). A chorus of identical lines fails. */
  readonly followsLast?: number;
}): {
  readonly spreadOk: boolean;
  readonly dialoguesOk: boolean;
  readonly judgeOk: boolean;
  readonly gateFailed: boolean;
  readonly reason: 'ok' | 'dialogue' | 'spread' | 'judge';
  readonly minSpread: number;
  readonly hours: number;
} {
  const emergence = evaluateEmergenceGate(
    input.hours,
    input.spreadRate,
    input.profile,
  );
  const dialoguesOk = input.dialogues > 0;
  const judgeOk =
    input.dialogues === 0 ||
    input.citesMemory == null ||
    input.followsLast == null ||
    input.citesMemory >= 0.02 ||
    input.followsLast >= 0.3;
  const reason: 'ok' | 'dialogue' | 'spread' | 'judge' = !dialoguesOk
    ? 'dialogue'
    : !emergence.spreadOk
      ? 'spread'
      : !judgeOk
        ? 'judge'
        : 'ok';
  return {
    spreadOk: emergence.spreadOk,
    dialoguesOk,
    judgeOk,
    gateFailed: reason !== 'ok',
    reason,
    minSpread: emergence.minSpread,
    hours: input.hours,
  };
}
