/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * People leave, arrive, and sometimes move in together. The crowd is not a
 * fixed cast.
 */

import type { DeepAgent, DeepWorld } from './deepWorld.js';
import { seedPsyche } from './psyche.js';
import { ensurePerson } from './worldLedger.js';

const ARRIVALS = ['沈晚', '顾小禾', '江北', '罗棠', '白川', '宋渔', '尹宁', '崔石'];

function present(agent: DeepAgent): boolean {
  return agent.core && !agent.away;
}

export function stepLife(
  world: DeepWorld,
  rng: () => number,
): { readonly world: DeepWorld; readonly notes: readonly string[] } {
  const notes: string[] = [];
  let agents = [...world.agents];
  let psyches = { ...world.psyches };
  let ledger = world.ledger;
  let population = world.population;
  const writings = [...world.writings];

  const scared = agents.find(
    (agent) =>
      present(agent) &&
      (psyches[agent.id]?.emotions.fear ?? 0) > 0.72 &&
      (psyches[agent.id]?.grievance ?? 0) > 0.55,
  );
  if (scared && rng() < 0.65) {
    agents = agents.map((agent) => (agent.id === scared.id ? { ...agent, away: true } : agent));
    population = Math.max(1, population - 1);
    const text = `${scared.name}带着家里人离开了这片地方。`;
    notes.push(text);
    writings.push({
      simHour: world.simHour,
      authorId: scared.id,
      authorName: scared.name,
      kind: 'letter',
      text: `${scared.name}留下一句：先走了，别找。`,
    });
  }

  const here = agents.filter(present);
  if (here.length < 18 && world.economy > 0.35 && rng() < 0.4) {
    const used = new Set(agents.map((agent) => agent.name));
    const name = ARRIVALS.find((candidate) => !used.has(candidate));
    if (name) {
      const id = `new_${name}`;
      const occupation = rng() < 0.5 ? '小贩' : '短工';
      const agent: DeepAgent = {
        id,
        name,
        occupation,
        regionId: here[0]?.regionId ?? 'town',
        identity: `${name}刚到镇上，找${occupation}的活`,
        core: true,
        away: false,
      };
      agents = [...agents, agent].slice(0, 24);
      psyches = {
        ...psyches,
        [id]: seedPsyche({ agentId: id, name, occupation, grievance: 0.3, legitimacy: 0.5 }),
      };
      ledger = ensurePerson(ledger, id, { agentId: id, job: occupation, home: agent.regionId, money: 40 });
      population += 1;
      const text = `${name}搬了进来，想找份${occupation}的活。`;
      notes.push(text);
      writings.push({
        simHour: world.simHour,
        authorId: id,
        authorName: name,
        kind: 'post',
        text,
      });
    }
  }

  const pair = here.find((agent) => {
    const rels = psyches[agent.id]?.relations ?? {};
    return Object.values(rels).some((rel) => rel.liking > 0.7);
  });
  if (pair) {
    const otherId = Object.entries(psyches[pair.id]?.relations ?? {}).find(([, rel]) => rel.liking > 0.7)?.[0];
    const other = agents.find((agent) => agent.id === otherId);
    const line = `${pair.name}和${other?.name ?? '一个人'}住到了一处。`;
    if (other && !writings.some((row) => row.text === line)) {
      notes.push(line);
      writings.push({
        simHour: world.simHour,
        authorId: pair.id,
        authorName: pair.name,
        kind: 'diary',
        text: line,
      });
    }
  }

  return {
    world: {
      ...world,
      agents,
      psyches,
      ledger,
      population,
      writings: writings.slice(-40),
    },
    notes,
  };
}
