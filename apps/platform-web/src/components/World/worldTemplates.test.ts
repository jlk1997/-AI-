/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../services/i18n';
import {
  pickSeededObservatoryPrompt,
  promptForWorldTemplate,
  rememberWorldGeneratePrompt,
  readLastWorldGeneratePrompt,
  WORLD_PROMPT_SEEDS,
} from './worldTemplates';

describe('world demo prompts', () => {
  beforeEach(() => {
    setLocale('zh-CN');
  });

  it('never repeats a demo-town prompt across a full seed bag plus extras', () => {
    const seen = new Set<string>();
    const n = WORLD_PROMPT_SEEDS.demo.length + 3;
    for (let i = 0; i < n; i++) {
      const prompt = pickSeededObservatoryPrompt(
        WORLD_PROMPT_SEEDS.demo,
        'test-demo-town-bag',
        () => 0.42,
      );
      expect(seen.has(prompt)).toBe(false);
      seen.add(prompt);
      expect(prompt).toMatch(/可观察/);
      expect(prompt).toMatch(/不是通关/);
      expect(prompt).toMatch(/society\.town/);
    }
    const joined = [...seen].join('\n');
    expect(joined).toMatch(/渔村/);
    expect(joined).toMatch(/矿窑/);
    expect(joined).toMatch(/夜市/);
  });

  it('keeps forest and camp clicks on observatory language', () => {
    const forest = pickSeededObservatoryPrompt(
      WORLD_PROMPT_SEEDS.forest,
      'test-forest-bag',
      () => 0.2,
    );
    const camp = pickSeededObservatoryPrompt(
      WORLD_PROMPT_SEEDS.camp,
      'test-camp-bag',
      () => 0.2,
    );
    expect(forest).toMatch(/药庐|猎场|祭坛/);
    expect(forest).toMatch(/不是通关/);
    expect(camp).toMatch(/补给帐|情报棚|营火/);
    expect(camp).toMatch(/不是通关/);
    expect(camp).not.toMatch(/打 Boss/);
  });

  it('resolves homepage template ids to live prompts', () => {
    const a = promptForWorldTemplate('demo_town');
    const b = promptForWorldTemplate('demo_town');
    expect(a).not.toBe(b);
    expect(promptForWorldTemplate('lingbot_cinematic')).toMatch(/LingBot/);
    expect(promptForWorldTemplate('agentic_expand')).toMatch(/agentic director/);
  });

  it('promptForWorldTemplate can override pack minPeople', () => {
    const compact = promptForWorldTemplate('demo_town', { population: 10 });
    expect(compact).toMatch(/至少 10 名/);
    expect(compact).not.toMatch(/至少 22 名/);
    expect(compact).toMatch(/约 10 人/);
    expect(compact).not.toMatch(/18–25/);
    expect(compact).not.toMatch(/18-25/);
    const crowdedCrew = promptForWorldTemplate('crew_watch', { population: 36 });
    expect(crowdedCrew).toMatch(/至少 36 名/);
    expect(crowdedCrew).toMatch(/约 36 人/);
    expect(crowdedCrew).toMatch(/society\.crew/);
    expect(crowdedCrew).not.toMatch(/8–12/);
  });

  it('crew and cloister templates use their packs, not a 22-person town tail', () => {
    const crew = promptForWorldTemplate('crew_watch');
    expect(crew).toMatch(/society\.crew/);
    expect(crew).not.toMatch(/society\.town/);
    expect(crew).not.toMatch(/至少 22/);
    expect(crew).toMatch(/舰桥|甲板/);
    expect(crew).toMatch(/不是通关/);
    const cloister = promptForWorldTemplate('cloister_hours');
    expect(cloister).toMatch(/society\.cloister/);
    expect(cloister).not.toMatch(/至少 22/);
    expect(cloister).toMatch(/礼拜堂|抄经/);
  });

  it('English one-clicks compile crew/cloister packs without Chinese observatory tails', () => {
    setLocale('en');
    const crew = promptForWorldTemplate('crew_watch');
    expect(crew).toMatch(/society\.crew/);
    expect(crew).toMatch(/Compile an observable/);
    expect(crew).toMatch(/Bridge|deck/i);
    expect(crew).not.toMatch(/可观察/);
    expect(crew).not.toMatch(/society\.town/);
    expect(crew).not.toMatch(/至少 22/);
    const harbor = promptForWorldTemplate('demo_town');
    expect(harbor).toMatch(/Compile an observable/);
    expect(harbor).toMatch(/society\.town/);
    expect(harbor).toMatch(/dock|kiln|night market/i);
    expect(harbor).not.toMatch(/可观察/);
  });

  it('remembers the last generate prompt so regenerate can reuse it', () => {
    rememberWorldGeneratePrompt('proj-a', '生成一座靠海渔村社会');
    expect(readLastWorldGeneratePrompt('proj-a')).toBe(
      '生成一座靠海渔村社会',
    );
    expect(readLastWorldGeneratePrompt('proj-b')).toBeNull();
  });
});
