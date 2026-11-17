/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GameIntent, GameOp, MechanicSpec } from './types.js';

export function stampGddWithMechanicSpec(
  gdd: string,
  spec: MechanicSpec,
): string {
  if (/## MechanicSpec/i.test(gdd)) return gdd;
  const loops =
    spec.loops.length > 0
      ? spec.loops.map((l) => `- ${l.id}：${l.label}`).join('\n')
      : '- （未点名：实现可重复核心玩法 + 胜负）';
  return `${gdd.trim()}

## MechanicSpec（生成真相 — GDD 是说明书）
- space=${spec.space} time=${spec.time} input=${spec.input} win=${spec.win}
- modules: ${spec.modules.join(', ')}
- carrier: ${spec.arcadeVariant ?? 'none'}${spec.boardKind ? ` boardKind=${spec.boardKind}` : ''}
- extraScenes: ${(spec.extraScenes ?? []).join(', ') || '—'}
### Named loops
${loops}
`;
}

export function formatMechanicSpecForCoder(spec: MechanicSpec | null | undefined): string {
  if (!spec) return '';
  const loops =
    spec.loops.length > 0
      ? spec.loops.map((l) => `  - ${l.id}: ${l.label}`).join('\n')
      : '  - （提示未点名循环：实现可重复核心玩法 + 胜负）';
  const mixed =
    spec.space === 'top_down' && spec.modules.includes('board')
      ? '- 混合规格：世界是舞台，棋盘是绑定能力。禁止删 World/Title 去换空格壳。'
      : '';
  return [
    '【玩法规格 / MechanicSpec — 生成真相，archetype 只是镜头/物理提示】',
    `- space=${spec.space} time=${spec.time} input=${spec.input} win=${spec.win}`,
    `- modules: ${spec.modules.join(', ')}`,
    spec.boardKind ? `- boardKind=${spec.boardKind}（import @opengame/module-board）` : '',
    spec.arcadeVariant ? `- carrier=${spec.arcadeVariant}` : '',
    spec.extraScenes?.length
      ? `- extraScenes: ${spec.extraScenes.join(', ')}`
      : '',
    `- 必须实现的循环：\n${loops}`,
    '- 禁止把已播种的载体（空格加分 / 通用 Arcade）当成成品；只保留 juice 与 bootstrap，换上上述循环。',
    mixed,
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatGameIntentForCoder(intent: GameIntent | null | undefined): string {
  if (!intent) return '';
  return [
    '【GameIntent — 规划器发明的意图，MechanicSpec 由此合成】',
    `- redo=${intent.redo} mixed=${intent.mixed} board=${intent.boardKind ?? 'none'} arcadeHint=${intent.arcadeHint ?? 'none'}`,
    `- spaceHints=${intent.spaceHints.join('|') || '—'} timeHints=${intent.timeHints.join('|') || '—'}`,
    `- 点名循环种子：${intent.loopSeeds.map((l) => l.id).join(', ') || '（未点名）'}`,
  ].join('\n');
}

export function formatGameOpsForCoder(ops: readonly GameOp[]): string {
  if (!ops.length) return '';
  const lines = ops.map((op) => {
    if (op.op === 'add_loop') return `- add_loop ${op.loop.id}（${op.loop.label}）`;
    if (op.op === 'retarget_win') return `- retarget_win → ${op.win}`;
    if (op.op === 'bind_module') return `- bind_module ${op.module}`;
    if (op.op === 'retarget_space') return `- retarget_space → ${op.space}`;
    if (op.op === 'retarget_time') return `- retarget_time → ${op.time}`;
    if (op.op === 'retarget_input') return `- retarget_input → ${op.input}`;
    return `- add_scene ${op.sceneKey}`;
  });
  return [
    '【GameOps — 在已有规格上增量，禁止把缺的循环补成无关街机】',
    ...lines,
  ].join('\n');
}
