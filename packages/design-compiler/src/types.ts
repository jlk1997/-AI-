/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SystemsJson {
  readonly version: 1;
  readonly inventoryCapacity: number;
  readonly growth: {
    readonly maxLevel: number;
    readonly baseHp: number;
    readonly baseAtk: number;
  };
  readonly economy: {
    readonly startingGold: number;
    readonly items: Array<{
      id: string;
      name: string;
      price?: number;
      tags?: string[];
    }>;
    readonly recipes: Array<{
      id: string;
      inputs: Array<{ itemId: string; qty: number }>;
      output: { itemId: string; qty: number };
    }>;
  };
  readonly equipment: Array<{
    id: string;
    slot: 'weapon' | 'armor' | 'accessory';
    atkBonus?: number;
    hpBonus?: number;
  }>;
  readonly skills: Array<{
    id: string;
    name: string;
    power: number;
  }>;
  readonly factions: string[];
  readonly juiceBudget: {
    readonly cameraShake: boolean;
    readonly particles: boolean;
    readonly hitStopMs: number;
    readonly sfxOnHit: boolean;
  };
}

export interface ContentJson {
  readonly version: 1;
  readonly quests: Array<{
    id: string;
    title: string;
    description?: string;
    requires: string[];
  }>;
  readonly dialogues: Array<{
    id: string;
    speaker: string;
    lines: string[];
    choices?: Array<{ text: string; nextId?: string; setFlag?: string }>;
  }>;
  readonly encounters: Array<{
    id: string;
    enemyId: string;
    enemyHp: number;
    enemyAtk: number;
    label: string;
  }>;
  readonly chapters: Array<{ id: string; title: string; beatCount: number }>;
  readonly estimatedMinutes: number;
}

export interface CompileIssue {
  readonly level: 'error' | 'warn';
  readonly message: string;
}

export interface CompileResult {
  readonly ok: boolean;
  readonly systems: SystemsJson;
  readonly content: ContentJson;
  readonly issues: CompileIssue[];
}

export interface DesignCompilerInput {
  readonly gddMarkdown?: string;
  readonly storyBible?: {
    npcs?: Array<{ id?: string; name?: string }>;
    quests?: Array<{
      id?: string;
      title?: string;
      description?: string;
      requires?: string[];
    }>;
    endings?: Record<string, unknown>;
  };
  readonly targetMinutes?: number;
}
