/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Thin OpenAI-compatible chat client for world planner (no Core dependency).
 */

export type ChatProvider = 'minimax' | 'openai-compat' | 'tongyi' | 'doubao';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** MiniMax interleaved thinking — pass back unchanged on continuations. */
  reasoning_content?: string;
  reasoning_details?: unknown;
}

export interface ChatCallOptions {
  baseUrl: string;
  apiKey: string;
  /** When set, auth failures rotate through keys (2049 / 401). */
  apiKeys?: readonly string[];
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  provider?: ChatProvider;
  jsonMode?: boolean;
  /** MiniMax thinking switch. Society dialogue defaults to enabled. */
  thinking?: 'enabled' | 'disabled';
  signal?: AbortSignal;
}

/** Drop MiniMax / Qwen think blocks, including an unclosed last tag. */
export function stripThinking(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/\(think\)[\s\S]*?\(\/think\)/gi, '')
    .trim();
}

/**
 * MiniMax often `finish=stop` after thinking with a 1–7 char remnant (`}`,
 * a comma, a fence tick). That is not an answer — treat it like think-only
 * so we flush the same thread instead of handing `chars=3` to the parser.
 *
 * Length alone is not think-eating. MiniMax-M3 with thinking disabled can
 * also stop at 3–4 tokens; that is an empty stub, not a CoT remainder.
 */
export function isThinkOnlyRemainder(text: string): boolean {
  return text.trim().length < 8;
}

export type SocietyReplyKind = 'ok' | 'truncated' | 'think_only' | 'empty_stub';

/** Tokens spent on a short visible body that still count as "it was thinking". */
const THINK_TOKEN_FLOOR = 24;

/**
 * Decide whether a short MiniMax body is a CoT remainder or just a stub.
 *
 * M2.x cannot disable thinking: hundreds of completion tokens + `}` is
 * think-only. M3 with `thinking: disabled` that returns `tokens=4 chars=3`
 * never thought — flushing "Stop thinking" only wastes another call.
 */
export function classifySocietyReply(input: {
  readonly text: string;
  readonly rawContent?: string;
  readonly reasoningContent?: string;
  readonly tokens?: number;
  readonly finish: string;
}): SocietyReplyKind {
  const text = input.text.trim();
  const truncated = input.finish === 'length';
  const short = isThinkOnlyRemainder(text);
  const reasoningLen = (input.reasoningContent ?? '').trim().length;
  const raw = input.rawContent ?? '';
  const hadThinkTags = /<think>|\(think\)/i.test(raw);
  const tokens = input.tokens;
  const thinkEvidence =
    reasoningLen >= 16 ||
    hadThinkTags ||
    (tokens != null && Number.isFinite(tokens) && tokens >= THINK_TOKEN_FLOOR && short);

  if (!short && !truncated) return 'ok';
  if (!short && truncated) return 'truncated';
  if (short && thinkEvidence) return 'think_only';
  // Hit the length cap with nothing visible: classic M2 think-to-the-budget.
  if (short && truncated) return 'think_only';
  if (short) return 'empty_stub';
  return 'ok';
}

/** Follow the user prompt's language — never lock the town to Chinese. */
export const SOCIETY_SYSTEM =
  'Simulate generative agents in a living society. Speak in the language the user message asks for (Chinese or English). Residents are independent people. They may argue, lie, threaten, or leave. Conflict, crime, official force, accidents, injury, and death can occur and must be stated as factual outcomes, neither softened nor dramatized. Do not output steps for building weapons or carrying out an attack. When JSON is requested, the final answer must be JSON. No narrator.\n' +
  '你在模拟一座活社会里的独立的人。用用户提示指定的语言说话。可以争吵、撒谎、威胁或走开。冲突、犯罪、执法、事故、受伤和死亡按事实写，不淡化也不夸大。不要输出武器制作或袭击步骤。被要求 JSON 时，最终答案必须是 JSON。不要旁白。';

/**
 * M2.x-highspeed is ~100 TPS but thinking cannot be turned off, so a short
 * town line often waits on hundreds of think tokens (and a flush retry).
 * M3 honors `thinking: disabled` — wall-clock for 2–4 JSON turns is usually
 * lower even if raw TPS is below highspeed. Override with OPENGAME_SOCIETY_MODEL.
 */
const SOCIETY_TALK_MODEL = 'MiniMax-M3';

function societyConverseModel(): string {
  return process.env['OPENGAME_SOCIETY_MODEL']?.trim() || SOCIETY_TALK_MODEL;
}

export function societyThinkingMode(
  override?: 'enabled' | 'disabled',
): 'enabled' | 'disabled' {
  if (override) return override;
  // Street talk defaults to off. Adaptive thinking was spending the whole
  // token budget on reasoning and coming back with an empty line, which
  // then piled more calls onto an already busy model.
  return process.env['OPENGAME_SOCIETY_THINKING'] === 'enabled'
    ? 'enabled'
    : 'disabled';
}

export function societyTemperature(override?: number): number {
  if (typeof override === 'number' && override > 0 && override <= 2) return override;
  const n = Number(process.env['OPENGAME_SOCIETY_TEMPERATURE'] ?? '');
  return Number.isFinite(n) && n > 0 && n <= 2 ? n : 0.85;
}

/** Comma-separated deep models. The first is primary; the rest are refusals fallbacks. */
export function deepSocietyModels(): string[] {
  const raw = process.env['OPENGAME_SOCIETY_DEEP_MODEL']?.trim() ?? '';
  const more = process.env['OPENGAME_SOCIETY_DEEP_MODELS']?.trim() ?? '';
  const models = [...raw.split(','), ...more.split(',')]
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(models)];
}

export class SocietyLlmKeysExhaustedError extends Error {
  readonly code = 'keys_exhausted' as const;
  constructor(message = 'All society LLM API keys were rejected') {
    super(message);
    this.name = 'SocietyLlmKeysExhaustedError';
  }
}

export class SocietyLlmTimeoutError extends Error {
  readonly code = 'llm_timeout' as const;
  constructor(message = 'Society LLM call timed out') {
    super(message);
    this.name = 'SocietyLlmTimeoutError';
  }
}

/** Auth-rejected keys stay parked so we switch the pool instead of retrying them every beat. */
const AUTH_PARK_MS = 30 * 60_000;
const QUOTA_PARK_MS = 60_000;
const BILLING_PARK_MS = 30 * 60_000;
const parkedAuthKeys = new Map<string, number>();
let poolDeadLogged = false;
const localEmergencyByHour = new Map<string, number>();

export function resetSocietyKeyPoolState(): void {
  parkedAuthKeys.clear();
  poolDeadLogged = false;
  localEmergencyByHour.clear();
  overloadUntil = 0;
}

export function keyHint(apiKey: string): string {
  const t = apiKey.trim();
  return t.length <= 4 ? '****' : t.slice(-4);
}

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /aborted|AbortError|This operation was aborted/i.test(msg);
}

function parkAuthKey(apiKey: string): void {
  parkedAuthKeys.set(apiKey, Date.now() + AUTH_PARK_MS);
}

function parkRotateKey(apiKey: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (isAuthKeyError(msg)) {
    parkAuthKey(apiKey);
    return;
  }
  const billing = /欠费|余额不足|billing|403/.test(msg);
  parkedAuthKeys.set(apiKey, Date.now() + (billing ? BILLING_PARK_MS : QUOTA_PARK_MS));
}

function isParked(apiKey: string, now = Date.now()): boolean {
  const until = parkedAuthKeys.get(apiKey) ?? 0;
  if (until <= now) {
    if (until) parkedAuthKeys.delete(apiKey);
    return false;
  }
  return true;
}

function orderKeysForAttempt(keys: readonly string[]): string[] {
  const live: string[] = [];
  const parked: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (isParked(key)) parked.push(key);
    else live.push(key);
  }
  return [...live, ...parked];
}

function keysExhaustedMessage(tried: number, last?: string): string {
  return (
    `推理密钥全部无效（已试 ${tried} 把，最后错误：${(last ?? '401').slice(0, 160)}）。` +
    `请更新 OPENGAME_REASONING_API_KEY / OPENGAME_REASONING_API_KEYS，或在资源池中加入可用密钥。` +
    `不会静默降级成“假成功”。`
  );
}

/**
 * Soft wait for society converse. MiniMax thinking can exceed 40s; keep the
 * in-flight reply instead of aborting and discarding usable JSON.
 * Override with PLATFORM_SOCIETY_LLM_TIMEOUT_MS or OPENGAME_SOCIETY_TIMEOUT_MS.
 */
export function resolveSocietyTalkTimeoutMs(
  override?: number,
): number {
  const fromEnv = Number(
    process.env['PLATFORM_SOCIETY_LLM_TIMEOUT_MS'] ??
      process.env['OPENGAME_SOCIETY_TIMEOUT_MS'] ??
      '',
  );
  const raw =
    override != null && Number.isFinite(override)
      ? override
      : Number.isFinite(fromEnv) && fromEnv > 0
        ? fromEnv
        : 75_000;
  return Math.max(20_000, Math.min(180_000, raw));
}

export type SocietyChatEnv = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly apiKeys: string[];
  readonly model: string;
  readonly provider: ChatProvider;
};

/**
 * Live society ticks / converse / plan.
 * Floor = cheap primary pool only. Lit may take the expensive emergency
 * model after the primary pool dies, and only when a slot is consumed.
 */
export function createSocietyLlmFn(options?: {
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
  readonly lane?: 'floor' | 'lit';
  /** Default: lit yes, floor no. Floor must never burn Ark / doubao. */
  readonly allowEmergency?: boolean;
  /** Redis-backed hour cap. Missing uses a process-local 24/hour cap. */
  readonly consumeEmergency?: () => Promise<boolean>;
  /** Override the lane model. Deep forecasts set OPENGAME_SOCIETY_DEEP_MODEL. */
  readonly model?: string;
  readonly thinking?: 'enabled' | 'disabled';
  readonly temperature?: number;
}): ((prompt: string) => Promise<string>) | undefined {
  const lane = options?.lane ?? 'floor';
  const allowEmergency = options?.allowEmergency ?? lane === 'lit';
  const primary = resolveChatEnv(lane);
  const emergency = allowEmergency ? resolveSocietyEmergencyEnv() : null;
  if (!primary && !emergency) return undefined;
  const timeoutMs = resolveSocietyTalkTimeoutMs(options?.timeoutMs);
  const hardAbortMs = Math.min(180_000, timeoutMs + 45_000);
  const fromEnv = Number(process.env['OPENGAME_SOCIETY_MAX_TOKENS'] ?? '');
  const maxTokens = Math.max(
    512,
    Math.min(
      8_192,
      options?.maxTokens ??
        (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 2_048),
    ),
  );

  const invoke = (
    env: SocietyChatEnv,
    prompt: string,
    preferSocietyModel: boolean,
  ): Promise<string> =>
    invokeSocietyChat(env, prompt, {
      timeoutMs,
      hardAbortMs,
      maxTokens,
      preferSocietyModel,
      model: options?.model?.trim() || undefined,
      thinking: societyThinkingMode(options?.thinking),
      temperature: societyTemperature(options?.temperature),
    });

  return async (prompt: string) => {
    if (primary) {
      try {
        return await invoke(primary, prompt, true);
      } catch (err) {
        if (err instanceof SocietyLlmTimeoutError || isAbortError(err)) {
          throw err instanceof SocietyLlmTimeoutError
            ? err
            : new SocietyLlmTimeoutError(
                `社会推演 LLM 超时（${timeoutMs}ms）`,
              );
        }
        if (!allowEmergency || !emergency) throw err;
        if (
          !(err instanceof SocietyLlmKeysExhaustedError) &&
          !isSocietyRotateError(err)
        ) {
          throw err;
        }
        console.warn(
          '[society-llm] 主路钥匙池耗尽，点亮镇尝试紧急模型（有小时封顶，免费底不会走这条）',
        );
      }
    } else if (!emergency) {
      throw new SocietyLlmKeysExhaustedError(
        keysExhaustedMessage(0, 'no primary keys'),
      );
    }

    const ok = await takeEmergencySlot(options?.consumeEmergency);
    if (!ok) {
      throw new SocietyLlmKeysExhaustedError(
        '紧急模型本小时额度已用尽。人还在走路。主路恢复或下一小时后再试。不会静默降级成假对话。',
      );
    }
    return invoke(emergency!, prompt, false);
  };
}

/** Strong model with thinking on. Used for deliberation, adjudication, chronicle. */
export function createDeepSocietyLlmFn(options?: {
  readonly timeoutMs?: number;
  readonly model?: string;
}): ((prompt: string) => Promise<string>) | undefined {
  const model = options?.model?.trim() || deepSocietyModels()[0];
  return createSocietyLlmFn({
    timeoutMs: options?.timeoutMs ?? 90_000,
    maxTokens: 4096,
    lane: 'lit',
    allowEmergency: true,
    ...(model ? { model } : {}),
    thinking: 'enabled',
    temperature: 0.8,
  });
}

async function invokeSocietyChat(
  env: SocietyChatEnv,
  prompt: string,
  opts: {
    readonly timeoutMs: number;
    readonly hardAbortMs: number;
    readonly maxTokens: number;
    readonly preferSocietyModel: boolean;
    readonly model?: string;
    readonly thinking?: 'enabled' | 'disabled';
    readonly temperature?: number;
  },
): Promise<string> {
  const preferred =
    opts.model ||
    (opts.preferSocietyModel ? societyConverseModel() : env.model);
  const callOnce = (
    model: string,
    tokenBudget: number,
  ): Promise<string> => {
    const ctrl = new AbortController();
    const hardTimer = setTimeout(() => ctrl.abort(), opts.hardAbortMs);
    const pending = chatCompletion({
      ...env,
      apiKeys: env.apiKeys,
      model,
      temperature: opts.temperature ?? 0.85,
      maxTokens: tokenBudget,
      thinking: opts.thinking ?? 'enabled',
      jsonMode: false,
      messages: [
        { role: 'system', content: SOCIETY_SYSTEM },
        { role: 'user', content: prompt },
      ],
      signal: ctrl.signal,
    }).finally(() => clearTimeout(hardTimer));

    let softTimer: ReturnType<typeof setTimeout> | undefined;
    const softTimeout = new Promise<never>((_, reject) => {
      softTimer = setTimeout(() => {
        reject(
          new SocietyLlmTimeoutError(
            `社会推演 LLM 超时（${opts.timeoutMs}ms）`,
          ),
        );
      }, opts.timeoutMs);
    });

    return Promise.race([pending, softTimeout])
      .catch(async (err) => {
        if (!(err instanceof SocietyLlmTimeoutError)) throw err;
        try {
          const late = await pending;
          if (late.trim()) {
            console.warn(
              `[society-llm] soft-timeout ${opts.timeoutMs}ms but kept ${late.length} chars`,
            );
            return late;
          }
        } catch (lateErr) {
          if (isAbortError(lateErr)) {
            throw new SocietyLlmTimeoutError(
              `社会推演 LLM 超时（${opts.timeoutMs}ms）`,
            );
          }
          throw lateErr;
        }
        ctrl.abort();
        throw err;
      })
      .finally(() => {
        if (softTimer) clearTimeout(softTimer);
      });
  };

  const run = async (model: string): Promise<string> =>
    callOnce(model, opts.maxTokens);

  try {
    return await run(preferred);
  } catch (err) {
    if (err instanceof SocietyLlmTimeoutError || isAbortError(err)) {
      throw err instanceof SocietyLlmTimeoutError
        ? err
        : new SocietyLlmTimeoutError(
            `社会推演 LLM 超时（${opts.timeoutMs}ms）`,
          );
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (
      preferred !== env.model &&
      /404|model_not_found|unknown model|does not exist/i.test(msg) &&
      !isAuthKeyError(msg)
    ) {
      console.warn(
        `[society-llm] 对话模型 ${preferred} 不可用，回退 ${env.model}`,
      );
      return await run(env.model);
    }
    if (
      err instanceof SocietyLlmKeysExhaustedError ||
      isAuthKeyError(msg)
    ) {
      throw err instanceof SocietyLlmKeysExhaustedError
        ? err
        : new SocietyLlmKeysExhaustedError(keysExhaustedMessage(1, msg));
    }
    throw err instanceof Error ? err : new Error(msg);
  }
}

function societyEmergencyHourCap(): number {
  const n = Number(
    process.env['PLATFORM_SOCIETY_EMERGENCY_MAX_PER_HOUR'] ??
      process.env['OPENGAME_SOCIETY_EMERGENCY_MAX_PER_HOUR'] ??
      '',
  );
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 24;
}

async function takeEmergencySlot(
  consume?: () => Promise<boolean>,
): Promise<boolean> {
  if (consume) return consume();
  const cap = societyEmergencyHourCap();
  if (cap <= 0) return false;
  const hour = new Date().toISOString().slice(0, 13);
  const n = (localEmergencyByHour.get(hour) ?? 0) + 1;
  if (n > cap) return false;
  localEmergencyByHour.set(hour, n);
  return true;
}

function splitEnvApiKeys(...chunks: Array<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (!chunk?.trim()) continue;
    for (const part of chunk.split(/[,;\n]+/)) {
      const key = part.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function inferChatProvider(baseUrl: string, raw?: string): ChatProvider {
  const named = (raw ?? '').toLowerCase();
  if (
    named === 'openai-compat' ||
    named === 'tongyi' ||
    named === 'doubao' ||
    named === 'minimax'
  ) {
    return named;
  }
  if (/volces\.com|ark\.cn-beijing/i.test(baseUrl)) return 'doubao';
  if (/dashscope|aliyuncs/i.test(baseUrl)) return 'tongyi';
  if (/minimaxi?\.com/i.test(baseUrl)) return 'minimax';
  return 'openai-compat';
}

export function resolveChatEnv(
  lane: 'floor' | 'lit' = 'floor',
): SocietyChatEnv | null {
  const apiKeys =
    lane === 'lit' ? collectSocietyLitApiKeys() : collectSocietyPrimaryApiKeys();
  if (!apiKeys.length) return null;
  const baseUrl = (
    process.env['OPENGAME_REASONING_BASE_URL'] ||
    process.env['OPENAI_BASE_URL'] ||
    'https://api.minimaxi.com/v1'
  ).replace(/\/+$/, '');
  const model =
    process.env['OPENGAME_SOCIETY_MODEL']?.trim() ||
    process.env['OPENGAME_REASONING_MODEL'] ||
    process.env['OPENAI_MODEL'] ||
    SOCIETY_TALK_MODEL;
  const provider = inferChatProvider(
    baseUrl,
    process.env['OPENGAME_REASONING_PROVIDER'],
  );
  return { baseUrl, apiKey: apiKeys[0]!, apiKeys, model, provider };
}

/**
 * Expensive spare line (Ark / doubao). Requires its own URL — never reuse
 * the MiniMax base URL, or Ark keys would fire at the wrong host (or worse,
 * actually bill the expensive model as if it were floor traffic).
 */
export function resolveSocietyEmergencyEnv(): SocietyChatEnv | null {
  const apiKeys = collectSocietyEmergencyApiKeys();
  if (!apiKeys.length) return null;
  const baseUrl = (
    process.env['OPENGAME_FALLBACK_BASE_URL'] ||
    process.env['OPENAI_FALLBACK_BASE_URL'] ||
    process.env['OPENGAME_REASONING_FALLBACK_BASE_URL'] ||
    ''
  ).replace(/\/+$/, '');
  if (!baseUrl) return null;
  const model = (
    process.env['OPENGAME_REASONING_FALLBACK_MODEL'] ||
    process.env['OPENAI_FALLBACK_MODEL'] ||
    process.env['OPENGAME_SOCIETY_EMERGENCY_MODEL'] ||
    ''
  ).trim();
  if (!model) return null;
  const provider = inferChatProvider(
    baseUrl,
    process.env['OPENGAME_FALLBACK_PROVIDER'],
  );
  return { baseUrl, apiKey: apiKeys[0]!, apiKeys, model, provider };
}

/** Cheap MiniMax / reasoning pool. Never includes FALLBACK keys. */
export function collectSocietyPrimaryApiKeys(): string[] {
  return splitEnvApiKeys(
    process.env['OPENGAME_REASONING_API_KEY'],
    process.env['OPENGAME_REASONING_API_KEYS'],
    process.env['MINIMAX_API_KEY'],
    process.env['OPENAI_API_KEY'],
    process.env['OPENAI_API_KEYS'],
  );
}

/** Alias kept for callers / tests — floor pool is primary-only. */
export function collectSocietyApiKeys(): string[] {
  return collectSocietyPrimaryApiKeys();
}

/** FALLBACK / Ark keys only. Lit emergency after the cheap pool dies. */
export function collectSocietyEmergencyApiKeys(): string[] {
  return splitEnvApiKeys(
    process.env['OPENGAME_REASONING_FALLBACK_API_KEY'],
    process.env['OPENGAME_FALLBACK_API_KEY'],
    process.env['OPENGAME_FALLBACK_API_KEYS'],
    process.env['OPENAI_FALLBACK_API_KEY'],
    process.env['OPENAI_FALLBACK_API_KEYS'],
  );
}

/** Paid 点亮 traffic. Empty falls back to the cheap floor pool, not emergency. */
export function collectSocietyLitApiKeys(): string[] {
  const lit = splitEnvApiKeys(process.env['OPENGAME_SOCIETY_LIT_API_KEYS']);
  const floor = collectSocietyPrimaryApiKeys();
  if (!lit.length) return floor;
  const seen = new Set(lit);
  const out = [...lit];
  for (const key of floor) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function isAuthKeyError(message: string): boolean {
  return /401|2049|invalid api key|authorized_error|authentication_error/i.test(
    message,
  );
}

export function isSocietyQuotaError(message: string): boolean {
  if (isSocietyOverloadError(message)) return false;
  return /(?:^|\D)429(?:\D|$)|rate.?limit|token plan|quota|额度|欠费|余额不足|overdue|usage limit|2056/i.test(
    message,
  );
}

/** MiniMax 529: the cluster is busy. The key is still valid. */
export function isSocietyOverloadError(message: string): boolean {
  return /529|overloaded|负载较高|2064/i.test(message);
}

export class SocietyLlmOverloadedError extends Error {
  readonly code = 'overloaded' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SocietyLlmOverloadedError';
  }
}

let overloadUntil = 0;

export function societyOverloadActive(now = Date.now()): boolean {
  return now < overloadUntil;
}

function noteSocietyOverload(): void {
  overloadUntil = Date.now() + 8_000;
}

export function isSocietyRotateError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (isSocietyOverloadError(msg)) return false;
  return isAuthKeyError(msg) || isSocietyQuotaError(msg);
}

function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  return content == null ? '' : String(content);
}

const THINK_FLUSH_PROMPT =
  'Stop thinking. Output the final answer only. If JSON was requested, emit the JSON object now. Do not wrap in markdown. Do not repeat reasoning.\n立刻停止思考，只输出最终答案。若要求 JSON，现在直接给出 JSON 对象。';

const JSON_CONTINUE_PROMPT =
  'Continue from the exact cut-off. Output only the remainder. If writing JSON, do not restart the object or wrap in markdown.';

/** M3 empty stub: do not echo the remnant or tell it to stop thinking. */
const EMPTY_RETRY_PROMPT =
  'Your last reply was empty. Output the JSON object now, nothing else.\n上一轮没有正文。现在直接输出 JSON 对象，不要思考过程。';

interface ChatChoiceMessage {
  content?: unknown;
  reasoning_content?: string;
  reasoning_details?: unknown;
}

interface PostedChat {
  text: string;
  echo: ChatMessage;
  finish: string;
  tokens?: number;
  rawContent: string;
}

function echoAssistant(msg: ChatChoiceMessage | undefined): ChatMessage {
  const content = messageContentToString(msg?.content).trim();
  const echo: ChatMessage = {
    role: 'assistant',
    content,
  };
  if (msg?.reasoning_content) echo.reasoning_content = msg.reasoning_content;
  if (msg?.reasoning_details) echo.reasoning_details = msg.reasoning_details;
  return echo;
}

async function postChatCompletion(
  options: ChatCallOptions,
  messages: ChatMessage[],
): Promise<PostedChat> {
  const provider = options.provider ?? 'openai-compat';
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body: Record<string, unknown> = {
    model: options.model,
    messages,
    temperature: options.temperature ?? 0.4,
    stream: false,
  };
  if (provider === 'minimax') {
    body['max_completion_tokens'] = options.maxTokens ?? 4096;
    // Current MiniMax rejects type "enabled" (allowed: adaptive, disabled).
    // Our switch still says enabled; the wire value is adaptive.
    const thinking = options.thinking ?? 'disabled';
    body['thinking'] = { type: thinking === 'enabled' ? 'adaptive' : thinking };
    body['reasoning_split'] = true;
  } else {
    body['max_tokens'] = options.maxTokens ?? 4096;
  }
  if (options.jsonMode) {
    body['response_format'] = { type: 'json_object' };
  }

  const post = () =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  let res = await post();
  if (!res.ok && provider === 'minimax' && res.status === 400) {
    const errText = await res.text();
    if (/invalid thinking/i.test(errText) && 'thinking' in body) {
      delete body['thinking'];
      delete body['reasoning_split'];
      res = await post();
      if (!res.ok) {
        throw new Error(`World planner chat failed: ${res.status} ${await res.text()}`);
      }
    } else {
      throw new Error(`World planner chat failed: ${res.status} ${errText}`);
    }
  } else if (!res.ok) {
    throw new Error(`World planner chat failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: ChatChoiceMessage;
    }>;
    usage?: { completion_tokens?: number; total_tokens?: number };
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(data.error.message);
  const choice = data.choices?.[0];
  const msg = choice?.message;
  const content = messageContentToString(msg?.content).trim();
  const text = stripThinking(content);
  const tokens = data.usage?.completion_tokens;
  const finish = choice?.finish_reason ?? '?';
  const reasoningLen = (msg?.reasoning_content ?? '').trim().length;
  console.log(
    `[society-llm] model=${options.model} finish=${finish} completion_tokens=${tokens ?? '?'} chars=${text.length} reasoning=${reasoningLen}`,
  );
  return { text, echo: echoAssistant(msg), finish, tokens, rawContent: content };
}

async function chatCompletionOnce(
  options: ChatCallOptions,
): Promise<string> {
  let messages = [...options.messages];
  let assembled = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const { text, echo, finish, tokens, rawContent } = await postChatCompletion(
      options,
      messages,
    );
    const kind = classifySocietyReply({
      text,
      rawContent,
      reasoningContent: echo.reasoning_content,
      tokens,
      finish,
    });
    if (kind === 'ok' || kind === 'truncated') {
      if (text) assembled = assembled ? `${assembled}${text}` : text;
    }
    if (kind === 'ok') break;
    if (kind === 'think_only' && attempt > 0) break;
    if (kind === 'empty_stub' && attempt > 0) break;
    if (attempt >= 2) break;
    if (kind === 'think_only') {
      console.warn(
        `[society-llm] finish=${finish} 正文被 think 吃光（tokens=${tokens ?? '?'} chars=${text.length}），同一条对话续写（不重开、不加额度） (${attempt + 1}/2)`,
      );
      messages = [
        ...messages,
        echo,
        { role: 'user', content: THINK_FLUSH_PROMPT },
      ];
      continue;
    }
    if (kind === 'truncated') {
      console.warn(
        `[society-llm] finish=${finish} 被截断，同一条对话续写（不重开、不加额度） (${attempt + 1}/2)`,
      );
      messages = [
        ...messages,
        echo,
        { role: 'user', content: JSON_CONTINUE_PROMPT },
      ];
      continue;
    }
    // empty_stub: M3 often stops at 3–4 tokens with thinking already off.
    // Echoing the remnant and saying "stop thinking" locks it into another stub.
    console.warn(
      `[society-llm] finish=${finish} 正文过短且无 think（tokens=${tokens ?? '?'} chars=${text.length}），原请求补答 (${attempt + 1}/2)`,
    );
    messages = [
      ...options.messages,
      { role: 'user', content: EMPTY_RETRY_PROMPT },
    ];
  }
  if (!assembled) {
    throw new Error('Empty chat completion after strip (finish=length tokens=?)');
  }
  return assembled;
}

export async function chatCompletion(options: ChatCallOptions): Promise<string> {
  const keys = orderKeysForAttempt(
    options.apiKeys?.length ? options.apiKeys : [options.apiKey],
  );
  if (!keys.length) {
    throw new SocietyLlmKeysExhaustedError(
      '未配置推理密钥。请设置 OPENGAME_REASONING_API_KEY 或 OPENGAME_REASONING_API_KEYS。',
    );
  }
  if (societyOverloadActive()) {
    throw new SocietyLlmOverloadedError('模型这会儿忙，稍后再开口');
  }
  let lastErr: Error | undefined;
  let attempted = 0;
  for (let i = 0; i < keys.length; i += 1) {
    const apiKey = keys[i]!;
    if (isParked(apiKey) && attempted > 0) {
      continue;
    }
    attempted += 1;
    try {
      const text = await chatCompletionOnce({ ...options, apiKey });
      return text;
    } catch (err) {
      if (isAbortError(err) || options.signal?.aborted) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (isSocietyOverloadError(msg)) {
        noteSocietyOverload();
        throw new SocietyLlmOverloadedError(msg);
      }
      if (isSocietyRotateError(err)) {
        parkRotateKey(apiKey, err);
        lastErr = err instanceof Error ? err : new Error(msg);
        const next = keys.slice(i + 1).find((k) => !isParked(k));
        if (next) {
          const why = isAuthKeyError(msg) ? '401' : '429/额度';
          console.warn(
            `[society-llm] 密钥 …${keyHint(apiKey)} ${why}，切换资源池下一把 …${keyHint(next)}（${i + 2}/${keys.length}）`,
          );
          continue;
        }
        break;
      }
      throw err;
    }
  }
  const message = keysExhaustedMessage(attempted, lastErr?.message);
  if (!poolDeadLogged) {
    poolDeadLogged = true;
    console.error(`[society-llm] ${message}`);
  }
  throw new SocietyLlmKeysExhaustedError(message);
}

export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('No JSON object in model response');
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}
