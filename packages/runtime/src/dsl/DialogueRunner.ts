/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type Phaser from 'phaser';

import { Dialog, type DialogLine } from '../behaviors/Dialog.js';
import type { World } from '../core/World.js';
import type { DialogueLine } from './schema.js';

function resolveDialogueGroup(
  lines: ReadonlyArray<DialogueLine>,
  key: string,
): DialogLine[] {
  if (lines.length === 0) return [];
  const grouped = lines.filter((line) => {
    const row = line as DialogueLine & { group?: string };
    return row.group === key || line.id === key;
  });
  if (grouped.length > 0) {
    return grouped.map((line) => ({
      id: line.id,
      speaker: line.speaker,
      text: line.text,
      choices: line.choices,
      nextId: line.nextId,
    }));
  }
  const startIdx = lines.findIndex((line) => line.id === key);
  if (startIdx < 0) return [];
  const out: DialogLine[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;
    if (i > startIdx && line.id && line.id !== key) break;
    out.push({
      id: line.id,
      speaker: line.speaker,
      text: line.text,
      choices: line.choices,
      nextId: line.nextId,
    });
  }
  return out;
}

/**
 * Reads root `dialogue[]` from game.json and drives the Dialog UI behavior.
 */
export class DialogueRunner {
  private readonly scene: Phaser.Scene;
  private readonly lines: ReadonlyArray<DialogueLine>;

  constructor(scene: Phaser.Scene, lines: ReadonlyArray<DialogueLine> | undefined) {
    this.scene = scene;
    this.lines = lines ?? [];
  }

  start(key: string, onComplete?: () => void): void {
    const dialogLines = resolveDialogueGroup(this.lines, key);
    if (dialogLines.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(`[opengame/runtime] DialogueRunner: no lines for key "${key}"`);
      onComplete?.();
      return;
    }
    const self = this.scene as unknown as { __ogWorld?: World };
    const world = self.__ogWorld;
    if (!world) {
      onComplete?.();
      return;
    }
    const entity = world.spawn(['dialogue']);
    entity.add(
      new Dialog({
        lines: dialogLines,
        onComplete: () => {
          entity.destroy();
          onComplete?.();
        },
      }),
    );
  }
}

/** Resolve inline dialog behavior options that reference a dialogue id. */
export function resolveDialogBehaviorLines(
  opts: Record<string, unknown>,
  dslLines: ReadonlyArray<DialogueLine> | undefined,
): DialogLine[] | null {
  const rawLines = opts['lines'];
  if (Array.isArray(rawLines) && rawLines.length > 0) {
    return rawLines as DialogLine[];
  }
  const dialogueId =
    typeof opts['dialogueId'] === 'string'
      ? opts['dialogueId']
      : typeof opts['id'] === 'string'
        ? opts['id']
        : '';
  if (!dialogueId || !dslLines) return null;
  const resolved = resolveDialogueGroup(dslLines, dialogueId);
  return resolved.length > 0 ? resolved : null;
}
