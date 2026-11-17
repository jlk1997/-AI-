/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CompileIssue,
  CompileResult,
  ContentJson,
  DesignCompilerInput,
  SystemsJson,
} from './types.js';

function extractListItems(md: string, heading: RegExp): string[] {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      inSection = heading.test(line);
      continue;
    }
    if (inSection && /^\s*[-*]\s+/.test(line)) {
      out.push(line.replace(/^\s*[-*]\s+/, '').trim());
    }
  }
  return out;
}

export function compileDesign(input: DesignCompilerInput): CompileResult {
  const issues: CompileIssue[] = [];
  const gdd = input.gddMarkdown ?? '';
  const bible = input.storyBible ?? {};
  const targetMinutes = input.targetMinutes ?? 30;

  const itemLines = extractListItems(gdd, /item|物品|道具/i);
  const questLines = extractListItems(gdd, /quest|任务/i);
  const factionLines = extractListItems(gdd, /faction|阵营/i);

  const systems: SystemsJson = {
    version: 1,
    inventoryCapacity: 24,
    growth: { maxLevel: 20, baseHp: 24, baseAtk: 4 },
    economy: {
      startingGold: 50,
      items: [
        { id: 'ore', name: '矿石', price: 8, tags: ['material'] },
        { id: 'herb', name: '草药', price: 6, tags: ['material'] },
        { id: 'potion', name: '药水', price: 20, tags: ['consumable'] },
        ...itemLines.slice(0, 12).map((name, i) => ({
          id: `item_${i + 1}`,
          name,
          price: 10 + i * 2,
        })),
      ],
      recipes: [
        {
          id: 'craft_potion',
          inputs: [
            { itemId: 'ore', qty: 1 },
            { itemId: 'herb', qty: 1 },
          ],
          output: { itemId: 'potion', qty: 1 },
        },
      ],
    },
    equipment: [
      { id: 'sword', slot: 'weapon', atkBonus: 2 },
      { id: 'cloak', slot: 'armor', hpBonus: 6 },
    ],
    skills: [
      { id: 'slash', name: '斩击', power: 2 },
      { id: 'guard_break', name: '破防', power: 4 },
    ],
    factions: factionLines.length
      ? factionLines.slice(0, 6)
      : ['town', 'forest', 'guild'],
    juiceBudget: {
      cameraShake: true,
      particles: true,
      hitStopMs: 40,
      sfxOnHit: true,
    },
  };

  const bibleQuests = bible.quests ?? [];
  const quests =
    bibleQuests.length > 0
      ? bibleQuests.map((q, i) => ({
          id: q.id ?? `quest_${i + 1}`,
          title: q.title ?? `任务 ${i + 1}`,
          description: q.description,
          requires: q.requires ?? (i === 0 ? [] : [`quest_${i}`]),
        }))
      : questLines.length > 0
        ? questLines.map((title, i) => ({
            id: `quest_${i + 1}`,
            title,
            requires: i === 0 ? [] : [`quest_${i}`],
          }))
        : [
            {
              id: 'quest_1',
              title: '抵达小镇并打听消息',
              requires: [] as string[],
            },
            {
              id: 'quest_2',
              title: '采集物资',
              requires: ['quest_1'],
            },
            {
              id: 'quest_3',
              title: '击败威胁并归来',
              requires: ['quest_2'],
            },
          ];

  const npcs = bible.npcs ?? [];
  const dialogues = npcs.slice(0, 8).map((n, i) => ({
    id: `dlg_${n.id ?? i}`,
    // Prefer stable id so WorldScene can match cast npcs by id
    speaker: String(n.id ?? n.name ?? `NPC ${i + 1}`),
    lines: [
      `你好，我是${n.name ?? n.id ?? '居民'}。`,
      '镇子最近不太安宁。',
    ],
      choices: [
        { text: '了解情况', setFlag: `talked_${n.id ?? i}` },
        { text: '告辞', nextId: 'end' },
      ] as Array<{ text: string; nextId?: string; setFlag?: string }>,
    }));

  if (!dialogues.length) {
    dialogues.push({
      id: 'dlg_mayor',
      speaker: '村长',
      lines: ['欢迎来到青石镇。', '森林里有狼群作乱。'],
      choices: [
        { text: '我去看看', setFlag: 'quest_accepted' },
        { text: '稍后再说' },
      ] as Array<{ text: string; nextId?: string; setFlag?: string }>,
    });
  }

  const chapterCount = Math.max(3, Math.min(8, Math.ceil(targetMinutes / 10)));
  const chapters = Array.from({ length: chapterCount }, (_, i) => ({
    id: `chapter_${String(i + 1).padStart(2, '0')}`,
    title: `第 ${i + 1} 章`,
    beatCount: 4 + (i % 3),
  }));
  const encounters = [
    {
      id: 'enc_wolf',
      enemyId: 'wolf',
      enemyHp: 8,
      enemyAtk: 2,
      label: '灰狼',
    },
    {
      id: 'enc_alpha',
      enemyId: 'alpha',
      enemyHp: 18,
      enemyAtk: 4,
      label: '头狼',
    },
  ];
  const depthMinutes =
    quests.length * 8 +
    chapters.length * 6 +
    dialogues.length * 2 +
    encounters.length * 4;
  const content: ContentJson = {
    version: 1,
    quests,
    dialogues,
    encounters,
    chapters,
    estimatedMinutes: Math.max(targetMinutes, depthMinutes),
  };

  if (content.quests.length < 3) {
    issues.push({
      level: 'warn',
      message: 'Quest count < 3 — content may feel thin',
    });
  }
  if (depthMinutes < 20) {
    issues.push({
      level: 'error',
      message: `Content depth ~${depthMinutes}m < 20m (need more quests/chapters/dialogues)`,
    });
  }
  if (content.estimatedMinutes < 20) {
    issues.push({
      level: 'warn',
      message: 'Estimated playtime under 20 minutes',
    });
  }
  for (const q of content.quests) {
    for (const r of q.requires) {
      if (!content.quests.some((x) => x.id === r)) {
        issues.push({
          level: 'error',
          message: `Quest ${q.id} requires missing ${r}`,
        });
      }
    }
  }

  const ok = !issues.some((i) => i.level === 'error');
  return { ok, systems, content, issues };
}

export function validateSystemsContent(
  systems: SystemsJson,
  content: ContentJson,
): CompileIssue[] {
  const issues: CompileIssue[] = [];
  const itemIds = new Set(systems.economy.items.map((i) => i.id));
  for (const r of systems.economy.recipes) {
    for (const inp of r.inputs) {
      if (!itemIds.has(inp.itemId)) {
        issues.push({
          level: 'error',
          message: `Recipe ${r.id} missing input ${inp.itemId}`,
        });
      }
    }
    if (!itemIds.has(r.output.itemId)) {
      issues.push({
        level: 'error',
        message: `Recipe ${r.id} missing output ${r.output.itemId}`,
      });
    }
  }
  if (content.chapters.length < 3) {
    issues.push({ level: 'warn', message: 'Fewer than 3 chapters' });
  }
  return issues;
}
