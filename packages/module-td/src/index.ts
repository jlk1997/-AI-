/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface WaveSpec {
  readonly id: string;
  readonly enemyCount: number;
  readonly spawnIntervalMs?: number;
}

export interface WaveManagerConfig {
  readonly waves: WaveSpec[];
  readonly onWaveStart?: (wave: WaveSpec, index: number) => void;
  readonly onAllWavesComplete?: () => void;
}

/** Simple wave index tracker for tower-defense Scenes. */
export class WaveManager {
  private readonly waves: WaveSpec[];
  private readonly onWaveStart?: (wave: WaveSpec, index: number) => void;
  private readonly onAllWavesComplete?: () => void;
  private index = -1;

  constructor(config: WaveManagerConfig) {
    this.waves = config.waves;
    this.onWaveStart = config.onWaveStart;
    this.onAllWavesComplete = config.onAllWavesComplete;
  }

  start(): void {
    this.index = -1;
    this.nextWave();
  }

  nextWave(): void {
    this.index += 1;
    const wave = this.waves[this.index];
    if (!wave) {
      this.onAllWavesComplete?.();
      return;
    }
    this.onWaveStart?.(wave, this.index);
  }

  getCurrentWave(): WaveSpec | null {
    if (this.index < 0 || this.index >= this.waves.length) return null;
    return this.waves[this.index] ?? null;
  }
}

export class EconomyManager {
  private gold: number;

  constructor(initialGold: number) {
    this.gold = initialGold;
  }

  getGold(): number {
    return this.gold;
  }

  canAfford(cost: number): boolean {
    return this.gold >= cost;
  }

  spend(cost: number): boolean {
    if (!this.canAfford(cost)) return false;
    this.gold -= cost;
    return true;
  }

  earn(amount: number): void {
    this.gold += amount;
  }
}
