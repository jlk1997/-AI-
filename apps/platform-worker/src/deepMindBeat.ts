/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One deep step outside the walk lock, plus one queued forecast if any.
 */

import {
  claimForecast,
  finishForecast,
  loadSocietyAgents,
  loadSocietyLiveTip,
  persistSocietyEvents,
  readCognition,
  readDeepState,
  writeDeepBundle,
  type DrizzleDb,
} from '@opengame/platform-db';
import {
  deepDtHours,
  hydrateDeepWorld,
  looksSoftened,
  nearestCase,
  runEnsemble,
  seedDeepWorld,
  stepDeepMind,
  type DeepWorld,
  type ForecastScenario,
} from '@opengame/world-agents';
import { createSocietyLlmFn, deepSocietyModels } from '@opengame/world-planner';

type Llm = (prompt: string) => Promise<string>;

const lastSpoken = new Map<string, string>();

let deepLlm: Llm | undefined;
let deepLlmTried = false;

async function llmForDeep(): Promise<Llm | undefined> {
  if (deepLlmTried) return deepLlm;
  deepLlmTried = true;
  const models = deepSocietyModels();
  const fns = (models.length ? models : [undefined]).map((model) =>
    createSocietyLlmFn({
      thinking: 'enabled',
      temperature: 0.8,
      ...(model ? { model } : {}),
    }),
  );
  const emergency = createSocietyLlmFn({
    lane: 'lit',
    allowEmergency: true,
    thinking: 'enabled',
  });
  const chain = [...fns, emergency].filter((fn): fn is Llm => Boolean(fn));
  if (!chain.length) return undefined;
  deepLlm = async (prompt) => {
    let last = '';
    for (const fn of chain) {
      try {
        const text = await fn(prompt);
        if (text.trim() && !looksSoftened(text)) return text;
        last = text;
      } catch {
        /* try the next model */
      }
    }
    return last;
  };
  return deepLlm;
}

function bundleOf(world: DeepWorld, actions: ReadonlyArray<{ agentId?: string; text: string; payload?: Record<string, unknown> }>) {
  return {
    state: world,
    psyches: Object.values(world.psyches).map((psyche) => ({
      agentKey: psyche.agentId,
      psyche,
    })),
    institutions: world.institutions.map((inst) => ({
      key: inst.id,
      kind: inst.kind,
      name: inst.name,
      body: inst,
    })),
    chronicle: world.chronicle.map((row) => ({
      simTime: row.simHour,
      text: row.text,
      surprise: row.surprise,
    })),
    actions: actions
      .filter((event) => event.payload?.['intent'] || event.payload?.['monologue'])
      .map((event) => ({
        agentKey: event.agentId ?? '',
        simTime: world.simHour,
        intent: String(event.payload?.['intent'] ?? ''),
        action: event.text,
        monologue: String(event.payload?.['monologue'] ?? ''),
        isPublic: true,
      })),
    ledger: world.ledger,
    ledgerSimTime: world.simHour,
  };
}

export async function runDeepMindBeat(input: {
  readonly db: DrizzleDb;
  readonly worldId: string;
}): Promise<void> {
  const cog = await readCognition(input.db, input.worldId);
  if (cog?.cognition !== 'deep') return;
  const loaded = hydrateDeepWorld(await readDeepState(input.db, input.worldId));
  let world = loaded;
  if (!world) {
    const agents = await loadSocietyAgents(input.db, input.worldId);
    world = seedDeepWorld({
      seed: input.worldId.length,
      core: Math.min(24, Math.max(12, agents.length || 12)),
      agents: agents.slice(0, 24).map((agent) => ({
        id: agent.id,
        name: agent.name,
        regionId: agent.regionId,
        identity: agent.identitySummary,
      })),
    });
  }
  const llm = await llmForDeep();
  const bucket = new Date().toISOString().slice(0, 13);
  const tip = await loadSocietyLiveTip(input.db, input.worldId).catch(() => null);
  const stepped = await stepDeepMind(world, {
    dtHours: deepDtHours(),
    maxLlmCalls: llm ? 1 : 0,
    budgetBucket: bucket,
    ...(llm ? { llm } : {}),
  });
  const hourChanged = Math.floor(stepped.world.simHour) !== Math.floor(world.simHour);
  const chronicleChanged = stepped.world.chronicle.length !== world.chronicle.length;
  const instChanged = stepped.world.institutions.some(
    (inst, index) =>
      inst.id !== world.institutions[index]?.id ||
      inst.name !== world.institutions[index]?.name ||
      inst.people !== world.institutions[index]?.people ||
      inst.publicLine !== world.institutions[index]?.publicLine,
  );
  const bundle = bundleOf(
    stepped.world,
    stepped.events.map((event) => ({
      agentId: event.agentId,
      text: event.text,
      payload: event.payload,
    })),
  );
  await writeDeepBundle(input.db, input.worldId, {
    state: bundle.state,
    ...(hourChanged
      ? { psyches: bundle.psyches, ledger: bundle.ledger, ledgerSimTime: bundle.ledgerSimTime }
      : {}),
    ...(chronicleChanged ? { chronicle: bundle.chronicle } : {}),
    ...(instChanged || stepped.world.institutions.length !== world.institutions.length
      ? { institutions: bundle.institutions }
      : {}),
    ...(bundle.actions.length ? { actions: bundle.actions } : {}),
  });
  const line = stepped.world.agents
    .map((agent) => {
      const raw = stepped.world.monologues[agent.id] ?? '';
      const body = raw.includes('。') ? raw.slice(raw.indexOf('。') + 1).trim() : raw.trim();
      if (body.length < 4) return null;
      return { name: agent.name, text: body.slice(0, 80), agentId: agent.id };
    })
    .find((row) => row && lastSpoken.get(`${input.worldId}:${row.name}`) !== row.text);
  if (line) {
    lastSpoken.set(`${input.worldId}:${line.name}`, line.text);
    const townTime = tip && tip.simTime > 0 ? tip.simTime : stepped.world.simHour;
    let talkSeq = 1;
    for (const event of tip?.recentEvents ?? []) {
      const n = Number(event.payload?.['talkSeq']);
      if (Number.isFinite(n) && n >= talkSeq) talkSeq = n + 1;
    }
    await persistSocietyEvents(input.db, input.worldId, [
      {
        id: `deep-say-${input.worldId.slice(0, 8)}-${Math.round(townTime * 10)}-${line.name}`,
        simTime: townTime,
        kind: 'dialogue',
        agentId: line.agentId,
        payload: {
          participants: [line.agentId],
          turns: [{ speakerId: line.agentId, speakerName: line.name, text: line.text }],
          summary: line.text,
          spreadCount: 0,
          degraded: false,
          source: 'deep',
          talkSeq,
          circleIndex: 1,
        },
      },
    ]).catch(() => undefined);
  }
}

export async function runOneForecastJob(db: DrizzleDb): Promise<boolean> {
  const job = await claimForecast(db);
  if (!job) return false;
  try {
    const scenario = (job.spec ?? {}) as ForecastScenario;
    const near = nearestCase({
      grievance: scenario.grievance ?? 0.4,
      legitimacy: scenario.legitimacy ?? 0.5,
      liveFire: Boolean(scenario.liveFire),
      noticeHours: scenario.noticeHours ?? 0,
    });
    const report = await runEnsemble(scenario, {
      seed: job.id.length * 17,
      deepRuns: 1,
      fastRuns: 96,
      llmBudget: 0,
      calibrated: !near.extrapolated,
    });
    await finishForecast(db, job.id, report);
  } catch (err) {
    await finishForecast(db, job.id, null, err instanceof Error ? err.message : String(err));
  }
  return true;
}
