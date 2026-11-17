/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  EDITOR_LAST_SESSION_KEY,
  elapsedSecSince,
  generationStateForResume,
  LIVE_JOB_KEY,
  patchLiveJobSnapshot,
  readEditorSessionPreference,
  readLastProjectPreference,
  readLiveJobSnapshot,
  writeEditorLastProject,
  writeEditorSessionPreference,
  writeLiveJobSnapshot,
} from './generationResume.js';

function installMemoryStorage(): void {
  const make = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    };
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: make(),
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: make(),
  });
}

describe('generationResume', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it('migrates last-session from sessionStorage so a WeChat reload still lands on the same chat', () => {
    sessionStorage.setItem(
      EDITOR_LAST_SESSION_KEY,
      JSON.stringify({
        v: 2,
        lastProjectId: 'proj-1',
        byProject: { 'proj-1': { sessionId: 'sess-9' } },
      }),
    );
    expect(readLastProjectPreference()).toBe('proj-1');
    expect(readEditorSessionPreference('proj-1')).toEqual({
      kind: 'session',
      id: 'sess-9',
    });
    expect(localStorage.getItem(EDITOR_LAST_SESSION_KEY)).toBeTruthy();
  });

  it('remembers a blank-session preference so refresh does not reopen the old chat', () => {
    writeEditorLastProject('proj-1');
    writeEditorSessionPreference('proj-1', null);
    expect(readEditorSessionPreference('proj-1')).toEqual({ kind: 'blank' });
  });

  it('migrates a v1 live-job id and keeps progress when patched', () => {
    sessionStorage.setItem(
      'opengame_generate_live_job_v1',
      JSON.stringify({ 'proj-1': 'job-77' }),
    );
    expect(readLiveJobSnapshot('proj-1')?.jobId).toBe('job-77');
    const patched = patchLiveJobSnapshot('proj-1', {
      visualPercent: 74,
      status: 'running',
      createdAt: '2026-08-18T13:00:00.000Z',
    });
    expect(patched?.visualPercent).toBe(74);
    expect(readLiveJobSnapshot('proj-1')?.createdAt).toBe(
      '2026-08-18T13:00:00.000Z',
    );
    expect(localStorage.getItem(LIVE_JOB_KEY)).toBeTruthy();
  });

  it('clears a finished job and does not leak it onto the next generate', () => {
    writeLiveJobSnapshot('proj-1', {
      jobId: 'job-1',
      sessionId: 'sess-1',
      type: 'world_generate',
      status: 'running',
      createdAt: '2026-08-18T13:00:00.000Z',
      visualPercent: 40,
      pipelineHidden: true,
      steps: [],
    });
    writeLiveJobSnapshot('proj-1', null);
    expect(readLiveJobSnapshot('proj-1')).toBeNull();
  });

  it('counts elapsed time from the original job start, not from the refresh', () => {
    expect(
      elapsedSecSince('2026-08-18T13:00:00.000Z', Date.parse('2026-08-18T13:02:05.000Z')),
    ).toBe(125);
  });

  it('maps a mid-build resume to building, not a fresh generate', () => {
    expect(generationStateForResume('world_generate', 'ASSET')).toBe('generating');
    expect(generationStateForResume('world_generate', 'BUILD')).toBe('building');
    expect(generationStateForResume('build', null)).toBe('building');
  });
});
