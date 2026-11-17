/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * 批次 3：仅润色 World Spec 中的少量叙事字段（meta.summary /
 * presentation.openingRumor），失败回退原值，绝不破坏现有 Spec。
 * 不删除、不修改 planner.ts / ensureDepth.ts / chat.ts 任何已有行为。
 */

import { validateWorldSpec, type WorldSpec } from '@opengame/world-spec';

import { chatCompletion, extractJsonObject, resolveChatEnv } from './chat.js';

export type RefineField =
  | 'meta.summary'
  | 'presentation.openingRumor';

export type RefineOptions = {
  readonly fields: readonly RefineField[];
  readonly locale: 'zh' | 'en';
  /**
   * LLM 调用配置；不传时使用 floor 池的环境变量（与对话推演共用）。
   * 主要给单元测试 mock。
   */
  readonly llmOverride?: (prompt: string) => Promise<string>;
};

const ZH_SYSTEM =
  '你是小镇世界的文案润色师。保留事实、不要编造人名/地名、不要引入不在原描述里的元素，' +
  '只把现有内容改写得更顺、更有画面感。回复必须是合法 JSON，不要 markdown，不要解释。';
const EN_SYSTEM =
  'You are a small-town narrative polisher. Keep every fact, never invent names or places, ' +
  'never add new elements. Just rewrite what is there in better prose. Reply with valid JSON only.';

function buildPrompt(spec: WorldSpec, locale: 'zh' | 'en'): string {
  const lead = spec.entities[0]?.name ?? (locale === 'zh' ? '镇里' : 'the town');
  const place = spec.space.regions[0]?.name ?? (locale === 'zh' ? '镇上' : 'downtown');
  return [
    `Town: ${spec.meta.title}`,
    `Lead: ${lead}`,
    `Place: ${place}`,
    `Current summary: ${spec.meta.summary ?? ''}`,
    `Current rumor: ${spec.presentation.openingRumor ?? ''}`,
    '',
    locale === 'zh'
      ? '请润色上面两段。返回严格 JSON：{"summary":"...","rumor":"..."}'
      : 'Polish the two strings above. Return strict JSON: {"summary":"...","rumor":"..."}',
  ].join('\n');
}

function extractJsonFromObject(parsed: unknown): {
  summary?: unknown;
  rumor?: unknown;
} | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  return {
    summary: row['summary'],
    rumor: row['rumor'],
  };
}

/**
 * 仅当 LLM 返回的字段可解析且通过 validateWorldSpec 时才覆盖原 spec。
 * 失败一律回退到入参 spec，不抛异常，避免破坏现有 world 数据。
 */
export async function refineNarrative(
  spec: WorldSpec,
  opts: RefineOptions,
): Promise<WorldSpec> {
  const system = opts.locale === 'zh' ? ZH_SYSTEM : EN_SYSTEM;
  const userPrompt = buildPrompt(spec, opts.locale);

  let raw: string;
  try {
    if (opts.llmOverride) {
      raw = await opts.llmOverride(`${system}\n\n${userPrompt}`);
    } else {
      const env = resolveChatEnv('floor');
      if (!env) {
        // 没有 LLM key：直接返回原 spec，绝不抛错
        return spec;
      }
      raw = await chatCompletion({
        ...env,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
        jsonMode: true,
        maxTokens: 320,
        temperature: 0.4,
      });
    }
  } catch {
    return spec;
  }

  let parsed: ReturnType<typeof extractJsonFromObject>;
  try {
    parsed = extractJsonFromObject(extractJsonObject(raw));
  } catch {
    return spec;
  }
  if (!parsed) return spec;

  const wantSummary = opts.fields.includes('meta.summary');
  const wantRumor = opts.fields.includes('presentation.openingRumor');

  const summaryText =
    wantSummary && typeof parsed.summary === 'string'
      ? parsed.summary.trim()
      : spec.meta.summary;
  const rumorText =
    wantRumor && typeof parsed.rumor === 'string'
      ? parsed.rumor.trim()
      : spec.presentation.openingRumor;

  // 长度防护：润色结果不能比原来短 50%，更不能超过 4 倍。
  const safeSummary =
    summaryText && spec.meta.summary && summaryText.length < spec.meta.summary.length * 0.5
      ? spec.meta.summary
      : summaryText?.slice(0, 400) || spec.meta.summary;
  const safeRumor =
    rumorText && spec.presentation.openingRumor && rumorText.length < spec.presentation.openingRumor.length * 0.5
      ? spec.presentation.openingRumor
      : rumorText?.slice(0, 140) || spec.presentation.openingRumor;

  const next: WorldSpec = {
    ...spec,
    meta: { ...spec.meta, summary: safeSummary },
    presentation: {
      ...spec.presentation,
      openingRumor: safeRumor,
    },
  };

  const ok = validateWorldSpec(next);
  return ok.ok ? next : spec;
}