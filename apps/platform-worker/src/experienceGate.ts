/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Experience / layout / dialogue reachability heuristics for quality gates.
 */

import { validateDialogueGraph } from './storyOutline.js';

/** BFS reachability from first entry; reports unreachable + dangling nextIds. */
export function auditDialogueReachability(
  entries: Array<Record<string, unknown>>,
): string[] {
  const issues = validateDialogueGraph(entries);
  if (entries.length === 0) {
    issues.push('对话图为空');
    return issues;
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const e of entries) {
    if (typeof e['id'] === 'string') byId.set(e['id'], e);
  }
  const start = entries[0];
  const startId = typeof start?.['id'] === 'string' ? start['id'] : null;
  if (!startId || !byId.has(startId)) {
    issues.push('对话图缺少可解析的起始节点');
    return issues;
  }

  const visited = new Set<string>();
  const queue: string[] = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node) continue;
    const nid = node['nextId'];
    if (typeof nid === 'string' && nid.trim() && byId.has(nid.trim())) {
      queue.push(nid.trim());
    }
    if (node['type'] === 'choice' && Array.isArray(node['options'])) {
      for (const opt of node['options'] as Array<Record<string, unknown>>) {
        const on = opt['nextId'];
        if (typeof on === 'string' && on.trim() && byId.has(on.trim())) {
          queue.push(on.trim());
        }
      }
    }
  }

  for (const id of byId.keys()) {
    if (!visited.has(id) && !id.startsWith('iter_')) {
      issues.push(`对话节点不可达: ${id}`);
    }
  }

  // Choice coverage: every choice node should have ≥2 options
  for (const e of entries) {
    if (e['type'] !== 'choice') continue;
    const opts = Array.isArray(e['options']) ? e['options'] : [];
    if (opts.length < 2) {
      issues.push(`choice 节点 ${String(e['id'])} 选项少于 2`);
    }
  }

  return issues;
}

/**
 * Layout overflow heuristics on Scene TS sources.
 * Soft: naked large add.text without wordWrap; mid-screen long strings.
 */
export function auditSceneLayoutOverflow(sceneTsBlob: string): string[] {
  const issues: string[] = [];
  // Count add.text without wordWrap in the same object literal (approx)
  const textCalls = sceneTsBlob.match(/\.add\.text\s*\(/g) ?? [];
  const wrapCalls =
    sceneTsBlob.match(/wordWrap\s*:\s*\{[^}]*useAdvancedWrap/g) ?? [];
  const uiKit = /GameUiKit\.addDialoguePanel|GameUiKit\.addTitleStrip/.test(
    sceneTsBlob,
  );
  if (textCalls.length >= 4 && wrapCalls.length === 0 && !uiKit) {
    issues.push(
      '体验门禁: 多处 add.text 未见 wordWrap / GameUiKit（易文字溢出）',
    );
  }
  // Huge font without wrap
  if (
    /fontSize:\s*['"](?:3[2-9]|[4-9]\d|\d{3,})px['"]/.test(sceneTsBlob) &&
    !/wordWrap/.test(sceneTsBlob)
  ) {
    issues.push('体验门禁: 大字号文本缺少 wordWrap');
  }
  // Mid-screen dialogue without bottom panel heuristic
  if (
    /DialogueManager/.test(sceneTsBlob) &&
    !/GameUiKit\.addDialoguePanel|panelY\s*=\s*4\d{2}|H\s*-\s*1[234]\d/.test(
      sceneTsBlob,
    )
  ) {
    issues.push(
      '体验门禁: 对话 Scene 建议使用底栏面板（GameUiKit.addDialoguePanel）',
    );
  }
  if (
    /new ChoicePanel/.test(sceneTsBlob) &&
    !/wordWrap:\s*true|buttonHeight:\s*4[0-9]/.test(sceneTsBlob)
  ) {
    issues.push(
      '体验门禁: ChoicePanel 建议开启 wordWrap 并避免过矮按钮（中文易溢出）',
    );
  }
  if (
    /new ChoicePanel/.test(sceneTsBlob) &&
    /DialogueManager/.test(sceneTsBlob) &&
    !/setAlpha\(0\.\d+\)|dimDialogueForChoices|choices\.y\s*=|ChoicePanel\.stackY/.test(
      sceneTsBlob,
    )
  ) {
    issues.push(
      '体验门禁: 多选项时建议上移 ChoicePanel / 临时淡化底栏，避免与对话框重叠',
    );
  }
  if (
    /new ChoicePanel/.test(sceneTsBlob) &&
    /DialogueManager/.test(sceneTsBlob) &&
    !/choices\.on\(\s*['"]selected['"]|on\(\s*['"]selected['"].*selectChoice|selectChoice\s*\(/.test(
      sceneTsBlob,
    )
  ) {
    issues.push(
      '体验门禁: ChoicePanel 必须 on(selected) → dialogue.selectChoice，否则选项看起来无法点击',
    );
  }
  // Thin hand-rolled chrome (Skip etc.) clips CJK / steals poorly vs GameUiKit
  if (
    /\.rectangle\([^)]*,\s*3[02]\s*,/.test(sceneTsBlob) &&
    /Skip|跳过/.test(sceneTsBlob) &&
    !/addChromeButton/.test(sceneTsBlob)
  ) {
    issues.push(
      '体验门禁: Skip/跳过按钮建议用 GameUiKit.addChromeButton（避免矮条裁切中文且点不中）',
    );
  }
  if (
    /fixedHeight\s*:/.test(sceneTsBlob) &&
    (/DialogueManager|addDialoguePanel|setLine\(/.test(sceneTsBlob) ||
      /说话|对话|Narrator/.test(sceneTsBlob))
  ) {
    issues.push(
      '体验门禁: 对话正文禁止 fixedHeight（Phaser 会裁切汉字底部笔划）',
    );
  }
  return issues;
}
