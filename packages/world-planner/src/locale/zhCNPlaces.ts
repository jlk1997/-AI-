/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * zh-CN place bags for Intent IR. Not the compiler core — a locale pack.
 */

export const PLACE_PROMISE_RULES: ReadonlyArray<{
  readonly re: RegExp;
  readonly places: readonly string[];
}> = [
  { re: /渔|码头|船埠|港湾|渔村|晒网/, places: ['码头', '船坞', '晒网场'] },
  { re: /矿窑|选矿|灯房|矿镇|窑火|煤窑/, places: ['矿窑', '选矿棚', '灯房'] },
  { re: /夜市|夜摊|夜食|灯笼巷/, places: ['夜市', '烤串棚', '灯笼巷'] },
  { re: /夜校|私塾|学堂/, places: ['夜校', '粉笔房'] },
  { re: /茶馆|茶摊|茶座|茶博士|棋桌/, places: ['茶馆', '棋桌'] },
  { re: /盐田|盐仓|晒盐|卤水/, places: ['盐田', '盐仓'] },
  { re: /竹棚|篾坊|竹市|砍竹|篾匠/, places: ['竹棚', '篾坊'] },
  { re: /牧场|羊圈|马场|马厩/, places: ['牧场', '马厩'] },
  { re: /庙宇|香案|香火|庙祝|寺庙|寺院/, places: ['庙宇', '香案'] },
  { re: /渡口|河埠|摆渡/, places: ['渡口', '河埠'] },
  { re: /药庐|猎场|祭坛|草药|守夜|迷雾/, places: ['药庐', '猎场', '祭坛'] },
  { re: /补给帐|情报棚|营火|营地社会|外围营地/, places: ['补给帐', '情报棚', '营火圈'] },
  { re: /空间站|舰桥|休眠舱|温室舱/, places: ['舰桥', '温室', '休眠舱'] },
  { re: /货船|运河船|船长|水手/, places: ['甲板', '船舱', '厨舱'] },
  { re: /修道院|礼拜堂|抄经|日课/, places: ['礼拜堂', '抄经房', '菜园'] },
];

export const FALLBACK_PLACE_BAGS: ReadonlyArray<readonly string[]> = [
  ['码头', '船坞', '晒网场'],
  ['矿窑', '选矿棚', '灯房'],
  ['夜市', '烤串棚', '灯笼巷'],
  ['茶馆', '棋桌', '点心铺'],
  ['盐田', '盐仓', '田埂路'],
  ['竹棚', '篾坊', '竹市'],
  ['牧场', '马厩', '草料棚'],
  ['庙宇', '香案', '钟楼'],
  ['渡口', '河埠', '候船棚'],
  ['夜校', '粉笔房', '院子'],
];

export const PLACE_OCCUPATIONS: Readonly<Record<string, string>> = {
  码头: '渔民',
  船坞: '船匠',
  晒网场: '补网人',
  矿窑: '窑工',
  选矿棚: '选矿工',
  灯房: '矿灯看守',
  夜市: '夜摊主',
  烤串棚: '夜食师傅',
  灯笼巷: '灯笼匠',
  夜校: '夜校先生',
  粉笔房: '塾师',
  茶馆: '茶博士',
  棋桌: '茶馆管事',
  盐田: '盐工',
  盐仓: '盐仓管事',
  竹棚: '篾匠',
  篾坊: '竹器师傅',
  牧场: '牧人',
  马厩: '马夫',
  庙宇: '香火看守',
  香案: '司香',
  渡口: '渡工',
  河埠: '河埠搬运',
  药庐: '采药人',
  猎场: '猎户',
  祭坛: '祭坛守望',
  补给帐: '补给商',
  情报棚: '情报掮客',
  营火圈: '营火看守',
  舰桥: '值班官',
  温室: '园丁',
  休眠舱: '舱务员',
  甲板: '水手',
  船舱: '水手长',
  厨舱: '厨子',
  礼拜堂: '司仪',
  抄经房: '抄经人',
  菜园: '园丁',
  走廊: '值班员',
  气闸: '闸员',
  回廊: '巡廊人',
  禅房: '修士',
  巷口: '看巷人',
  井边: '打水人',
};

export const PLACE_SLUGS: Readonly<Record<string, string>> = {
  码头: 'dock',
  船坞: 'boat_yard',
  晒网场: 'net_yard',
  矿窑: 'kiln',
  选矿棚: 'ore_shed',
  灯房: 'lamp_house',
  夜市: 'night_market',
  烤串棚: 'grill_shed',
  灯笼巷: 'lantern_lane',
  夜校: 'night_school',
  粉笔房: 'chalk_room',
  茶馆: 'tea_house',
  棋桌: 'chess_table',
  点心铺: 'pastry_shop',
  盐田: 'salt_field',
  盐仓: 'salt_barn',
  田埂路: 'ridge_path',
  竹棚: 'bamboo_shed',
  篾坊: 'weaving_shop',
  竹市: 'bamboo_market',
  牧场: 'pasture',
  马厩: 'stable',
  草料棚: 'hay_shed',
  庙宇: 'temple',
  香案: 'incense_altar',
  钟楼: 'bell_tower',
  渡口: 'ferry',
  河埠: 'wharf',
  候船棚: 'waiting_shed',
  药庐: 'herb_hut',
  猎场: 'hunt_ground',
  祭坛: 'grove_altar',
  补给帐: 'supply_tent',
  情报棚: 'intel_shed',
  营火圈: 'campfire',
  舰桥: 'bridge',
  温室: 'greenhouse',
  休眠舱: 'sleep_bay',
  甲板: 'deck',
  船舱: 'cabin',
  厨舱: 'galley',
  礼拜堂: 'chapel',
  抄经房: 'scriptorium',
  菜园: 'garden',
  院子: 'yard',
  走廊: 'corridor',
  气闸: 'lock',
  回廊: 'cloister_walk',
  禅房: 'cells',
  巷口: 'alley',
  井边: 'well',
  辅舱: 'side_bay',
  侧廊: 'side_walk',
  侧巷: 'side_alley',
};

export function hashPrompt(prompt: string): number {
  let h = 0;
  for (let i = 0; i < prompt.length; i++) {
    h = (Math.imul(h, 31) + prompt.charCodeAt(i)) | 0;
  }
  return h;
}

export function extractPlacePromises(prompt: string): string[] {
  const out: string[] = [];
  for (const rule of PLACE_PROMISE_RULES) {
    if (rule.re.test(prompt)) out.push(...rule.places);
  }
  const unique = [...new Set(out)].slice(0, 6);
  if (unique.length) return unique;
  if (
    /世界|小镇|村庄|社会|居民|聚落|营地|town|village|society|observ/i.test(
      prompt,
    )
  ) {
    const bag =
      FALLBACK_PLACE_BAGS[
        Math.abs(hashPrompt(prompt)) % FALLBACK_PLACE_BAGS.length
      ]!;
    return [...bag];
  }
  return [];
}
