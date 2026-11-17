/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offline smoke test for the living town: no DB, no network, no model.
 * Runs one simulated day and prints what actually emerged.
 *
 *   node scripts/smoke-society-town.mjs [hours]
 */

import { createSocietyTownWorld } from '../packages/world-spec/dist/index.js';
import {
  buildEmergenceReportCard,
  gateEmergenceReportCard,
  runSocietyHours,
  societyStateFromSpec,
} from '../packages/world-agents/dist/index.js';

const hours = Number(process.argv[2] ?? 24);
const spec = createSocietyTownWorld({ title: '生活小镇' });
const state = societyStateFromSpec(spec, {
  seedText: '铁砧今晚在广场办聚会',
});

console.log(
  `residents=${state.agents.length} regions=${state.regionBounds?.size ?? 0} anchors=${state.anchors?.size ?? 0} seededRelations=${state.relations.size}`,
);

const t0 = Date.now();
const events = await runSocietyHours(state, hours, {
  dtHours: 0.25,
  maxConversationsPerStep: 4,
  maxLlmConversationsPerStep: 0,
  maxPlanLlmCallsPerStep: 0,
});
const ms = Date.now() - t0;

const byKind = {};
for (const e of events) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
const dialogues = events.filter((e) => e.kind === 'dialogue');
const groupTalks = dialogues.filter(
  (e) => (e.payload.participants?.length ?? 2) >= 3,
);
const driveReplans = events.filter(
  (e) => e.kind === 'plan' && e.payload.replan === true,
);

console.log(`\nsim ${hours}h in ${ms}ms — events:`, byKind);
console.log(
  `dialogues=${dialogues.length} groupTalks(3+)=${groupTalks.length} driveReplans=${driveReplans.length}`,
);

// Did residents actually spread out across the town and then converge?
const regionTally = new Map();
for (const a of state.agents) {
  regionTally.set(a.regionId, (regionTally.get(a.regionId) ?? 0) + 1);
}
console.log('final region occupancy:', Object.fromEntries(regionTally));

const visited = new Set(
  events
    .filter((e) => e.kind === 'action')
    .map((e) => e.payload.goalPlace)
    .filter(Boolean),
);
console.log(`distinct destinations visited: ${visited.size}`);

const uniqueSummaries = new Set(dialogues.map((e) => e.payload.summary));
console.log(
  `dialogue non-repetition: ${uniqueSummaries.size}/${dialogues.length}`,
);

const card = buildEmergenceReportCard({
  state,
  events,
  seedText: '铁砧今晚在广场办聚会',
  invitationText: '聚会',
});
console.log('\nemergence:', card.summary);
const gate = gateEmergenceReportCard(card);
console.log(
  gate.ok ? 'gate: PASS' : `gate: FAIL — ${gate.failures.join('; ')}`,
);
console.log(
  `peak ${card.coordination.peakGathering} @ ${card.coordination.peakRegionId} t=${card.coordination.peakSimTime}`,
);
console.log(
  `routes ${card.scheduleDiversity.distinctRoutes}/${card.scheduleDiversity.agents} avgDest=${card.scheduleDiversity.avgDestinationsPerAgent.toFixed(1)}`,
);

const sample = dialogues.slice(-3);
for (const d of sample) {
  console.log(
    `\n[${d.simTime.toFixed(2)}h] ${(d.payload.participants ?? []).join(' + ')}`,
  );
  for (const t of d.payload.turns ?? []) {
    console.log(`  ${t.speakerName}: ${t.text}`);
  }
}

if (!gate.ok) {
  console.error(
    `\nsociety smoke FAILED — the town stopped behaving like a society:\n  ${gate.failures.join('\n  ')}`,
  );
  process.exit(1);
}
