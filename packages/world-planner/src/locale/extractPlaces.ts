/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Combine locale packs + quoted / listed place promises.
 * Compiler core stays pack-agnostic; this file is the locale facade.
 */

import {
  EN_FALLBACK_PLACE_BAGS,
  EN_PLACE_OCCUPATIONS,
  EN_PLACE_PROMISE_RULES,
  EN_PLACE_SLUGS,
} from './enUSPlaces.js';
import {
  FALLBACK_PLACE_BAGS,
  hashPrompt,
  PLACE_OCCUPATIONS as ZH_OCCUPATIONS,
  PLACE_PROMISE_RULES,
  PLACE_SLUGS as ZH_SLUGS,
} from './zhCNPlaces.js';

export const PLACE_OCCUPATIONS: Readonly<Record<string, string>> = {
  ...ZH_OCCUPATIONS,
  ...EN_PLACE_OCCUPATIONS,
};

export const PLACE_SLUGS: Readonly<Record<string, string>> = {
  ...ZH_SLUGS,
  ...EN_PLACE_SLUGS,
};

function matchRules(
  rules: ReadonlyArray<{ readonly re: RegExp; readonly places: readonly string[] }>,
  prompt: string,
): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    if (rule.re.test(prompt)) out.push(...rule.places);
  }
  return out;
}

function extractQuotedPlaces(prompt: string): string[] {
  const out: string[] = [];
  const re = /[「『""]([^」』""]{2,16})[」』""]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) {
    const s = m[1]!.trim();
    if (s && !/必须|include|contain|places?/i.test(s)) out.push(s);
  }
  return out;
}

function extractListedPlaces(prompt: string): string[] {
  const zh = prompt.match(/场所必须包含([^。.\n]+)/);
  const en = prompt.match(
    /places?\s+(?:must\s+)?(?:include|contain)\s+([^.\n]+)/i,
  );
  const chunk = zh?.[1] ?? en?.[1];
  if (!chunk) return [];
  return chunk
    .split(/[、,，]|\band\b/i)
    .map((s) => s.replace(/^[\s"'「『]+|[\s"'」』]+$/g, '').trim())
    .filter((s) => s.length >= 2 && s.length <= 24 && !/^and$/i.test(s));
}

export function isMostlyAsciiText(text: string): boolean {
  const letters = text.replace(/\s/g, '');
  if (!letters.length) return false;
  const ascii = letters.replace(/[^\x00-\x7F]/g, '').length;
  return ascii / letters.length >= 0.85;
}

function isSocietyLike(prompt: string): boolean {
  return /世界|小镇|村庄|社会|居民|聚落|营地|船员|货船|修道院|town|village|society|observ|station|ship|crew|vessel|cargo|monastery|cloister|abbey/i.test(
    prompt,
  );
}

/** Region/area name covers a prompt place (case-insensitive, either contains). */
export function coversPromisedPlace(name: string, place: string): boolean {
  const a = name.trim().toLowerCase();
  const b = place.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || (b.length >= 2 && a.includes(b)) || (a.length >= 2 && b.includes(a));
}

/** Synonyms so 「庙门广场」 fulfills 庙宇 and "Temple" fulfills temple. */
const PLACE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  庙宇: ['寺庙', '寺院', '庙门', '庙堂', '大雄', '香火庙', 'temple', 'shrine', 'pagoda'],
  香案: ['香台', '香炉', '上香', 'incense', 'altar'],
  钟楼: ['鼓楼', 'bell tower', 'belltower'],
  斋堂: ['膳堂', '斋饭', 'refectory'],
  码头: ['dock', 'harbor', 'harbour', 'wharf', 'pier', '港湾', '船埠'],
  船坞: ['boatyard', 'boat yard', '船厂'],
  矿窑: ['kiln', '窑火', '矿井', '矿坑', '煤窑', '竖井', '巷道'],
  选矿棚: ['选矿场', '选矿屋', 'ore shed', 'sorting shed'],
  灯房: ['矿灯房', '灯油房', 'lamp house', 'lamp room'],
  夜市: ['night market'],
  窑场: ['矿窑', '窑火', 'kiln'],
  学堂: ['学堂院', 'school', 'schoolyard'],
  作坊: ['工坊', 'workshop', 'forge'],
  客栈: ['旅店', '客栈巷', 'inn'],
  茶馆: ['茶楼', 'teahouse', 'tea house'],
  药庐: ['药铺', 'herb hut'],
  猎场: ['猎户场', 'hunting ground'],
  温室舱: ['温室', 'greenhouse'],
  休眠舱: ['sleep bay', 'sleeping bay'],
  抄经房: ['scriptorium'],
  菜园: ['园圃', 'garden'],
  chapel: ['礼拜堂', 'vespers'],
  礼拜堂: ['chapel'],
  舰桥: ['bridge'],
  bridge: ['舰桥'],
};

const OCCUPATION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  香火看守: ['庙祝', '看香', '守庙', 'temple keeper'],
  司香: ['上香', '香炉'],
  渔民: ['fisher', 'fisherman'],
  船匠: ['shipwright', 'boatwright'],
  窑工: ['kiln hand', 'kilnman', '矿工', '挖矿'],
  选矿工: ['选矿', '分拣工', 'ore sorter'],
  矿灯看守: ['灯房看守', '灯房师傅', '看灯', 'lamp keeper'],
};

function aliasesFor(
  table: Readonly<Record<string, readonly string[]>>,
  key: string,
): readonly string[] {
  const k = key.trim();
  return table[k] ?? table[k.toLowerCase()] ?? [];
}

/** Place coverage that accepts locale synonyms and slug ids. */
export function coversPromisedPlaceLoose(name: string, place: string): boolean {
  if (coversPromisedPlace(name, place)) return true;
  for (const alias of aliasesFor(PLACE_ALIASES, place)) {
    if (coversPromisedPlace(name, alias)) return true;
  }
  const slug = PLACE_SLUGS[place] ?? PLACE_SLUGS[place.toLowerCase()];
  if (slug) {
    const spaced = slug.replace(/_/g, ' ');
    if (coversPromisedPlace(name, slug) || coversPromisedPlace(name, spaced)) {
      return true;
    }
    if (coversPromisedPlace(name.replace(/_/g, ' '), spaced)) return true;
  }
  return false;
}

/** Occupation coverage that accepts close job titles (庙祝 ≈ 香火看守). */
export function coversPromisedOccupation(blob: string, occupation: string): boolean {
  const occ = occupation.trim();
  if (!occ) return false;
  if (
    coversPromisedPlace(blob, occ) ||
    blob.toLowerCase().includes(occ.toLowerCase())
  ) {
    return true;
  }
  for (const alias of aliasesFor(OCCUPATION_ALIASES, occ)) {
    if (
      coversPromisedPlace(blob, alias) ||
      blob.toLowerCase().includes(alias.toLowerCase())
    ) {
      return true;
    }
  }
  return false;
}

export function occupationForPlace(place: string): string | undefined {
  return PLACE_OCCUPATIONS[place] ?? PLACE_OCCUPATIONS[place.toLowerCase()];
}

export function extractPlacePromises(
  prompt: string,
  packId?: 'society.town' | 'society.crew' | 'society.cloister',
): string[] {
  const out = [
    ...extractQuotedPlaces(prompt),
    ...extractListedPlaces(prompt),
    ...matchRules(PLACE_PROMISE_RULES, prompt),
    ...matchRules(EN_PLACE_PROMISE_RULES, prompt),
  ];
  const unique = [...new Set(out)].slice(0, 6);
  if (unique.length) return unique;
  if (!isSocietyLike(prompt)) return [];
  const ascii = isMostlyAsciiText(prompt);
  if (packId === 'society.crew') {
    if (
      /cargo.?ship|货船|甲板|\bgalley\b|\bvessel\b/i.test(prompt) &&
      !/space.?station|空间站|starship/i.test(prompt)
    ) {
      return ascii ? ['deck', 'cabin', 'galley'] : ['甲板', '船舱', '厨舱'];
    }
    return ascii ? ['bridge', 'greenhouse', 'sleep bay'] : ['舰桥', '温室', '休眠舱'];
  }
  if (packId === 'society.cloister') {
    return ascii
      ? ['chapel', 'scriptorium', 'garden']
      : ['礼拜堂', '抄经房', '菜园'];
  }
  const bags = ascii ? EN_FALLBACK_PLACE_BAGS : FALLBACK_PLACE_BAGS;
  const bag = bags[Math.abs(hashPrompt(prompt)) % bags.length]!;
  return [...bag];
}
