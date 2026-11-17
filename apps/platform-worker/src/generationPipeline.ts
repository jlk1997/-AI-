/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { makeFakeConfig } from '@opengame/opengame-core';
import { GameTypeClassifierTool } from '@opengame/opengame-core/dist/src/tools/game-type-classifier.js';
import type { GameArchetype } from '@opengame/opengame-core/dist/src/tools/game-type-classifier.js';
import { GenerateGDDTool } from '@opengame/opengame-core/dist/src/tools/generate-gdd.js';
import { artStyleProfile, isArtStyleId } from '@opengame/world-spec';

import type { AgentEventStream } from './agentEvents.js';
import type { RunProcessResult } from './runProcess.js';
import { formatCapabilityCatalogForCoder } from './capabilityCatalog.js';
import {
  applyGameOps,
  formatGameOpsForCoder,
  inferGameOpsFromPrompt,
  sanitizeGameOps,
  type GameOp,
} from './gameOps.js';
import { refineGameOpsWithLlm } from './gameOpsLlm.js';
import {
  formatGameIntentForCoder,
  inferGameIntent,
  isRedoPrompt,
  mergeGameIntent,
  readGameIntent,
  synthesizeMechanicSpec,
  writeGameIntent,
  type GameIntent,
} from './gameIntent.js';
import {
  detectBoardKind,
  formatMechanicSpecForCoder,
  ensureGameDepth,
  readMechanicSpec,
  stampGddWithMechanicSpec,
  writeMechanicSpec,
  type MechanicSpec,
} from './mechanicSpec.js';
import {
  extractRequirements,
  formatRequirementsForCoder,
  readRequirementSpec,
  writeRequirementSpec,
  type RequirementSpec,
} from './requirementSpec.js';

export type { GameArchetype };

export interface WorldStyleTip {
  readonly artStyle?: string;
  readonly mood?: string;
  readonly palette?: readonly string[];
  readonly narrativeSeed?: string;
  readonly title?: string;
}

export interface PipelineContext {
  readonly archetype: GameArchetype;
  readonly classificationReasoning: string;
  readonly gddMarkdown: string | null;
  readonly assetPhasePrompt: string | null;
  /** Scene keys extracted from GDD — drives stubs + quality gate min count. */
  readonly gddSceneKeys: readonly string[];
  /**
   * Mechanics the user named, with the signals that prove they landed. Drives
   * the requirement-fit gate, which is the only check that compares the
   * delivered game against what was actually asked for.
   */
  readonly requirements?: RequirementSpec | null;
  /** Play-loop SSOT. Archetype is only a camera / physics hint. */
  readonly mechanic?: MechanicSpec | null;
  /** Incremental ops on iterate (add_loop / retarget_win / bind_module). */
  readonly gameOps?: readonly GameOp[];
  /** Compile-time IR that MechanicSpec is synthesized from. */
  readonly intent?: GameIntent | null;
  /** Optional tip from project world Spec (dual-mode style coupling). */
  readonly worldStyleTip?: WorldStyleTip | null;
  /**
   * Set when `worldGameSeedPhase` already compiled the project's World Spec into
   * `public/game.json`. Flips the Coder brief from "design a game" to "extend
   * the world that is already on disk".
   */
  readonly worldSeedApplied?: boolean;
}

function coreConfig(workspace: string) {
  return makeFakeConfig({ cwd: workspace, targetDir: workspace });
}

function parseArchetypeFromClassifierOutput(llmContent: string): GameArchetype {
  const jsonMatch = llmContent.match(/\{[\s\S]*"archetype"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { archetype?: string };
      const a = parsed.archetype;
      if (
        a === 'platformer' ||
        a === 'top_down' ||
        a === 'grid_logic' ||
        a === 'tower_defense' ||
        a === 'ui_heavy'
      ) {
        return a;
      }
    } catch {
      // continue
    }
  }
  return heuristicArchetypeFromPrompt(llmContent).archetype;
}

/** Keyword classify — avoids an LLM round when the prompt is unambiguous. */
export function heuristicArchetypeFromPrompt(prompt: string): {
  readonly archetype: GameArchetype;
  readonly confidence: 'high' | 'low';
  readonly reason: string;
} {
  const t = prompt;
  // Pure dialogue / VN only — NOT every "RPG" (users want walk+talk+fight).
  if (
    /视觉小说|visual\s*novel|galgame|文字冒险|纯对话|只有对话|对话冒险(?!.*(?:走|探索|地图|小镇))/i.test(
      t,
    )
  ) {
    return { archetype: 'ui_heavy', confidence: 'high', reason: 'visual-novel' };
  }
  if (/塔防|tower\s*defense|\btd\b/i.test(t)) {
    return {
      archetype: 'tower_defense',
      confidence: 'high',
      reason: 'tower-defense',
    };
  }
  const boardish = /棋盘|五子棋|gomoku|象棋|xiangqi|\bchess\b/i.test(t);
  const boundCap = /消消乐|三消|match[\s-]?3|卡牌|手牌|抽牌|弹幕|danmaku|bullet\s*hell/i.test(
    t,
  );
  const explore =
    /俯视角|top[\s-]?down|zelda|roguelike|探索|走动|走来走去|WASD|找人|小镇|城镇|地图|开放世界|武侠|江湖|rpg|角色扮演/i.test(
      t,
    );
  // Mixed: walkable world is the camera; board/match/cards/emitter are bound capabilities.
  if ((boardish || boundCap) && explore && !/视觉小说|galgame|纯对话/i.test(t)) {
    return {
      archetype: 'top_down',
      confidence: 'high',
      reason: 'mixed-explore-capability',
    };
  }
  if (
    /贪吃蛇|\bsnake\b|tetris|俄罗斯方块|2048|消消乐|三消|match[\s-]?3|数独|flappy|飞鸟|棋盘|五子棋|gomoku|象棋|xiangqi|\bchess\b/i.test(
      t,
    )
  ) {
    return { archetype: 'grid_logic', confidence: 'high', reason: 'grid-arcade' };
  }
  // Exploration / town / wuxia RPG → walkable world, not ChapterScene VN.
  if (
    /俯视角|top[\s-]?down|zelda|roguelike|探索|走动|走来走去|WASD|找人|小镇|城镇|地图|开放世界|武侠|江湖|rpg|角色扮演/i.test(
      t,
    ) &&
    !/视觉小说|galgame|纯对话/i.test(t)
  ) {
    return { archetype: 'top_down', confidence: 'high', reason: 'rpg-explore' };
  }
  if (/俯视角|top[\s-]?down|zelda|roguelike/i.test(t)) {
    return { archetype: 'top_down', confidence: 'high', reason: 'top-down' };
  }
  if (/平台跳跃|platformer|马里奥|横版跳|跑酷/i.test(t)) {
    return { archetype: 'platformer', confidence: 'high', reason: 'platformer' };
  }
  // Explicit VN leftovers only.
  if (/剧情对话|回合制对话|章节对话/i.test(t) && !/走|探索|地图|小镇/i.test(t)) {
    return { archetype: 'ui_heavy', confidence: 'low', reason: 'dialogue-heavy' };
  }
  if (/tower|塔防|defense/i.test(t)) {
    return { archetype: 'tower_defense', confidence: 'low', reason: 'td-ish' };
  }
  if (/grid|棋|格子/i.test(t)) {
    return { archetype: 'grid_logic', confidence: 'low', reason: 'grid-ish' };
  }
  return {
    archetype: 'platformer',
    confidence: 'low',
    reason: 'default-platformer',
  };
}

function readClassifyMode(): 'heuristic' | 'llm' | 'auto' {
  const raw = process.env['PLATFORM_CLASSIFY_MODE']?.trim().toLowerCase();
  if (raw === 'heuristic' || raw === 'llm' || raw === 'auto') return raw;
  return 'auto';
}

function shouldSkipGddLlm(): boolean {
  const v = process.env['PLATFORM_SKIP_GDD_LLM']?.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function defaultSceneKeysForArchetype(archetype: GameArchetype): string[] {
  switch (archetype) {
    case 'ui_heavy':
      return ['TitleScene', 'ChapterScene', 'BattleScene', 'EndingScene'];
    case 'top_down':
      return ['TitleScene', 'WorldScene', 'VictoryScene'];
    case 'tower_defense':
      return ['TitleScene', 'TdScene', 'ResultScene'];
    case 'grid_logic':
      return [];
    case 'platformer':
    default:
      return ['TitleScene', 'LevelScene', 'GameOverScene'];
  }
}

/** Compact GDD when skipping the expensive GenerateGDD LLM call. */
export function buildHeuristicGddMarkdown(
  userPrompt: string,
  archetype: GameArchetype,
  mechanic?: MechanicSpec | null,
): string {
  const scenes = defaultSceneKeysForArchetype(archetype);
  const boardKind = mechanic?.boardKind ?? detectBoardKind(userPrompt);
  const sceneLines =
    scenes.length > 0
      ? scenes.map((k) => `- \`${k}\``).join('\n')
      : boardKind || mechanic?.arcadeVariant === 'board_turn'
        ? `- \`BoardTurnScene\`（点选走子 + @opengame/module-board ${boardKind ?? 'generic'}；禁止空格加分壳）`
        : '- （grid_logic 街机：可用 game.json skills；棋类必须 BoardTurnScene）';
  const extras = mechanic?.extraScenes ?? [];
  const specBlock = mechanic
    ? `
## MechanicSpec（GDD 是说明书，规格是真相）
- space=${mechanic.space} time=${mechanic.time} input=${mechanic.input} win=${mechanic.win}
- modules: ${mechanic.modules.join(', ')}
- loops: ${mechanic.loops.map((l) => l.id).join(', ') || '（未点名）'}
- extraScenes: ${extras.join(', ') || '—'}
`
    : '';
  const extraSceneLines = extras
    .filter((k) => !scenes.includes(k) && !sceneLines.includes(`\`${k}\``))
    .map((k) => {
      if (k === 'BoardTurnScene') {
        return `- \`BoardTurnScene\`（绑定棋盘能力 + @opengame/module-board；禁止删世界 Scene）`;
      }
      if (k === 'Match3Scene') {
        return `- \`Match3Scene\`（绑定三消 + Match3Rules；不是消消乐成品工程）`;
      }
      if (k === 'CardsHandScene') {
        return `- \`CardsHandScene\`（绑定手牌 + @opengame/module-cards）`;
      }
      if (k === 'EmitterScene') {
        return `- \`EmitterScene\`（绑定弹幕 + @opengame/module-emitter）`;
      }
      return `- \`${k}\``;
    });
  return `# GAME_DESIGN（启发式短稿）

## Overview
${userPrompt.slice(0, 800)}

## Archetype
${archetype}（只是镜头/物理提示）
${specBlock}
## Scenes
${[sceneLines, ...extraSceneLines].filter(Boolean).join('\n')}

## Playable Acceptance Checklist（可玩验收 — 门禁对照）
- [ ] 开局 3 秒内可操作
- [ ] 存在核心循环与胜负路径
- [ ] 资产 png/webp 已引用；禁止未实现 DSL

> 由 PLATFORM_SKIP_GDD_LLM 生成；完整设计请读用户需求并由 Coder 实现。
`;
}

/**
 * Runs classify → GDD (first-time only) before the main CODE pass.
 */
export function buildAssetPhasePrompt(
  userPrompt: string,
  archetype: GameArchetype,
): string {
  return `【资产阶段 / ASSET phase — ArtDirector 标准】
你是美术 Agent（ArtDirector）。根据用户需求与 archetype=${archetype}：
1. 阅读 GAME_DESIGN.md（若存在）中的资产清单与 style_anchor。
2. 调用 \`generate_game_assets\` 生成至少：1 张角色/主体、1 张背景、1 段 BGM、2 个 SFX。
3. 音频资产 id 必须稳定：\`bgm\`、\`sfx_win\`、\`sfx_lose\`（结果 Scene 会按这些 key 播放）。
4. 风格必须统一（同一 palette / 轮廓清晰 / 可读）；糊团、风格漂移视为失败 — 重生该项。
5. 将生成文件放入 \`public/assets/\` 并在 \`public/game.json\` 的 \`assets[]\` 与 \`audioTracks[]\` 中引用（相对路径 ./assets/xxx.png）。
6. **Matte 语义**：角色/敌人/道具用 \`type:image\`（默认自动抠图，透明 PNG）；场景用 \`type:background\`（不透明，禁止抠图）。立绘需留底时设 \`keepBackground:true\`。
7. **多动作**：平台跳跃优先提供 \`player\`（idle）+ \`player_run\`；左右朝向用 flipX，不要为左向单独出图。
8. 禁止 .svg；不要删除已有 src/main.ts 与 package.json。
用户需求摘要：${userPrompt.slice(0, 800)}`;
}

/** Repair prompt when quality gate reports missing on-disk art/audio. */
export function buildAssetRepairPrompt(
  userPrompt: string,
  issues: readonly string[],
): string {
  const assetIssues = issues.filter(
    (i) =>
      /missing on disk|need >= .* image|ArtDirector/i.test(i) ||
      i.includes('audio'),
  );
  return `【资产修复 / ASSET repair — PLATFORM_ALLOW_ASSET_FIX】
门禁发现资产缺失或无效，请只修复下列问题（调用 generate_game_assets）：
${assetIssues.map((i) => `- ${i}`).join('\n')}
要求：
1. 生成缺失的 png/webp 与 mp3/ogg，写入 public/assets/。
2. 更新 public/game.json 的 assets[] / audioTracks[] 引用真实相对路径。
3. 不要改玩法 Scene；禁止 .svg。
用户需求摘要：${userPrompt.slice(0, 400)}`;
}

export function issuesNeedAssetRegen(issues: readonly string[]): boolean {
  const allow =
    process.env['PLATFORM_ALLOW_ASSET_FIX'] === 'true' ||
    process.env['PLATFORM_ALLOW_ASSET_FIX'] === '1';
  if (!allow) return false;
  return issues.some(
    (i) =>
      i.includes('missing on disk') ||
      /need >= \d+ image/i.test(i) ||
      /need >= \d+ audio/i.test(i) ||
      /authenticity/i.test(i) ||
      /near-solid|too small|procedural/i.test(i) ||
      /shape\/color without assetId|wire MiniMax|MiniMax pack/i.test(i) ||
      /missing sprite\.assetId/i.test(i) ||
      /ChangePlan artStyle/i.test(i) ||
      (i.includes('ArtDirector') &&
        (i.includes('image') ||
          i.includes('audio') ||
          i.includes('assetId') ||
          i.includes('MiniMax'))) ||
      /strict 模式要求至少一个 audio/i.test(i) ||
      /sfx_win|sfx_lose/i.test(i),
  );
}

export async function runAssetPhase(options: {
  readonly prompt: string;
  readonly stream: AgentEventStream;
  readonly invokeCli: (prompt: string) => Promise<RunProcessResult>;
}): Promise<void> {
  await options.stream.emit('artist', 'ASSET', {
    summary: '按 GDD 生成基础美术与音频资产',
    tool: 'generate_game_assets',
  });
  const assetResult = await options.invokeCli(options.prompt);
  await options.stream.emit('artist', 'ASSET', {
    summary: `资产阶段 CLI 退出码 ${assetResult.exitCode}`,
    details: {
      exitCode: assetResult.exitCode,
      stdoutChars: assetResult.stdout.length,
    },
  });
}

function readGenerationBudget(): { maxAssetCliPasses?: number } | null {
  const raw = process.env['PLATFORM_GENERATION_BUDGET']?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { maxAssetCliPasses?: number };
  } catch {
    return null;
  }
}

/**
 * Force the GDD's `art style:` line to the picked profile.
 *
 * `gameAssetPhase.readStyleHint` reads that single line, so the model's own
 * guess used to decide the look of every generated image regardless of what the
 * user chose. Rewrites an existing line, appends a section when absent.
 */
export function stampGddArtStyle(
  markdown: string,
  artStyleId?: string | null,
): string {
  if (!isArtStyleId(artStyleId)) return markdown;
  const profile = artStyleProfile(artStyleId);
  const line = `art style: ${profile.artStyle}`;
  const existing = /^([^\S\n]*[-*]?[^\S\n]*)art\s*style[:：].*$/im;
  if (existing.test(markdown)) {
    return markdown.replace(existing, (_m, indent: string) => `${indent}${line}`);
  }
  return `${markdown.trim()}\n\n## Art Direction（用户选择）\n\n- ${line}\n- ${profile.promptSuffix}\n`;
}

function readLlmTimeoutMs(): number {
  const raw = process.env['PLATFORM_LLM_TIMEOUT_MS']?.trim();
  if (!raw) return 120_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 15_000 && n <= 600_000 ? Math.floor(n) : 120_000;
}

async function executeWithLlmTimeout<T>(
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutMs = readLlmTimeoutMs();
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort(new Error(`${label} timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function runGenerationPipeline(options: {
  readonly userPrompt: string;
  readonly workspace: string;
  readonly isFirstGeneration: boolean;
  readonly stream: AgentEventStream;
  /** User-confirmed archetype from design intake (wins over heuristic when set). */
  readonly preferredArchetype?: GameArchetype | null;
  readonly designBrief?: string | null;
  /** Art style picked in the UI; stamped into the GDD for the asset phase. */
  readonly artStyleId?: string | null;
  /** e.g. `pvp` — a requirement the UI states directly rather than in prose. */
  readonly variant?: string | null;
}): Promise<PipelineContext> {
  const {
    userPrompt,
    workspace,
    isFirstGeneration,
    stream,
    preferredArchetype,
    designBrief,
    artStyleId,
    variant,
  } = options;
  const budget = readGenerationBudget();
  if (budget?.maxAssetCliPasses === 0) {
    process.env['PLATFORM_ENABLE_ASSET_PHASE'] = 'false';
  }

  let archetype: GameArchetype = 'platformer';
  let classificationReasoning = 'default platformer (pipeline skipped classify)';
  let gddSceneKeys: string[] = [];
  // Iterations keep the original contract: the user should not have to restate
  // "还要能钓鱼" in every follow-up for the gate to keep checking it.
  let requirements: RequirementSpec | null = isFirstGeneration
    ? null
    : readRequirementSpec(workspace);
  let mechanic: MechanicSpec | null = isFirstGeneration
    ? null
    : readMechanicSpec(workspace);
  let gameOps: GameOp[] = [];
  let intent: GameIntent | null = null;

  if (isFirstGeneration) {
    const classifyMode = readClassifyMode();
    const heuristic = heuristicArchetypeFromPrompt(userPrompt);
    const intakeOverride =
      preferredArchetype &&
      (preferredArchetype === 'platformer' ||
        preferredArchetype === 'top_down' ||
        preferredArchetype === 'grid_logic' ||
        preferredArchetype === 'tower_defense' ||
        preferredArchetype === 'ui_heavy')
        ? preferredArchetype
        : null;

    if (intakeOverride) {
      archetype = intakeOverride;
      classificationReasoning = `design-intake:${intakeOverride}${
        designBrief ? ` (${designBrief})` : ''
      }`;
      await stream.emit('planner', 'PLAN', {
        summary: `选定 archetype: ${archetype}（用户设计访谈确认）`,
        details: {
          archetype,
          source: 'design-intake',
          designBrief: designBrief ?? null,
          heuristicWouldBe: heuristic.archetype,
        },
      });
    } else {
    const useHeuristic =
      classifyMode === 'heuristic' ||
      (classifyMode === 'auto' && heuristic.confidence === 'high');

    await stream.emit('planner', 'PLAN', {
      summary: useHeuristic
        ? `分类游戏类型（启发式 ${heuristic.reason}）`
        : '分类游戏类型（LLM）',
      tool: useHeuristic ? 'heuristic-classifier' : 'game-type-classifier',
      details: {
        mode: classifyMode,
        heuristic: heuristic.archetype,
        confidence: heuristic.confidence,
      },
    });

    if (useHeuristic) {
      archetype = heuristic.archetype;
      classificationReasoning = `heuristic:${heuristic.reason}`;
      await stream.emit('planner', 'PLAN', {
        summary: `选定 archetype: ${archetype}（跳过 classify LLM）`,
        details: { archetype, classifyMode, reason: heuristic.reason },
      });
    } else {
      try {
        const inv = new GameTypeClassifierTool(coreConfig(workspace)).build({
          game_description: userPrompt,
        });
        const result = await executeWithLlmTimeout(
          'game-type-classifier',
          (signal) => inv.execute(signal),
        );
        const content =
          typeof result.llmContent === 'string'
            ? result.llmContent
            : String(result.llmContent ?? '');
        archetype = parseArchetypeFromClassifierOutput(content);
        classificationReasoning = content.slice(0, 500);
        await stream.emit('planner', 'PLAN', {
          summary: `选定 archetype: ${archetype}`,
          details: { archetype },
        });
      } catch (err) {
        archetype = heuristic.archetype;
        classificationReasoning = `classify-failed→${heuristic.reason}`;
        await stream.emit('planner', 'PLAN', {
          summary: `分类失败，启发式回退 ${archetype}`,
          details: {
            error: err instanceof Error ? err.message : String(err),
            archetype,
          },
        });
      }
    }
    } // end intakeOverride else

    intent = inferGameIntent(userPrompt, designBrief);
    mechanic = synthesizeMechanicSpec(intent, { archetype });
    if (intent.mixed) {
      archetype = 'top_down';
      classificationReasoning = `${classificationReasoning}|mixed-explore-capability`;
    }
    await writeGameIntent(workspace, intent);
    await writeMechanicSpec(workspace, mechanic);
    await stream.emit('planner', 'PLAN', {
      summary: `玩法规格已合成（${mechanic.space}/${mechanic.time}/${mechanic.input} · ${mechanic.loops.map((l) => l.id).join(', ') || '无点名循环'}）`,
      details: {
        intentLoops: intent.loopSeeds.map((l) => l.id),
        mixed: intent.mixed,
        space: mechanic.space,
        time: mechanic.time,
        input: mechanic.input,
        win: mechanic.win,
        modules: mechanic.modules,
        loops: mechanic.loops.map((l) => l.id),
        boardKind: mechanic.boardKind ?? null,
        arcadeVariant: mechanic.arcadeVariant ?? null,
        extraScenes: mechanic.extraScenes ?? [],
      },
    });
  } else {
    const metaPath = path.join(workspace, '.opengame-pipeline.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(await fsp.readFile(metaPath, 'utf8')) as {
          archetype?: GameArchetype;
          gddSceneKeys?: string[];
        };
        if (meta.archetype) archetype = meta.archetype;
        if (Array.isArray(meta.gddSceneKeys)) gddSceneKeys = meta.gddSceneKeys;
      } catch {
        // ignore
      }
    }
  }

  let gddMarkdown: string | null = null;
  if (isFirstGeneration) {
    const skipGddLlm = shouldSkipGddLlm();
    await stream.emit('planner', 'PLAN', {
      summary: skipGddLlm
        ? '生成游戏设计文档 GDD（启发式短稿，跳过 LLM）'
        : '生成游戏设计文档 GDD',
      tool: skipGddLlm ? 'heuristic-gdd' : 'generate-gdd',
    });
    try {
      let content: string;
      if (skipGddLlm) {
        content = buildHeuristicGddMarkdown(userPrompt, archetype, mechanic);
      } else {
        const inv = new GenerateGDDTool(coreConfig(workspace)).build({
          raw_user_requirement: userPrompt,
          archetype,
          ...(mechanic
            ? { config_summary: formatMechanicSpecForCoder(mechanic) }
            : {}),
        });
        const result = await executeWithLlmTimeout('generate-gdd', (signal) =>
          inv.execute(signal),
        );
        content =
          typeof result.llmContent === 'string'
            ? result.llmContent
            : String(result.llmContent ?? '');
      }
      gddMarkdown = content;
      gddSceneKeys = extractGddSceneKeys(content);
      if (gddSceneKeys.length === 0) {
        gddSceneKeys = defaultSceneKeysForArchetype(archetype);
      }
      for (const extra of mechanic?.extraScenes ?? []) {
        if (!gddSceneKeys.includes(extra)) gddSceneKeys.push(extra);
      }
      const gddPath = path.join(workspace, 'GAME_DESIGN.md');
      const designBriefBlock =
        designBrief && designBrief.trim()
          ? `\n\n## Design Intake Brief（用户访谈确认）\n\n\`\`\`\n${designBrief.trim().slice(0, 1200)}\n\`\`\`\n`
          : '';
      const checklist = `

---

## Playable Acceptance Checklist（可玩验收 — 门禁对照）

- [ ] 开局 3 秒内可操作（键盘/指针）
- [ ] 存在核心循环（可重复的有意义动作）
- [ ] 存在胜负或任务完成路径（Victory / GameOver / quest complete）
- [ ] 非 grid：≥2 个 Scene 已注册 extraScenes，且无 \`implement gameplay\` 空白桩
- [ ] 至少 1 张 png/webp 角色或背景资产 + 音频（strict）
- [ ] 禁止未实现 DSL：gameFlow / spawners / entities_templates
- [ ] Archetype=${archetype}；Scene keys: ${gddSceneKeys.join(', ') || '(from GDD sections)'}
- [ ] 内容在 JSON/Spec（STORY_BIBLE / CONTENT_GRAPH / chapter），Scene 只演不硬编码剧情文案

> Worker \`gameQualityGate\` + playability smoke 对照本清单；FIX 轮必须修到勾选通过。
`;
      const withBrief = content.includes('Design Intake Brief')
        ? content
        : `${content.trim()}${designBriefBlock}`;
      const withChecklist = withBrief.includes('Playable Acceptance Checklist')
        ? withBrief
        : `${withBrief.trim()}\n${checklist}`;
      // The GDD `art style:` line is what the asset phase reads, so the picked
      // style has to land here or the user's choice never reaches the images.
      const stamped = mechanic
        ? stampGddWithMechanicSpec(withChecklist, mechanic)
        : withChecklist;
      const body = stampGddArtStyle(stamped, artStyleId);
      await fsp.writeFile(gddPath, body, 'utf8');
      gddMarkdown = body;
      await stream.emit('planner', 'PLAN', {
        summary: skipGddLlm
          ? '启发式 GDD 已写入 GAME_DESIGN.md'
          : 'GDD 已写入 GAME_DESIGN.md（含可玩验收清单）',
        details: {
          path: gddPath,
          chars: body.length,
          sceneKeys: gddSceneKeys,
          skipGddLlm,
        },
      });
    } catch (err) {
      await stream.emit('planner', 'PLAN', {
        summary: 'GDD 生成失败（继续编码阶段）',
        details: { error: err instanceof Error ? err.message : String(err) },
      });
    }

    // After the GDD so it can restate a mechanic in verifiable words, but the
    // user's own prompt is still the only thing that can create an obligation.
    requirements = extractRequirements(userPrompt, {
      designBrief: designBrief ?? null,
      variant: variant ?? null,
      gdd: gddMarkdown,
      mechanic,
    });
    if (requirements.features.length > 0) {
      await writeRequirementSpec(workspace, requirements);
      await stream.emit('planner', 'PLAN', {
        summary: `需求清单已锁定（${requirements.features.length} 项将被门禁检查）`,
        details: {
          features: requirements.features.map((f) => ({
            id: f.id,
            label: f.label,
            source: f.source,
          })),
        },
      });
    }

    // Narrative archetypes: Outline → STORY_BIBLE + chapter JSON (data before Scene)
    if (archetype === 'ui_heavy' || archetype === 'top_down') {
      try {
        const { writeStoryOutlineArtifacts } = await import('./storyOutline.js');
        const outline = await writeStoryOutlineArtifacts(workspace, userPrompt, {
          force: true,
          designBrief: designBrief ?? null,
          useLlmAuthor: true,
        });
        await stream.emit('planner', 'PLAN', {
          summary: `剧情大纲已就绪（${outline.bible.chapters.length} 章 · ${outline.bible.npcs.length} 名角色 · ${outline.bible.quests.length} 个任务）`,
          details: {
            biblePath: outline.biblePath,
            chapterPath: outline.chapterPath,
            chapters: outline.bible.chapters.map((c) => c.id),
            npcs: outline.bible.npcs.map((n) => n.id),
            quests: outline.bible.quests.map((q) => q.id),
            winCondition: outline.bible.winCondition,
          },
        });
        const { writeContentGraphArtifacts } = await import('./contentGraph.js');
        const graph = await writeContentGraphArtifacts({
          workspace,
          bible: outline.bible,
          archetype,
          designBrief: designBrief ?? null,
          userPrompt,
        });
        await stream.emit('planner', 'PLAN', {
          summary: `Content Graph 已写入（${graph.nodeCount} 节点）`,
          details: { path: graph.path, layers: graph.layers },
        });
        const { maybeWriteChapterCinematicPresenter } = await import(
          './chapterCinematicPresenter.js'
        );
        const cine = await maybeWriteChapterCinematicPresenter({
          workspace,
          bible: outline.bible,
          archetype,
        });
        if (cine.written) {
          await stream.emit('planner', 'PLAN', {
            summary: '章节高光 Presenter 桩已写入（LingBot 可选）',
            details: { path: cine.path },
          });
        }
      } catch (err) {
        await stream.emit('planner', 'PLAN', {
          summary: '剧情大纲暂未写入，将使用默认短篇脚手架',
          details: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }
  } else {
    intent = mergeGameIntent(
      readGameIntent(workspace),
      inferGameIntent(userPrompt, designBrief),
    );
    gameOps = inferGameOpsFromPrompt(userPrompt, mechanic);
    const llmOps = await refineGameOpsWithLlm(userPrompt, mechanic);
    if (llmOps.length > 0) {
      gameOps = sanitizeGameOps([...gameOps, ...llmOps], {
        redo: isRedoPrompt(userPrompt),
      });
    }
    if (!mechanic) {
      mechanic = synthesizeMechanicSpec(intent, { archetype });
    }
    if (gameOps.length > 0) {
      mechanic = applyGameOps(mechanic, gameOps);
    }
    mechanic = ensureGameDepth(mechanic);
    await writeGameIntent(workspace, intent);
    await writeMechanicSpec(workspace, mechanic);
    const fresh = extractRequirements(userPrompt, {
      designBrief: designBrief ?? null,
      variant: variant ?? null,
      mechanic,
    });
    if (fresh.features.length > 0 || (requirements?.features.length ?? 0) > 0) {
      const byId = new Map(
        (requirements?.features ?? []).map((f) => [f.id, f] as const),
      );
      for (const f of fresh.features) {
        if (!byId.has(f.id)) byId.set(f.id, f);
      }
      requirements = {
        schema: 'opengame-requirements-v1',
        prompt: userPrompt.slice(0, 2000),
        features: [...byId.values()],
        updatedAt: new Date().toISOString(),
      };
      await writeRequirementSpec(workspace, requirements);
    }
    if (gameOps.length > 0) {
      await stream.emit('planner', 'PLAN', {
        summary: `GameOps 已合并（${gameOps.map((o) => o.op).join(', ')}）`,
        details: { ops: gameOps },
      });
    }
  }

  const assetPhasePrompt =
    isFirstGeneration &&
    process.env['PLATFORM_ENABLE_ASSET_PHASE'] !== 'false'
      ? buildAssetPhasePrompt(userPrompt, archetype)
      : null;

  await fsp.mkdir(path.join(workspace, '.opengame'), { recursive: true }).catch(() => {});
  await fsp.writeFile(
    path.join(workspace, '.opengame-pipeline.json'),
    JSON.stringify(
      {
        archetype,
        classificationReasoning: classificationReasoning.slice(0, 2000),
        hasGdd: Boolean(gddMarkdown),
        gddSceneKeys,
        requiredFeatures: (requirements?.features ?? []).map((f) => f.id),
        mechanic: mechanic
          ? {
              space: mechanic.space,
              time: mechanic.time,
              input: mechanic.input,
              win: mechanic.win,
              modules: mechanic.modules,
              loops: mechanic.loops.map((l) => l.id),
              boardKind: mechanic.boardKind ?? null,
              arcadeVariant: mechanic.arcadeVariant ?? null,
              extraScenes: mechanic.extraScenes ?? [],
            }
          : null,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    archetype,
    classificationReasoning,
    gddMarkdown,
    assetPhasePrompt,
    gddSceneKeys,
    requirements,
    mechanic,
    gameOps,
    intent,
  };
}

/** Pull Phaser Scene keys from GDD markdown (flexible naming — not fixed Title/Battle). */
export function extractGddSceneKeys(gdd: string): string[] {
  const keys = new Set<string>();
  const patterns = [
    /\b([A-Z][A-Za-z0-9]*Scene)\b/g,
    /[`'"]([A-Za-z][A-Za-z0-9_]*Scene)[`'"]/g,
    /(?:scene[_\s-]?key|场景[_\s-]?key|Scene Key)[:\s|]+[`'"]?([A-Za-z][A-Za-z0-9_]*)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(gdd)) !== null) {
      const k = m[1]?.trim();
      if (k && k.length >= 4 && k.length <= 48) keys.add(k);
    }
  }
  return [...keys];
}

export function formatPipelineContextForCoder(ctx: PipelineContext): string {
  const parts = [
    `【平台流水线 / Platform pipeline】`,
    `- Archetype: ${ctx.archetype}`,
    `- 已生成 GDD: ${ctx.gddMarkdown ? '是（见 GAME_DESIGN.md）' : '否'}`,
    `- **交付语义**：首过构建+冒烟 = 可玩草稿；继续提质美术/难度，勿把草稿当完成品`,
    ctx.worldSeedApplied
      ? `- **结构已由世界编译落地（双层）**：customModule 开机壳 + layoutOnly 区域 entities；见 public/game.json 与 src/world/worldSeed.ts。只做增量补写（手感、UI、音效），不要删壳、不要把 initialSceneId 改回区域 id、不要重命名 layoutOnly 区域`
      : `- **高自由度**：Scene 名称/数量以 GDD 与用户 prompt 为准，下列仅为能力参考，可增删改 Scene 只要可玩闭环`,
    ctx.worldSeedApplied
      ? `- **世界闭环行为不可删**：保留 sceneTransition（门户）、collectOnTouch（道具/触发器）、chase+damageOnTouch（敌人接触伤/HP 败北）、player.state.hp；WASD 移动；胜负已由 score/winAt 与 HP 驱动`
      : null,
    `- **内容进 JSON/Spec**：STORY_BIBLE / CONTENT_GRAPH / story/*.json；Scene 只演`,
    ctx.archetype === 'top_down'
      ? `- **WorldScene 必须呈现 Spec**：Title→Chapter 开场（chapterOpenerOnly + Skip）→ World；多区域 resolveWorldLayoutsBySceneId + bg_region_* / playRegionBgm；门户 scene.start 或 worldRegionId+restart；结局文案来自 STORY_BIBLE.endings；NPC 对话若用 ChoicePanel：**必须** on('selected')→selectChoice + dimDialogueForChoices，禁止选项叠在对话框上却点不动`
      : null,
    ctx.archetype === 'ui_heavy'
      ? `- **ChapterScene 必须呈现 Spec**：多章 chapter_XX.json + DialogueManager；Skip（S）；选项 ChoicePanel wordWrap；Ending 消费 bible.endings`
      : null,
    `- **可玩验收清单（必须满足）**：开局可操作 → 核心循环可重复 → 胜负/任务完成可到达 → 资产 png/webp 已引用`,
    formatGameIntentForCoder(ctx.intent),
    formatMechanicSpecForCoder(ctx.mechanic),
    formatCapabilityCatalogForCoder(ctx.mechanic?.modules),
    formatGameOpsForCoder(ctx.gameOps ?? []),
    formatRequirementsForCoder(ctx.requirements ?? null),
    sceneManifestForArchetype(ctx.archetype, ctx.gddSceneKeys, ctx.mechanic),
    moduleApiSummaryForArchetype(ctx.archetype, ctx.mechanic),
  ];
  if (ctx.gddSceneKeys.length > 0 && !ctx.worldSeedApplied) {
    parts.push(
      `- GDD Scene 清单（必须全部实现并注册 extraScenes）：${ctx.gddSceneKeys.join(', ')}`,
    );
  } else if (ctx.gddSceneKeys.length > 0) {
    parts.push(
      `- GDD 曾规划 Scene（${ctx.gddSceneKeys.join(', ')}）：以世界编译出的 scenes[].id 为准，GDD 名称仅作玩法参考`,
    );
  }
  if (ctx.gddMarkdown) {
    // The full GDD is already on disk as GAME_DESIGN.md and the pointer above
    // says so, so the prompt only needs enough to set direction. 4000 characters
    // of restated design was pure first-round weight.
    const parsed = Number.parseInt(
      process.env['PLATFORM_CODER_GDD_CHARS'] ?? '2000',
      10,
    );
    const gddCap = Number.isFinite(parsed) ? Math.max(0, parsed) : 2000;
    if (gddCap > 0) {
      parts.push(
        `- GDD 摘要（截断 ${gddCap} 字；完整见工作区 GAME_DESIGN.md）:\n${ctx.gddMarkdown.slice(0, gddCap)}`,
      );
    } else {
      parts.push('- GDD 全文见工作区 GAME_DESIGN.md（提示中不复述，以省 token）');
    }
    // Scene keys already listed above — only dump section when keys missing.
    if (ctx.gddSceneKeys.length === 0) {
      parts.push(extractSceneListFromGdd(ctx.gddMarkdown));
    }
  }
  if (ctx.worldStyleTip?.artStyle || ctx.worldStyleTip?.palette?.length) {
    const tip = ctx.worldStyleTip;
    parts.push(
      `- 项目世界美术锚点: artStyle=${tip.artStyle ?? '(unset)'}; mood=${tip.mood ?? ''}; palette=${(tip.palette ?? []).join(',')}`,
    );
    if (tip.narrativeSeed) {
      parts.push(`- narrativeSeed=${tip.narrativeSeed}（与世界 Presenter / ASSET_BRIEF 对齐）`);
    }
    if (tip.title) {
      parts.push(`- 关联世界: ${tip.title}`);
    }
    parts.push(
      '- 游戏 generate_game_assets 须与世界 style_anchor 保持同一视觉语义（勿另起一套调色）',
    );
  }
  parts.push(
    '- 禁止整盘复制模板关卡；用 module API 自由实现剧情/机制/数值',
  );
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('\n');
}

function sceneManifestForArchetype(
  archetype: GameArchetype,
  gddSceneKeys: readonly string[],
  mechanic?: MechanicSpec | null,
): string {
  if (
    mechanic?.modules.includes('board') &&
    mechanic.space === 'top_down'
  ) {
    return `- 混合规格：保留 World/Title；另注册 \`BoardTurnScene\` + \`@opengame/module-board\`，禁止删世界去换空格壳`;
  }
  if (mechanic?.modules.includes('match') && mechanic.space === 'top_down') {
    return `- 混合规格：保留 World/Title；另注册 \`Match3Scene\` + Match3Rules，禁止删世界去换空格壳`;
  }
  if (mechanic?.arcadeVariant === 'match3' || mechanic?.modules.includes('match')) {
    return `- 三消载体：\`Match3Scene\` + \`Match3Rules\`；禁止空格加分壳，不是消消乐成品工程`;
  }
  if (mechanic?.arcadeVariant === 'board_turn' || mechanic?.boardKind) {
    return `- 棋盘载体：\`BoardTurnScene\` 必须注册 extraScenes；规则 import \`@opengame/module-board\`；禁止空格加分壳`;
  }
  if (gddSceneKeys.length > 0) {
    return `- GDD 已规划 ${gddSceneKeys.length} 个 Scene — 在 src/scenes/ 实现并在 main.ts 注册`;
  }
  switch (archetype) {
    case 'ui_heavy':
      return `- 建议 Scene 类型：标题 / 对话或章节 / 战斗 / 结局（名称自定，≥3 个 *Scene.ts）`;
    case 'top_down':
      return `- 建议 Scene 类型：标题 / 世界或关卡 / 胜负（名称自定，≥3 个 *Scene.ts）`;
    case 'tower_defense':
      return `- 建议 Scene 类型：标题 / 塔防主循环 / 胜利或失败（名称自定）`;
    case 'platformer':
      return `- 建议 Scene 类型：标题 / 关卡 / 可选 GameOver（名称自定）`;
    case 'grid_logic':
      return `- 街机可用 game.json skills[]；棋类必须 Phaser Scene + extraScenes，禁止把载体当成品`;
    default:
      return `- 实现完整玩法循环与胜负条件`;
  }
}

function moduleApiSummaryForArchetype(
  archetype: GameArchetype,
  mechanic?: MechanicSpec | null,
): string {
  const lines = ['- 可 import 模块 API（按 MechanicSpec.modules 组合，不是按桶发一套）：'];
  const mods = new Set(mechanic?.modules ?? []);
  if (mods.has('dialogue') || archetype === 'ui_heavy') {
    lines.push(
      '  `@opengame/module-dialogue`: DialogueManager.loadDialogues / start / advance',
    );
  }
  if (mods.has('combat') || archetype === 'ui_heavy' || archetype === 'top_down') {
    lines.push(
      '  `@opengame/module-combat`: TurnManager phases + onPhaseEnter + onBattleEnd 回调',
    );
  }
  if (mods.has('world') || archetype === 'top_down' || archetype === 'tower_defense') {
    lines.push('  `@opengame/module-world`: WorldSceneHelper');
  }
  if (mods.has('td') || archetype === 'tower_defense') {
    lines.push('  `@opengame/module-td`: WaveManager + EconomyManager');
  }
  if (mods.has('systems')) {
    lines.push('  `@opengame/module-systems`: 背包 / 商店 / 合成 / 任务');
  }
  if (mods.has('board') || mechanic?.boardKind) {
    lines.push(
      '  `@opengame/module-board`: rulesForBoardKind / legalMoves / applyMove / winner（Scene 只演出）',
    );
  }
  if (mods.has('match')) {
    lines.push(
      '  `@opengame/module-board` Match3Rules：findMatches / legalSwaps / applySwap（三消能力，不是消消乐模板）',
    );
  }
  if (mods.has('cards')) {
    lines.push(
      '  `@opengame/module-cards`: createStarterDeck / draw / playCard / discardCard',
    );
  }
  if (mods.has('emitter')) {
    lines.push(
      '  `@opengame/module-emitter`: emitRadial / stepBullets / hitTest',
    );
  }
  if (archetype === 'platformer' || mods.has('platform')) {
    lines.push(
      '  `@opengame/module-platform`: PlatformSceneHelper / GameUiKit juice',
    );
  }
  if (archetype === 'grid_logic' && !mods.has('board')) {
    lines.push('  `@opengame/runtime` DSL：behaviors、skills[]（仅街机；棋类不要用空格 skills）');
  }
  lines.push('  `@opengame/runtime/dsl`: 根级 dialogue[] + scene.dialogueKey 由 DialogueRunner 执行');
  return lines.join('\n');
}

function extractSceneListFromGdd(gdd: string): string {
  const section = gdd.match(/(?:scene|场景)[\s\S]{0,1200}/i);
  if (!section) return '- GDD Scene 清单：请从 GAME_DESIGN.md 全文提取 key 与转换关系';
  return `- GDD Scene 片段（请全部实现并注册）：\n${section[0]!.slice(0, 800)}`;
}
