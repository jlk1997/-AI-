/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  courseDeskReturnPath,
  peekPendingCourse,
  peekPendingRemix,
  peekPendingSocial,
  readLoginReturnTo,
  rememberLoginReturnTo,
  rememberPendingCourse,
  rememberPendingRemix,
  rememberPendingSocial,
  takePendingCourse,
  takePendingRemix,
  takePendingSocial,
} from './loginIntent';

function installMemorySessionStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    },
  });
}

describe('loginIntent', () => {
  beforeEach(() => {
    installMemorySessionStorage();
  });

  it('returns the visitor to where they were, exactly once', () => {
    rememberLoginReturnTo('/play/quiet-town');
    expect(readLoginReturnTo()).toBe('/play/quiet-town');
    expect(readLoginReturnTo()).toBeNull();
  });

  it('refuses an off-site return target', () => {
    rememberLoginReturnTo('https://evil.example.com/');
    expect(readLoginReturnTo()).toBeNull();
  });

  it('keeps the sentence across the login detour and burns it on use', () => {
    rememberPendingRemix({
      slugOrId: 'quiet-town',
      line: 'make the blacksmith a traitor',
      kind: 'world',
    });
    expect(peekPendingRemix()?.line).toBe('make the blacksmith a traitor');
    // Peeking must not consume it: the detail page prefills, then forks.
    expect(peekPendingRemix()?.kind).toBe('world');
    expect(takePendingRemix()?.slugOrId).toBe('quiet-town');
    expect(takePendingRemix()).toBeNull();
  });

  it('remembers which box the sentence came from', () => {
    rememberPendingRemix({
      slugOrId: 'quiet-town',
      line: 'tell the baker the well is poisoned',
      kind: 'world',
      intent: 'whisper',
    });
    expect(peekPendingRemix()?.intent).toBe('whisper');
  });

  it('treats a sentence with no recorded intent as a remix', () => {
    rememberPendingRemix({ slugOrId: 'g1', line: 'faster', kind: 'game' });
    expect(takePendingRemix()?.intent).toBe('remix');
  });

  it('ignores a half-written remix record', () => {
    sessionStorage.setItem('opengame_pending_remix_v1', '{"line":"only a line"}');
    expect(peekPendingRemix()).toBeNull();
  });

  it('defaults an unknown kind to a game', () => {
    rememberPendingRemix({ slugOrId: 'g1', line: 'faster', kind: 'game' });
    expect(takePendingRemix()?.kind).toBe('game');
  });

  it('keeps a comment across the login detour without mixing it into remix', () => {
    rememberPendingSocial({ kind: 'comment', gameId: 'g1', content: 'great run' });
    expect(peekPendingSocial()?.kind).toBe('comment');
    expect(takePendingSocial()).toEqual({
      kind: 'comment',
      gameId: 'g1',
      content: 'great run',
    });
    expect(takePendingSocial()).toBeNull();
  });

  it('keeps a score the framed game posted before sign-in', () => {
    rememberPendingSocial({
      kind: 'score',
      gameId: 'g1',
      score: 900,
      playerName: 'Ada',
    });
    expect(takePendingSocial()).toMatchObject({ kind: 'score', score: 900 });
  });

  it('remembers a course stake intent across login and burns it once', () => {
    rememberPendingCourse({ gameId: 'town-1', kind: 'follow_open' });
    expect(peekPendingCourse()).toEqual({
      gameId: 'town-1',
      kind: 'follow_open',
    });
    expect(takePendingCourse()?.kind).toBe('follow_open');
    expect(takePendingCourse()).toBeNull();
  });

  it('remembers a watch intent without treating it as stake', () => {
    rememberPendingCourse({ gameId: 'town-2', kind: 'watch' });
    expect(peekPendingCourse()?.kind).toBe('watch');
    expect(takePendingCourse()?.kind).toBe('watch');
    expect(takePendingCourse()).toBeNull();
  });

  it('builds a course desk return path with course=1 and without one-shot flags', () => {
    expect(courseDeskReturnPath('/play/quiet-town?course=1&follow=1&watch=1')).toBe(
      '/play/quiet-town?course=1',
    );
    expect(courseDeskReturnPath('/community/game/quiet-town')).toBe(
      '/community/game/quiet-town?course=1',
    );
  });
});
