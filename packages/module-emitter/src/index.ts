/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bullet emitter capability. Scene presents; this module owns spawn / step / hit.
 */

export type Bullet = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly alive: boolean;
};

export type EmitterState = {
  readonly bullets: readonly Bullet[];
  readonly nextId: number;
};

export type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export function createEmitter(): EmitterState {
  return { bullets: [], nextId: 1 };
}

export function emitRadial(
  state: EmitterState,
  x: number,
  y: number,
  count: number,
  speed: number,
): EmitterState {
  const n = Math.max(1, Math.floor(count));
  const bullets = [...state.bullets];
  let nextId = state.nextId;
  for (let i = 0; i < n; i += 1) {
    const angle = (Math.PI * 2 * i) / n;
    bullets.push({
      id: `b${nextId}`,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alive: true,
    });
    nextId += 1;
  }
  return { bullets, nextId };
}

export function stepBullets(
  state: EmitterState,
  dtSec: number,
  bounds: Bounds,
): EmitterState {
  const bullets = state.bullets.map((b) => {
    if (!b.alive) return b;
    const x = b.x + b.vx * dtSec;
    const y = b.y + b.vy * dtSec;
    const alive =
      x >= bounds.minX &&
      x <= bounds.maxX &&
      y >= bounds.minY &&
      y <= bounds.maxY;
    return { ...b, x, y, alive };
  });
  return { ...state, bullets };
}

export function hitTest(
  bullets: readonly Bullet[],
  x: number,
  y: number,
  radius: number,
): string | null {
  const r2 = radius * radius;
  for (const b of bullets) {
    if (!b.alive) continue;
    const dx = b.x - x;
    const dy = b.y - y;
    if (dx * dx + dy * dy <= r2) return b.id;
  }
  return null;
}
