/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Structured world-create brief from the studio — pack and venues win over
 * prompt keyword guessing.
 */

export type WorldBriefInput = {
  readonly packId?: string | null;
  readonly useCase?: string | null;
  readonly venues?: readonly string[] | null;
  readonly scale?: string | null;
  readonly livedIn?: string | null;
  readonly note?: string | null;
};

export type SocietyPackId = 'society.town' | 'society.crew' | 'society.cloister';

const SOCIETY_PACK_IDS = new Set<string>([
  'society.town',
  'society.crew',
  'society.cloister',
]);

/** Venue ids from the web create brief → planner place labels (zh). */
const BRIEF_VENUE_ZH: Readonly<Record<string, string>> = {
  night_market: '夜市',
  wharf: '码头',
  kiln: '窑场',
  school: '学堂',
  mine: '矿坑',
  workshop: '作坊',
  inn: '客栈',
  teahouse: '茶馆',
  herb_hut: '药庐',
  hunting_ground: '猎场',
  coop: '鸡舍',
  bridge: '舰桥',
  greenhouse: '温室舱',
  sleep_bay: '休眠舱',
  chapel: '礼拜堂',
  scriptorium: '抄经房',
  garden: '菜园',
};

export function normalizeWorldBrief(brief?: WorldBriefInput | null): {
  readonly packId?: SocietyPackId;
  readonly places: readonly string[];
} {
  if (!brief) return { places: [] };
  const packId = SOCIETY_PACK_IDS.has(brief.packId ?? '')
    ? (brief.packId as SocietyPackId)
    : undefined;
  const places = [
    ...new Set(
      (brief.venues ?? [])
        .map((id) => BRIEF_VENUE_ZH[id] ?? String(id).trim())
        .filter((p) => p.length >= 2),
    ),
  ].slice(0, 6);
  return {
    ...(packId ? { packId } : {}),
    places,
  };
}
