/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The author takes one turn as a resident or an office, then the town answers.
 */

import { leanTowardStreet } from './civic.js';
import type { DeepWorld } from './deepWorld.js';
import { stepDeepMind, type DeepStep } from './stepDeep.js';
import { applyLedger } from './worldLedger.js';

export async function authorStepsIn(
  world: DeepWorld,
  input: { readonly who: string; readonly text: string },
  opts?: { readonly llm?: (prompt: string) => Promise<string> },
): Promise<DeepStep> {
  const line = input.text.trim().slice(0, 180);
  if (!line) return stepDeepMind(world, { maxLlmCalls: 0 });
  const agent = world.agents.find((row) => row.id === input.who || row.name === input.who);
  const inst = world.institutions.find((row) => row.id === input.who || row.name === input.who);
  let next: DeepWorld = {
    ...world,
    ledger: applyLedger(world.ledger, { fact: line }),
    writings: [
      ...world.writings,
      {
        simHour: world.simHour,
        authorId: agent?.id ?? inst?.id ?? 'author',
        authorName: agent?.name ?? inst?.name ?? '作者',
        kind: (inst ? 'notice' : 'letter') as 'notice' | 'letter',
        text: line,
      },
    ].slice(-40),
  };
  if (agent) {
    next = { ...next, monologues: { ...next.monologues, [agent.id]: line } };
  }
  if (inst) {
    next = {
      ...next,
      institutions: next.institutions.map((row) =>
        row.id === inst.id ? { ...row, publicLine: line, internalNote: line } : row,
      ),
    };
  }
  const harsher = /加收|强制|驱散|实弹|抓人/.test(line);
  const softer = /道歉|协商|缓一缓|提前通知|听证/.test(line);
  if ((harsher || softer) && next.conflict[0]) {
    const cell = next.conflict[0];
    next = {
      ...next,
      conflict: [
        {
          ...cell,
          grievance: Math.max(0, Math.min(1, cell.grievance + (harsher ? 0.08 : -0.07))),
          legitimacy: Math.max(0, Math.min(1, cell.legitimacy + (softer ? 0.06 : -0.04))),
          anger: Math.max(0, Math.min(1, cell.anger + (harsher ? 0.06 : -0.05))),
        },
        ...next.conflict.slice(1),
      ],
    };
    next = leanTowardStreet(next, 0.4);
  }
  return stepDeepMind(next, { maxLlmCalls: opts?.llm ? 1 : 0, ...(opts?.llm ? { llm: opts.llm } : {}) });
}
