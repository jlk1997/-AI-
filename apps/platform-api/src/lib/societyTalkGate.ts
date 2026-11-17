/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Paid 巷议 / 夜市 / 认养 must still land as memory when talks are muted.
 * MiniMax tails only run while someone is present and allowed to talk.
 */

import {
  pickSocietyLlmLane,
  societyTalkMuteReason,
} from '@opengame/platform-shared';

import {
  consumeEmergencySocietyTalk,
  reserveSocietyTalks,
  settleSocietyTalks,
  societyTalkBudgetOpen,
  type SocietyTalkBudgetRedis,
} from './societyTalkBudget.js';
import { stampPaidSocietyTrace, whisperSocietyLive } from './societyLive.js';
import type { DrizzleDb } from '@opengame/platform-db';

export type SocietyTalkLeaseRow = {
  readonly id: string;
  readonly specJson: unknown;
  readonly heartbeatUntil?: Date | string | null;
  readonly authorWatchUntil?: Date | string | null;
  readonly townTimeUntil?: Date | string | null;
  readonly lightUntil?: Date | string | null;
  readonly lightBonusPerHour?: number | null;
  readonly clockPaused?: boolean;
};

function talkLightOpts(world: SocietyTalkLeaseRow) {
  return {
    leaseBonus: world.lightBonusPerHour ?? 0,
    litUntil: world.lightUntil ?? null,
  };
}

export async function decideSocietyTalks(
  redis: SocietyTalkBudgetRedis | undefined,
  world: SocietyTalkLeaseRow,
  now = Date.now(),
): Promise<{
  readonly mute: ReturnType<typeof societyTalkMuteReason>;
  readonly allowTalks: boolean;
  readonly reserved: number;
  readonly lane: 'floor' | 'lit' | null;
}> {
  if (world.clockPaused) {
    return { mute: 'unwatched', allowTalks: false, reserved: 0, lane: null };
  }
  const light = talkLightOpts(world);
  const budgetOpen = await societyTalkBudgetOpen(redis, world.id, now, light);
  const mute = societyTalkMuteReason({
    presenceUntil: world.heartbeatUntil,
    authorWatchUntil: world.authorWatchUntil,
    townTimeUntil: world.townTimeUntil,
    clockPaused: world.clockPaused,
    budgetOpen,
    now,
  });
  if (mute) return { mute, allowTalks: false, reserved: 0, lane: null };
  const claimed = await reserveSocietyTalks(redis, world.id, 1, now, light);
  if (!claimed) return { mute: 'budget', allowTalks: false, reserved: 0, lane: null };
  return { mute: null, allowTalks: true, reserved: 1, lane: claimed };
}

export async function landTownStimulus(input: {
  readonly db: DrizzleDb;
  readonly redis?: SocietyTalkBudgetRedis;
  readonly world: SocietyTalkLeaseRow;
  readonly text: string;
  readonly agentKey?: string;
  readonly forceTown?: boolean;
  readonly adopt?: boolean;
  readonly importance?: number;
  readonly timeoutMs?: number;
  /** Night-market SKU: land in town, do not needle-match the course. */
  readonly courseNeutral?: boolean;
}): Promise<Awaited<ReturnType<typeof whisperSocietyLive>>> {
  const reservedAt = Date.now();
  const { allowTalks, reserved, lane } = await decideSocietyTalks(
    input.redis,
    input.world,
    reservedAt,
  );
  if (!allowTalks) {
    return stampPaidSocietyTrace({
      db: input.db,
      worldId: input.world.id,
      specJson: input.world.specJson,
      text: input.text,
      agentKey: input.agentKey,
      forceTown: input.forceTown,
      adopt: input.adopt,
      importance: input.importance,
      courseNeutral: input.courseNeutral,
    });
  }
  try {
    const { createOptionalSocietyLlm } = await import('./societyLlm.js');
    const llm = await createOptionalSocietyLlm({
      timeoutMs: input.timeoutMs ?? 18_000,
      lane: pickSocietyLlmLane({
        reserved: lane,
        litUntil: input.world.lightUntil,
        leaseBonus: input.world.lightBonusPerHour,
      }),
      consumeEmergency: () => consumeEmergencySocietyTalk(input.redis),
    });
    const live = await whisperSocietyLive({
      db: input.db,
      worldId: input.world.id,
      specJson: input.world.specJson,
      text: input.text,
      agentKey: input.agentKey,
      llm,
      forceTown: input.forceTown,
      adopt: input.adopt,
      importance: input.importance,
      courseNeutral: input.courseNeutral,
    });
    await settleSocietyTalks(
      input.redis,
      input.world.id,
      reserved,
      live.talksStarted,
      reservedAt,
      lane ?? 'floor',
      talkLightOpts(input.world),
    );
    return live;
  } catch (err) {
    await settleSocietyTalks(
      input.redis,
      input.world.id,
      reserved,
      0,
      reservedAt,
      lane ?? 'floor',
      talkLightOpts(input.world),
    );
    throw err;
  }
}
