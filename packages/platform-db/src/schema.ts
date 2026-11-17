/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Null for accounts created through WeChat, which never gives us an email. */
  email: text('email').unique(),
  /** WeChat Official Account openid — the identity a China sign-in arrives as. */
  wechatOpenid: text('wechat_openid'),
  /** Stable across the same WeChat Open Platform account; prefer it when present. */
  wechatUnionid: text('wechat_unionid'),
  phone: text('phone'),
  /** Public page address (`/u/:handle`). Null until the author picks one. */
  handle: text('handle').unique(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  bio: text('bio'),
  /** Soft delete so published works can survive an account closing. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  /** Year only — enough for the publish age gate, not a birthday. */
  birthYear: integer('birth_year'),
  /** When the user last accepted terms + privacy. */
  acceptedLegalAt: timestamp('accepted_legal_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const organizationMembers = pgTable(
  'organization_members',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /**
   * Legacy: was the hard archetype that the worker keyed on. Since P0 the
   * runtime is template-free; this column survives only as a free-form
   * user-visible tag and MUST NOT be used to gate scaffolding.
   */
  archetype: text('archetype').notNull().default('platformer'),
  templateVersion: text('template_version'),
  /**
   * When set, the next generate archives the local workspace (if S3 archive
   * is on), replaces source with the pinned template, then clears this stamp.
   * Deployments / preview URLs are not touched.
   */
  rescaffoldRequestedAt: timestamp('rescaffold_requested_at', { withTimezone: true }),
  /** Pin to a specific @opengame/runtime version for reproducible builds. */
  runtimeVersion: text('runtime_version'),
  /** Source project when this one was created via Remix/Fork. */
  parentProjectId: uuid('parent_project_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const chatSessions = pgTable('chat_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  /** Source session when this one was created via a fork action. */
  parentId: uuid('parent_id'),
  title: text('title'),
  /** Rolling LLM/heuristic summary for long conversations (Context L3). */
  summary: text('summary'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Structured "perfect game" requirements for a project (Context L2). */
export const projectBriefs = pgTable(
  'project_briefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    briefJson: jsonb('brief_json').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('project_briefs_project_version_uq').on(t.projectId, t.version)],
);

/** Long-term memory facts (project / user scope). */
export const projectMemories = pgTable('project_memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  /** project | user | negative */
  scope: text('scope').notNull().default('project'),
  fact: text('fact').notNull(),
  sourceJobId: uuid('source_job_id').references(() => jobs.id, {
    onDelete: 'set null',
  }),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Optional audit of context layers injected per job. */
export const contextSnapshots = pgTable('context_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  layer: text('layer').notNull(),
  contentJson: jsonb('content_json'),
  charCount: integer('char_count'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Organization-level user preferences (global memory). */
export const organizationPreferences = pgTable('organization_preferences', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  preferencesJson: jsonb('preferences_json').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** RAG document chunks (keyword + optional embedding for Phase R2). */
export const ragDocumentChunks = pgTable(
  'rag_document_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collection: text('collection').notNull(),
    sourcePath: text('source_path').notNull(),
    archetype: text('archetype'),
    title: text('title'),
    content: text('content').notNull(),
    /** Optional embedding vector stored as JSON number[] when pgvector unavailable. */
    embedding: jsonb('embedding'),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('rag_chunks_collection_path_uq').on(t.collection, t.sourcePath)],
);

/** User feedback on jobs (Curator / satisfaction loop). */
export const jobFeedback = pgTable('job_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  rating: integer('rating'),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').references(() => chatSessions.id, {
    onDelete: 'set null',
  }),
  type: text('type').notNull(),
  status: text('status').notNull().default('queued'),
  payload: jsonb('payload'),
  result: jsonb('result'), // 用于存储任务结果，如代码变更等
  logKey: text('log_key'),
  traceId: text('trace_id'),
  retryCount: integer('retry_count').notNull().default(0),
  buildCacheKey: text('build_cache_key'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  storagePrefix: text('storage_prefix').notNull(),
  manifest: jsonb('manifest'),
  contentHash: text('content_hash'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const deployments = pgTable('deployments', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  artifactId: uuid('artifact_id').references(() => artifacts.id, {
    onDelete: 'set null',
  }),
  channel: text('channel').notNull().default('preview'),
  previewUrl: text('preview_url'),
  productionUrl: text('production_url'),
  /** CDN-fronted absolute URL (e.g. https://cdn.opengame.app/proj/xxx/index.html). */
  cdnUrl: text('cdn_url'),
  customDomain: text('custom_domain'),
  customDomainVerified: boolean('custom_domain_verified').notNull().default(false),
  acmeChallengeName: text('acme_challenge_name'),
  acmeChallengeValue: text('acme_challenge_value'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const usageEvents = pgTable('usage_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  modality: text('modality').notNull(),
  units: numeric('units').notNull().default('1'),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** `wechat` | `alipay` | `stripe`. Stripe stays for a later overseas release. */
  provider: text('provider').notNull().default('stripe'),
  providerCustomerId: text('provider_customer_id'),
  providerSubscriptionId: text('provider_subscription_id'),
  /** Points granted at the start of each paid period; null → plan default. */
  monthlyPoints: integer('monthly_points'),
  /** Period key already granted, so a redelivered webhook cannot double-grant. */
  pointsGrantedFor: text('points_granted_for'),
  stripeCustomerId: text('stripe_customer_id'),
  /** Stripe Subscription resource id (sub_...) when plan is paid. */
  stripeSubscriptionId: text('stripe_subscription_id'),
  /** Stripe Price id (price_...) currently in effect. */
  stripePriceId: text('stripe_price_id'),
  plan: text('plan').notNull().default('free'),
  status: text('status').notNull().default('active'),
  /** Free-form daily job override; null → use env default for the plan. */
  dailyJobLimitOverride: integer('daily_job_limit_override'),
  /** Free-form concurrency override; null → use env default for the plan. */
  maxConcurrentJobsOverride: integer('max_concurrent_jobs_override'),
  /** When the current paid period ends (mirror of Stripe). */
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('editor'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const templatePackages = pgTable(
  'template_packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    version: text('version').notNull(),
    storageKey: text('storage_key').notNull(),
    manifest: jsonb('manifest'),
    name: text('name'),
    description: text('description'),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    authorUserId: uuid('author_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    isPublic: boolean('is_public').notNull().default(true),
    pricePoints: integer('price_points').notNull().default(0),
    revenuePoints: integer('revenue_points').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('template_packages_slug_version_uq').on(t.slug, t.version),
  ],
);

export const templateEntitlements = pgTable(
  'template_entitlements',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templatePackages.id, { onDelete: 'cascade' }),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    pointsPaid: integer('points_paid').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.templateId] })],
);

export const weeklyChallenges = pgTable('weekly_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  constraintJson: jsonb('constraint_json'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  entryPoints: integer('entry_points').notNull().default(10),
  poolPoints: integer('pool_points').notNull().default(0),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const benchRuns = pgTable('bench_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('queued'),
  scores: jsonb('scores'),
  /** When true, this run is visible on the public bench leaderboard. */
  isPublic: boolean('is_public').notNull().default(false),
  /** Short label shown on the public leaderboard (e.g. "Flappy v3"). */
  publicLabel: text('public_label'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * P5: Plugin marketplace — user-uploaded `@opengame/runtime` extensions.
 * A plugin = a versioned tarball + JSON manifest declaring exported behaviors,
 * skill kinds, UI kits, etc. Owners can publish/unpublish; tags drive search.
 */
export const pluginPackages = pgTable(
  'plugin_packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human-readable slug e.g. "rpg-dialogue". */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Org that owns publishing rights for this slug. */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Latest published version (semver). null until first publish. */
    latestVersion: text('latest_version'),
    /** Free-form tags for discovery. */
    tags: jsonb('tags'),
    isPublic: boolean('is_public').notNull().default(true),
    /** Cumulative installs across all versions, denormalized for sort. */
    installCount: integer('install_count').notNull().default(0),
    /**
     * Price in generation points; 0 means free. Points rather than money
     * because the buyer already holds them and the author already has a wallet,
     * so a sale is one ledger transfer instead of a second payment provider.
     */
    pricePoints: integer('price_points').notNull().default(0),
    /** Lifetime points earned from sales, denormalized for the author's page. */
    revenuePoints: integer('revenue_points').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('plugin_packages_slug_uq').on(t.slug)],
);

/**
 * What an organisation has bought. Scoped to the org, not the buyer, so a
 * studio pays once and everyone in it can use the plugin.
 */
export const pluginEntitlements = pgTable(
  'plugin_entitlements',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    pluginId: uuid('plugin_id')
      .notNull()
      .references(() => pluginPackages.id, { onDelete: 'cascade' }),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    pointsPaid: integer('points_paid').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.pluginId] })],
);

/**
 * P5: Public ecosystem API keys. An org can mint multiple keys; each one is
 * scoped by `scopes` (e.g. `["embed:read","leaderboard:write"]`). We store
 * only a sha256 of the raw secret so leaks can't be replayed from a DB dump —
 * the raw key is shown to the user **once** at create time.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Public prefix shown to humans, e.g. `og_pk_<id>`. Indexed for O(1) lookups. */
    keyPrefix: text('key_prefix').notNull(),
    /** sha256(rawKey). Compared with timingSafeEqual against the request header. */
    keyHash: text('key_hash').notNull(),
    /** JSON array of scope strings. */
    scopes: jsonb('scopes'),
    /** Token-bucket rate limit per minute; null → use plan default. */
    rateLimitPerMinute: integer('rate_limit_per_minute'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('api_keys_prefix_uq').on(t.keyPrefix),
  ],
);

export const pluginVersions = pgTable(
  'plugin_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pluginId: uuid('plugin_id')
      .notNull()
      .references(() => pluginPackages.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    /** S3 key of the published tarball. */
    storageKey: text('storage_key').notNull(),
    /** Parsed package.json + capability declarations. */
    manifest: jsonb('manifest'),
    /** SHA-256 of the tarball (integrity check). */
    sha256: text('sha256').notNull(),
    /** Minimum supported `@opengame/runtime` version (semver range). */
    runtimePeerRange: text('runtime_peer_range'),
    publishedAt: timestamp('published_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('plugin_versions_plugin_version_uq').on(t.pluginId, t.version)],
);

// ============================================
// 社区相关表
// ============================================

/**
 * 游戏评分表
 */
export const gameRatings = pgTable('game_ratings', {
  id: uuid('id').primaryKey().defaultRandom(),
  deploymentId: uuid('deployment_id')
    .notNull()
    .references(() => deployments.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(), // 1-5 分
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  uniqueIndex('game_ratings_deployment_user_uq').on(t.deploymentId, t.userId),
]);

/**
 * 游戏评论表
 */
export const gameComments = pgTable('game_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  deploymentId: uuid('deployment_id')
    .notNull()
    .references(() => deployments.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  /** Self-reference: a reply in this work's thread. Null for a top-level post. */
  parentId: uuid('parent_id'),
  likesCount: integer('likes_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One like per person per comment. The denormalized `likes_count` above is what
 * lists read; this table is what makes the button idempotent and lets a reader
 * see which comments they already liked.
 */
export const commentLikes = pgTable(
  'comment_likes',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => gameComments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })],
);

/**
 * 游戏标签表
 */
export const gameTags = pgTable('game_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  color: text('color'), // 标签颜色
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 游戏-标签关联表
 */
export const gameTagMappings = pgTable(
  'game_tag_mappings',
  {
    deploymentId: uuid('deployment_id')
      .notNull()
      .references(() => deployments.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => gameTags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.deploymentId, t.tagId] }),
  ],
);

/**
 * 游戏分数排行榜
 */
export const gameLeaderboards = pgTable('game_leaderboards', {
  id: uuid('id').primaryKey().defaultRandom(),
  deploymentId: uuid('deployment_id')
    .notNull()
    .references(() => deployments.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  playerName: text('player_name').notNull(),
  score: integer('score').notNull(),
  metadata: jsonb('metadata'), // 额外信息如等级、通关时间等
  achievedAt: timestamp('achieved_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 社区游戏发布信息（扩展 deployments 表，提供社区展示所需的信息）
 */
export const communityGames = pgTable('community_games', {
  id: uuid('id').primaryKey().defaultRandom(),
  deploymentId: uuid('deployment_id')
    .notNull()
    .unique()
    .references(() => deployments.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(), // 用于 URL
  description: text('description'),
  thumbnail: text('thumbnail'), // 缩略图 URL
  category: text('category').notNull().default('other'), // arcade, puzzle, action, strategy, rpg, other
  isPublic: boolean('is_public').notNull().default(true),
  isFeatured: boolean('is_featured').notNull().default(false),
  playCount: integer('play_count').notNull().default(0),
  /**
   * Remix policy the author published under. `remix-ok` keeps the growth loop
   * open, `remix-credit` requires visible attribution, `no-remix` refuses forks
   * outright. The fork endpoint is the enforcement point.
   */
  license: text('license').notNull().default('remix-ok'),
  /** Origins allowed to frame this work; null means our own origins only. */
  embedOrigins: jsonb('embed_origins'),
  remixCount: integer('remix_count').notNull().default(0),
  /** Visible "OpenGame · author" corner mark; paid plans may turn it off. */
  watermark: boolean('watermark').notNull().default(true),
  /** Why a curator hid this work. Null while it is in good standing. */
  takedownReason: text('takedown_reason'),
  takenDownAt: timestamp('taken_down_at', { withTimezone: true }),
  /** Structural hash used to pair a report against a suspected copy. */
  fingerprint: text('fingerprint'),
  /** Weekly challenge this work was submitted into, if any. */
  challengeId: uuid('challenge_id'),
  /** Visitors may throw a 加戏 card into a hosted play session. */
  jiaxiEnabled: boolean('jiaxi_enabled').notNull().default(true),
  /** Visitors may buy a weighted 巷议 whisper. */
  xiangyiEnabled: boolean('xiangyi_enabled').notNull().default(true),
  /** Official demonstration town / featured seed work. */
  isOfficial: boolean('is_official').notNull().default(false),
  jiaxiCost: integer('jiaxi_cost').notNull().default(8),
  xiangyiCost: integer('xiangyi_cost').notNull().default(6),
  /** Author-priced town events the visitor can buy. */
  eventMenu: jsonb('event_menu').notNull().default([]),
  /** MechanicSpec snapshot so 加戏 cards follow this work's loops. */
  mechanicJson: jsonb('mechanic_json'),
  publishedAt: timestamp('published_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * China-day heat for the alley board. Lifetime play_count / remix_count stay
 * on community_games; this table answers "今晚" without lying.
 */
export const communityDayStats = pgTable(
  'community_day_stats',
  {
    gameId: uuid('game_id')
      .notNull()
      .references(() => communityGames.id, { onDelete: 'cascade' }),
    chinaDay: text('china_day').notNull(),
    plays: integer('plays').notNull().default(0),
    remixes: integer('remixes').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.chinaDay] })],
);

export const challengeEntries = pgTable(
  'challenge_entries',
  {
    challengeId: uuid('challenge_id')
      .notNull()
      .references(() => weeklyChallenges.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    communityGameId: uuid('community_game_id').references(() => communityGames.id, {
      onDelete: 'set null',
    }),
    pointsPaid: integer('points_paid').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.challengeId, t.organizationId] })],
);

export type CommunityGameLicense = 'remix-ok' | 'remix-credit' | 'no-remix';

/**
 * Reports from readers. Hosting other people's work only works if there is a
 * route from "this is stolen" to a decision — and a record of who decided.
 */
export const contentReports = pgTable('content_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetKind: text('target_kind').notNull(),
  communityGameId: uuid('community_game_id').references(() => communityGames.id, {
    onDelete: 'cascade',
  }),
  commentId: uuid('comment_id').references(() => gameComments.id, {
    onDelete: 'cascade',
  }),
  /** Null once the reporter deletes their account; the report survives. */
  reporterUserId: uuid('reporter_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  reason: text('reason').notNull(),
  detail: text('detail'),
  status: text('status').notNull().default('open'),
  resolution: text('resolution'),
  resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ReportTargetKind = 'game' | 'comment';
export type ReportReason = 'stolen' | 'nsfw' | 'illegal' | 'broken' | 'spam' | 'other';
export type ReportStatus = 'open' | 'upheld' | 'rejected';

/**
 * Author appeal after a takedown. Terms promise a reversible path; this is it.
 */
export const contentAppeals = pgTable('content_appeals', {
  id: uuid('id').primaryKey().defaultRandom(),
  communityGameId: uuid('community_game_id')
    .notNull()
    .references(() => communityGames.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  message: text('message').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Audit trail for hosted playback. The play token is signed and stateless, so
 * this table exists for the things a token cannot do: revoke a session, count
 * how many are open on one work, and trace a leaked bundle to who was served.
 */
export const playSessions = pgTable(
  'play_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityGameId: uuid('community_game_id').references(() => communityGames.id, {
      onDelete: 'cascade',
    }),
    deploymentId: uuid('deployment_id')
      .notNull()
      .references(() => deployments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** SHA-256 of user agent + IP prefix. Never the raw address. */
    clientFingerprint: text('client_fingerprint').notNull(),
    refererOrigin: text('referer_origin'),
    revoked: boolean('revoked').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_play_sessions_game').on(t.communityGameId, t.createdAt),
    index('idx_play_sessions_expiry').on(t.expiresAt),
  ],
);

// ============================================
// P0+ 工作流增量表（Agent 编排 / 资产 / 玩家 / Remix / Runtime 版本）
// ============================================

/**
 * Agent 思维链与工具调用事件。worker 在 generate job 的 PLAN→CODE→BUILD→QA→FIX
 * 状态机里每一步写入一条；platform-api 通过 SSE 转发给 IDE 渲染。
 */
export const agentEvents = pgTable(
  'agent_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => chatSessions.id, {
      onDelete: 'set null',
    }),
    /** Strictly small set: planner / coder / artist / qa / fixer / system */
    role: text('role').notNull(),
    /** Strictly small set: PLAN / CODE / ASSET / BUILD / QA / FIX / DONE */
    phase: text('phase').notNull(),
    /** Tool invoked (if any); null for free-form thoughts. */
    tool: text('tool'),
    /** Stream chunk index inside this phase. */
    seq: integer('seq').notNull().default(0),
    /** Short, human-readable summary. Full bodies live in `details`. */
    summary: text('summary'),
    /** Structured payload — args/outputs/diff stats/cost/etc. */
    details: jsonb('details'),
    /** Elapsed milliseconds for *this* event. */
    elapsedMs: integer('elapsed_ms'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('agent_events_job_seq_uq').on(t.jobId, t.role, t.seq, t.phase)],
);

/**
 * 多模态生成产物登记表（图/音/视频/音乐）。Worker 在 generate job 内由 Artist
 * 角色写入；IDE 的资产画廊页面消费。
 */
export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  modality: text('modality').notNull(), // image | audio | video | music | speech
  prompt: text('prompt'),
  storageKey: text('storage_key').notNull(),
  thumbnailKey: text('thumbnail_key'),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  /** Per-provider id (for re-fetch, license tracking). */
  externalId: text('external_id'),
  licenseTag: text('license_tag'),
  costUnits: numeric('cost_units'),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 玩家存档（绑定到一个 deployment + 用户/匿名 slot）。@opengame/runtime 的
 * SaveStore 远程 adapter 调用 BFF 落到本表。
 */
export const playerSaves = pgTable(
  'player_saves',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deploymentId: uuid('deployment_id')
      .notNull()
      .references(() => deployments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Free-form slot key chosen by the game (e.g. `default`, `slot1`). */
    slot: text('slot').notNull(),
    payload: jsonb('payload').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('player_saves_deployment_user_slot_uq').on(t.deploymentId, t.userId, t.slot)],
);

/**
 * 跨游戏成就。游戏通过 SDK 触发；Player Profile 页面汇总。
 */
export const achievements = pgTable(
  'achievements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deploymentId: uuid('deployment_id').references(() => deployments.id, {
      onDelete: 'set null',
    }),
    /** Stable string id from the game (e.g. `first_win`, `combo_10`). */
    achievementKey: text('achievement_key').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    iconUrl: text('icon_url'),
    /** Monotonic increment for stackable achievements. */
    progress: integer('progress').notNull().default(1),
    awardedAt: timestamp('awarded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('achievements_user_deployment_key_uq').on(
      t.userId,
      t.deploymentId,
      t.achievementKey,
    ),
  ],
);

/**
 * @opengame/runtime 已发布版本登记，供 worker 决定 skeleton 注入哪个版本与
 * 兼容性回滚。
 */
export const runtimeVersions = pgTable(
  'runtime_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: text('version').notNull().unique(),
    /** npm tag (e.g. `latest`, `next`, `0.1.x`). */
    channel: text('channel').notNull().default('latest'),
    packageSpec: text('package_spec').notNull(),
    /** JSON manifest with feature flags / breaking-changes notes. */
    manifest: jsonb('manifest'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/**
 * Remix/Fork 关系表。`projects.parent_project_id` 保留对父项目的直接引用，
 * 本表则记录 fork 行为本身（消息、时间、是否衍生再衍生）。
 */
export const projectRemixes = pgTable('project_remixes', {
  id: uuid('id').primaryKey().defaultRandom(),
  childProjectId: uuid('child_project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  parentProjectId: uuid('parent_project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  /** Optional: link to a specific deployment that was forked. */
  sourceDeploymentId: uuid('source_deployment_id').references(
    () => deployments.id,
    { onDelete: 'set null' },
  ),
  forkedByUserId: uuid('forked_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Following a person rather than one of their works. A published game is
 * finished; the author keeps making things, and that is the subscription that
 * brings someone back next week.
 */
export const userFollows = pgTable(
  'user_follows',
  {
    followerUserId: uuid('follower_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followeeUserId: uuid('followee_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.followerUserId, t.followeeUserId] })],
);

/**
 * 用户关注的游戏（用于推荐）
 */
export const userFollowedGames = pgTable(
  'user_followed_games',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deploymentId: uuid('deployment_id')
      .notNull()
      .references(() => deployments.id, { onDelete: 'cascade' }),
    /**
     * Sim clock the follower last watched. The gap against the world's current
     * sim time is the only honest "another day went by" signal we have.
     */
    lastSeenSimTime: numeric('last_seen_sim_time'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.deploymentId] }),
  ],
);

/**
 * What a signed-in visitor opened in Community. Community games rarely write
 * save slots, so this is what makes "played and watched" a real list.
 */
export const userPlayHistory = pgTable(
  'user_play_history',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deploymentId: uuid('deployment_id')
      .notNull()
      .references(() => deployments.id, { onDelete: 'cascade' }),
    playCount: integer('play_count').notNull().default(1),
    lastPlayedAt: timestamp('last_played_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deploymentId] })],
);

/**
 * A whisper a visitor left in someone else's published town. The society itself
 * already records the intervention in `society_events`; this table is the
 * attributed, public-readable guestbook ("what got said to this town tonight"),
 * which an event stream keyed by agent cannot answer.
 */
export const worldWhispers = pgTable('world_whispers', {
  id: uuid('id').primaryKey().defaultRandom(),
  worldId: uuid('world_id')
    .notNull()
    .references(() => worlds.id, { onDelete: 'cascade' }),
  /** Published artifact the whisper was left through (community read key). */
  deploymentId: uuid('deployment_id')
    .notNull()
    .references(() => deployments.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Resident the whisper was aimed at; null means "anyone who hears it". */
  agentKey: text('agent_key'),
  text: text('text').notNull(),
  /** Sim clock when the town heard it. */
  simTime: numeric('sim_time'),
  /** Paid 巷议 carries more weight than a free street aside. */
  paid: boolean('paid').notNull().default(false),
  weight: integer('weight').notNull().default(1),
  /** Optional 走向盘 the whisper was hung on. Never changes the oracle. */
  courseNodeId: uuid('course_node_id'),
  courseOptionId: uuid('course_option_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Persistent world-model document per project (SSOT pointer). */
export const worlds = pgTable('worlds', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  /** Current tip revision number. */
  tipRevision: integer('tip_revision').notNull().default(1),
  /** Full World Spec JSON (tip). */
  specJson: jsonb('spec_json').notNull(),
  memoryJson: jsonb('memory_json').notNull().default([]),
  /** Persistent opt-in: the worker advances this world with no viewer present. */
  heartbeatEnabled: boolean('heartbeat_enabled').notNull().default(false),
  /** Short presence lease — someone is on the page. Not a 镇时 permit. */
  heartbeatUntil: timestamp('heartbeat_until', { withTimezone: true }),
  /** Paid 镇时 window: model talks only while also present. */
  townTimeUntil: timestamp('town_time_until', { withTimezone: true }),
  /** Paid 点亮世界: extra hourly talks for this town only. */
  lightUntil: timestamp('light_until', { withTimezone: true }),
  lightBonusPerHour: integer('light_bonus_per_hour').notNull().default(0),
  /** Author observatory is open — talks without buying 镇时. */
  authorWatchUntil: timestamp('author_watch_until', { withTimezone: true }),
  /** Author paused the shared clock; visitors must not restart it. */
  clockPaused: boolean('clock_paused').notNull().default(false),
  /**
   * Per-world opinion layer. Global demo env still overrides this.
   * Default off so paid towns keep the old walk/talk loop.
   */
  mindEnabled: boolean('mind_enabled').notNull().default(false),
  /** classic keeps the walk/talk loop. deep runs the open cognitive loop. */
  cognition: text('cognition').notNull().default('classic'),
  /** Author chose to show violent outcomes outside the project. */
  violencePublic: boolean('violence_public').notNull().default(false),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Immutable world revision history (edit ops / rollback). */
export const worldRevisions = pgTable(
  'world_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    parentRevision: integer('parent_revision'),
    opJson: jsonb('op_json'),
    specJson: jsonb('spec_json').notNull(),
    summary: text('summary'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('world_revisions_world_rev_uq').on(t.worldId, t.revision),
  ],
);

/** Optional chunked spatial data (future 3D / large maps). */
/**
 * Reserved for future region/chunk memory retrieval (vector or structured).
 * Not read/written by apps yet — do not assume product memory uses this table.
 */
export const worldChunks = pgTable(
  'world_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    regionId: text('region_id').notNull(),
    chunkKey: text('chunk_key').notNull(),
    dataJson: jsonb('data_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('world_chunks_region_key_uq').on(
      t.worldId,
      t.regionId,
      t.chunkKey,
    ),
  ],
);

/** Simulation checkpoints for replay / resume. */
export const simCheckpoints = pgTable('sim_checkpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  worldId: uuid('world_id')
    .notNull()
    .references(() => worlds.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  timeHours: numeric('time_hours').notNull(),
  eventsJson: jsonb('events_json').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Generative-agent society: per-NPC runtime identity / pose. */
export const worldAgents = pgTable(
  'world_agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    agentKey: text('agent_key').notNull(),
    name: text('name').notNull(),
    identityJson: jsonb('identity_json').notNull().default({}),
    regionId: text('region_id').notNull(),
    x: numeric('x').notNull().default('0'),
    y: numeric('y').notNull().default('0'),
    currentAction: text('current_action').notNull().default('idle'),
    /** Drives (hunger/energy/social/curiosity) — must survive live hydrates. */
    needsJson: jsonb('needs_json').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('world_agents_world_key_uq').on(t.worldId, t.agentKey),
  ],
);

/** Per-agent memory stream (Generative Agents). */
export const agentMemories = pgTable(
  'agent_memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    agentKey: text('agent_key').notNull(),
    /** Stable sim id (evt_… / seed_…) so reflection pointers survive persist. */
    memoryKey: text('memory_key').notNull(),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    simTime: numeric('sim_time').notNull(),
    importance: integer('importance').notNull().default(3),
    embedding: jsonb('embedding'),
    lastAccessSimTime: numeric('last_access_sim_time').notNull(),
    pointersJson: jsonb('pointers_json').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('agent_memories_world_agent_idx').on(t.worldId, t.agentKey),
    uniqueIndex('agent_memories_world_key_uq').on(t.worldId, t.memoryKey),
  ],
);

/** Day plans per agent. */
export const agentPlans = pgTable(
  'agent_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    agentKey: text('agent_key').notNull(),
    dayIndex: integer('day_index').notNull(),
    segmentsJson: jsonb('segments_json').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('agent_plans_world_agent_day_uq').on(
      t.worldId,
      t.agentKey,
      t.dayIndex,
    ),
  ],
);

/** Replayable society event stream. */
export const societyEvents = pgTable(
  'society_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    eventKey: text('event_key').notNull(),
    simTime: numeric('sim_time').notNull(),
    kind: text('kind').notNull(),
    agentKey: text('agent_key'),
    payloadJson: jsonb('payload_json').notNull().default({}),
    invalidated: integer('invalidated').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('society_events_world_time_idx').on(t.worldId, t.simTime),
    uniqueIndex('society_events_world_key_uq').on(t.worldId, t.eventKey),
  ],
);

/** Agent-agent relationship summaries. */
export const agentRelations = pgTable(
  'agent_relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    fromAgentKey: text('from_agent_key').notNull(),
    toAgentKey: text('to_agent_key').notNull(),
    summary: text('summary').notNull().default(''),
    affinity: numeric('affinity').notNull().default('0'),
    lastInteractSimTime: numeric('last_interact_sim_time'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('agent_relations_pair_uq').on(
      t.worldId,
      t.fromAgentKey,
      t.toAgentKey,
    ),
  ],
);

/**
 * Generation credit, in whole points, per organisation. Only ever moved by a
 * conditional UPDATE (`balance >= cost`) so two jobs racing for the last point
 * cannot both win.
 */
export const wallets = pgTable('wallets', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** 开镇礼 — 生成、加戏、镇时都从这一栏出。 */
  balance: integer('balance').notNull().default(0),
  lifetimeEarned: integer('lifetime_earned').notNull().default(0),
  lifetimeSpent: integer('lifetime_spent').notNull().default(0),
  welcomeGranted: boolean('welcome_granted').notNull().default(false),
  loginStreak: integer('login_streak').notNull().default(0),
  lastLoginDay: date('last_login_day'),
  firstTopupGranted: boolean('first_topup_granted').notNull().default(false),
  invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  inviteClaimed: boolean('invite_claimed').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A purchase at any provider. WeChat JSAPI, WeChat MWEB and Alipay WAP differ
 * only in `channel` and in the `prepay` blob the client needs; settlement and
 * crediting are shared.
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** `wechat` | `alipay` | `stripe`. */
    provider: text('provider').notNull(),
    /** `jsapi` | `mweb` | `native` | `wap`. */
    channel: text('channel').notNull(),
    /** Our id at the provider; unique so a redelivered notify cannot double-credit. */
    outTradeNo: text('out_trade_no').notNull().unique(),
    transactionId: text('transaction_id'),
    sku: text('sku').notNull(),
    /** `points` | `subscription`. */
    kind: text('kind').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('CNY'),
    points: integer('points').notNull().default(0),
    plan: text('plan'),
    /** `created` | `paid` | `failed` | `closed` | `refunded`. */
    status: text('status').notNull().default('created'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    prepay: jsonb('prepay'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_orders_org').on(t.organizationId, t.createdAt),
    index('idx_orders_status').on(t.status, t.createdAt),
  ],
);

/**
 * Append-only history of every point movement. Corrections are new `adjust`
 * rows rather than edits — this is what a creator reads on the wallet screen
 * and what a royalty dispute is settled from.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /**
     * `topup` | `grant` | `spend` | `refund` | `royalty` | `tip` | `purchase` |
     * `sale` | `adjust` | `course_stake` | `course_payout` | `course_void` |
     * `course_rake`.
     */
    kind: text('kind').notNull(),
    /** Signed: negative for spends. */
    points: integer('points').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    /** For royalties: the wallet the points came from. */
    sourceOrganizationId: uuid('source_organization_id').references(
      () => organizations.id,
      { onDelete: 'set null' },
    ),
    communityGameId: uuid('community_game_id').references(() => communityGames.id, {
      onDelete: 'set null',
    }),
    /** For marketplace purchases and sales. */
    pluginId: uuid('plugin_id').references(() => pluginPackages.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_ledger_org').on(t.organizationId, t.createdAt),
    index('idx_ledger_job').on(t.jobId),
  ],
);

export const kaiTransfers = pgTable(
  'kai_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityGameId: uuid('community_game_id').references(() => communityGames.id, {
      onDelete: 'cascade',
    }),
    fromOrganizationId: uuid('from_organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    toOrganizationId: uuid('to_organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    points: integer('points').notNull(),
    authorPoints: integer('author_points').notNull().default(0),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('idx_kai_transfers_game').on(t.communityGameId, t.createdAt)],
);

export const projectPlugins = pgTable(
  'project_plugins',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    pluginId: uuid('plugin_id')
      .notNull()
      .references(() => pluginPackages.id, { onDelete: 'cascade' }),
    installedByUserId: uuid('installed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.pluginId] })],
);

export const projectTemplates = pgTable(
  'project_templates',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templatePackages.id, { onDelete: 'cascade' }),
    appliedByUserId: uuid('applied_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.templateId] })],
);

export const sandboxRuns = pgTable(
  'sandbox_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityGameId: uuid('community_game_id')
      .notNull()
      .references(() => communityGames.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    stimulus: text('stimulus').notNull(),
    contrast: boolean('contrast').notNull().default(false),
    report: jsonb('report'),
    pointsPaid: integer('points_paid').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('idx_sandbox_runs_game').on(t.communityGameId, t.createdAt)],
);

/** One row per org per China calendar day — daily 开镇礼 and mission stamps. */
export const dailyStamps = pgTable(
  'daily_stamps',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    loginGranted: boolean('login_granted').notNull().default(false),
    missionPlay: boolean('mission_play').notNull().default(false),
    missionTown: boolean('mission_town').notNull().default(false),
    missionVisit: boolean('mission_visit').notNull().default(false),
    bonusGranted: boolean('bonus_granted').notNull().default(false),
    /** One free 喝彩 after the daily mission bonus. */
    tipCoupon: boolean('tip_coupon').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.day] })],
);

/** A visitor paying to deepen one synthetic resident's memory for a month. */
export const residentAdoptions = pgTable(
  'resident_adoptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityGameId: uuid('community_game_id')
      .notNull()
      .references(() => communityGames.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    agentKey: text('agent_key').notNull(),
    agentName: text('agent_name').notNull(),
    until: timestamp('until', { withTimezone: true }).notNull(),
    pointsPaid: integer('points_paid').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('resident_adoptions_org_agent_uq').on(
      t.communityGameId,
      t.organizationId,
      t.agentKey,
    ),
    index('idx_resident_adoptions_org').on(t.organizationId, t.until),
  ],
);

/** One row per successful sign-in. Not an operator audit log. */
export const authEvents = pgTable(
  'auth_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('idx_auth_events_user_created').on(t.userId, t.createdAt)],
);

/** Operator trail for publish / takedown / domain — not a product feature. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    target: text('target'),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_audit_log_created').on(t.createdAt),
    index('idx_audit_log_action').on(t.action, t.createdAt),
  ],
);

/** Poison jobs after BullMQ exhausts retries. */
export const jobDeadLetters = pgTable(
  'job_dead_letters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id'),
    projectId: uuid('project_id'),
    jobType: text('job_type'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_job_dead_letters_job').on(t.jobId),
    index('idx_job_dead_letters_created').on(t.createdAt),
    uniqueIndex('job_dead_letters_job_uidx')
      .on(t.jobId)
      .where(sql`${t.jobId} is not null`),
  ],
);

/**
 * One adjudicable question on a living town. Society still emerges;
 * this row only freezes a mutually exclusive prompt the oracle can settle.
 */
export const worldCourseNodes = pgTable(
  'world_course_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    communityGameId: uuid('community_game_id').references(() => communityGames.id, {
      onDelete: 'set null',
    }),
    prompt: text('prompt').notNull(),
    kind: text('kind').notNull().default('night_market'),
    status: text('status').notNull().default('open'),
    opensAt: timestamp('opens_at', { withTimezone: true }).notNull().defaultNow(),
    bettingClosesAt: timestamp('betting_closes_at', { withTimezone: true }).notNull(),
    settlesAt: timestamp('settles_at', { withTimezone: true }).notNull(),
    transcriptHash: text('transcript_hash'),
    winningOptionId: uuid('winning_option_id'),
    voidReason: text('void_reason'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_course_nodes_world_status').on(t.worldId, t.status),
    index('idx_course_nodes_game_status').on(t.communityGameId, t.status),
    index('idx_course_nodes_settle').on(t.settlesAt, t.status),
    uniqueIndex('world_course_nodes_world_active_uq')
      .on(t.worldId)
      .where(sql`${t.status} in ('open', 'closed')`),
  ],
);

export const worldCourseOptions = pgTable(
  'world_course_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => worldCourseNodes.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    predicateJson: jsonb('predicate_json').notNull().default({}),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('world_course_options_node_key_uq').on(t.nodeId, t.key)],
);

export const worldCourseStakes = pgTable(
  'world_course_stakes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => worldCourseNodes.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => worldCourseOptions.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    points: integer('points').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('world_course_stakes_node_org_uq').on(t.nodeId, t.organizationId)],
);

export const coursePushSubscriptions = pgTable(
  'course_push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('course_push_subscriptions_user_endpoint_uq').on(t.userId, t.endpoint)],
);

export const courseGameWatches = pgTable(
  'course_game_watches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: uuid('game_id')
      .notNull()
      .references(() => communityGames.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('course_game_watches_user_game_uq').on(t.userId, t.gameId)],
);

/** Published policies. The meta event row remains the live tip; this is the durable copy. */
export const worldPolicies = pgTable(
  'world_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    policyKey: text('policy_key').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    channel: text('channel').notNull().default('notice'),
    tagsJson: jsonb('tags_json').notNull().default([]),
    effectsJson: jsonb('effects_json').notNull().default({}),
    pending: boolean('pending').notNull().default(true),
    simTime: numeric('sim_time').notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('world_policies_world_key_uq').on(t.worldId, t.policyKey)],
);

/** One stance per resident per topic. */
export const agentOpinions = pgTable(
  'agent_opinions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    agentKey: text('agent_key').notNull(),
    topicKey: text('topic_key').notNull(),
    stance: numeric('stance').notNull().default('0'),
    confidence: numeric('confidence').notNull().default('0'),
    reason: text('reason').notNull().default(''),
    emotion: text('emotion'),
    action: text('action'),
    simTime: numeric('sim_time').notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('agent_opinions_topic_uq').on(t.worldId, t.agentKey, t.topicKey),
  ],
);

/** Non-LLM crowd histograms. */
export const crowdCohorts = pgTable(
  'crowd_cohorts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    cohortKey: text('cohort_key').notNull(),
    label: text('label').notNull(),
    regionId: text('region_id').notNull(),
    occupation: text('occupation').notNull().default(''),
    size: integer('size').notNull().default(0),
    histJson: jsonb('hist_json').notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('crowd_cohorts_world_key_uq').on(t.worldId, t.cohortKey)],
);

/** Saved forecast bands, including A/B scenarios. */
export const societyForecasts = pgTable(
  'society_forecasts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    label: text('label').notNull().default('baseline'),
    hours: integer('hours').notNull(),
    bandsJson: jsonb('bands_json').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('society_forecasts_world_idx').on(t.worldId, t.createdAt)],
);

/** Deep-mode snapshot. Classic towns never write this. */
export const worldDeepState = pgTable('world_deep_state', {
  worldId: uuid('world_id')
    .primaryKey()
    .references(() => worlds.id, { onDelete: 'cascade' }),
  stateJson: jsonb('state_json').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agentPsyche = pgTable(
  'agent_psyche',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    agentKey: text('agent_key').notNull(),
    psycheJson: jsonb('psyche_json').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('agent_psyche_world_key_uq').on(t.worldId, t.agentKey)],
);

export const agentActionLog = pgTable(
  'agent_action_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    agentKey: text('agent_key').notNull().default(''),
    simTime: numeric('sim_time').notNull().default('0'),
    intent: text('intent').notNull().default(''),
    actionText: text('action_text').notNull().default(''),
    monologue: text('monologue').notNull().default(''),
    isPublic: boolean('is_public').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('agent_action_log_world_idx').on(t.worldId, t.createdAt)],
);

export const worldLedgerSnapshots = pgTable(
  'world_ledger_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    simTime: numeric('sim_time').notNull().default('0'),
    ledgerJson: jsonb('ledger_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('world_ledger_snapshots_world_idx').on(t.worldId, t.createdAt)],
);

export const worldInstitutions = pgTable(
  'world_institutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    instKey: text('inst_key').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    bodyJson: jsonb('body_json').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('world_institutions_world_key_uq').on(t.worldId, t.instKey)],
);

export const worldChronicle = pgTable(
  'world_chronicle',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    simTime: numeric('sim_time').notNull().default('0'),
    text: text('text').notNull(),
    surprise: boolean('surprise').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('world_chronicle_world_idx').on(t.worldId, t.simTime)],
);

export const forecastScenarios = pgTable(
  'forecast_scenarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    specJson: jsonb('spec_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('forecast_scenarios_world_idx').on(t.worldId, t.createdAt)],
);

export const forecastRuns = pgTable(
  'forecast_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    worldId: uuid('world_id')
      .notNull()
      .references(() => worlds.id, { onDelete: 'cascade' }),
    scenarioId: uuid('scenario_id'),
    status: text('status').notNull().default('queued'),
    specJson: jsonb('spec_json').notNull().default({}),
    reportJson: jsonb('report_json'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('forecast_runs_status_idx').on(t.status, t.createdAt)],
);

export const historicalCases = pgTable('historical_cases', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  bodyJson: jsonb('body_json').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

