/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Persist "where was I generating" across refresh / WeChat webview reloads.
 * sessionStorage dies when the webview is recreated; localStorage survives.
 */

export const EDITOR_LAST_SESSION_KEY = 'opengame_generate_last_session_v1';
export const LIVE_JOB_KEY = 'opengame_generate_live_job_v2';
const LIVE_JOB_KEY_V1 = 'opengame_generate_live_job_v1';

export type EditorLastSessionV2 = {
  v: 2;
  lastProjectId: string;
  byProject: Record<string, { sessionId: string | null }>;
};

export type ResumeStepSnap = {
  readonly id: string;
  readonly status: string;
  readonly labelKey: string;
};

export type LiveJobSnapshot = {
  readonly jobId: string;
  readonly sessionId: string | null;
  readonly type: string;
  readonly status: 'queued' | 'running';
  readonly createdAt: string;
  readonly visualPercent: number;
  readonly pipelineHidden: boolean;
  readonly steps: readonly ResumeStepSnap[];
};

function readStorage(key: string): string | null {
  try {
    const local = localStorage.getItem(key);
    if (local) return local;
  } catch {
    /* private mode */
  }
  try {
    const session = sessionStorage.getItem(key);
    if (session) {
      try {
        localStorage.setItem(key, session);
      } catch {
        /* ignore migrate failure */
      }
      return session;
    }
  } catch {
    /* private mode */
  }
  return null;
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* quota / private mode */
    }
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function safeParseEditorLastSession(): EditorLastSessionV2 | null {
  const raw = readStorage(EDITOR_LAST_SESSION_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as {
      v?: number;
      projectId?: string;
      sessionId?: string | null;
      lastProjectId?: string;
      byProject?: Record<string, { sessionId: string | null }>;
    };
    if (data.v === 2 && typeof data.lastProjectId === 'string' && data.byProject) {
      return {
        v: 2,
        lastProjectId: data.lastProjectId,
        byProject: data.byProject,
      };
    }
    if (data.v === 1 && typeof data.projectId === 'string') {
      const sessionId =
        data.sessionId != null && typeof data.sessionId !== 'string'
          ? null
          : (data.sessionId ?? null);
      return {
        v: 2,
        lastProjectId: data.projectId,
        byProject: { [data.projectId]: { sessionId } },
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function readLastProjectPreference(): string | null {
  return safeParseEditorLastSession()?.lastProjectId ?? null;
}

export function readEditorSessionPreference(
  projectId: string,
): { kind: 'session'; id: string } | { kind: 'blank' } | { kind: 'none' } {
  const data = safeParseEditorLastSession();
  if (!data) return { kind: 'none' };
  const entry = data.byProject[projectId];
  if (!entry) return { kind: 'none' };
  if (entry.sessionId === null) return { kind: 'blank' };
  return { kind: 'session', id: entry.sessionId };
}

export function writeEditorLastProject(projectId: string): void {
  try {
    const prev = safeParseEditorLastSession();
    const payload: EditorLastSessionV2 = {
      v: 2,
      lastProjectId: projectId,
      byProject: { ...(prev?.byProject ?? {}) },
    };
    writeStorage(EDITOR_LAST_SESSION_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function writeEditorSessionPreference(
  projectId: string,
  sessionId: string | null,
): void {
  try {
    const prev = safeParseEditorLastSession();
    const payload: EditorLastSessionV2 = {
      v: 2,
      lastProjectId: projectId,
      byProject: {
        ...(prev?.byProject ?? {}),
        [projectId]: { sessionId },
      },
    };
    writeStorage(EDITOR_LAST_SESSION_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

function emptySnap(jobId: string): LiveJobSnapshot {
  return {
    jobId,
    sessionId: null,
    type: 'generate',
    status: 'running',
    createdAt: new Date().toISOString(),
    visualPercent: 0,
    pipelineHidden: false,
    steps: [],
  };
}

function asStatus(value: unknown): 'queued' | 'running' {
  return value === 'queued' ? 'queued' : 'running';
}

function parseOneSnap(value: unknown): LiveJobSnapshot | null {
  if (typeof value === 'string' && value.length > 0) {
    return emptySnap(value);
  }
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.jobId !== 'string' || row.jobId.length === 0) return null;
  const steps = Array.isArray(row.steps)
    ? row.steps.filter(
        (s): s is ResumeStepSnap =>
          Boolean(
            s &&
              typeof s === 'object' &&
              typeof (s as ResumeStepSnap).id === 'string' &&
              typeof (s as ResumeStepSnap).status === 'string' &&
              typeof (s as ResumeStepSnap).labelKey === 'string',
          ),
      )
    : [];
  return {
    jobId: row.jobId,
    sessionId: typeof row.sessionId === 'string' ? row.sessionId : null,
    type: typeof row.type === 'string' ? row.type : 'generate',
    status: asStatus(row.status),
    createdAt:
      typeof row.createdAt === 'string' && row.createdAt.length > 0
        ? row.createdAt
        : new Date().toISOString(),
    visualPercent:
      typeof row.visualPercent === 'number' && Number.isFinite(row.visualPercent)
        ? Math.max(0, Math.min(100, Math.round(row.visualPercent)))
        : 0,
    pipelineHidden: row.pipelineHidden === true,
    steps,
  };
}

function readAllSnapshots(): Record<string, LiveJobSnapshot> {
  const out: Record<string, LiveJobSnapshot> = {};
  const ingest = (raw: string | null) => {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [projectId, value] of Object.entries(parsed)) {
        const snap = parseOneSnap(value);
        if (snap) out[projectId] = snap;
      }
    } catch {
      /* ignore */
    }
  };
  ingest(readStorage(LIVE_JOB_KEY_V1));
  ingest(readStorage(LIVE_JOB_KEY));
  return out;
}

function persistAllSnapshots(byProject: Record<string, LiveJobSnapshot>): void {
  if (Object.keys(byProject).length === 0) {
    removeStorage(LIVE_JOB_KEY);
    removeStorage(LIVE_JOB_KEY_V1);
    return;
  }
  writeStorage(LIVE_JOB_KEY, JSON.stringify(byProject));
  removeStorage(LIVE_JOB_KEY_V1);
}

export function readLiveJobSnapshot(projectId: string): LiveJobSnapshot | null {
  return readAllSnapshots()[projectId] ?? null;
}

export function writeLiveJobSnapshot(
  projectId: string,
  snap: LiveJobSnapshot | null,
): void {
  const byProject = readAllSnapshots();
  if (snap) byProject[projectId] = snap;
  else delete byProject[projectId];
  persistAllSnapshots(byProject);
}

export function patchLiveJobSnapshot(
  projectId: string,
  patch: Partial<LiveJobSnapshot> & { readonly jobId?: string },
): LiveJobSnapshot | null {
  const prev = readLiveJobSnapshot(projectId);
  const jobId = patch.jobId ?? prev?.jobId;
  if (!jobId) return null;
  if (prev && patch.jobId && prev.jobId !== patch.jobId) {
    const next = { ...emptySnap(jobId), ...patch, jobId };
    writeLiveJobSnapshot(projectId, next);
    return next;
  }
  const next: LiveJobSnapshot = {
    ...(prev ?? emptySnap(jobId)),
    ...patch,
    jobId,
  };
  writeLiveJobSnapshot(projectId, next);
  return next;
}

export function elapsedSecSince(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return 0;
  const t0 = new Date(iso).getTime();
  if (!Number.isFinite(t0)) return 0;
  return Math.max(0, Math.floor((now - t0) / 1000));
}

export function generationStateForResume(
  jobType: string,
  phase?: string | null,
): 'generating' | 'building' | 'deploying' {
  if (jobType === 'build' || jobType === 'publish') return 'building';
  if (
    phase === 'BUILD' ||
    phase === 'QA' ||
    phase === 'PREVIEW' ||
    phase === 'CURATE'
  ) {
    return 'building';
  }
  if (phase === 'DONE') return 'deploying';
  return 'generating';
}
