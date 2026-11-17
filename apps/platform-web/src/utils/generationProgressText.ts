/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentEventRow, AgentPhase } from '../types';
import type { GenerationState, JobLifecycleStatus } from '../hooks/useGeneration';

export type ProgressTranslate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

function isHeartbeat(evt: AgentEventRow): boolean {
  return Boolean(
    evt.details &&
      typeof evt.details === 'object' &&
      (evt.details as Record<string, unknown>).heartbeat === true,
  );
}

export function isCliStreamEvent(evt: AgentEventRow): boolean {
  return Boolean(
    evt.details &&
      typeof evt.details === 'object' &&
      (evt.details as Record<string, unknown>).stream === true,
  );
}

/** Keep only events for the focused job (or the latest job if focus is unset). */
export function getActiveJobEvents(
  events: AgentEventRow[],
  activeJobId?: string | null,
): AgentEventRow[] {
  if (events.length === 0) return [];
  const focusId = activeJobId ?? events[events.length - 1]!.jobId;
  return events.filter((evt) => evt.jobId === focusId);
}

/** Raw last event phase — prefer {@link getEffectivePhase} for UI progress. */
export function getLatestPhase(events: AgentEventRow[]): AgentPhase | null {
  if (events.length === 0) return null;
  return events[events.length - 1]!.phase;
}

/**
 * Sticky non-heartbeat phase so CLI heartbeats (even if mis-tagged PLAN)
 * cannot yank the headline back to "planning".
 */
export function getEffectivePhase(events: AgentEventRow[]): AgentPhase | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i]!;
    if (isHeartbeat(evt) || isCliStreamEvent(evt)) {
      const active = (evt.details as Record<string, unknown> | null)?.activePhase;
      if (typeof active === 'string' && active.length > 0) {
        return active as AgentPhase;
      }
      continue;
    }
    return evt.phase;
  }
  return null;
}

export function getLatestHeartbeat(events: AgentEventRow[]): AgentEventRow | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (isHeartbeat(events[i]!)) return events[i]!;
  }
  return null;
}

/** Collapse duplicate heartbeats / CLI stream lines to a single live row each. */
export function collapseHeartbeatEvents(events: AgentEventRow[]): AgentEventRow[] {
  const out: AgentEventRow[] = [];
  let lastHb: AgentEventRow | null = null;
  let lastStream: AgentEventRow | null = null;
  const flushLive = (): void => {
    if (lastHb) {
      out.push(lastHb);
      lastHb = null;
    }
    if (lastStream) {
      out.push(lastStream);
      lastStream = null;
    }
  };
  for (const evt of events) {
    if (isHeartbeat(evt)) {
      lastHb = evt;
      continue;
    }
    if (isCliStreamEvent(evt)) {
      lastStream = evt;
      continue;
    }
    flushLive();
    out.push(evt);
  }
  flushLive();
  return out;
}

export function extractProgressMeta(events: AgentEventRow[]): {
  provider: string | null;
  model: string | null;
  attempt: number | null;
  maxAttempts: number | null;
  cliTimeoutMs: number | null;
  heartbeatSec: number;
  heartbeatSummary: string | null;
  cliSummary: string | null;
  imageFailover: boolean;
  softSkipAudio: boolean;
  archetype: string | null;
  keyHint: string | null;
  keyRotated: boolean;
  poolSize: number | null;
  smokeOk: boolean | null;
  playable: boolean | null;
} {
  let provider: string | null = null;
  let model: string | null = null;
  let attempt: number | null = null;
  let maxAttempts: number | null = null;
  let cliTimeoutMs: number | null = null;
  let heartbeatSec = 0;
  let heartbeatSummary: string | null = null;
  let cliSummary: string | null = null;
  let imageFailover = false;
  let softSkipAudio = false;
  let archetype: string | null = null;
  let keyHint: string | null = null;
  let keyRotated = false;
  let poolSize: number | null = null;
  let smokeOk: boolean | null = null;
  let playable: boolean | null = null;

  for (const evt of events) {
    if (!evt.details || typeof evt.details !== 'object') continue;
    const d = evt.details as Record<string, unknown>;
    if (typeof d.provider === 'string') provider = d.provider;
    if (typeof d.model === 'string') model = d.model;
    if (typeof d.attempt === 'number') attempt = d.attempt;
    if (typeof d.maxAttempts === 'number') maxAttempts = d.maxAttempts;
    if (typeof d.cliTimeoutMs === 'number') cliTimeoutMs = d.cliTimeoutMs;
    if (!archetype && typeof d.archetype === 'string') archetype = d.archetype;
    if (typeof d.keyHint === 'string') keyHint = d.keyHint;
    if (typeof d.poolSize === 'number') poolSize = d.poolSize;
    if (typeof d.smokeOk === 'boolean') smokeOk = d.smokeOk;
    if (typeof d.playable === 'boolean') playable = d.playable;
    if (
      d.providerFailover != null ||
      (typeof evt.summary === 'string' &&
        /切换 Key|配额\/欠费失败|备路欠费/i.test(evt.summary))
    ) {
      keyRotated = true;
    }
    // keyPoolSilentRotate is intentional no-op for product UI.
    if (d.heartbeat === true && typeof d.elapsedSec === 'number') {
      heartbeatSec = Math.max(heartbeatSec, d.elapsedSec);
      if (evt.summary) heartbeatSummary = evt.summary;
    }
    if (d.stream === true && typeof evt.summary === 'string' && evt.summary.trim()) {
      cliSummary = evt.summary.trim();
    }
    if (d.imageFailover === true || d.providerFailover === true) {
      // Mid-pool Key rotate is silent; only explicit pool-exhausted flags matter.
      if (d.assetPoolExhausted === true) {
        imageFailover = true;
      }
    }
    if (d.softSkipAudio === true) softSkipAudio = true;
    if (d.assetPoolExhausted === true) imageFailover = true;
    if (Array.isArray(d.failoverEvents)) {
      for (const note of d.failoverEvents) {
        if (typeof note !== 'string') continue;
        // Worker only emits user-visible pool-exhausted notes now.
        if (/音效已跳过|音效失败|全部用尽|all keys exhausted/i.test(note)) {
          softSkipAudio = true;
        }
        if (/出图失败|池已全部|全部额度/i.test(note)) {
          imageFailover = true;
        }
      }
    }
  }
  return {
    provider,
    model,
    attempt,
    maxAttempts,
    cliTimeoutMs,
    heartbeatSec,
    heartbeatSummary,
    cliSummary,
    imageFailover,
    softSkipAudio,
    archetype,
    keyHint,
    keyRotated,
    poolSize,
    smokeOk,
    playable,
  };
}

/** Stepped progress — not a precise percentage from the backend. */
export function phaseToProgressPercent(phase: AgentPhase | null): number {
  switch (phase) {
    case 'INTENT':
      return 5;
    case 'PLAN':
      return 15;
    case 'WORLD':
      return 25;
    case 'CODE':
    case 'ITERATE':
    case 'FIX':
      return 45;
    case 'ASSET':
      return 55;
    case 'BUILD':
      return 70;
    case 'QA':
      return 85;
    case 'PREVIEW':
      return 90;
    case 'CURATE':
      return 92;
    case 'DONE':
      return 100;
    case 'FAIL':
      return 0;
    default:
      return 0;
  }
}

function headlineKeyForPhase(
  phase: AgentPhase | null,
  generationState: GenerationState,
  mode: 'game' | 'world' = 'game',
): string {
  const world = mode === 'world';
  if (generationState === 'error' || phase === 'FAIL') {
    return 'generate.progress.headline.fail';
  }
  if (phase === 'DONE' || generationState === 'deploying') {
    return world
      ? 'generate.progress.headline.worldDeploying'
      : 'generate.progress.headline.deploying';
  }
  switch (phase) {
    case 'INTENT':
      return world
        ? 'generate.progress.headline.worldIntent'
        : 'generate.progress.headline.intent';
    case 'PLAN':
      return world
        ? 'generate.progress.headline.worldPlan'
        : 'generate.progress.headline.plan';
    case 'WORLD':
      return 'generate.progress.headline.worldCompile';
    case 'CODE':
    case 'ITERATE':
      return world
        ? 'generate.progress.headline.worldCode'
        : 'generate.progress.headline.code';
    case 'FIX':
      return world
        ? 'generate.progress.headline.worldCode'
        : 'generate.progress.headline.fix';
    case 'ASSET':
      return world
        ? 'generate.progress.headline.worldAsset'
        : 'generate.progress.headline.asset';
    case 'BUILD':
    case 'QA':
      return world
        ? 'generate.progress.headline.worldBuild'
        : 'generate.progress.headline.build';
    case 'PREVIEW':
      return 'generate.progress.headline.earlyPlayable';
    case 'CURATE':
      return 'generate.progress.headline.curate';
    default:
      if (generationState === 'building') {
        return world
          ? 'generate.progress.headline.worldBuild'
          : 'generate.progress.headline.build';
      }
      if (generationState === 'generating') {
        return world
          ? 'generate.progress.headline.worldCode'
          : 'generate.progress.headline.code';
      }
      return 'generate.progress.headline.waiting';
  }
}

export function phaseToHeadline(
  phase: AgentPhase | null,
  generationState: GenerationState,
  isLoading: boolean,
  t: ProgressTranslate,
  jobLifecycleStatus: JobLifecycleStatus = 'idle',
  mode: 'game' | 'world' = 'game',
  queueHint?: { runningPeers: number; queuedPeers: number },
  opts?: { smokeOk?: boolean | null; playable?: boolean | null },
): string {
  if (!isLoading && generationState === 'preview') {
    if (opts?.smokeOk === false || opts?.playable === false) {
      return t('generate.progress.headline.previewDegraded');
    }
    return t(
      mode === 'world'
        ? 'generate.progress.headline.worldReady'
        : 'generate.progress.headline.ready',
    );
  }
  if (!isLoading && generationState === 'idle' && !phase) {
    return t(
      mode === 'world'
        ? 'generate.progress.headline.worldIdle'
        : 'generate.progress.headline.idle',
    );
  }
  if (isLoading && !phase) {
    if (jobLifecycleStatus === 'queued') {
      const runningPeers = queueHint?.runningPeers ?? 0;
      if (runningPeers > 0) {
        return t('generate.progress.headline.queuedBehind', {
          count: runningPeers,
        });
      }
      if ((queueHint?.queuedPeers ?? 0) >= 1) {
        return t('generate.progress.headline.queuedNoWorker');
      }
      return t('generate.progress.headline.queued');
    }
    if (jobLifecycleStatus === 'running') {
      return t('generate.progress.headline.workerInit');
    }
    return t('generate.progress.headline.waiting');
  }
  return t(headlineKeyForPhase(phase, generationState, mode));
}

function phaseFallbackKey(phase: AgentPhase): string {
  return `generate.progress.event.${phase.toLowerCase()}`;
}

/** Prefer worker summary; fall back to phase-based plain language. */
export function eventToPlainLine(evt: AgentEventRow, t: ProgressTranslate): string {
  const summary = evt.summary?.trim();
  if (summary) {
    return isCliStreamEvent(evt) ? t('generate.progress.cli', { line: summary }) : summary;
  }
  const tool = evt.tool?.trim();
  if (tool) {
    return t('generate.progress.event.tool', { tool });
  }
  return t(phaseFallbackKey(evt.phase));
}

export function formatEventTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

export function formatElapsedSec(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
