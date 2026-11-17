/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment jsdom
 */

import type Phaser from 'phaser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installMobileInput,
  shouldEnableMobileInput,
  type MobileInputHandle,
} from './MobileInputAdapter.js';

interface RecordedKey {
  readonly type: string;
  readonly code: string;
  readonly keyCode: number;
}

let recorded: RecordedKey[] = [];
let handle: MobileInputHandle | null = null;

function fakeGame(): Phaser.Game {
  const parent = document.createElement('div');
  const canvas = document.createElement('canvas');
  parent.appendChild(canvas);
  document.body.appendChild(parent);
  return {
    canvas,
    events: { emit: vi.fn() },
  } as unknown as Phaser.Game;
}

function codes(type: 'keydown' | 'keyup'): string[] {
  return recorded.filter((e) => e.type === type).map((e) => e.code);
}

function record(event: Event): void {
  const e = event as KeyboardEvent;
  recorded.push({ type: e.type, code: e.code, keyCode: e.keyCode });
}

beforeEach(() => {
  recorded = [];
  window.addEventListener('keydown', record);
  window.addEventListener('keyup', record);
});

afterEach(() => {
  window.removeEventListener('keydown', record);
  window.removeEventListener('keyup', record);
  handle?.destroy();
  handle = null;
  document.body.innerHTML = '';
});

describe('shouldEnableMobileInput', () => {
  it('respects an explicit flag over any detection', () => {
    expect(shouldEnableMobileInput(true)).toBe(true);
    expect(shouldEnableMobileInput(false)).toBe(false);
  });

  it('lets ?touch=on force the controls in on a desktop browser', () => {
    window.history.replaceState({}, '', '/?touch=on');
    expect(shouldEnableMobileInput()).toBe(true);
  });

  it('lets ?touch=off turn them off on a phone', () => {
    window.history.replaceState({}, '', '/?touch=off');
    expect(shouldEnableMobileInput()).toBe(false);
  });
});

describe('installMobileInput', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('installs nothing when disabled', () => {
    expect(installMobileInput(fakeGame(), { enabled: false })).toBeNull();
  });

  it('synthesises both WASD and arrow keys so either style of game responds', () => {
    handle = installMobileInput(fakeGame(), { enabled: true });
    handle!.setStick(1, 0);
    expect(codes('keydown')).toEqual(['KeyD', 'ArrowRight']);
  });

  it('ignores a resting thumb inside the dead zone', () => {
    handle = installMobileInput(fakeGame(), { enabled: true });
    handle!.setStick(0.15, -0.2);
    expect(recorded).toHaveLength(0);
  });

  it('releases direction keys when the stick returns to centre', () => {
    handle = installMobileInput(fakeGame(), { enabled: true });
    handle!.setStick(0, 1);
    handle!.setStick(0, 0);
    expect(codes('keyup')).toEqual(['KeyS', 'ArrowDown']);
  });

  it('does not re-fire keydown while a direction is held', () => {
    handle = installMobileInput(fakeGame(), { enabled: true });
    handle!.setStick(-1, 0);
    handle!.setStick(-0.9, 0.1);
    expect(codes('keydown')).toEqual(['KeyA', 'ArrowLeft']);
  });

  it('swaps keys cleanly when the stick crosses to the opposite direction', () => {
    handle = installMobileInput(fakeGame(), { enabled: true });
    handle!.setStick(1, 0);
    recorded = [];
    handle!.setStick(-1, 0);
    expect(codes('keyup')).toEqual(['KeyD', 'ArrowRight']);
    expect(codes('keydown')).toEqual(['KeyA', 'ArrowLeft']);
  });

  it('carries keyCode, which is what Phaser reads', () => {
    handle = installMobileInput(fakeGame(), { enabled: true });
    handle!.press('primary');
    expect(recorded[0]).toMatchObject({ code: 'Space', keyCode: 32 });
  });

  it('taps an action down and back up', async () => {
    handle = installMobileInput(fakeGame(), { enabled: true });
    handle!.tap('secondary');
    expect(codes('keydown')).toEqual(['KeyE']);
    await new Promise((r) => setTimeout(r, 100));
    expect(codes('keyup')).toEqual(['KeyE']);
  });

  it('lets pointer events through to the canvas outside the controls', () => {
    handle = installMobileInput(fakeGame(), { enabled: true });
    // A tap-to-play game must keep working once the overlay exists.
    expect(handle!.element.style.pointerEvents).toBe('none');
  });

  it('exposes itself globally so a headless run can play without a keyboard', () => {
    handle = installMobileInput(fakeGame(), { enabled: true });
    expect(
      (globalThis as { __ogMobileInput?: unknown }).__ogMobileInput,
    ).toBe(handle);
  });

  it('releases everything and detaches on destroy', () => {
    handle = installMobileInput(fakeGame(), { enabled: true });
    handle!.setStick(1, 1);
    const element = handle!.element;
    handle!.destroy();
    handle = null;
    expect(codes('keyup')).toEqual(
      expect.arrayContaining(['KeyD', 'ArrowRight', 'KeyS', 'ArrowDown']),
    );
    expect(element.isConnected).toBe(false);
    expect(
      (globalThis as { __ogMobileInput?: unknown }).__ogMobileInput,
    ).toBeUndefined();
  });
});
