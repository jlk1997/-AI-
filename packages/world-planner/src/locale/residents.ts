/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pack + locale identity for synthesized societies. Not the compiler core.
 */

export type ResidentSeed = {
  readonly name: string;
  readonly traits: readonly string[];
};

const TOWN_ZH: readonly ResidentSeed[] = [
  { name: '阿禾', traits: ['早起', '记路'] },
  { name: '林嫂', traits: ['嘴快', '热心'] },
  { name: '老周', traits: ['慢条斯理', '认账'] },
  { name: '小荷', traits: ['脚快', '藏不住话'] },
  { name: '铁柱', traits: ['手劲大', '少言'] },
  { name: '桂花', traits: ['记性好', '爱张罗'] },
  { name: '石头', traits: ['认脚印', '夜里精神'] },
  { name: '春妮', traits: ['手巧', '爱把东西分人'] },
  { name: '福伯', traits: ['起得早', '敲梆子'] },
  { name: '二兰', traits: ['算得清', '不爱欠'] },
  { name: '茂才', traits: ['爱记事', '话少'] },
  { name: '巧手', traits: ['线不断', '眼尖'] },
  { name: '阿麦', traits: ['送信勤', '怕送错门'] },
  { name: '苏大夫', traits: ['听脉', '药苦也劝人喝'] },
  { name: '陈叔', traits: ['记账', '不漏秤'] },
  { name: '玛拉', traits: ['烤得香', '夜里还醒着'] },
  { name: '白衣', traits: ['衣襟干净', '话轻'] },
  { name: '小满', traits: ['爱凑热闹', '腿勤'] },
  { name: '织娘', traits: ['梭子响', '记谁家缺布'] },
  { name: '老陈', traits: ['烟袋不离手', '听完才答'] },
  { name: '阿六', traits: ['睡得沉', '醒了就找人说话'] },
  { name: '芸姐', traits: ['问诊细', '记得谁咳过'] },
];

const TOWN_EN: readonly ResidentSeed[] = [
  { name: 'Ada', traits: ['early-rising', 'keeps paths'] },
  { name: 'Bo', traits: ['quick-tongued', 'warm'] },
  { name: 'Cora', traits: ['unhurried', 'keeps accounts'] },
  { name: 'Nell', traits: ['fast on her feet', 'cannot keep a secret'] },
  { name: 'Bram', traits: ['strong-handed', 'few words'] },
  { name: 'Mae', traits: ['remembers names', 'likes to organize'] },
  { name: 'Reed', traits: ['reads tracks', 'awake at night'] },
  { name: 'Lila', traits: ['clever hands', 'shares what she has'] },
  { name: 'Hob', traits: ['up before dawn', 'keeps the bell'] },
  { name: 'Tess', traits: ['counts fair', 'hates a debt'] },
  { name: 'Owen', traits: ['writes things down', 'quiet'] },
  { name: 'Iris', traits: ['steady stitch', 'sharp eyes'] },
  { name: 'Pip', traits: ['runs letters', 'afraid of the wrong door'] },
  { name: 'Wren', traits: ['listens to pulses', 'makes you take the bitter cup'] },
  { name: 'Cal', traits: ['keeps the ledger', 'never shorts the scale'] },
  { name: 'Mara', traits: ['bakes warm', 'still up at night'] },
  { name: 'Jon', traits: ['keeps a clean collar', 'soft voice'] },
  { name: 'Kit', traits: ['loves a crowd', 'always walking'] },
  { name: 'Sable', traits: ['loom-steady', 'notices who lacks cloth'] },
  { name: 'Ned', traits: ['pipe in hand', 'answers last'] },
  { name: 'Rue', traits: ['sleeps hard', 'talks as soon as she wakes'] },
  { name: 'Vera', traits: ['careful questions', 'remembers who coughed'] },
];

const CREW_ZH: readonly ResidentSeed[] = [
  { name: '沈班', traits: ['记班表', '少言'] },
  { name: '阿舱', traits: ['认铺位', '夜里还醒'] },
  { name: '桂厨', traits: ['分餐公平', '闻得出焦味'] },
  { name: '通管', traits: ['听得清杂音', '不漏报'] },
  { name: '园丁', traits: ['认叶片', '手不闲'] },
  { name: '轮机', traits: ['听轴承', '手上有油'] },
  { name: '医官', traits: ['问得细', '夜班也开门'] },
  { name: '舵手', traits: ['认航向', '话短'] },
  { name: '闸员', traits: ['锁门严', '记谁晚归'] },
  { name: '货记', traits: ['不漏箱', '爱对账'] },
  { name: '水工', traits: ['修得快', '不抱怨'] },
  { name: '班副', traits: ['催班准时', '口袋里总有笔'] },
];

const CREW_EN: readonly ResidentSeed[] = [
  { name: 'Vega', traits: ['keeps the roster', 'few words'] },
  { name: 'Nils', traits: ['knows every bunk', 'awake on night watch'] },
  { name: 'Mara', traits: ['splits rations fair', 'smells a burn'] },
  { name: 'Tess', traits: ['hears static', 'never skips a log'] },
  { name: 'Ivo', traits: ['reads leaves', 'hands always busy'] },
  { name: 'Gunn', traits: ['hears bearings', 'oil on the cuffs'] },
  { name: 'Sera', traits: ['asks carefully', 'opens the bay at night'] },
  { name: 'Pike', traits: ['holds heading', 'short answers'] },
  { name: 'Locke', traits: ['seals the hatch', 'notes who is late'] },
  { name: 'Quinn', traits: ['counts crates', 'loves a checklist'] },
  { name: 'Rook', traits: ['fixes fast', 'does not complain'] },
  { name: 'Wren', traits: ['on time', 'always has a stub of pencil'] },
];

const CLOISTER_ZH: readonly ResidentSeed[] = [
  { name: '清远', traits: ['记日课', '步子轻'] },
  { name: '慧心', traits: ['字不潦草', '夜里还抄'] },
  { name: '园叟', traits: ['认土味', '手不闲'] },
  { name: '膳头', traits: ['分粥公平', '不浪费'] },
  { name: '守钟', traits: ['敲得准', '耳尖'] },
  { name: '司香', traits: ['衣襟干净', '话轻'] },
  { name: '门者', traits: ['认脚步', '不拦急信'] },
  { name: '装订', traits: ['线不断', '爱护旧纸'] },
  { name: '药圃', traits: ['认药草', '怕霜'] },
  { name: '洒扫', traits: ['起得早', '廊要干'] },
  { name: '诵者', traits: ['记经文', '不抢话'] },
  { name: '执事', traits: ['安排座位', '劝架轻声'] },
];

const CLOISTER_EN: readonly ResidentSeed[] = [
  { name: 'Cal', traits: ['keeps the hours', 'soft step'] },
  { name: 'Wren', traits: ['writes a fair hand', 'copies after dark'] },
  { name: 'Bram', traits: ['reads soil', 'hands never idle'] },
  { name: 'Nell', traits: ['splits porridge fair', 'hates waste'] },
  { name: 'Hob', traits: ['rings true', 'sharp ears'] },
  { name: 'Iris', traits: ['keeps a clean collar', 'soft voice'] },
  { name: 'Owen', traits: ['knows footsteps', 'never stops an urgent letter'] },
  { name: 'Sable', traits: ['thread that holds', 'guards old paper'] },
  { name: 'Rue', traits: ['knows herbs', 'fears frost'] },
  { name: 'Kit', traits: ['up before dawn', 'keeps the walk dry'] },
  { name: 'Vera', traits: ['knows the verses', 'does not interrupt'] },
  { name: 'Jon', traits: ['sets the seats', 'settles quarrels quietly'] },
];

export function residentPool(
  packId: string,
  ascii: boolean,
): readonly ResidentSeed[] {
  if (packId === 'society.crew') return ascii ? CREW_EN : CREW_ZH;
  if (packId === 'society.cloister') return ascii ? CLOISTER_EN : CLOISTER_ZH;
  return ascii ? TOWN_EN : TOWN_ZH;
}

export function fillerPlacesFor(
  packId: string,
  ascii: boolean,
): readonly string[] {
  if (packId === 'society.crew') {
    return ascii ? ['corridor', 'lock'] : ['走廊', '气闸'];
  }
  if (packId === 'society.cloister') {
    return ascii ? ['cloister walk', 'cells'] : ['回廊', '禅房'];
  }
  return ascii ? ['alley', 'well', 'arcade'] : ['巷口', '井边', '回廊'];
}

export function emptyPlacesFor(
  packId: string,
  ascii: boolean,
): readonly string[] {
  if (packId === 'society.crew') {
    return ascii ? ['bridge', 'sleep bay'] : ['舰桥', '休眠舱'];
  }
  if (packId === 'society.cloister') {
    return ascii ? ['chapel', 'scriptorium', 'garden'] : ['礼拜堂', '抄经房', '菜园'];
  }
  return ascii ? ['gathering', 'workshop', 'quarters'] : ['集会场', '作坊', '住处'];
}

export function defaultOccupation(packId: string, ascii: boolean): string {
  if (packId === 'society.crew') return ascii ? 'crew' : '船员';
  if (packId === 'society.cloister') return ascii ? 'resident' : '修士';
  return ascii ? 'resident' : '居民';
}

export function npcProse(input: {
  readonly ascii: boolean;
  readonly packId: string;
  readonly name: string;
  readonly trait: string;
  readonly occupation: string;
  readonly place: string;
  readonly hub: string;
}): {
  readonly personality: string;
  readonly dialogueSeed: string;
  readonly backstory: string;
  readonly morning: string;
  readonly evening: string;
} {
  const { ascii, packId, name, trait, occupation, place, hub } = input;
  if (ascii) {
    const evening =
      packId === 'society.crew'
        ? `hands off the watch at ${hub}`
        : packId === 'society.cloister'
          ? `meets after hours at ${hub}`
          : `meets people at ${hub}`;
    return {
      personality: `${trait} ${occupation}`,
      dialogueSeed: `At ${place} I saw something I have not told the others.`,
      backstory: `${name} works at ${place}. Learned the trade young and still keeps ${trait} as a promise. Yesterday at ${place} they saw a thing they have not told anyone.`,
      morning: `works at ${place}`,
      evening,
    };
  }
  const evening =
    packId === 'society.crew'
      ? `在${hub}交班`
      : packId === 'society.cloister'
        ? `在${hub}晚课前后碰面`
        : `在${hub}跟人碰面`;
  return {
    personality: `${trait}的${occupation}`,
    dialogueSeed: `昨天在${place}看见一件还没对旁人说的事。`,
    backstory: `${name}在${place}干活。小时候跟家里人学过这门手艺，如今认${trait}这份交情。昨天在${place}看见一件还没对旁人说的事。`,
    morning: `在${place}干活`,
    evening,
  };
}

export function societyMetaCopy(
  packId: string,
  ascii: boolean,
  places: readonly string[],
): {
  readonly summary: string;
  readonly mood: string;
  readonly playerName: string;
  readonly talked: string;
  readonly passed: string;
  readonly knows: string;
} {
  const mood =
    packId === 'society.crew'
      ? ascii
        ? 'watch rotations'
        : '值班日常'
      : packId === 'society.cloister'
        ? ascii
          ? 'quiet hours'
          : '日课清修'
        : ascii
          ? 'everyday life'
          : '温馨日常';
  return {
    summary: ascii
      ? `An observable society around ${places.join(', ')}.`
      : `${places.join('、')}的可观察社会。`,
    mood,
    playerName: ascii ? 'Observer' : '观察者',
    talked: ascii
      ? `voices still drop near ${places[0] ?? 'here'}`
      : `${places[0] ?? '这边'}那边还有人压低声音`,
    passed: ascii
      ? `footprints still wet at ${places[0] ?? 'here'}`
      : `${places[0] ?? '这边'}的脚印还没干`,
    knows: ascii ? 'knows from the same place' : '同区相识',
  };
}
