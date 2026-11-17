/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  assertGeneratePrompt,
  assertPublishableCopy,
  findBlockedFranchise,
} from './ugcPolicy.js';

describe('ugcPolicy', () => {
  it('allows original titles', () => {
    expect(assertPublishableCopy({ title: 'River Town Fishing' })).toEqual({
      ok: true,
    });
  });

  it('blocks obvious franchise names', () => {
    expect(findBlockedFranchise('Marvel Avengers: Infinity Strike')).toBe(
      'marvel',
    );
    expect(assertPublishableCopy({ title: 'Harry Potter duel' }).ok).toBe(false);
  });

  it('blocks franchise names in generate prompts too', () => {
    expect(assertGeneratePrompt('make a mario kart clone').ok).toBe(false);
    expect(assertGeneratePrompt('river ferry at dusk').ok).toBe(true);
  });

  it('blocks adult and illegal needles', () => {
    expect(assertGeneratePrompt('免费色情直播').ok).toBe(false);
    expect(assertPublishableCopy({ title: '如何制造炸弹指南' }).ok).toBe(false);
    expect(assertGeneratePrompt('原神同人塔防').ok).toBe(false);
  });
});
