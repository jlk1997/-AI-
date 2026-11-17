/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compose a unique world-generate prompt from the author's standing brief.
 * Demo-town seed bags are inspiration only — they must not be the default
 * generate target.
 */

import { getLocale } from '../../services/i18n';
import type { WorldTemplateId } from './worldTemplates';
import {
  societySeedHoursOf,
  worldPopulationOf,
  type WorldCreatePrefs,
  type WorldLivedInId,
  type WorldPackId,
  type WorldScaleId,
  type WorldUseCaseId,
  type WorldVenueId,
} from './worldCreatePrefs';

export const WORLD_NOTE_MAX = 200;

export type WorldBriefPayload = {
  readonly packId: WorldPackId;
  readonly useCase: WorldUseCaseId;
  readonly venues: readonly WorldVenueId[];
  readonly scale: WorldScaleId;
  readonly livedIn: WorldLivedInId;
  readonly note?: string;
};

export function clipWorldNote(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, WORLD_NOTE_MAX);
}

export function clipCastName(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 32);
}

/** One sentence the planner can land: two people, then tonight's talk. */
export function composeCastNote(
  castA: string,
  castB: string,
  rumor: string,
  join = '和',
): string {
  const a = clipCastName(castA);
  const b = clipCastName(castB);
  const r = clipWorldNote(rumor);
  const people = [a, b].filter(Boolean).join(join);
  if (people && r) return clipWorldNote(`${people}：${r}`);
  return clipWorldNote(people || r);
}

export type TownCast = {
  readonly castA: string;
  readonly castB: string;
  readonly rumor: string;
};

export const WORLD_CAST_EXAMPLES: Record<
  WorldPackId,
  { readonly zh: TownCast; readonly en: TownCast }
> = {
  'society.town': {
    zh: {
      castA: '林嫂，夜市摊主',
      castB: '阿禾，补网人',
      rumor: '今晚要在茶馆对质收摊的事',
    },
    en: {
      castA: 'Lin, stallkeeper',
      castB: 'A-He, net mender',
      rumor: 'they will settle the early-close talk at the teahouse tonight',
    },
  },
  'society.crew': {
    zh: {
      castA: '维加，值班官',
      castB: '阿舱，园丁',
      rumor: '舰桥交班时温室舱的灯一直没灭',
    },
    en: {
      castA: 'Vega, watch officer',
      castB: 'A-Cang, gardener',
      rumor: 'the greenhouse lights never went out during the bridge handoff',
    },
  },
  'society.cloister': {
    zh: {
      castA: '沈班，抄经人',
      castB: '阿桂，园丁',
      rumor: '晚课前要把菜园的消息带回礼拜堂',
    },
    en: {
      castA: 'Shen, copyist',
      castB: 'A-Gui, gardener',
      rumor: 'garden news must reach the chapel before vespers',
    },
  },
};

export function splitCastPerson(raw: string): {
  readonly name: string;
  readonly job: string;
} {
  const text = clipCastName(raw);
  const parts = text.split(/[，,]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { name: parts[0]!, job: parts.slice(1).join('，') };
  }
  return { name: text, job: '' };
}

/**
 * How the two named people sit in the town: they are the parties to tonight's
 * talk; everyone else is a neighbor who has heard it or knows one of them.
 */
export function worldCastContract(
  prefs: WorldCreatePrefs,
  ascii = false,
): string {
  const people = [prefs.castA, prefs.castB]
    .map(splitCastPerson)
    .filter((p) => p.name);
  if (!people.length) return '';
  const extras = Math.max(0, worldPopulationOf(prefs) - people.length);
  if (ascii) {
    const named = people
      .map((p) => (p.job ? `${p.name} (${p.job})` : p.name))
      .join(', ');
    return [
      `Named residents (do not rename): ${named}.`,
      `These ${people.length} are the parties to tonight's talk.`,
      `The other ~${extras} are neighbors who know at least one of them or have heard the talk.`,
    ].join(' ');
  }
  const names = people.map((p) => p.name).join('、');
  const jobs = people
    .filter((p) => p.job)
    .map((p) => `${p.name}的职业是${p.job}`)
    .join('。');
  return [
    `点名：${names}。`,
    jobs ? `${jobs}。` : '',
    `这两人是今夜闲话的当事双方，不要改名。`,
    `其余约 ${extras} 人是同镇邻居，至少各认识其中一人或听过这则闲话。`,
  ]
    .filter(Boolean)
    .join('');
}

export function withTownCast(
  prefs: WorldCreatePrefs,
  cast: TownCast,
  join = '和',
): WorldCreatePrefs {
  const castA = clipCastName(cast.castA);
  const castB = clipCastName(cast.castB);
  const rumor = clipWorldNote(cast.rumor);
  return {
    ...prefs,
    castA,
    castB,
    rumor,
    note: composeCastNote(castA, castB, rumor, join),
  };
}

export function worldNotePreview(
  note: string,
  empty: string,
  max = 28,
): string {
  const clipped = clipWorldNote(note);
  if (!clipped) return empty;
  return clipped.length > max ? `${clipped.slice(0, max)}…` : clipped;
}

export const WORLD_PACK_IDS: readonly WorldPackId[] = [
  'society.town',
  'society.crew',
  'society.cloister',
];

export const WORLD_USE_CASE_IDS: readonly WorldUseCaseId[] = [
  'xiangyi',
  'showcase',
  'campus',
  'workplace',
  'scenic',
  'courtyard',
];

export type VenueDef = {
  readonly id: WorldVenueId;
  readonly zh: string;
  readonly en: string;
  readonly packs: readonly WorldPackId[];
};

export const WORLD_VENUES: readonly VenueDef[] = [
  { id: 'night_market', zh: '夜市', en: 'night market', packs: ['society.town'] },
  { id: 'wharf', zh: '码头', en: 'wharf', packs: ['society.town'] },
  { id: 'kiln', zh: '窑场', en: 'kiln', packs: ['society.town'] },
  { id: 'school', zh: '学堂', en: 'school', packs: ['society.town'] },
  { id: 'mine', zh: '矿坑', en: 'mine', packs: ['society.town'] },
  { id: 'workshop', zh: '作坊', en: 'workshop', packs: ['society.town'] },
  { id: 'inn', zh: '客栈', en: 'inn', packs: ['society.town'] },
  { id: 'teahouse', zh: '茶馆', en: 'teahouse', packs: ['society.town'] },
  { id: 'herb_hut', zh: '药庐', en: 'herb hut', packs: ['society.town'] },
  { id: 'hunting_ground', zh: '猎场', en: 'hunting ground', packs: ['society.town'] },
  { id: 'coop', zh: '鸡舍', en: 'coop', packs: ['society.town'] },
  { id: 'bridge', zh: '舰桥', en: 'bridge', packs: ['society.crew'] },
  { id: 'greenhouse', zh: '温室舱', en: 'greenhouse', packs: ['society.crew'] },
  { id: 'sleep_bay', zh: '休眠舱', en: 'sleep bay', packs: ['society.crew'] },
  { id: 'chapel', zh: '礼拜堂', en: 'chapel', packs: ['society.cloister'] },
  { id: 'scriptorium', zh: '抄经房', en: 'scriptorium', packs: ['society.cloister'] },
  { id: 'garden', zh: '菜园', en: 'garden', packs: ['society.cloister'] },
];

const USE_CASE_DEFAULTS: Record<
  WorldUseCaseId,
  Record<WorldPackId, readonly WorldVenueId[]>
> = {
  xiangyi: {
    'society.town': ['night_market', 'teahouse'],
    'society.crew': ['bridge', 'greenhouse'],
    'society.cloister': ['chapel', 'scriptorium'],
  },
  showcase: {
    'society.town': ['night_market', 'wharf'],
    'society.crew': ['bridge', 'greenhouse'],
    'society.cloister': ['chapel', 'garden'],
  },
  campus: {
    'society.town': ['school', 'teahouse'],
    'society.crew': ['greenhouse', 'sleep_bay'],
    'society.cloister': ['scriptorium', 'garden'],
  },
  workplace: {
    'society.town': ['workshop', 'inn'],
    'society.crew': ['bridge', 'sleep_bay'],
    'society.cloister': ['scriptorium', 'chapel'],
  },
  scenic: {
    'society.town': ['herb_hut', 'hunting_ground'],
    'society.crew': ['greenhouse', 'bridge'],
    'society.cloister': ['garden', 'chapel'],
  },
  courtyard: {
    'society.town': ['inn', 'teahouse'],
    'society.crew': ['sleep_bay', 'greenhouse'],
    'society.cloister': ['garden', 'scriptorium'],
  },
};

export function venuesForPack(packId: WorldPackId): readonly VenueDef[] {
  return WORLD_VENUES.filter((v) => v.packs.includes(packId));
}

export function venueDef(id: WorldVenueId): VenueDef | undefined {
  return WORLD_VENUES.find((v) => v.id === id);
}

export function defaultVenuesFor(
  packId: WorldPackId,
  useCase: WorldUseCaseId,
): WorldVenueId[] {
  return [...(USE_CASE_DEFAULTS[useCase][packId] ?? USE_CASE_DEFAULTS.xiangyi[packId])];
}

export function compatibleVenues(
  packId: WorldPackId,
  venues: readonly WorldVenueId[],
): WorldVenueId[] {
  const allowed = new Set(venuesForPack(packId).map((v) => v.id));
  return venues.filter((id) => allowed.has(id));
}

export function withPack(
  prefs: WorldCreatePrefs,
  packId: WorldPackId,
): WorldCreatePrefs {
  const kept = compatibleVenues(packId, prefs.venues);
  return {
    ...prefs,
    packId,
    venues: kept.length ? kept : defaultVenuesFor(packId, prefs.useCase),
  };
}

export function withUseCase(
  prefs: WorldCreatePrefs,
  useCase: WorldUseCaseId,
): WorldCreatePrefs {
  const defaults = defaultVenuesFor(prefs.packId, useCase);
  const current = compatibleVenues(prefs.packId, prefs.venues);
  const stillDefault =
    current.length === 0 ||
    current.every((id) =>
      defaultVenuesFor(prefs.packId, prefs.useCase).includes(id),
    );
  return {
    ...prefs,
    useCase,
    venues: stillDefault ? defaults : current,
  };
}

export function toggleVenue(
  prefs: WorldCreatePrefs,
  id: WorldVenueId,
): WorldCreatePrefs {
  const allowed = venuesForPack(prefs.packId).some((v) => v.id === id);
  if (!allowed) return prefs;
  const has = prefs.venues.includes(id);
  const next = has
    ? prefs.venues.filter((v) => v !== id)
    : [...prefs.venues, id];
  return {
    ...prefs,
    venues: next.length ? next : defaultVenuesFor(prefs.packId, prefs.useCase),
  };
}

export function worldBriefOf(prefs: WorldCreatePrefs): WorldBriefPayload {
  const note = clipWorldNote(prefs.note);
  return {
    packId: prefs.packId,
    useCase: prefs.useCase,
    venues: [...prefs.venues],
    scale: prefs.scale,
    livedIn: prefs.livedIn,
    ...(note ? { note } : {}),
  };
}

export function venueLabelsOf(
  prefs: WorldCreatePrefs,
  locale: string = getLocale(),
): string[] {
  const ascii = locale === 'en';
  const labels = prefs.venues
    .map((id) => venueDef(id))
    .filter((v): v is VenueDef => Boolean(v))
    .map((v) => (ascii ? v.en : v.zh));
  const unique = [...new Set(labels)];
  return unique.length
    ? unique
    : defaultVenuesFor(prefs.packId, prefs.useCase)
        .map((id) => venueDef(id))
        .filter((v): v is VenueDef => Boolean(v))
        .map((v) => (ascii ? v.en : v.zh));
}

const USE_CASE_LINE_ZH: Record<WorldUseCaseId, string> = {
  xiangyi: '应用场景是巷议运营：居民要传闲话、记得付费痕迹。',
  showcase: '应用场景是开镇展示：给访客看一座活着的镇子。',
  campus: '应用场景是校园观察：作息与课堂传闻要看得见。',
  workplace: '应用场景是职场园区：交班、工位和约定要成日子。',
  scenic: '应用场景是景区导览：场所与守夜要比无名广场更具体。',
  courtyard: '应用场景是院落邻里：茶馆客栈里的人要互相认识。',
};

const USE_CASE_LINE_EN: Record<WorldUseCaseId, string> = {
  xiangyi: 'Use case: living gossip — residents pass rumors and keep paid traces.',
  showcase: 'Use case: town showcase — a visitor should see a living town.',
  campus: 'Use case: campus watch — class hours and hallway talk must be visible.',
  workplace: 'Use case: workplace — handoffs, desks, and promises shape the day.',
  scenic: 'Use case: scenic walk — places must be more specific than a nameless plaza.',
  courtyard: 'Use case: courtyard neighbors — inn and teahouse people already know each other.',
};

/** Stable prompt from the brief. Same prefs ⇒ same text (no rotating demo bag). */
export function composeWorldGeneratePrompt(
  prefs: WorldCreatePrefs,
  extra?: string,
  locale: string = getLocale(),
): string {
  const ascii = locale === 'en';
  const population = worldPopulationOf(prefs);
  const hours = societySeedHoursOf(prefs);
  const places = venueLabelsOf(prefs, locale);
  const placeList = ascii ? places.join(', ') : places.join('、');
  const extraLine = [clipWorldNote(prefs.note), extra?.trim()]
    .filter(Boolean)
    .join(' ');
  const castLine = worldCastContract(prefs, ascii);
  if (ascii) {
    const lines = [
      `Compile an observable living society (${prefs.packId}).`,
      `At least ${population} named residents (about ${population} people).`,
      USE_CASE_LINE_EN[prefs.useCase],
      `Places must include ${placeList}.`,
      `The town has already lived ${hours} hours before the visitor arrives.`,
      'Do not collapse back to a nameless plaza template. Never emit town_square or home_row.',
      castLine,
      extraLine,
    ];
    return lines.filter(Boolean).join(' ');
  }
  const lines = [
    `生成一座可观察的社会世界（${prefs.packId}）。`,
    `至少 ${population} 名有名字的居民（约 ${population} 人）。`,
    USE_CASE_LINE_ZH[prefs.useCase],
    `场所必须包含${placeList}。`,
    `开场已过 ${hours} 小时。`,
    '不要塌回无名广场模板，不要用 town_square / home_row。',
    castLine,
    extraLine,
  ];
  return lines.filter(Boolean).join('');
}

const TEMPLATE_FILL: Partial<
  Record<
    WorldTemplateId,
    {
      packId: WorldPackId;
      useCase: WorldUseCaseId;
      venues: WorldVenueId[];
      noteZh: string;
      noteEn: string;
    }
  >
> = {
  demo_town: {
    packId: 'society.town',
    useCase: 'xiangyi',
    venues: ['night_market', 'wharf'],
    noteZh: '夜市摊主林嫂和补网人阿禾今晚要在码头对质那则收摊的巷议。',
    noteEn: 'Stallkeeper Lin and net-mender A-He will settle the early-close rumor at the wharf tonight.',
  },
  crew_watch: {
    packId: 'society.crew',
    useCase: 'workplace',
    venues: ['bridge', 'greenhouse'],
    noteZh: '值班官维加和园丁阿舱在舰桥交班，温室舱的灯一直没灭。',
    noteEn: 'Watch officer Vega and gardener A-Cang hand off on the bridge; the greenhouse lights never went out.',
  },
  cloister_hours: {
    packId: 'society.cloister',
    useCase: 'courtyard',
    venues: ['chapel', 'scriptorium'],
    noteZh: '抄经人沈班答应晚课前把菜园的消息带回礼拜堂。',
    noteEn: 'Copyist Shen promised to bring garden news back to the chapel before vespers.',
  },
  mystery_forest: {
    packId: 'society.town',
    useCase: 'scenic',
    venues: ['herb_hut', 'hunting_ground'],
    noteZh: '药庐的桂厨听说猎场今夜有人守着不回家。',
    noteEn: 'Gui at the herb hut heard someone is keeping watch at the hunting ground tonight.',
  },
  dungeon_raid: {
    packId: 'society.town',
    useCase: 'workplace',
    venues: ['workshop', 'inn'],
    noteZh: '作坊铁砧和客栈老板约好，门口那则矿脉消息不能传给外人。',
    noteEn: 'Anvil at the workshop and the innkeep agreed: the ore rumor at the gate stays inside.',
  },
  lingbot_cinematic: {
    packId: 'society.town',
    useCase: 'showcase',
    venues: ['night_market', 'teahouse'],
    noteZh: '茶馆里的人要把夜市灯会的巷议记得清楚，好给访客看这座镇怎么过日子。',
    noteEn: 'Teahouse regulars must keep the lantern-fair rumor clear so a visitor can see how the town lives.',
  },
};

export function applyWorldTemplateToPrefs(
  prefs: WorldCreatePrefs,
  id: WorldTemplateId,
  locale: string = getLocale(),
): WorldCreatePrefs {
  const fill = TEMPLATE_FILL[id];
  if (!fill) return prefs;
  return {
    ...prefs,
    packId: fill.packId,
    useCase: fill.useCase,
    venues: [...fill.venues],
    note: locale === 'en' ? fill.noteEn : fill.noteZh,
    castA: '',
    castB: '',
    rumor: locale === 'en' ? fill.noteEn : fill.noteZh,
  };
}

export function composeWorldTemplatePrompt(
  prefs: WorldCreatePrefs,
  id: WorldTemplateId,
  extra?: string,
  locale: string = getLocale(),
): string {
  const next = applyWorldTemplateToPrefs(prefs, id, locale);
  const cinematic =
    id === 'lingbot_cinematic'
      ? locale === 'en'
        ? 'Enable LingBot cinematic (spatialBackend=lingbot, cinematicEnabled=true, lingbotMode=real). Not a win/lose RPG.'
        : '启用 LingBot 档B（spatialBackend=lingbot、cinematicEnabled=true、lingbotMode=real）。玩法以社会观察为准，不是通关 RPG。'
      : '';
  return composeWorldGeneratePrompt(
    next,
    [cinematic, extra].filter(Boolean).join(' '),
    locale,
  );
}
