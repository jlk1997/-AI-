/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Every NPC needs a secret + public stance so converse/interview can disagree.
 * LLM specs and quality-pad extras often omit the card — stamp here, never live.
 */

import { parseWorldSpec, type WorldSpec } from '@opengame/world-spec';
import { isMostlyAsciiText } from './extractPlaces.js';

export function stanceCardFor(
  name: string,
  occupation: string,
  index: number,
  ascii: boolean,
): { secret: string; stance: string } {
  const n = Math.abs(hashString(`${name}:${occupation}:${index}`));
  if (ascii) {
    const secrets = [
      `owes ${name} a favor they will not name`,
      `hid a letter under the ${occupation} bench`,
      `knows who skipped the last watch`,
      `saw the ${occupation} tools moved after midnight`,
      `kept a key that does not open their own door`,
      `heard two names in a fight and will not say which`,
      `shorted a measure at ${occupation} and hopes nobody recounts`,
      `promised ${name}'s kin a reply they never sent`,
      `found a wet footprint where no one should have walked`,
    ];
    const stances = [
      `trust the people at work first`,
      `do not pass rumors to outsiders`,
      `ask the lead before spreading news`,
      `believe what they saw, not what the square repeats`,
      `side with whoever keeps the place running`,
      `keep quiet until two people tell the same story`,
    ];
    return { secret: secrets[n % secrets.length]!, stance: stances[(n >> 3) % stances.length]! };
  }
  const secrets = [
    `欠一笔不想让人问起的人情`,
    `把一封信藏在${occupation}的位子底下`,
    `知道谁没来上一次班`,
    `半夜看见${occupation}的家伙被人挪过`,
    `手里多一把对不上自己门的钥匙`,
    `听见两个人名拌过嘴，不肯说是谁`,
    `${occupation}的份量少过一次，怕人再称`,
    `答应过家里人回一句，到现在没写`,
    `在不该有脚印的地方看见一串还湿着的鞋印`,
  ];
  const stances = [
    `先信一起干活的人`,
    `闲话不传给外人`,
    `传话前先问过当家`,
    `信自己看见的，不信广场上复读的`,
    `谁把这地方撑着，就先站谁那边`,
    `两个人说成一样才开口`,
  ];
  return { secret: secrets[n % secrets.length]!, stance: stances[(n >> 3) % stances.length]! };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/** Fill secret/stance on NPCs that the LLM or pad path omitted. */
export function stampMissingStanceCards(world: WorldSpec): WorldSpec {
  let changed = false;
  const entities = world.entities.map((e, i) => {
    if (e.kind !== 'npc') return e;
    if (e.identity?.secret && e.identity?.stance) return e;
    changed = true;
    const occupation =
      e.identity?.occupation ?? String(e.attrs['role'] ?? 'resident');
    const ascii = isMostlyAsciiText(`${e.name}${occupation}`);
    const card = stanceCardFor(e.name, occupation, i, ascii);
    return {
      ...e,
      identity: {
        displayName: e.identity?.displayName ?? e.name,
        age: e.identity?.age,
        traits: e.identity?.traits ?? [],
        occupation,
        backstory: e.identity?.backstory ?? e.personality ?? '',
        homeAreaId: e.identity?.homeAreaId,
        workAreaId: e.identity?.workAreaId,
        initialRelations: e.identity?.initialRelations ?? {},
        withholdFrom: e.identity?.withholdFrom ?? [],
        secret: e.identity?.secret ?? card.secret,
        stance: e.identity?.stance ?? card.stance,
      },
    };
  });
  if (!changed) return world;
  return parseWorldSpec({ ...world, entities });
}
