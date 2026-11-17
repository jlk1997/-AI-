/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deep-town panel: who is thinking, what the chronicle says, and whether
 * violent outcomes may leave the project.
 */

import { and, eq } from 'drizzle-orm';
import type { Hono } from 'hono';

import {
  organizationMembers,
  projects,
  readCognition,
  readDeepState,
  readForecast,
  setCognition,
  writeDeepBundle,
  worlds,
  type DrizzleDb,
} from '@opengame/platform-db';
import { authorStepsIn, contentAudience, hydrateDeepWorld, seedDeepWorld, violenceLabel, type DeepWorld } from '@opengame/world-agents';

import type { JwtPayload } from '../lib/jwt.js';

type Authed = Hono<{ Variables: { jwt: JwtPayload } }>;

async function memberWorld(
  db: DrizzleDb,
  projectId: string,
  userId: string,
): Promise<{ worldId: string } | { error: 'not found' | 'forbidden' | 'no world' }> {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!proj) return { error: 'not found' };
  const [mem] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, proj.organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!mem) return { error: 'forbidden' };
  const [world] = await db.select().from(worlds).where(eq(worlds.projectId, projectId)).limit(1);
  if (!world) return { error: 'no world' };
  return { worldId: world.id };
}

export function registerDeepSocietyRoutes(authed: Authed, db: DrizzleDb): void {
  authed.get('/projects/:projectId/world/society/deep', async (c) => {
    const gate = await memberWorld(db, c.req.param('projectId'), c.get('jwt').sub);
    if ('error' in gate) {
      const status = gate.error === 'forbidden' ? 403 : 404;
      return c.json({ error: gate.error }, status);
    }
    const cog = await readCognition(db, gate.worldId).catch(() => null);
    const state = (await readDeepState(db, gate.worldId).catch(() => null)) as DeepWorld | null;
    const nameOf = new Map((state?.agents ?? []).map((agent) => [agent.id, agent.name]));
    const awayOf = new Map((state?.agents ?? []).map((agent) => [agent.id, Boolean(agent.away)]));
    const residents = Object.values(state?.psyches ?? {})
      .slice(0, 24)
      .map((psyche) => ({
        id: nameOf.get(psyche.agentId) || psyche.agentId,
        away: awayOf.get(psyche.agentId) ?? false,
        grievance: psyche.grievance,
        legitimacy: psyche.legitimacy,
        efficacy: psyche.efficacy,
        boredom: psyche.boredom,
        narrative: psyche.narrative,
        goals: psyche.goals,
        monologue: state?.monologues?.[psyche.agentId] ?? '',
        emotion: psyche.emotions,
        relations: psyche.relations,
      }));
    const chronicle = (state?.chronicle ?? []).slice(-40);
    const text = chronicle.map((row) => row.text).join('\n');
    const violent = violenceLabel(text) || (state?.conflict?.[0]?.deaths ?? 0) > 0;
    return c.json({
      cognition: cog?.cognition ?? 'classic',
      violencePublic: cog?.violencePublic ?? false,
      audience: contentAudience(cog?.violencePublic ?? false),
      containsViolence: violent,
      shareBlocked: violent && !(cog?.violencePublic ?? false),
      simHour: state?.simHour ?? 0,
      residents,
      institutions: state?.institutions ?? [],
      conflict: state?.conflict ?? [],
      chronicle,
      facts: state?.ledger?.facts ?? [],
      writings: state?.writings ?? [],
      culture: state?.culture ?? [],
      polls: state?.polls ?? [],
      paper: state?.paper ?? [],
      outside: state?.outside ?? [],
      mood: {
        grievance: state?.conflict?.[0]?.grievance ?? 0,
        legitimacy: state?.conflict?.[0]?.legitimacy ?? 0,
        population: state?.population ?? 0,
        rung: state?.conflict?.[0]?.rung ?? 0,
      },
    });
  });

  authed.post('/projects/:projectId/world/society/cognition', async (c) => {
    const gate = await memberWorld(db, c.req.param('projectId'), c.get('jwt').sub);
    if ('error' in gate) {
      const status = gate.error === 'forbidden' ? 403 : 404;
      return c.json({ error: gate.error }, status);
    }
    const body = await c.req
      .json<{ cognition?: string; violencePublic?: boolean }>()
      .catch(() => ({}) as { cognition?: string; violencePublic?: boolean });
    const cognition = body.cognition === 'deep' ? 'deep' : 'classic';
    await setCognition(db, gate.worldId, cognition, body.violencePublic);
    return c.json({ cognition, violencePublic: Boolean(body.violencePublic) });
  });

  authed.post('/projects/:projectId/world/society/step-in', async (c) => {
    const gate = await memberWorld(db, c.req.param('projectId'), c.get('jwt').sub);
    if ('error' in gate) {
      const status = gate.error === 'forbidden' ? 403 : 404;
      return c.json({ error: gate.error }, status);
    }
    const body = await c.req
      .json<{ who?: string; text?: string }>()
      .catch(() => ({}) as { who?: string; text?: string });
    const text = body.text?.trim() ?? '';
    if (!text) return c.json({ error: 'empty' }, 400);
    const loaded = hydrateDeepWorld(await readDeepState(db, gate.worldId).catch(() => null));
    const world = loaded ?? seedDeepWorld({ seed: gate.worldId.length, core: 12 });
    await setCognition(db, gate.worldId, 'deep');
    const stepped = await authorStepsIn(world, { who: body.who?.trim() || world.agents[0]?.id || 'author', text });
    await writeDeepBundle(db, gate.worldId, {
      state: stepped.world,
      psyches: Object.values(stepped.world.psyches).map((psyche) => ({
        agentKey: psyche.agentId,
        psyche,
      })),
      institutions: stepped.world.institutions.map((inst) => ({
        key: inst.id,
        kind: inst.kind,
        name: inst.name,
        body: inst,
      })),
      chronicle: stepped.world.chronicle.map((row) => ({
        simTime: row.simHour,
        text: row.text,
        surprise: row.surprise,
      })),
      ledger: stepped.world.ledger,
      ledgerSimTime: stepped.world.simHour,
    });
    return c.json({
      simHour: stepped.world.simHour,
      events: stepped.events.slice(-8).map((event) => event.text),
    });
  });

  authed.get('/projects/:projectId/world/society/forecast-run/:runId', async (c) => {
    const gate = await memberWorld(db, c.req.param('projectId'), c.get('jwt').sub);
    if ('error' in gate) {
      const status = gate.error === 'forbidden' ? 403 : 404;
      return c.json({ error: gate.error }, status);
    }
    const row = await readForecast(db, gate.worldId, c.req.param('runId'));
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });
}
