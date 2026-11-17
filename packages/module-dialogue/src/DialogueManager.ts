/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Phaser from 'phaser';

import type { DialogueEntry } from './types.js';

/** Event-driven dialogue engine — wire UI via showText / showChoice events. */
export class DialogueManager extends Phaser.Events.EventEmitter {
  private readonly scene: Phaser.Scene;
  private dialogues: DialogueEntry[] = [];
  private idIndex = new Map<string, number>();
  private currentIndex = 0;
  private isPlaying = false;
  private isWaitingForInput = false;
  private isChoiceActive = false;
  private isAutoAdvancing = false;

  constructor(scene: Phaser.Scene) {
    super();
    this.scene = scene;
  }

  loadDialogues(dialogues: DialogueEntry[]): void {
    this.dialogues = [...dialogues];
    this.rebuildIndex();
    this.currentIndex = 0;
    this.isPlaying = false;
    this.isWaitingForInput = false;
    this.isChoiceActive = false;
    this.isAutoAdvancing = false;
  }

  /** Load story JSON shape `{ entries: DialogueEntry[] }` from Phaser cache or raw. */
  loadFromStoryJson(data: { entries?: DialogueEntry[] } | DialogueEntry[]): void {
    const entries = Array.isArray(data)
      ? data
      : Array.isArray(data.entries)
        ? data.entries
        : [];
    this.loadDialogues(entries);
  }

  start(fromIndexOrId?: number | string): void {
    if (this.dialogues.length === 0) {
      this.emit('dialogueComplete');
      return;
    }
    if (typeof fromIndexOrId === 'string') {
      const idx = this.idIndex.get(fromIndexOrId);
      this.currentIndex = idx ?? 0;
    } else {
      this.currentIndex = fromIndexOrId ?? 0;
    }
    this.isPlaying = true;
    this.processEntry(this.dialogues[this.currentIndex]!);
  }

  advance(): void {
    if (!this.isPlaying || this.isChoiceActive || this.isAutoAdvancing) return;
    this.isWaitingForInput = false;
    const cur = this.dialogues[this.currentIndex];
    // Graph edge: present nextId field (including JSON null) must not fall through
    // into later array entries — that caused chapter loops when branches sat after
    // a terminal `nextId: null` line.
    if (cur && Object.prototype.hasOwnProperty.call(cur, 'nextId')) {
      const nid = cur.nextId;
      if (typeof nid === 'string' && nid.trim().length > 0) {
        this.jumpToId(nid.trim());
        return;
      }
      this.isPlaying = false;
      this.emit('dialogueComplete');
      return;
    }
    this.currentIndex++;
    if (this.currentIndex >= this.dialogues.length) {
      this.isPlaying = false;
      this.emit('dialogueComplete');
      return;
    }
    this.processEntry(this.dialogues[this.currentIndex]!);
  }

  selectChoice(optionIndex: number): void {
    if (!this.isChoiceActive) return;
    const entry = this.dialogues[this.currentIndex];
    if (!entry || entry.type !== 'choice' || !entry.options) return;
    const visible = entry.options.filter((opt) => !opt.condition || opt.condition());
    const selected = visible[optionIndex];
    if (!selected) return;
    this.isChoiceActive = false;
    this.emit('choiceSelected', entry.id ?? '', selected, optionIndex);
    // Explicit null / empty nextId ends the graph (same contract as text nodes).
    if (Object.prototype.hasOwnProperty.call(selected, 'nextId')) {
      const nid = selected.nextId;
      if (typeof nid === 'string' && nid.trim().length > 0) {
        this.jumpToId(nid.trim());
        return;
      }
      this.isPlaying = false;
      this.emit('dialogueComplete');
      return;
    }
    this.advance();
  }

  skipAll(): void {
    this.isPlaying = false;
    this.isWaitingForInput = false;
    this.isChoiceActive = false;
    this.currentIndex = this.dialogues.length;
    this.emit('dialogueComplete');
  }

  private rebuildIndex(): void {
    this.idIndex.clear();
    this.dialogues.forEach((d, i) => {
      if (d.id) this.idIndex.set(d.id, i);
    });
  }

  private jumpToId(id: string): void {
    const idx = this.idIndex.get(id);
    if (idx == null) {
      this.isPlaying = false;
      this.emit('dialogueComplete');
      return;
    }
    // Soft cycle guard — same id re-entered while still waiting on that line.
    if (idx === this.currentIndex && this.isWaitingForInput) {
      this.isPlaying = false;
      this.emit('dialogueComplete');
      return;
    }
    this.currentIndex = idx;
    this.processEntry(this.dialogues[this.currentIndex]!);
  }

  private processEntry(entry: DialogueEntry): void {
    switch (entry.type ?? 'text') {
      case 'text':
        this.isWaitingForInput = true;
        this.emit('showText', entry.speaker ?? '', entry.text ?? '', entry.expression);
        this.emit('waitingForInput');
        break;
      case 'choice': {
        const visible = (entry.options ?? []).filter(
          (opt) => !opt.condition || opt.condition(),
        );
        if (visible.length === 0) {
          this.advance();
          return;
        }
        this.isChoiceActive = true;
        this.emit('showChoice', entry.id ?? '', entry.prompt ?? '', visible);
        break;
      }
      case 'branch': {
        const ok = entry.condition ? entry.condition() : true;
        const branch = ok ? entry.trueBranch : entry.falseBranch;
        if (branch && branch.length > 0) {
          const insertAt = this.currentIndex + 1;
          this.dialogues = [
            ...this.dialogues.slice(0, insertAt),
            ...branch,
            ...this.dialogues.slice(insertAt),
          ];
          this.rebuildIndex();
        }
        if (entry.nextId) {
          this.jumpToId(entry.nextId);
        } else {
          this.currentIndex++;
          if (this.currentIndex >= this.dialogues.length) {
            this.isPlaying = false;
            this.emit('dialogueComplete');
            return;
          }
          this.processEntry(this.dialogues[this.currentIndex]!);
        }
        break;
      }
      case 'event':
        this.emit('triggerEvent', entry.action ?? '', entry.data);
        this.advance();
        break;
      case 'character':
        this.emit(
          'characterAction',
          entry.characterId ?? '',
          entry.action ?? '',
          entry.position,
        );
        this.isAutoAdvancing = true;
        this.scene.time.delayedCall(entry.action === 'enter' ? 300 : 50, () => {
          this.isAutoAdvancing = false;
          this.advance();
        });
        break;
      case 'wait':
        this.isAutoAdvancing = true;
        this.scene.time.delayedCall(entry.duration ?? 1000, () => {
          this.isAutoAdvancing = false;
          this.advance();
        });
        break;
      default:
        this.advance();
    }
  }
}
