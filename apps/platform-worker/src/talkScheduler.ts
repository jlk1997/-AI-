/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Talk lanes + a process-wide parallel cap (Park-style concurrent cognition
 * without one global HTTP chain).
 */

export interface TalkScheduler {
  /**
   * Runs `run` after anything already queued on the same lane.
   *
   * Lanes exist so one world can hold several conversations at once: callers pass
   * the participant set as the lane, which keeps the same residents in order
   * while unrelated groups talk in parallel. Omitting the lane serialises the
   * whole world, which is what a town-wide beat wants.
   */
  enqueue(
    worldId: string,
    run: () => Promise<void>,
    opts?: { readonly lane?: string },
  ): void;
  isBusy(worldId: string): boolean;
  /** Tasks queued or running for a world, across all its lanes. */
  inflight(worldId: string): number;
}

/** Stable lane key for a set of participants. */
export function laneForParticipants(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join(',');
}

export function createTalkScheduler(input: {
  readonly cap: () => number;
  readonly onError?: (worldId: string, err: unknown) => void;
}): TalkScheduler {
  let inUse = 0;
  const waiters: Array<() => void> = [];
  const tails = new Map<string, Promise<unknown>>();
  const inflightByWorld = new Map<string, number>();

  function acquire(): Promise<void> {
    const cap = Math.max(1, input.cap());
    if (inUse < cap) {
      inUse += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waiters.push(() => {
        inUse += 1;
        resolve();
      });
    });
  }

  function release(): void {
    inUse = Math.max(0, inUse - 1);
    const next = waiters.shift();
    if (next) next();
  }

  return {
    isBusy(worldId: string): boolean {
      return (inflightByWorld.get(worldId) ?? 0) > 0;
    },
    inflight(worldId: string): number {
      return inflightByWorld.get(worldId) ?? 0;
    },
    enqueue(worldId, run, opts): void {
      const key = `${worldId}\u0000${opts?.lane ?? ''}`;
      inflightByWorld.set(worldId, (inflightByWorld.get(worldId) ?? 0) + 1);
      const prev = tails.get(key) ?? Promise.resolve();
      const next = prev
        .catch(() => undefined)
        .then(async () => {
          await acquire();
          try {
            await run();
          } finally {
            release();
          }
        })
        .catch((err) => {
          input.onError?.(worldId, err);
        })
        .finally(() => {
          const left = (inflightByWorld.get(worldId) ?? 1) - 1;
          if (left > 0) inflightByWorld.set(worldId, left);
          else inflightByWorld.delete(worldId);
          if (tails.get(key) === next) tails.delete(key);
        });
      tails.set(key, next);
    },
  };
}
