/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { resolveDialogBehaviorLines } from './DialogueRunner.js';

describe('DialogueRunner helpers', () => {
  it('resolves dialogue group from root dialogue[]', () => {
    const lines = resolveDialogBehaviorLines(
      { dialogueId: 'intro' },
      [
        { group: 'intro', text: 'Hello', speaker: 'A' },
        { group: 'intro', text: 'World' },
        { group: 'other', text: 'Skip' },
      ],
    );
    expect(lines?.length).toBe(2);
    expect(lines?.[0]?.text).toBe('Hello');
  });
});
