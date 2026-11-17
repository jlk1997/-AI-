/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { setLocale } from '../../services/i18n';
import {
  applyWorldTemplateToPrefs,
  composeCastNote,
  composeWorldGeneratePrompt,
  composeWorldTemplatePrompt,
  defaultVenuesFor,
  withPack,
  withTownCast,
  worldBriefOf,
  worldCastContract,
} from './composeWorldBrief';
import { defaultWorldCreatePrefs } from './worldCreatePrefs';

describe('composeCastNote', () => {
  it('joins two people and tonight’s talk into one sentence', () => {
    expect(composeCastNote('林嫂，摊主', '阿禾，补网', '茶馆对质')).toBe(
      '林嫂，摊主和阿禾，补网：茶馆对质',
    );
    expect(composeCastNote('Lin', 'A-He', 'teahouse tonight', ' and ')).toBe(
      'Lin and A-He：teahouse tonight',
    );
    expect(composeCastNote('', '', '只有闲话')).toBe('只有闲话');
    expect(composeCastNote('林嫂', '', '')).toBe('林嫂');
  });

  it('states the two named people as the rumor pair and the rest as neighbors', () => {
    setLocale('zh-CN');
    const prefs = withTownCast(defaultWorldCreatePrefs(), {
      castA: '林嫂，夜市摊主',
      castB: '阿禾，补网人',
      rumor: '茶馆对质',
    });
    const line = worldCastContract(prefs);
    expect(line).toMatch(/点名：林嫂、阿禾/);
    expect(line).toMatch(/当事双方/);
    expect(line).toMatch(/同镇邻居/);
    const prompt = composeWorldGeneratePrompt(prefs);
    expect(prompt).toMatch(/点名：林嫂、阿禾/);
    expect(prompt).toMatch(/约 20 人是同镇邻居/);
  });

  it('writes the composed sentence onto the brief', () => {
    const next = withTownCast(defaultWorldCreatePrefs(), {
      castA: '林嫂，摊主',
      castB: '阿禾，补网',
      rumor: '茶馆对质',
    });
    expect(next.note).toMatch(/林嫂/);
    expect(next.castA).toBe('林嫂，摊主');
  });
});

describe('composeWorldGeneratePrompt', () => {
  it('is stable for the same brief and does not rotate a demo-town seed bag', () => {
    setLocale('zh-CN');
    const prefs = defaultWorldCreatePrefs();
    const a = composeWorldGeneratePrompt(prefs);
    const b = composeWorldGeneratePrompt(prefs);
    expect(a).toBe(b);
    expect(a).toMatch(/society\.town/);
    expect(a).toMatch(/场所必须包含夜市、茶馆/);
    expect(a).toMatch(/至少 22 名/);
    expect(a).toMatch(/巷议运营/);
    expect(a).not.toMatch(/靠海渔村|斯坦福/);
    expect(a).toMatch(/不要用 town_square/);
    expect(a).not.toMatch(/林嫂/);
  });

  it('puts the author note into the prompt after the contract', () => {
    setLocale('zh-CN');
    const prefs = {
      ...defaultWorldCreatePrefs(),
      note: '夜市摊主林嫂和补网人阿禾今晚要在茶馆对质。',
    };
    const text = composeWorldGeneratePrompt(prefs);
    expect(text).toMatch(/林嫂/);
    expect(text).toMatch(/场所必须包含夜市/);
  });

  it('composes a different world for crew watch vs cloister vs night market', () => {
    setLocale('zh-CN');
    const base = defaultWorldCreatePrefs();
    const town = composeWorldGeneratePrompt(base);
    const crew = composeWorldGeneratePrompt(
      withPack({ ...base, useCase: 'workplace' }, 'society.crew'),
    );
    const cloister = composeWorldGeneratePrompt(
      applyWorldTemplateToPrefs(base, 'cloister_hours'),
    );
    expect(town).toMatch(/夜市/);
    expect(crew).toMatch(/society\.crew/);
    expect(crew).toMatch(/舰桥/);
    expect(cloister).toMatch(/society\.cloister/);
    expect(cloister).toMatch(/礼拜堂/);
    expect(new Set([town, crew, cloister]).size).toBe(3);
  });

  it('keeps an English brief off the Chinese demo bag', () => {
    const prefs = defaultWorldCreatePrefs();
    const en = composeWorldGeneratePrompt(prefs, undefined, 'en');
    expect(en).toMatch(/Places must include night market/);
    expect(en).toMatch(/Do not collapse/);
    expect(en).not.toMatch(/渔村|矿窑小镇/);
  });

  it('appends the author sentence after the contract', () => {
    setLocale('zh-CN');
    const text = composeWorldGeneratePrompt(
      defaultWorldCreatePrefs(),
      '铁匠维加和邮差阿禾要在夜市碰面',
    );
    expect(text).toMatch(/维加/);
    expect(text).toMatch(/场所必须包含夜市/);
  });
});

describe('worldBriefOf / template fill', () => {
  it('exports the structured brief the job payload needs', () => {
    const brief = worldBriefOf(defaultWorldCreatePrefs());
    expect(brief.packId).toBe('society.town');
    expect(brief.venues).toEqual(['night_market', 'teahouse']);
    expect(brief.useCase).toBe('xiangyi');
  });

  it('fills inspiration chips into the brief instead of a rotating seed', () => {
    setLocale('zh-CN');
    const filled = applyWorldTemplateToPrefs(
      defaultWorldCreatePrefs(),
      'mystery_forest',
    );
    expect(filled.useCase).toBe('scenic');
    expect(filled.venues).toEqual(['herb_hut', 'hunting_ground']);
    expect(filled.note).toMatch(/药庐|桂厨/);
    const prompt = composeWorldTemplatePrompt(filled, 'mystery_forest');
    expect(prompt).toMatch(/药庐/);
    expect(prompt).toMatch(/猎场/);
    expect(prompt).toMatch(/桂厨|猎场/);
    expect(prompt).not.toMatch(/迷雾林边聚落/);
  });

  it('defaults venues when switching pack', () => {
    const crew = withPack(defaultWorldCreatePrefs(), 'society.crew');
    expect(crew.venues).toEqual(defaultVenuesFor('society.crew', 'xiangyi'));
    expect(crew.venues).toContain('bridge');
  });
});
