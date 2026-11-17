/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Project {
  id: string;
  name: string;
  archetype: string;
  organizationId: string;
}

export interface JobRow {
  id: string;
  projectId: string;
  sessionId: string | null;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  result?: {
    codeChanges?: Array<{
      filename: string;
      type: 'added' | 'modified' | 'deleted';
      summary?: string;
      diff?: string;
    }>;
    fileCount?: number;
    generatedAt?: string;
    contentHash?: string;
    deploymentId?: string;
    requeuedTo?: string;
  };
  logKey: string | null;
  traceId: string | null;
  retryCount: number;
  buildCacheKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentRow {
  id: string;
  previewUrl: string | null;
  channel: string;
}

export interface ChatSessionRow {
  id: string;
  title: string | null;
  parentId?: string | null;
  createdAt: string;
}

export interface ChatMessageRow {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  organizationId: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'succeeded';
export type DeploymentStatus = 'active' | 'inactive' | 'deploying';

/**
 * Agent FSM event surfaced by the worker via SSE / historical query.
 * Stays additive — IDE renderers should tolerate unknown role/phase combos.
 */
export type AgentRole = 'planner' | 'coder' | 'artist' | 'qa' | 'fixer' | 'system';
export type AgentPhase =
  | 'PLAN'
  | 'INTENT'
  /** World Spec compiled into the game's scenes / entities / quests. */
  | 'WORLD'
  | 'CODE'
  | 'ITERATE'
  | 'ASSET'
  | 'BUILD'
  | 'QA'
  | 'FIX'
  /** Early playable delivery — preview is live while the job keeps polishing. */
  | 'PREVIEW'
  | 'CURATE'
  | 'DONE'
  | 'FAIL';

export interface AgentEventRow {
  id: string;
  jobId: string;
  projectId: string;
  sessionId: string | null;
  role: AgentRole;
  phase: AgentPhase;
  tool: string | null;
  seq: number;
  summary: string | null;
  details: Record<string, unknown> | null;
  elapsedMs: number | null;
  createdAt: string;
}

export type AssetModality = 'image' | 'audio' | 'video' | 'music' | 'speech';

export interface AssetRow {
  id: string;
  modality: AssetModality | string;
  prompt: string | null;
  storageKey: string;
  thumbnailKey: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  externalId: string | null;
  licenseTag: string | null;
  costUnits: string | number | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  publicUrl: string | null;
  publicThumbnailUrl: string | null;
}
