/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Named people in a world prompt. Heuristics may fill empty slots; they must
 * not overwrite these identities with the stock resident pool.
 */

export interface ResidentPromise {
  readonly name: string;
  readonly occupation?: string;
}

const PLACE_LIKE =
  /码头|广场|修道院|船坞|学堂|客栈|森林|地牢|渡口|夜市|井|镇|村|巷|舱|舰桥|礼拜堂|抄经房|dock|square|chapel|bridge|forest|plaza|abbey|galley|market|well/i;

const OCC_ZH =
  /铁匠|渔民|船员|水手|船长|僧人|修士|抄经|面包师|教师|邮差|补网|码头工|摊主|庙祝|织娘|更夫|厨子|值班/;
const OCC_EN =
  /smith|fisher|sailor|captain|abbot|scribe|baker|teacher|postman|monk|cook|officer|helmsman/i;

function cleanName(raw: string): string | undefined {
  const name = raw.replace(/^[\s"'「『]+|[\s"'」』，,。]+$/g, '').trim();
  if (name.length < 2 || name.length > 16) return undefined;
  if (/必须|include|contain|places?|居民|职业|地点|named|residents?/i.test(name)) {
    return undefined;
  }
  if (PLACE_LIKE.test(name) && name.length <= 4) return undefined;
  return name;
}

function add(
  out: ResidentPromise[],
  seen: Map<string, number>,
  name: string,
  occupation?: string,
): void {
  const n = cleanName(name);
  if (!n) return;
  const key = n.toLowerCase();
  const idx = seen.get(key);
  if (idx != null) {
    if (occupation && !out[idx]!.occupation) {
      out[idx] = { name: out[idx]!.name, occupation };
    }
    return;
  }
  seen.set(key, out.length);
  out.push(occupation ? { name: n, occupation } : { name: n });
}

function extractQuotedNames(prompt: string): string[] {
  const out: string[] = [];
  const re = /[「『""]([^」』""]{2,16})[」』""]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) {
    const s = cleanName(m[1] ?? '');
    if (s) out.push(s);
  }
  return out;
}

function extractListedResidents(prompt: string): string[] {
  const chunks: string[] = [];
  for (const re of [
    /居民必须包含([^。.\n]+)/g,
    /点名[：:]([^。.\n]+)/g,
    /名叫([^。.\n]+)/g,
    /(?:named\s+)?residents?\s+(?:must\s+)?(?:include|contain|:)\s+([^.\n]+)/gi,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt))) {
      if (m[1]) chunks.push(m[1]);
    }
  }
  const out: string[] = [];
  for (const chunk of chunks) {
    for (const part of chunk.split(/[、,，]|\band\b/i)) {
      const n = cleanName(part);
      if (n) out.push(n);
    }
  }
  return out;
}

function extractJobPairs(prompt: string): ResidentPromise[] {
  const out: ResidentPromise[] = [];
  const quotedJob = new RegExp(
    `[「『""]([^」』""]{2,16})[」』""]是(${OCC_ZH.source})`,
    'gu',
  );
  const zhRe = new RegExp(
    `([\\u4e00-\\u9fff]{2,8})是(${OCC_ZH.source})`,
    'gu',
  );
  let m: RegExpExecArray | null;
  while ((m = quotedJob.exec(prompt))) {
    const name = cleanName(m[1] ?? '');
    if (name) out.push({ name, occupation: m[2] });
  }
  while ((m = zhRe.exec(prompt))) {
    const name = cleanName(m[1] ?? '');
    if (name) out.push({ name, occupation: m[2] });
  }
  const enRe = new RegExp(
    `\\b([A-Z][a-z]{1,12})\\s+the\\s+(${OCC_EN.source})\\b`,
    'g',
  );
  while ((m = enRe.exec(prompt))) {
    const name = cleanName(m[1] ?? '');
    if (name) out.push({ name, occupation: m[2]!.toLowerCase() });
  }
  return out;
}

export function coversPromisedResident(hay: string, name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return hay.includes(n) || hay.toLowerCase().includes(n.toLowerCase());
}

export function extractResidentPromises(prompt: string): ResidentPromise[] {
  const out: ResidentPromise[] = [];
  const seen = new Map<string, number>();
  for (const row of extractJobPairs(prompt)) {
    add(out, seen, row.name, row.occupation);
  }
  for (const name of extractListedResidents(prompt)) {
    add(out, seen, name);
  }
  for (const name of extractQuotedNames(prompt)) {
    add(out, seen, name);
  }
  return out.slice(0, 24);
}
