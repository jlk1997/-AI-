/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * World lineage gate — deterministic proof that the generated game still *is*
 * the compiled world. Runs in the baseline tier because it costs <100ms and
 * catches the one failure mode that makes the world model feel fake: the Agent
 * quietly rewriting scenes / dropping quests.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { readWorldSeedRecord, type WorldSeedRecord } from './worldGameSeedPhase.js';

export interface LineageCoverage {
  readonly total: number;
  readonly present: number;
  readonly missing: string[];
  /** 1 when nothing was expected. */
  readonly ratio: number;
}

export interface WorldLineageGateResult {
  readonly ok: boolean;
  /** False when there is no compiled world to check (plain game project). */
  readonly enforced: boolean;
  readonly reason: string | null;
  readonly issues: string[];
  readonly worldId: string | null;
  readonly worldTitle: string | null;
  readonly scenes: LineageCoverage;
  readonly entities: LineageCoverage;
  readonly quests: LineageCoverage;
  readonly portals: LineageCoverage;
  readonly rules: LineageCoverage;
}

const EMPTY_COVERAGE: LineageCoverage = {
  total: 0,
  present: 0,
  missing: [],
  ratio: 1,
};

function skipped(reason: string): WorldLineageGateResult {
  return {
    ok: true,
    enforced: false,
    reason,
    issues: [],
    worldId: null,
    worldTitle: null,
    scenes: EMPTY_COVERAGE,
    entities: EMPTY_COVERAGE,
    quests: EMPTY_COVERAGE,
    portals: EMPTY_COVERAGE,
    rules: EMPTY_COVERAGE,
  };
}

function gateDisabled(): boolean {
  const raw = process.env['PLATFORM_WORLD_LINEAGE_GATE']?.trim().toLowerCase();
  return raw === 'false' || raw === '0' || raw === 'off';
}

function readRatioEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return fallback;
  return raw;
}

function coverageOf(expected: readonly string[], haystack: Set<string>): LineageCoverage {
  const missing = expected.filter((id) => !haystack.has(id));
  const present = expected.length - missing.length;
  return {
    total: expected.length,
    present,
    missing,
    ratio: expected.length === 0 ? 1 : present / expected.length,
  };
}

/**
 * Ids referenced anywhere in `src/**` — the Agent may move logic into TS. The
 * generated `src/world/worldSeed.ts` is excluded: it lists every id by
 * construction, so counting it would make the gate always pass.
 */
async function collectSourceIds(workspace: string): Promise<string> {
  const srcDir = path.join(workspace, 'src');
  if (!fs.existsSync(srcDir)) return '';
  const generated = path.join(srcDir, 'world', 'worldSeed.ts');
  const chunks: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        await walk(full, depth + 1);
        continue;
      }
      if (!/\.(ts|tsx|js|json)$/i.test(entry.name)) continue;
      if (path.resolve(full) === path.resolve(generated)) continue;
      try {
        chunks.push(await fsp.readFile(full, 'utf8'));
      } catch {
        // unreadable file — ignore
      }
      if (chunks.length >= 200) return;
    }
  };
  await walk(srcDir, 0);
  return chunks.join('\n');
}

function collectDslIds(dsl: Record<string, unknown>): {
  sceneIds: Set<string>;
  entityIds: Set<string>;
} {
  const sceneIds = new Set<string>();
  const entityIds = new Set<string>();
  const scenes = Array.isArray(dsl['scenes']) ? dsl['scenes'] : [];
  for (const raw of scenes) {
    if (!raw || typeof raw !== 'object') continue;
    const scene = raw as Record<string, unknown>;
    if (typeof scene['id'] === 'string') sceneIds.add(scene['id']);
    const entities = Array.isArray(scene['entities']) ? scene['entities'] : [];
    for (const e of entities) {
      if (!e || typeof e !== 'object') continue;
      const id = (e as Record<string, unknown>)['id'];
      if (typeof id === 'string') entityIds.add(id);
    }
  }
  return { sceneIds, entityIds };
}

/**
 * Verifies that every region / entity / quest / portal / rule id the compiler
 * planted is still reachable, and records the result in
 * `public/WORLD_LINEAGE.json` for the UI's world-lineage card.
 */
export async function runWorldLineageGate(
  workspace: string,
): Promise<WorldLineageGateResult> {
  if (gateDisabled()) return skipped('PLATFORM_WORLD_LINEAGE_GATE=false');
  let record: WorldSeedRecord | null;
  try {
    record = await readWorldSeedRecord(workspace);
  } catch {
    record = null;
  }
  if (!record) return skipped('no WORLD_SEED.json (project has no world)');
  if (!record.gamePrefilled) {
    return skipped('world seed did not prefill game.json (iteration mode)');
  }

  const gamePath = [
    path.join(workspace, 'public', 'game.json'),
    path.join(workspace, 'game.json'),
  ].find((p) => fs.existsSync(p));
  if (!gamePath) {
    return {
      ...skipped('game.json missing'),
      ok: false,
      enforced: true,
      issues: ['game.json missing — world lineage cannot be verified'],
    };
  }

  let dsl: Record<string, unknown>;
  try {
    dsl = JSON.parse(await fsp.readFile(gamePath, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    return {
      ...skipped('game.json unreadable'),
      ok: false,
      enforced: true,
      issues: [
        `game.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  const { sceneIds, entityIds } = collectDslIds(dsl);
  const dslText = JSON.stringify(dsl);
  const sourceText = await collectSourceIds(workspace);
  const textual = `${dslText}\n${sourceText}`;
  const mentioned = (id: string): boolean => textual.includes(id);

  const expectedSceneIds = record.lineage.regionIds.map(
    (regionId) => record.lineage.sceneIdByRegionId[regionId] ?? regionId,
  );
  const scenes = coverageOf(expectedSceneIds, sceneIds);
  const entities = coverageOf(
    record.lineage.entityIds,
    new Set([...entityIds, ...record.lineage.entityIds.filter(mentioned)]),
  );
  const quests = coverageOf(
    record.lineage.questIds,
    new Set(record.lineage.questIds.filter(mentioned)),
  );
  const portals = coverageOf(
    record.lineage.portalIds,
    new Set([...entityIds, ...record.lineage.portalIds.filter(mentioned)]),
  );
  const rules = coverageOf(
    record.lineage.ruleIds,
    new Set(record.lineage.ruleIds.filter(mentioned)),
  );

  const minEntities = readRatioEnv('PLATFORM_WORLD_LINEAGE_MIN_ENTITIES', 0.8);
  const minPortals = readRatioEnv('PLATFORM_WORLD_LINEAGE_MIN_PORTALS', 0.8);
  // Default 0: rules stay advisory (Agent often folds them into Scene TS).
  // Set PLATFORM_WORLD_LINEAGE_MIN_RULES=0.5 to require skill id retention.
  const minRules = readRatioEnv('PLATFORM_WORLD_LINEAGE_MIN_RULES', 0);

  const issues: string[] = [];
  if (scenes.missing.length > 0) {
    issues.push(
      `game.json 缺少世界区域场景 scenes[].id：${scenes.missing.join(', ')} — 请恢复这些场景（可以扩展内容，但 id 必须保留）`,
    );
  }
  if (quests.missing.length > 0) {
    issues.push(
      `世界任务 ID 已从游戏中消失：${quests.missing.join(', ')} — 请在 game.json dialogue 或 Scene 逻辑中保留任务 id`,
    );
  }
  if (entities.ratio < minEntities) {
    issues.push(
      `世界实体覆盖率 ${(entities.ratio * 100).toFixed(0)}% < ${(minEntities * 100).toFixed(0)}%，缺失：${entities.missing.slice(0, 12).join(', ')}`,
    );
  }
  if (portals.ratio < minPortals) {
    issues.push(
      `世界传送点覆盖率 ${(portals.ratio * 100).toFixed(0)}% < ${(minPortals * 100).toFixed(0)}%，缺失：${portals.missing.slice(0, 12).join(', ')}`,
    );
  }
  if (rules.total > 0 && rules.ratio < minRules) {
    issues.push(
      `世界规则覆盖率 ${(rules.ratio * 100).toFixed(0)}% < ${(minRules * 100).toFixed(0)}%，缺失：${rules.missing.slice(0, 12).join(', ')} — 请保留 skills[].id`,
    );
  }

  // Feasibility: the compiled loop behaviors must still be present. Without
  // these the world model compiles into dead scenery.
  const seedHadPortals = record.lineage.portalIds.length > 0;
  const seedHadItems = record.stats?.items > 0;
  const seedHadEnemies = record.stats?.enemies > 0;
  if (seedHadPortals && !dslText.includes('sceneTransition')) {
    issues.push(
      '世界传送点仍在，但 game.json 丢失 sceneTransition 行为 — 请恢复门户场景切换，不要改成纯装饰实体',
    );
  }
  if (seedHadItems && !dslText.includes('collectOnTouch')) {
    issues.push(
      '世界道具仍在，但 game.json 丢失 collectOnTouch 行为 — 请恢复拾取计分/胜负闭环',
    );
  }
  if (seedHadEnemies) {
    if (!dslText.includes('"chase"') && !dslText.includes('"kind":"chase"')) {
      issues.push(
        '世界敌人仍在，但 game.json 丢失 chase 行为 — 请恢复追击，否则战斗压力无效',
      );
    }
    if (
      !dslText.includes('damageOnTouch') &&
      process.env['PLATFORM_WORLD_REQUIRE_COMBAT'] !== 'false'
    ) {
      issues.push(
        '世界敌人仍在，但 game.json 丢失 damageOnTouch — 接触伤害/HP 败北未落地，L2 难度调参无效',
      );
    }
  }

  const result: WorldLineageGateResult = {
    ok: issues.length === 0,
    enforced: true,
    reason: null,
    issues,
    worldId: record.worldId,
    worldTitle: record.worldTitle,
    scenes,
    entities,
    quests,
    portals,
    rules,
  };
  await writeWorldLineageReport(workspace, record, result);
  return result;
}

async function writeWorldLineageReport(
  workspace: string,
  record: WorldSeedRecord,
  result: WorldLineageGateResult,
): Promise<void> {
  const publicDir = path.join(workspace, 'public');
  try {
    await fsp.mkdir(publicDir, { recursive: true });
    await fsp.writeFile(
      path.join(publicDir, 'WORLD_LINEAGE.json'),
      `${JSON.stringify(
        {
          schema: 'opengame.world-lineage/1',
          worldId: record.worldId,
          worldTitle: record.worldTitle,
          worldVersion: record.worldVersion,
          initialSceneId: record.lineage.initialSceneId,
          sceneIdByRegionId: record.lineage.sceneIdByRegionId,
          ok: result.ok,
          issues: result.issues,
          coverage: {
            scenes: result.scenes,
            entities: result.entities,
            quests: result.quests,
            portals: result.portals,
            rules: result.rules,
          },
          tunables: record.tunables,
          tunablesSource: record.tunablesSource,
          summaryLines: record.summaryLines,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  } catch {
    // report is telemetry — never fail the gate on a write error
  }
}

export function formatWorldLineageSummary(result: WorldLineageGateResult): string {
  if (!result.enforced) return `世界血缘门禁跳过：${result.reason ?? '无世界'}`;
  const pct = (c: LineageCoverage): string =>
    c.total === 0 ? '—' : `${c.present}/${c.total}`;
  const head = result.ok ? '世界血缘校验通过' : '世界血缘校验失败';
  return `${head}：区域 ${pct(result.scenes)} · 实体 ${pct(result.entities)} · 任务 ${pct(result.quests)} · 传送点 ${pct(result.portals)}`;
}

export function formatWorldLineageFailureForPrompt(
  result: WorldLineageGateResult,
): string {
  return [
    '【世界血缘门禁失败 / World lineage gate】',
    '本项目的游戏必须保留世界编译出的结构 ID（见 public/WORLD_SEED.json 与 src/world/worldSeed.ts）。',
    ...result.issues.map((issue) => `- ${issue}`),
    '修复方式：恢复缺失的 scenes[].id / 实体 id / 任务 id，只允许新增内容，不要重命名或删除。',
  ].join('\n');
}
