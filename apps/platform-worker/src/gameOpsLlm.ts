/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Optional LLM refine of GameOps. Heuristic ops are the floor.
 * Never imports world-planner. Fail-soft.
 */

import {
  isRedoPrompt,
  parseProposedGameOps,
  sanitizeGameOps,
  type GameOp,
  type MechanicSpec,
} from '@opengame/game-planner';

export function shouldSkipGameOpsLlm(): boolean {
  const skip = process.env['PLATFORM_SKIP_GDD_LLM']?.trim().toLowerCase();
  if (skip === 'true' || skip === '1' || skip === 'yes') return true;
  const flag = process.env['PLATFORM_GAME_OPS_LLM']?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return true;
  return false;
}

export async function refineGameOpsWithLlm(
  prompt: string,
  spec: MechanicSpec | null,
  signal?: AbortSignal,
): Promise<readonly GameOp[]> {
  if (shouldSkipGameOpsLlm() || !spec) return [];
  const apiKey =
    process.env['OPENGAME_REASONING_API_KEY']?.trim() ||
    process.env['OPENAI_API_KEY']?.trim() ||
    process.env['MINIMAX_API_KEY']?.trim();
  const baseUrl = (
    process.env['OPENGAME_REASONING_BASE_URL']?.trim() ||
    process.env['OPENAI_BASE_URL']?.trim() ||
    ''
  ).replace(/\/$/, '');
  const model =
    process.env['OPENGAME_REASONING_MODEL']?.trim() ||
    process.env['OPENAI_MODEL']?.trim() ||
    '';
  if (!apiKey || !baseUrl || !model) return [];
  const redo = isRedoPrompt(prompt);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'Return ONLY a JSON array of GameOps. Allowed ops: add_loop, bind_module, add_scene, retarget_win. retarget_space/time/input only if the user said 重做. Modules: platform,dialogue,combat,td,world,systems,board,match,cards,emitter. Do not invent a sixth archetype. Do not swap chess for snake.',
          },
          {
            role: 'user',
            content: `Existing MechanicSpec: space=${spec.space} time=${spec.time} modules=${spec.modules.join(',')} loops=${spec.loops.map((l) => l.id).join(',')}\nFollow-up: ${prompt.slice(0, 800)}`,
          },
        ],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? '';
    return sanitizeGameOps(parseProposedGameOps(text), { redo });
  } catch {
    return [];
  }
}
