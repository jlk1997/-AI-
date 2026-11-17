/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * First-pass UGC screen. Human reports remain the source of truth; this only
 * blocks obvious licensed franchises, adult material, and a short illegal
 * / political needle list from landing in the public catalog.
 */

export type UgcBlockKind = 'franchise' | 'adult' | 'illegal' | 'political';

const BRAND_NEEDLES = [
  'marvel',
  'avengers',
  'thanos',
  'iron man',
  'harry potter',
  'hogwarts',
  'star wars',
  'jedi',
  'pokemon',
  'pokémon',
  'nintendo',
  'mario',
  'zelda',
  'disney',
  'pixar',
  'gundam',
  'kof',
  'king of fighters',
  'minecraft',
  'fortnite',
  'league of legends',
  '英雄联盟',
  '王者荣耀',
  '原神',
  'genshin',
  '火影忍者',
  '海贼王',
  '进击的巨人',
];

const ADULT_NEEDLES = [
  'porn',
  'nsfw',
  'hentai',
  'onlyfans',
  '色情',
  '裸体',
  '成人影片',
  '做爱',
];

const ILLEGAL_NEEDLES = [
  'child porn',
  'csam',
  'bomb making',
  '如何制造炸弹',
  '冰毒配方',
  '出售枪支',
  '毒品批发',
];

const POLITICAL_NEEDLES = [
  '推翻政府',
  '武装暴动',
  '民族分裂',
];

function findNeedle(
  text: string,
  needles: readonly string[],
): string | null {
  const hay = text.toLowerCase();
  for (const needle of needles) {
    if (hay.includes(needle.toLowerCase())) return needle;
  }
  return null;
}

export function findBlockedFranchise(text: string | undefined | null): string | null {
  if (!text) return null;
  return findNeedle(text, BRAND_NEEDLES);
}

export function classifyBlockedCopy(
  text: string | undefined | null,
): { kind: UgcBlockKind; needle: string } | null {
  if (!text) return null;
  const illegal = findNeedle(text, ILLEGAL_NEEDLES);
  if (illegal) return { kind: 'illegal', needle: illegal };
  const adult = findNeedle(text, ADULT_NEEDLES);
  if (adult) return { kind: 'adult', needle: adult };
  const political = findNeedle(text, POLITICAL_NEEDLES);
  if (political) return { kind: 'political', needle: political };
  const franchise = findBlockedFranchise(text);
  if (franchise) return { kind: 'franchise', needle: franchise };
  return null;
}

export function assertPublishableCopy(input: {
  readonly title?: string;
  readonly description?: string;
}): { ok: true } | { ok: false; brand: string; kind: UgcBlockKind } {
  const hit =
    classifyBlockedCopy(input.title) ?? classifyBlockedCopy(input.description);
  if (!hit) return { ok: true };
  return { ok: false, brand: hit.needle, kind: hit.kind };
}

/** Same screen, applied to generate / world-edit prompts. */
export function assertGeneratePrompt(
  prompt: string | undefined | null,
): { ok: true } | { ok: false; brand: string; kind: UgcBlockKind } {
  const text = prompt?.trim();
  if (!text) return { ok: true };
  return assertPublishableCopy({ title: text, description: text });
}
