/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * User-facing recovery after FIX abort / hard quality failures —
 * so chat + failed-job panel show actionable next steps, not raw gate dumps.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { ChangePlan } from './changePlan.js';

export interface JobRecoveryManifest {
  readonly schema: 'opengame-job-recovery-v1';
  readonly kind:
    | 'change_plan_abort'
    | 'quality_gate'
    | 'requirement_gap'
    | 'generic';
  readonly userSummary: string;
  readonly issues: readonly string[];
  readonly suggestedPrompts: readonly string[];
  readonly changePlanSummary?: string | null;
  readonly at: string;
}

export function jobRecoveryPath(workspace: string): string {
  return path.join(workspace, 'public', 'RECOVERY.json');
}

function suggestFromChangePlan(plan: ChangePlan | null): string[] {
  const out: string[] = [];
  if (plan?.addBoss) {
    out.push(
      '在主关卡明确生成一个带 BOSS 标签的敌人（保留 PlatformSceneHelper / bossPresent）',
    );
  }
  if (plan?.difficulty === 'harder') {
    out.push('把敌人数量和 HP 再提高一档，并写入 game.json tunables');
  }
  if (plan?.artStyle) {
    out.push(
      `强制重生「${plan.artStyle}」画风资产，确认角色/背景用了 spriteOrRect 真图`,
    );
  }
  if (plan?.addScene) {
    out.push('新增一关可玩 Scene，并注册到 extraScenes');
  }
  if (plan?.addDialogue) {
    out.push(
      '点名场景或 NPC（例如「给 ChapterScene / 铁匠加三句」），优先改 public/story/*.json',
    );
  }
  if (plan?.targetSceneId) {
    out.push(
      `明确只改 ${plan.targetSceneId}（可写「别动 Title / 其他关」），避免整盘重写`,
    );
  } else if (plan?.editLevel) {
    out.push('请点名要改的关卡（第1关 / Level1Scene / TitleScene）后再试');
  }
  if (out.length === 0) {
    out.push('用更具体的一句话重述改动（例如：更难+Boss / 赛博画风 / 第2关加对话）后重试');
  }
  out.push('或点失败任务「重试」；仍不行可先说「重做」清空后再生成');
  return out.slice(0, 4);
}

export function buildChangePlanAbortRecovery(
  plan: ChangePlan | null,
  issues: readonly string[],
): JobRecoveryManifest {
  const intentBits: string[] = [];
  if (plan?.addBoss) intentBits.push('加 Boss');
  if (plan?.difficulty === 'harder') intentBits.push('更难');
  if (plan?.artStyle) intentBits.push(`画风「${plan.artStyle}」`);
  if (plan?.addScene) intentBits.push('加关卡');
  if (plan?.addDialogue) intentBits.push('加对话');
  if (plan?.targetSceneId) intentBits.push(`定位 ${plan.targetSceneId}`);
  if (plan?.editLevel) intentBits.push('改关卡');
  const intent =
    intentBits.length > 0 ? intentBits.join(' · ') : plan?.summary || '改口需求';
  return {
    schema: 'opengame-job-recovery-v1',
    kind: 'change_plan_abort',
    userSummary: `你的改口（${intent}）连续自愈后仍未在玩法/美术里落地，已停止空转。预览可能仍是上一版可玩状态。`,
    issues: issues.filter((i) => i.includes('ChangePlan')).slice(0, 8),
    suggestedPrompts: suggestFromChangePlan(plan),
    changePlanSummary: plan?.summary ?? null,
    at: new Date().toISOString(),
  };
}

/** Recovery when narrative / quality gates fail (missing bible, thin cast, etc.). */
export function buildNarrativeQualityRecovery(
  issues: readonly string[],
): JobRecoveryManifest {
  const narrative = issues.filter((i) => /叙事|对话|STORY|chapter|NPC|任务/i.test(i));
  const prompts = [
    '再说具体一点：给哪个角色加几句台词？（例如「给铁匠加三句，别动 Title」）',
    '补齐短篇设定：至少 2 个可对话角色 + 1 条任务，并说明选项如何影响结局',
    '若首局太薄：直接说「做一个小镇剧情：3 NPC、2 任务、对话选项影响结局」',
  ];
  return {
    schema: 'opengame-job-recovery-v1',
    kind: 'quality_gate',
    userSummary:
      narrative.length > 0
        ? '剧情内容还不够完整（角色 / 任务 / 对话分支），按下面建议改一句再试。'
        : '内容质量未达标，请按建议修正后重试。',
    issues: (narrative.length ? narrative : issues).slice(0, 8),
    suggestedPrompts: prompts,
    at: new Date().toISOString(),
  };
}

/**
 * Recovery when a mechanic the user named never appeared in the build.
 *
 * Worth its own message: unlike a gate the user never asked about, this is the
 * one failure they will notice immediately, so it names the missing feature and
 * offers a prompt that describes it as a loop the coder can implement.
 */
export function buildRequirementGapRecovery(
  issues: readonly string[],
): JobRecoveryManifest {
  const gaps = issues.filter((i) => i.startsWith('需求未落地'));
  const labels = gaps
    .map((i) => /^需求未落地:\s*([^—]+)/.exec(i)?.[1]?.trim())
    .filter((l): l is string => Boolean(l));
  const named = labels.slice(0, 3).join('、');
  return {
    schema: 'opengame-job-recovery-v1',
    kind: 'requirement_gap',
    userSummary: named
      ? `已交付可玩版本，但你点名的玩法（${named}）多轮自愈后仍未落地，已停止空转以保住当前可玩版本。`
      : '已交付可玩版本，但部分点名玩法未能落地，已停止空转。',
    issues: (gaps.length ? gaps : issues).slice(0, 8),
    suggestedPrompts: [
      ...labels
        .slice(0, 2)
        .map(
          (l) =>
            `把「${l}」拆成可操作的小循环再说一次（触发键 → 过程反馈 → 结算奖励）`,
        ),
      '或指定它出现在哪个场景（例如「在码头场景加钓鱼，按 E 抛竿」）',
      '也可以先玩当前版本，再用一句话补这一个玩法',
    ].slice(0, 4),
    at: new Date().toISOString(),
  };
}

/** Compact multi-line message stored in jobs.log_key + FAIL event. */
export function formatRecoveryLogMessage(
  recovery: JobRecoveryManifest,
): string {
  const lines = [
    recovery.kind === 'change_plan_abort'
      ? 'ChangePlan 未落地（已停止空转 FIX）'
      : recovery.kind === 'quality_gate'
        ? '内容门禁未通过（可恢复）'
        : recovery.kind === 'requirement_gap'
          ? '点名玩法未落地（已保住可玩版本）'
          : '任务失败（可恢复）',
    recovery.userSummary,
    '建议下一句：',
    ...recovery.suggestedPrompts.map((p, i) => `${i + 1}. ${p}`),
  ];
  if (recovery.issues.length) {
    lines.push(`门禁摘要: ${recovery.issues.slice(0, 3).join('；')}`);
  }
  return lines.join('\n');
}

export async function writeJobRecovery(
  workspace: string,
  recovery: JobRecoveryManifest,
): Promise<string> {
  const dir = path.join(workspace, 'public');
  await fsp.mkdir(dir, { recursive: true });
  const full = jobRecoveryPath(workspace);
  await fsp.writeFile(full, JSON.stringify(recovery, null, 2), 'utf8');
  return full;
}

export function readJobRecovery(workspace: string): JobRecoveryManifest | null {
  const full = jobRecoveryPath(workspace);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8')) as JobRecoveryManifest;
  } catch {
    return null;
  }
}
