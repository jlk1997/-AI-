/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { setLocale, t } from '../../services/i18n';
import {
  commitmentChips,
  displayMemoryText,
  isBeliefMemory,
  isTownWideSpeaker,
  isOwnedPlaceName,
  overlayTalkText,
  talkGroupTitle,
  townWideSpeakerLabel,
  rosterHonesty,
  plannerSourceLabelKey,
  clockHonestyKey,
  isPaidTraceMemory,
  paidTraceKind,
  compareTalkLines,
  compareSocietyEvtOrder,
  orderTalkGroups,
  talkTurnMark,
} from './societyInspectorCopy';

describe('society inspector copy', () => {
  it('joins English talk titles and town-wide speakers', () => {
    setLocale('en');
    expect(
      talkGroupTitle(
        [{ who: 'Vega', to: 'Ada' }],
        t,
      ),
    ).toBe('Vega and Ada');
    expect(
      talkGroupTitle(
        [
          { who: 'Vega', to: 'Ada' },
          { who: 'Bram', to: 'Ada' },
        ],
        t,
      ),
    ).toBe('Vega and Ada (and others)');
    expect(isTownWideSpeaker('Whole crew')).toBe(true);
    expect(isTownWideSpeaker('Town')).toBe(true);
    expect(isTownWideSpeaker('全镇')).toBe(true);
    expect(isTownWideSpeaker('Vega')).toBe(false);
    expect(
      townWideSpeakerLabel({ ascii: true, packId: 'society.crew' }),
    ).toBe('Whole crew');
  });

  it('chips an English owed reply and strips belief prefixes', () => {
    const chips = commitmentChips(
      [
        {
          from: 'a',
          to: 'b',
          kind: 'promise',
          summary: '【有约定】owes Ada a reply about the helm',
        },
        {
          from: 'a',
          to: 'c',
          kind: 'conflict',
          summary: 'at odds after the last watch',
        },
      ],
      'a',
      (id) => (id === 'b' ? 'Ada' : 'Bram'),
    );
    expect(chips.some((c) => c.kind === 'reply' && c.who === 'Ada')).toBe(true);
    expect(chips.some((c) => c.kind === 'conflict' && c.who === 'Bram')).toBe(
      true,
    );
    expect(
      commitmentChips(
        [
          {
            from: 'a',
            to: 'visitor',
            kind: 'adopted',
            summary: '【认养】有人认养了你',
          },
        ],
        'a',
        (id) => (id === 'visitor' ? 'visitor' : id),
      ).some((c) => c.kind === 'adopt' && c.who === 'visitor'),
    ).toBe(true);
    expect(isBeliefMemory('Belief: the airlock sticks')).toBe(true);
    expect(displayMemoryText('Belief: the airlock sticks')).toBe(
      'the airlock sticks',
    );
    expect(displayMemoryText('【信念】炉火不能灭')).toBe('炉火不能灭');
  });

  it('tags overlay talk with locale interview/rumor labels', () => {
    setLocale('en');
    expect(
      overlayTalkText(
        { who: 'Vega', text: 'quiet on the bridge', interview: true },
        t,
        'en',
      ),
    ).toMatch(/\(Interview\) Vega: quiet on the bridge/);
    expect(t('product.obs.playback')).toBe('Playback');
    expect(t('product.obs.relFamily')).toBe('Family');
    expect(t('product.obs.relCoworker')).toBe('Coworkers');
    expect(t('product.obs.relNeighbor')).toBe('Neighbors');
    expect(t('product.obs.relRival')).toBe('Rivals');
    expect(t('product.obs.relPromise')).toBe('Promise');
    expect(t('product.obs.relAdopted')).toBe('Adopted');
    expect(t('product.obs.relRumor')).toBe('Town rumor');
    expect(isOwnedPlaceName("Vega's station")).toBe(true);
    expect(isOwnedPlaceName("Vega's bunk")).toBe(true);
    expect(isOwnedPlaceName('Bridge')).toBe(false);
    expect(isOwnedPlaceName('沈班的家')).toBe(true);
    expect(isOwnedPlaceName('轮机的工位')).toBe(true);
    expect(isOwnedPlaceName('水培区')).toBe(false);
  });

  it('labels planner source and catalog pads without calling pads LLM-authored', () => {
    const roster = rosterHonesty({
      presentation: { plannerSource: 'llm' },
      entities: [
        { kind: 'npc', tags: [] },
        { kind: 'npc', tags: ['padded'] },
        { kind: 'npc', tags: ['padded'] },
      ],
    });
    expect(roster.authoredCount).toBe(1);
    expect(roster.paddedCount).toBe(2);
    expect(plannerSourceLabelKey('llm')).toBe('product.obs.plannerLlm');
    expect(plannerSourceLabelKey('heuristic')).toBe(
      'product.obs.plannerHeuristic',
    );
  });

  it('badges paid whisper / 巷议 / 认养 instead of hiding them as bookkeeping', () => {
    expect(isPaidTraceMemory('有人悄悄对你说：夜市提前收摊')).toBe(true);
    expect(isPaidTraceMemory('镇上在传：灯笼巷要加班')).toBe(true);
    expect(isPaidTraceMemory('【认养】有人认养了你，要把日子记得更清楚。')).toBe(
      true,
    );
    expect(isPaidTraceMemory('Word is out: meet at Bridge tonight')).toBe(true);
    expect(paidTraceKind('【认养】有人认养了你')).toBe('adopt');
    expect(paidTraceKind('Someone whispered: stay late')).toBe('whisper');
    expect(isPaidTraceMemory('看见 阿禾 在码头')).toBe(false);
  });

  it('orders talk lines by talkSeq and pins the current circle first', () => {
    const late = {
      id: 'c:0',
      talkSeq: 3,
      simTime: 14,
      turnIndex: 0,
    };
    const early = {
      id: 'a:0',
      talkSeq: 1,
      simTime: 14,
      turnIndex: 0,
    };
    const mid = {
      id: 'b:0',
      talkSeq: 2,
      simTime: 14,
      turnIndex: 0,
    };
    expect([late, early, mid].sort(compareTalkLines).map((l) => l.talkSeq)).toEqual(
      [1, 2, 3],
    );
    expect(
      orderTalkGroups(
        [
          { id: 'c', talkSeq: 3, simTime: 14 },
          { id: 'a', talkSeq: 1, simTime: 14 },
          { id: 'b', talkSeq: 2, simTime: 14 },
        ],
        2,
      ).map((g) => g.id),
    ).toEqual(['b', 'a', 'c']);
    expect(talkTurnMark(0)).toBe('①');
    expect(talkTurnMark(1)).toBe('②');
    expect(
      [
        { id: 'c3', simTime: 14, payload: { talkSeq: 3 } },
        { id: 'c1', simTime: 14, payload: { talkSeq: 1 } },
        { id: 'c2', simTime: 14, payload: { talkSeq: 2 } },
      ]
        .sort(compareSocietyEvtOrder)
        .map((e) => e.id),
    ).toEqual(['c1', 'c2', 'c3']);
    expect(
      [
        { id: 'late', simTime: 8, payload: {}, createdAtMs: 20 },
        { id: 'early', simTime: 8, payload: {}, createdAtMs: 10 },
      ]
        .sort(compareSocietyEvtOrder)
        .map((e) => e.id),
    ).toEqual(['early', 'late']);
  });

  it('does not call template remainder a parse failure', () => {
    expect(
      clockHonestyKey({ skipReason: 'generate', llm: false }),
    ).toBe('product.obs.llmGenerateMute');
    expect(clockHonestyKey({ skipReason: 'no_key', llm: false })).toBe(
      'product.obs.llmDegraded',
    );
    expect(clockHonestyKey({ skipReason: 'budget', llm: false })).toBe(
      'product.obs.fundingWalk',
    );
    expect(clockHonestyKey({ skipReason: 'keys_exhausted', llm: false })).toBe(
      'product.obs.llmKeysExhausted',
    );
    expect(clockHonestyKey({ skipReason: 'no_permit', llm: false })).toBe(
      'product.obs.fundingWalk',
    );
    expect(clockHonestyKey({ skipReason: 'unwatched', llm: false })).toBe(
      'product.obs.guestIdle',
    );
    expect(
      clockHonestyKey({ skipReason: 'unwatched', llm: false, joining: true }),
    ).toBe('product.obs.guestJoining');
    expect(
      clockHonestyKey({
        authorPaused: true,
        skipReason: 'unwatched',
        llm: false,
      }),
    ).toBe('product.obs.authorPaused');
    expect(
      clockHonestyKey({
        authorPaused: true,
        isGenerating: true,
        llm: false,
      }),
    ).toBe('product.obs.llmGenerateMute');
    expect(clockHonestyKey({ dialogueKind: 'template', degraded: true })).toBe(
      'product.obs.llmTemplate',
    );
    expect(clockHonestyKey({ llm: true, dialogueKind: 'model' })).toBe(
      'product.obs.llmOk',
    );
  });
});
