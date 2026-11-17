/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offline G7 contract: named people survive planning, paid whispers are
 * interview-citable, same-day re-ask refuses, stance withholds from outsiders.
 * No DB, no MiniMax.
 *
 *   node scripts/smoke-society-promises.mjs
 */

import { planWorldFromPrompt } from '../packages/world-planner/dist/index.js';
import {
  MemoryStream,
  createMemoryEntry,
  converseGroup,
  interviewAgent,
  shouldTell,
  whisperMemory,
} from '../packages/world-agents/dist/index.js';

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.error(`FAIL ${msg}`);
};

const planned = await planWorldFromPrompt(
  '运河货船 10 名船员的可观察社会，值班官「维加」和补网人「阿禾」必须出现，不要塌回无名广场。',
  { forceHeuristic: true, worldPopulation: 10 },
);
const npcs = planned.world.entities.filter((e) => e.kind === 'npc');
const names = npcs.map((e) => e.name);
console.log(`planned ${npcs.length} residents: ${names.join('、')}`);
if (!names.includes('维加') || !names.includes('阿禾')) {
  fail('named residents 维加/阿禾 missing');
}
if (planned.world.space.regions.some((r) => r.id === 'town_square')) {
  fail('collapsed to town_square');
}
if (!npcs.every((n) => n.identity?.secret && n.identity?.stance)) {
  fail('stance cards missing on planner roster');
}

const stream = new MemoryStream();
stream.add(
  createMemoryEntry({
    id: 'wh1',
    agentId: 'a',
    kind: 'observation',
    text: whisperMemory('灯笼巷夜市要提前收摊', false),
    simTime: 10,
    importance: 14,
  }),
);
const interviewed = await interviewAgent({
  stream,
  agentId: 'a',
  agentName: '林嫂',
  identity: '摊主',
  occupation: '摊主',
  question: '最近怎么样？',
  nowSimTime: 12,
  llm: async (prompt) => {
    if (!/灯笼巷/.test(prompt)) fail('interview prompt missed paid whisper');
    return '有人悄悄说灯笼巷夜市要提前收摊。';
  },
});
if (!interviewed.citedMemoryIds.includes('wh1')) {
  fail('interview did not cite paid whisper');
}
const again = await interviewAgent({
  stream,
  agentId: 'a',
  agentName: '林嫂',
  identity: '摊主',
  question: '最近怎么样？',
  nowSimTime: 13,
  llm: async () => {
    fail('same-day re-ask called the model');
    return '';
  },
});
if (!/今天已经答过了|Ask another way/.test(again.answer)) {
  fail(`same-day re-ask recited: ${again.answer}`);
}

if (
  shouldTell(stream, 'a', 'stranger', '码头今晚加班', {
    stance: '闲话不传给外人',
    knownIds: ['buddy'],
  })
) {
  fail('outsider stance leaked gossip');
}
if (
  !shouldTell(stream, 'a', 'buddy', '码头今晚加班', {
    stance: '闲话不传给外人',
    knownIds: ['buddy'],
  })
) {
  fail('stance blocked a known peer');
}

const talk = await converseGroup({
  stream,
  participants: [
    { id: 'a', name: '甲', identity: '摊主' },
    { id: 'b', name: '乙', identity: '补网人' },
  ],
  nowSimTime: 14,
  idFactory: () => 's1',
});
if (!talk.turns.some((t) => t.citedMemoryIds?.includes('wh1'))) {
  fail('next speak after whisper did not cite it');
}

if (failures.length) {
  console.error(`\nsociety promises FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('society promises: PASS');
