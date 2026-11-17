/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

import { DialogueManager } from './DialogueManager.js';

function fakeScene() {
  return {
    time: {
      delayedCall: (_ms: number, cb: () => void) => {
        cb();
        return {};
      },
    },
  } as unknown as Phaser.Scene;
}

describe('DialogueManager graph edges', () => {
  it('treats nextId: null as end — does not fall through to later branches', () => {
    const mgr = new DialogueManager(fakeScene());
    const complete = vi.fn();
    const texts: string[] = [];
    mgr.on('dialogueComplete', complete);
    mgr.on('showText', (_s: string, t: string) => texts.push(t));
    mgr.loadDialogues([
      { id: 'a', type: 'text', text: 'hello', nextId: 'b' },
      { id: 'b', type: 'text', text: 'bye', nextId: null },
      { id: 'orphan', type: 'text', text: 'should-not-see', nextId: 'a' },
    ]);
    mgr.start();
    expect(texts).toEqual(['hello']);
    mgr.advance();
    expect(texts).toEqual(['hello', 'bye']);
    mgr.advance();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(texts).toEqual(['hello', 'bye']);
  });

  it('still walks sequential entries when nextId field is omitted', () => {
    const mgr = new DialogueManager(fakeScene());
    const texts: string[] = [];
    mgr.on('showText', (_s: string, t: string) => texts.push(t));
    mgr.loadDialogues([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
    ]);
    mgr.start();
    mgr.advance();
    expect(texts).toEqual(['one', 'two']);
  });

  it('treats choice nextId: null as end', () => {
    const mgr = new DialogueManager(fakeScene());
    const complete = vi.fn();
    mgr.on('dialogueComplete', complete);
    mgr.on('showChoice', () => {
      /* waiting */
    });
    mgr.loadDialogues([
      {
        id: 'c',
        type: 'choice',
        prompt: 'pick',
        options: [
          { label: 'end', nextId: null },
          { label: 'go', nextId: 'x' },
        ],
      },
      { id: 'x', type: 'text', text: 'should-not-see', nextId: null },
    ]);
    mgr.start();
    mgr.selectChoice(0);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
