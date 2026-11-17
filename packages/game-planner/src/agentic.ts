/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * World-side agentic has WorldOps. Game-side: mutate MechanicSpec then tell
 * the coder to implement the new loop — never swap chess for snake.
 */

import { MODULE_CAPABILITY_SCENES, CAPABILITY_ENTRIES } from './catalog.js';
import { isRedoPrompt } from './detect.js';
import { extractCustomLoops } from './loops.js';
import type {
  GameOp,
  MechanicInput,
  MechanicModule,
  MechanicSpace,
  MechanicSpec,
  MechanicTime,
  MechanicWin,
} from './types.js';

const KNOWN_MODULES = new Set(CAPABILITY_ENTRIES.map((e) => e.id));
const KNOWN_WINS = new Set([
  'score',
  'flag',
  'checkmate',
  'quest',
  'survive',
  'custom',
]);
const KNOWN_SPACES = new Set(['side', 'top_down', 'grid', 'ui', 'path']);
const KNOWN_TIMES = new Set(['realtime', 'turn', 'step', 'wave']);
const KNOWN_INPUTS = new Set(['keys', 'pointer', 'cell-select', 'place', 'choice']);

function sceneForModule(module: MechanicModule): string | undefined {
  return MODULE_CAPABILITY_SCENES[module];
}

/** Drop illegal ops. retarget_* only survive when the user asked to 重做. */
export function sanitizeGameOps(
  ops: readonly GameOp[],
  ctx: { readonly redo: boolean },
): GameOp[] {
  const out: GameOp[] = [];
  const seen = new Set<string>();
  for (const op of ops) {
    if (
      (op.op === 'retarget_space' ||
        op.op === 'retarget_time' ||
        op.op === 'retarget_input') &&
      !ctx.redo
    ) {
      continue;
    }
    if (op.op === 'bind_module' && !KNOWN_MODULES.has(op.module)) continue;
    if (op.op === 'add_scene' && !/^[A-Za-z][A-Za-z0-9]*Scene$/.test(op.sceneKey)) {
      continue;
    }
    if (op.op === 'retarget_win' && !KNOWN_WINS.has(op.win)) continue;
    if (op.op === 'retarget_space' && !KNOWN_SPACES.has(op.space)) continue;
    if (op.op === 'retarget_time' && !KNOWN_TIMES.has(op.time)) continue;
    if (op.op === 'retarget_input' && !KNOWN_INPUTS.has(op.input)) continue;
    const key = JSON.stringify(op);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(op);
  }
  return out;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseOneOp(raw: unknown): GameOp | null {
  const o = asObject(raw);
  if (!o || typeof o.op !== 'string') return null;
  if (o.op === 'add_loop') {
    const loop = asObject(o.loop);
    if (!loop || typeof loop.id !== 'string' || typeof loop.label !== 'string') {
      return null;
    }
    const signals = Array.isArray(loop.signals)
      ? loop.signals.filter((s): s is string => typeof s === 'string')
      : [loop.label];
    if (signals.length === 0) return null;
    return {
      op: 'add_loop',
      loop: {
        id: loop.id.slice(0, 32),
        label: loop.label.slice(0, 24),
        signals,
        source: 'custom',
      },
    };
  }
  if (o.op === 'bind_module' && typeof o.module === 'string') {
    return { op: 'bind_module', module: o.module as MechanicModule };
  }
  if (o.op === 'add_scene' && typeof o.sceneKey === 'string') {
    return { op: 'add_scene', sceneKey: o.sceneKey };
  }
  if (o.op === 'retarget_win' && typeof o.win === 'string') {
    return { op: 'retarget_win', win: o.win as MechanicWin };
  }
  if (o.op === 'retarget_space' && typeof o.space === 'string') {
    return { op: 'retarget_space', space: o.space as MechanicSpace };
  }
  if (o.op === 'retarget_time' && typeof o.time === 'string') {
    return { op: 'retarget_time', time: o.time as MechanicTime };
  }
  if (o.op === 'retarget_input' && typeof o.input === 'string') {
    return { op: 'retarget_input', input: o.input as MechanicInput };
  }
  return null;
}

/** Parse a JSON array of GameOps from an LLM body. Invalid ops are dropped. */
export function parseProposedGameOps(text: string): GameOp[] {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = fence?.[1]?.trim() ?? trimmed;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseOneOp).filter((op): op is GameOp => op !== null);
  } catch {
    return [];
  }
}

export function applyGameOps(
  spec: MechanicSpec,
  ops: readonly GameOp[],
): MechanicSpec {
  let next = spec;
  const extraScenes = [...(spec.extraScenes ?? [])];
  for (const op of ops) {
    if (op.op === 'add_loop') {
      if (next.loops.some((l) => l.id === op.loop.id)) continue;
      next = { ...next, loops: [...next.loops, op.loop] };
    } else if (op.op === 'retarget_win') {
      next = { ...next, win: op.win };
    } else if (op.op === 'bind_module') {
      if (!next.modules.includes(op.module)) {
        next = { ...next, modules: [...next.modules, op.module] };
      }
      const boundScene = sceneForModule(op.module);
      if (boundScene && !extraScenes.includes(boundScene)) {
        extraScenes.push(boundScene);
      }
    } else if (op.op === 'add_scene') {
      if (!extraScenes.includes(op.sceneKey)) extraScenes.push(op.sceneKey);
    } else if (op.op === 'retarget_space') {
      next = { ...next, space: op.space };
    } else if (op.op === 'retarget_time') {
      next = { ...next, time: op.time };
    } else if (op.op === 'retarget_input') {
      next = { ...next, input: op.input };
    }
  }
  return {
    ...next,
    extraScenes,
    updatedAt: new Date().toISOString(),
  };
}

export function inferGameOpsFromPrompt(
  prompt: string,
  existing?: MechanicSpec | null,
): GameOp[] {
  const ops: GameOp[] = [];
  const redo = isRedoPrompt(prompt);
  const addLoop = (id: string, label: string, signals: readonly string[]) => {
    if (existing?.loops.some((l) => l.id === id)) return;
    ops.push({
      op: 'add_loop',
      loop: { id, label, signals, source: 'custom' },
    });
  };
  if (/加一个钓鱼|加上钓鱼|要能钓鱼/i.test(prompt)) {
    addLoop('fishing', '钓鱼', ['cast|抛竿', 'fish|钓鱼']);
    ops.push({ op: 'bind_module', module: 'systems' });
  }
  if (/加上对话|加对话选项|加分支/i.test(prompt)) {
    addLoop('dialogueChoice', '对话选项', ['ChoicePanel', 'selectChoice']);
    ops.push({ op: 'bind_module', module: 'dialogue' });
  }
  if (/加上商店|加商店|能买东西/i.test(prompt)) {
    addLoop('shop', '商店', ['shop|商店', 'buy|价格']);
    ops.push({ op: 'bind_module', module: 'systems' });
  }
  if (/加上消消乐|加上三消|加上 match-?3/i.test(prompt)) {
    addLoop('match3', '三消棋盘', ['Match3Rules|findMatches|applySwap', 'legalSwaps']);
    ops.push({ op: 'bind_module', module: 'match' });
    ops.push({ op: 'add_scene', sceneKey: 'Match3Scene' });
  }
  if (/加上卡牌|加上手牌|加上抽牌/i.test(prompt)) {
    addLoop('cards', '卡牌手牌', ['draw\\(|playCard|CardHand', 'hand']);
    ops.push({ op: 'bind_module', module: 'cards' });
    ops.push({ op: 'add_scene', sceneKey: 'CardsHandScene' });
  }
  if (/加上弹幕|加上发射器|加上 bullet/i.test(prompt)) {
    addLoop('danmaku', '弹幕发射', ['emitRadial|stepBullets|BulletEmitter', 'bullet']);
    ops.push({ op: 'bind_module', module: 'emitter' });
    ops.push({ op: 'add_scene', sceneKey: 'EmitterScene' });
  }
  if (/胜利改成将死|胜负改成将死|赢法改成将死/i.test(prompt)) {
    ops.push({ op: 'retarget_win', win: 'checkmate' });
    ops.push({ op: 'bind_module', module: 'board' });
  }
  if (/加上棋盘|改成象棋|加上象棋|加上中国象棋/i.test(prompt)) {
    addLoop('xiangqi', '中国象棋', ['XiangqiRules', 'legalMoves']);
    ops.push({ op: 'bind_module', module: 'board' });
    ops.push({ op: 'retarget_win', win: 'checkmate' });
    ops.push({ op: 'add_scene', sceneKey: 'BoardTurnScene' });
  }
  if (/加上五子棋|改成五子棋/i.test(prompt)) {
    addLoop('gomoku', '五子棋', ['GomokuRules', 'legalMoves']);
    ops.push({ op: 'bind_module', module: 'board' });
    ops.push({ op: 'add_scene', sceneKey: 'BoardTurnScene' });
  }
  for (const loop of extractCustomLoops(prompt, existing?.loops ?? [])) {
    addLoop(loop.id, loop.label, loop.signals);
  }
  if (redo) {
    if (/俯视|top[\s-]?down/i.test(prompt)) {
      ops.push({ op: 'retarget_space', space: 'top_down' });
    }
    if (/横版|侧视/i.test(prompt)) {
      ops.push({ op: 'retarget_space', space: 'side' });
    }
    if (/回合|轮流/i.test(prompt)) {
      ops.push({ op: 'retarget_time', time: 'turn' });
    }
  }
  const scene = /加上(\w+Scene)|add scene (\w+Scene)/i.exec(prompt);
  if (scene?.[1] || scene?.[2]) {
    ops.push({ op: 'add_scene', sceneKey: (scene[1] ?? scene[2])! });
  }
  return sanitizeGameOps(ops, { redo });
}
