/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * ?? 4?? 3 ????World Spec??????LLM ?????? *
 *   step 1: title + meta.summary + styleAnchor + 1 ??starter region
 *   step 2: ?? regions + NPCs (?? step 1 ????
 *   step 3: rules + quests + openingRumor
 *
 * ???????? planWorldFromPrompt ????????????????planWorldFromPrompt?? */

import {
  isScaffoldTownRegionId,
  parseWorldSpec,
  shortDisplayTitle,
  validateWorldSpec,
  type WorldSpec,
} from '@opengame/world-spec';

import {
  chatCompletion,
  extractJsonObject,
  resolveChatEnv,
} from './chat.js';
import {
  parseIntentFromPrompt,
  type IntentParseOptions,
} from './intent.js';
import { isMostlyAsciiText } from './locale/extractPlaces.js';
import {
  applyPickedArtStyle,
  planWorldFromPrompt,
  type PlanWorldResult,
} from './planner.js';

const STEP1_SYSTEM =
  'You are a world builder. Output STRICT JSON only. No prose around it. ' +
  'Reply in the user-requested language.';
const STEP1_USER = (prompt: string, packId: string, locale: string): string =>
  [
    `Build step 1 (skeleton) for: ${prompt}`,
    `Pack: ${packId}. Locale: ${locale === 'en' ? 'English' : 'Chinese'}.`,
    '',
    'Return JSON shape:',
    '{',
    '  "meta": { "title": "??8 chars", "summary": "??80 chars, ?? sentences" },',
    '  "styleAnchor": { "tone": "...", "palette": "...", "artStyle": "..." },',
    '  "space": { "regions": [ { "id": "starter_slug", "name": "...", "description": "..." } ] },',
    '}',
    '',
    'Region ids must come from the prompt\'s places.',
  ].join('\n');

const STEP2_SYSTEM =
  'You are a world builder. Output STRICT JSON only. No prose around it. ' +
  'Reply in the user-requested language.';
const STEP2_USER = (
  prompt: string,
  skeleton: WorldSpec,
  locale: string,
): string =>
  [
    `Build step 2 (regions + NPCs) for: ${prompt}`,
    `Skeleton already chosen: title="${skeleton.meta.title}", mood="${skeleton.styleAnchor.mood ?? ''}"`,
    '',
    'Return JSON shape:',
    '{',
    '  "regions": [ { "id": "...", "name": "...", "description": "...", "neighbors": [] } ],',
    '  "entities": [ { "id": "...", "name": "...", "kind": "npc", "regionId": "..." } ]',
    '}',
    '',
    'Names in ' + (locale === 'en' ? 'English' : 'Chinese') + '. No new meta.title or styleAnchor.',
  ].join('\n');

const STEP3_SYSTEM =
  'You are a world builder. Output STRICT JSON only. No prose around it. ' +
  'Reply in the user-requested language.';
const STEP3_USER = (prompt: string, locale: string): string =>
  [
    `Build step 3 (rules + quests + openingRumor) for: ${prompt}`,
    '',
    'Return JSON shape:',
    '{',
    '  "rules": [ { "id": "...", "description": "..." } ],',
    '  "quests": [ { "id": "...", "title": "...", "description": "..." } ],',
    '  "openingRumor": "??0 chars, in-world rumor one of the NPCs would whisper"',
    '}',
    '',
    'Language: ' + (locale === 'en' ? 'English' : 'Chinese') + '.',
  ].join('\n');

async function safeStep<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function pickLocale(prompt: string): 'en' | 'zh' {
  return isMostlyAsciiText(prompt) ? 'en' : 'zh';
}

function mergeStagedSkeleton(skeleton: unknown, regions: unknown, tail: unknown): unknown {
  if (!skeleton || typeof skeleton !== 'object') return null;
  const sk = skeleton as Record<string, unknown>;
  const rg = (regions && typeof regions === 'object' ? (regions as Record<string, unknown>) : null);
  const tl = (tail && typeof tail === 'object' ? (tail as Record<string, unknown>) : null);
  const skeletonMeta = (sk['meta'] && typeof sk['meta'] === 'object'
    ? (sk['meta'] as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const skeletonStyle = (sk['styleAnchor'] && typeof sk['styleAnchor'] === 'object'
    ? (sk['styleAnchor'] as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const skeletonSpace = (sk['space'] && typeof sk['space'] === 'object'
    ? (sk['space'] as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  return {
    ...sk,
    meta: { ...skeletonMeta, title: String(skeletonMeta['title'] ?? '').slice(0, 28) },
    styleAnchor: skeletonStyle,
    space: { ...skeletonSpace, regions: rg?.['regions'] ?? skeletonSpace['regions'] ?? [] },
    entities: rg?.['entities'] ?? sk['entities'] ?? [],
    rules: tl?.['rules'] ?? sk['rules'] ?? [],
    quests: tl?.['quests'] ?? sk['quests'] ?? [],
    presentation: {
      ...(typeof sk['presentation'] === 'object' && sk['presentation'] !== null
        ? (sk['presentation'] as Record<string, unknown>)
        : {}),
      openingRumor:
        (tl && typeof tl['openingRumor'] === 'string' ? (tl['openingRumor'] as string) : '') ||
        '',
    },
  };
}

/**
 * ???????????????planWorldFromPrompt???????????? */
export async function planWorldFromPromptStaged(
  prompt: string,
  options?: {
    readonly artStyleId?: string;
    readonly worldPopulation?: number;
    readonly signal?: AbortSignal;
    readonly intentOptions?: IntentParseOptions;
  },
): Promise<PlanWorldResult> {
  const env = resolveChatEnv();
  if (!env) {
    const fallback = await planWorldFromPrompt(prompt, options);
    return fallback;
  }
  const intentOpts: IntentParseOptions = options?.intentOptions ?? {};
  const ir = parseIntentFromPrompt(prompt, intentOpts);
  const locale = pickLocale(prompt);

  const step1 = await safeStep(() =>
    chatCompletion({
      ...env,
      messages: [
        { role: 'system', content: STEP1_SYSTEM },
        { role: 'user', content: STEP1_USER(prompt, ir.packId, locale) },
      ],
      temperature: 0.5,
      maxTokens: 2048,
      jsonMode: true,
      signal: options?.signal,
    }),
  );
  if (!step1) {
    const fallback = await planWorldFromPrompt(prompt, options);
    return fallback;
  }
  let skeletonObj: unknown;
  try {
    skeletonObj = extractJsonObject(step1);
  } catch {
    const fallback = await planWorldFromPrompt(prompt, options);
    return fallback;
  }
  const skeleton: WorldSpec = parseWorldSpec(skeletonObj);

  const step2 = await safeStep(() =>
    chatCompletion({
      ...env,
      messages: [
        { role: 'system', content: STEP2_SYSTEM },
        { role: 'user', content: STEP2_USER(prompt, skeleton, locale) },
      ],
      temperature: 0.5,
      maxTokens: 3072,
      jsonMode: true,
      signal: options?.signal,
    }),
  );
  if (!step2) {
    const fallback = await planWorldFromPrompt(prompt, options);
    return fallback;
  }
  let regionsObj: unknown;
  try {
    regionsObj = extractJsonObject(step2);
  } catch {
    const fallback = await planWorldFromPrompt(prompt, options);
    return fallback;
  }

  const step3 = await safeStep(() =>
    chatCompletion({
      ...env,
      messages: [
        { role: 'system', content: STEP3_SYSTEM },
        { role: 'user', content: STEP3_USER(prompt, locale) },
      ],
      temperature: 0.5,
      maxTokens: 2048,
      jsonMode: true,
      signal: options?.signal,
    }),
  );
  if (!step3) {
    const fallback = await planWorldFromPrompt(prompt, options);
    return fallback;
  }
  let tailObj: unknown;
  try {
    tailObj = extractJsonObject(step3);
  } catch {
    const fallback = await planWorldFromPrompt(prompt, options);
    return fallback;
  }

  const merged = mergeStagedSkeleton(skeletonObj, regionsObj, tailObj);
  if (!merged) {
    const fallback = await planWorldFromPrompt(prompt, options);
    return fallback;
  }
  // ?? starter regionId ??scaffold ??????isScaffoldTownRegionId ??
  const starter =
    Array.isArray((merged as { space?: { regions?: unknown[] } }).space?.regions)
      ? (merged as { space: { regions: unknown[] } }).space.regions[0]
      : null;
  if (
    starter
    && typeof starter === 'object'
    && typeof (starter as { id?: unknown }).id === 'string'
    && isScaffoldTownRegionId((starter as { id: string }).id)
  ) {
    // OK: scaffold id is acceptable for the starter
  }

  const validated = validateWorldSpec(merged);
  if (!validated.ok || !validated.world) {
    const fallback = await planWorldFromPrompt(prompt, options);
    return fallback;
  }
  // ?????? artStyleId????? UI ??
  const withArt = options?.artStyleId
    ? applyPickedArtStyle(validated.world, options.artStyleId)
    : validated.world;
  // ? shortDisplayTitle ???? title ??
  const finalSpec: WorldSpec = {
    ...withArt,
    meta: { ...withArt.meta, title: shortDisplayTitle(withArt.meta.title) },
  };
  return { world: finalSpec, source: 'llm', issues: [] };
}
