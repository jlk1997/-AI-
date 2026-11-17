/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pad thin World Specs. Society mode pads NPCs/regions (not enemies/quests).
 * RPG mode keeps legacy ≥2 quests + pressure enemy padding.
 */

import {
  anonymousLeadName,
  genreProfileWithPopulation,
  isConcreteWorldCue,
  isGenericGatheringLine,
  maxNamedResidents,
  openingRumorFromSpec,
  parseWorldSpec,
  resolveGenreProfile,
  stampResidentPlaces,
  type GenreProfile,
  type WorldSpec,
} from '@opengame/world-spec';
import { isMostlyAsciiText, occupationForPlace } from './locale/extractPlaces.js';
import { extraRegionCopy, societyPadsFor } from './locale/pads.js';
import {
  defaultOccupation,
  npcProse,
  residentPool,
} from './locale/residents.js';
import { stanceCardFor, stampMissingStanceCards } from './locale/stanceCard.js';

export interface WorldDepthMetrics {
  readonly regions: number;
  readonly quests: number;
  readonly rules: number;
  readonly enemies: number;
  readonly npcs: number;
}

export type WorldDepthMode = 'society' | 'rpg';

export function measureWorldDepth(world: WorldSpec): WorldDepthMetrics {
  return {
    regions: world.space.regions.length,
    quests: world.narrative.quests.length,
    rules: world.rules.length,
    enemies: world.entities.filter((e) => e.kind === 'enemy').length,
    npcs: world.entities.filter((e) => e.kind === 'npc').length,
  };
}

export interface EnsureWorldDepthOptions {
  /** Default society — product Society World path. */
  readonly mode?: WorldDepthMode;
  /** Pack population/topology. Missing = society.town when mode is society. */
  readonly profile?: GenreProfile;
  /** Explicit headcount from the prompt — do not pad past this. */
  readonly populationHint?: number;
  /**
   * When no populationHint: pad NPCs up to pack max (generate) or only up to
   * pack min (incremental edit — do not inflate an already-valid crew of 6).
   */
  readonly padPopulation?: 'min' | 'max';
}

function objectNameForArea(areaName: string, regionName: string): string {
  const t = `${areaName} ${regionName}`;
  if (/面包|厨|食/.test(t)) return '烤炉';
  if (/铁|炉|匠/.test(t)) return '铁匠炉';
  if (/学|书/.test(t)) return '黑板';
  if (/客栈|酒|旅/.test(t)) return '吧台';
  if (/宅|家|巷/.test(t)) return '门灯';
  if (/林|野/.test(t)) return '石凳';
  if (/市|摊|货/.test(t)) return '货箱';
  if (/码头|船坞|晒网|缆/.test(t)) return '缆桩';
  if (/舰桥|甲板|舱|值班/.test(t)) return '仪表台';
  if (/礼拜|抄经|菜园|香案/.test(t)) return '长凳';
  if (/dock|bridge|deck|galley|cabin|bay|greenhouse/i.test(t)) return 'console';
  if (/chapel|scriptorium|garden|cloister/i.test(t)) return 'pew';
  if (!/[^\x00-\x7F]/.test(t)) return 'bench';
  return '长椅';
}

function padObjectState(areaName: string, regionName: string, ascii: boolean): string {
  const label = (areaName || regionName || '').trim() || (ascii ? 'here' : '这边');
  let h = 0;
  const seed = `${areaName}:${regionName}`;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  const n = Math.abs(h);
  if (ascii) {
    const pool = [
      `tools still warm at ${label} — someone just used them`,
      `a half-written note sits on the ${label} bench`,
      `the latch at ${label} was left undone`,
      `dust at ${label} is freshly kicked`,
      `a cup at ${label} is still half full`,
    ];
    return pool[n % pool.length]!;
  }
  const pool = [
    `${label}的家伙还温着，刚有人用过`,
    `${label}案上压着一张没写完的条子`,
    `${label}的门闩没扣上`,
    `${label}地上的灰是刚踩乱的`,
    `${label}还剩半杯茶，人刚走开`,
  ];
  return pool[n % pool.length]!;
}

function stampOpeningRumor(world: WorldSpec): WorldSpec {
  const current = world.presentation.openingRumor?.trim() ?? '';
  if (
    current &&
    isConcreteWorldCue(current) &&
    !isGenericGatheringLine(current)
  ) {
    return world;
  }
  const lead =
    world.entities.find((e) => e.kind === 'npc')?.name ??
    anonymousLeadName(world);
  const rumor = openingRumorFromSpec(lead, world);
  if (!isConcreteWorldCue(rumor) || isGenericGatheringLine(rumor)) {
    return world;
  }
  return parseWorldSpec({
    ...world,
    presentation: {
      ...world.presentation,
      openingRumor: rumor.slice(0, 120),
    },
  });
}

/**
 * 批次 4：异步 LLM 二次润色 openingRumor。
 * 默认不动现有 stampOpeningRumor 行为；worker / api 在 OPENGAME_RUMOR_LLM=1 时启用。
 * 失败或无 LLM key 时直接返回原 spec，绝不破坏现有数据。
 */
export async function stampOpeningRumorLlm(world: WorldSpec): Promise<WorldSpec> {
  if (process.env['OPENGAME_RUMOR_LLM'] !== '1') return world;
  const current = world.presentation.openingRumor?.trim() ?? '';
  if (!current) return world;
  if (isGenericGatheringLine(current)) return world;
  if (!isConcreteWorldCue(current)) return world;
  try {
    const { refineNarrative } = await import('./refineNarrative.js');
    const refined = await refineNarrative(world, {
      fields: ['presentation.openingRumor'],
      locale: worldIsAscii(world) ? 'en' : 'zh',
    });
    if (refined === world) return world;
    const next = refined.presentation.openingRumor?.trim() ?? '';
    if (!next || next === current) return world;
    if (!isConcreteWorldCue(next) || isGenericGatheringLine(next)) return world;
    return refined;
  } catch {
    return world;
  }
}

function worldIsAscii(world: WorldSpec): boolean {
  return isMostlyAsciiText(
    world.space.regions.map((r) => r.name || r.id).join(' '),
  );
}

/** Drop extra NPCs when the user picked a compact headcount. Prefer dropping pads. */
function trimSocietyNpcs(world: WorldSpec, target: number): WorldSpec {
  const npcs = world.entities.filter((e) => e.kind === 'npc');
  if (npcs.length <= target) return world;
  const keepNpcIds = new Set(
    npcs
      .map((npc, index) => ({ npc, index }))
      .sort((a, b) => {
        const ap = a.npc.tags?.includes('padded') ? 1 : 0;
        const bp = b.npc.tags?.includes('padded') ? 1 : 0;
        if (ap !== bp) return ap - bp;
        return a.index - b.index;
      })
      .slice(0, target)
      .map((row) => row.npc.id),
  );
  const entities = world.entities.filter(
    (e) => e.kind !== 'npc' || keepNpcIds.has(e.id),
  );
  const ids = new Set(entities.map((e) => e.id));
  const relations = world.relations.filter((r) => {
    if (!ids.has(r.from)) return false;
    if (ids.has(r.to)) return true;
    return r.type === 'located_in';
  });
  const cleaned = entities.map((e) => {
    const rels = e.identity?.initialRelations;
    if (!rels) return e;
    const nextRels = Object.fromEntries(
      Object.entries(rels).filter(([id]) => ids.has(id)),
    );
    return {
      ...e,
      identity: { ...e.identity, initialRelations: nextRels },
    };
  });
  return parseWorldSpec({ ...world, entities: cleaned, relations });
}

function placeActivity(activity: string, place: string, ascii: boolean): string {
  return ascii ? `${activity} (${place})` : `${activity}（${place}）`;
}

function buddyBlurb(label: string, buddy: string, ascii: boolean): string {
  return ascii ? `${label} (${buddy})` : `${label}（${buddy}）`;
}

function hubNameOf(world: WorldSpec): string {
  return (
    world.space.regions.find((r) => r.id === world.space.startRegionId)?.name ??
    world.space.regions[0]?.name ??
    (worldIsAscii(world) ? 'gathering' : '集会处')
  );
}

/** Rewrite Stanford-town pad copy onto this world's hub. */
function localizePadCopy(
  text: string,
  hubName: string,
  profile: GenreProfile,
): string {
  const hub = hubName.trim() || '集会处';
  let out = text;
  if (!/^(广场|城镇广场|喷泉广场)$/.test(hub)) {
    out = out.replace(/广场/g, hub);
  }
  if (profile.id === 'society.crew') {
    out = out.replace(/舰桥/g, hub).replace(/\bBridge\b/g, hub);
  }
  if (profile.id === 'society.cloister') {
    out = out.replace(/礼拜堂/g, hub).replace(/\bChapel\b/g, hub);
  }
  if (profile.id !== 'society.town') {
    out = out
      .replace(/全镇/g, '这边')
      .replace(/镇上/g, '这边')
      .replace(/街坊/g, '邻里');
  }
  return out;
}

function padSocietyAreas(world: WorldSpec): {
  readonly world: WorldSpec;
  readonly padded: boolean;
} {
  let padded = false;
  const ascii = worldIsAscii(world);
  let areas = [...(world.space.areas ?? [])];
  areas = areas.map((a) => {
    const objects = a.objects ?? [];
    const region = world.space.regions.find((r) => r.id === a.regionId);
    const label = a.name || region?.name || a.regionId;
    if (objects.length === 0) {
      padded = true;
      return {
        ...a,
        objects: [
          {
            id: `obj_${a.id}_pad`,
            name: objectNameForArea(a.name, label),
            state: padObjectState(a.name, label, ascii),
            tags: [],
          },
        ],
      };
    }
    if (objects.every((o) => !isConcreteWorldCue(o.state ?? ''))) {
      padded = true;
      return {
        ...a,
        objects: objects.map((o) => ({
          ...o,
          state: padObjectState(o.name || a.name, label, ascii),
        })),
      };
    }
    return a;
  });
  const covered = new Set(areas.map((a) => a.regionId));
  for (const region of world.space.regions) {
    if (covered.has(region.id)) continue;
    padded = true;
    const areaName = ascii
      ? region.name
        ? `${region.name} corner`
        : 'corner'
      : region.name
        ? `${region.name}一角`
        : '街角';
    areas.push({
      id: `area_${region.id}`,
      name: areaName,
      regionId: region.id,
      objects: [
        {
          id: `obj_${region.id}_pad`,
          name: objectNameForArea(areaName, region.name ?? region.id),
          state: padObjectState(areaName, region.name ?? region.id, ascii),
          tags: [],
        },
      ],
    });
    covered.add(region.id);
  }
  if (!padded) return { world, padded: false };
  return {
    world: parseWorldSpec({
      ...world,
      space: { ...world.space, areas },
    }),
    padded: true,
  };
}

/**
 * Deterministic enrichment — used after planner / before quality gate.
 */
export function ensureWorldDepth(
  world: WorldSpec,
  options: EnsureWorldDepthOptions = {},
): {
  readonly world: WorldSpec;
  readonly padded: boolean;
  readonly before: WorldDepthMetrics;
  readonly after: WorldDepthMetrics;
  /** Region ids introduced by padding — must refresh posters/spatial. */
  readonly addedRegionIds: readonly string[];
} {
  const mode = options.mode ?? 'society';
  const profile =
    options.profile ??
    (mode === 'society' ? resolveGenreProfile(world) : undefined);
  const minRegions = profile?.topology.minRegions ?? 3;
  const packMax = profile?.population.max ?? 25;
  const packMin = profile?.population.min ?? 18;
  const targetNpcs =
    mode === 'society'
      ? options.populationHint != null
        ? Math.max(2, Math.min(maxNamedResidents(), options.populationHint))
        : options.padPopulation === 'min'
          ? packMin
          : packMax
      : undefined;
  const before = measureWorldDepth(world);
  let next: WorldSpec = world;
  let padded = false;
  const addedRegionIds: string[] = [];
  const ascii = worldIsAscii(next);

  if (next.space.regions.length < minRegions) {
    const id = `pad_region_${next.space.regions.length}`;
    addedRegionIds.push(id);
    const start = next.space.startRegionId;
    const startRegion = next.space.regions.find((r) => r.id === start);
    const extra =
      mode === 'society'
        ? extraRegionCopy(profile ?? { id: 'society.town' }, ascii)
        : {
            name: 'Frontier Reach',
            description: 'Quality-pad frontier beyond the known map.',
            label: 'Frontier',
            returnLabel: 'Return',
          };
    next = parseWorldSpec({
      ...next,
      space: {
        ...next.space,
        regions: [
          ...next.space.regions,
          {
            id,
            name: extra.name,
            kind: mode === 'society' ? 'interior' : 'wilderness',
            width: 14,
            height: 12,
            description: extra.description,
            tags: ['padded', mode === 'society' ? 'social' : 'frontier'],
          },
        ],
        portals: [
          ...next.space.portals,
          {
            id: `portal_${start}_${id}`,
            fromRegionId: start,
            toRegionId: id,
            fromPos: {
              x: Math.max(1, (startRegion?.width ?? 12) - 2),
              y: Math.floor((startRegion?.height ?? 10) / 2),
            },
            toPos: { x: 1, y: 6 },
            label: extra.label,
          },
          {
            id: `portal_${id}_${start}`,
            fromRegionId: id,
            toRegionId: start,
            fromPos: { x: 1, y: 6 },
            toPos: {
              x: Math.max(1, (startRegion?.width ?? 12) - 3),
              y: Math.floor((startRegion?.height ?? 10) / 2),
            },
            label: extra.returnLabel,
          },
        ],
      },
    });
    padded = true;
  }

  if (mode === 'society') {
    let npcCount = next.entities.filter((e) => e.kind === 'npc').length;
    const start = next.space.startRegionId;
    const hub = hubNameOf(next);
    const packProfile = profile ?? resolveGenreProfile(next);
    const loc = (s: string) => localizePadCopy(s, hub, packProfile);
    const pads =
      societyPadsFor(packProfile, ascii) ??
      ([
      {
        id: 'npc_pad_baker',
        name: '炉穗',
        occupation: '面包师',
        spriteKey: '🍞',
        age: 41,
        traits: ['早起', '手暖', '爱把热面包塞给人'],
        backstory:
          '五更就起炉。麦香把剩的面包留给跑腿的孩子。她总惦记着谁家断了粮。',
        personality: '说话带着烘炉热气',
        dialogueSeed: '第一炉刚出，趁热拿两个。',
        relationLabel: '会给对方留热面包',
        relationType: 'allies',
        morning: '在烤炉前醒面',
        evening: '把没卖完的面包分给街坊',
      },
      {
        id: 'npc_pad_guard',
        name: '关石',
        occupation: '门卫',
        spriteKey: '🛡️',
        age: 48,
        traits: ['少言', '记路', '夜里耳尖'],
        backstory:
          '在北门站了十二年。关石认得每双夜里路过的鞋。他欠铁匠一柄修好的矛。',
        personality: '话少，但记得谁晚归',
        dialogueSeed: '夜里街上有什么动静，我都听得见。',
        relationLabel: '夜里替对方看着门',
        relationType: 'knows',
        morning: '在岗上换班补眠',
        evening: '沿街巡夜',
      },
      {
        id: 'npc_pad_child',
        name: '小棠',
        occupation: '跑腿',
        spriteKey: '🧒',
        age: 12,
        traits: ['脚快', '嘴碎', '藏不住秘密'],
        backstory:
          '爹在矿上，娘让她给人送信挣钱。小棠把镇上每条巷都跑熟了。她最怕把信送错门。',
        personality: '话比腿还快',
        dialogueSeed: '我跑一趟就能把话带到全镇！',
        relationLabel: '常给对方捎口信',
        relationType: 'knows',
        morning: '在学堂门口等人托信',
        evening: '在广场把路上听来的话讲给人听',
      },
      {
        id: 'npc_pad_smith',
        name: '欧锤',
        occupation: '铁匠',
        spriteKey: '🔨',
        age: 37,
        traits: ['较真', '手劲大', '不爱欠人情'],
        backstory:
          '从外乡来投师，自己支了炉。欧锤修农具从不添价。他答应过老师傅把手艺留下。',
        personality: '锤声比人声响',
        dialogueSeed: '工具拿来，我看看还能不能救。',
        relationLabel: '替对方修过家什',
        relationType: 'allies',
        morning: '在炉前打铁',
        evening: '把修好的工具送回去',
      },
      {
        id: 'npc_pad_teacher',
        name: '程先生',
        occupation: '塾师',
        spriteKey: '📚',
        age: 56,
        traits: ['古板', '心软', '记性好'],
        backstory:
          '在学堂教了二十年。程先生嫌孩子们只会记账。他私藏着一本对不上的旧抄本。',
        personality: '说话像在上课',
        dialogueSeed: '孩子们该识字，别只会记账。',
        relationLabel: '教过对方识字',
        relationType: 'knows',
        morning: '在学堂上课',
        evening: '批改功课并准备明天的课',
      },
      {
        id: 'npc_pad_healer',
        name: '白芷',
        occupation: '大夫',
        spriteKey: '💊',
        age: 33,
        traits: ['冷静', '夜不闭户', '闻得出药味'],
        backstory:
          '从城里学成回来坐堂。白芷夜里也给人开门。她记得谁家孩子体弱。',
        personality: '问诊时话少手快',
        dialogueSeed: '先把脉，别自己乱吃药。',
        relationLabel: '给对方看过病',
        relationType: 'knows',
        morning: '在药柜前配药',
        evening: '出诊探访卧床的病人',
      },
      {
        id: 'npc_pad_innkeep',
        name: '柳掌柜',
        occupation: '客栈掌柜',
        spriteKey: '🍺',
        age: 45,
        traits: ['好客', '爱听闲话', '账算得清'],
        backstory:
          '客栈是娘留下的。柳掌柜把闲话当佐料。她知道谁和谁上个月拌过嘴。',
        personality: '人没进门酒先满上',
        dialogueSeed: '坐，先喝一口再讲你路上的事。',
        relationLabel: '常在店里留对方一盏',
        relationType: 'allies',
        morning: '把客房的被子翻出来晒',
        evening: '在吧台招呼客人',
      },
      {
        id: 'npc_pad_merchant',
        name: '钱满仓',
        occupation: '货郎',
        spriteKey: '🧺',
        age: 39,
        traits: ['精明', '走路快', '记仇也记恩'],
        backstory:
          '盐和布都经他的手。钱满仓三天进一趟货。他最怕路上的雨把布浸了。',
        personality: '开口先问行情',
        dialogueSeed: '盐快见底了，下一批得等三天。',
        relationLabel: '跟对方做过买卖',
        relationType: 'knows',
        morning: '看店记账',
        evening: '去补货并打听行情',
      },
      {
        id: 'npc_pad_farmer',
        name: '田埂',
        occupation: '农夫',
        spriteKey: '🌾',
        age: 52,
        traits: ['勤', '看天', '话里带着土'],
        backstory:
          '麦田在林道边上。田埂怕这几天下雨。他欠铁匠一副新锄，还没送鸡蛋去还。',
        personality: '开口先说今年收成',
        dialogueSeed: '麦子快能割了，就怕这几天下雨。',
        relationLabel: '秋收时会给对方留一袋粮',
        relationType: 'allies',
        morning: '在田里干活',
        evening: '把收成挑到集市上',
      },
      {
        id: 'npc_pad_weaver',
        name: '织娘',
        occupation: '织工',
        spriteKey: '🧵',
        age: 29,
        traits: ['手巧', '眼尖', '不爱凑热闹'],
        backstory:
          '新到的染布是她挑的。织娘能摸出线紧不紧。她偷偷给塾师织过一条围巾。',
        personality: '说话时手里还在绕线',
        dialogueSeed: '新到的染布，你摸摸这手感。',
        relationLabel: '给对方织过衣裳',
        relationType: 'knows',
        morning: '在机上织布',
        evening: '把成匹送到货摊上',
      },
      {
        id: 'npc_pad_fisher',
        name: '阿渔',
        occupation: '渔夫',
        spriteKey: '🎣',
        age: 24,
        traits: ['早潮', '乐呵', '会看云'],
        backstory:
          '船是爹留下的。阿渔天亮前就下河。他总把最大的一条留给客栈的汤。',
        personality: '衣服上永远有水汽',
        dialogueSeed: '今早的鱼还活蹦，掌柜的要不要？',
        relationLabel: '把鲜鱼先送到对方面前',
        relationType: 'allies',
        morning: '在河边收网',
        evening: '把鱼送到客栈和集市',
      },
      {
        id: 'npc_pad_clerk',
        name: '方书吏',
        occupation: '文书',
        spriteKey: '📜',
        age: 44,
        traits: ['较真', '字工整', '记仇记在纸上'],
        backstory:
          '镇上的契和告示都经他手。方书吏嫌人口口相传靠不住。他抽屉里压着一张未贴出的聚会告示。',
        personality: '说话像在宣读告示',
        dialogueSeed: '字写清楚，免得以后扯皮。',
        relationLabel: '替对方写过契',
        relationType: 'knows',
        morning: '在案前抄告示',
        evening: '把听来的话核对进册子',
      },
      {
        id: 'npc_pad_carpenter',
        name: '桑木',
        occupation: '木匠',
        spriteKey: '🪵',
        age: 41,
        traits: ['手稳', '爱闻刨花', '话慢'],
        backstory:
          '梁是他一斧一斧砍直的。桑木给铁匠做过锤柄。雨天他会把新门板抬到客栈廊下阴干。',
        personality: '量完尺寸才开口',
        dialogueSeed: '这榫要对上，门才不晃。',
        relationLabel: '给对方修过门框',
        relationType: 'allies',
        morning: '在工棚刨木',
        evening: '把做好的板送到人家门口',
      },
      {
        id: 'npc_pad_hunter',
        name: '霍青',
        occupation: '猎人',
        spriteKey: '🏹',
        age: 34,
        traits: ['脚轻', '认兽踪', '不爱进城'],
        backstory:
          '爹把猎场交给他。霍青认得矿工每天走的那条道。他不爱听人把林子说成矿。',
        personality: '说话像怕惊着林子',
        dialogueSeed: '今早有鹿脚印，别往那边砍柴。',
        relationLabel: '给对方带过野味',
        relationType: 'knows',
        morning: '沿林边巡脚印',
        evening: '把皮子送到集市',
      },
      {
        id: 'npc_pad_miller',
        name: '石碾',
        occupation: '磨坊主',
        spriteKey: '🌾',
        age: 48,
        traits: ['早起', '记麦账', '面粉沾衣'],
        backstory:
          '磨坊在集市西头。石碾和田里的人约好麦熟就送来。夜里水车一响他就醒。',
        personality: '说话带着面灰',
        dialogueSeed: '今年的麦比去年硬，得再磨一遍。',
        relationLabel: '替对方磨过口粮',
        relationType: 'allies',
        morning: '开磨盘收麦',
        evening: '把面袋送到各家门口',
      },
      {
        id: 'npc_pad_potter',
        name: '泥生',
        occupation: '陶匠',
        spriteKey: '🏺',
        age: 52,
        traits: ['手黏土', '话少', '记谁摔过碗'],
        backstory:
          '窑在巷尾。泥生给客栈烧过酒坛。他嫌人把粗碗当一次性的。',
        personality: '拍拍陶坯才答话',
        dialogueSeed: '这釉要过夜才亮，别急着摸。',
        relationLabel: '给对方补过坛',
        relationType: 'knows',
        morning: '在窑边拉坯',
        evening: '把新碗送到酒铺',
      },
      {
        id: 'npc_pad_mayor',
        name: '韩伯',
        occupation: '里正',
        spriteKey: '🪧',
        age: 61,
        traits: ['记人名', '爱在广场站着', '劝架'],
        backstory:
          '告示栏的字他都过目。韩伯记得谁家吵过架。聚会的日子他会提前把灯点上。',
        personality: '像在主持邻里会',
        dialogueSeed: '有事写到告示上，别只在嘴里传。',
        relationLabel: '给对方调过停',
        relationType: 'knows',
        morning: '在广场看告示栏',
        evening: '挨家问问灯油还够不够',
      },
      {
        id: 'npc_pad_post',
        name: '小羽',
        occupation: '信差',
        spriteKey: '✉️',
        age: 16,
        traits: ['跑得快', '记路', '嘴上没把门'],
        backstory:
          '信袋比人沉。小羽从矿上跑到学堂，谁家的话他都听过一遍。他答应过不拆别人的信。',
        personality: '话还没说完人已经到门口',
        dialogueSeed: '这封要亲手交，别让旁人拆。',
        relationLabel: '给对方送过信',
        relationType: 'knows',
        morning: '从客栈取信袋',
        evening: '把没送到的信压在枕头下',
      },
      {
        id: 'npc_pad_bard',
        name: '柳三',
        occupation: '说书人',
        spriteKey: '🪕',
        age: 39,
        traits: ['记故事', '爱喝茶', '把真话编进段子'],
        backstory:
          '晚上在客栈说书。柳三把矿上的事说成传奇。他真正怕的是故事被听成谣言。',
        personality: '开口先拍桌子',
        dialogueSeed: '今儿这段是真事，只是人名换了。',
        relationLabel: '把对方写进过段子',
        relationType: 'knows',
        morning: '在茶摊改稿',
        evening: '在客栈说新段',
      },
      {
        id: 'npc_pad_stable',
        name: '拴柱',
        occupation: '马夫',
        spriteKey: '🐴',
        age: 27,
        traits: ['起得早', '认牲口脾气', '路上话多'],
        backstory:
          '驿站的马归他喂。拴柱送过里正去邻镇。他记得哪段路雨后会陷车。',
        personality: '边刷马边说话',
        dialogueSeed: '这匹今早不吃料，别强骑。',
        relationLabel: '给对方备过马',
        relationType: 'knows',
        morning: '在厩里喂马',
        evening: '把车辕卸了靠墙',
      },
      {
        id: 'npc_pad_barber',
        name: '剪秋',
        occupation: '剃头匠',
        spriteKey: '✂️',
        age: 44,
        traits: ['手稳', '听闲话', '剪刀响得准时'],
        backstory:
          '铺子在巷口。剪秋给人剃头时听完半个镇的事。他从不把椅子上的话带出门外。',
        personality: '围布一抖才开口',
        dialogueSeed: '坐下，今儿刮不刮脸？',
        relationLabel: '给对方理过发',
        relationType: 'knows',
        morning: '在铺里磨剪子',
        evening: '把热水倒掉收摊',
      },
      {
        id: 'npc_pad_florist',
        name: '篱香',
        occupation: '花农',
        spriteKey: '🌸',
        age: 33,
        traits: ['早市', '认土味', '把花插得齐'],
        backstory:
          '畦在林道边。篱香把新开的花送到客栈案上。她记得谁家办过喜事。',
        personality: '说话像在数花瓣',
        dialogueSeed: '这束今早剪的，水要勤换。',
        relationLabel: '给对方送过花',
        relationType: 'allies',
        morning: '在畦里剪花',
        evening: '把剩下的花插进陶瓶',
      },
      {
        id: 'npc_pad_watchman',
        name: '守夜',
        occupation: '更夫',
        spriteKey: '🔔',
        age: 56,
        traits: ['夜里精神', '敲梆子', '认得脚步'],
        backstory:
          '梆子是爹留下的。守夜从客栈敲到北门。他见过谁家灯灭得最晚。',
        personality: '说话带着梆子点',
        dialogueSeed: '三更过了，灯该灭了。',
        relationLabel: '夜里替对方看过门',
        relationType: 'knows',
        morning: '补眠到日头高',
        evening: '沿巷敲更',
      },
    ]);
    const usedNames = new Set(
      next.entities.filter((e) => e.kind === 'npc').map((e) => e.name),
    );
    const salt = `${next.meta.title}|${next.meta.id}`;
    let rot = 0;
    for (const ch of salt) rot = (rot + ch.charCodeAt(0) * 17) % pads.length;
    const ordered = [...pads.slice(rot), ...pads.slice(0, rot)];
    for (const pad of ordered) {
      if (targetNpcs != null && npcCount >= targetNpcs) break;
      if (next.entities.some((e) => e.id === pad.id)) continue;
      if (usedNames.has(pad.name)) continue;
      const regions = next.space.regions;
      const regionId = regions[npcCount % regions.length]?.id ?? start;
      const regionName =
        regions.find((r) => r.id === regionId)?.name ?? regionId;
      const areas = next.space.areas ?? [];
      const workArea =
        areas.find((a) => a.regionId === regionId) ?? areas[0];
      const restRegion = regions[regions.length - 1];
      const homeArea =
        areas.find((a) => a.regionId === restRegion?.id) ?? workArea;
      const others = next.entities.filter((e) => e.kind === 'npc');
      const buddy = others[npcCount % Math.max(1, others.length)];
      const initialRelations: Record<string, string> = {};
      if (buddy && buddy.id !== pad.id) {
        initialRelations[buddy.id] = buddyBlurb(
          pad.relationLabel,
          buddy.name,
          ascii,
        );
      }
      const padCard = stanceCardFor(pad.name, pad.occupation, npcCount, ascii);
      next = parseWorldSpec({
        ...next,
        entities: [
          ...next.entities,
          {
            id: pad.id,
            kind: 'npc',
            name: pad.name,
            regionId,
            pos: { x: 3 + (npcCount % 8), y: 4 + (npcCount % 6) },
            personality: loc(pad.personality),
            dialogueSeed: loc(pad.dialogueSeed),
            identity: {
              displayName: pad.name,
              age: pad.age,
              occupation: pad.occupation,
              traits: pad.traits.map(loc),
              backstory: loc(pad.backstory),
              initialRelations,
              homeAreaId: homeArea?.id,
              workAreaId: workArea?.id,
              secret: padCard.secret,
              stance: padCard.stance,
            },
            attrs: { role: pad.occupation },
            inventory: [],
            spriteKey: pad.spriteKey,
            schedule: [
              {
                hour: 9,
                regionId,
                activity: placeActivity(loc(pad.morning), regionName, ascii),
              },
              {
                hour: 18,
                regionId: start,
                activity: placeActivity(loc(pad.evening), hub, ascii),
              },
            ],
            tags: ['padded'],
          },
        ],
        relations: [
          ...next.relations,
          ...(buddy && buddy.id !== pad.id
            ? [
                {
                  id: `rel_${pad.id}_${buddy.id}`,
                  from: pad.id,
                  to: buddy.id,
                  type: pad.relationType,
                  strength: 0.35 + (npcCount % 4) * 0.1,
                  meta: { label: pad.relationLabel },
                },
              ]
            : []),
        ],
      });
      npcCount += 1;
      usedNames.add(pad.name);
      padded = true;
    }
    let overflow = 0;
    const pool = residentPool(packProfile.id, ascii);
    while (
      targetNpcs != null &&
      npcCount < targetNpcs &&
      overflow < pool.length * 3
    ) {
      const who = pool[overflow % pool.length]!;
      const gen = Math.floor(overflow / pool.length);
      const name =
        gen === 0
          ? who.name
          : ascii
            ? `${who.name} ${gen + 1}`
            : `${who.name}${gen + 1}`;
      overflow += 1;
      if (usedNames.has(name)) continue;
      const id = `npc_pad_pool_${overflow}_${name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, '_').slice(0, 18)}`;
      if (next.entities.some((e) => e.id === id)) continue;
      const regions = next.space.regions;
      const regionId = regions[npcCount % regions.length]?.id ?? start;
      const regionName =
        regions.find((r) => r.id === regionId)?.name ?? regionId;
      const areas = next.space.areas ?? [];
      const workArea =
        areas.find((a) => a.regionId === regionId) ?? areas[0];
      const restRegion = regions[regions.length - 1];
      const homeArea =
        areas.find((a) => a.regionId === restRegion?.id) ?? workArea;
      const others = next.entities.filter((e) => e.kind === 'npc');
      const buddy = others[npcCount % Math.max(1, others.length)];
      const occupation =
        occupationForPlace(regionName) ??
        defaultOccupation(packProfile.id, ascii);
      const card = stanceCardFor(name, occupation, npcCount, ascii);
      const prose = npcProse({
        ascii,
        packId: packProfile.id,
        name,
        trait: who.traits[0] ?? occupation,
        occupation,
        place: regionName,
        hub,
      });
      const initialRelations: Record<string, string> = {};
      if (buddy && buddy.id !== id) {
        initialRelations[buddy.id] = ascii
          ? `knows ${buddy.name}`
          : `认得${buddy.name}`;
      }
      next = parseWorldSpec({
        ...next,
        entities: [
          ...next.entities,
          {
            id,
            kind: 'npc',
            name,
            regionId,
            pos: { x: 3 + (npcCount % 8), y: 4 + (npcCount % 6) },
            personality: loc(prose.personality),
            dialogueSeed: loc(prose.dialogueSeed),
            identity: {
              displayName: name,
              age: 20 + ((npcCount * 7) % 40),
              occupation,
              traits: [...who.traits],
              backstory: loc(prose.backstory),
              initialRelations,
              homeAreaId: homeArea?.id,
              workAreaId: workArea?.id,
              secret: card.secret,
              stance: card.stance,
            },
            attrs: { role: occupation },
            inventory: [],
            spriteKey: ascii ? '🙂' : '🧑',
            schedule: [
              {
                hour: 9,
                regionId,
                activity: placeActivity(loc(prose.morning), regionName, ascii),
              },
              {
                hour: 18,
                regionId: start,
                activity: placeActivity(loc(prose.evening), hub, ascii),
              },
            ],
            tags: ['padded'],
          },
        ],
        relations: [
          ...next.relations,
          ...(buddy && buddy.id !== id
            ? [
                {
                  id: `rel_${id}_${buddy.id}`,
                  from: id,
                  to: buddy.id,
                  type: 'knows' as const,
                  strength: 0.3,
                  meta: { label: ascii ? 'knows' : '相识' },
                },
              ]
            : []),
        ],
      });
      npcCount += 1;
      usedNames.add(name);
      padded = true;
    }
    if (targetNpcs != null && npcCount > targetNpcs) {
      const trimmed = trimSocietyNpcs(next, targetNpcs);
      if (trimmed !== next) {
        next = trimmed;
        padded = true;
      }
    }
  } else {
    if (next.entities.filter((e) => e.kind === 'enemy').length < 1) {
      const regionId =
        next.space.regions.find((r) => r.kind !== 'town')?.id ??
        next.space.regions[0]!.id;
      next = parseWorldSpec({
        ...next,
        entities: [
          ...next.entities,
          {
            id: 'enemy_pad_threat',
            kind: 'enemy',
            name: 'Lurking Threat',
            regionId,
            pos: { x: 6, y: 6 },
            attrs: { hp: 6, atk: 2 },
            inventory: [],
            spriteKey: '💀',
            tags: ['padded'],
          },
        ],
      });
      padded = true;
    }

    if (next.narrative.quests.length < 2) {
      const qid = 'q_pad_explore';
      next = parseWorldSpec({
        ...next,
        narrative: {
          ...next.narrative,
          flags: { ...next.narrative.flags, pad_explore_done: false },
          quests: [
            ...next.narrative.quests,
            {
              id: qid,
              title: 'Chart the Frontier',
              description: 'Visit every region and return safely.',
              status: 'available',
              steps: [
                {
                  id: 'mark',
                  description: 'Set exploration flag',
                  when: { op: 'flag', flag: 'pad_explore_done', equals: true },
                  then: [{ kind: 'complete_quest', questId: qid }],
                },
              ],
              onComplete: [
                { kind: 'set_flag', flag: 'frontier_mapped', value: true },
              ],
            },
          ],
        },
        rules: [
          ...next.rules,
          {
            id: 'rule_pad_explore',
            name: 'Enter frontier marks explore quest',
            when: {
              op: 'flag',
              flag: 'entered_frontier',
              equals: true,
            },
            then: [
              { kind: 'set_flag', flag: 'pad_explore_done', value: true },
              { kind: 'start_quest', questId: qid },
            ],
            once: true,
            priority: 3,
          },
        ],
      });
      padded = true;
    }
  }

  if (mode === 'society') {
    const areaPad = padSocietyAreas(next);
    next = areaPad.world;
    if (areaPad.padded) padded = true;
    const placed = stampResidentPlaces(next);
    if (placed !== next) {
      next = placed;
      padded = true;
    }
  }

  if (next.rules.length < 2) {
    next = parseWorldSpec({
      ...next,
      rules: [
        ...next.rules,
        {
          id: 'rule_pad_ambient',
          name: 'Ambient society tick',
          when: { op: 'always' },
          then: [{ kind: 'set_flag', flag: 'world_alive', value: true }],
          once: true,
          priority: 0,
        },
      ],
    });
    padded = true;
  }

  if (!next.presentation.narrativeSeed) {
    next = parseWorldSpec({
      ...next,
      presentation: {
        ...next.presentation,
        narrativeSeed: next.meta.id,
      },
    });
  }

  if (mode === 'society' && profile) {
    const stamped =
      options.populationHint != null
        ? genreProfileWithPopulation(profile, options.populationHint)
        : profile;
    const current = next.presentation.genreProfile;
    const popChanged =
      current?.population?.min !== stamped.population.min ||
      current?.population?.max !== stamped.population.max;
    if (!current?.id || current.id !== stamped.id || popChanged) {
      next = parseWorldSpec({
        ...next,
        presentation: {
          ...next.presentation,
          genreProfile: stamped,
        },
      });
    }
  }

  if (mode === 'society') {
    const withCards = stampMissingStanceCards(next);
    if (withCards !== next) {
      next = withCards;
      padded = true;
    }
    const withRumor = stampOpeningRumor(next);
    if (withRumor !== next) {
      next = withRumor;
      padded = true;
    }
  }

  const after = measureWorldDepth(next);
  return { world: next, padded, before, after, addedRegionIds };
}
