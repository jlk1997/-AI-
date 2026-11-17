/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The simulation records what happened. It does not emit instructions someone
 * could follow to build a weapon or carry out an attack. Child-sexual content
 * stays in moderation.ts and is not widened here.
 */

const HOW_TO =
  /(?:如何|怎么).{0,12}(?:制作|组装|改装|合成).{0,12}(?:炸药|炸弹|燃烧瓶|枪支|武器)[^。\n]*|how to (?:build|make|assemble) (?:a |an )?(?:bomb|ied|explosive|firearm|weapon)[^.|\n]*|step\s*\d+\s*[:.]\s*(?:mix|pack|detonate|assemble)[^.|\n]*/gi;

export function stripOperationalHowTo(text: string): {
  readonly text: string;
  readonly stripped: boolean;
} {
  const raw = text ?? '';
  if (!HOW_TO.test(raw)) return { text: raw, stripped: false };
  HOW_TO.lastIndex = 0;
  return {
    text: raw.replace(HOW_TO, '（略去可操作步骤，只保留发生了什么）').trim(),
    stripped: true,
  };
}

/** Model refused or sanded the outcome down into a policy apology. */
export function looksSoftened(text: string): boolean {
  return /作为人工智能|我不能(?:描述|提供|协助)|无法(?:生成|提供).{0,8}(?:暴力|伤亡|该内容)|I (?:can't|cannot) (?:assist|provide|describe)|against (?:my|the) (?:guidelines|policy)|违反使用政策/i.test(
    text ?? '',
  );
}

export type Audience = 'members' | 'public';

export function contentAudience(violencePublic: boolean): Audience {
  return violencePublic ? 'public' : 'members';
}

export function violenceLabel(text: string): boolean {
  return /死亡|伤亡|受伤|开枪|骚乱|暴力|袭击|爆炸|killed|dead|injur|riot|gunfire/i.test(
    text ?? '',
  );
}
