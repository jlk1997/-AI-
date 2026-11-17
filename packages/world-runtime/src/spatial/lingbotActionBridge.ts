/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Maps OpenGame symbolic actions → LingBot-World-v2 style action manifests.
 * LingBot consumes action_path dirs with action.npy / wasd_action.npy / poses.npy;
 * this bridge emits portable JSON the sidecar converts to those arrays.
 *
 * @see https://github.com/Robbyant/lingbot-world-v2
 */

export type WorldActionKind =
  | 'noop'
  | 'move_n'
  | 'move_s'
  | 'move_e'
  | 'move_w'
  | 'talk'
  | 'wait'
  | 'tick'
  | 'give_ore'
  | 'use_portal'
  | 'attack'
  | 'archery'
  | 'spell'
  | 'shoot';

/** Discrete WASD-like codes aligned with LingBot wasd_action channels. */
export type LingBotWasdCode =
  | 'idle'
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'attack'
  | 'archery'
  | 'spell'
  | 'shoot'
  | 'interact'
  | 'look_up'
  | 'look_down';

export interface LingBotActionFrame {
  readonly t: number;
  readonly wasd: LingBotWasdCode;
  /** Optional text-driven event (LingBot “text events”). */
  readonly textEvent?: string;
  /** Camera yaw/pitch deltas in radians (sidecar → poses.npy). */
  readonly yawDelta?: number;
  readonly pitchDelta?: number;
}

export interface LingBotActionManifest {
  readonly schema: 'opengame-lingbot-action-v1';
  readonly fps: number;
  readonly frameCount: number;
  readonly frames: LingBotActionFrame[];
  /** Prompt fragment describing interactive intent for the video model. */
  readonly conditioningPrompt: string;
}

const MOVE_MAP: Partial<Record<WorldActionKind, LingBotWasdCode>> = {
  noop: 'idle',
  wait: 'idle',
  tick: 'idle',
  move_n: 'forward',
  move_s: 'back',
  move_e: 'right',
  move_w: 'left',
  talk: 'interact',
  give_ore: 'interact',
  use_portal: 'forward',
  attack: 'attack',
  archery: 'archery',
  spell: 'spell',
  shoot: 'shoot',
};

const TEXT_EVENTS: Partial<Record<WorldActionKind, string>> = {
  talk: 'The traveler speaks to a nearby character.',
  give_ore: 'The traveler hands over a chunk of ore.',
  use_portal: 'A shimmering portal opens and the traveler steps through.',
  attack: 'The traveler strikes with a weapon.',
  archery: 'The traveler draws a bow and looses an arrow.',
  spell: 'Arcane light flares as a spell is cast.',
  shoot: 'A projectile is fired toward the target.',
  tick: 'Time gently advances in the scene.',
};

/**
 * Expand a symbolic action into a short action-conditioned clip manifest.
 * Default: 16 frames @ 8 fps (~2s) — enough for cinematic beats without huge GPU cost.
 */
export function worldActionToLingBotManifest(
  action: WorldActionKind,
  options?: {
    readonly fps?: number;
    readonly holdFrames?: number;
    readonly styleHint?: string;
  },
): LingBotActionManifest {
  const fps = options?.fps ?? 8;
  const hold = Math.max(1, options?.holdFrames ?? 16);
  const wasd = MOVE_MAP[action] ?? 'idle';
  const textEvent = TEXT_EVENTS[action];
  const frames: LingBotActionFrame[] = [];
  for (let t = 0; t < hold; t++) {
    const settle = hold > 3 && t >= hold - 2;
    frames.push({
      t,
      wasd: settle ? 'idle' : wasd,
      ...(textEvent && t === 0 ? { textEvent } : {}),
      ...(wasd === 'left' || wasd === 'right'
        ? { yawDelta: wasd === 'left' ? 0.04 : -0.04 }
        : {}),
    });
  }
  const style = options?.styleHint?.trim()
    ? ` Style: ${options.styleHint.trim()}.`
    : '';
  return {
    schema: 'opengame-lingbot-action-v1',
    fps,
    frameCount: hold,
    frames,
    conditioningPrompt: `Interactive world clip for action "${action}" (${wasd}).${style}${
      textEvent ? ` Event: ${textEvent}` : ''
    }`,
  };
}

/** Encode a path of symbolic actions into one continuous manifest. */
export function worldActionPathToLingBotManifest(
  actions: readonly WorldActionKind[],
  options?: {
    readonly fps?: number;
    readonly framesPerAction?: number;
    readonly styleHint?: string;
  },
): LingBotActionManifest {
  const fps = options?.fps ?? 8;
  const per = Math.max(1, options?.framesPerAction ?? 8);
  const frames: LingBotActionFrame[] = [];
  const parts: string[] = [];
  let t = 0;
  for (const action of actions.length ? actions : (['noop'] as WorldActionKind[])) {
    const chunk = worldActionToLingBotManifest(action, {
      fps,
      holdFrames: per,
      styleHint: options?.styleHint,
    });
    parts.push(action);
    for (const f of chunk.frames) {
      frames.push({ ...f, t: t++ });
    }
  }
  return {
    schema: 'opengame-lingbot-action-v1',
    fps,
    frameCount: frames.length,
    frames,
    conditioningPrompt: `Continuous interactive path: ${parts.join(' → ')}.${
      options?.styleHint ? ` Style: ${options.styleHint}.` : ''
    }`,
  };
}

/** Flatten WASD codes to a dense one-hot matrix [T, C] for sidecar → npy. */
export const LINGBOT_WASD_CHANNELS: readonly LingBotWasdCode[] = [
  'idle',
  'forward',
  'back',
  'left',
  'right',
  'attack',
  'archery',
  'spell',
  'shoot',
  'interact',
  'look_up',
  'look_down',
] as const;

export function manifestToWasdMatrix(
  manifest: LingBotActionManifest,
): number[][] {
  const C = LINGBOT_WASD_CHANNELS.length;
  return manifest.frames.map((f) => {
    const row = new Array<number>(C).fill(0);
    const idx = LINGBOT_WASD_CHANNELS.indexOf(f.wasd);
    row[idx >= 0 ? idx : 0] = 1;
    return row;
  });
}
