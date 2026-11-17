/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * World Spec content gate — mirrors gameQualityGate for world_generate.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { GenreProfile, WorldSpec } from '@opengame/world-spec';
import {
  anonymousLeadName,
  isConcreteWorldCue,
  isGenericGatheringLine,
  isScaffoldTownRegionId,
  openingRumorFromSpec,
  resolveGenreProfile,
  spatialSlotPlayable,
} from '@opengame/world-spec';
import {
  coversPromisedPlaceLoose,
  coversPromisedOccupation,
  coversPromisedResident,
} from '@opengame/world-planner';
import { probeWorldPlayability } from '@opengame/world-sim';

import {
  probeAudioBuffer,
  probePngBuffer,
  readAssetBriefQuality,
  requireRealAssets,
} from './assetAuthenticity.js';

export interface WorldQualityResult {
  readonly ok: boolean;
  readonly issues: string[];
  readonly metrics: {
    readonly regions: number;
    readonly quests: number;
    readonly rules: number;
    readonly enemies: number;
    readonly npcs: number;
    readonly authoredNpcs?: number;
    readonly paddedNpcs?: number;
    readonly questsStartedInProbe?: number;
    readonly questsCompletedInProbe?: number;
  };
}

export interface WorldQualityGateOptions {
  readonly minRegions?: number;
  readonly minQuests?: number;
  readonly minNpcs?: number;
  readonly requirePressure?: boolean;
  /** L2-β: run playability probe (default true when minQuests>0). */
  readonly probePlayability?: boolean;
  /** When set, verify MiniMax assets on disk under public/assets. */
  readonly workspace?: string;
  /** Society World product path — no quest/enemy pressure. */
  readonly societyFirst?: boolean;
  /** Pack intervals; missing + societyFirst = society.town. */
  readonly profile?: GenreProfile;
  /** Prompt place names that must appear on a region or area. */
  readonly placePromises?: readonly string[];
  /** Occupations implied by the prompt — at least one must appear on an NPC. */
  readonly occupationPromises?: readonly string[];
  /** Named people from the prompt — each must appear as an NPC name. */
  readonly residentPromises?: readonly { readonly name: string }[];
  /**
   * Classic Stanford-town prompts may keep town_square ids.
   * Dock/crew/cloister prompts must not.
   */
  readonly allowScaffoldTown?: boolean;
  /** Explicit headcount — gate min NPCs cannot exceed this. */
  readonly populationHint?: number;
  /** Structured create brief — named venues must appear on the Spec. */
  readonly briefPlaces?: readonly string[];
  /** Structured create brief — synthesized pack must match. */
  readonly briefPackId?: GenreProfile['id'];
  /**
   * Check L3 poster/video slots. Must stay false for the pre-asset content gate:
   * posters are produced later by the ASSET phase (assertWorldL3Playable re-checks).
   */
  readonly checkL3?: boolean;
}

/**
 * Regions the L3 gate requires a playable poster/video for.
 * Small worlds (≤5 regions) and society towns need every slot; larger RPG
 * worlds need start + padded/frontier.
 */
export function regionIdsRequiringL3Slots(world: WorldSpec): string[] {
  const must = new Set<string>([world.space.startRegionId]);
  for (const r of world.space.regions) {
    const tags = r.tags ?? [];
    if (tags.includes('padded') || tags.includes('frontier')) {
      must.add(r.id);
    }
  }
  const societyTown =
    world.presentation.narrativeSeed === 'society-gathering-observe' ||
    (world.presentation.narrativeSeed ?? '').includes('society');
  if (world.space.regions.length <= 5 || societyTown) {
    for (const r of world.space.regions) must.add(r.id);
  }
  return [...must];
}

export function runWorldQualityGate(
  world: WorldSpec,
  options: WorldQualityGateOptions = {},
): WorldQualityResult {
  const profile =
    options.profile ??
    (options.societyFirst === true ? resolveGenreProfile(world) : undefined);
  const societyFirst =
    options.societyFirst === true || Boolean(options.profile);
  const minRegions =
    options.minRegions ?? profile?.topology.minRegions ?? 3;
  const minQuests = options.minQuests ?? (societyFirst ? 0 : 2);
  const minNpcs =
    options.minNpcs ??
    (societyFirst
      ? options.populationHint != null
        ? Math.max(2, options.populationHint)
        : (profile?.population.min ?? 18)
      : 1);
  const requirePressure =
    options.requirePressure ?? (societyFirst ? false : true);
  const probePlayability =
    options.probePlayability ?? (!societyFirst && minQuests > 0);
  const issues: string[] = [];

  const regions = world.space.regions.length;
  const quests = world.narrative.quests.length;
  const rules = world.rules.length;
  const enemies = world.entities.filter((e) => e.kind === 'enemy').length;
  const npcEntities = world.entities.filter((e) => e.kind === 'npc');
  const npcs = npcEntities.length;
  const paddedNpcs = npcEntities.filter((e) =>
    (e.tags ?? []).includes('padded'),
  ).length;
  const authoredNpcs = Math.max(0, npcs - paddedNpcs);

  if (regions < minRegions) {
    issues.push(`世界过薄：需要至少 ${minRegions} 个区域（当前 ${regions}）`);
  }
  if (quests < minQuests) {
    issues.push(`世界过薄：需要至少 ${minQuests} 条任务线（当前 ${quests}）`);
  }
  if (rules < 2) {
    issues.push(`世界过薄：需要至少 2 条规则（当前 ${rules}）`);
  }
  if (npcs < minNpcs) {
    issues.push(`至少需要 ${minNpcs} 个 NPC（当前 ${npcs}）`);
  }

  if (societyFirst) {
    const areas = world.space.areas ?? [];
    const covered = new Set(areas.map((a) => a.regionId));
    for (const r of world.space.regions) {
      if (!covered.has(r.id)) {
        issues.push(`社会世界区域 ${r.id} 缺少 space.areas（环境树）`);
      }
    }
    if (areas.some((a) => (a.objects ?? []).length === 0)) {
      issues.push('社会世界有 area 没有 objects');
    }
    const placeCovered = (place: string): boolean =>
      world.space.regions.some(
        (r) =>
          coversPromisedPlaceLoose(r.name, place) ||
          coversPromisedPlaceLoose(r.id.replace(/_/g, ' '), place),
      ) ||
      areas.some(
        (a) =>
          coversPromisedPlaceLoose(a.name, place) ||
          (a.objects ?? []).some((o) => coversPromisedPlaceLoose(o.name, place)),
      );
    const briefNamed = new Set(
      (options.briefPlaces ?? []).map((p) => p.trim()).filter(Boolean),
    );
    for (const place of options.placePromises ?? []) {
      if (!placeCovered(place)) {
        issues.push(
          briefNamed.has(place.trim())
            ? `点名场所未出现：${place}`
            : `场所承诺未覆盖：${place}`,
        );
      }
    }
    for (const place of briefNamed) {
      if ((options.placePromises ?? []).some((p) => p.trim() === place)) continue;
      if (!placeCovered(place)) {
        issues.push(`点名场所未出现：${place}`);
      }
    }
    if (options.briefPackId) {
      const actual = resolveGenreProfile(world).id;
      if (actual !== options.briefPackId) {
        issues.push(
          `简报 pack 冲突：期望 ${options.briefPackId}，得到 ${actual}`,
        );
      }
    }
    const venueFamily: ReadonlyArray<{
      readonly re: RegExp;
      readonly pack: GenreProfile['id'];
    }> = [
      {
        re: /舰桥|温室舱|休眠舱|\bbridge\b|greenhouse|sleep.?bay/i,
        pack: 'society.crew',
      },
      {
        re: /礼拜堂|抄经房|\bchapel\b|scriptorium/i,
        pack: 'society.cloister',
      },
    ];
    const expectedPack =
      options.briefPackId ??
      (options.societyFirst === true ? resolveGenreProfile(world).id : undefined);
    if (expectedPack) {
      for (const place of briefNamed) {
        const family = venueFamily.find((f) => f.re.test(place));
        if (family && family.pack !== expectedPack) {
          issues.push(
            `简报场所与 pack 冲突：${place} 属于 ${family.pack}，合成却是 ${expectedPack}`,
          );
        }
      }
    }
    const classicPlace = (options.placePromises ?? []).some((p) =>
      /城镇广场|住宅巷|学堂|斯坦福|town.?square|home.?row|stanford/i.test(p),
    );
    const allowScaffold =
      options.allowScaffoldTown === true || classicPlace;
    if (!allowScaffold && (options.placePromises ?? []).length > 0) {
      const scaffold = world.space.regions
        .filter((r) => isScaffoldTownRegionId(r.id))
        .map((r) => r.id);
      if (scaffold.length) {
        issues.push(
          `社会世界仍使用小镇脚手架区域 id：${scaffold.join(', ')}（提示不是斯坦福小镇）`,
        );
      }
    }
    const occPromises = (options.occupationPromises ?? []).filter((o) =>
      o.trim(),
    );
    if (occPromises.length) {
      const npcBlob = world.entities
        .filter((e) => e.kind === 'npc')
        .map(
          (e) =>
            `${e.name} ${e.identity?.occupation ?? ''} ${e.identity?.backstory ?? ''}`,
        )
        .join('\n');
      const hits = occPromises.filter((occ) =>
        coversPromisedOccupation(npcBlob, occ),
      );
      if (hits.length === 0) {
        issues.push(`职业承诺未覆盖：${occPromises.join('、')}`);
      }
    }
    const named = (options.residentPromises ?? []).filter((r) => r.name.trim());
    for (const who of named) {
      const hit = npcEntities.some((e) => coversPromisedResident(e.name, who.name));
      if (!hit) {
        issues.push(`点名居民未出现：${who.name}`);
      }
    }
    const plannerRoster = npcEntities.some((e) =>
      (e.tags ?? []).some((t) => t === 'authored' || t === 'padded'),
    );
    if (plannerRoster) {
      const missingCard = npcEntities
        .filter((e) => !e.identity?.secret || !e.identity?.stance)
        .map((e) => e.name);
      if (missingCard.length) {
        issues.push(`立场卡缺失：${missingCard.slice(0, 6).join('、')}`);
      }
    }
    const lead =
      npcEntities[0]?.name ?? anonymousLeadName(world);
    const rumor =
      world.presentation.openingRumor?.trim() ||
      openingRumorFromSpec(lead, world);
    if (!isConcreteWorldCue(rumor) || isGenericGatheringLine(rumor)) {
      issues.push(
        '开场传闻太空：需要一句谁/什么/在哪，不要「正在组织一场聚会」',
      );
    }
    const objectStates = areas.flatMap((a) =>
      (a.objects ?? []).map((o) => o.state ?? ''),
    );
    if (!objectStates.some((s) => isConcreteWorldCue(s))) {
      issues.push('物件状态全是套话：至少一件要留下可说的痕迹');
    }
    if (plannerRoster) {
      const secrets = npcEntities
        .map((e) => e.identity?.secret?.trim() ?? '')
        .filter((s) => s.length >= 6);
      const uniqueSecrets = new Set(secrets);
      const needSecrets = Math.min(4, npcEntities.length);
      if (uniqueSecrets.size < needSecrets) {
        issues.push(
          `秘密互相复读：需要至少 ${needSecrets} 条不同的秘密（当前 ${uniqueSecrets.size}）`,
        );
      }
      const uniqueStances = new Set(
        npcEntities
          .map((e) => e.identity?.stance?.trim() ?? '')
          .filter(Boolean),
      );
      if (npcEntities.length >= 2 && uniqueStances.size < 2) {
        issues.push('立场没有分歧：至少两种不同看法');
      }
    }
    const regionIds = new Set(world.space.regions.map((r) => r.id));
    for (const e of npcEntities) {
      if (!regionIds.has(e.regionId)) {
        issues.push(`精灵 regionId 无效：${e.name}（${e.regionId}）不在地图区域上`);
      }
      for (const slot of e.schedule ?? []) {
        if (slot.regionId && !regionIds.has(slot.regionId)) {
          issues.push(
            `日程 regionId 无效：${e.name} @ ${slot.hour}h → ${slot.regionId}`,
          );
        }
      }
    }
  }

  const hasFailQuest = world.rules.some((r) =>
    r.then.some((t) => t.kind === 'fail_quest'),
  );
  if (requirePressure && enemies < 1 && !hasFailQuest) {
    issues.push('缺少压力：至少 1 个敌人或失败态规则（fail_quest）');
  }

  if (!world.styleAnchor?.artStyle) {
    issues.push('缺少 styleAnchor.artStyle（双模式/美术耦合需要）');
  }

  if (
    process.env['WORLD_AGENTIC_ON_GENERATE'] === 'true' ||
    process.env['WORLD_AGENTIC_ON_GENERATE'] === '1'
  ) {
    if (!world.presentation.agenticDiff) {
      issues.push(
        'WORLD_AGENTIC_ON_GENERATE 要求 presentation.agenticDiff（即使 opsApplied=0，便于 L2 证据）',
      );
    }
  }

  if (
    (options.checkL3 ?? true) &&
    (world.presentation.cinematicEnabled ||
      world.presentation.spatialBackend === 'lingbot')
  ) {
    if (!world.presentation.lingbotMode) {
      issues.push('已启用 L3/cinematic 但未设置 presentation.lingbotMode');
    }
    const assets = world.presentation.spatialAssets ?? {};
    for (const id of regionIdsRequiringL3Slots(world)) {
      const slot = assets[id];
      if (!slot) {
        issues.push(
          `L3 区域=${id} 缺少 presentation.spatialAssets 槽位（扩区/pad 后须刷新海报）`,
        );
      } else if (!spatialSlotPlayable(slot)) {
        issues.push(
          `L3 区域=${id} 槽位无 videoUrl/可播 assetUrl（png/webp/mp4；禁止仅 JSON mock）`,
        );
      } else if (
        requireRealAssets() &&
        slot.assetUrl?.startsWith('data:image/png;base64,iVBORw0KGgo')
      ) {
        issues.push(
          `L3 区域=${id} 仍是 1×1/占位 data-URI — 需 MiniMax 真海报`,
        );
      }
    }
  }

  if (options.workspace && requireRealAssets()) {
    issues.push(...collectWorkspaceAssetIssues(options.workspace));
  }

  let questsStartedInProbe = 0;
  let questsCompletedInProbe = 0;
  if (probePlayability && regions >= minRegions && quests >= minQuests) {
    const probe = probeWorldPlayability(world);
    questsStartedInProbe = probe.startedQuestIds.length;
    questsCompletedInProbe = probe.completedQuestIds.length;
    issues.push(...probe.issues);
  }

  return {
    ok: issues.length === 0,
    issues,
    metrics: {
      regions,
      quests,
      rules,
      enemies,
      npcs,
      authoredNpcs,
      paddedNpcs,
      questsStartedInProbe,
      questsCompletedInProbe,
    },
  };
}

/** MiniMax images with seed-pack / Ark audio is still a real-asset run. */
function isAcceptableAssetQuality(quality: string): boolean {
  return /minimax|mixed-failover/i.test(quality);
}

function livingTownFromWorkspace(workspace: string): boolean {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(workspace, 'public', 'world.json'), 'utf8'),
    ) as {
      presentation?: { narrativeSeed?: string };
      entities?: Array<{ kind?: string }>;
    };
    if (raw.presentation?.narrativeSeed === 'society-gathering-observe') {
      return true;
    }
    const entities = raw.entities ?? [];
    const npcs = entities.filter((e) => e.kind === 'npc').length;
    const enemies = entities.filter((e) => e.kind === 'enemy').length;
    return npcs >= 8 && enemies === 0;
  } catch {
    return false;
  }
}

function collectWorkspaceAssetIssues(workspace: string): string[] {
  const issues: string[] = [];
  const quality = readAssetBriefQuality(workspace);
  if (!quality) {
    issues.push('缺少 public/ASSET_BRIEF.json（World MiniMax ASSET 阶段）');
  } else if (/procedural/i.test(quality)) {
    issues.push(
      `ASSET_BRIEF assetQuality=${quality} — 禁止 procedural 占位，须 MiniMax 真资产`,
    );
  } else if (!isAcceptableAssetQuality(quality)) {
    issues.push(
      `ASSET_BRIEF assetQuality=${quality} — 期望 minimax 或 mixed-failover（真图；音频可用种子包）`,
    );
  }

  const assetsDir = path.join(workspace, 'public', 'assets');
  const livingTown = livingTownFromWorkspace(workspace);
  const requiredPng = livingTown
    ? ['player.png', 'npc.png', 'ground.png', 'wall.png']
    : [
        'player.png',
        'npc.png',
        'enemy.png',
        'item.png',
        'ground.png',
        'wall.png',
      ];
  for (const name of requiredPng) {
    const full = path.join(assetsDir, name);
    if (!fs.existsSync(full)) {
      issues.push(`缺少世界美术 ${name}`);
      continue;
    }
    try {
      const p = probePngBuffer(fs.readFileSync(full));
      if (!p.ok) issues.push(`${name}: ${p.reason}`);
    } catch (err) {
      issues.push(
        `${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  for (const name of ['bgm.mp3', 'sfx_win.mp3', 'sfx_lose.mp3']) {
    const full = path.join(assetsDir, name);
    if (!fs.existsSync(full)) {
      issues.push(`缺少世界音频 ${name}`);
      continue;
    }
    const p = probeAudioBuffer(fs.readFileSync(full));
    if (!p.ok) issues.push(`${name}: ${p.reason}`);
  }

  // L3 spatial posters on disk must also be real (not leftover 1×1)
  const spatialDir = path.join(workspace, 'public', 'spatial');
  if (fs.existsSync(spatialDir)) {
    for (const name of fs.readdirSync(spatialDir)) {
      if (!/\.png$/i.test(name)) continue;
      const full = path.join(spatialDir, name);
      try {
        const p = probePngBuffer(fs.readFileSync(full));
        if (!p.ok) issues.push(`spatial/${name}: ${p.reason}`);
      } catch (err) {
        issues.push(
          `spatial/${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return issues;
}

export function formatWorldQualityFailureForPrompt(
  result: WorldQualityResult,
): string {
  return [
    '【世界内容门禁失败 / World quality gate】',
    ...result.issues.map((i) => `- ${i}`),
    '请通过 WorldOp / 重规划补足区域、任务、敌人、失败态；美术/音频缺失时重跑 MiniMax World ASSET；再重建 presenter。',
    `metrics=${JSON.stringify(result.metrics)}`,
  ].join('\n');
}

/** Sync disk probes for workspace after Presenter write. */
export function runWorldAssetDiskGate(workspace: string): WorldQualityResult {
  const issues = requireRealAssets()
    ? collectWorkspaceAssetIssues(workspace)
    : [];
  return {
    ok: issues.length === 0,
    issues,
    metrics: {
      regions: 0,
      quests: 0,
      rules: 0,
      enemies: 0,
      npcs: 0,
    },
  };
}
