/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export type PhaseCallback = (phaseName: string) => void;

export interface TurnManagerConfig {
  readonly phases: string[];
  readonly autoAdvance?: boolean;
}

/** Standalone turn/phase state machine for card battlers, quiz games, TRPG, etc. */
export class TurnManager {
  private phases: string[];
  private autoAdvance: boolean;
  private currentIndex = -1;
  private turnNumber = 0;
  private isRunning = false;
  private isPaused = false;
  private enterCallbacks = new Map<string, PhaseCallback[]>();
  private exitCallbacks = new Map<string, PhaseCallback[]>();

  constructor(config: TurnManagerConfig) {
    this.phases = config.phases;
    this.autoAdvance = config.autoAdvance ?? false;
  }

  onPhaseEnter(phaseName: string, callback: PhaseCallback): void {
    const existing = this.enterCallbacks.get(phaseName) ?? [];
    existing.push(callback);
    this.enterCallbacks.set(phaseName, existing);
  }

  onPhaseExit(phaseName: string, callback: PhaseCallback): void {
    const existing = this.exitCallbacks.get(phaseName) ?? [];
    existing.push(callback);
    this.exitCallbacks.set(phaseName, existing);
  }

  start(): void {
    if (this.phases.length === 0) return;
    this.isRunning = true;
    this.isPaused = false;
    this.turnNumber = 1;
    this.currentIndex = -1;
    this.advanceToNext();
  }

  nextPhase(): void {
    if (!this.isRunning || this.isPaused) return;
    this.advanceToNext();
  }

  goToPhase(phaseName: string): void {
    if (!this.isRunning || this.isPaused) return;
    const targetIndex = this.phases.indexOf(phaseName);
    if (targetIndex === -1) return;
    this.exitCurrentPhase();
    this.currentIndex = targetIndex;
    this.enterCurrentPhase();
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }

  stop(): void {
    this.exitCurrentPhase();
    this.isRunning = false;
    this.currentIndex = -1;
  }

  getCurrentPhase(): string {
    if (this.currentIndex < 0 || this.currentIndex >= this.phases.length) return '';
    return this.phases[this.currentIndex]!;
  }

  getTurnNumber(): number {
    return this.turnNumber;
  }

  isActive(): boolean {
    return this.isRunning;
  }

  private advanceToNext(): void {
    const maxIterations = this.phases.length + 1;
    let iterations = 0;
    do {
      this.exitCurrentPhase();
      this.currentIndex++;
      if (this.currentIndex >= this.phases.length) {
        this.turnNumber++;
        this.currentIndex = 0;
      }
      this.enterCurrentPhase();
      iterations++;
    } while (this.autoAdvance && this.isRunning && !this.isPaused && iterations < maxIterations);
  }

  private enterCurrentPhase(): void {
    const phase = this.getCurrentPhase();
    if (!phase) return;
    for (const cb of this.enterCallbacks.get(phase) ?? []) cb(phase);
  }

  private exitCurrentPhase(): void {
    const phase = this.getCurrentPhase();
    if (!phase) return;
    for (const cb of this.exitCallbacks.get(phase) ?? []) cb(phase);
  }
}
