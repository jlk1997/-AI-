/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import { useState, useCallback, useRef, useEffect } from 'react';
import { App } from 'antd';
import { api, ApiError, GameParamsConfig } from '../services/api';
import { useAppStore } from '../store';
import { translateApiError, useT } from '../services/i18n';
import { summarizeJobLogKey, jobHasS3LogTail } from '../utils/jobFailureText';
import {
  generationStateForResume,
  patchLiveJobSnapshot,
  readEditorSessionPreference,
  readLastProjectPreference,
  readLiveJobSnapshot,
  writeEditorLastProject,
  writeEditorSessionPreference,
  writeLiveJobSnapshot,
} from '../utils/generationResume';
import {
  getEffectivePhase,
  phaseToProgressPercent,
} from '../utils/generationProgressText';
import type { Message } from '../components/Conversation/MessageItem';
import type { SessionInfo } from '../components/Conversation/SessionHistory';
import type { AgentEventRow, JobRow, Project } from '../types';
import type { IterationRecord } from '../components/Conversation/IterationHistory';
import {
  filterFailedJobsForUi,
  isWorldJobType,
  pickAgentReplayJob,
  pickLiveProjectJobs,
  pickLiveSessionJob,
  type FailedJobUiRow,
} from './useGenerationJobs';
import { followRetryJobId } from '../utils/jobRetryFollow';
import { useGenerationPreview } from './useGenerationPreview';

export interface AgentSessionContext {
  brief: Record<string, unknown> | null;
  sessionSummary: string | null;
  memories: string[];
}

function readLiveJobPreference(projectId: string): string | null {
  return readLiveJobSnapshot(projectId)?.jobId ?? null;
}

function writeLiveJobPreference(projectId: string, jobId: string | null): void {
  if (!jobId) {
    writeLiveJobSnapshot(projectId, null);
    return;
  }
  patchLiveJobSnapshot(projectId, { jobId });
}

// 代码变更类型
export interface FileChange {
  filename: string;
  type: 'added' | 'modified' | 'deleted';
  summary?: string;
  diff?: string;
}

// 生成状态机类型
export type GenerationState =
  | 'idle'
  | 'generating'
  | 'building'
  | 'deploying'
  | 'preview'
  | 'error';

export type StageStatus = 'pending' | 'active' | 'success' | 'error';

/** DB job lifecycle as seen by the IDE poll/SSE layer. */
export type JobLifecycleStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed';

interface UseGenerationReturn {
  // 状态
  generationState: GenerationState;
  stageStatuses: {
    generate: StageStatus;
    build: StageStatus;
    deploy: StageStatus;
  };
  messages: Message[];
  previewUrl: string | null;
  playableDraft: boolean;
  deploymentId: string | null;
  logKey: string | null;
  isLoading: boolean;
  jobLifecycleStatus: JobLifecycleStatus;
  queuedTimeoutHint: boolean;

  // 会话相关
  sessions: SessionInfo[];
  currentSessionId: string | null;
  codeChanges: FileChange[];

  // 操作
  sendMessage: (
    content: string,
    gameParams?: GameParamsConfig,
    images?: string[],
    mode?: 'game' | 'world' | 'world_edit',
  ) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  resetConversation: () => void;
  openLogModal: (logKey: string) => void;
  closeLogModal: () => void;
  logModalVisible: boolean;

  // 会话操作
  loadSessions: () => Promise<void>;
  selectSession: (sessionId: string) => void;
  createNewSession: () => void;
  deleteSession: (sessionId: string) => void;
  forkSession: (sessionId?: string) => Promise<void>;

  // SSE 实时更新
  setupSSE: (projectId: string) => void;
  closeSSE: () => void;

  // 当前活跃项目 id（来自 generation context）
  projectId: string | null;

  // Agent FSM 思维链事件流（PLAN/CODE/BUILD/QA/FIX/DONE/FAIL）
  agentEvents: AgentEventRow[];
  clearAgentEvents: () => void;
  /** Job currently driving progress / SSE filters. */
  activeJobId: string | null;
  /** Original job.createdAt — elapsed time must survive refresh. */
  activeJobStartedAt: string | null;
  /** Last known pipeline percent so a reload does not flash 0%. */
  resumePercent: number;

  // 失败任务
  failedJobs: Array<{
    id: string;
    type: 'generate' | 'build' | 'publish' | 'bench' | 'world_generate' | 'world_edit';
    status: 'failed';
    logKey: string | null;
    retryCount: number;
    createdAt: string;
  }>;
  loadFailedJobs: (sessionIdOverride?: string | null) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
  /** Cancel the active queued/running job (stops worker when it notices). */
  cancelActiveJob: () => Promise<void>;
  canCancelJob: boolean;
  /**
   * Project-wide queued/running jobs (any session) — drives the global job dock
   * so you can see what is blocking the worker queue.
   */
  liveProjectJobs: JobRow[];
  /** Running jobs on other projects. This worker only takes one at a time. */
  runningElsewhere: number;
  refreshLiveProjectJobs: () => Promise<void>;
  recoverStaleJobs: () => Promise<void>;
  /** Re-sign the current deployment preview after a process restart. */
  refreshPreview: () => Promise<void>;

  /** 组织下的项目列表（用于生成页切换） */
  projects: Project[];
  /** 当前选中的项目；会话与失败任务均属于该项目 */
  activeProjectId: string | null;
  selectProject: (projectId: string) => Promise<void>;
  createNewProject: (opts?: { silent?: boolean }) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;

  /** Agent 智能层：Brief / 会话摘要 / 记忆 */
  agentSessionContext: AgentSessionContext | null;
  refreshAgentContext: () => Promise<void>;
  saveBrief: (brief: Record<string, unknown>) => Promise<void>;

  /** 迭代历史（含 contentHash） */
  iterationRecords: IterationRecord[];
  lastSuccessJobId: string | null;
  /** Bumps when any job succeeds (world panel refresh / drawer reopen). */
  jobSuccessEpoch: number;
  lastSucceededJobType: string | null;

  /**
   * Set when the last attempt was refused for lack of generation points. Null
   * otherwise; the shells turn it into a top-up prompt.
   */
  outOfPoints: {
    readonly need: number;
    readonly balance: number;
    readonly sku?: string;
  } | null;
  dismissOutOfPoints: () => void;
}

export function useGeneration(): UseGenerationReturn {
  const { message: messageApi } = App.useApp();
  const { token, orgId } = useAppStore();
  const { t } = useT();

  // 对话消息列表
  const [messages, setMessages] = useState<Message[]>([]);

  // 生成状态
  const [generationState, setGenerationState] = useState<GenerationState>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [logKey, setLogKey] = useState<string | null>(null);
  const [logModalVisible, setLogModalVisible] = useState(false);

  // 代码变更
  const [codeChanges, setCodeChanges] = useState<FileChange[]>([]);

  // 任务阶段状态
  const [stageStatuses, setStageStatuses] = useState({
    generate: 'pending' as StageStatus,
    build: 'pending' as StageStatus,
    deploy: 'pending' as StageStatus,
  });

  // 会话相关
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // 失败任务
  const [failedJobs, setFailedJobs] = useState<FailedJobUiRow[]>([]);
  const [liveProjectJobs, setLiveProjectJobs] = useState<JobRow[]>([]);
  const [runningElsewhere, setRunningElsewhere] = useState(0);
  const rememberQueue = (res: { queue?: { runningElsewhere?: number } }) => {
    setRunningElsewhere(res.queue?.runningElsewhere ?? 0);
  };

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const [agentSessionContext, setAgentSessionContext] =
    useState<AgentSessionContext | null>(null);
  const [iterationRecords, setIterationRecords] = useState<IterationRecord[]>([]);
  const [lastSuccessJobId, setLastSuccessJobId] = useState<string | null>(null);
  const [jobSuccessEpoch, setJobSuccessEpoch] = useState(0);
  const [lastSucceededJobType, setLastSucceededJobType] = useState<string | null>(
    null,
  );

  // Agent FSM 思维链事件流，按 SSE 推送顺序累积；切会话时由 clearAgentEvents 重置
  const [agentEvents, setAgentEvents] = useState<AgentEventRow[]>([]);
  const clearAgentEvents = useCallback(() => setAgentEvents([]), []);

  // 保存当前生成的上下文
  const generationContextRef = useRef<{
    projectId: string;
    sessionId: string;
    lastPrompt: string;
  } | null>(null);

  /** 避免同一项目下重复执行「恢复会话」逻辑（与 createNewSession 清空标记配合）。 */
  const sessionRestoreMarkerRef = useRef<string | null>(null);
  /** sessions state 实际属于哪个 projectId，防止切项目时用旧列表误恢复。 */
  const sessionsProjectIdRef = useRef<string | null>(null);
  /** 与 activeProjectId 同步，供异步回调校验隔离。 */
  const activeProjectIdRef = useRef<string | null>(null);
  /** 切项目 / 清 UI 时递增；过期的 poll/SSE/selectSession 回调一律丢弃。 */
  const uiEpochRef = useRef(0);

  // 轮询定时器
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const jobPollVisibilityRef = useRef<(() => void) | null>(null);
  const resumedToastJobRef = useRef<string | null>(null);
  /** generate→build 之间的延迟查找，须在 clearPolling 时取消 */
  const buildFindTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 避免 3s 轮询与慢请求叠压导致同 tick 多次重入、主线程长任务告警 */
  const jobPollTickInFlightRef = useRef(false);
  const buildPollTickInFlightRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sseReconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseReconnectAttemptRef = useRef(0);
  /** 与 isLoading state 同步，供 sendMessage 同步互斥判断 */
  const isBusyRef = useRef(false);
  const activeJobIdRef = useRef<string | null>(null);
  /** Last deployment id whose preview URL was applied — skip reminting token churn. */
  const appliedPreviewDeploymentRef = useRef<string | null>(null);
  /** 当前生成 jobId（state 驱动轮询；ref 供 SSE 回调同步读取） */
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobStartedAt, setActiveJobStartedAt] = useState<string | null>(null);
  const [resumePercent, setResumePercent] = useState(0);
  /** selectSession 发现进行中 job 时挂接（poll/SSE 定义在后） */
  const attachLiveJobRef = useRef<
    ((projectId: string, job: JobRow, epoch: number) => void) | null
  >(null);
  const queuedSinceRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [jobLifecycleStatus, setJobLifecycleStatus] = useState<JobLifecycleStatus>('idle');
  const [queuedTimeoutHint, setQueuedTimeoutHint] = useState(false);
  /**
   * An empty wallet is not a failure the user can retry out of — it needs a
   * top-up. It is kept apart from the generic error text so both shells can
   * offer that one action instead of "try again".
   */
  const [outOfPoints, setOutOfPoints] = useState<{
    readonly need: number;
    readonly balance: number;
    readonly sku?: string;
  } | null>(null);
  const setBusy = useCallback((busy: boolean) => {
    isBusyRef.current = busy;
    setIsLoading(busy);
  }, []);

  const formatAssistFail = useCallback(
    (kind: 'generate' | 'build' | 'generic', logKey: string | null) => {
      const prefix =
        kind === 'build'
          ? t('generate.jobFailure.prefixBuild')
          : kind === 'generate'
            ? t('generate.jobFailure.prefixGenerate')
            : t('generate.jobFailure.prefixUnknown');
      const summary = summarizeJobLogKey(logKey) || t('generate.jobFailure.unknownDetail');
      const tail = t('generate.jobFailure.s3LogHint');
      return jobHasS3LogTail(logKey) ? `${prefix}${summary}\n\n${tail}` : `${prefix}${summary}`;
    },
    [t],
  );

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (buildFindTimeoutRef.current) {
      clearTimeout(buildFindTimeoutRef.current);
      buildFindTimeoutRef.current = null;
    }
    if (jobPollVisibilityRef.current) {
      document.removeEventListener('visibilitychange', jobPollVisibilityRef.current);
      jobPollVisibilityRef.current = null;
    }
  }, []);

  // 关闭 SSE 连接
  const closeSSE = useCallback(() => {
    if (sseReconnectTimeoutRef.current) {
      clearTimeout(sseReconnectTimeoutRef.current);
      sseReconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const bumpUiEpoch = useCallback(() => {
    uiEpochRef.current += 1;
    return uiEpochRef.current;
  }, []);

  /**
   * Progressive delivery: the worker publishes a preview as soon as the baseline
   * gate passes and keeps polishing. Once that lands we must not let later
   * BUILD/QA/FIX events drag the UI back to a spinner and hide the playable
   * iframe the user is already using.
   */
  const playableDeliveredRef = useRef(false);
  const [playableDraft, setPlayableDraft] = useState(false);
  /** After a terminal FAIL for the current job, ignore later FIX/CODE events that would revive the spinner. */
  const jobTerminalFailRef = useRef(false);

  /** 切项目 / 新会话时清空所有会串台的 UI + job 状态。 */
  const resetProjectScopedUi = useCallback(() => {
    closeSSE();
    clearPolling();
    setBusy(false);
    setCurrentSessionId(null);
    setMessages([]);
    setPreviewUrl(null);
    appliedPreviewDeploymentRef.current = null;
    setCodeChanges([]);
    setAgentEvents([]);
    setGenerationState('idle');
    setJobLifecycleStatus('idle');
    setQueuedTimeoutHint(false);
    setLogKey(null);
    setDeploymentId(null);
    activeJobIdRef.current = null;
    setActiveJobId(null);
    setActiveJobStartedAt(null);
    setResumePercent(0);
    playableDeliveredRef.current = false;
    setPlayableDraft(false);
    jobTerminalFailRef.current = false;
    queuedSinceRef.current = null;
    generationContextRef.current = null;
    setAgentSessionContext(null);
    setIterationRecords([]);
    setLastSuccessJobId(null);
    setLastSucceededJobType(null);
    setFailedJobs([]);
    setLiveProjectJobs([]);
    setStageStatuses({
      generate: 'pending',
      build: 'pending',
      deploy: 'pending',
    });
  }, [clearPolling, closeSSE, setBusy]);

  const { fetchEarlyPlayablePreview, fetchPreviewUrl } = useGenerationPreview({
    t,
    uiEpochRef,
    activeProjectIdRef,
    appliedPreviewDeploymentRef,
    setDeploymentId,
    setStageStatuses,
    setGenerationState,
    setPreviewUrl,
    setMessages,
  });

  // 登录后同步组织下的项目列表，并选定当前项目（优先恢复上次项目）
  useEffect(() => {
    if (!orgId) {
      setProjects([]);
      setActiveProjectId(null);
      activeProjectIdRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let list = (await api.projects.list()).projects;
        if (cancelled) return;
        if (list.length === 0) {
          const project = await api.projects.create(
            orgId,
            `Game ${new Date().toISOString().slice(0, 16)}`
          );
          if (cancelled) return;
          list = [project];
        }
        setProjects(list);
        setActiveProjectId((prev) => {
          if (prev && list.some((p) => p.id === prev)) return prev;
          const preferred = readLastProjectPreference();
          if (preferred && list.some((p) => p.id === preferred)) return preferred;
          return list[0].id;
        });
      } catch (e) {
        console.error('加载项目列表失败:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  // 获取或创建项目（依赖当前选中的项目；无选中时回退上次偏好 / 列表首项）
  const getOrCreateProject = useCallback(async (): Promise<string> => {
    if (!orgId) {
      throw new Error(t('generate.project.signInRequired'));
    }
    if (activeProjectId) {
      return activeProjectId;
    }
    try {
      const response = await api.projects.list();
      if (response.projects.length > 0) {
        setProjects(response.projects);
        const preferred = readLastProjectPreference();
        const chosen =
          preferred && response.projects.some((p) => p.id === preferred)
            ? preferred
            : response.projects[0].id;
        setActiveProjectId(chosen);
        activeProjectIdRef.current = chosen;
        return chosen;
      }
    } catch (e) {
      // 忽略，走创建
    }

    const project = await api.projects.create(
      orgId,
      `Game ${new Date().toISOString().slice(0, 16)}`
    );
    setProjects((prev) => (prev.some((p) => p.id === project.id) ? prev : [...prev, project]));
    setActiveProjectId(project.id);
    activeProjectIdRef.current = project.id;
    writeEditorLastProject(project.id);
    return project.id;
  }, [orgId, activeProjectId, t]);

  const buildIterationRecords = useCallback(
    (jobs: JobRow[], sessionId: string | null): IterationRecord[] => {
      const sessionJobs = jobs
        .filter(
          (j) =>
            j.sessionId === sessionId &&
            (j.type === 'generate' ||
              j.type === 'world_generate' ||
              j.type === 'world_edit') &&
            j.status === 'succeeded',
        )
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      return sessionJobs.map((job, idx) => {
        const payload = job.payload as { prompt?: string };
        const result = job.result;
        return {
          id: job.id,
          version: idx + 1,
          timestamp: job.createdAt,
          prompt: payload.prompt ?? '生成任务',
          changes: (result?.codeChanges ?? []).map((c) => ({
            filename: c.filename,
            type: c.type,
          })),
          status: 'success' as const,
          contentHash: result?.contentHash ?? job.buildCacheKey ?? undefined,
        };
      });
    },
    [],
  );

  const refreshAgentContext = useCallback(async () => {
    if (!activeProjectId) {
      setAgentSessionContext(null);
      return;
    }
    try {
      const ctx = await api.agent.sessionContext(
        activeProjectId,
        currentSessionId ?? undefined,
      );
      setAgentSessionContext({
        brief: ctx.brief,
        sessionSummary: ctx.sessionSummary,
        memories: ctx.memories,
      });
    } catch {
      setAgentSessionContext(null);
    }
  }, [activeProjectId, currentSessionId]);

  const saveBrief = useCallback(
    async (brief: Record<string, unknown>) => {
      if (!activeProjectId) return;
      await api.agent.patchBrief(activeProjectId, brief);
      await refreshAgentContext();
    },
    [activeProjectId, refreshAgentContext],
  );

  const syncSessionJobsMeta = useCallback(
    async (projectId: string, sessionId: string | null) => {
      const epoch = uiEpochRef.current;
      try {
        const jobsResp = await api.jobs.list(projectId);
        rememberQueue(jobsResp);
        if (
          uiEpochRef.current !== epoch ||
          activeProjectIdRef.current !== projectId
        ) {
          return;
        }
        setLiveProjectJobs(pickLiveProjectJobs(jobsResp.jobs));
        setIterationRecords(buildIterationRecords(jobsResp.jobs, sessionId));
        const latestSuccess = jobsResp.jobs
          .filter(
            (j) =>
              j.sessionId === sessionId &&
              j.type === 'generate' &&
              j.status === 'succeeded',
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0];
        setLastSuccessJobId(latestSuccess?.id ?? null);
      } catch {
        if (
          uiEpochRef.current === epoch &&
          activeProjectIdRef.current === projectId
        ) {
          setIterationRecords([]);
          setLastSuccessJobId(null);
          setLiveProjectJobs([]);
        }
      }
    },
    [buildIterationRecords],
  );

  const refreshLiveProjectJobs = useCallback(async () => {
    if (!activeProjectId) {
      setLiveProjectJobs([]);
      return;
    }
    await syncSessionJobsMeta(activeProjectId, currentSessionId);
  }, [activeProjectId, currentSessionId, syncSessionJobsMeta]);

  // 加载会话列表（绑定当前 activeProjectId，避免串项目）
  const loadSessions = useCallback(async () => {
    if (!orgId || !activeProjectId) return;
    const projectId = activeProjectId;
    const epoch = uiEpochRef.current;

    try {
      const response = await api.sessions.list(projectId);
      if (
        uiEpochRef.current !== epoch ||
        activeProjectIdRef.current !== projectId
      ) {
        return;
      }
      const sessionInfos: SessionInfo[] = response.sessions.map((s) => ({
        id: s.id,
        title: s.title || '新会话',
        updatedAt: s.createdAt,
        messageCount: 0,
        parentId: s.parentId ?? null,
      }));
      sessionsProjectIdRef.current = projectId;
      setSessions(sessionInfos);
    } catch (error) {
      console.error('加载会话失败:', error);
    }
  }, [orgId, activeProjectId]);

  // 选择会话
  const selectSession = useCallback(
    async (sessionId: string) => {
      if (!orgId) return;
      const projectId = activeProjectIdRef.current ?? activeProjectId;
      if (!projectId) return;

      const epoch = uiEpochRef.current;
      setCurrentSessionId(sessionId);

      try {
        const response = await api.sessions.messages(projectId, sessionId);
        if (
          uiEpochRef.current !== epoch ||
          activeProjectIdRef.current !== projectId
        ) {
          return;
        }

        const loadedMessages: Message[] = response.messages.map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.createdAt,
          status: 'success',
        }));

        setMessages(loadedMessages);

        const jobsResp = await api.jobs.list(projectId);
        rememberQueue(jobsResp);
        if (
          uiEpochRef.current !== epoch ||
          activeProjectIdRef.current !== projectId
        ) {
          return;
        }
        setFailedJobs(filterFailedJobsForUi(jobsResp.jobs, sessionId));
        setLiveProjectJobs(pickLiveProjectJobs(jobsResp.jobs));

        let liveJob = pickLiveSessionJob(jobsResp.jobs, sessionId);
        if (!liveJob) {
          const persistedId = readLiveJobPreference(projectId);
          if (persistedId) {
            liveJob = jobsResp.jobs.find(
              (j) =>
                j.id === persistedId &&
                (j.status === 'queued' || j.status === 'running'),
            );
          }
        }

        const deploymentsResponse = await api.deployments.list(projectId);
        if (
          uiEpochRef.current !== epoch ||
          activeProjectIdRef.current !== projectId
        ) {
          return;
        }

        const applyPreview = async (flipState: boolean) => {
          if (deploymentsResponse.deployments.length > 0) {
            const latestDeployment = deploymentsResponse.deployments[0];
            const previewResponse = await api.deployments.getPreviewUrl(
              latestDeployment.id,
            );
            if (
              uiEpochRef.current !== epoch ||
              activeProjectIdRef.current !== projectId
            ) {
              return;
            }
            if (appliedPreviewDeploymentRef.current !== latestDeployment.id) {
              appliedPreviewDeploymentRef.current = latestDeployment.id;
              setPreviewUrl(previewResponse.url);
            }
            setDeploymentId(latestDeployment.id);
            if (flipState) setGenerationState('preview');
          } else if (flipState) {
            setPreviewUrl(null);
            appliedPreviewDeploymentRef.current = null;
            setDeploymentId(null);
            setGenerationState('idle');
          }
        };

        if (liveJob) {
          // Keep any existing preview iframe, but do not flip to idle/preview
          // or the user thinks generation already finished.
          await applyPreview(false);
          attachLiveJobRef.current?.(projectId, liveJob, epoch);
        } else {
          await applyPreview(true);
          const snap = readLiveJobSnapshot(projectId);
          if (!snap || snap.sessionId === sessionId || !snap.sessionId) {
            writeLiveJobSnapshot(projectId, null);
            if (isBusyRef.current) {
              setBusy(false);
              activeJobIdRef.current = null;
              setActiveJobId(null);
              setActiveJobStartedAt(null);
              setResumePercent(0);
              setJobLifecycleStatus('idle');
            }
          }
          try {
            const replayJob = pickAgentReplayJob(jobsResp.jobs, sessionId);
            if (replayJob) {
              const ev = await api.jobs.agentEvents(projectId, replayJob.id);
              if (
                uiEpochRef.current === epoch &&
                activeProjectIdRef.current === projectId
              ) {
                setAgentEvents(ev.events);
              }
            }
          } catch (e) {
            console.warn('回放 agent-events 失败:', e);
          }
        }
        await refreshAgentContext();
        await syncSessionJobsMeta(projectId, sessionId);
        if (
          uiEpochRef.current === epoch &&
          activeProjectIdRef.current === projectId
        ) {
          writeEditorSessionPreference(projectId, sessionId);
        }
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          if (activeProjectIdRef.current === projectId) {
            writeEditorSessionPreference(projectId, null);
            sessionRestoreMarkerRef.current = null;
            setCurrentSessionId(null);
            setMessages([]);
            setPreviewUrl(null);
            setGenerationState('idle');
            messageApi.warning(t('generate.sessionStale'));
            try {
              await loadSessions();
            } catch {
              // ignore
            }
          }
        } else {
          console.error('加载会话消息失败:', error);
        }
      }
    },
    [
      orgId,
      activeProjectId,
      t,
      loadSessions,
      refreshAgentContext,
      syncSessionJobsMeta,
      messageApi,
    ]
  );

  // 创建新会话
  const createNewSession = useCallback(() => {
    bumpUiEpoch();
    resetProjectScopedUi();
    if (activeProjectId) {
      writeEditorSessionPreference(activeProjectId, null);
    }
    sessionRestoreMarkerRef.current = activeProjectId;
  }, [activeProjectId, bumpUiEpoch, resetProjectScopedUi]);

  // 删除会话
  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        const projectId = await getOrCreateProject();
        await api.sessions.delete(projectId, sessionId);
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (currentSessionId === sessionId) {
          createNewSession();
        }
      } catch (error) {
        console.error('Failed to delete session:', error);
        messageApi.error(t('generate.sessions.deleteFailed'));
      }
    },
    [currentSessionId, createNewSession, getOrCreateProject, messageApi, t]
  );

  const forkSession = useCallback(
    async (sessionId?: string) => {
      const sourceId = sessionId ?? currentSessionId;
      if (!sourceId) return;
      try {
        const projectId = await getOrCreateProject();
        const response = await api.sessions.fork(projectId, sourceId);
        await loadSessions();
        if (response.sessionId) {
          await selectSession(response.sessionId);
        }
        messageApi.success(t('generate.sessions.forked'));
      } catch (error) {
        console.error('Failed to fork session:', error);
        messageApi.error(t('generate.sessions.forkFailed'));
      }
    },
    [currentSessionId, getOrCreateProject, loadSessions, messageApi, selectSession, t],
  );

  const selectProject = useCallback(
    async (projectId: string) => {
      if (!orgId) return;
      if (projectId === activeProjectId) return;
      bumpUiEpoch();
      resetProjectScopedUi();
      sessionsProjectIdRef.current = null;
      setSessions([]);
      sessionRestoreMarkerRef.current = null;
      activeProjectIdRef.current = projectId;
      setActiveProjectId(projectId);
      writeEditorLastProject(projectId);
      const epoch = uiEpochRef.current;
      try {
        const response = await api.sessions.list(projectId);
        if (
          uiEpochRef.current !== epoch ||
          activeProjectIdRef.current !== projectId
        ) {
          return;
        }
        const sessionInfos: SessionInfo[] = response.sessions.map((s) => ({
          id: s.id,
          title: s.title || '新会话',
          updatedAt: s.createdAt,
          messageCount: 0,
          parentId: s.parentId ?? null,
        }));
        sessionsProjectIdRef.current = projectId;
        setSessions(sessionInfos);

        const jobsResp = await api.jobs.list(projectId);
        rememberQueue(jobsResp);
        if (
          uiEpochRef.current !== epoch ||
          activeProjectIdRef.current !== projectId
        ) {
          return;
        }
        setFailedJobs(filterFailedJobsForUi(jobsResp.jobs, null));
      } catch (error) {
        console.error('切换项目失败:', error);
        messageApi.error(t('generate.project.switchedFailed'));
      }
    },
    [orgId, activeProjectId, bumpUiEpoch, resetProjectScopedUi, messageApi, t]
  );

  const createNewProject = useCallback(async (opts?: { silent?: boolean }) => {
    if (!orgId) {
      messageApi.warning(t('generate.project.signInRequired'));
      return;
    }
    try {
      const project = await api.projects.create(
        orgId,
        `Game ${new Date().toISOString().slice(0, 16)}`
      );
      setProjects((prev) => [...prev, project]);
      await selectProject(project.id);
      if (!opts?.silent) {
        messageApi.success(t('generate.project.created'));
      }
    } catch (error) {
      console.error('创建项目失败:', error);
      messageApi.error(t('generate.project.createFailed'));
    }
  }, [orgId, selectProject, messageApi, t]);

  const deleteProject = useCallback(
    async (projectId: string) => {
      if (!orgId) {
        messageApi.warning(t('generate.project.signInRequired'));
        throw new Error('not logged in');
      }
      try {
        await api.projects.delete(projectId);
      } catch (error) {
        console.error('删除项目失败:', error);
        messageApi.error(t('generate.project.deleteFailed'));
        throw error;
      }
      const remaining = projects.filter((p) => p.id !== projectId);
      setProjects(remaining);
      writeLiveJobPreference(projectId, null);
      messageApi.success(t('generate.project.deleted'));
      if (activeProjectIdRef.current !== projectId) {
        return;
      }
      if (remaining[0]) {
        await selectProject(remaining[0].id);
        return;
      }
      await createNewProject({ silent: true });
    },
    [orgId, projects, selectProject, createNewProject, messageApi, t],
  );

  // 轮询任务状态
  const pollJobStatus = useCallback(
    async (
      jobId: string,
      projectId: string,
      resume?: {
        readonly status?: string;
        readonly createdAt?: string;
        readonly type?: string;
        readonly sessionId?: string | null;
        readonly keepPreview?: boolean;
      },
    ) => {
      // Duplicate SSE "succeeded" must not spawn parallel intervals or reset preview.
      if (pollingRef.current && activeJobIdRef.current === jobId) {
        return;
      }
      clearPolling();
      const epoch = uiEpochRef.current;
      activeJobIdRef.current = jobId;
      setActiveJobId(jobId);
      const startedAt = resume?.createdAt ?? new Date().toISOString();
      setActiveJobStartedAt(startedAt);
      patchLiveJobSnapshot(projectId, {
        jobId,
        ...(resume?.sessionId !== undefined ? { sessionId: resume.sessionId } : {}),
        ...(resume?.type ? { type: resume.type } : {}),
        status: resume?.status === 'running' ? 'running' : 'queued',
        createdAt: startedAt,
      });
      if (!resume?.keepPreview) {
        playableDeliveredRef.current = false;
        setPlayableDraft(false);
      }
      jobTerminalFailRef.current = false;
      if (resume?.status === 'running') {
        setJobLifecycleStatus('running');
        queuedSinceRef.current = null;
        setQueuedTimeoutHint(false);
      } else if (resume?.status === 'queued') {
        setJobLifecycleStatus('queued');
        queuedSinceRef.current = new Date(startedAt).getTime();
        setQueuedTimeoutHint(false);
      } else {
        queuedSinceRef.current = Date.now();
        setQueuedTimeoutHint(false);
        setJobLifecycleStatus('queued');
      }

      const checkStatus = async () => {
        if (jobPollTickInFlightRef.current) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        if (
          uiEpochRef.current !== epoch ||
          activeProjectIdRef.current !== projectId
        ) {
          return;
        }
        jobPollTickInFlightRef.current = true;
        try {
          // Poll the single job — avoid listing every project job every 3s.
          const job = await api.jobs.get(projectId, jobId);
          if (
            uiEpochRef.current !== epoch ||
            activeProjectIdRef.current !== projectId
          ) {
            return;
          }

          if (job.status === 'queued') {
            setJobLifecycleStatus('queued');
          } else if (job.status === 'running') {
            setJobLifecycleStatus('running');
            queuedSinceRef.current = null;
            setQueuedTimeoutHint(false);
          } else if (job.status === 'cancelled') {
            jobTerminalFailRef.current = true;
            setStageStatuses((prev) => ({
              ...prev,
              generate: 'error',
              build: 'error',
            }));
            setGenerationState('error');
            setLogKey(job.logKey);
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastIndex = newMessages.findLastIndex((m) => m.role === 'assistant');
              if (lastIndex !== -1) {
                newMessages[lastIndex] = {
                  ...newMessages[lastIndex],
                  status: 'error',
                  content: t('generate.jobCancelled'),
                };
              }
              return newMessages;
            });
            clearPolling();
            closeSSE();
            setBusy(false);
            setJobLifecycleStatus('failed');
            activeJobIdRef.current = null;
            setActiveJobId(null);
            writeLiveJobPreference(projectId, null);
            return;
          }

          if (job.type === 'generate') {
            if (job.status === 'succeeded') {
              setStageStatuses((prev) => ({
                ...prev,
                generate: 'success',
                build: 'active',
              }));
              setGenerationState('building');

              // 获取完整的 job 信息以获取 result
              let codeChanges: FileChange[] = [];
              try {
                const fullJob = await api.jobs.get(projectId, jobId);
                if (
                  uiEpochRef.current !== epoch ||
                  activeProjectIdRef.current !== projectId
                ) {
                  return;
                }
                const jobResult = fullJob.result as {
                  codeChanges?: Array<{
                    filename: string;
                    type: 'added' | 'modified' | 'deleted';
                    summary?: string;
                    diff?: string;
                  }>;
                  fileCount?: number;
                } | undefined;

                if (jobResult?.codeChanges) {
                  codeChanges = jobResult.codeChanges.map((c) => ({
                    filename: c.filename,
                    type: c.type as 'added' | 'modified' | 'deleted',
                    summary: c.summary,
                  }));
                }
              } catch (e) {
                console.error('Failed to fetch full job:', e);
              }

              setMessages((prev) => {
                const newMessages = [...prev];
                const lastIndex = newMessages.findLastIndex(
                  (m) => m.role === 'assistant' && m.status === 'sending'
                );
                if (lastIndex !== -1) {
                  newMessages[lastIndex] = {
                    ...newMessages[lastIndex],
                    status: 'success',
                    content: codeChanges.length > 0
                      ? `代码生成完成，生成了 ${codeChanges.length} 个文件，正在构建项目...`
                      : '代码生成完成，正在构建项目...',
                    codeChanges: codeChanges.length > 0 ? {
                      files: codeChanges.map(c => c.filename),
                      summary: `${codeChanges.filter(c => c.type === 'added').length} 新增, ${codeChanges.filter(c => c.type === 'modified').length} 修改, ${codeChanges.filter(c => c.type === 'deleted').length} 删除`,
                    } : undefined,
                  };
                }
                return newMessages;
              });

              // 设置真实的代码变更
              setCodeChanges(codeChanges);

              void refreshAgentContext();
              void syncSessionJobsMeta(projectId, job.sessionId);
              setLastSuccessJobId(jobId);
              setLastSucceededJobType(job.type);
              setJobSuccessEpoch((n) => n + 1);

              // 生成成功后，立即查找 build job 并开始轮询
              if (buildFindTimeoutRef.current) {
                clearTimeout(buildFindTimeoutRef.current);
              }
              buildFindTimeoutRef.current = setTimeout(async () => {
                buildFindTimeoutRef.current = null;
                if (
                  uiEpochRef.current !== epoch ||
                  activeProjectIdRef.current !== projectId
                ) {
                  return;
                }
                try {
                  const jobsResp = await api.jobs.list(projectId);
                  rememberQueue(jobsResp);
                  if (
                    uiEpochRef.current !== epoch ||
                    activeProjectIdRef.current !== projectId
                  ) {
                    return;
                  }
                  const buildJob = jobsResp.jobs.find(
                    (j) => j.type === 'build' && j.sessionId === job.sessionId
                  );
                    if (buildJob) {
                    activeJobIdRef.current = buildJob.id;
                    setActiveJobId(buildJob.id);
                    writeLiveJobPreference(projectId, buildJob.id);
                    // 使用新的 jobId 继续轮询（先停掉 generate 轮询，勿清掉其它超时）
                    if (pollingRef.current) {
                      clearInterval(pollingRef.current);
                      pollingRef.current = null;
                    }
                    pollingRef.current = setInterval(async () => {
                      if (buildPollTickInFlightRef.current) return;
                      if (typeof document !== 'undefined' && document.hidden) return;
                      if (
                        uiEpochRef.current !== epoch ||
                        activeProjectIdRef.current !== projectId
                      ) {
                        return;
                      }
                      buildPollTickInFlightRef.current = true;
                      try {
                      const bj = await api.jobs.get(projectId, buildJob.id);
                      if (
                        uiEpochRef.current !== epoch ||
                        activeProjectIdRef.current !== projectId
                      ) {
                        return;
                      }

                      if (bj.type === 'build') {
                        if (bj.status === 'succeeded') {
                          if (pollingRef.current) clearInterval(pollingRef.current);
                          setStageStatuses((prev) => ({
                            ...prev,
                            build: 'success',
                            deploy: 'active',
                          }));
                          setGenerationState('deploying');

                          // 获取部署预览 URL
                          const deploymentsResp = await api.deployments.list(projectId);
                          if (
                            uiEpochRef.current !== epoch ||
                            activeProjectIdRef.current !== projectId
                          ) {
                            return;
                          }
                          const latestDeployment = deploymentsResp.deployments[0];
                          if (latestDeployment) {
                            try {
                              const previewResp = await api.deployments.getPreviewUrl(
                                latestDeployment.id
                              );
                              if (
                                uiEpochRef.current !== epoch ||
                                activeProjectIdRef.current !== projectId
                              ) {
                                return;
                              }
                              if (
                                appliedPreviewDeploymentRef.current !==
                                latestDeployment.id
                              ) {
                                appliedPreviewDeploymentRef.current =
                                  latestDeployment.id;
                                setPreviewUrl(previewResp.url);
                              }
                              setDeploymentId(latestDeployment.id);
                              setStageStatuses((prev) => ({ ...prev, deploy: 'success' }));
                              setGenerationState('preview');

                              setMessages((prev) => {
                                const newMessages = [...prev];
                                const lastIndex = newMessages.findLastIndex(
                                  (m) => m.role === 'assistant'
                                );
                                if (lastIndex !== -1) {
                                  newMessages[lastIndex] = {
                                    ...newMessages[lastIndex],
                                    status: 'success',
                                    content: isWorldJobType(job.type)
                                      ? t('generate.preview.worldDeploySuccessHint')
                                      : t('generate.preview.deploySuccessHint'),
                                  };
                                }
                                return newMessages;
                              });
                            } catch (e) {
                              console.error('获取预览失败:', e);
                            }
                          }
                          setBusy(false);
                          setJobLifecycleStatus('done');
                        } else if (bj.status === 'failed') {
                          if (pollingRef.current) clearInterval(pollingRef.current);
                          setStageStatuses((prev) => ({ ...prev, build: 'error' }));
                          setGenerationState('error');
                          setLogKey(bj.logKey);

                          setMessages((prev) => {
                            const newMessages = [...prev];
                            const lastIndex = newMessages.findLastIndex(
                              (m) => m.role === 'assistant'
                            );
                            if (lastIndex !== -1) {
                              newMessages[lastIndex] = {
                                ...newMessages[lastIndex],
                                status: 'error',
                                content: formatAssistFail('build', bj.logKey ?? null),
                              };
                            }
                            return newMessages;
                          });
                          setBusy(false);
                          setJobLifecycleStatus('failed');
                        }
                      }
                      } finally {
                        buildPollTickInFlightRef.current = false;
                      }
                    }, 3000);
                  }
                } catch (e) {
                  console.error('查找 build job 失败:', e);
                }
              }, 100);
            } else if (job.status === 'failed') {
              setStageStatuses((prev) => ({ ...prev, generate: 'error' }));
              setGenerationState('error');
              setLogKey(job.logKey);

              setMessages((prev) => {
                const newMessages = [...prev];
                const lastIndex = newMessages.findLastIndex((m) => m.role === 'assistant');
                if (lastIndex !== -1) {
                  newMessages[lastIndex] = {
                    ...newMessages[lastIndex],
                    status: 'error',
                    content: formatAssistFail('generate', job.logKey ?? null),
                  };
                }
                return newMessages;
              });

              clearPolling();
              setBusy(false);
              setJobLifecycleStatus('failed');
              writeLiveJobPreference(projectId, null);
            }
          } else if (job.type === 'build') {
            if (job.status === 'succeeded') {
              setStageStatuses((prev) => ({
                ...prev,
                build: 'success',
                deploy: 'active',
              }));
              setGenerationState('deploying');
            } else if (job.status === 'failed') {
              setStageStatuses((prev) => ({ ...prev, build: 'error' }));
              setGenerationState('error');
              setLogKey(job.logKey);

              setMessages((prev) => {
                const newMessages = [...prev];
                const lastIndex = newMessages.findLastIndex((m) => m.role === 'assistant');
                if (lastIndex !== -1) {
                  newMessages[lastIndex] = {
                    ...newMessages[lastIndex],
                    status: 'error',
                    content: formatAssistFail('build', job.logKey ?? null),
                  };
                }
                return newMessages;
              });

              clearPolling();
              setBusy(false);
              setJobLifecycleStatus('failed');
            }
          }

          if (job.status === 'succeeded' || job.status === 'completed') {
            const worldJob = isWorldJobType(job.type);
            let targetDeploymentId: string | null = null;
            try {
              const fullJob = await api.jobs.get(projectId, jobId);
              const jobResult = fullJob.result as { deploymentId?: string } | null | undefined;
              if (jobResult?.deploymentId) {
                targetDeploymentId = jobResult.deploymentId;
              }
            } catch {
              // fall through to list
            }
            if (!targetDeploymentId) {
              const deploymentsResponse = await api.deployments.list(projectId);
              targetDeploymentId = deploymentsResponse.deployments[0]?.id ?? null;
            }

            if (targetDeploymentId) {
              try {
                if (appliedPreviewDeploymentRef.current === targetDeploymentId) {
                  setDeploymentId(targetDeploymentId);
                  setStageStatuses((prev) => ({ ...prev, deploy: 'success' }));
                  setGenerationState('preview');
                } else {
                const previewResponse = await api.deployments.getPreviewUrl(
                  targetDeploymentId,
                );
                appliedPreviewDeploymentRef.current = targetDeploymentId;
                setPreviewUrl(previewResponse.url);
                setDeploymentId(targetDeploymentId);
                setStageStatuses((prev) => ({ ...prev, deploy: 'success' }));
                setGenerationState('preview');

                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastIndex = newMessages.findLastIndex(
                    (m) => m.role === 'assistant',
                  );
                  if (lastIndex !== -1) {
                    newMessages[lastIndex] = {
                      ...newMessages[lastIndex],
                      status: 'success',
                      content: worldJob
                        ? t('generate.preview.worldDeploySuccessHint')
                        : t('generate.preview.deploySuccessHint'),
                    };
                  }
                  return newMessages;
                });
                }
              } catch (e) {
                console.error('获取预览失败:', e);
                setGenerationState(worldJob ? 'preview' : 'error');
              }
            }
            setLastSuccessJobId(jobId);
            setLastSucceededJobType(job.type);
            setJobSuccessEpoch((n) => n + 1);
            clearPolling();
            setBusy(false);
            setJobLifecycleStatus('done');
            writeLiveJobPreference(projectId, null);
            try {
              const allJobs = await api.jobs.list(projectId);
              rememberQueue(allJobs);
              setFailedJobs(
                filterFailedJobsForUi(allJobs.jobs, job.sessionId ?? null),
              );
            } catch {
              // ignore
            }
          } else if (
            job.status === 'failed' &&
            isWorldJobType(job.type)
          ) {
            setStageStatuses((prev) => ({ ...prev, generate: 'error', build: 'error' }));
            setGenerationState('error');
            setLogKey(job.logKey);
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastIndex = newMessages.findLastIndex((m) => m.role === 'assistant');
              if (lastIndex !== -1) {
                newMessages[lastIndex] = {
                  ...newMessages[lastIndex],
                  status: 'error',
                  content: formatAssistFail('generate', job.logKey ?? null),
                };
              }
              return newMessages;
            });
            clearPolling();
            setBusy(false);
            setJobLifecycleStatus('failed');
            writeLiveJobPreference(projectId, null);
            try {
              const allJobs = await api.jobs.list(projectId);
              rememberQueue(allJobs);
              setFailedJobs(
                filterFailedJobsForUi(allJobs.jobs, job.sessionId ?? null),
              );
            } catch {
              // ignore
            }
          }
        } catch (error) {
          console.error('轮询任务状态失败:', error);
        } finally {
          jobPollTickInFlightRef.current = false;
        }
      };

      await checkStatus();
      pollingRef.current = setInterval(checkStatus, 3000);
      const onJobPollVisible = () => {
        if (!document.hidden) void checkStatus();
      };
      document.addEventListener('visibilitychange', onJobPollVisible);
      jobPollVisibilityRef.current = onJobPollVisible;
    },
    [clearPolling, closeSSE, setBusy, formatAssistFail, t, refreshAgentContext, syncSessionJobsMeta]
  );
  const setupSSE = useCallback(
    async (projectId: string) => {
      closeSSE();
      const epoch = uiEpochRef.current;

      // 等待 token 准备好
      const token = useAppStore.getState().token;
      if (!token) return;

      const ticket = await api.auth.mintSseQueryTicket();
      if (!ticket) return;

      const base =
        typeof window !== 'undefined'
          ? import.meta.env.VITE_API_BASE_URL?.trim() || window.location.origin
          : import.meta.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:3847';
      const url = `${base.replace(/\/$/, '')}/v1/projects/${projectId}/events?sse_ticket=${encodeURIComponent(ticket)}`;
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      const isStale = () =>
        uiEpochRef.current !== epoch ||
        activeProjectIdRef.current !== projectId ||
        eventSourceRef.current !== eventSource;

      eventSource.onopen = () => {
        if (isStale()) return;
        sseReconnectAttemptRef.current = 0;
      };

      eventSource.onerror = () => {
        eventSource.close();
        if (eventSourceRef.current === eventSource) {
          eventSourceRef.current = null;
        }
        if (isStale()) return;
        if (sseReconnectTimeoutRef.current) {
          return;
        }
        const next = sseReconnectAttemptRef.current + 1;
        if (next > 8) {
          sseReconnectAttemptRef.current = next;
          if (next === 9) {
            console.warn(
              'SSE: stopped reconnecting after repeated failures; job progress will use polling.',
            );
          }
          return;
        }
        sseReconnectAttemptRef.current = next;
        const delay = Math.min(30000, 800 * 2 ** Math.min(next - 1, 6));
        sseReconnectTimeoutRef.current = setTimeout(() => {
          sseReconnectTimeoutRef.current = null;
          if (
            uiEpochRef.current !== epoch ||
            activeProjectIdRef.current !== projectId
          ) {
            return;
          }
          void setupSSE(projectId);
        }, delay);
      };

      eventSource.addEventListener('initial', (e) => {
        if (isStale()) return;
        try {
          const data = JSON.parse(e.data);
          if (data.jobs && Array.isArray(data.jobs)) {
            data.jobs.forEach((job: any) => {
              if (job.status === 'running') {
                setStageStatuses((prev) => {
                  if (job.type === 'generate') return { ...prev, generate: 'active' };
                  if (job.type === 'build') return { ...prev, build: 'active' };
                  return prev;
                });
              }
            });
          }
        } catch (err) {
          console.error('SSE initial parse error:', err);
        }
      });

      eventSource.addEventListener('job-update', (e) => {
        if (isStale()) return;
        try {
          const data = JSON.parse(e.data);
          if (data.jobs && Array.isArray(data.jobs)) {
            data.jobs.forEach((job: any) => {
              if (job.type === 'generate') {
                if (job.status === 'succeeded') {
                  setStageStatuses((prev) => ({ ...prev, generate: 'success' }));
                  pollJobStatus(job.id, projectId);
                } else if (job.status === 'failed') {
                  setStageStatuses((prev) => ({ ...prev, generate: 'error' }));
                  setGenerationState('error');
                  setLogKey(job.logKey ?? null);
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIndex = newMessages.findLastIndex((m) => m.role === 'assistant');
                    if (lastIndex !== -1) {
                      newMessages[lastIndex] = {
                        ...newMessages[lastIndex],
                        status: 'error',
                        content: formatAssistFail('generate', job.logKey ?? null),
                      };
                    }
                    return newMessages;
                  });
                  clearPolling();
                  setBusy(false);
                } else if (job.status === 'running') {
                  setStageStatuses((prev) => ({ ...prev, generate: 'active' }));
                  setGenerationState('generating');
                }
              } else if (job.type === 'build') {
                if (job.status === 'succeeded') {
                  setStageStatuses((prev) => ({ ...prev, build: 'success', deploy: 'active' }));
                  setGenerationState('deploying');
                  fetchPreviewUrl(projectId);
                } else if (job.status === 'failed') {
                  setStageStatuses((prev) => ({ ...prev, build: 'error' }));
                  setGenerationState('error');
                  setLogKey(job.logKey ?? null);
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIndex = newMessages.findLastIndex((m) => m.role === 'assistant');
                    if (lastIndex !== -1) {
                      newMessages[lastIndex] = {
                        ...newMessages[lastIndex],
                        status: 'error',
                        content: formatAssistFail('build', job.logKey ?? null),
                      };
                    }
                    return newMessages;
                  });
                  clearPolling();
                  setBusy(false);
                } else if (job.status === 'running') {
                  setStageStatuses((prev) => ({ ...prev, build: 'active' }));
                  setGenerationState('building');
                }
              } else if (
                job.type === 'world_generate' ||
                job.type === 'world_edit'
              ) {
                if (job.status === 'succeeded') {
                  setStageStatuses((prev) => ({ ...prev, generate: 'success' }));
                  pollJobStatus(job.id, projectId);
                } else if (job.status === 'failed') {
                  setStageStatuses((prev) => ({ ...prev, generate: 'error' }));
                  setGenerationState('error');
                  setLogKey(job.logKey ?? null);
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIndex = newMessages.findLastIndex(
                      (m) => m.role === 'assistant',
                    );
                    if (lastIndex !== -1) {
                      newMessages[lastIndex] = {
                        ...newMessages[lastIndex],
                        status: 'error',
                        content: formatAssistFail('generate', job.logKey ?? null),
                      };
                    }
                    return newMessages;
                  });
                  clearPolling();
                  setBusy(false);
                } else if (job.status === 'running') {
                  setStageStatuses((prev) => ({ ...prev, generate: 'active' }));
                  setGenerationState('generating');
                }
              }
            });
          }
        } catch (err) {
          console.error('SSE job-update parse error:', err);
        }
      });

      // Agent FSM 思维链：PLAN/CODE/BUILD/QA/FIX/DONE/FAIL 实时流
      eventSource.addEventListener('agent-event', (e) => {
        if (isStale()) return;
        try {
          const data = JSON.parse(e.data) as {
            jobId: string;
            projectId: string;
            sessionId: string | null;
            role: AgentEventRow['role'];
            phase: AgentEventRow['phase'];
            tool?: string;
            seq: number;
            summary?: string;
            details?: Record<string, unknown>;
            elapsedMs?: number;
            ts?: number;
          };
          const focusJobId = activeJobIdRef.current;
          // Drop events until we know which job we are tracking; ignore foreign jobs.
          if (!focusJobId || data.jobId !== focusJobId) {
            return;
          }
          const row: AgentEventRow = {
            id: `${data.jobId}-${data.role}-${data.phase}-${data.seq}`,
            jobId: data.jobId,
            projectId: data.projectId,
            sessionId: data.sessionId,
            role: data.role,
            phase: data.phase,
            tool: data.tool ?? null,
            seq: data.seq,
            summary: data.summary ?? null,
            details: data.details ?? null,
            elapsedMs: data.elapsedMs ?? null,
            createdAt: new Date(data.ts ?? Date.now()).toISOString(),
          };
          setAgentEvents((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            return [...prev, row];
          });
          // ChangePlan confirm strip → chat bubble (not only AgentTimeline)
          if (
            row.phase === 'PLAN' &&
            row.details &&
            (row.details['confirmBar'] === true ||
              typeof row.details['confirmLabel'] === 'string')
          ) {
            const strip =
              (typeof row.details['confirmLabel'] === 'string'
                ? row.details['confirmLabel']
                : row.summary) ?? '';
            if (strip) {
              setMessages((prev) => {
                const newMessages = [...prev];
                const lastIndex = newMessages.findLastIndex(
                  (m) => m.role === 'assistant',
                );
                if (lastIndex !== -1) {
                  newMessages[lastIndex] = {
                    ...newMessages[lastIndex],
                    confirmStrip: strip,
                    content:
                      newMessages[lastIndex]!.status === 'sending'
                        ? strip
                        : newMessages[lastIndex]!.content,
                  };
                }
                return newMessages;
              });
            }
          }
          // Friendly outline note in chat
          if (
            row.phase === 'PLAN' &&
            Array.isArray(row.details?.['npcs']) &&
            Array.isArray(row.details?.['quests'])
          ) {
            const npcN = (row.details['npcs'] as unknown[]).length;
            const questN = (row.details['quests'] as unknown[]).length;
            const note = t('generate.outline.ready', {
              npcs: npcN,
              quests: questN,
            });
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastIndex = newMessages.findLastIndex(
                (m) => m.role === 'assistant',
              );
              if (lastIndex !== -1 && newMessages[lastIndex]!.status === 'sending') {
                newMessages[lastIndex] = {
                  ...newMessages[lastIndex],
                  content: note,
                };
              }
              return newMessages;
            });
          }
          // 阶段语义到 UI 状态机的映射（避免依赖 jobs 轮询的延迟）
          if (row.phase === 'PREVIEW') {
            const refined = playableDeliveredRef.current;
            const detailDep =
              row.details &&
              typeof row.details === 'object' &&
              typeof (row.details as { deploymentId?: unknown }).deploymentId ===
                'string'
                ? (row.details as { deploymentId: string }).deploymentId
                : null;
            playableDeliveredRef.current = true;
            setPlayableDraft(true);
            if (
              detailDep &&
              appliedPreviewDeploymentRef.current === detailDep
            ) {
              // Same deployment already live — do not remint signed URL / remount iframe.
            } else {
              void fetchEarlyPlayablePreview(projectId, refined);
            }
          } else if (playableDeliveredRef.current && row.phase !== 'DONE' && row.phase !== 'FAIL') {
            // Keep the live preview visible while polish rounds continue.
            if (row.phase === 'CURATE') void refreshAgentContext();
          } else if (row.phase === 'BUILD' || row.phase === 'QA') {
            if (jobTerminalFailRef.current) return;
            setGenerationState('building');
            setStageStatuses((prev) => ({ ...prev, generate: 'success', build: 'active' }));
          } else if (
            row.phase === 'CODE' ||
            row.phase === 'FIX' ||
            row.phase === 'PLAN' ||
            row.phase === 'INTENT' ||
            row.phase === 'WORLD'
          ) {
            if (jobTerminalFailRef.current) return;
            setGenerationState('generating');
            setStageStatuses((prev) => ({ ...prev, generate: 'active' }));
          } else if (row.phase === 'CURATE') {
            void refreshAgentContext();
          } else if (row.phase === 'DONE') {
            const summary = row.summary ?? '';
            // Worker used to emit DONE on build failure — treat as terminal error.
            if (/失败|failed|error/i.test(summary)) {
              jobTerminalFailRef.current = true;
              setGenerationState('error');
              setStageStatuses((prev) => ({
                ...prev,
                generate: 'error',
                build: 'error',
              }));
              clearPolling();
              setBusy(false);
              setJobLifecycleStatus('failed');
            } else {
              setStageStatuses((prev) => ({ ...prev, build: 'success', deploy: 'active' }));
              setGenerationState('deploying');
              const doneDep =
                row.details &&
                typeof row.details === 'object' &&
                typeof (row.details as { deploymentId?: unknown }).deploymentId ===
                  'string'
                  ? (row.details as { deploymentId: string }).deploymentId
                  : undefined;
              void fetchPreviewUrl(projectId, {
                force: true,
                deploymentId: doneDep,
              }).finally(() => {
                setBusy(false);
                setPlayableDraft(false);
              });
            }
          } else if (row.phase === 'FAIL') {
            jobTerminalFailRef.current = true;
            setGenerationState('error');
            setStageStatuses((prev) => ({ ...prev, generate: 'error', build: 'error' }));
            clearPolling();
            setBusy(false);
            setPlayableDraft(false);
            setJobLifecycleStatus('failed');
            const detailMsg =
              typeof row.details?.['message'] === 'string'
                ? (row.details['message'] as string).trim()
                : '';
            const suggestions = Array.isArray(row.details?.['suggestedPrompts'])
              ? (row.details['suggestedPrompts'] as unknown[])
                  .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
                  .slice(0, 4)
              : [];
            const line = (row.summary?.trim() || detailMsg) ?? '';
            const tip =
              suggestions.length > 0
                ? `\n\n${t('generate.failedJobs.useSuggestionHint')}\n${suggestions
                    .map((p, i) => `${i + 1}. ${p}`)
                    .join('\n')}`
                : '';
            const content = line
              ? `${t('generate.jobFailure.prefixGenerate')}${line}${tip}`
              : t('generate.jobFailure.agentFail');
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastIndex = newMessages.findLastIndex((m) => m.role === 'assistant');
              if (lastIndex !== -1) {
                newMessages[lastIndex] = {
                  ...newMessages[lastIndex],
                  status: 'error',
                  content,
                  suggestedPrompts:
                    suggestions.length > 0 ? suggestions : undefined,
                };
              }
              return newMessages;
            });
          }
        } catch (err) {
          console.error('SSE agent-event parse error:', err);
        }
      });

      eventSourceRef.current = eventSource;
    },
    [
      closeSSE,
      pollJobStatus,
      fetchPreviewUrl,
      fetchEarlyPlayablePreview,
      formatAssistFail,
      clearPolling,
      setBusy,
      t,
      refreshAgentContext,
    ]
  );

  // 刷新 / 重进会话时续接进行中的 job（poll/SSE 定义在后，经 ref 挂接）
  useEffect(() => {
    attachLiveJobRef.current = (projectId, job, epoch) => {
      if (
        uiEpochRef.current !== epoch ||
        activeProjectIdRef.current !== projectId
      ) {
        return;
      }
      const isBuild = job.type === 'build';
      const startedAt = job.createdAt;
      setBusy(true);
      setActiveJobStartedAt(startedAt);
      setJobLifecycleStatus(job.status === 'queued' ? 'queued' : 'running');
      queuedSinceRef.current =
        job.status === 'queued' ? new Date(startedAt).getTime() : null;
      setGenerationState(generationStateForResume(job.type, null));
      if (isBuild) {
        setStageStatuses({
          generate: 'success',
          build: 'active',
          deploy: 'pending',
        });
      } else {
        setStageStatuses({
          generate: 'active',
          build: 'pending',
          deploy: 'pending',
        });
      }
      const prior = readLiveJobSnapshot(projectId);
      if (prior?.jobId === job.id) {
        setResumePercent(prior.visualPercent);
      }
      patchLiveJobSnapshot(projectId, {
        jobId: job.id,
        sessionId: job.sessionId,
        type: job.type,
        status: job.status === 'queued' ? 'queued' : 'running',
        createdAt: startedAt,
      });
      void api.jobs
        .agentEvents(projectId, job.id)
        .then((ev) => {
          if (
            uiEpochRef.current !== epoch ||
            activeProjectIdRef.current !== projectId
          ) {
            return;
          }
          setAgentEvents(ev.events);
          const phase = getEffectivePhase(ev.events);
          setGenerationState(generationStateForResume(job.type, phase));
        })
        .catch(() => {
          // ignore — polling / SSE 仍会补
        });
      void setupSSE(projectId);
      void pollJobStatus(job.id, projectId, {
        status: job.status,
        createdAt: startedAt,
        type: job.type,
        sessionId: job.sessionId,
        keepPreview: true,
      });
      if (resumedToastJobRef.current !== job.id) {
        resumedToastJobRef.current = job.id;
        messageApi.info(t('generate.progress.resumedJob'));
      }
    };
  }, [pollJobStatus, setupSSE, setBusy, messageApi, t]);

  // 发送消息
  const sendMessage = useCallback(
    async (
      content: string,
      gameParams?: GameParamsConfig,
      images?: string[],
      mode: 'game' | 'world' | 'world_edit' = 'game',
    ) => {
      if (!content.trim() && (!images || images.length === 0)) {
        messageApi.warning('请输入内容或上传图片');
        return;
      }

      if (!token) {
        messageApi.warning(t('generate.project.signInRequired'));
        return;
      }

      if (isBusyRef.current) {
        messageApi.warning('请等待当前生成完成');
        return;
      }

      setBusy(true);

      // 添加用户消息（包含图片）
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: content || (images && images.length > 0 ? '[图片]' : ''),
        timestamp: new Date().toISOString(),
        status: 'success',
        images,
      };
      setMessages((prev) => [...prev, userMessage]);

      // 添加 AI 消息（占位）
      const aiMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content:
          mode === 'game'
            ? '正在理解你的需求，开始生成游戏代码...'
            : '正在构建 / 编辑持久世界（World Spec）…',
        timestamp: new Date().toISOString(),
        status: 'sending',
      };
      setMessages((prev) => [...prev, aiMessage]);

      setErrorMessage(null);
      setPreviewUrl(null);
      appliedPreviewDeploymentRef.current = null;
      setLogKey(null);
      setCodeChanges([]);
      setStageStatuses({
        generate: 'active',
        build: 'pending',
        deploy: 'pending',
      });
      setGenerationState('generating');

      try {
        const projectId = await getOrCreateProject();
        // 清空上一轮 agent 思维链，准备新的 FSM 流
        setAgentEvents([]);
        // 启动 SSE 监听（agent-event + job-update），失败时自动降级为轮询
        setupSSE(projectId);

        // Never send a sessionId that isn't in the current project's list (stale
        // restore / DB wipe → API 400 invalid session).
        let sessionForSend =
          currentSessionId && sessions.some((s) => s.id === currentSessionId)
            ? currentSessionId
            : undefined;
        if (currentSessionId && !sessionForSend) {
          setCurrentSessionId(null);
          writeEditorSessionPreference(projectId, null);
        }

        const sendOnce = (sessionId?: string) =>
          api.messages.send(
            projectId,
            content,
            sessionId,
            gameParams,
            images,
            mode,
          );

        let response: { jobId: string; sessionId: string; jobType?: string };
        try {
          response = await sendOnce(sessionForSend);
        } catch (firstErr) {
          const errMsg =
            firstErr instanceof ApiError
              ? firstErr.message
              : axios.isAxiosError(firstErr)
                ? String(
                    (firstErr.response?.data as { error?: string } | undefined)
                      ?.error ?? firstErr.message,
                  )
                : firstErr instanceof Error
                  ? firstErr.message
                  : '';
          const staleSession =
            /invalid session/i.test(errMsg) ||
            (firstErr instanceof ApiError &&
              firstErr.code === 'INVALID_INPUT' &&
              firstErr.details?.['reason'] === 'session_not_found');
          if (!staleSession || !sessionForSend) {
            throw firstErr;
          }
          // Auto-recover: drop stale session and let API create a fresh one.
          setCurrentSessionId(null);
          writeEditorSessionPreference(projectId, null);
          messageApi.warning(t('generate.sessionStale'));
          response = await sendOnce(undefined);
        }

        const { jobId, sessionId } = response;
        activeJobIdRef.current = jobId;
        setActiveJobId(jobId);

        generationContextRef.current = {
          projectId,
          sessionId,
          lastPrompt: content,
        };

        // 更新当前会话 ID
        setCurrentSessionId(sessionId);

        // 刷新会话列表
        await loadSessions();

        writeEditorSessionPreference(projectId, sessionId);

        await pollJobStatus(jobId, projectId);
      } catch (error) {
        setGenerationState('error');
        if (
          error instanceof ApiError &&
          error.code === 'QUOTA_EXCEEDED' &&
          typeof error.details?.['needPoints'] === 'number'
        ) {
          setOutOfPoints({
            need: error.details['needPoints'] as number,
            balance: Number(error.details['balance'] ?? 0),
            sku: typeof error.details['recommendSku'] === 'string'
              ? (error.details['recommendSku'] as string)
              : 'pack_kai',
          });
        }
        const detail =
          error instanceof ApiError
            ? translateApiError(error)
            : axios.isAxiosError(error) && error.response?.data
              ? translateApiError({
                  code: (error.response.data as { code?: string }).code,
                  message: String(
                    (error.response.data as { error?: string }).error ??
                      error.message,
                  ),
                  details: (error.response.data as { details?: Record<string, unknown> })
                    .details,
                })
              : error instanceof Error
                ? error.message
                : '生成启动失败';
        setLogKey(detail);

        setMessages((prev) => {
          const newMessages = [...prev];
          const lastIndex = newMessages.findLastIndex((m) => m.role === 'assistant');
          if (lastIndex !== -1) {
            newMessages[lastIndex] = {
              ...newMessages[lastIndex],
              status: 'error',
              content: detail,
            };
          }
          return newMessages;
        });

        setBusy(false);
      }
    },
    [
      token,
      getOrCreateProject,
      pollJobStatus,
      loadSessions,
      currentSessionId,
      sessions,
      setupSSE,
      setBusy,
      messageApi,
      t,
    ]
  );

  // 气泡菜单「重新生成」：优先本次会话 lastPrompt，否则取最近一条用户消息
  const retryLastMessage = useCallback(async () => {
    const fromCtx = generationContextRef.current?.lastPrompt?.trim();
    const fromMessages = [...messages]
      .reverse()
      .find((m) => m.role === 'user' && m.content.trim())
      ?.content.trim();
    const prompt = fromCtx || fromMessages;
    if (!prompt) {
      messageApi.warning('没有可重新生成的上一条需求');
      return;
    }
    if (isLoading) {
      messageApi.info('正在生成中，请稍候再试');
      return;
    }
    await sendMessage(prompt);
  }, [sendMessage, messages, isLoading, messageApi]);

  // 加载失败任务列表
  const loadFailedJobs = useCallback(
    async (sessionIdOverride?: string | null) => {
      try {
        const projectId = activeProjectId ?? (await getOrCreateProject());
        const response = await api.jobs.list(projectId);
        rememberQueue(response);
        const focus =
          sessionIdOverride !== undefined ? sessionIdOverride : currentSessionId;
        setFailedJobs(filterFailedJobsForUi(response.jobs, focus));
        setLiveProjectJobs(pickLiveProjectJobs(response.jobs));
      } catch (error) {
        console.error('加载失败任务失败:', error);
      }
    },
    [getOrCreateProject, activeProjectId, currentSessionId],
  );

  const recoverStaleJobs = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const res = await api.jobs.staleRecover(activeProjectId);
      if (res.recovered === 0 && (res.runningElsewhere ?? 0) > 0) {
        messageApi.info(
          t('generate.progress.queuedBehindOther', { count: res.runningElsewhere ?? 0 }),
        );
      } else {
        messageApi.success(
          t('generate.liveJobs.staleRecovered', { count: res.recovered }),
        );
      }
      await loadFailedJobs();
    } catch (error) {
      messageApi.error(
        t('generate.liveJobs.staleRecoverFailed', {
          msg: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }, [activeProjectId, messageApi, t, loadFailedJobs]);

  // 重试失败任务
  const retryJob = useCallback(
    async (jobId: string) => {
      const attachChild = async (
        projectId: string,
        childId: string,
        already: boolean,
      ): Promise<void> => {
        messageApi.success(
          already ? t('generate.jobs.alreadyRequeued') : t('generate.jobs.retried'),
        );
        setFailedJobs((prev) => prev.filter((j) => j.id !== jobId));
        clearAgentEvents();
        setBusy(true);
        setGenerationState('generating');
        setJobLifecycleStatus('queued');
        activeJobIdRef.current = childId;
        setActiveJobId(childId);
        await pollJobStatus(childId, projectId);
      };

      try {
        const projectId = await getOrCreateProject();
        const { jobId: newJobId, already } = await api.jobs.retry(projectId, jobId);
        await attachChild(projectId, newJobId, Boolean(already));
      } catch (error) {
        const childId = followRetryJobId(error);
        if (childId) {
          try {
            const projectId = await getOrCreateProject();
            await attachChild(projectId, childId, true);
            return;
          } catch (followErr) {
            console.error('跟上已重试任务失败:', followErr);
          }
        }
        console.error('重试任务失败:', error);
        messageApi.error(t('generate.jobs.retryFailed'));
        setBusy(false);
      }
    },
    [getOrCreateProject, pollJobStatus, setBusy, clearAgentEvents, messageApi, t]
  );

  const cancelActiveJob = useCallback(async () => {
    const projectId = activeProjectIdRef.current ?? activeProjectId;
    const jobId = activeJobIdRef.current ?? activeJobId;
    if (!projectId || !jobId) {
      messageApi.warning(t('generate.cancel.none'));
      return;
    }
    try {
      await api.jobs.cancel(projectId, jobId);
      jobTerminalFailRef.current = true;
      clearPolling();
      closeSSE();
      setBusy(false);
      setJobLifecycleStatus('failed');
      setGenerationState('error');
      setStageStatuses((prev) => ({
        ...prev,
        generate: 'error',
        build: 'error',
      }));
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastIndex = newMessages.findLastIndex((m) => m.role === 'assistant');
        if (lastIndex !== -1) {
          newMessages[lastIndex] = {
            ...newMessages[lastIndex],
            status: 'error',
            content: t('generate.jobCancelled'),
          };
        }
        return newMessages;
      });
      activeJobIdRef.current = null;
      setActiveJobId(null);
      writeLiveJobPreference(projectId, null);
      messageApi.success(t('generate.cancel.success'));
      try {
        const allJobs = await api.jobs.list(projectId);
        rememberQueue(allJobs);
        setFailedJobs(filterFailedJobsForUi(allJobs.jobs, currentSessionId));
        setLiveProjectJobs(pickLiveProjectJobs(allJobs.jobs));
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('中止任务失败:', error);
      messageApi.error(t('generate.cancel.failed'));
    }
  }, [
    activeProjectId,
    activeJobId,
    currentSessionId,
    clearPolling,
    closeSSE,
    setBusy,
    messageApi,
    t,
  ]);

  // 重置对话
  const resetConversation = useCallback(() => {
    bumpUiEpoch();
    resetProjectScopedUi();
    if (activeProjectId) {
      writeEditorSessionPreference(activeProjectId, null);
    }
    sessionRestoreMarkerRef.current = activeProjectId;
  }, [activeProjectId, bumpUiEpoch, resetProjectScopedUi]);

  // 临时错误状态
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 打开/关闭日志弹窗
  const openLogModal = useCallback((key: string) => {
    setLogKey(key);
    setLogModalVisible(true);
  }, []);

  const closeLogModal = useCallback(() => {
    setLogModalVisible(false);
  }, []);

  // 当前项目变化时加载会话列表；并记下 lastProject 以便刷新恢复
  useEffect(() => {
    if (!activeProjectId) return;
    writeEditorLastProject(activeProjectId);
    void loadSessions();
  }, [activeProjectId, loadSessions]);

  // 切换项目后允许重新做一次「恢复上次会话」
  useEffect(() => {
    sessionRestoreMarkerRef.current = null;
  }, [activeProjectId]);

  // Drop session ids that no longer belong to this project's session list.
  useEffect(() => {
    if (!currentSessionId) return;
    if (sessionsProjectIdRef.current !== activeProjectId) return;
    if (sessions.length === 0) return;
    if (!sessions.some((s) => s.id === currentSessionId)) {
      setCurrentSessionId(null);
      if (activeProjectId) {
        writeEditorSessionPreference(activeProjectId, null);
      }
    }
  }, [sessions, currentSessionId, activeProjectId]);

  // 刷新页面 / 首次进入 / 切项目：恢复上次选中的 chat，或默认打开最近更新的会话
  useEffect(() => {
    if (!orgId || !activeProjectId) return;
    // 必须等「本项目」的 sessions 加载完，否则会用旧项目会话列表误恢复
    if (sessionsProjectIdRef.current !== activeProjectId) return;
    if (sessions.length === 0) return;
    if (currentSessionId && sessions.some((s) => s.id === currentSessionId)) {
      return;
    }
    if (sessionRestoreMarkerRef.current === activeProjectId) {
      return;
    }

    const pref = readEditorSessionPreference(activeProjectId);
    sessionRestoreMarkerRef.current = activeProjectId;

    if (pref.kind === 'blank') {
      return;
    }

    const chosenId =
      pref.kind === 'session' && sessions.some((s) => s.id === pref.id)
        ? pref.id
        : [...sessions].sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          )[0]?.id;

    if (chosenId) {
      void selectSession(chosenId);
    }
  }, [orgId, activeProjectId, sessions, currentSessionId, selectSession]);

  useEffect(() => {
    void refreshAgentContext();
  }, [activeProjectId, currentSessionId, refreshAgentContext]);

  useEffect(() => {
    if (activeProjectId) {
      void syncSessionJobsMeta(activeProjectId, currentSessionId);
    }
  }, [activeProjectId, currentSessionId, syncSessionJobsMeta]);

  useEffect(() => {
    if (!activeProjectId) {
      setLiveProjectJobs([]);
      return;
    }
    void refreshLiveProjectJobs();
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refreshLiveProjectJobs();
    }, 8_000);
    const onVisible = () => {
      if (!document.hidden) void refreshLiveProjectJobs();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activeProjectId, refreshLiveProjectJobs]);

  // HMR / tab-return: session id may already be set so the restore effect
  // skips, but polling/SSE died. Reattach any still-queued/running job.
  useEffect(() => {
    if (!orgId || !activeProjectId || !currentSessionId) return;
    if (isBusyRef.current || activeJobIdRef.current) return;
    const live = pickLiveSessionJob(liveProjectJobs, currentSessionId);
    if (!live) return;
    attachLiveJobRef.current?.(
      activeProjectId,
      live,
      uiEpochRef.current,
    );
  }, [orgId, activeProjectId, currentSessionId, liveProjectJobs]);

  useEffect(() => {
    if (jobLifecycleStatus !== 'queued' || !isLoading) return;
    const started = queuedSinceRef.current ?? Date.now();
    const remain = Math.max(0, 90_000 - (Date.now() - started));
    const timer = window.setTimeout(() => {
      setQueuedTimeoutHint(true);
      messageApi.warning(t('generate.progress.queuedTimeout'));
    }, remain);
    return () => window.clearTimeout(timer);
  }, [jobLifecycleStatus, isLoading, messageApi, t]);

  // Refresh / WeChat reload: paint the pipeline immediately from the last
  // snapshot so the page does not flash idle → 0% → reconnect.
  useEffect(() => {
    if (!activeProjectId) return;
    if (isBusyRef.current || activeJobIdRef.current) return;
    const pref = readEditorSessionPreference(activeProjectId);
    if (pref.kind === 'blank') return;
    const snap = readLiveJobSnapshot(activeProjectId);
    if (!snap) return;
    if (pref.kind === 'session' && snap.sessionId && snap.sessionId !== pref.id) {
      return;
    }
    setBusy(true);
    activeJobIdRef.current = snap.jobId;
    setActiveJobId(snap.jobId);
    setActiveJobStartedAt(snap.createdAt);
    setResumePercent(snap.visualPercent);
    setJobLifecycleStatus(snap.status);
    setGenerationState(generationStateForResume(snap.type, null));
    queuedSinceRef.current =
      snap.status === 'queued' ? new Date(snap.createdAt).getTime() : null;
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId || !activeJobId || !isLoading) return;
    const phase = getEffectivePhase(
      agentEvents.filter((evt) => evt.jobId === activeJobId),
    );
    if (!phase) return;
    const percent = phaseToProgressPercent(phase);
    setResumePercent((prev) => (percent > prev ? percent : prev));
    patchLiveJobSnapshot(activeProjectId, {
      visualPercent: percent,
      status: jobLifecycleStatus === 'queued' ? 'queued' : 'running',
    });
  }, [agentEvents, activeProjectId, activeJobId, isLoading, jobLifecycleStatus]);

  useEffect(() => {
    if (!isLoading || !activeProjectId || !activeJobId) return;
    const projectId = activeProjectId;
    const jobId = activeJobId;
    const epoch = uiEpochRef.current;
    let lastFetchAt = 0;
    let inFlight = false;
    const pollAgentEvents = async (force = false) => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (inFlight) return;
      if (
        uiEpochRef.current !== epoch ||
        activeProjectIdRef.current !== projectId
      ) {
        return;
      }
      const sseLive =
        typeof EventSource !== 'undefined' &&
        eventSourceRef.current?.readyState === EventSource.OPEN;
      // SSE is primary; HTTP backup is sparse while connected, denser when SSE is down.
      const minGapMs = sseLive ? 10_000 : 3_000;
      const now = Date.now();
      if (!force && now - lastFetchAt < minGapMs) return;
      inFlight = true;
      lastFetchAt = now;
      try {
        const { events } = await api.jobs.agentEvents(projectId, jobId);
        if (
          uiEpochRef.current !== epoch ||
          activeProjectIdRef.current !== projectId
        ) {
          return;
        }
        if (!events?.length) return;
        setAgentEvents((prev) => {
          const merged = [...prev];
          for (const evt of events) {
            if (evt.jobId !== jobId) continue;
            if (merged.some((r) => r.id === evt.id)) continue;
            merged.push(evt);
          }
          return merged.sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
        });
      } catch {
        // ignore — SSE may still deliver
      } finally {
        inFlight = false;
      }
    };
    void pollAgentEvents(true);
    const timer = window.setInterval(() => void pollAgentEvents(), 1000);
    const onVisibility = () => {
      if (!document.hidden) void pollAgentEvents(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isLoading, activeProjectId, activeJobId]);

  // 清理
  useEffect(() => {
    return () => {
      clearPolling();
      closeSSE();
    };
  }, [clearPolling, closeSSE]);

  return {
    generationState,
    stageStatuses,
    messages,
    previewUrl,
    playableDraft,
    logKey,
    isLoading,
    jobLifecycleStatus,
    queuedTimeoutHint,
    sessions,
    currentSessionId,
    codeChanges,
    sendMessage,
    retryLastMessage,
    resetConversation,
    openLogModal,
    closeLogModal,
    logModalVisible,
    loadSessions,
    selectSession,
    createNewSession,
    deleteSession,
    forkSession,
    deploymentId,
    projectId: activeProjectId,
    projects,
    activeProjectId,
    selectProject,
    createNewProject,
    deleteProject,
    setupSSE,
    closeSSE,
    agentEvents,
    clearAgentEvents,
    activeJobId,
    activeJobStartedAt,
    resumePercent,
    failedJobs,
    loadFailedJobs,
    retryJob,
    cancelActiveJob,
    canCancelJob: Boolean(
      (activeJobId || isLoading) &&
        (jobLifecycleStatus === 'queued' ||
          jobLifecycleStatus === 'running' ||
          isLoading),
    ),
    liveProjectJobs,
    runningElsewhere,
    refreshLiveProjectJobs,
    recoverStaleJobs,
    refreshPreview: async () => {
      const pid = activeProjectIdRef.current;
      if (!pid) return;
      await fetchPreviewUrl(pid, { force: true, remint: true });
    },
    agentSessionContext,
    refreshAgentContext,
    saveBrief,
    iterationRecords,
    lastSuccessJobId,
    jobSuccessEpoch,
    lastSucceededJobType,
    outOfPoints,
    dismissOutOfPoints: () => setOutOfPoints(null),
  };
}
