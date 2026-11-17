/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One tick of policy, opinion, and crowd state around the society walk.
 */

import { eq } from 'drizzle-orm';

import {
  loadDurableSocietyMind,
  persistSocietyMind,
  persistSocietyState,
  upsertSocietyMindTables,
  worlds,
  type DrizzleDb,
} from '@opengame/platform-db';
import {
  LLM_BUCKET_CAPS,
  takeLlmTokens,
  takeWorldLlmTokens,
  type LlmBucketRedis,
  type LlmLane,
} from '@opengame/platform-shared';
import {
  applyAppraisal,
  applyPolicyEffects,
  applyTalkOutcomes,
  appraisalPrompt,
  boardView,
  crowdLeadersFromOpinions,
  deriveCrowd,
  directStory,
  emptyMind,
  feedbackCollective,
  hydrateMind,
  insertCommitment,
  markPolicyAppraised,
  mindSnapshot,
  nextAppraisalBatch,
  noteTopic,
  noteUtterance,
  consumeSpotlight,
  openSpotlight,
  parseAppraisal,
  rewriteBeliefCard,
  sampleCrowdDots,
  stepCrowd,
  withEffectsApplied,
  type LlmTextFn,
  type OpinionBoard,
  type SocietyEvent,
  type SocietyMind,
  type SocietyState,
  type TalkOutcomes,
} from '@opengame/world-agents';

import type { TalkScheduler } from './talkScheduler.js';

const holders = new Map<string, SocietyMind>();

const mindOnByWorld = new Map<string, boolean>();

/**
 * Global demo env turns the layer on for every world.
 * Otherwise only worlds with `mind_enabled` participate.
 */
export function societyMindEnabled(world?: {
  readonly mindEnabled?: boolean | null;
}): boolean {
  if (process.env['PLATFORM_DEMO_OPEN_WORLD'] === '1') return true;
  if (process.env['OPENGAME_SOCIETY_MIND'] === '1') return true;
  return world?.mindEnabled === true;
}

export function noteMindWorld(
  worldId: string,
  world?: { readonly mindEnabled?: boolean | null },
): boolean {
  const on = societyMindEnabled(world);
  mindOnByWorld.set(worldId, on);
  return on;
}

export function mindOnFor(
  worldId: string,
  world?: { readonly mindEnabled?: boolean | null },
): boolean {
  if (world) return noteMindWorld(worldId, world);
  return mindOnByWorld.get(worldId) ?? false;
}

export async function saveTownMind(
  db: DrizzleDb,
  worldId: string,
  simTime: number,
  mind: SocietyMind,
): Promise<void> {
  const snapshot = mindSnapshot(mind);
  await persistSocietyMind(db, worldId, simTime, snapshot);
  await upsertSocietyMindTables(db, worldId, simTime, snapshot).catch((err) => {
    console.warn('[society-mind] table persist skipped', worldId, err);
  });
}

function bucketCaps() {
  const n = (name: string, fallback: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
  };
  return {
    appraisal: n('OPENGAME_LLM_BUCKET_APPRAISAL', LLM_BUCKET_CAPS.appraisal),
    talk: n('OPENGAME_LLM_BUCKET_TALK', LLM_BUCKET_CAPS.talk),
    reflect: n('OPENGAME_LLM_BUCKET_REFLECT', LLM_BUCKET_CAPS.reflect),
  };
}

export function mindFor(worldId: string): SocietyMind {
  return holders.get(worldId) ?? emptyMind();
}

function worldBucketCap(lane: LlmLane): number {
  const key =
    lane === 'appraisal'
      ? 'OPENGAME_LLM_WORLD_APPRAISAL'
      : lane === 'talk'
        ? 'OPENGAME_LLM_WORLD_TALK'
        : 'OPENGAME_LLM_WORLD_REFLECT';
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export async function takeTownLlm(
  redis: LlmBucketRedis | undefined,
  lane: LlmLane,
  cost = 1,
  worldId?: string,
): Promise<boolean> {
  if (worldId) {
    const worldOk = await takeWorldLlmTokens(
      redis,
      worldId,
      lane,
      cost,
      Date.now(),
      worldBucketCap(lane),
    );
    if (!worldOk) {
      await alertLlmCap(`${lane}:${worldId}`);
      return false;
    }
  }
  const ok = await takeLlmTokens(redis, lane, cost, Date.now(), bucketCaps());
  if (!ok) await alertLlmCap(lane);
  return ok;
}

async function alertLlmCap(lane: string): Promise<void> {
  if (process.env['PLATFORM_DEMO_OPEN_WORLD'] !== '1') return;
  console.error(`[llm-bucket] hard cap lane=${lane}`);
  const url = process.env['PLATFORM_ALERT_WEBHOOK_URL']?.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'opengame-platform-worker',
        metric: 'llm_bucket_hard_cap',
        lane,
        ts: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error('[llm-bucket] alert failed', err);
  }
}

function remember(worldId: string, mind: SocietyMind): SocietyMind {
  holders.set(worldId, mind);
  return mind;
}

export async function beginTownMind(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
  readonly state: SocietyState;
  readonly redis?: LlmBucketRedis;
  readonly llm?: LlmTextFn;
  readonly scheduler?: TalkScheduler;
}): Promise<SocietyEvent[]> {
  const loaded = hydrateMind(
    await loadDurableSocietyMind(input.db, input.worldId).catch(() => null),
  );
  let mind = loaded.crowd.length
    ? loaded
    : {
        ...loaded,
        crowd: deriveCrowd(
          input.state.agents.map((a) => ({
            id: a.id,
            name: a.name,
            occupation: a.occupation,
            regionId: a.regionId,
            stance: a.stance,
          })),
        ),
      };
  const topicId = mind.policies.at(-1)?.id;
  const leaders = crowdLeadersFromOpinions(
    mind.opinions,
    (id) => input.state.agents.find((a) => a.id === id)?.regionId,
    topicId,
  );
  mind = stepCrowd(mind, leaders, input.state.simTime);
  let lowAffinity = 0;
  for (const rel of input.state.relations.values()) {
    if ((rel.affinity ?? 0) < 0) lowAffinity += 1;
  }
  const signs = new Set(mind.opinions.map((o) => Math.sign(o.stance)));
  let deepTown = false;
  try {
    const [cog] = await input.db
      .select({ cognition: worlds.cognition })
      .from(worlds)
      .where(eq(worlds.id, input.worldId))
      .limit(1);
    deepTown = cog?.cognition === 'deep';
  } catch {
    deepTown = false;
  }
  const directed = deepTown
    ? { mind, event: undefined }
    : directStory(mind, {
        at: input.state.simTime,
        lowAffinityPairs: lowAffinity,
        stanceClash: signs.size > 1,
        openCommitments: mind.commitments.filter((c) => !c.planted).length,
      });
  mind = directed.mind;
  const events: SocietyEvent[] = directed.event ? [directed.event] : [];
  if (directed.event) {
    const beat = String(directed.event.payload['beat'] ?? '').trim();
    if (!beat) {
      /* arc without a line does not change anyone's day */
    } else {
    mind = openSpotlight(mind, beat, input.state.simTime);
    const hour = input.state.simTime % 24;
    for (const agent of input.state.agents.slice(0, 2)) {
      const plan = input.state.plans.get(agent.id);
      if (!plan) continue;
      input.state.plans.set(
        agent.id,
        insertCommitment(plan, { hour, activity: beat.slice(0, 40) }),
      );
    }
    }
  }
  const pendingFx = mind.policies.filter((p) => !p.effectsApplied);
  if (pendingFx.length) {
    const modelOk = input.llm
      ? await takeTownLlm(
          input.redis,
          'appraisal',
          Math.min(8, pendingFx.length),
          input.worldId,
        )
      : false;
    for (const policy of pendingFx) {
      await applyPolicyEffects({
        state: input.state,
        policy,
        ...(modelOk && input.llm ? { llm: input.llm } : {}),
        idFactory: () => `fx_${policy.id}_${input.state.simTime.toFixed(2)}`,
      });
      mind = withEffectsApplied(mind, policy.id);
    }
  }
  mind = plantCommitments(input.state, mind);
  remember(input.worldId, mind);
  await saveTownMind(input.db, input.worldId, input.state.simTime, mind).catch((err) => {
    console.warn('[society-mind] persist failed', input.worldId, err);
  });
  if (events.length) {
    await persistSocietyState(input.db, input.worldId, input.state, events, {
      omitPoses: true,
    }).catch(() => undefined);
  }
  queueAppraisal(input, mind);
  return events;
}

function queueAppraisal(
  input: {
    readonly db: DrizzleDb;
    readonly worldId: string;
    readonly state: SocietyState;
    readonly redis?: LlmBucketRedis;
    readonly llm?: LlmTextFn;
    readonly scheduler?: TalkScheduler;
  },
  mind: SocietyMind,
): void {
  const policy = mind.policies.find((p) => p.pending);
  if (!policy || !input.llm || !input.scheduler) return;
  const agents = input.state.agents.map((a) => ({
    id: a.id,
    name: a.name,
    occupation: a.occupation,
    regionId: a.regionId,
    stance: a.stance,
  }));
  const simTime = input.state.simTime;
  input.scheduler.enqueue(
    input.worldId,
    async () => {
      const allowed = await takeTownLlm(input.redis, 'appraisal', 1, input.worldId);
      if (!allowed || !input.llm) return;
      const fresh = hydrateMind(
        await loadDurableSocietyMind(input.db, input.worldId).catch(() => null),
      );
      const current = fresh.policies.find((p) => p.id === policy.id && p.pending);
      if (!current) return;
      const batch = nextAppraisalBatch(fresh, agents, current.id);
      let next = fresh;
      if (!batch.length) {
        next = {
          ...fresh,
          policies: fresh.policies.map((p) =>
            p.id === current.id ? { ...p, pending: false } : p,
          ),
        };
      } else {
        const raw = await input.llm(appraisalPrompt(current, batch));
        const rows = parseAppraisal(raw);
        if (!rows) return;
        next = applyAppraisal(fresh, current.id, rows, simTime);
        const tags = current.tags.map((t) => t.trim()).filter(Boolean);
        const poolSize = tags.length
          ? agents.filter((a) => {
              const hay = `${a.occupation ?? ''} ${a.regionId ?? ''} ${a.name}`;
              return tags.some((t) => hay.includes(t));
            }).length
          : agents.length;
        next = markPolicyAppraised(next, current.id, Math.max(1, poolSize));
      }
      remember(input.worldId, next);
      await saveTownMind(input.db, input.worldId, simTime, next);
    },
    { lane: 'appraisal' },
  );
}

export function plantCommitments(state: SocietyState, mind: SocietyMind): SocietyMind {
  const pending = mind.commitments.filter((c) => !c.planted);
  if (!pending.length && !mind.collective) return mind;
  const hour = state.simTime % 24;
  for (const c of pending) {
    const plan = state.plans.get(c.agentId);
    if (!plan) continue;
    state.plans.set(
      c.agentId,
      insertCommitment(plan, {
        hour,
        activity: c.action,
        locationId: c.regionId,
      }),
    );
    const agent = state.agents.find((a) => a.id === c.agentId);
    if (agent) agent.currentAction = c.action;
  }
  let next = mind;
  if (mind.collective && pending.length) {
    const spot = [...(state.anchors ?? []).values()].find((a) => a.kind === 'social');
    const gathered: string[] = [];
    for (const agent of state.agents) {
      if (agent.regionId !== mind.collective.regionId) continue;
      gathered.push(agent.id);
      if (!spot) continue;
      agent.goalX = spot.x;
      agent.goalY = spot.y;
      agent.goalPlace = spot.name ?? '广场';
      agent.goalReason = mind.collective.action;
    }
    next = feedbackCollective(mind, gathered, state.simTime);
  }
  return {
    ...next,
    commitments: next.commitments.map((c) => ({ ...c, planted: true })),
  };
}

export function absorbTalkOutcomes(
  worldId: string,
  outcomes: TalkOutcomes,
  people: ReadonlyArray<{ id: string; name: string; regionId?: string }>,
  topic: string,
  simTime: number,
): SocietyMind {
  let mind = consumeSpotlight(noteTopic(mindFor(worldId), topic), topic);
  mind = applyTalkOutcomes(mind, {
    outcomes,
    people,
    topicId: mind.policies.at(-1)?.id ?? topic.slice(0, 24),
    at: simTime,
  });
  for (const turn of outcomes.newFacts ?? []) {
    for (const person of people) {
      mind = noteUtterance(mind, person.id, turn).mind;
    }
  }
  return remember(worldId, mind);
}

export function absorbReflections(
  worldId: string,
  events: readonly SocietyEvent[],
): SocietyMind {
  let mind = mindFor(worldId);
  let changed = false;
  const beliefCards = { ...mind.beliefCards };
  for (const event of events) {
    if (event.kind !== 'reflection' || !event.agentId) continue;
    const text = event.payload['text'];
    if (typeof text !== 'string' || !text.trim()) continue;
    beliefCards[event.agentId] = rewriteBeliefCard(
      beliefCards[event.agentId] ?? '',
      text,
    );
    changed = true;
  }
  if (!changed) return mind;
  return remember(worldId, { ...mind, beliefCards });
}

export function townMindFrame(worldId: string): {
  opinion: OpinionBoard;
  crowd: ReturnType<typeof sampleCrowdDots>;
} {
  const mind = mindFor(worldId);
  return { opinion: boardView(mind), crowd: sampleCrowdDots(mind.crowd) };
}

export function townMindTalkOpts(worldId: string): {
  recentTopics: readonly string[];
  beliefCards: SocietyMind['beliefCards'];
  askOutcomes: boolean;
  spotlightTopic?: string;
} {
  const mind = mindFor(worldId);
  return {
    recentTopics: mind.recentTopics,
    beliefCards: mind.beliefCards,
    askOutcomes: mind.policies.some((p) => p.pending || p.appraisedIds.length > 0),
    ...(mind.spotlight?.text ? { spotlightTopic: mind.spotlight.text } : {}),
  };
}
