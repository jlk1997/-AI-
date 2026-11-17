/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DialogueChoiceOption {
  readonly label: string;
  readonly nextId?: string | null;
  readonly condition?: () => boolean;
}

export interface DialogueEntry {
  readonly id?: string;
  readonly type?: 'text' | 'choice' | 'event' | 'character' | 'branch' | 'wait';
  readonly speaker?: string;
  readonly text?: string;
  readonly expression?: string;
  readonly prompt?: string;
  readonly options?: ReadonlyArray<DialogueChoiceOption>;
  readonly action?: string;
  readonly data?: Record<string, unknown>;
  readonly characterId?: string;
  readonly position?: string;
  readonly duration?: number;
  /** Jump to entry id after this line (graph edge). `null` = end dialogue. */
  readonly nextId?: string | null;
  readonly condition?: () => boolean;
  readonly trueBranch?: ReadonlyArray<DialogueEntry>;
  readonly falseBranch?: ReadonlyArray<DialogueEntry>;
}
