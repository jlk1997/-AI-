/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

/**
 * On-screen controls for keyboard-shaped games.
 *
 * Generated gameplay reads Phaser's keyboard (`cursors`, `addKey`,
 * `checkDown`), because that is what the Coder Agent has always written. On a
 * phone there is no keyboard, so those games open, render, and then do nothing
 * — which is how most of them would die in WeChat.
 *
 * Rather than ask every generated game to learn touch, this adapter draws a
 * stick and buttons over the canvas and **synthesises real keyboard events**.
 * Phaser's keyboard plugin listens on `window`, so an existing game is driven
 * by exactly the code path it already has. Nothing in the game has to know
 * this exists, including games generated before it did.
 */

/** Both families, because generated code picks one or the other freely. */
const DIRECTION_KEYS = {
  up: [
    { code: 'KeyW', key: 'w', keyCode: 87 },
    { code: 'ArrowUp', key: 'ArrowUp', keyCode: 38 },
  ],
  down: [
    { code: 'KeyS', key: 's', keyCode: 83 },
    { code: 'ArrowDown', key: 'ArrowDown', keyCode: 40 },
  ],
  left: [
    { code: 'KeyA', key: 'a', keyCode: 65 },
    { code: 'ArrowLeft', key: 'ArrowLeft', keyCode: 37 },
  ],
  right: [
    { code: 'KeyD', key: 'd', keyCode: 68 },
    { code: 'ArrowRight', key: 'ArrowRight', keyCode: 39 },
  ],
} as const;

export type Direction = keyof typeof DIRECTION_KEYS;

interface KeySpec {
  readonly code: string;
  readonly key: string;
  readonly keyCode: number;
}

const ACTION_KEYS: Record<string, KeySpec> = {
  primary: { code: 'Space', key: ' ', keyCode: 32 },
  secondary: { code: 'KeyE', key: 'e', keyCode: 69 },
  tertiary: { code: 'KeyF', key: 'f', keyCode: 70 },
  confirm: { code: 'Enter', key: 'Enter', keyCode: 13 },
};

export interface MobileInputOptions {
  /** Force on/off. Unset auto-detects a coarse pointer. */
  readonly enabled?: boolean;
  /** Hide the stick for games that only need taps (tower defence, card, UI). */
  readonly stick?: boolean;
  /** Which action buttons to draw, in order. */
  readonly actions?: ReadonlyArray<keyof typeof ACTION_KEYS>;
  /** Parent to mount into. Defaults to the Phaser canvas's parent. */
  readonly parent?: HTMLElement | null;
}

export interface MobileInputHandle {
  readonly element: HTMLElement;
  /** Drive the stick programmatically; `x`/`y` in -1..1. Used by QA. */
  setStick(x: number, y: number): void;
  press(action: string): void;
  release(action: string): void;
  /** Press and release, for a tap. */
  tap(action: string): void;
  destroy(): void;
}

/**
 * `keyCode` is deprecated and not part of `KeyboardEventInit`, but Phaser 3
 * still keys off it. Browsers accept it from the init dict as a legacy
 * extension; the `defineProperty` is the belt-and-braces for the ones that
 * silently drop it.
 */
function dispatchKey(type: 'keydown' | 'keyup', spec: KeySpec): void {
  const event = new KeyboardEvent(type, {
    code: spec.code,
    key: spec.key,
    keyCode: spec.keyCode,
    which: spec.keyCode,
    bubbles: true,
    cancelable: true,
  } as KeyboardEventInit);
  if ((event as KeyboardEvent & { keyCode: number }).keyCode !== spec.keyCode) {
    Object.defineProperty(event, 'keyCode', { get: () => spec.keyCode });
    Object.defineProperty(event, 'which', { get: () => spec.keyCode });
  }
  window.dispatchEvent(event);
}

export function shouldEnableMobileInput(explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit;
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const flag = params.get('touch');
  if (flag === 'off' || flag === '0') return false;
  if (flag === 'on' || flag === '1') return true;
  if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  return (navigator.maxTouchPoints ?? 0) > 0;
}

function styleControl(el: HTMLElement, size: number): void {
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = '50%';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.userSelect = 'none';
  el.style.touchAction = 'none';
  el.style.pointerEvents = 'auto';
  el.style.color = 'rgba(255,255,255,0.85)';
  el.style.font = '600 14px system-ui, sans-serif';
  el.style.background = 'rgba(255,255,255,0.14)';
  el.style.border = '1px solid rgba(255,255,255,0.28)';
  el.style.backdropFilter = 'blur(4px)';
}

export function installMobileInput(
  game: Phaser.Game,
  options: MobileInputOptions = {},
): MobileInputHandle | null {
  if (typeof document === 'undefined') return null;
  if (!shouldEnableMobileInput(options.enabled)) return null;

  const canvas = game.canvas as HTMLCanvasElement | undefined;
  const parent = options.parent ?? canvas?.parentElement ?? document.body;
  if (!parent) return null;
  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }

  const root = document.createElement('div');
  root.dataset['ogMobileInput'] = 'true';
  root.style.position = 'absolute';
  root.style.inset = '0';
  root.style.zIndex = '20';
  // Only the controls take input; everything else must reach the canvas, or
  // tap-to-play games stop responding the moment this is installed.
  root.style.pointerEvents = 'none';
  root.style.paddingLeft = 'env(safe-area-inset-left, 0px)';
  root.style.paddingRight = 'env(safe-area-inset-right, 0px)';
  root.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';

  const held = new Set<string>();
  const holdKey = (spec: KeySpec): void => {
    if (held.has(spec.code)) return;
    held.add(spec.code);
    dispatchKey('keydown', spec);
    game.events.emit('og:input');
  };
  const releaseKey = (spec: KeySpec): void => {
    if (!held.has(spec.code)) return;
    held.delete(spec.code);
    dispatchKey('keyup', spec);
  };

  let activeDirections: Direction[] = [];
  const applyDirections = (next: Direction[]): void => {
    for (const dir of activeDirections) {
      if (next.includes(dir)) continue;
      for (const spec of DIRECTION_KEYS[dir]) releaseKey(spec);
    }
    for (const dir of next) {
      if (activeDirections.includes(dir)) continue;
      for (const spec of DIRECTION_KEYS[dir]) holdKey(spec);
    }
    activeDirections = next;
  };

  /** Dead zone keeps a resting thumb from walking the player into a wall. */
  const DEAD_ZONE = 0.28;
  const setStick = (x: number, y: number): void => {
    const next: Direction[] = [];
    if (x <= -DEAD_ZONE) next.push('left');
    if (x >= DEAD_ZONE) next.push('right');
    if (y <= -DEAD_ZONE) next.push('up');
    if (y >= DEAD_ZONE) next.push('down');
    applyDirections(next);
    knob.style.transform = `translate(${x * 26}px, ${y * 26}px)`;
  };

  // ---- Stick ----
  const stickBase = document.createElement('div');
  const knob = document.createElement('div');
  const showStick = options.stick !== false;
  if (showStick) {
    stickBase.style.position = 'absolute';
    stickBase.style.left = '18px';
    stickBase.style.bottom = '18px';
    styleControl(stickBase, 108);
    stickBase.style.background = 'rgba(255,255,255,0.08)';

    styleControl(knob, 46);
    knob.style.position = 'relative';
    knob.style.pointerEvents = 'none';
    knob.style.background = 'rgba(255,255,255,0.28)';
    knob.style.transition = 'transform 60ms linear';
    stickBase.appendChild(knob);
    root.appendChild(stickBase);

    let pointerId: number | null = null;
    const track = (event: PointerEvent): void => {
      const rect = stickBase.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const radius = rect.width / 2;
      const nx = Math.max(-1, Math.min(1, (event.clientX - cx) / radius));
      const ny = Math.max(-1, Math.min(1, (event.clientY - cy) / radius));
      setStick(nx, ny);
    };
    stickBase.addEventListener('pointerdown', (event) => {
      pointerId = event.pointerId;
      stickBase.setPointerCapture(event.pointerId);
      track(event);
      event.preventDefault();
    });
    stickBase.addEventListener('pointermove', (event) => {
      if (pointerId !== event.pointerId) return;
      track(event);
      event.preventDefault();
    });
    const end = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      setStick(0, 0);
    };
    stickBase.addEventListener('pointerup', end);
    stickBase.addEventListener('pointercancel', end);
    stickBase.addEventListener('lostpointercapture', end);
  }

  // ---- Action buttons ----
  const actionNames = options.actions ?? (['primary', 'secondary'] as const);
  const buttons = new Map<string, HTMLElement>();
  const actionRow = document.createElement('div');
  actionRow.style.position = 'absolute';
  actionRow.style.right = '18px';
  actionRow.style.bottom = '18px';
  actionRow.style.display = 'flex';
  actionRow.style.gap = '12px';
  actionRow.style.alignItems = 'flex-end';
  actionRow.style.pointerEvents = 'none';

  const labelFor = (name: string): string =>
    name === 'primary' ? '●' : name === 'secondary' ? 'E' : name === 'tertiary' ? 'F' : '↵';

  for (const name of actionNames) {
    const spec = ACTION_KEYS[name];
    if (!spec) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', name);
    btn.textContent = labelFor(name);
    styleControl(btn, name === 'primary' ? 68 : 54);
    btn.style.cursor = 'pointer';
    btn.addEventListener('pointerdown', (event) => {
      holdKey(spec);
      event.preventDefault();
    });
    const up = (event: Event): void => {
      releaseKey(spec);
      event.preventDefault();
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
    buttons.set(name, btn);
    actionRow.appendChild(btn);
  }
  if (buttons.size > 0) root.appendChild(actionRow);

  parent.appendChild(root);

  // Anything still held when the tab goes away would otherwise stay held.
  const releaseAll = (): void => {
    applyDirections([]);
    for (const spec of Object.values(ACTION_KEYS)) releaseKey(spec);
  };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', releaseAll);

  const handle: MobileInputHandle = {
    element: root,
    setStick,
    press: (action) => {
      const spec = ACTION_KEYS[action];
      if (spec) holdKey(spec);
    },
    release: (action) => {
      const spec = ACTION_KEYS[action];
      if (spec) releaseKey(spec);
    },
    tap: (action) => {
      const spec = ACTION_KEYS[action];
      if (!spec) return;
      holdKey(spec);
      window.setTimeout(() => releaseKey(spec), 60);
    },
    destroy: () => {
      releaseAll();
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', releaseAll);
      root.remove();
      delete (globalThis as { __ogMobileInput?: unknown }).__ogMobileInput;
    },
  };

  // Exposed so the playability gate can finish a run with no keyboard at all.
  (globalThis as { __ogMobileInput?: MobileInputHandle }).__ogMobileInput = handle;
  return handle;
}
