/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

import {
  AgentEventJobMissingError,
  AgentEventStream,
} from './agentEvents.js';

describe('AgentEventStream resume after stall', () => {
  it('continues seq past rows already stored for the job', async () => {
    const inserted: Array<{ role: string; phase: string; seq: number }> = [];
    const existing = [
      { role: 'system', phase: 'PLAN', maxSeq: 2 },
      { role: 'planner', phase: 'INTENT', maxSeq: 1 },
    ];

    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            groupBy: async () => existing,
          }),
        }),
      }),
      insert: () => ({
        values: async (row: {
          role: string;
          phase: string;
          seq: number;
        }) => {
          const clash = inserted.some(
            (r) =>
              r.role === row.role &&
              r.phase === row.phase &&
              r.seq === row.seq,
          );
          // Simulate prior DB rows for the hydrated keys.
          if (
            (row.role === 'system' &&
              row.phase === 'PLAN' &&
              row.seq <= 2) ||
            (row.role === 'planner' &&
              row.phase === 'INTENT' &&
              row.seq <= 1) ||
            clash
          ) {
            const err = new Error('duplicate key') as Error & { code: string };
            err.code = '23505';
            throw err;
          }
          inserted.push({
            role: row.role,
            phase: row.phase,
            seq: row.seq,
          });
        },
      }),
    };

    const stream = new AgentEventStream({
      db: db as never,
      publisher: null,
      jobId: 'job-1',
      projectId: 'proj-1',
      sessionId: null,
    });

    await stream.prepare();
    await stream.emit('system', 'PLAN', { summary: 'resume' });
    await stream.emit('planner', 'INTENT', { summary: 'intent again' });
    await stream.emit('system', 'PLAN', { summary: 'second after resume' });

    expect(inserted).toEqual([
      { role: 'system', phase: 'PLAN', seq: 3 },
      { role: 'planner', phase: 'INTENT', seq: 2 },
      { role: 'system', phase: 'PLAN', seq: 4 },
    ]);
  });

  it('bumps past a race unique violation', async () => {
    let attempts = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            groupBy: async () =>
              attempts === 0
                ? []
                : [{ role: 'coder', phase: 'CODE', maxSeq: 5 }],
          }),
        }),
      }),
      insert: () => ({
        values: async (row: { seq: number }) => {
          attempts += 1;
          if (row.seq < 6) {
            const err = new Error('duplicate') as Error & { code: string };
            err.code = '23505';
            throw err;
          }
        },
      }),
    };

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stream = new AgentEventStream({
      db: db as never,
      publisher: null,
      jobId: 'job-2',
      projectId: 'proj-1',
      sessionId: null,
    });
    await stream.emit('coder', 'CODE', { summary: 'race' });
    expect(attempts).toBeGreaterThan(1);
    warn.mockRestore();
  });

  it('throws AgentEventJobMissingError on jobs FK violation and stops later emits', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            groupBy: async () => [],
          }),
        }),
      }),
      insert: () => ({
        values: async () => {
          const err = new Error(
            'insert or update on table "agent_events" violates foreign key constraint "agent_events_job_id_fkey"',
          ) as Error & { code: string; constraint_name: string };
          err.code = '23503';
          err.constraint_name = 'agent_events_job_id_fkey';
          throw err;
        },
      }),
    };

    const stream = new AgentEventStream({
      db: db as never,
      publisher: null,
      jobId: 'ebb91bdf-7a19-459f-b8d9-d6e2ee14a762',
      projectId: 'proj-1',
      sessionId: null,
    });

    await expect(
      stream.emit('system', 'PLAN', { summary: 'orphan' }),
    ).rejects.toBeInstanceOf(AgentEventJobMissingError);

    await expect(
      stream.emit('system', 'FAIL', { summary: 'should not insert' }),
    ).rejects.toBeInstanceOf(AgentEventJobMissingError);
  });
});
