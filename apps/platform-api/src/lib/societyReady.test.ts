/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  societySeedFromJobResult,
  societySeedSnapshot,
  worldBriefFromSpec,
  worldRosterFromSpec,
} from './societyReady.js';

describe('societySeedSnapshot', () => {
  it('prefers persisted report.seed over the generate job blob', () => {
    const snap = societySeedSnapshot(
      {
        informationSpread: { rate: 0.42 },
        seed: {
          hours: 16,
          dialogues: 11,
          degraded: false,
          gateFailed: false,
          retrievalDegraded: true,
        },
      },
      { hours: 8, dialogues: 0, spread: 0.1, gateFailed: true },
    );
    expect(snap).toEqual({
      hours: 16,
      dialogues: 11,
      spread: 0.42,
      degraded: false,
      gateFailed: false,
      retrievalDegraded: true,
    });
  });

  it('fills from the job when live ticks have not stamped seed yet', () => {
    const snap = societySeedSnapshot(null, {
      hours: 16,
      dialogues: 9,
      spread: 0.3,
      gateFailed: false,
      retrievalDegraded: false,
    });
    expect(snap?.hours).toBe(16);
    expect(snap?.dialogues).toBe(9);
    expect(snap?.spread).toBe(0.3);
  });

  it('stays silent when neither report nor job has a contract', () => {
    expect(societySeedSnapshot({ summary: 'empty' })).toBeNull();
  });
});

describe('societySeedFromJobResult', () => {
  it('reads result.societySeed from a succeeded world job', () => {
    expect(
      societySeedFromJobResult({
        societySeed: { hours: 16, dialogues: 4, spread: 0.2, gateFailed: false },
      }),
    ).toMatchObject({ hours: 16, dialogues: 4, spread: 0.2 });
  });
});

describe('worldRosterFromSpec', () => {
  it('lists authored names before catalog pads', () => {
    const roster = worldRosterFromSpec({
      entities: [
        { kind: 'npc', name: '阿禾', tags: ['authored'] },
        { kind: 'npc', name: '沈班', tags: ['padded'] },
        { kind: 'item', name: '炉' },
      ],
    });
    expect(roster.authoredNames).toEqual(['阿禾']);
    expect(roster.paddedNames).toEqual(['沈班']);
    expect(roster.authoredNpcs).toBe(1);
    expect(roster.paddedNpcs).toBe(1);
  });

  it('reads the create brief stamped on the Spec', () => {
    expect(
      worldBriefFromSpec({
        presentation: {
          worldBrief: {
            packId: 'society.town',
            useCase: 'xiangyi',
            venues: ['夜市', '茶馆'],
            scale: 'standard',
            livedIn: 'full_day',
            note: '林嫂和阿禾要在夜市对质',
          },
        },
      }),
    ).toEqual({
      packId: 'society.town',
      useCase: 'xiangyi',
      venues: ['夜市', '茶馆'],
      scale: 'standard',
      livedIn: 'full_day',
      note: '林嫂和阿禾要在夜市对质',
    });
    expect(worldBriefFromSpec({})).toBeNull();
  });
});
