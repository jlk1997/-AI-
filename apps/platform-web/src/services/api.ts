/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';

const TOKEN_KEY = 'opengame_platform_token';
export const ORG_ID_KEY = 'opengame_org_id';

// 游戏配置类型
export interface GameParamsConfig {
  theme?: string;
  variant?: string;
  difficulty?: number;
  musicStyle?: string;
  effectsVolume?: number;
  gameSpeed?: number;
  lives?: number;
  timeLimit?: number;
  /** User-confirmed play shape from design intake. */
  preferredArchetype?:
    | 'top_down'
    | 'ui_heavy'
    | 'platformer'
    | 'tower_defense'
    | 'grid_logic';
  /** Compact design brief from intake answers. */
  designBrief?: string;
  /**
   * Picked art style profile id (world-spec `ArtStyleId`). Authoritative for
   * asset prompts, target resolutions and renderer pixel-snapping.
   */
  artStyleId?: string;
  artTone?: string;
  winFeel?: string;
  /** Society world: named-resident target (overrides template / prompt guess). */
  worldPopulation?: number;
  /** Society world: generate-time seed hours (overrides PLATFORM_SOCIETY_SEED_HOURS). */
  societySeedHours?: number;
  /** Society world: structured create brief (pack / venues / use case). */
  worldBrief?: {
    packId: 'society.town' | 'society.crew' | 'society.cloister';
    useCase: string;
    venues: readonly string[];
    scale: string;
    livedIn: string;
    note?: string;
  };
}

// ---------- People & community (dual loop: play → change a line → publish) ----------

/** What a reader sees instead of a UUID or an email address. */
export interface PublicAuthor {
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
}

export interface UserProfile extends PublicAuthor {
  userId: string;
  email: string;
  createdAt: string;
}

/** How far a published town has lived, so a card can say "still living". */
export interface WorldStatusDto {
  simTime: number | null;
  simDays: number | null;
  residents: number;
  living: boolean;
  speaking?: boolean;
  clockPaused?: boolean;
  lastAdvancedAt: string | null;
  watcherCount?: number;
  lamp?: TownLamp | null;
}

export interface CommunityWorkSummary {
  id?: string;
  takenDownAt?: string | null;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  isPublic: boolean;
  playCount: number;
  publishedAt: string;
  deploymentId: string;
  projectId: string;
  world?: WorldStatusDto;
}

export interface MyWorks {
  games: CommunityWorkSummary[];
  worlds: CommunityWorkSummary[];
  drafts: Array<{
    projectId: string;
    name: string;
    createdAt: string;
    hasWorld: boolean;
    hasPreview: boolean;
  }>;
  remixes: Array<{
    projectId: string;
    name: string;
    parentProjectId: string;
    note: string | null;
    createdAt: string;
  }>;
}

export interface PlayHistoryEntry {
  slug: string | null;
  title: string | null;
  category: string | null;
  deploymentId: string;
  playCount: number;
  lastPlayedAt: string;
}

/** One thing a visitor said to a published town, with an author to blame. */
export interface WorldWhisper {
  id: string;
  text: string;
  agentKey: string | null;
  simTime: number | null;
  paid?: boolean;
  weight?: number;
  courseNodeId?: string | null;
  courseOptionId?: string | null;
  courseHangLabel?: string | null;
  createdAt: string;
  author: PublicAuthor;
}

export interface CourseOptionView {
  id: string;
  key: string;
  label: string;
  points: number;
  share: number;
  needles?: string[];
  predicateType?: 'event_needle' | 'event_kind' | 'agent_key' | 'agent_presence';
  agentKey?: string;
  agentName?: string;
  present?: boolean;
  winHint?: string;
}

export interface CourseEvidencePreview {
  muted: boolean;
  leadingOptionId: string | null;
  matches: Record<string, number>;
}

export interface CourseView {
  id: string;
  worldId: string;
  gameId: string | null;
  prompt: string;
  kind: string;
  status: string;
  opensAt: string;
  bettingClosesAt: string;
  settlesAt: string;
  mutedHint: boolean;
  evidenceHealth?: 'none' | 'living' | 'muted';
  seedSource?: string;
  reachability?: 'high' | 'medium' | 'low';
  evidencePreview?: CourseEvidencePreview | null;
  pool: number;
  minStake: number;
  myPoints: number;
  myOptionId: string | null;
  options: CourseOptionView[];
  winningOptionId: string | null;
  voidReason: string | null;
  transcriptHash: string | null;
  canon: string | null;
  maxAdd: number;
  addSteps: number[];
  hangs: CourseHang[];
  contested?: boolean;
  authorRakeIfSettled?: number;
  canWithdraw?: boolean;
}

export interface CourseHang {
  optionId: string;
  label: string;
  text: string;
  authorName: string;
  paid: boolean;
}

export interface CourseBoard {
  current: CourseView | null;
  queued?: CourseView | null;
  history: CourseView[];
  skipReason?: 'unfunded';
  watching?: boolean;
}

export interface CourseRecommendPreview {
  readonly kind: string;
  readonly prompt: string;
  readonly options: ReadonlyArray<{ readonly label: string }>;
  readonly seedSource: string;
  readonly reachability: 'high' | 'medium' | 'low';
}

export interface CourseAuthorStats {
  readonly seeds: number;
  readonly finished: number;
  readonly settled: number;
  readonly voided: number;
  readonly contested: number;
  readonly voidRate: number | null;
  readonly contestedRate: number | null;
  readonly window: number;
}

export type CourseSeedBody = {
  kind?: 'night_market' | 'binary' | 'beats' | 'custom' | 'talks' | 'places';
  agentKey?: string;
  prompt?: string;
  options?: Array<{ key?: string; label?: string; needles?: string[] }>;
  replace?: boolean;
  queue?: boolean;
  cancelQueue?: boolean;
};

export type CourseRecommendQuery = {
  readonly kind?: string;
  readonly agentKey?: string;
  readonly prompt?: string;
  readonly options?: CourseSeedBody['options'];
};

export type CourseReturnHint = {
  readonly nodeId?: string | null;
  readonly prompt: string;
  readonly status: string;
  readonly pool: number;
  readonly canon: string | null;
  readonly bettingClosesAt?: string | null;
  readonly settlesAt?: string | null;
  readonly contested?: boolean;
};

export type MyCourseStakeRow = {
  readonly gameId: string;
  readonly slug: string;
  readonly title: string;
  readonly nodeId: string;
  readonly prompt: string;
  readonly status: string;
  readonly myPoints: number;
  readonly myOptionLabel: string;
  readonly pool: number;
  readonly contested: boolean;
  readonly bettingClosesAt: string;
  readonly settlesAt: string;
  readonly actKey: string | null;
};

export type MyCourseWatchRow = {
  readonly gameId: string;
  readonly slug: string;
  readonly title: string;
  readonly course: CourseReturnHint | null;
};

export type CourseTonightDiscovery = {
  readonly summary: {
    readonly townCount: number;
    readonly totalPool: number;
    readonly contestedCount: number;
    readonly soonestBettingClosesAt: string | null;
  };
  readonly items: ReadonlyArray<{
    readonly gameId: string;
    readonly slug: string;
    readonly title: string;
    readonly course: CourseReturnHint;
  }>;
};

export interface FollowedWorld {
  gameId: string;
  slug: string;
  title: string;
  thumbnail?: string | null;
  deploymentId: string;
  followedAt: string;
  lastSeenSimTime: number | null;
  lastSeenAt: string | null;
  world: WorldStatusDto | null;
  /** Sim hours that went by since this follower last watched. */
  newHours: number | null;
  course?: CourseReturnHint | null;
}

export interface RemixParent {
  slug: string;
  title: string;
  category: string;
}

/**
 * What the author allows others to do with a published work. Playback is
 * hosted either way — this governs forking, which is the only route into
 * someone else's project.
 */
export type CommunityLicense = 'remix-ok' | 'remix-credit' | 'no-remix';

// ---------- Points, plans and checkout ----------

export interface CatalogPlan {
  id: string;
  priceCents: number;
  monthlyPoints: number;
  dailyJobLimit: number;
  maxConcurrentJobs: number;
}

export interface CatalogPack {
  id: string;
  points: number;
  priceCents: number;
}

export interface BillingCommerce {
  tipPresets: number[];
  jiaxi: number;
  xiangyi: number;
  townTimeDay: number;
  townTimeWeek: number;
  townTimeMonth?: number;
  challengeEntry: number;
  remixBranch: number;
  sandbox: number;
  adopt?: number;
}

export interface KaiCampaign {
  id: string;
  title: string;
  detail: string;
  lane: 'jiaxi' | 'xiangyi' | 'general';
}

export interface KaiDailyState {
  day: string;
  loginGranted: boolean;
  loginPoints: number;
  missions: { play: boolean; town: boolean; visit: boolean };
  bonusGranted: boolean;
  bonusPoints: number;
  justGranted?: number;
  streak?: number;
  streakBonus?: number;
  welcomeJustGranted?: number;
  welcomePoints?: number;
  tipCoupon?: boolean;
}

export interface KaiMarket {
  campaigns: KaiCampaign[];
  daily: KaiDailyState;
  authorTonight: number;
  authorTonightByKind?: {
    tip: number;
    jiaxi: number;
    xiangyi: number;
    event: number;
    townTime?: number;
    worldLight?: number;
  };
  jiaxiByCardTonight?: Record<string, number>;
  authorWeek?: number;
  firstJiaxi: boolean;
  firstXiangyi?: boolean;
  firstTopupAvailable?: boolean;
  welcomeJustGranted?: number;
  loginStreak?: number;
  welcomePoints?: number;
  inviteHandle?: string | null;
  jiaxiStackToday?: number;
  steps?: { welcome: boolean; play: boolean; town: boolean };
}

export interface BillingCatalog {
  currency: 'CNY';
  plans: CatalogPlan[];
  packs: CatalogPack[];
  jobCosts: Record<string, number>;
  /** Only providers the server can actually charge with are listed. */
  providers: string[];
  stripeStorefront?: boolean;
  commerce?: BillingCommerce;
}

export interface JiaxiCard {
  id: string;
  label: string;
  effect: string;
  points?: number;
  loopId?: string;
}

export interface TownEventOffer {
  id: string;
  label: string;
  points: number;
  stimulus: string;
}

export interface WorkCommerce {
  jiaxiEnabled: boolean;
  xiangyiEnabled: boolean;
  isOfficial: boolean;
  jiaxiCost: number;
  xiangyiCost: number;
  events: TownEventOffer[];
  cards: JiaxiCard[];
  featuredCardId?: string | null;
  jiaxiStackRate?: number;
  runBundle?: { cardIds: string[]; list: number } | null;
  tipPresets: number[];
  townTimeDay: number;
  townTimeWeek: number;
  townTimeMonth?: number;
  worldLightHour?: number;
  worldLightDay?: number;
  worldLightWeek?: number;
  remixBranch: number;
  sandbox: number;
  challengeEntry: number;
  adopt?: number;
  courseMinStake?: number;
}

export interface SandboxReport {
  stimulus: string;
  contrast: boolean;
  headline: string;
  opinionLeaders: string[];
  firstCrack: string;
  recoveryHours: number;
  spread: Array<{ place: string; heat: number }>;
  control?: { headline: string; heat: number };
}

export interface LedgerEntryView {
  id: string;
  kind: string;
  points: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

export interface UsageSummary {
  since: string;
  days: number;
  byModality: Array<{ modality: string; jobType?: string; units: number; jobs: number }>;
  byJobType?: Array<{ jobType: string; modality?: string; units: number; jobs: number }>;
  recent?: Array<{
    jobType: string;
    modality: string;
    units: number;
    ms: number | null;
    jobId: string | null;
    createdAt: string;
  }>;
}

export type TownTimeSku = 'day' | 'week' | 'month';

export interface TownContributor {
  displayName: string;
  avatarUrl: string | null;
  points: number;
  lastSku: TownTimeSku | null;
}

export interface TownLamp {
  displayName: string;
  avatarUrl: string | null;
  sku: TownTimeSku;
  townTimeUntil: string;
}

export interface WalletSummary {
  organizationId: string;
  userId: string;
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  welcomeGranted?: boolean;
  loginStreak?: number;
  plan: string;
  dailyJobLimit: number;
  maxConcurrentJobs: number;
  /** False when the operator runs without point charging (self-host default). */
  enforced: boolean;
  jobCosts: Record<string, number>;
  commerce?: BillingCommerce;
  market?: KaiMarket;
  entries: LedgerEntryView[];
}

/**
 * How the client should hand off to the payment provider. JSAPI runs inside
 * WeChat via `WeixinJSBridge`; every other channel is a redirect.
 */
export type CheckoutPrepay =
  | { kind: 'mock'; settleWith: string }
  | { kind: 'redirect'; url: string }
  | { kind: 'h5'; h5Url: string }
  | {
      kind: 'jsapi';
      appId: string;
      timeStamp: string;
      nonceStr: string;
      package: string;
      signType: 'RSA';
      paySign: string;
    };

export interface CheckoutOrder {
  orderId: string;
  outTradeNo: string;
  amountCents: number;
  points: number;
  plan: string | null;
  provider: string;
  channel: string;
  prepay: CheckoutPrepay;
}

export interface WorldHeadline {
  kind: 'talk' | 'whisper' | 'rumor';
  line: string;
  speakerName?: string;
  simTime: number;
}

export interface WorldActivityItem extends WorldHeadline {
  gameId: string;
  slug: string;
  title: string;
  at: string;
  deploymentId?: string;
  course?: CourseReturnHint | null;
}

/** Follower/following totals, plus whether the reader already follows. */
export interface FollowCounts {
  followers: number;
  following: number;
  viewerFollows: boolean;
}

export interface FollowedAuthor extends PublicAuthor {
  userId: string;
  followedAt: string;
}

/** A new work from someone you follow. */
export interface FeedPublishItem {
  kind: 'publish';
  at: string;
  gameId: string;
  slug: string;
  title: string;
  category: string;
  thumbnail: string | null;
  author: PublicAuthor;
}

/** A line spoken in a town you watch. */
export interface FeedWorldItem {
  kind: 'world';
  at: string;
  beat: WorldActivityItem;
}

export type FeedItem = FeedPublishItem | FeedWorldItem;

/** Why something was reported. The API rejects anything outside this set. */
export type ReportReason = 'stolen' | 'nsfw' | 'illegal' | 'broken' | 'spam' | 'other';

export interface OpenReport {
  id: string;
  targetKind: 'game' | 'comment';
  reason: ReportReason;
  detail: string | null;
  status: string;
  createdAt: string;
  reporter: PublicAuthor | null;
  game: {
    id: string;
    slug: string;
    title: string;
    isPublic: boolean;
    takenDownAt: string | null;
  } | null;
  comment: { id: string; content: string } | null;
}

export interface PluginEntitlement {
  pluginId: string;
  slug: string;
  name: string;
  pointsPaid: number;
  createdAt: string;
}

const apiClient: AxiosInstance = axios.create({
  baseURL: '/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：添加 token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Emergence report card returned by the society endpoints. Keep in sync with
 * `packages/world-agents/src/eval/metrics.ts`.
 */
export interface EmergenceReportDto {
  summary: string;
  informationSpread: {
    rate: number;
    awareCount?: number;
    totalAgents?: number;
    seedText?: string;
    awareIds?: string[];
  };
  relationshipFormation: { newRelations: number; avgAffinity?: number };
  coordination: {
    attendanceRate: number;
    /** Most residents co-located in one region during the evening window. */
    peakGathering?: number;
    peakGatheringRate?: number;
    peakRegionId?: string;
    peakSimTime?: number;
  };
  scheduleDiversity?: { rate: number; distinctRoutes?: number };
  dialogueNovelty?: { rate: number; groupDialogues?: number };
  dialogueQuality?: {
    inCharacter: number;
    citesMemory: number;
    followsLast: number;
    summary: string;
  };
}

/**
 * Stable error codes returned by the platform. Keep in sync with
 * `apps/platform-api/src/lib/errorCodes.ts`.
 */
export type ApiErrorCode =
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'UNAVAILABLE'
  | 'INTERNAL'
  | 'society_busy'
  | 'society_tick_timeout'
  | 'no_llm'
  | 'invalid_input';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    message: string,
    code: ApiErrorCode,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// 响应拦截器：统一错误处理 + 提取 code
/**
 * Pages a visitor is allowed to read with no account. A stale token must not
 * bounce someone off a game they were about to play.
 */
const GUEST_READABLE_PATH_RE = /^\/(community|play|u)(\/|$)/;

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      const path = window.location.pathname;
      if (path !== '/login' && !GUEST_READABLE_PATH_RE.test(path)) {
        window.location.href = '/login';
      }
    }
    const data = error.response?.data as
      | { error?: string; code?: string; details?: Record<string, unknown> }
      | undefined;
    if (data?.code) {
      return Promise.reject(
        new ApiError(
          data.error ?? error.message,
          data.code as ApiErrorCode,
          error.response?.status ?? 0,
          data.details,
        ),
      );
    }
    return Promise.reject(error);
  }
);

/** API 未就绪或网关瞬时错误时重试，减轻并行启动时 Vite 代理先到而后端未监听的问题。 */
function isTransientRequestFailure(method: string, err: unknown): boolean {
  const ax = err as AxiosError;
  if (!axios.isAxiosError(ax)) return false;
  if (!ax.response) {
    return true;
  }
  const s = ax.response.status;
  if (s !== 502 && s !== 503 && s !== 504) return false;
  const m = method.toLowerCase();
  return m === 'get' || m === 'head' || m === 'delete';
}

async function withTransientRetry<T>(method: string, run: () => Promise<T>): Promise<T> {
  const maxAttempts = 5;
  let last: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await run();
    } catch (e) {
      last = e;
      if (!isTransientRequestFailure(method, e) || attempt === maxAttempts - 1) {
        throw e;
      }
      await new Promise((r) => setTimeout(r, 280 * (attempt + 1)));
    }
  }
  throw last;
}

// 封装的 GET 请求
export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const response = await withTransientRetry('get', () => apiClient.get<T>(url, config));
  return response.data;
}

// 封装的 POST 请求
export async function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response = await withTransientRetry('post', () => apiClient.post<T>(url, data, config));
  return response.data;
}

// 封装的 PUT 请求
export async function put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response = await withTransientRetry('put', () => apiClient.put<T>(url, data, config));
  return response.data;
}

// 封装的 PATCH 请求
export async function patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response = await withTransientRetry('patch', () => apiClient.patch<T>(url, data, config));
  return response.data;
}

// 封装的 DELETE 请求
export async function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const response = await withTransientRetry('delete', () => apiClient.delete<T>(url, config));
  return response.data;
}

// API 方法
export const api = {
  // 认证
  auth: {
    methods: () =>
      get<{
        magic: boolean;
        wechat: boolean;
        phone: boolean;
        direct: boolean;
        emailCode: boolean;
        minAge: number;
      }>('/auth/methods'),
    acceptLegal: (body: { birthYear?: number; acceptedLegal?: boolean }) =>
      post<{ ok: boolean }>('/me/legal', body),
    legal: () =>
      get<{
        userId: string;
        birthYear: number | null;
        acceptedLegalAt: string | null;
        minAge: number;
      }>('/me'),
    exportAccount: () => post<Record<string, unknown>>('/me/export', {}),
    deleteAccount: () => post<{ closed: boolean; worksTakenDown: number }>('/me/delete', {}),
    listAppeals: () =>
      get<{
        appeals: Array<{
          id: string;
          communityGameId: string;
          status: string;
          message: string;
          createdAt: string;
        }>;
      }>('/me/appeals'),
    fileAppeal: (communityGameId: string, message: string) =>
      post<{ ok: boolean; id: string }>('/me/appeals', { communityGameId, message }),
    emailRequest: (email: string) =>
      post<{
        ok: boolean;
        expiresInSeconds: number;
        code: string | null;
        delivery: 'email' | 'echo';
      }>('/auth/email/request', { email }),
    emailVerify: (email: string, code: string) =>
      post<{ token: string; userId: string; organizationId: string }>('/auth/email/verify', {
        email,
        code,
      }),
    logins: () =>
      get<{
        events: Array<{
          id: string;
          method: string;
          ip: string | null;
          userAgent: string | null;
          createdAt: string;
        }>;
      }>('/me/logins'),
    /**
     * Asks for a one-time sign-in link. `link` comes back only when the server
     * has no mail delivery and its operator allowed echoing it.
     */
    magicRequest: (email: string) =>
      post<{
        ok: boolean;
        expiresInSeconds: number;
        link: string | null;
        delivery: 'email' | 'echo' | 'server-log';
      }>('/auth/magic/request', { email }),
    magicVerify: (token: string) =>
      post<{ token: string; userId: string; organizationId: string }>(
        '/auth/magic/verify',
        { token },
      ),

    /** `enabled: false` when the operator has no WeChat app configured. */
    sseTicket: () =>
      post<{ ticket: string; expiresInSeconds: number }>('/sse-tickets', {}),
    /**
     * Short-lived query token for EventSource. Falls back to the session JWT
     * only when the ticket endpoint is missing (older API during rollouts).
     */
    mintSseQueryTicket: async (): Promise<string | null> => {
      const minted = await post<{ ticket: string; expiresInSeconds: number }>(
        '/sse-tickets',
        {},
      );
      return minted.ticket;
    },

    wechatUrl: (redirect: string) =>
      get<{ enabled: boolean; url?: string; state?: string }>(
        `/public/auth/wechat/url?redirect=${encodeURIComponent(redirect)}`,
      ),
    wechatCallback: (code: string, state: string) =>
      post<{ token: string; userId: string; organizationId: string; created: boolean }>(
        '/public/auth/wechat/callback',
        { code, state },
      ),
    phoneRequest: (phone: string) =>
      post<{
        ok: boolean;
        expiresInSeconds: number;
        code: string | null;
        delivery: 'echo' | 'sms';
      }>('/public/auth/phone/request', { phone }),
    phoneVerify: (phone: string, code: string) =>
      post<{ token: string; userId: string; organizationId: string; created: boolean }>(
        '/public/auth/phone/verify',
        { phone, code },
      ),
  },

  orgs: {
    list: () =>
      get<{ orgs: Array<{ id: string; name: string; role: string }> }>('/orgs'),
  },

  // 项目
  projects: {
    list: (organizationId?: string) =>
      organizationId && organizationId !== 'all'
        ? get<{ projects: import('../types').Project[] }>(
            `/projects?organizationId=${encodeURIComponent(organizationId)}`,
          )
        : get<{ projects: import('../types').Project[] }>('/projects'),
    create: (organizationId: string, name: string) => post<import('../types').Project>('/projects', { organizationId, name }),
    get: (id: string) => get<import('../types').Project>(`/projects/${id}`),
    delete: (id: string) => del<{ ok: boolean; projectId: string }>(`/projects/${id}`),
    members: (projectId: string) =>
      get<{
        organizationId: string;
        canInvite: boolean;
        members: Array<{
          userId: string;
          email: string | null;
          handle: string | null;
          displayName: string | null;
          role: string;
        }>;
      }>(`/projects/${projectId}/members`),
    invite: (projectId: string, email: string, role?: string) =>
      post<{ ok: boolean; userId: string; organizationId: string; role: string }>(
        `/projects/${projectId}/members`,
        { email, role },
      ),
    runBuild: (projectId: string) =>
      post<{ jobId: string }>(`/projects/${projectId}/build`, {}),
    communityGame: (projectId: string) =>
      get<{ gameId: string | null; category: string | null }>(
        `/projects/${projectId}/community-game`,
      ),
    benchRuns: (projectId: string) =>
      get<{
        runs: Array<{
          id: string;
          status: string;
          scores: Record<string, unknown> | null;
          publicLabel: string | null;
          isPublic: boolean;
          createdAt: string;
        }>;
      }>(`/projects/${projectId}/bench-runs`),
    runBench: (projectId: string, body: { publish?: boolean; label?: string } = {}) =>
      post<{ jobId: string }>(`/projects/${projectId}/bench`, body),
    deadLetters: (projectId: string) =>
      get<{
        letters: Array<{
          id: string;
          jobId: string | null;
          jobType: string | null;
          attempts: number;
          error: string | null;
          createdAt: string;
        }>;
      }>(`/projects/${projectId}/dead-letters`),
    requeueDeadLetter: (projectId: string, letterId: string) =>
      post<{ jobId: string; traceId: string; letterId: string }>(
        `/projects/${projectId}/dead-letters/${letterId}/requeue`,
      ),
    buildCache: (projectId: string) =>
      get<{
        builds: Array<{
          jobId: string;
          status: string;
          contentHash: string | null;
          cacheHit: boolean;
          createdAt: string;
        }>;
      }>(`/projects/${projectId}/build-cache`),
    workspaceArchive: (projectId: string) =>
      get<{
        enabled: boolean;
        savedAt: string | null;
        fileCount: number;
        key: string | null;
      }>(`/projects/${projectId}/workspace-archive`),
    templates: (projectId: string) =>
      get<{
        applied: {
          templateId: string;
          slug: string;
          version: string;
          official: boolean;
          appliedAt: string;
        } | null;
        versions: Array<{ id: string; version: string; createdAt: string }>;
        rescaffoldRequestedAt?: string | null;
      }>(`/projects/${projectId}/templates`),
    rescaffold: (projectId: string, body: { cancel?: boolean } = {}) =>
      post<{
        ok: boolean;
        cancelled: boolean;
        previewPreserved: boolean;
        takesEffectOnNextGenerate?: boolean;
        rescaffoldRequestedAt: string | null;
      }>(`/projects/${projectId}/templates/rescaffold`, body),
  },

  // 任务
  jobs: {
    list: (projectId: string) =>
      get<{
        jobs: import('../types').JobRow[];
        queue?: { runningElsewhere: number };
      }>(`/projects/${projectId}/jobs`),
    retry: (projectId: string, jobId: string) =>
      post<{ jobId: string; already?: boolean }>(`/projects/${projectId}/jobs/${jobId}/retry`),
    cancel: (projectId: string, jobId: string) =>
      post<{ ok: boolean; jobId: string; status: string }>(
        `/projects/${projectId}/jobs/${jobId}/cancel`,
      ),
    staleRecover: (projectId: string, staleMinutes = 5) =>
      post<{
        recovered: number;
        jobIds: string[];
        staleMinutes: number;
        runningElsewhere?: number;
      }>(`/projects/${projectId}/jobs/stale-recover`, { staleMinutes }),
    getLogUrl: (jobId: string) => get<{ url: string }>(`/jobs/${jobId}/log-url`),
    getLog: (jobId: string) =>
      get<{
        text: string;
        source: 's3' | 'inline';
        truncated: boolean;
        key: string | null;
      }>(`/jobs/${jobId}/log`),
    getProgress: (projectId: string, jobId: string) => get<{
      jobId: string;
      status: string;
      type: string;
      stage: 'queued' | 'installing' | 'building' | 'optimizing' | 'uploading' | 'done' | 'failed';
      progress: number;
      buildCacheKey?: string;
      createdAt: string;
      updatedAt: string;
    }>(`/projects/${projectId}/jobs/${jobId}/progress`),
    get: (projectId: string, jobId: string) => get<import('../types').JobRow>(`/projects/${projectId}/jobs/${jobId}`),
    /** History of agent_events for a job — for IDE replay on session reopen. */
    agentEvents: (projectId: string, jobId: string) =>
      get<{ events: import('../types').AgentEventRow[] }>(
        `/projects/${projectId}/jobs/${jobId}/agent-events`,
      ),
  },

  // Remix / Fork
  remix: {
    /** Fork by internal project id (e.g. from session history). */
    forkProject: (
      projectId: string,
      payload: { name?: string; note?: string; sourceDeploymentId?: string } = {},
    ) =>
      post<{
        project: { id: string; name: string };
        deploymentId: string | null;
        sourceProjectId: string;
        sourceDeploymentId: string | null;
      }>(`/projects/${projectId}/fork`, payload),
    /**
     * Fork by community slug/id (from Community → GameDetail). `line` is the
     * one sentence the visitor wants changed; it is stored as the remix note
     * and comes back so the studio can prefill the chat with it.
     */
    forkCommunityGame: (slugOrId: string, payload: { line?: string; branch?: boolean } = {}) =>
      post<{
        project: { id: string; name: string };
        deploymentId: string | null;
        sourceProjectId: string;
        sourceDeploymentId: string | null;
        kind: 'game' | 'world';
        worldCopied: boolean;
        line: string | null;
      }>(`/community/games/${slugOrId}/fork`, payload),
  },

  // Agent 智能层：Brief / Memory / 上下文 / 反馈
  agent: {
    getBrief: (projectId: string) =>
      get<{ brief: Record<string, unknown> | null; version: number; updatedAt: string | null }>(
        `/projects/${projectId}/brief`,
      ),
    patchBrief: (projectId: string, brief: Record<string, unknown>) =>
      patch<{ brief: Record<string, unknown>; version: number }>(
        `/projects/${projectId}/brief`,
        { brief },
      ),
    listMemories: (projectId: string) =>
      get<{ memories: Array<{ id: string; scope: string; fact: string; createdAt: string }> }>(
        `/projects/${projectId}/memories`,
      ),
    sessionContext: (projectId: string, sessionId?: string) => {
      const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
      return get<{
        brief: Record<string, unknown> | null;
        sessionSummary: string | null;
        memories: string[];
      }>(`/projects/${projectId}/session-context${qs}`);
    },
    submitFeedback: (projectId: string, jobId: string, data: { rating?: number; comment?: string }) =>
      post<{ ok: boolean }>(`/projects/${projectId}/jobs/${jobId}/feedback`, data),
    metrics: (projectId: string) =>
      get<{
        generateJobs: { total: number; succeeded: number; failed: number };
        feedback: { avgRating: string | null; count: number };
        ragChunksIndexed: number;
      }>(`/projects/${projectId}/agent-metrics`),
  },

  communityRag: {
    suggestions: (q: string) =>
      get<{ suggestions: Array<{ title: string; slug: string; snippet: string }> }>(
        `/community/rag-suggestions?q=${encodeURIComponent(q)}`,
      ),
  },

  // 多模态生成资产（图 / 音 / 视频 / 音乐）
  assets: {
    list: (projectId: string, modality?: 'image' | 'audio' | 'video' | 'music' | 'speech') => {
      const qs = modality ? `?modality=${modality}` : '';
      return get<{ assets: import('../types').AssetRow[] }>(
        `/projects/${projectId}/assets${qs}`,
      );
    },
  },

  // 部署
  deployments: {
    list: (projectId: string) => get<{ deployments: import('../types').DeploymentRow[] }>(`/projects/${projectId}/deployments`),
    getPreviewUrl: (deploymentId: string) =>
      get<{ url: string; projectId?: string }>(
        `/deployments/${deploymentId}/preview-url`,
      ),
    /** Read current custom-domain / ACME state for a deployment. */
    getDomain: (deploymentId: string) =>
      get<{
        deploymentId: string;
        customDomain: string | null;
        verified: boolean;
        acmeChallenge: { recordName: string; recordValue: string; recordType: 'TXT' } | null;
        cdnUrl: string | null;
      }>(`/deployments/${deploymentId}/domain`),
    /** Step 1: request a DNS-01 challenge for a custom hostname. */
    initDomain: (deploymentId: string, customDomain: string) =>
      post<{
        deploymentId: string;
        customDomain: string;
        challenge: {
          recordName: string;
          recordValue: string;
          recordType: 'TXT';
          instructions: string;
        };
      }>(`/deployments/${deploymentId}/domain/acme-init`, { customDomain }),
    /** Step 2: check the TXT record and finalize CDN binding. */
    verifyDomain: (deploymentId: string) =>
      post<{
        ok: boolean;
        verified: boolean;
        cdnUrl?: string;
        reason?: string;
        observed?: string[];
      }>(`/deployments/${deploymentId}/domain/verify`, {}),
  },

  // 会话
  sessions: {
    list: (projectId: string) => get<{ sessions: import('../types').ChatSessionRow[] }>(`/projects/${projectId}/chat-sessions`),
    create: (projectId: string, title: string) => post<import('../types').ChatSessionRow>(`/projects/${projectId}/chat-sessions`, { title }),
    fork: (projectId: string, sessionId: string) => post<{ sessionId: string }>(`/projects/${projectId}/chat-sessions/${sessionId}/fork`),
    delete: (projectId: string, sessionId: string) => del<{ ok: boolean }>(`/projects/${projectId}/chat-sessions/${sessionId}`),
    messages: (projectId: string, sessionId: string) => get<{ messages: import('../types').ChatMessageRow[] }>(`/projects/${projectId}/chat-sessions/${sessionId}/messages`),
  },

  // 消息
  messages: {
    send: (
      projectId: string,
      content: string,
      sessionId?: string,
      gameParams?: GameParamsConfig,
      images?: string[],
      mode?: 'game' | 'world' | 'world_edit',
      worldOp?: unknown,
    ) =>
      post<{ jobId: string; sessionId: string; jobType?: string }>(
        `/projects/${projectId}/messages`,
        { content, sessionId, gameParams, images, mode, worldOp },
      ),
  },

  /** World model SSOT */
  world: {
    get: (projectId: string) =>
      get<{
        world: {
          id: string;
          title: string;
          tipRevision: number;
          spec: Record<string, unknown>;
          memory: unknown;
          summary: string;
          gameplay?: {
            regions: number;
            npcs: number;
            enemies: number;
            items: number;
            quests: number;
            portals: number;
            hasCombat: boolean;
            hasInventoryLoop: boolean;
            winCondition: string;
            controls: string[];
          };
          l3?: {
            backend: string | null;
            lingbotMode: 'mock' | 'real' | null;
            cinematicEnabled: boolean;
            plannerSource: string | null;
            regionsWithVideo: string[];
            clipCount: number;
          };
          l2?: {
            opsApplied: number;
            regionsDelta: number;
            questsDelta: number;
            rulesDelta: number;
            narrativeSeed: string | null;
          } | null;
          societySeed?: {
            hours?: number;
            dialogues: number;
            spread: number;
            degraded: boolean;
            gateFailed: boolean;
            retrievalDegraded: boolean;
            spreadOk?: boolean;
          } | null;
          authoredNpcs?: number;
          paddedNpcs?: number;
          authoredNames?: string[];
          paddedNames?: string[];
          worldBrief?: {
            packId?: string;
            useCase?: string;
            venues: string[];
            scale?: string;
            livedIn?: string;
            note?: string;
          } | null;
          updatedAt: string;
          lightUntil?: string | null;
          metaSummary?: string | null;
          openingRumor?: string | null;
        } | null;
      }>(`/projects/${projectId}/world`),
    revisions: (projectId: string) =>
      get<{
        revisions: Array<{
          revision: number;
          parentRevision: number | null;
          summary: string | null;
          op: unknown;
          createdAt: string;
        }>;
      }>(`/projects/${projectId}/world/revisions`),
    revisionDiff: (projectId: string, revision: number) =>
      get<{
        fromRevision: number;
        toRevision: number;
        diff: {
          regionsBefore: number;
          regionsAfter: number;
          questsBefore: number;
          questsAfter: number;
          entitiesBefore: number;
          entitiesAfter: number;
          rulesBefore: number;
          rulesAfter: number;
          addedRegions: string[];
          removedRegions: string[];
          addedQuests: string[];
          removedQuests: string[];
          addedEntities: string[];
          removedEntities: string[];
          addedRules: string[];
          removedRules: string[];
          summaryLines: string[];
        };
        fromSummary: string;
        toSummary: string;
        storedDiffSummary: unknown;
        dirtyRegions: unknown;
      }>(`/projects/${projectId}/world/revisions/${revision}/diff`),
    restoreRevision: (projectId: string, revision: number) =>
      post<{
        tipRevision: number;
        fromRevision: number;
        jobId: string;
        traceId: string;
      }>(`/projects/${projectId}/world/revisions/${revision}/restore`, {}),
    edit: (
      projectId: string,
      payload: {
        prompt?: string;
        op?: unknown;
        sessionId?: string;
        rebuildOnly?: boolean;
      },
    ) =>
      post<{ jobId: string; traceId: string; sessionId?: string }>(
        `/projects/${projectId}/world/edit`,
        payload,
      ),
    simulate: (
      projectId: string,
      payload: { ticks?: number; hoursPerTick?: number } = {},
    ) =>
      post<{
        world: Record<string, unknown>;
        events: unknown[];
        summary: string;
      }>(`/projects/${projectId}/world/simulate`, payload),
    refreshNarrative: (
      projectId: string,
      payload: {
        fields?: readonly ('meta.summary' | 'presentation.openingRumor')[];
        locale?: 'zh' | 'en';
      } = {},
    ) =>
      post<{
        ok: boolean;
        tipRevision: number;
        changed: boolean;
        summary?: string;
        openingRumor?: string;
        lint?: ReadonlyArray<{
          severity: 'info' | 'warn' | 'error';
          code: string;
          path: string;
          detail: string;
          hit?: string;
        }>;
      }>(`/projects/${projectId}/world/refresh-narrative`, payload),
    societyRun: (
      projectId: string,
      payload: {
        hours?: number;
        seedText?: string;
        invitationText?: string;
        sync?: boolean;
      } = {},
    ) =>
      post<{
        jobId?: string;
        sync?: boolean;
        events?: number;
        simTime?: number;
        spreadOk?: boolean;
        gateFailed?: boolean;
        error?: string;
        report?: EmergenceReportDto;
      }>(`/projects/${projectId}/world/society/run`, payload, {
        // Sync 8h can take minutes even with converse-only LLM.
        timeout: payload.sync ? 600_000 : 30_000,
      }),
    societyEvents: (projectId: string, from = 0, to = 1e9, limit = 120) =>
      get<{
        simTime?: number;
        events: Array<{
          id: string;
          simTime: number;
          kind: string;
          agentId?: string | null;
          payload: Record<string, unknown>;
          createdAtMs?: number;
        }>;
        agents: Array<{
          id: string;
          name: string;
          regionId: string;
          areaId?: string;
          areaName?: string;
          x: number;
          y: number;
          currentAction: string;
          goalPlace?: string;
          goalX?: number;
          goalY?: number;
          identity: unknown;
        }>;
        relations: Array<{
          from: string;
          to: string;
          summary: string;
          affinity: number;
          kind?: string;
        }>;
        objects?: Array<{
          id: string;
          name: string;
          state: string;
          regionId?: string;
          kind?: string;
        }>;
        living?: boolean;
        speaking?: boolean;
        clockPaused?: boolean;
        townTimeUntil?: string | null;
        presenceUntil?: string | null;
        lamp?: TownLamp | null;
        contributors?: TownContributor[];
        watcherCount?: number;
        talkBudget?: {
          used: number;
          cap: number;
          remaining: number;
          resetsAt: string;
          litBonus?: number;
          litUntil?: string | null;
        } | null;
      }>(
        `/projects/${projectId}/world/society/events?from=${from}&to=${to}&limit=${limit}`,
      ),
    societyReport: (projectId: string) =>
      get<{
        report: EmergenceReportDto | null;
      }>(`/projects/${projectId}/world/society/report`),
    /**
     * SSE URL for the server-driven world clock. EventSource cannot send an
     * Authorization header; mint a short-lived ticket instead of putting the
     * session JWT in the query string.
     */
    societyStreamUrl: (projectId: string, ticket: string): string => {
      const base =
        typeof window !== 'undefined'
          ? import.meta.env.VITE_API_BASE_URL?.trim() || window.location.origin
          : import.meta.env.VITE_API_BASE_URL?.trim() ||
            'http://127.0.0.1:3847';
      return `${base.replace(/\/$/, '')}/v1/projects/${projectId}/world/society/stream?sse_ticket=${encodeURIComponent(ticket)}`;
    },
    /**
     * Keep the resident world clock running. `watching` refreshes a short
     * presence + author-watch lease. `always` is not a product switch.
     */
    societyHeartbeat: (
      projectId: string,
      mode: 'always' | 'watching' | 'off' | 'leave' = 'watching',
      ttlMinutes?: number,
      tab?: string,
      opts?: { readonly resumeClock?: boolean },
    ) =>
      post<{
        ok?: boolean;
        reason?: string;
        mode: string;
        enabled: boolean;
        until: string | null;
        lastHeartbeatAt: string | null;
        watcherCount?: number;
      }>(`/projects/${projectId}/world/society/heartbeat`, {
        mode,
        ...(ttlMinutes === undefined ? {} : { ttlMinutes }),
        ...(tab ? { tab } : {}),
        ...(opts?.resumeClock ? { resumeClock: true } : {}),
      }),
    societyAgent: (projectId: string, agentKey: string) =>
      get<{
        agent?: {
          id: string;
          name: string;
          regionId: string;
          currentAction: string;
          identity: unknown;
          areaId?: string;
          areaName?: string;
          regionName?: string;
          goalX?: number;
          goalY?: number;
          goalPlace?: string;
          goalReason?: string;
          drive?: string;
          needs?: {
            hunger?: number;
            energy?: number;
            social?: number;
            curiosity?: number;
          };
        } | null;
        memories: Array<{
          id: string;
          kind: string;
          text: string;
          simTime: number;
          importance: number;
          pointers: unknown;
        }>;
        plans: Array<{
          dayIndex: number;
          segments: unknown;
          replan?: boolean;
          reason?: string;
        }>;
      }>(`/projects/${projectId}/world/society/agents/${encodeURIComponent(agentKey)}`),
    worldLight: (projectId: string, sku: 'hour' | 'day' | 'week') =>
      post<{
        ok?: boolean;
        charged: number;
        sku: 'hour' | 'day' | 'week';
        lightUntil?: string | null;
        lightBonusPerHour?: number;
        talkBudget?: {
          used: number;
          cap: number;
          remaining: number;
          resetsAt: string;
          litBonus?: number;
          litUntil?: string | null;
        } | null;
      }>(`/projects/${projectId}/world/light`, { sku }),
    societyInterview: (
      projectId: string,
      payload: { agentKey: string; question: string },
    ) =>
      post<{
        agentId: string;
        agentName: string;
        question: string;
        answer: string;
        cited: string[];
        citedMemoryIds?: string[];
        source?: 'model' | 'memory';
        mute?: string;
      }>(`/projects/${projectId}/world/society/interview`, payload, {
        timeout: 25_000,
      }),
    societyOpinion: (projectId: string) =>
      get<import('../components/World/SocietyOpinionBoard').OpinionBoardView>(
        `/projects/${projectId}/world/society/opinion`,
      ),
    societyForecast: (
      projectId: string,
      hours = 8,
      scenarios?: Array<{ id: string; regionId?: string; delta: number }>,
    ) =>
      post<{
        bands: import('../components/World/SocietyOpinionBoard').ForecastBand[];
        scenarios?: Array<{
          id: string;
          bands: import('../components/World/SocietyOpinionBoard').ForecastBand[];
        }>;
      }>(`/projects/${projectId}/world/society/forecast`, { hours, scenarios }),
    societyDeep: (projectId: string) =>
      get<import('../components/World/DeepMindPanel').DeepMindView>(
        `/projects/${projectId}/world/society/deep`,
      ),
    societyCognition: (
      projectId: string,
      cognition: 'classic' | 'deep',
      violencePublic?: boolean,
    ) =>
      post<{ cognition: string; violencePublic: boolean }>(
        `/projects/${projectId}/world/society/cognition`,
        { cognition, violencePublic },
      ),
    societyEnsemble: (
      projectId: string,
      body: {
        preset?: 'contested' | 'exercise';
        decision?: string;
        execution?: string;
        title?: string;
        grievance?: number;
        legitimacy?: number;
        population?: number;
        windowHours?: number;
      },
    ) =>
      post<{
        runId: string;
        status: string;
        preliminary: boolean;
        report: import('../components/World/DeepMindPanel').EnsembleReport;
      }>(`/projects/${projectId}/world/society/forecast`, { mode: 'ensemble', ...body }),
    societyForecastRun: (projectId: string, runId: string) =>
      get<{ status: string; report: unknown; error: string | null }>(
        `/projects/${projectId}/world/society/forecast-run/${runId}`,
      ),
    societyStepIn: (projectId: string, body: { who?: string; text: string }) =>
      post<{ simHour: number; events: string[] }>(
        `/projects/${projectId}/world/society/step-in`,
        body,
      ),
    societyOpinionReport: (projectId: string) =>
      get<Record<string, unknown>>(
        `/projects/${projectId}/world/society/opinion-report`,
      ),
    societyMind: (projectId: string, enabled: boolean) =>
      post<{ mindEnabled: boolean }>(`/projects/${projectId}/world/society/mind`, {
        enabled,
      }),
    societyCalibrate: (
      projectId: string,
      payload: { support: number; oppose: number; regionId?: string; trust?: number },
    ) =>
      post<import('../components/World/SocietyOpinionBoard').OpinionBoardView>(
        `/projects/${projectId}/world/society/calibrate`,
        payload,
      ),
    societyScenario: (
      projectId: string,
      payload: {
        kind: 'election' | 'rumor' | 'price' | 'disaster' | 'mayor' | 'audience' | 'migrate';
        regionId?: string;
        issue?: string;
        choice?: number;
        enact?: boolean;
        topic?: string;
        base?: number;
        stance?: number;
      },
    ) =>
      post<{
        choices?: Array<{ title: string; body: string }>;
        opinion?: import('../components/World/SocietyOpinionBoard').OpinionBoardView;
        support?: number;
        oppose?: number;
      }>(`/projects/${projectId}/world/society/scenario`, payload),
    societyIntervene: (
      projectId: string,
      payload: {
        fromSimTime: number;
        kind: 'whisper' | 'set_object' | 'inject_event' | 'policy';
        agentKey?: string;
        text?: string;
        title?: string;
        tags?: string[];
        channel?: 'notice' | 'broadcast' | 'word';
        objectId?: string;
        objectState?: string;
        recomputeHours?: number;
      },
    ) =>
      post<{
        events: number;
        simTime: number;
        live?: boolean;
        delta?: Array<{
          id: string;
          simTime: number;
          kind: string;
          agentId?: string | null;
          payload: Record<string, unknown>;
        }>;
        agents?: Array<{
          id: string;
          name: string;
          regionId: string;
          x: number;
          y: number;
          currentAction: string;
          areaId?: string;
          areaName?: string;
          goalPlace?: string;
          goalReason?: string;
          drive?: string;
          goalX?: number;
          goalY?: number;
        }>;
        relations?: Array<{
          from: string;
          to: string;
          summary: string;
          affinity: number;
          kind?: string;
        }>;
        objects?: Array<{
          id: string;
          name: string;
          state: string;
          regionId?: string;
          kind?: string;
        }>;
        rumor?: boolean;
        focusAgentId?: string | null;
        llm?: boolean;
        degraded?: boolean;
        dialogueKind?: 'model' | 'template' | 'none';
        skipReason?:
          | 'budget'
          | 'no_key'
          | 'generate'
          | 'unwatched'
          | 'no_permit'
          | 'keys_exhausted';
        talksMuted?: boolean;
        retrievalDegraded?: boolean;
        policyId?: string;
        opinion?: import('../components/World/SocietyOpinionBoard').OpinionBoardView;
      }>(`/projects/${projectId}/world/society/intervene`, payload, {
        timeout: 25_000,
      }),
    // No withTransientRetry: a timed-out tick must not fan out 5 more lock waiters.
    societyTick: async (projectId: string) => {
      const response = await apiClient.post<{
        simTime: number;
        events: Array<{
          id: string;
          simTime: number;
          kind: string;
          agentId?: string | null;
          payload: Record<string, unknown>;
        }>;
        agents: Array<{
          id: string;
          name: string;
          regionId: string;
          x: number;
          y: number;
          currentAction: string;
          areaId?: string;
          areaName?: string;
          goalPlace?: string;
          goalX?: number;
          goalY?: number;
        }>;
        relations?: Array<{
          from: string;
          to: string;
          summary: string;
          affinity: number;
          kind?: string;
        }>;
        objects?: Array<{
          id: string;
          name: string;
          state: string;
          regionId?: string;
          kind?: string;
        }>;
        report?: EmergenceReportDto;
        llm: boolean;
        seeded: boolean;
        degraded: boolean;
        dialogueKind?: 'model' | 'template' | 'none';
        skipReason?:
          | 'budget'
          | 'no_key'
          | 'generate'
          | 'unwatched'
          | 'no_permit'
          | 'keys_exhausted';
        talksMuted?: boolean;
        retrievalDegraded?: boolean;
        talkBudget?: {
          used: number;
          cap: number;
          remaining: number;
          resetsAt: string;
          litBonus?: number;
          litUntil?: string | null;
        } | null;
      }>(`/projects/${projectId}/world/society/tick`, {}, { timeout: 25000 });
      return response.data;
    },
    societyRepublishReplay: (projectId: string) =>
      post<{ ok: boolean; key?: string; events: number }>(
        `/projects/${projectId}/world/society/republish-replay`,
        {},
        { timeout: 15_000 },
      ),
    spatialProbe: (projectId: string, backend?: string) => {
      const qs = backend ? `?backend=${encodeURIComponent(backend)}` : '';
      return get<{
        backend: string;
        label: string;
        licenseNote?: string;
        result: {
          ok: boolean;
          message: string;
          assetUrl?: string;
          videoUrl?: string;
          licenseNote?: string;
        };
      }>(`/projects/${projectId}/world/spatial-probe${qs}`);
    },
    patchPresentation: (
      projectId: string,
      payload: {
        spatialBackend?: string | null;
        lingbotMode?: 'mock' | 'real' | null;
        cinematicEnabled?: boolean;
      },
    ) =>
      patch<{
        ok: boolean;
        tipRevision: number;
        l3?: {
          backend: string | null;
          lingbotMode: 'mock' | 'real' | null;
          cinematicEnabled: boolean;
          clipCount: number;
        };
        presentation?: Record<string, unknown>;
      }>(`/projects/${projectId}/world/presentation`, payload),
    agentic: (
      projectId: string,
      payload: { intent: string; persist?: boolean },
    ) =>
      post<{
        persisted: boolean;
        revision?: number;
        rebuildJobId?: string;
        summary: string;
        proposals: Array<{
          role: string;
          rationale: string;
          source: string;
          ops: unknown[];
        }>;
        applied: unknown[];
        issues: string[];
      }>(`/projects/${projectId}/world/agentic`, payload),
    lingbotHealth: (projectId: string) =>
      get<{
        ok: boolean;
        mode?: string;
        sessions?: number;
        sidecarUrl?: string;
        acceptNc?: boolean;
        profile?: string;
        readyReal?: boolean;
        weightsReady?: boolean;
        weights?: {
          weightsReady?: boolean;
          shardComplete?: number;
          shardExpected?: number;
          canSwitchReal?: boolean;
        };
        ckpt?: string | null;
        repo?: string | null;
        seedImage?: string | null;
        gpu?: {
          ok?: boolean;
          name?: string;
          vramTotalMb?: number;
          vramFreeMb?: number;
          count?: number;
          consumerLikely?: boolean;
        };
        recommended?: {
          nproc?: number;
          frameNum?: number;
          size?: string;
          timeoutSec?: number;
          fallbackMock?: boolean;
        };
        warnings?: string[];
        note?: string;
      }>(`/projects/${projectId}/world/lingbot/health`),
    lingbotSession: (projectId: string) =>
      post<{
        session: {
          sessionId: string;
          mode: string;
          frameUrl?: string;
          step: number;
        };
        summary: string;
      }>(`/projects/${projectId}/world/lingbot/session`, {}),
    lingbotCloseSession: (projectId: string, sessionId: string) =>
      del<{ ok: boolean; actionPath?: unknown }>(
        `/projects/${projectId}/world/lingbot/session/${sessionId}`,
      ),
    lingbotStep: (
      projectId: string,
      payload: { sessionId: string; action?: string; wasd?: string },
    ) =>
      post<{
        frameUrl?: string;
        skippedLingBot?: boolean;
        session?: { step: number; frameUrl?: string };
        action?: string;
      }>(`/projects/${projectId}/world/lingbot/step`, payload),
    lingbotClip: (
      projectId: string,
      payload: {
        sessionId?: string;
        mode?: 'mock' | 'real';
        persist?: boolean;
        frameNum?: number;
      } = {},
    ) =>
      post<{
        ok: boolean;
        videoUrl?: string;
        httpUrl?: string;
        previewUrl?: string;
        relativeVideoUrl?: string;
        tipRevision?: number;
        regionId?: string;
        message?: string;
        mock?: boolean;
        fallbackFromReal?: boolean;
        realError?: string;
        profile?: string;
        license?: string;
        note?: string;
        error?: string;
      }>(`/projects/${projectId}/world/lingbot/clip`, payload, {
        // Consumer single-GPU (4070) can exceed 15 min — allow 20 min
        timeout: 1_200_000,
      }),
    lingbotConvert: (
      projectId: string,
      payload: { actionManifest: unknown; writeNpy?: boolean },
    ) =>
      post<{ ok: boolean; dir?: string; npy?: boolean; message?: string }>(
        `/projects/${projectId}/world/lingbot/convert`,
        payload,
      ),
    lingbotSmoke: (projectId: string) =>
      post<{
        ok?: boolean;
        smoke?: boolean;
        videoUrl?: string;
        httpUrl?: string;
        message?: string;
        error?: string;
      }>(`/projects/${projectId}/world/lingbot/smoke`, {}),
    train: (
      projectId: string,
      payload: { episodes?: number; epochs?: number; sync?: boolean } = {},
    ) =>
      post<{
        jobId?: string;
        sync?: boolean;
        steps?: number;
        finalLoss?: number;
        losses?: number[];
      }>(`/projects/${projectId}/world/train`, payload),
    imagine: (
      projectId: string,
      payload: { actions?: string[] } = {},
    ) =>
      post<{
        preferred: string | null;
        weightsSource?: 'request' | 'disk' | 'hot_train';
        persisted?: boolean;
        ranked: Array<{ action: string; surprise: number; events: string[] }>;
      }>(`/projects/${projectId}/world/imagine`, payload),
  },

  // API keys (P5)
  apiKeys: {
    list: () =>
      get<{
        apiKeys: Array<{
          id: string;
          name: string;
          keyPrefix: string;
          scopes: string[] | null;
          rateLimitPerMinute: number | null;
          lastUsedAt: string | null;
          revokedAt: string | null;
          createdAt: string;
        }>;
      }>('/api-keys'),
    create: (payload: { name: string; scopes?: string[]; rateLimitPerMinute?: number }) =>
      post<{
        id: string;
        name: string;
        keyPrefix: string;
        rawKey: string;
        scopes: string[];
        createdAt: string;
      }>('/api-keys', payload),
    revoke: (keyId: string) => del<{ ok: boolean }>(`/api-keys/${keyId}`),
  },

  // Plugin marketplace (P5)
  plugins: {
    listMine: () =>
      get<{
        plugins: Array<{
          id: string;
          slug: string;
          name: string;
          description: string | null;
          latestVersion: string | null;
          tags: unknown;
          isPublic: boolean;
          installCount: number;
          updatedAt: string;
        }>;
      }>('/plugins/mine'),
    create: (payload: {
      slug: string;
      name: string;
      description?: string;
      tags?: string[];
      isPublic?: boolean;
    }) => post<{ plugin: { id: string; slug: string; name: string } }>('/plugins', payload),
    requestUpload: (slug: string, version: string) =>
      post<{ storageKey: string; bucket: string; uploadInstructions: string }>(
        `/plugins/${slug}/upload`,
        { version },
      ),
    publish: (
      slug: string,
      payload: {
        version: string;
        storageKey: string;
        sha256: string;
        manifest: Record<string, unknown>;
        runtimePeerRange?: string;
      },
    ) => post(`/plugins/${slug}/versions`, payload),
    install: (slug: string, projectId?: string) =>
      post<{ ok: boolean; installCount: number; projectId: string | null }>(
        `/plugins/${slug}/install`,
        projectId ? { projectId } : {},
      ),
    apply: (slug: string, projectId: string) =>
      post<{ ok: boolean; projectId: string; pluginId: string }>(`/plugins/${slug}/apply`, {
        projectId,
      }),
    unpublish: (slug: string) => del<{ ok: boolean }>(`/plugins/${slug}`),
    /** Pays the asking price in points and grants this org the right to use it. */
    purchase: (slug: string) =>
      post<{ ok: boolean; owned: boolean; pointsPaid: number }>(
        `/plugins/${slug}/purchase`,
      ),
    entitlements: () =>
      get<{ entitlements: PluginEntitlement[] }>('/plugins/entitlements'),
    setPrice: (slug: string, pricePoints: number) =>
      patch<{ ok: boolean; pricePoints: number }>(`/plugins/${slug}/price`, {
        pricePoints,
      }),
  },

  // Player saves + achievements + profile (P3)
  me: {
    profile: () =>
      get<{
        userId: string;
        savesCount: number;
        achievements: Array<{
          id: string;
          userId: string;
          deploymentId: string;
          achievementKey: string;
          title: string;
          description: string | null;
          iconUrl: string | null;
          progress: number;
          awardedAt: string;
        }>;
        recentSaves: Array<{
          id: string;
          deploymentId: string;
          slot: string;
          updatedAt: string;
        }>;
        profile: UserProfile | null;
      }>(`/me/profile`),
    /** Editable public identity (handle drives `/u/:handle`). */
    updateProfile: (payload: {
      handle?: string | null;
      displayName?: string | null;
      avatarUrl?: string | null;
      bio?: string | null;
    }) => patch<{ profile: UserProfile }>('/me/profile', payload),
    works: () => get<MyWorks>('/me/works'),
    history: () => get<{ history: PlayHistoryEntry[] }>('/me/history'),
    /** Followed worlds with the sim-clock gap since the last visit. */
    follows: () => get<{ follows: FollowedWorld[] }>('/me/follows'),
    courseStakes: () => get<{ stakes: MyCourseStakeRow[] }>('/me/course-stakes'),
    courseWatches: () => get<{ watches: MyCourseWatchRow[] }>('/me/course-watches'),
    /**
     * New works from people I follow, mixed with beats from towns I watch.
     * `suggested` is only populated when the feed is empty, so a first-time
     * follower lands on someone to follow instead of a blank page.
     */
    feed: (limit = 24) =>
      get<{
        items: FeedItem[];
        suggested: Array<FollowedAuthor & { works: number }>;
      }>('/me/feed', { params: { limit } }),
    coursePushVapid: () =>
      get<{ publicKey: string | null }>('/me/course-push/vapid-public'),
    coursePushSubscribe: (body: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    }) => put<{ ok: boolean }>('/me/course-push/subscribe', body),
    coursePushUnsubscribe: (endpoint: string) =>
      del<{ ok: boolean }>('/me/course-push/subscribe', { data: { endpoint } }),
    courseWatch: (gameId: string) =>
      put<{ ok: boolean; watching: boolean }>(
        `/me/course-watch/${encodeURIComponent(gameId)}`,
        {},
      ),
    courseUnwatch: (gameId: string) =>
      del<{ ok: boolean; watching: boolean }>(
        `/me/course-watch/${encodeURIComponent(gameId)}`,
      ),
    /** What this account is allowed to do beyond its own work (curation). */
    capabilities: () => get<{ curator: boolean }>('/me/capabilities'),
  },

  /** Curator-only surface: the report queue and the decisions on it. */
  admin: {
    reports: (status: 'open' | 'all' = 'open') =>
      get<{ reports: OpenReport[]; openCount: number }>('/admin/reports', {
        params: { status },
      }),
    resolveReport: (reportId: string, action: 'uphold' | 'reject', note?: string) =>
      post<{ ok: boolean; action: string; resolved: number }>(
        `/admin/reports/${reportId}/resolve`,
        { action, ...(note ? { note } : {}) },
      ),
    restoreGame: (gameId: string) =>
      post<{ ok: boolean }>(`/admin/games/${gameId}/restore`),
  },

  users: {
    publicProfile: (handle: string) =>
      get<
        {
          userId: string;
          author: PublicAuthor;
          joinedAt: string;
          works: CommunityWorkSummary[];
        } & FollowCounts
      >(`/users/${encodeURIComponent(handle)}`),
    follow: (handle: string) =>
      post<{ ok: boolean } & FollowCounts>(
        `/users/${encodeURIComponent(handle)}/follow`,
      ),
    unfollow: (handle: string) =>
      del<{ ok: boolean } & FollowCounts>(`/users/${encodeURIComponent(handle)}/follow`),
    followers: (handle: string) =>
      get<{ followers: FollowedAuthor[]; following: FollowedAuthor[] }>(
        `/users/${encodeURIComponent(handle)}/followers`,
      ),
  },
  saves: {
    get: (deploymentId: string, slot: string) =>
      get<{ payload: unknown; found: boolean; updatedAt?: string }>(
        `/deployments/${deploymentId}/saves/${encodeURIComponent(slot)}`,
      ),
    put: (deploymentId: string, slot: string, payload: unknown) =>
      put<{ ok: boolean; id?: string; created?: boolean; updated?: boolean }>(
        `/deployments/${deploymentId}/saves/${encodeURIComponent(slot)}`,
        { payload },
      ),
    delete: (deploymentId: string, slot: string) =>
      del<{ ok: boolean }>(`/deployments/${deploymentId}/saves/${encodeURIComponent(slot)}`),
  },
  achievements: {
    award: (
      deploymentId: string,
      payload: {
        achievementKey: string;
        title: string;
        description?: string;
        iconUrl?: string;
        progress?: number;
      },
    ) =>
      post<{ ok: boolean; awarded: boolean; id?: string; progress?: number }>(
        `/deployments/${deploymentId}/achievements`,
        payload,
      ),
  },

  // P5 — public ecosystem APIs.
  ecosystem: {
    publicBench: (params?: { limit?: number; offset?: number }) =>
      get<{
        runs: Array<{
          id: string;
          projectId: string;
          publicLabel: string | null;
          scores: unknown;
          createdAt: string;
        }>;
        limit: number;
        offset: number;
      }>(`/public/bench`, { params }),
    publicBenchRun: (id: string) =>
      get<{
        id: string;
        label: string | null;
        status: string;
        scores: Record<string, unknown> | null;
        jobId: string | null;
        project: { id: string; name: string } | null;
        createdAt: string;
      }>(`/public/bench/runs/${encodeURIComponent(id)}`),
    publicEmbed: (slugOrId: string) =>
      get<{
        slug: string;
        title: string;
        thumbnail: string | null;
        embedUrl: string | null;
      }>(`/public/games/${slugOrId}/embed`),
    publicPlugins: (params?: { q?: string; limit?: number; offset?: number }) =>
      get<{
        plugins: Array<{
          id: string;
          slug: string;
          name: string;
          description: string | null;
          latestVersion: string | null;
          installCount: number;
          tags: unknown;
        }>;
        limit: number;
        offset: number;
      }>(`/public/plugins`, { params }),
    publicPlugin: (slug: string) =>
      get<{
        plugin: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          latestVersion: string | null;
          installCount: number;
          tags: unknown;
        };
        versions: Array<{
          id: string;
          version: string;
          publishedAt: string;
          manifest: unknown;
          sha256: string;
        }>;
      }>(`/public/plugins/${encodeURIComponent(slug)}`),
  },

  // P5 — billing quota/link helpers.
  billing: {
    plans: () =>
      get<{
        plans: Array<{ id: string; dailyJobs: number; maxConcurrent: number }>;
      }>(`/billing/plans`),
    quota: () =>
      get<{
        organizationId: string;
        plan: string;
        dailyJobLimit: number;
        maxConcurrentJobs: number;
        subscription: {
          stripeCustomerId: string | null;
          stripeSubscriptionId: string | null;
          stripePriceId: string | null;
          status: string;
          cancelAtPeriodEnd: boolean;
          currentPeriodEnd: string | null;
        } | null;
      }>(`/billing/quota`),
    link: (stripeCustomerId: string) =>
      post<{ ok: boolean }>(`/billing/link`, { stripeCustomerId }),

    catalog: () => get<BillingCatalog>('/public/billing/catalog'),
    wallet: () => get<WalletSummary>('/billing/wallet'),
    usage: () => get<UsageSummary>('/usage'),
    market: (gameId?: string) =>
      get<KaiMarket>(gameId ? `/billing/market?gameId=${encodeURIComponent(gameId)}` : '/billing/market'),
    adoptions: () =>
      get<{
        adoptions: Array<{
          id: string;
          gameId: string;
          agentKey: string;
          agentName: string;
          until: string;
        }>;
      }>('/billing/adoptions'),
    claimInvite: (handle: string) =>
      post<{ ok: boolean; invited?: number; inviter?: number; reason?: string }>(
        '/billing/invite',
        { handle },
      ),
    createOrder: (body: {
      sku: string;
      provider: string;
      channel?: string;
      openid?: string;
      returnUrl?: string;
    }) => post<CheckoutOrder>('/billing/orders', body),
    confirmStripe: (cs: string) =>
      get<{ status: string; orderId: string | null }>(
        `/billing/checkout/stripe?cs=${encodeURIComponent(cs)}`,
      ),
    order: (orderId: string) =>
      get<{
        orderId: string;
        status: string;
        sku: string;
        points: number;
        plan: string | null;
        amountCents: number;
        paidAt: string | null;
      }>(`/billing/orders/${orderId}`),
    /** Dev builds only; the API refuses this unless mock payments are enabled. */
    mockPay: (orderId: string) =>
      post<{ status: string }>(`/billing/orders/${orderId}/mock-pay`, {}),
    reconcile: (orderId: string) =>
      post<{
        status: string;
        hint?: string;
        orderId?: string;
      }>(`/billing/orders/${orderId}/reconcile`, {}),
  },

  // 社区
  community: {
    // 发布游戏
    publishGame: (data: {
      deploymentId: string;
      title: string;
      description?: string;
      thumbnail?: string;
      tags?: string[];
      category?: string;
      isPublic?: boolean;
      /** Remix policy this work is published under. */
      license?: CommunityLicense;
      /** Third-party origins allowed to frame it, beyond our own. */
      embedOrigins?: string[];
    }) =>
      post<{
        game: any;
        slug: string;
        alreadyPublished?: boolean;
      }>('/community/games/publish', data),

    // 获取游戏列表（kind 区分「可玩的游戏」与「可观察的世界」）
    getGames: (params?: {
      page?: number;
      pageSize?: number;
      category?: string;
      sort?: string;
      kind?: 'game' | 'world';
    }) => get<{
      games: any[];
      page: number;
      pageSize: number;
    }>('/community/games', { params }),

    // 获取游戏详情
    getGame: (slugOrId: string) => get<any>(`/community/games/${slugOrId}`),

    // 获取精选游戏
    getFeaturedGames: () => get<{ games: any[] }>('/community/games/featured'),

    /** Tonight alley charts: hottest / most remixed / still living. */
    alley: () =>
      get<{
        chinaDay: string;
        hottest: Array<{
          id: string;
          slug: string;
          title: string;
          thumbnail: string | null;
          category: string;
          playCount: number;
          remixCount: number;
        }>;
        remixed: Array<{
          id: string;
          slug: string;
          title: string;
          thumbnail: string | null;
          category: string;
          playCount: number;
          remixCount: number;
        }>;
        living: Array<{
          id: string;
          slug: string;
          title: string;
          thumbnail: string | null;
          category: string;
          playCount: number;
          remixCount: number;
          watcherCount?: number;
          lamp?: TownLamp | null;
          living?: boolean;
          speaking?: boolean;
          clockPaused?: boolean;
        }>;
        boards?: Array<{
          id: string;
          slug: string;
          title: string;
          thumbnail: string | null;
          category: string;
          playCount: number;
          remixCount: number;
          prompt: string;
          pool: number;
          status: string;
        }>;
      }>('/community/alley'),

    /** Recent spoken beats from published towns ("tonight in town"). */
    worldActivity: (limit = 16) =>
      get<{ items: WorldActivityItem[] }>(`/community/worlds/activity`, { params: { limit } }),

    courseTonight: (limit = 12) =>
      get<CourseTonightDiscovery>('/community/course-tonight', { params: { limit } }),

    // 提交评分
    submitRating: (gameId: string, rating: number) =>
      post<{ ok: boolean }>(`/community/games/${gameId}/rating`, { rating }),

    // 提交评论
    submitComment: (gameId: string, content: string, parentId?: string) =>
      post<{ comment: any }>(`/community/games/${gameId}/comments`, { content, parentId }),

    // 获取评论列表
    getComments: (gameId: string, params?: { page?: number; pageSize?: number }) =>
      get<{ comments: any[]; page: number; pageSize: number }>(`/community/games/${gameId}/comments`, { params }),

    likeComment: (commentId: string) =>
      post<{ liked: boolean; likesCount: number }>(
        `/community/comments/${commentId}/like`,
      ),
    unlikeComment: (commentId: string) =>
      del<{ liked: boolean; likesCount: number }>(
        `/community/comments/${commentId}/like`,
      ),
    /** Own comment, or any comment on your own work. */
    deleteComment: (commentId: string) =>
      del<{ ok: boolean }>(`/community/comments/${commentId}`),

    /** Flags a work or a comment for a curator to look at. */
    report: (payload: {
      targetKind: 'game' | 'comment';
      gameId?: string;
      commentId?: string;
      reason: ReportReason;
      detail?: string;
    }) => post<{ ok: boolean }>('/community/reports', payload),

    /** Authors worth following, for a reader whose feed is empty. */
    suggestedAuthors: () =>
      get<{ authors: Array<FollowedAuthor & { works: number }> }>(
        '/community/authors/suggested',
      ),

    // 提交分数
    submitScore: (gameId: string, score: number, playerName: string, metadata?: Record<string, any>) =>
      post<{ entry: any; rank: number }>(`/community/games/${gameId}/scores`, { score, playerName, metadata }),

    // 获取排行榜
    getLeaderboard: (gameId: string, limit?: number) =>
      get<{ leaderboard: any[] }>(`/community/games/${gameId}/leaderboard`, { params: { limit } }),

    // 获取所有标签
    getTags: () => get<{ tags: any[] }>('/community/tags'),

    /** Guest-safe play URL (no bearer token needed). */
    playUrl: (slugOrId: string) =>
      get<{ url: string; expiresIn: number | null; source: string }>(
        `/public/games/${slugOrId}/play-url`,
      ),
    societySnapshot: (gameId: string) =>
      get<{
        simTime?: number;
        events: Array<{
          id: string;
          simTime: number;
          kind: string;
          agentId?: string | null;
          payload: Record<string, unknown>;
          createdAtMs?: number;
        }>;
        agents: Array<{
          id: string;
          name: string;
          regionId: string;
          areaId?: string;
          areaName?: string;
          x: number;
          y: number;
          currentAction: string;
          identity: unknown;
        }>;
        relations: Array<{
          from: string;
          to: string;
          summary: string;
          affinity: number;
          kind?: string;
        }>;
        objects?: Array<{
          id: string;
          name: string;
          state: string;
          regionId?: string;
          kind?: string;
        }>;
        report?: EmergenceReportDto | null;
        living?: boolean;
        speaking?: boolean;
        clockPaused?: boolean;
        clock?: { kind?: string; shifts?: number };
        space?: unknown;
        presentation?: unknown;
        townTimeUntil?: string | null;
        presenceUntil?: string | null;
        lamp?: TownLamp | null;
        contributors?: TownContributor[];
        watcherCount?: number;
        talkBudget?: {
          used: number;
          cap: number;
          remaining: number;
          resetsAt: string;
          litBonus?: number;
          litUntil?: string | null;
        } | null;
      }>(`/community/games/${gameId}/society/snapshot`),
    societyStreamUrl: (gameId: string): string => {
      const base =
        typeof window !== 'undefined'
          ? import.meta.env.VITE_API_BASE_URL?.trim() || window.location.origin
          : import.meta.env.VITE_API_BASE_URL?.trim() ||
            'http://127.0.0.1:3847';
      return `${base.replace(/\/$/, '')}/v1/community/games/${gameId}/society/stream`;
    },
    presence: (gameId: string, body?: { leave?: boolean; tab?: string }) =>
      post<{
        ok: boolean;
        until?: string | null;
        paused?: boolean;
        throttled?: boolean;
        watcherCount?: number;
      }>(`/community/games/${gameId}/presence`, body ?? {}),
    embed: (slugOrId: string) =>
      get<{
        slug: string;
        title: string;
        thumbnail: string | null;
        embedUrl: string | null;
      }>(`/public/games/${slugOrId}/embed`),

    /** "I opened this" — feeds the played / watched list on the profile. */
    visit: (gameId: string) => post<{ ok: boolean }>(`/community/games/${gameId}/visit`),

    follow: (gameId: string) =>
      post<{ ok: boolean; following: boolean }>(`/community/games/${gameId}/follow`),
    unfollow: (gameId: string) =>
      del<{ ok: boolean; following: boolean }>(`/community/games/${gameId}/follow`),
    followState: (gameId: string) =>
      get<{ following: boolean; lastSeenSimTime: number | null }>(
        `/community/games/${gameId}/follow`,
      ),
    /** Mark the sim clock the follower has now watched up to. */
    markSeen: (gameId: string, simTime: number) =>
      post<{ ok: boolean; lastSeenSimTime: number }>(
        `/community/games/${gameId}/seen`,
        { simTime },
      ),

    /** Say one thing to a published town; the society reacts to it. */
    whisper: (
      gameId: string,
      text: string,
      agentKey?: string,
      paid?: boolean,
      hang?: { nodeId?: string; optionId?: string },
    ) =>
      post<{
        ok: boolean;
        whisperId: string | null;
        simTime: number | null;
        events: number;
        rumor: string | null;
        focusAgentId: string | null;
        degraded: boolean;
        paid?: boolean;
      }>(`/community/games/${gameId}/whisper`, {
        text,
        ...(agentKey ? { agentKey } : {}),
        ...(paid ? { paid: true } : {}),
        ...(hang?.nodeId ? { nodeId: hang.nodeId } : {}),
        ...(hang?.optionId ? { optionId: hang.optionId } : {}),
      }),
    course: (gameId: string, opts?: { ensure?: boolean }) =>
      get<CourseBoard>(
        `/community/games/${gameId}/course`,
        opts?.ensure ? { params: { ensure: 1 } } : undefined,
      ),
    stakeCourse: (gameId: string, optionId: string, points: number) =>
      post<{
        ok: boolean;
        balance: number;
        current: CourseView;
        history: CourseView[];
      }>(`/community/games/${gameId}/course/stake`, { optionId, points }),
    withdrawCourse: (gameId: string, nodeId?: string) =>
      post<{
        ok: boolean;
        balance: number;
        current: CourseView;
        history: CourseView[];
      }>(`/community/games/${gameId}/course/withdraw`, nodeId ? { nodeId } : {}),
    seedCourse: (gameId: string, body?: CourseSeedBody) =>
      post<CourseBoard>(`/community/games/${gameId}/course`, body ?? {}),
    courseStats: (gameId: string) =>
      get<CourseAuthorStats>(`/community/games/${gameId}/course/stats`),
    courseRecommend: (gameId: string, opts?: CourseRecommendQuery) => {
      const usePost = Boolean(
        opts?.prompt?.trim() && (opts?.options?.length ?? 0) >= 2,
      );
      if (usePost) {
        return post<CourseRecommendPreview>(
          `/community/games/${gameId}/course/recommend`,
          {
            kind: opts?.kind ?? 'custom',
            ...(opts?.prompt ? { prompt: opts.prompt } : {}),
            ...(opts?.options ? { options: opts.options } : {}),
            ...(opts?.agentKey ? { agentKey: opts.agentKey } : {}),
          },
        );
      }
      return get<CourseRecommendPreview>(
        `/community/games/${gameId}/course/recommend`,
        opts?.kind || opts?.agentKey
          ? {
              params: {
                ...(opts?.kind ? { kind: opts.kind } : {}),
                ...(opts?.agentKey ? { agentKey: opts.agentKey } : {}),
              },
            }
          : undefined,
      );
    },
    worldResidents: (projectId: string) =>
      get<{
        residents: Array<{ key: string; name: string }>;
        places?: Array<{ id: string; name: string }>;
        talks?: Array<{ who?: string; text: string; kind?: string }>;
        villagePack?: boolean;
      }>(`/projects/${projectId}/world/residents`),
    worldCourse: (projectId: string, opts?: { ensure?: boolean }) =>
      get<CourseBoard>(
        `/projects/${projectId}/world/course`,
        opts?.ensure ? { params: { ensure: 1 } } : undefined,
      ),
    seedWorldCourse: (projectId: string, body?: CourseSeedBody) =>
      post<CourseBoard>(`/projects/${projectId}/world/course`, body ?? {}),
    worldCourseStats: (projectId: string) =>
      get<CourseAuthorStats>(`/projects/${projectId}/world/course/stats`),
    worldCourseRecommend: (projectId: string, opts?: CourseRecommendQuery) => {
      const usePost = Boolean(
        opts?.prompt?.trim() && (opts?.options?.length ?? 0) >= 2,
      );
      if (usePost) {
        return post<CourseRecommendPreview>(
          `/projects/${projectId}/world/course/recommend`,
          {
            kind: opts?.kind ?? 'custom',
            ...(opts?.prompt ? { prompt: opts.prompt } : {}),
            ...(opts?.options ? { options: opts.options } : {}),
            ...(opts?.agentKey ? { agentKey: opts.agentKey } : {}),
          },
        );
      }
      return get<CourseRecommendPreview>(
        `/projects/${projectId}/world/course/recommend`,
        opts?.kind || opts?.agentKey
          ? {
              params: {
                ...(opts?.kind ? { kind: opts.kind } : {}),
                ...(opts?.agentKey ? { agentKey: opts.agentKey } : {}),
              },
            }
          : undefined,
      );
    },

    tip: (gameId: string, points: number, coupon = false) =>
      post<{
        ok: boolean;
        charged: number;
        authorPoints: number;
        balance?: number;
        coupon?: boolean;
        lightUntil?: string | null;
      }>(
        `/community/games/${gameId}/tip`,
        coupon ? { coupon: true } : { points },
      ),
    jiaxi: (gameId: string, cardId?: string, bundle?: 'run') =>
      post<{
        ok: boolean;
        card: JiaxiCard;
        cards?: JiaxiCard[];
        charged: number;
        authorPoints: number;
        quote?: { list: number; pay: number; reason: string | null };
        applied?: { effect: string; loopId: string | null };
        appliedAll?: Array<{ effect: string; loopId: string | null }>;
        bundle?: 'run';
        stackToday?: number;
      }>(
        `/community/games/${gameId}/jiaxi`,
        bundle ? { bundle } : { cardId },
      ),
    jiaxiConsume: (gameId: string) =>
      post<{ ok: true; transferId: string; already?: boolean }>(
        `/community/games/${gameId}/jiaxi/consume`,
        {},
      ),
    townTime: (gameId: string, sku: 'day' | 'week' | 'month') =>
      post<{
        ok: boolean;
        townTimeUntil?: string;
        charged: number;
        lamp?: TownLamp | null;
        contributors?: TownContributor[];
        watcherCount?: number;
      }>(`/community/games/${gameId}/town-time`, { sku }),
    worldLight: (gameId: string, sku: 'hour' | 'day' | 'week') =>
      post<{
        ok: boolean;
        charged: number;
        sku: 'hour' | 'day' | 'week';
        lightUntil?: string | null;
        lightBonusPerHour?: number;
        talkBudget?: {
          used: number;
          cap: number;
          remaining: number;
          resetsAt: string;
          litBonus?: number;
          litUntil?: string | null;
        } | null;
        contributors?: TownContributor[];
        watcherCount?: number;
      }>(`/community/games/${gameId}/world-light`, { sku }),
    buyEvent: (gameId: string, eventId: string) =>
      post<{
        ok: boolean;
        event: TownEventOffer;
        charged: number;
        hang?: { nodeId: string; optionId: string | null } | null;
      }>(`/community/games/${gameId}/events`, { eventId }),
    enterChallenge: (challengeId: string, gameId?: string) =>
      post<{ ok: boolean; already?: boolean; poolPoints?: number; charged?: number }>(
        `/community/challenges/${challengeId}/enter`,
        gameId ? { gameId } : {},
      ),
    runSandbox: (gameId: string, stimulus: string, contrast = true) =>
      post<{ ok: boolean; runId: string; report: SandboxReport; charged: number }>(
        `/community/games/${gameId}/sandbox`,
        { stimulus, contrast },
      ),
    listSandbox: (gameId: string) =>
      get<{
        runs: Array<{
          id: string;
          stimulus: string;
          contrast: boolean;
          report: SandboxReport;
          pointsPaid: number;
          createdAt: string;
        }>;
      }>(`/community/games/${gameId}/sandbox`),
    setCommerce: (
      gameId: string,
      payload: {
        jiaxiEnabled?: boolean;
        xiangyiEnabled?: boolean;
        jiaxiCost?: number;
        xiangyiCost?: number;
        eventMenu?: TownEventOffer[];
      },
    ) =>
      patch<{ ok: boolean; commerce: WorkCommerce }>(
        `/community/games/${gameId}/commerce`,
        payload,
      ),
    setOfficial: (gameId: string, official: boolean) =>
      patch<{ ok: boolean; isOfficial: boolean }>(`/community/games/${gameId}/official`, {
        official,
      }),
    offers: () =>
      get<{
        campaigns: KaiCampaign[];
        dailyLogin: number;
        dailyBonus: number;
        adopt: number;
      }>('/public/kai/offers'),
    residents: (gameId: string) =>
      get<{
        residents: Array<{ key: string; name: string }>;
        places?: Array<{ id: string; name: string }>;
        talks?: Array<{ who?: string; text: string; kind?: string }>;
        villagePack?: boolean;
        genreId?: string;
        packId?: string;
      }>(`/community/games/${gameId}/residents`),
    adoptions: (gameId: string) =>
      get<{
        adoptions: Array<{
          id: string;
          gameId: string;
          agentKey: string;
          agentName: string;
          until: string;
        }>;
      }>(`/community/games/${gameId}/adoptions`),
    adopt: (gameId: string, agentKey: string) =>
      post<{
        ok: boolean;
        agentKey: string;
        agentName: string;
        until: string;
        charged: number;
      }>(`/community/games/${gameId}/adopt`, { agentKey }),

    /** Public guestbook of whispers left in a town. */
    whispers: (gameId: string, limit = 20) =>
      get<{ whispers: WorldWhisper[] }>(
        `/community/games/${gameId}/whispers?limit=${limit}`,
      ),

    /**
     * Author-only: change the remix policy after publishing. Separate from the
     * publish call so an author can open a work up (or close it) without
     * republishing.
     */
    setLicense: (
      gameId: string,
      payload: { license?: CommunityLicense; watermark?: boolean; embedOrigins?: string[] },
    ) =>
      patch<{
        ok: boolean;
        license: CommunityLicense;
        watermark: boolean;
        embedOrigins: string[] | null;
      }>(`/community/games/${gameId}/license`, payload),

    /** Curator-only: put a work on the shelf, or take it off. */
    setFeatured: (gameId: string, featured: boolean) =>
      patch<{ ok: boolean; isFeatured: boolean }>(
        `/community/games/${gameId}/featured`,
        { featured },
      ),

    currentChallenge: () =>
      get<{
        challenge: {
          id: string;
          slug: string;
          title: string;
          prompt: string;
          startsAt: string;
          endsAt: string;
          entryPoints?: number;
          poolPoints?: number;
        } | null;
      }>('/public/challenges/current'),
  },

  templates: {
    list: () =>
      get<{
        templates: Array<{
          id: string;
          slug: string;
          name: string | null;
          description: string | null;
          pricePoints: number;
          version: string;
        }>;
      }>('/public/templates'),
    purchase: (slug: string) =>
      post<{ ok: boolean; owned: boolean; pointsPaid: number }>(
        `/templates/${slug}/purchase`,
        {},
      ),
    catalog: (channel: 'official' | 'community' | 'all' = 'official') =>
      get<{
        channel: string;
        templates: Array<{
          id: string;
          slug: string;
          name: string | null;
          description: string | null;
          version: string;
          official?: boolean;
          pricePoints: number;
        }>;
      }>(`/templates?channel=${channel}`),
    apply: (slug: string, projectId: string, version?: string) =>
      post<{
        ok: boolean;
        projectId: string;
        templateId: string;
        slug?: string;
        version?: string;
        takesEffectOnEmptyWorkspace?: boolean;
      }>(`/templates/${slug}/apply`, {
        projectId,
        ...(version ? { version } : {}),
      }),
    entitlements: () =>
      get<{ entitlements: Array<{ templateId: string; pointsPaid: number }> }>(
        '/templates/entitlements',
      ),
  },
};

export { TOKEN_KEY };
