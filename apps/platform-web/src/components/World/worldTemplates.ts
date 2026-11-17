/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One-click world demo prompts for first-time users.
 * Demo / forest / camp clicks rotate distinct observatory seeds so two
 * clicks never send the same prompt (and typology can tell the towns apart).
 */

import { getLocale } from '../../services/i18n';

export type WorldTemplateId =
  | 'demo_town'
  | 'crew_watch'
  | 'cloister_hours'
  | 'mystery_forest'
  | 'dungeon_raid'
  | 'lingbot_cinematic'
  | 'agentic_expand';

export interface WorldTemplate {
  readonly id: WorldTemplateId;
  /** i18n key for title */
  readonly titleKey: string;
  /** i18n key for short blurb */
  readonly descKey: string;
  readonly emoji: string;
  readonly mode: 'world' | 'world_edit';
  /** Static fallback — click handlers should call promptForWorldTemplate. */
  readonly prompt: string;
  /** Highlight as the recommended first click */
  readonly recommended?: boolean;
}

export type SocietyPromptSeed = {
  readonly id: string;
  readonly theme: string;
  readonly places: string;
  readonly occupations: string;
  readonly rumor: string;
  readonly regions: string;
};

type PromptSalt = {
  readonly who: string;
  readonly when: string;
  readonly thing: string;
};

const DEMO_TOWN_SEEDS: readonly SocietyPromptSeed[] = [
  {
    id: 'harbor',
    theme: '靠海渔村',
    places: '码头、船坞、晒网场',
    occupations: '渔民、船匠、补网人、鱼贩、灯塔看守、腌鱼师傅',
    rumor: '今晚船坞有人要公开一张旧海图，消息会从码头传到晒网场',
    regions: '码头、船坞、晒网场、渔市、灯塔坡',
  },
  {
    id: 'kiln',
    theme: '矿窑小镇',
    places: '矿窑、选矿棚、灯房',
    occupations: '窑工、选矿工、矿灯看守、运煤人、炉边厨娘、井口记账',
    rumor: '灯房的火灭了，有人约在选矿棚说明天怎么换班',
    regions: '矿窑、选矿棚、灯房、井口、窑工巷',
  },
  {
    id: 'night_market',
    theme: '夜市灯笼巷',
    places: '夜市、烤串棚、灯笼巷',
    occupations: '夜摊主、夜食师傅、灯笼匠、糖画人、更夫、巷口说书人',
    rumor: '灯笼巷传说今晚有免费烤串，摊主要在夜市当众兑承诺',
    regions: '夜市、烤串棚、灯笼巷、更棚、巷尾摊位',
  },
  {
    id: 'tea_lane',
    theme: '茶馆棋巷',
    places: '茶馆、棋桌',
    occupations: '茶博士、茶馆管事、棋友、说书人、点心师傅、账房',
    rumor: '茶馆里有人把一局未下完的棋当成今晚的聚会暗号',
    regions: '茶馆、棋桌、点心铺、账房、巷口',
  },
  {
    id: 'salt',
    theme: '盐田仓镇',
    places: '盐田、盐仓',
    occupations: '盐工、盐仓管事、晒盐人、运盐船工、仓门卫、卤水师傅',
    rumor: '盐仓少了一袋盐，管事约大家黄昏在田埂对账',
    regions: '盐田、盐仓、卤棚、仓门、田埂路',
  },
  {
    id: 'bamboo',
    theme: '竹棚篾坊',
    places: '竹棚、篾坊',
    occupations: '篾匠、竹器师傅、编筐人、砍竹人、坊口学徒、竹市摊主',
    rumor: '篾坊要当众交出一只答应过的摇篮，消息在竹棚传开',
    regions: '竹棚、篾坊、竹市、溪边、坊口',
  },
  {
    id: 'pasture',
    theme: '牧场马厩镇',
    places: '牧场、马厩',
    occupations: '牧人、马夫、挤奶人、兽医、草料看守、马市牙人',
    rumor: '马厩走失一匹马，牧人请大家黄昏在牧场对脚印',
    regions: '牧场、马厩、草料棚、马市、兽医棚',
  },
  {
    id: 'temple',
    theme: '香火庙镇',
    places: '庙宇、香案',
    occupations: '香火看守、司香、庙祝、香客向导、斋饭师傅、钟楼更夫',
    rumor: '香案上多了一封无名信，庙祝约居民今晚在庙门口念给大家听',
    regions: '庙宇、香案、钟楼、斋堂、庙门广场',
  },
  {
    id: 'ferry',
    theme: '渡口河埠',
    places: '渡口、河埠',
    occupations: '渡工、河埠搬运、缆绳工、摆渡账房、鱼贩、候船摊主',
    rumor: '渡口说今晚最后一班船要当众公布谁还欠摆渡钱',
    regions: '渡口、河埠、候船棚、缆桩、对岸候船',
  },
  {
    id: 'night_school',
    theme: '夜校粉笔巷',
    places: '夜校、粉笔房',
    occupations: '夜校先生、塾师、学童家长、抄写员、看门人、油灯看守',
    rumor: '粉笔房的灯灭了，先生改约大家到夜校院子把课上完',
    regions: '夜校、粉笔房、院子、油灯棚、家长长椅',
  },
];

const FOREST_SEEDS: readonly SocietyPromptSeed[] = [
  {
    id: 'herb_altar',
    theme: '迷雾林边聚落',
    places: '药庐、猎场、祭坛',
    occupations: '采药人、猎户、祭坛守望、守夜人、风干肉摊、林道向导',
    rumor: '夜间林中有狼嚎，祭坛守望约大家在药庐门口组织守夜',
    regions: '药庐、猎场、祭坛、林道、守夜棚',
  },
  {
    id: 'watch_grove',
    theme: '守夜林聚落',
    places: '猎场、祭坛、药庐',
    occupations: '猎户、祭坛守望、采药人、更夫、兽皮匠、守夜队长',
    rumor: '猎场丢了一串脚印图，队长请人黄昏在祭坛对过',
    regions: '猎场、祭坛、药庐、更棚、兽皮摊',
  },
  {
    id: 'mist_clinic',
    theme: '雾中药庐镇',
    places: '药庐、祭坛、猎场',
    occupations: '采药人、司香、猎户、煎药师傅、守夜人、草棚管事',
    rumor: '药庐的炉熄了，煎药师傅改去祭坛借火，消息沿着猎场传',
    regions: '药庐、祭坛、猎场、草棚、雾径',
  },
];

const CREW_SEEDS: readonly SocietyPromptSeed[] = [
  {
    id: 'station',
    theme: '空间站值班社会',
    places: '舰桥、温室、休眠舱',
    occupations: '值班官、舱务员、园丁、厨子、通讯员、轮机手',
    rumor: '第二班指示灯灭了，值班官约大家到舰桥对过交班清单',
    regions: '舰桥、温室、休眠舱、走廊',
  },
  {
    id: 'cargo',
    theme: '货船值班社会',
    places: '甲板、船舱、厨舱',
    occupations: '水手、水手长、厨子、舵手、舱务、机工',
    rumor: '厨舱少了一箱给养，水手长请人到甲板把班表对完',
    regions: '甲板、船舱、厨舱、货舱口',
  },
];

const CLOISTER_SEEDS: readonly SocietyPromptSeed[] = [
  {
    id: 'abbey',
    theme: '修道院日课社会',
    places: '礼拜堂、抄经房、菜园',
    occupations: '司仪、抄经人、园丁、膳堂、敲钟人、守门',
    rumor: '抄经房的灯油见底，司仪改约晚课到礼拜堂把日课念完',
    regions: '礼拜堂、抄经房、菜园、回廊',
  },
  {
    id: 'script',
    theme: '抄经院社会',
    places: '抄经房、礼拜堂、菜园',
    occupations: '抄经人、司仪、园丁、装订、司香、守钟',
    rumor: '菜园少了一畦药草，园丁请人黄昏在礼拜堂对过名单',
    regions: '抄经房、礼拜堂、菜园、膳堂',
  },
];

const DEMO_TOWN_SEEDS_EN: readonly SocietyPromptSeed[] = [
  {
    id: 'harbor',
    theme: 'seaside fishing town',
    places: 'dock, boat yard, net yard',
    occupations: 'fisher, boatwright, net mender, fishmonger, lighthouse keeper',
    rumor: 'someone will unfurl an old chart at the boat yard tonight',
    regions: 'dock, boat yard, net yard, fish market, lighthouse slope',
  },
  {
    id: 'kiln',
    theme: 'kiln and mine town',
    places: 'kiln, sorting shed, lamp house',
    occupations: 'kiln hand, sorter, lamp keeper, coal hauler, pit clerk',
    rumor: 'the lamp house fire went out; they will meet at the sorting shed about the next shift',
    regions: 'kiln, sorting shed, lamp house, pit mouth, kiln lane',
  },
  {
    id: 'night_market',
    theme: 'lantern night market',
    places: 'night market, skewer stall, lantern lane',
    occupations: 'stall keeper, night cook, lantern maker, watchman, storyteller',
    rumor: 'lantern lane says there is free grilled meat tonight, and the stall will make good on it in public',
    regions: 'night market, skewer stall, lantern lane, watch shed',
  },
];

const CREW_SEEDS_EN: readonly SocietyPromptSeed[] = [
  {
    id: 'station',
    theme: 'station watch society',
    places: 'bridge, greenhouse, sleep bay',
    occupations: 'watch officer, steward, gardener, cook, comms, plant tech',
    rumor: 'a telltale went dark on second watch; the officer wants the handoff list checked at the bridge',
    regions: 'bridge, greenhouse, sleep bay, corridor',
  },
  {
    id: 'cargo',
    theme: 'cargo-ship watch society',
    places: 'deck, cabin, galley',
    occupations: 'sailor, bosun, cook, helm, steward, mechanic',
    rumor: 'a crate of stores went missing from the galley; the bosun wants the roster checked on deck',
    regions: 'deck, cabin, galley, cargo hatch',
  },
];

const CLOISTER_SEEDS_EN: readonly SocietyPromptSeed[] = [
  {
    id: 'abbey',
    theme: 'cloister hours society',
    places: 'chapel, scriptorium, garden',
    occupations: 'precentor, copyist, gardener, refectory, bell ringer, porter',
    rumor: 'the scriptorium lamp oil ran out; vespers will finish the hours in the chapel',
    regions: 'chapel, scriptorium, garden, cloister walk',
  },
  {
    id: 'script',
    theme: 'copying-house society',
    places: 'scriptorium, chapel, garden',
    occupations: 'copyist, precentor, gardener, binder, incense keeper, bell ringer',
    rumor: 'a bed of herbs went missing from the garden; names will be checked at the chapel at dusk',
    regions: 'scriptorium, chapel, garden, refectory',
  },
];

const FOREST_SEEDS_EN: readonly SocietyPromptSeed[] = [
  {
    id: 'herb_altar',
    theme: 'mist-forest hamlet',
    places: 'herb hut, hunting ground, altar',
    occupations: 'herbalist, hunter, altar watch, night watch, guide',
    rumor: 'wolves called in the night; the altar watch wants a watch organized at the herb hut',
    regions: 'herb hut, hunting ground, altar, forest path',
  },
];

const CAMP_SEEDS_EN: readonly SocietyPromptSeed[] = [
  {
    id: 'supply_intel',
    theme: 'camp outside the dungeon',
    places: 'supply tent, intel shed, campfire',
    occupations: 'supplier, broker, fire keeper, map copyist, night sentry',
    rumor: 'someone in the intel shed claims an old key; they will compare notes at the fire at dusk',
    regions: 'supply tent, intel shed, campfire, sentry post',
  },
];

const PROMPT_SALTS_EN: readonly PromptSalt[] = [
  { who: 'Lin', when: 'after dusk', thing: 'a lamp that went out' },
  { who: 'Ama', when: 'at first light', thing: 'an unsent letter' },
  { who: 'Zhou', when: 'at twilight', thing: 'a bowl with a chipped rim' },
];

const CREW_SALTS_EN: readonly PromptSalt[] = [
  { who: 'Shen', when: 'on second watch', thing: 'a telltale that went dark' },
  { who: 'Ada', when: 'before handoff', thing: 'an unsigned roster' },
];

const CLOISTER_SALTS_EN: readonly PromptSalt[] = [
  { who: 'Qing', when: 'before vespers', thing: 'a lamp burned to the bottom' },
  { who: 'Hui', when: 'at morning hours', thing: 'an unfinished page' },
];

const CAMP_SEEDS: readonly SocietyPromptSeed[] = [
  {
    id: 'supply_intel',
    theme: '地牢门外营地小镇',
    places: '补给帐、情报棚、营火圈',
    occupations: '补给商、情报掮客、营火看守、地图抄写、伤员看护、守夜哨',
    rumor: '情报棚有人声称找到一把旧钥匙，约大家黄昏在营火圈对证',
    regions: '补给帐、情报棚、营火圈、伤员棚、哨岗',
  },
  {
    id: 'map_table',
    theme: '探路营地社会',
    places: '情报棚、补给帐、营火圈',
    occupations: '情报掮客、补给商、营火看守、绳索工、厨帐师傅、账房',
    rumor: '补给帐少了一卷绳，账房请人到情报棚把名单对完',
    regions: '情报棚、补给帐、营火圈、厨帐、绳索堆',
  },
  {
    id: 'fire_watch',
    theme: '营火守夜营地',
    places: '营火圈、补给帐、情报棚',
    occupations: '营火看守、守夜哨、补给商、情报掮客、伤药师、更鼓手',
    rumor: '营火圈的火灭过一次，看守约大家在补给帐说明夜班怎么换',
    regions: '营火圈、补给帐、情报棚、更鼓棚、伤药帐',
  },
];

const PROMPT_SALTS: readonly PromptSalt[] = [
  { who: '林嫂', when: '戌时', thing: '一盏熄了的灯' },
  { who: '阿麦', when: '卯时', thing: '一封没送出的信' },
  { who: '老周', when: '黄昏', thing: '一只缺了角的碗' },
  { who: '小荷', when: '午后', thing: '一块还热的面饼' },
  { who: '铁柱', when: '子夜', thing: '一把没上油的锁' },
  { who: '桂花', when: '清晨', thing: '一串湿脚印' },
  { who: '石头', when: '申时', thing: '一张画了圈的告示' },
  { who: '春妮', when: '晚饭后', thing: '一袋少了秤的米' },
  { who: '福伯', when: '天亮前', thing: '一声没人认的敲门' },
  { who: '二兰', when: '午时', thing: '一枚滚到桌下的扣子' },
  { who: '茂才', when: '掌灯时', thing: '半页撕开的账' },
  { who: '巧手', when: '歇工时', thing: '一根断了的线' },
];

const CREW_SALTS: readonly PromptSalt[] = [
  { who: '沈班', when: '第二班', thing: '一块灭了的指示灯' },
  { who: '阿舱', when: '交班前', thing: '一份没签字的班表' },
  { who: '桂厨', when: '第三班', thing: '一箱少了的给养' },
  { who: '通管', when: '第一班', thing: '一条没回的呼叫' },
];

const CLOISTER_SALTS: readonly PromptSalt[] = [
  { who: '清远', when: '晚课前', thing: '一盏见底的油灯' },
  { who: '慧心', when: '晨课', thing: '一页未抄完的经' },
  { who: '园叟', when: '黄昏', thing: '一畦少了的药草' },
  { who: '守钟', when: '日课末', thing: '一根松了的钟绳' },
];

const OBSERVATORY_TAIL =
  '不要以胜负/打怪/主线通关为目标——右侧应能观察居民走动、聊天与涌现，侧栏可快进与耳语干预。按提示承诺的场所合成区域与人口，不要塌回无名广场模板。';

const OBSERVATORY_TAIL_EN =
  'Do not aim at combat, bosses, or a main-quest clear — the right pane should show people walking, talking, and emerging; the side panel can fast-forward and whisper. Compile regions and population from the promised places; do not collapse back to a nameless plaza template.';

const TOWN_PACK_TAIL =
  '本模板使用 society.town pack：居民有住处和职场，约 18–25 人。';
const TOWN_PACK_TAIL_EN =
  'Use society.town pack: residents have homes and workplaces, about 18–25 people.';

const CREW_PACK_TAIL =
  '本模板使用 society.crew pack：值班钟、舰桥或甲板枢纽，约 8–12 人，观察交班与舱内日常，不要写成通关任务。';
const CREW_PACK_TAIL_EN =
  'Use society.crew pack: watch clock, bridge or deck hub, about 8–12 people. Watch handoffs and cabin life — not a quest to clear.';

const CLOISTER_PACK_TAIL =
  '本模板使用 society.cloister pack：日课钟、礼拜堂枢纽，约 10–14 人，观察抄经与晚课，不要写成通关任务。';
const CLOISTER_PACK_TAIL_EN =
  'Use society.cloister pack: hours clock, chapel hub, about 10–14 people. Watch copying and vespers — not a quest to clear.';

function rewritePackPeopleCount(text: string, n: number): string {
  return text
    .replace(/约\s*\d{1,3}(?:\s*[–—-]\s*\d{1,3})?\s*人/g, `约 ${n} 人`)
    .replace(
      /about \d{1,3}(?:\s*[–—-]\s*\d{1,3})? people/gi,
      `about ${n} people`,
    );
}

function packWithPeople(
  base: ObservatoryPack,
  minPeople?: number,
): ObservatoryPack {
  if (minPeople == null) return base;
  return {
    ...base,
    minPeople,
    tail: rewritePackPeopleCount(base.tail, minPeople),
    tailEn: rewritePackPeopleCount(base.tailEn, minPeople),
  };
}

type ObservatoryPack = {
  readonly id: 'society.town' | 'society.crew' | 'society.cloister';
  readonly minPeople: number;
  readonly tail: string;
  readonly tailEn: string;
};

const TOWN_OBSERVATORY_PACK: ObservatoryPack = {
  id: 'society.town',
  minPeople: 22,
  tail: TOWN_PACK_TAIL,
  tailEn: TOWN_PACK_TAIL_EN,
};

const CREW_OBSERVATORY_PACK: ObservatoryPack = {
  id: 'society.crew',
  minPeople: 8,
  tail: CREW_PACK_TAIL,
  tailEn: CREW_PACK_TAIL_EN,
};

const CLOISTER_OBSERVATORY_PACK: ObservatoryPack = {
  id: 'society.cloister',
  minPeople: 10,
  tail: CLOISTER_PACK_TAIL,
  tailEn: CLOISTER_PACK_TAIL_EN,
};

type ObservatoryLocale = 'en' | 'zh-CN';

function observatoryLocale(locale?: string): ObservatoryLocale {
  return (locale ?? getLocale()) === 'en' ? 'en' : 'zh-CN';
}

export function buildObservatoryPrompt(
  seed: SocietyPromptSeed,
  salt: PromptSalt,
  pack: ObservatoryPack = TOWN_OBSERVATORY_PACK,
  locale?: string,
): string {
  if (observatoryLocale(locale) === 'en') {
    return [
      `Compile an observable ${seed.theme} society (not a win/lose RPG).`,
      `The theme must be ${seed.theme}. Places must include ${seed.places}.`,
      `At least ${pack.minPeople} named residents with jobs (${seed.occupations}, and similar), daily routines, memories, and talk.`,
      `Seed rumor: "${seed.rumor}" — ${salt.who} brings it up ${salt.when}, and mentions ${salt.thing}.`,
      `Regions should read as ${seed.regions}.`,
      OBSERVATORY_TAIL_EN,
      pack.tailEn,
    ].join(' ');
  }
  return [
    `生成一座可观察的${seed.theme}社会（不是通关 RPG）。`,
    `主题必须是${seed.theme}，场所必须包含${seed.places}。`,
    `至少 ${pack.minPeople} 名有名字、有职业的居民（${seed.occupations} 等），日常作息、记忆与对话。`,
    `种子传闻是「${seed.rumor}」——由${salt.who}在${salt.when}说起，还提到${salt.thing}。`,
    `区域应能看出${seed.regions}。`,
    OBSERVATORY_TAIL,
    pack.tail,
  ].join('');
}

type BagState = {
  bag: string[];
  lastId: string;
  saltIndex: number;
};

const memoryBags = new Map<string, BagState>();

function shuffleIds(ids: readonly string[], rng: () => number): string[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function readBag(key: string): BagState {
  const mem = memoryBags.get(key);
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BagState>;
      if (Array.isArray(parsed.bag)) {
        return {
          bag: parsed.bag.filter((id): id is string => typeof id === 'string'),
          lastId: typeof parsed.lastId === 'string' ? parsed.lastId : '',
          saltIndex:
            typeof parsed.saltIndex === 'number' ? parsed.saltIndex : 0,
        };
      }
    }
  } catch {
    /* private mode / SSR */
  }
  return mem ?? { bag: [], lastId: '', saltIndex: 0 };
}

function writeBag(key: string, state: BagState): void {
  memoryBags.set(key, state);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(state));
    }
  } catch {
    /* ignore quota */
  }
}

export function pickSeededObservatoryPrompt(
  seeds: readonly SocietyPromptSeed[],
  storageKey: string,
  rng: () => number = Math.random,
  opts?: {
    readonly pack?: ObservatoryPack;
    readonly salts?: readonly PromptSalt[];
    readonly locale?: string;
    readonly minPeople?: number;
  },
): string {
  const basePack = opts?.pack ?? TOWN_OBSERVATORY_PACK;
  const pack = packWithPeople(basePack, opts?.minPeople);
  const locale = observatoryLocale(opts?.locale);
  const salts =
    opts?.salts ?? (locale === 'en' ? PROMPT_SALTS_EN : PROMPT_SALTS);
  if (!seeds.length) {
    const fallbackSeed =
      locale === 'en' ? DEMO_TOWN_SEEDS_EN[0]! : DEMO_TOWN_SEEDS[0]!;
    const fallbackSalt =
      locale === 'en' ? PROMPT_SALTS_EN[0]! : PROMPT_SALTS[0]!;
    return buildObservatoryPrompt(fallbackSeed, fallbackSalt, pack, locale);
  }
  const ids = seeds.map((s) => s.id);
  let state = readBag(storageKey);
  state = {
    ...state,
    bag: state.bag.filter((id) => ids.includes(id)),
  };
  if (!state.bag.length) {
    const rest = ids.filter((id) => id !== state.lastId);
    state = {
      ...state,
      bag: shuffleIds(rest.length ? rest : ids, rng),
    };
  }
  const id = state.bag.shift()!;
  const seed = seeds.find((s) => s.id === id) ?? seeds[0]!;
  const salt = salts[state.saltIndex % salts.length]!;
  const next: BagState = {
    bag: state.bag,
    lastId: seed.id,
    saltIndex: state.saltIndex + 1,
  };
  writeBag(storageKey, next);
  return buildObservatoryPrompt(seed, salt, pack, locale);
}

const DEMO_BAG_KEY = 'opengame_demo_town_bag_v1';
const FOREST_BAG_KEY = 'opengame_forest_town_bag_v1';
const CAMP_BAG_KEY = 'opengame_camp_town_bag_v1';
const CREW_BAG_KEY = 'opengame_crew_watch_bag_v1';
const CLOISTER_BAG_KEY = 'opengame_cloister_hours_bag_v1';

export type WorldTemplatePromptOpts = {
  readonly population?: number;
  readonly rng?: () => number;
};

function observatoryPickOpts(
  extras: {
    readonly pack?: ObservatoryPack;
    readonly salts?: readonly PromptSalt[];
    readonly locale?: string;
  },
  opts?: { readonly population?: number },
): {
  readonly pack?: ObservatoryPack;
  readonly salts?: readonly PromptSalt[];
  readonly locale?: string;
  readonly minPeople?: number;
} {
  return {
    ...extras,
    ...(opts?.population != null ? { minPeople: opts.population } : {}),
  };
}

export function pickDemoTownPrompt(
  rng?: () => number,
  opts?: { readonly population?: number },
): string {
  const en = observatoryLocale() === 'en';
  return pickSeededObservatoryPrompt(
    en ? DEMO_TOWN_SEEDS_EN : DEMO_TOWN_SEEDS,
    en ? `${DEMO_BAG_KEY}_en` : DEMO_BAG_KEY,
    rng,
    observatoryPickOpts(
      {
        locale: en ? 'en' : 'zh-CN',
        salts: en ? PROMPT_SALTS_EN : PROMPT_SALTS,
      },
      opts,
    ),
  );
}

export function pickForestPrompt(
  rng?: () => number,
  opts?: { readonly population?: number },
): string {
  const en = observatoryLocale() === 'en';
  return pickSeededObservatoryPrompt(
    en ? FOREST_SEEDS_EN : FOREST_SEEDS,
    en ? `${FOREST_BAG_KEY}_en` : FOREST_BAG_KEY,
    rng,
    observatoryPickOpts(
      {
        locale: en ? 'en' : 'zh-CN',
        salts: en ? PROMPT_SALTS_EN : PROMPT_SALTS,
      },
      opts,
    ),
  );
}

export function pickCampPrompt(
  rng?: () => number,
  opts?: { readonly population?: number },
): string {
  const en = observatoryLocale() === 'en';
  return pickSeededObservatoryPrompt(
    en ? CAMP_SEEDS_EN : CAMP_SEEDS,
    en ? `${CAMP_BAG_KEY}_en` : CAMP_BAG_KEY,
    rng,
    observatoryPickOpts(
      {
        locale: en ? 'en' : 'zh-CN',
        salts: en ? PROMPT_SALTS_EN : PROMPT_SALTS,
      },
      opts,
    ),
  );
}

export function pickCrewPrompt(
  rng?: () => number,
  opts?: { readonly population?: number },
): string {
  const en = observatoryLocale() === 'en';
  return pickSeededObservatoryPrompt(
    en ? CREW_SEEDS_EN : CREW_SEEDS,
    en ? `${CREW_BAG_KEY}_en` : CREW_BAG_KEY,
    rng,
    observatoryPickOpts(
      {
        pack: CREW_OBSERVATORY_PACK,
        salts: en ? CREW_SALTS_EN : CREW_SALTS,
        locale: en ? 'en' : 'zh-CN',
      },
      opts,
    ),
  );
}

export function pickCloisterPrompt(
  rng?: () => number,
  opts?: { readonly population?: number },
): string {
  const en = observatoryLocale() === 'en';
  return pickSeededObservatoryPrompt(
    en ? CLOISTER_SEEDS_EN : CLOISTER_SEEDS,
    en ? `${CLOISTER_BAG_KEY}_en` : CLOISTER_BAG_KEY,
    rng,
    observatoryPickOpts(
      {
        pack: CLOISTER_OBSERVATORY_PACK,
        salts: en ? CLOISTER_SALTS_EN : CLOISTER_SALTS,
        locale: en ? 'en' : 'zh-CN',
      },
      opts,
    ),
  );
}

const LINGBOT_PROMPT =
  '生成一座可观察的小镇社会并启用 LingBot 档B（L3 cinematic）：至少 22 名有名字的居民、日常与聚会种子传闻；场所带夜市或茶馆之一，避免无名广场模板。在 Spec 中设置 spatialBackend=lingbot、cinematicEnabled=true、lingbotMode=real。玩法以社会观察为准（非通关 RPG）。生成后到「科研实验室」：健康检查 → Smoke → Session → 出片(frames=17)。';

const LINGBOT_PROMPT_EN =
  'Compile an observable town society and enable LingBot track B (cinematic, not a win/lose RPG): at least 22 named residents, daily life and a gathering rumor; places include a night market or teahouse — not a nameless plaza. Set spatialBackend=lingbot, cinematicEnabled=true, lingbotMode=real. After generate, open Research lab: health → Smoke → Session → clip (frames=17).';

const AGENTIC_PROMPT =
  'agentic director：扩展一片神秘森林并加入可观察的社会事件道具（药庐/猎场即可）；pilot：让 NPC 对彼此意图作出反应（关系/对话），不要改成通关任务链。';

const AGENTIC_PROMPT_EN =
  'agentic director: expand a mist forest and add observable society props (herb hut / hunting ground is enough); pilot: have NPCs react to each other\'s intent (ties / talk). Do not turn this into a quest chain to clear.';

export const WORLD_TEMPLATES: readonly WorldTemplate[] = [
  {
    id: 'demo_town',
    titleKey: 'world.template.demoTown.title',
    descKey: 'world.template.demoTown.desc',
    emoji: '🏘️',
    mode: 'world',
    recommended: true,
    prompt: buildObservatoryPrompt(DEMO_TOWN_SEEDS[0]!, PROMPT_SALTS[0]!),
  },
  {
    id: 'crew_watch',
    titleKey: 'world.template.crew.title',
    descKey: 'world.template.crew.desc',
    emoji: '🛰️',
    mode: 'world',
    prompt: buildObservatoryPrompt(
      CREW_SEEDS[0]!,
      CREW_SALTS[0]!,
      CREW_OBSERVATORY_PACK,
    ),
  },
  {
    id: 'cloister_hours',
    titleKey: 'world.template.cloister.title',
    descKey: 'world.template.cloister.desc',
    emoji: '🕊️',
    mode: 'world',
    prompt: buildObservatoryPrompt(
      CLOISTER_SEEDS[0]!,
      CLOISTER_SALTS[0]!,
      CLOISTER_OBSERVATORY_PACK,
    ),
  },
  {
    id: 'mystery_forest',
    titleKey: 'world.template.forest.title',
    descKey: 'world.template.forest.desc',
    emoji: '🌲',
    mode: 'world',
    prompt: buildObservatoryPrompt(FOREST_SEEDS[0]!, PROMPT_SALTS[1]!),
  },
  {
    id: 'dungeon_raid',
    titleKey: 'world.template.dungeon.title',
    descKey: 'world.template.dungeon.desc',
    emoji: '🏰',
    mode: 'world',
    prompt: buildObservatoryPrompt(CAMP_SEEDS[0]!, PROMPT_SALTS[2]!),
  },
  {
    id: 'lingbot_cinematic',
    titleKey: 'world.template.lingbot.title',
    descKey: 'world.template.lingbot.desc',
    emoji: '🎥',
    mode: 'world',
    prompt: LINGBOT_PROMPT,
  },
  {
    id: 'agentic_expand',
    titleKey: 'world.template.agentic.title',
    descKey: 'world.template.agentic.desc',
    emoji: '🎬',
    mode: 'world_edit',
    prompt: AGENTIC_PROMPT,
  },
] as const;

/** First-click templates — research / LingBot stays off the welcome grid. */
export function firstClickWorldTemplates(): readonly WorldTemplate[] {
  return WORLD_TEMPLATES.filter(
    (tpl) => tpl.mode === 'world' && tpl.id !== 'lingbot_cinematic',
  );
}

export function researchWorldTemplates(): readonly WorldTemplate[] {
  return WORLD_TEMPLATES.filter((tpl) => tpl.id === 'lingbot_cinematic');
}

function withNamedPopulation(text: string, population?: number): string {
  if (population == null) return text;
  return rewritePackPeopleCount(text, population)
    .replace(/至少\s*\d{1,3}\s*名/g, `至少 ${population} 名`)
    .replace(/at least \d{1,3} named/gi, `at least ${population} named`);
}

/** Resolve the prompt to send for a homepage / empty-state click. */
export function promptForWorldTemplate(
  id: WorldTemplateId,
  opts?: WorldTemplatePromptOpts,
): string {
  const rng = opts?.rng;
  const pop = opts?.population != null ? { population: opts.population } : undefined;
  switch (id) {
    case 'demo_town':
      return pickDemoTownPrompt(rng, pop);
    case 'crew_watch':
      return pickCrewPrompt(rng, pop);
    case 'cloister_hours':
      return pickCloisterPrompt(rng, pop);
    case 'mystery_forest':
      return pickForestPrompt(rng, pop);
    case 'dungeon_raid':
      return pickCampPrompt(rng, pop);
    case 'lingbot_cinematic':
      return withNamedPopulation(
        observatoryLocale() === 'en' ? LINGBOT_PROMPT_EN : LINGBOT_PROMPT,
        opts?.population,
      );
    case 'agentic_expand':
      return observatoryLocale() === 'en' ? AGENTIC_PROMPT_EN : AGENTIC_PROMPT;
    default:
      return pickDemoTownPrompt(rng, pop);
  }
}

export const GENERATION_MODE_KEY = 'opengame_generation_mode';

export type GenerationMode = 'game' | 'world';

export function readStoredGenerationMode(): GenerationMode {
  if (typeof window === 'undefined') return 'game';
  const v = window.localStorage.getItem(GENERATION_MODE_KEY);
  return v === 'world' ? 'world' : 'game';
}

export function storeGenerationMode(mode: GenerationMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(GENERATION_MODE_KEY, mode);
}

const LAST_WORLD_PROMPT_PREFIX = 'opengame_last_world_prompt_';
const lastWorldPromptMem = new Map<string, string>();

function lastWorldPromptKey(projectId: string): string {
  return `${LAST_WORLD_PROMPT_PREFIX}${projectId}`;
}

/** Remember the prompt actually sent for world_generate so regenerate does not swap towns. */
export function rememberWorldGeneratePrompt(
  projectId: string,
  prompt: string,
): void {
  const id = projectId.trim();
  const text = prompt.trim();
  if (!id || !text) return;
  lastWorldPromptMem.set(id, text);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(lastWorldPromptKey(id), text);
    }
  } catch {
    /* private mode / SSR */
  }
}

export function readLastWorldGeneratePrompt(projectId: string): string | null {
  const id = projectId.trim();
  if (!id) return null;
  try {
    if (typeof sessionStorage !== 'undefined') {
      const v = sessionStorage.getItem(lastWorldPromptKey(id));
      if (v?.trim()) return v;
    }
  } catch {
    /* ignore */
  }
  return lastWorldPromptMem.get(id) ?? null;
}

/** Test helpers — not used by UI. */
export const WORLD_PROMPT_SEEDS = {
  demo: DEMO_TOWN_SEEDS,
  forest: FOREST_SEEDS,
  camp: CAMP_SEEDS,
  crew: CREW_SEEDS,
  cloister: CLOISTER_SEEDS,
} as const;
