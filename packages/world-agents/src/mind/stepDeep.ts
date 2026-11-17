/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One beat of a deep town. The model is optional. Without it, people still
 * act from their own state, and nobody is given a stock line to say.
 */

import { heuristicAdjudicate, parseAdjudication, adjudicatePrompt } from './adjudicate.js';
import { rungLabel, rungName, stepConflict, applyHarm, violent } from './conflict.js';
import { writeChronicle } from './chronicle.js';
import { runDialogue } from './dialogue.js';
import { deliberatePrompt, heuristicAction, parseDeliberation, type OpenAction } from './deliberate.js';
import type { DeepWorld } from './deepWorld.js';
import { rollFate } from './fate.js';
import { chooseResponse, comply, mediaLine, type Order } from './institutions.js';
import { consolidateNight, maybeDistort, memoryWeight, rankMemories, type SubjectiveMemory } from './memoryV2.js';
import { nextBoredom, noveltyScore, topicKey } from './novelty.js';
import { rollIncident, rollOutcome, type OutcomeRoll } from './outcomes.js';
import { deepCallsPerHour, salience, selectCore, takeCall } from './pacing.js';
import { believeAbout, decayEmotions, shockEmotion, type Psyche } from './psyche.js';
import { hashSeed, mulberry32 } from './rng.js';
import { stepLife } from './life.js';
import { closeDay, nameCrowd } from './civic.js';
import { applyLedger } from './worldLedger.js';

export type DeepEvent = {
  readonly simHour: number;
  readonly kind: 'fate' | 'order' | 'action' | 'casualty' | 'dialogue' | 'chronicle' | 'conflict';
  readonly agentId?: string;
  readonly text: string;
  readonly payload?: Record<string, unknown>;
};

export type DeepStep = {
  readonly world: DeepWorld;
  readonly events: readonly DeepEvent[];
  readonly llmCalls: number;
  readonly softened: number;
};

function remember(
  world: DeepWorld,
  agentId: string,
  text: string,
  trauma: boolean,
  rng: () => number,
): Record<string, readonly SubjectiveMemory[]> {
  const psyche = world.psyches[agentId];
  if (!psyche) return world.memories;
  const warped = maybeDistort(text, rng, trauma);
  const row: SubjectiveMemory = {
    id: `m_${agentId}_${Math.floor(world.simHour * 10)}_${world.memories[agentId]?.length ?? 0}`,
    text: warped.text,
    hour: world.simHour,
    weight: memoryWeight(text, psyche),
    trauma,
    distorted: warped.distorted,
  };
  const prev = world.memories[agentId] ?? [];
  return { ...world.memories, [agentId]: [...prev, row].slice(-30) };
}

export async function stepDeepMind(
  world: DeepWorld,
  opts?: {
    readonly llm?: (prompt: string) => Promise<string>;
    readonly maxLlmCalls?: number;
    readonly dtHours?: number;
    readonly budgetBucket?: string;
  },
): Promise<DeepStep> {
  const dt = opts?.dtHours ?? 1;
  const rng = mulberry32(hashSeed(`${world.seed}:${world.simHour.toFixed(2)}`));
  const events: DeepEvent[] = [];
  let llmCalls = 0;
  let softened = 0;
  const bucket = opts?.budgetBucket ?? String(Math.floor(world.simHour / 24));
  let calls = world.usage.bucket === bucket ? world.usage.calls : 0;
  const cap = Math.min(opts?.maxLlmCalls ?? deepCallsPerHour(), deepCallsPerHour());
  const ask = async (prompt: string): Promise<string | null> => {
    if (!opts?.llm) return null;
    const slot = takeCall({ bucket, calls, cap });
    if (!slot.ok) return null;
    calls = slot.calls;
    llmCalls += 1;
    try {
      const text = await opts.llm(prompt);
      if (!text.trim()) return null;
      return text;
    } catch {
      return null;
    }
  };

  let next: DeepWorld = {
    ...world,
    simHour: world.simHour + dt,
    psyches: { ...world.psyches },
    memories: { ...world.memories },
    monologues: { ...world.monologues },
    recentLines: [...world.recentLines],
    topicCounts: { ...world.topicCounts },
  };
  const cell0 = next.conflict[0] ?? {
    regionId: 'town',
    grievance: 0.3,
    fear: 0.2,
    anger: 0.2,
    efficacy: 0.4,
    legitimacy: 0.5,
    identity: 0.4,
    visible: 0,
    rung: 0,
    mobilized: 0,
    population: next.population,
    deaths: 0,
    injured: 0,
    rumorHeat: 0,
    thresholdMean: 0.45,
  };
  const tension = cell0.grievance * 0.5 + cell0.anger * 0.3 + cell0.rung / 10;
  const fate = rollFate({
    simHour: next.simHour,
    economy: next.economy,
    tension,
    cell: cell0,
    rng,
  });
  if (fate) {
    events.push({ simHour: next.simHour, kind: 'fate', text: fate.text });
    if (fate.priceKey && fate.price) {
      next = {
        ...next,
        ledger: applyLedger(next.ledger, { price: { key: fate.priceKey, value: fate.price }, fact: fate.text }),
      };
    }
    if (fate.kind === 'weather') next = { ...next, weather: fate.text.includes('雨') ? 'rain' : 'hot' };
    if (fate.grievanceDelta) {
      next = {
        ...next,
        conflict: next.conflict.map((c, i) =>
          i === 0 ? { ...c, grievance: Math.max(0, Math.min(1, c.grievance + (fate.grievanceDelta ?? 0))) } : c,
        ),
      };
    }
  }

  const police = next.institutions.find((i) => i.kind === 'police') ?? next.institutions[0];
  const street = next.conflict[0] ?? cell0;
  let response: Order['response'] = 'none';
  if (police && street.rung >= 2) {
    const pressure = street.grievance * 0.5 + street.anger * 0.3 + (1 - street.legitimacy) * 0.2;
    response = chooseResponse(police, pressure);
    const head = police.headId ? next.psyches[police.headId] : undefined;
    const order: Order = {
      fromId: police.id,
      text: `按预案处理：${response}`,
      response,
      regionId: police.regionId,
    };
    const how = head ? comply(order, head, rng) : 'obey';
    if (how === 'escalate' && response === 'dialogue') response = 'disperse';
    if (how === 'refuse') response = 'none';
    const told = mediaLine(order.text, fate?.text ?? '', rng);
    const shown = how === 'conceal' ? '现场已经控制' : told.street;
    events.push({
      simHour: next.simHour,
      kind: 'order',
      text: `${police.name}：${order.text}。执行：${how}。街上听到的是：${shown}`,
      payload: { response, compliance: how },
    });
  }

  let cell = stepConflict(street, {
    response,
    rumor: fate?.rumor ?? 0,
    trigger: fate?.kind === 'accident' ? 'weather' : 'none',
  });

  const thinkers = selectCore(
    next.agents.filter((a) => a.core && !a.away && next.psyches[a.id]),
    (a) => salience(next.psyches[a.id]!, cell),
    4,
  );
  for (const agent of thinkers) {
    const psyche = decayEmotions(next.psyches[agent.id]!, dt);
    const mems = rankMemories(next.memories[agent.id] ?? [], psyche).map((m) => m.text);
    const situation = [fate?.text, `镇上这会儿是${rungLabel(cell.rung)}`].filter(Boolean).join('。');
    const raw = await ask(deliberatePrompt({ name: agent.name, psyche, situation, memories: mems }));
    const parsed = raw ? parseDeliberation(raw) : null;
    if (raw && !parsed) softened += 1;
    const thought = parsed ?? heuristicAction(psyche, situation, hashSeed(agent.id) + Math.floor(next.simHour));
    const action: OpenAction = thought.action;
    const adjRaw = raw && parsed ? await ask(adjudicatePrompt(action, situation)) : null;
    const judged = adjRaw ? parseAdjudication(adjRaw, action) : null;
    if (adjRaw && !judged) softened += 1;
    const verdict = judged ?? heuristicAdjudicate(action, Math.max(8, Math.round(cell.mobilized * 0.05)));
    let note = `${agent.name}：${action.what}`;
    if (verdict.needsPhysical && verdict.contact > 0) {
      const roll: OutcomeRoll = rollOutcome(
        {
          kind: verdict.kind,
          peopleInContact: verdict.contact,
          place: action.place || agent.regionId,
          cause: verdict.narrative,
          simHour: next.simHour,
          casualtyScale: next.casualtyScale,
          ctx: {
            density: cell.visible > 0.35 ? 'crowd' : 'sparse',
            minutes: dt * 60,
            medicalAccess: next.institutions.some((i) => i.kind === 'hospital' && i.medical > 0.3),
            noticeHours: 0,
            weather: next.weather === 'rain' ? 'rain' : next.weather === 'hot' ? 'hot' : 'clear',
          },
        },
        rng,
      );
      cell = applyHarm(cell, { dead: roll.dead, injured: roll.light + roll.serious });
      if (roll.dead > 0) cell = stepConflict(cell, { trigger: 'death' });
      note = roll.report;
      events.push({ simHour: next.simHour, kind: 'casualty', agentId: agent.id, text: roll.report });
      next = {
        ...next,
        psyches: {
          ...next.psyches,
          [agent.id]: shockEmotion(psyche, {
            anger: roll.dead ? 0.2 : 0.05,
            fear: roll.dead ? 0.15 : 0.04,
            grievance: roll.dead ? 0.08 : 0,
            legitimacy: roll.dead ? -0.1 : 0,
          }),
        },
      };
    }
    const key = topicKey(action.what);
    const same = (next.topicCounts[key] ?? 0) > 0;
    const bored = nextBoredom(psyche.boredom, same);
    next = {
      ...next,
      monologues: { ...next.monologues, [agent.id]: thought.monologue },
      psyches: {
        ...next.psyches,
        [agent.id]: { ...(next.psyches[agent.id] ?? psyche), boredom: bored },
      },
      topicCounts: { ...next.topicCounts, [key]: (next.topicCounts[key] ?? 0) + 1 },
      ledger: verdict.patches.reduce((led, patch) => applyLedger(led, patch), next.ledger),
    };
    if (noveltyScore(note, next.recentLines) >= 0.12) {
      events.push({
        simHour: next.simHour,
        kind: 'action',
        agentId: agent.id,
        text: note,
        payload: { intent: thought.intent, force: action.force, monologue: thought.monologue },
      });
      next = {
        ...next,
        recentLines: [...next.recentLines, note].slice(-24),
        memories: remember(next, agent.id, note, /死|伤/.test(note), rng),
      };
    }
    const onPaper = /字条|信|记下|写给/.test(action.what);
    if ((action.public || onPaper) && (onPaper || rng() < 0.55)) {
      const kind: 'notice' | 'diary' | 'post' = onPaper ? 'post' : cell.rung >= 2 ? 'notice' : 'diary';
      const text = `${agent.name}：${action.what}`;
      const reader = next.agents.find((row) => row.id !== agent.id && !row.away);
      next = {
        ...next,
        writings: [
          ...(next.writings ?? []),
          {
            simHour: next.simHour,
            authorId: agent.id,
            authorName: agent.name,
            kind,
            text,
          },
        ].slice(-40),
        ...(reader
          ? { memories: remember(next, reader.id, `看到${agent.name}写下：${action.what}`, false, rng) }
          : {}),
      };
    }
    if (cell.rumorHeat > 0.4) {
      next = {
        ...next,
        psyches: {
          ...next.psyches,
          [agent.id]: believeAbout(next.psyches[agent.id]!, police?.id ?? 'police', {
            wants: rng() < 0.5 ? '把人驱散' : '先谈',
            knows: '不一定知道现场死了没有',
            towardMe: '把我当麻烦',
            confidence: 0.3,
          }),
        },
      };
    }
  }

  if (opts?.llm && llmCalls < cap && thinkers.length >= 2) {
    const pair = thinkers.slice(0, 2).map((a) => ({
      id: a.id,
      name: a.name,
      psyche: next.psyches[a.id]!,
    }));
    const talk = await runDialogue(
      { people: pair, situation: fate?.text ?? rungName(cell.rung), recentLines: next.recentLines, maxTurns: 4 },
      async (prompt) => (await ask(prompt)) ?? '',
    );
    softened += talk.softened;
    if (talk.material && talk.turns.length) {
      for (const turn of talk.turns) {
        events.push({
          simHour: next.simHour,
          kind: 'dialogue',
          agentId: turn.speakerId,
          text: `${turn.speakerName}：${turn.text}`,
        });
      }
      next = {
        ...next,
        psyches: { ...next.psyches, ...talk.psyches },
        recentLines: [...next.recentLines, ...talk.turns.map((t) => t.text)].slice(-24),
      };
      for (const [id, text] of Object.entries(talk.memories)) {
        next = { ...next, memories: remember(next, id, text, false, rng) };
      }
    }
  }

  const military = next.institutions.find((i) => i.kind === 'military');
  if (military?.doctrine.liveFire && rng() < (military.doctrine.noticeHours >= 24 ? 0.01 : 0.03)) {
    const incident = rollIncident(
      'exercise',
      {
        noticeHours: military.doctrine.noticeHours,
        near: true,
        liveFire: true,
        simHour: next.simHour,
        place: military.regionId,
      },
      rng,
    );
    cell = applyHarm(cell, { dead: incident.dead, injured: incident.light + incident.serious });
    events.push({ simHour: next.simHour, kind: 'casualty', text: incident.report });
    next = {
      ...next,
      ledger: applyLedger(next.ledger, { fact: incident.report }),
    };
  }

  if (
    cell.rung >= 2 &&
    cell.mobilized >= 30 &&
    !next.institutions.some((inst) => inst.kind === 'crowd')
  ) {
    const leader = thinkers[0];
    const named = nameCrowd(cell, next.economy);
    next = {
      ...next,
      institutions: [
        ...next.institutions,
        {
          id: `move_${Math.floor(next.simHour)}`,
          name: named.name,
          kind: 'crowd',
          regionId: cell.regionId,
          goal: named.goal,
          ...(leader ? { headId: leader.id, memberIds: [leader.id] } : { memberIds: [] }),
          people: cell.mobilized,
          gearLevel: 0,
          mobility: 0.4,
          medical: 0,
          doctrine: {
            negotiateFirst: true,
            allowIrritant: false,
            allowFirearm: false,
            noticeHours: 0,
            liveFire: false,
          },
          publicLine: '我们只是要个说法',
          internalNote: '',
        },
      ],
    };
    events.push({
      simHour: next.simHour,
      kind: 'order',
      text: named.line,
    });
  } else if (
    cell.rung < 2 &&
    cell.mobilized < 15 &&
    next.institutions.some((inst) => inst.kind === 'crowd')
  ) {
    next = {
      ...next,
      institutions: next.institutions.filter((inst) => inst.kind !== 'crowd'),
    };
    events.push({ simHour: next.simHour, kind: 'order', text: '那群人散了。' });
  } else if (
    cell.rung >= 6 &&
    next.institutions.filter((inst) => inst.kind === 'crowd').length === 1
  ) {
    next = {
      ...next,
      institutions: [
        ...next.institutions,
        {
          id: `split_${Math.floor(next.simHour)}`,
          name: '另一拨人',
          kind: 'crowd',
          regionId: cell.regionId,
          goal: '不跟刚才那群人一起走',
          memberIds: [],
          people: Math.max(5, Math.round(cell.mobilized / 3)),
          gearLevel: 0,
          mobility: 0.3,
          medical: 0,
          doctrine: {
            negotiateFirst: false,
            allowIrritant: false,
            allowFirearm: false,
            noticeHours: 0,
            liveFire: false,
          },
          publicLine: '他们代表不了我们',
          internalNote: '',
        },
      ],
    };
    events.push({ simHour: next.simHour, kind: 'order', text: '人群裂成了两拨。' });
  }

  events.push({
    simHour: next.simHour,
    kind: 'conflict',
    text: `${cell.regionId}：${rungName(cell.rung)}，约 ${cell.mobilized} 人被动员，累计死亡 ${cell.deaths}`,
    payload: { rung: cell.rung, violent: violent(cell), mobilized: cell.mobilized },
  });

  const prevDay = Math.floor(world.simHour / 24);
  const day = Math.floor(next.simHour / 24);
  if (day !== prevDay) {
    const written = await writeChronicle(
      {
        simHour: next.simHour,
        facts: next.ledger.facts,
        rung: cell.rung,
        rungName: rungName(cell.rung),
        grievance: cell.grievance,
        deaths: cell.deaths,
      },
      opts?.llm && calls < cap ? async (prompt) => (await ask(prompt)) ?? '' : undefined,
    );
    if (written.softened) softened += 1;
    for (const entry of written.entries) {
      events.push({ simHour: next.simHour, kind: 'chronicle', text: entry.text, payload: { surprise: entry.surprise } });
    }
    const topic = next.recentLines.at(-1)?.slice(0, 12) || '眼下这件事';
    next = {
      ...next,
      chronicle: [...next.chronicle, ...written.entries].slice(-80),
      culture: [...next.culture, `镇里把眼下的事叫成「${topic}」`].slice(-12),
    };
    const lived = stepLife(next, rng);
    next = lived.world;
    for (const note of lived.notes) {
      events.push({ simHour: next.simHour, kind: 'chronicle', text: note });
    }
    const night: Record<string, Psyche> = { ...next.psyches };
    const memories = { ...next.memories };
    for (const agent of next.agents) {
      if (!agent.core || !night[agent.id]) continue;
      const folded = consolidateNight(night[agent.id]!, memories[agent.id] ?? [], rng);
      night[agent.id] = folded.psyche;
      memories[agent.id] = folded.memories;
    }
    next = { ...next, psyches: night, memories };
    const closed = closeDay({ ...next, conflict: [cell, ...next.conflict.slice(1)] }, rng);
    next = closed.world;
    cell = next.conflict[0] ?? cell;
    for (const note of closed.notes) {
      events.push({ simHour: next.simHour, kind: 'chronicle', text: note });
    }
  }

  next = {
    ...next,
    conflict: [cell, ...next.conflict.slice(1)],
    usage: {
      bucket,
      calls,
      softened: (world.usage.bucket === bucket ? world.usage.softened : 0) + softened,
    },
  };
  return { world: next, events, llmCalls, softened };
}
