/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Derive a visual creation pipeline (game / world) from agent_events.
 */

import type { AgentEventRow, AgentPhase } from '../types';
import {
  extractProgressMeta,
  getEffectivePhase,
} from './generationProgressText';
import {
  readWorldLineageSnapshot,
  type WorldLineageSnapshot,
} from './worldLineage';

export type PipelineStepStatus =
  | 'pending'
  | 'active'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'degraded';

export type PipelineStepId =
  | 'intent'
  | 'plan'
  | 'scaffold'
  | 'worldSpec'
  | 'assets'
  | 'code'
  | 'build'
  | 'preview'
  | 'polish';

export interface PipelineStepDef {
  readonly id: PipelineStepId;
  readonly labelKey: string;
  readonly phases: readonly AgentPhase[];
}

export interface PipelineStepView {
  readonly id: PipelineStepId;
  readonly labelKey: string;
  readonly status: PipelineStepStatus;
  readonly note: string | null;
}

export interface PipelineStagePayload {
  readonly archetype: string | null;
  readonly scaffold: string | null;
  readonly gddSceneKeys: string[];
  readonly imageFiles: string[];
  readonly audioFiles: string[];
  readonly allFiles: string[];
  readonly filesChanged: string[];
  readonly sceneCount: number | null;
  readonly smokeOk: boolean | null;
  readonly playable: boolean | null;
  readonly qaIssues: string[];
  readonly failoverNotes: string[];
  readonly worldLineage: WorldLineageSnapshot | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly attempt: number | null;
  readonly maxAttempts: number | null;
  readonly cliTimeoutMs: number | null;
  readonly heartbeatSec: number;
  readonly softSkipAudio: boolean;
  readonly imageFailover: boolean;
  readonly keyHint: string | null;
  readonly keyRotated: boolean;
  readonly poolSize: number | null;
}

const GAME_STEPS: readonly PipelineStepDef[] = [
  {
    id: 'intent',
    labelKey: 'generate.pipeline.step.intent',
    phases: ['INTENT'],
  },
  {
    id: 'plan',
    labelKey: 'generate.pipeline.step.plan',
    phases: ['PLAN'],
  },
  {
    id: 'scaffold',
    labelKey: 'generate.pipeline.step.scaffold',
    phases: ['PLAN'],
  },
  {
    id: 'assets',
    labelKey: 'generate.pipeline.step.assets',
    phases: ['ASSET'],
  },
  {
    id: 'code',
    labelKey: 'generate.pipeline.step.code',
    phases: ['CODE', 'ITERATE', 'FIX'],
  },
  {
    id: 'build',
    labelKey: 'generate.pipeline.step.build',
    phases: ['BUILD', 'QA'],
  },
  {
    id: 'preview',
    labelKey: 'generate.pipeline.step.preview',
    phases: ['PREVIEW', 'DONE'],
  },
  {
    id: 'polish',
    labelKey: 'generate.pipeline.step.polish',
    phases: ['CURATE'],
  },
];

const WORLD_STEPS: readonly PipelineStepDef[] = [
  {
    id: 'intent',
    labelKey: 'generate.pipeline.step.worldIntent',
    phases: ['INTENT'],
  },
  {
    id: 'worldSpec',
    labelKey: 'generate.pipeline.step.worldSpec',
    phases: ['PLAN', 'WORLD'],
  },
  {
    id: 'code',
    labelKey: 'generate.pipeline.step.presenter',
    phases: ['CODE', 'ITERATE', 'FIX'],
  },
  {
    id: 'assets',
    labelKey: 'generate.pipeline.step.worldAssets',
    phases: ['ASSET'],
  },
  {
    id: 'build',
    labelKey: 'generate.pipeline.step.worldBuild',
    phases: ['BUILD', 'QA'],
  },
  {
    id: 'preview',
    labelKey: 'generate.pipeline.step.worldPreview',
    phases: ['PREVIEW', 'DONE'],
  },
];

function phaseRank(phase: AgentPhase | null): number {
  const order: AgentPhase[] = [
    'INTENT',
    'PLAN',
    'WORLD',
    'ASSET',
    'CODE',
    'ITERATE',
    'FIX',
    'BUILD',
    'QA',
    'PREVIEW',
    'CURATE',
    'DONE',
    'FAIL',
  ];
  if (!phase) return -1;
  const i = order.indexOf(phase);
  return i >= 0 ? i : -1;
}

function stepMaxRank(def: PipelineStepDef): number {
  return Math.max(...def.phases.map((p) => phaseRank(p)));
}

function eventsForPhases(
  events: AgentEventRow[],
  phases: readonly AgentPhase[],
): AgentEventRow[] {
  return events.filter(
    (e) =>
      phases.includes(e.phase) &&
      !(
        e.details &&
        typeof e.details === 'object' &&
        ((e.details as Record<string, unknown>).heartbeat === true ||
          (e.details as Record<string, unknown>).stream === true)
      ),
  );
}

function hasScaffoldSignal(events: AgentEventRow[]): boolean {
  return events.some((e) => {
    if (e.phase !== 'PLAN') return false;
    const s = e.summary ?? '';
    if (/脚手架|scaffold/i.test(s)) return true;
    const d = e.details as Record<string, unknown> | null;
    return Boolean(d?.scaffoldReady || d?.effectiveMode || d?.gddSceneKeys);
  });
}

export function derivePipelineSteps(
  events: AgentEventRow[],
  mode: 'game' | 'world',
  opts: { failed?: boolean; hasPreview?: boolean } = {},
): PipelineStepView[] {
  const defs = mode === 'world' ? WORLD_STEPS : GAME_STEPS;
  const effective = getEffectivePhase(events);
  const failed = opts.failed || effective === 'FAIL';
  const effRank = phaseRank(effective === 'FAIL' ? null : effective);
  const meta = extractProgressMeta(events);
  const seenPhases = new Set(
    events
      .filter(
        (e) =>
          !(
            e.details &&
            typeof e.details === 'object' &&
            ((e.details as Record<string, unknown>).heartbeat === true ||
              (e.details as Record<string, unknown>).stream === true)
          ),
      )
      .map((e) => e.phase),
  );

  return defs.map((def) => {
    let status: PipelineStepStatus = 'pending';
    let note: string | null = null;
    const maxR = stepMaxRank(def);
    const touched = def.phases.some((p) => seenPhases.has(p));

    if (def.id === 'scaffold') {
      const ready = hasScaffoldSignal(events);
      if (ready) status = 'done';
      else if (effRank >= phaseRank('PLAN') && !failed) status = 'active';
      else status = 'pending';
    } else if (def.id === 'assets') {
      if (meta.softSkipAudio && touched) {
        status = 'degraded';
        note = 'audioSoftSkip';
      } else if (touched && effRank > maxR) {
        status = 'done';
      } else if (def.phases.includes(effective as AgentPhase)) {
        status = 'active';
      } else if (touched) {
        status = 'done';
      }
    } else if (failed && def.phases.includes(effective as AgentPhase)) {
      status = 'failed';
    } else if (failed && touched && effRank <= maxR) {
      status = 'failed';
    } else if (opts.hasPreview && (def.id === 'preview' || def.id === 'polish')) {
      if (meta.smokeOk === false || meta.playable === false) {
        status = 'degraded';
        note = 'previewUnplayable';
      } else {
        status = def.id === 'preview' ? 'done' : touched ? 'done' : 'pending';
      }
    } else if (def.phases.includes(effective as AgentPhase)) {
      status = 'active';
    } else if (touched || (effRank > maxR && maxR >= 0)) {
      status = 'done';
    }

    if (
      (def.id === 'build' || def.id === 'code') &&
      meta.smokeOk === false &&
      (status === 'done' || status === 'active')
    ) {
      status = 'degraded';
      if (!note) note = 'previewUnplayable';
    }

    if (failed && status === 'active') status = 'failed';
    // Silent Key-pool rotation must not mark the code step as degraded.
    return { id: def.id, labelKey: def.labelKey, status, note };
  });
}

export function collectPipelineStagePayload(
  events: AgentEventRow[],
  activeJobId?: string | null,
): PipelineStagePayload {
  const meta = extractProgressMeta(events);
  let archetype: string | null = null;
  let scaffold: string | null = null;
  const gddSceneKeys: string[] = [];
  const imageFiles: string[] = [];
  const audioFiles: string[] = [];
  const allFiles: string[] = [];
  const filesChanged: string[] = [];
  let sceneCount: number | null = null;
  let smokeOk: boolean | null = null;
  let playable: boolean | null = null;
  const qaIssues: string[] = [];
  const failoverNotes: string[] = [];

  for (const evt of events) {
    if (!evt.details || typeof evt.details !== 'object') continue;
    const d = evt.details as Record<string, unknown>;
    if (!archetype && typeof d.archetype === 'string') archetype = d.archetype;
    if (!scaffold && typeof d.effectiveMode === 'string') scaffold = d.effectiveMode;
    if (Array.isArray(d.gddSceneKeys)) {
      for (const k of d.gddSceneKeys) {
        if (typeof k === 'string' && !gddSceneKeys.includes(k)) gddSceneKeys.push(k);
      }
    }
    if (Array.isArray(d.scenes)) {
      for (const k of d.scenes) {
        if (typeof k === 'string' && !gddSceneKeys.includes(k)) gddSceneKeys.push(k);
      }
    }
    if (Array.isArray(d.imageFiles)) {
      for (const f of d.imageFiles) {
        if (typeof f === 'string' && !imageFiles.includes(f)) imageFiles.push(f);
      }
    }
    if (Array.isArray(d.audioFiles)) {
      for (const f of d.audioFiles) {
        if (typeof f === 'string' && !audioFiles.includes(f)) audioFiles.push(f);
      }
    }
    if (Array.isArray(d.files)) {
      for (const f of d.files) {
        if (typeof f === 'string' && !allFiles.includes(f)) {
          allFiles.push(f);
          if (/\.(png|jpe?g|webp|gif)$/i.test(f) && !imageFiles.includes(f)) {
            imageFiles.push(f);
          }
          if (/\.(mp3|ogg|wav|m4a)$/i.test(f) && !audioFiles.includes(f)) {
            audioFiles.push(f);
          }
          if (/\.(ts|tsx|js|json)$/i.test(f) && !filesChanged.includes(f)) {
            filesChanged.push(f);
          }
        }
      }
    }
    if (Array.isArray(d.filesChanged)) {
      for (const f of d.filesChanged) {
        if (typeof f === 'string' && !filesChanged.includes(f)) filesChanged.push(f);
      }
    }
    if (typeof d.sceneCount === 'number') sceneCount = d.sceneCount;
    if (typeof d.smokeOk === 'boolean') smokeOk = d.smokeOk;
    if (typeof d.playable === 'boolean') playable = d.playable;
    if (
      (evt.phase === 'QA' || evt.phase === 'FAIL') &&
      Array.isArray(d.issues) &&
      qaIssues.length === 0
    ) {
      qaIssues.push(
        ...d.issues.filter((x): x is string => typeof x === 'string').slice(0, 4),
      );
    }
    if (Array.isArray(d.failoverEvents)) {
      for (const n of d.failoverEvents) {
        // Only surface pool-exhausted copy; ignore silent rotate / sticky marks.
        if (
          typeof n === 'string' &&
          /全部|用尽|音效已跳过|出图失败|exhausted/i.test(n) &&
          !failoverNotes.includes(n)
        ) {
          failoverNotes.push(n);
        }
      }
    }
  }

  return {
    archetype,
    scaffold,
    gddSceneKeys,
    imageFiles,
    audioFiles,
    allFiles,
    filesChanged,
    sceneCount,
    smokeOk,
    playable,
    qaIssues,
    failoverNotes,
    worldLineage: readWorldLineageSnapshot(events, activeJobId),
    provider: meta.provider,
    model: meta.model,
    attempt: meta.attempt,
    maxAttempts: meta.maxAttempts,
    cliTimeoutMs: meta.cliTimeoutMs,
    heartbeatSec: meta.heartbeatSec,
    softSkipAudio: meta.softSkipAudio,
    imageFailover: meta.imageFailover,
    keyHint: meta.keyHint,
    keyRotated: meta.keyRotated,
    poolSize: meta.poolSize,
  };
}

/** Blend step completion with phase percent for smoother visual progress. */
export function pipelineVisualPercent(
  steps: readonly PipelineStepView[],
  phasePercent: number,
): number {
  if (steps.length === 0) return phasePercent;
  const weight = 100 / steps.length;
  let score = 0;
  for (const s of steps) {
    if (s.status === 'done' || s.status === 'skipped') score += weight;
    else if (s.status === 'degraded') score += weight * 0.85;
    else if (s.status === 'active' || s.status === 'failed') score += weight * 0.45;
  }
  return Math.min(99, Math.max(phasePercent, Math.round(score)));
}

export function activeStepId(steps: PipelineStepView[]): PipelineStepId | null {
  const active = steps.find((s) => s.status === 'active' || s.status === 'degraded');
  if (active) return active.id;
  const failed = steps.find((s) => s.status === 'failed');
  if (failed) return failed.id;
  const lastDone = [...steps].reverse().find((s) => s.status === 'done');
  return lastDone?.id ?? steps[0]?.id ?? null;
}

/** @internal for tests */
export function __eventsForPhases(
  events: AgentEventRow[],
  phases: readonly AgentPhase[],
): AgentEventRow[] {
  return eventsForPhases(events, phases);
}
