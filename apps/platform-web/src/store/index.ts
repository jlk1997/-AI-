/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { create } from 'zustand';
import type { Project, JobRow, DeploymentRow, ChatSessionRow, ChatMessageRow } from '../types';
import { api, TOKEN_KEY, ORG_ID_KEY } from '../services/api';

function readStoredOrgId(): string | null {
  const raw = localStorage.getItem(ORG_ID_KEY);
  if (raw == null) return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

interface AppState {
  // 认证状态
  token: string | null;
  orgId: string | null;
  isAuthenticated: boolean;

  // 项目状态
  projects: Project[];
  currentProject: Project | null;

  // 任务状态
  jobs: JobRow[];
  currentJobId: string | null;

  // 部署状态
  deployments: DeploymentRow[];
  previewUrl: string | null;

  // 会话状态
  sessions: ChatSessionRow[];
  currentSessionId: string | null;
  messages: ChatMessageRow[];

  // UI 状态
  loading: boolean;
  error: string | null;
  sidebarCollapsed: boolean;

  // 操作方法
  loginWithEmailCode: (email: string, code: string) => Promise<void>;
  /** Adopts a session minted elsewhere (magic link click). */
  loginWithMagicToken: (linkToken: string) => Promise<void>;
  /** Completes a WeChat web authorization round trip. */
  loginWithWeChat: (code: string, state: string) => Promise<void>;
  loginWithPhone: (phone: string, code: string) => Promise<void>;
  logout: () => void;
  setOrgId: (organizationId: string) => void;
  setCurrentProject: (project: Project | null) => void;
  setCurrentSession: (sessionId: string | null) => void;
  fetchProjects: () => Promise<void>;
  fetchJobs: () => Promise<void>;
  fetchDeployments: () => Promise<void>;
  fetchSessions: () => Promise<void>;
  fetchMessages: (sessionId: string) => Promise<void>;
  createProject: () => Promise<void>;
  createSession: (title: string) => Promise<void>;
  forkSession: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
  getPreviewUrl: (deploymentId: string) => Promise<void>;
  getJobLogUrl: (jobId: string) => Promise<string | null>;
  clearError: () => void;
  toggleSidebar: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // 初始状态 - 从 localStorage 恢复 orgId
  token: localStorage.getItem(TOKEN_KEY),
  orgId: readStoredOrgId(),
  isAuthenticated: Boolean(localStorage.getItem(TOKEN_KEY)),
  projects: [],
  currentProject: null,
  jobs: [],
  currentJobId: null,
  deployments: [],
  previewUrl: null,
  sessions: [],
  currentSessionId: null,
  messages: [],
  loading: false,
  error: null,
  sidebarCollapsed: false,

  // 登录
  loginWithEmailCode: async (email: string, code: string) => {
    set({ loading: true, error: null });
    try {
      const response = await api.auth.emailVerify(email, code);
      localStorage.setItem(TOKEN_KEY, response.token);
      localStorage.setItem(ORG_ID_KEY, response.organizationId);
      set({
        token: response.token,
        orgId: response.organizationId,
        isAuthenticated: true,
        loading: false,
      });
      await get().fetchProjects();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Login failed',
        loading: false,
      });
      throw error;
    }
  },

  // 登录：一次性链接
  loginWithMagicToken: async (linkToken: string) => {
    set({ loading: true, error: null });
    try {
      const response = await api.auth.magicVerify(linkToken);
      localStorage.setItem(TOKEN_KEY, response.token);
      localStorage.setItem(ORG_ID_KEY, response.organizationId);
      set({
        token: response.token,
        orgId: response.organizationId,
        isAuthenticated: true,
        loading: false,
      });
      await get().fetchProjects();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Login failed',
        loading: false,
      });
      throw error;
    }
  },

  loginWithPhone: async (phone: string, code: string) => {
    set({ loading: true, error: null });
    try {
      const response = await api.auth.phoneVerify(phone, code);
      localStorage.setItem(TOKEN_KEY, response.token);
      localStorage.setItem(ORG_ID_KEY, response.organizationId);
      set({
        token: response.token,
        orgId: response.organizationId,
        isAuthenticated: true,
        loading: false,
      });
      await get().fetchProjects();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Login failed',
        loading: false,
      });
      throw error;
    }
  },

  // 登录：微信网页授权
  loginWithWeChat: async (code: string, state: string) => {
    set({ loading: true, error: null });
    try {
      const response = await api.auth.wechatCallback(code, state);
      localStorage.setItem(TOKEN_KEY, response.token);
      localStorage.setItem(ORG_ID_KEY, response.organizationId);
      set({
        token: response.token,
        orgId: response.organizationId,
        isAuthenticated: true,
        loading: false,
      });
      await get().fetchProjects();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Login failed',
        loading: false,
      });
      throw error;
    }
  },

  // 登出
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ORG_ID_KEY);
    set({
      token: null,
      orgId: null,
      isAuthenticated: false,
      projects: [],
      currentProject: null,
      jobs: [],
      deployments: [],
      sessions: [],
      currentSessionId: null,
      messages: [],
    });
  },

  // 设置当前项目
  setCurrentProject: (project: Project | null) => {
    set({
      currentProject: project,
      jobs: [],
      deployments: [],
      sessions: [],
      currentSessionId: null,
      messages: [],
    });
    if (project) {
      get().fetchJobs();
      get().fetchDeployments();
      get().fetchSessions();
    }
  },

  // 设置当前会话
  setCurrentSession: (sessionId: string | null) => {
    set({ currentSessionId: sessionId, messages: [] });
    if (sessionId) {
      get().fetchMessages(sessionId);
    }
  },

  setOrgId: (organizationId: string) => {
    const trimmed = organizationId.trim();
    if (!trimmed) return;
    localStorage.setItem(ORG_ID_KEY, trimmed);
    set({ orgId: trimmed });
  },

  // 获取项目列表（跨自己加入的全部组织，邀请进来的游戏才会出现）
  fetchProjects: async () => {
    if (!get().orgId && !get().token) return;
    try {
      const response = await api.projects.list();
      set({ projects: response.projects });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch projects' });
    }
  },

  // 获取任务列表
  fetchJobs: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const response = await api.jobs.list(currentProject.id);
      set({ jobs: response.jobs });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch jobs' });
    }
  },

  // 获取部署列表
  fetchDeployments: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const response = await api.deployments.list(currentProject.id);
      set({ deployments: response.deployments });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch deployments' });
    }
  },

  // 获取会话列表
  fetchSessions: async () => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const response = await api.sessions.list(currentProject.id);
      set({ sessions: response.sessions });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch sessions' });
    }
  },

  // 获取消息列表
  fetchMessages: async (sessionId: string) => {
    const { currentProject } = get();
    if (!currentProject) return;
    try {
      const response = await api.sessions.messages(currentProject.id, sessionId);
      set({ messages: response.messages });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch messages' });
    }
  },

  // 创建项目
  createProject: async () => {
    const currentOrgId = get().orgId;
    if (!currentOrgId) {
      set({ error: '组织ID不存在，请重新登录' });
      return;
    }
    set({ loading: true, error: null });
    try {
      const name = `Game ${new Date().toISOString().slice(0, 16)}`;
      await api.projects.create(currentOrgId, name);
      // 创建成功后重新获取项目列表
      const response = await api.projects.list();
      set({ projects: response.projects, loading: false });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '创建项目失败';
      set({
        error: errorMsg,
        loading: false,
      });
      throw error; // 重新抛出以便页面可以处理
    }
  },

  // 创建会话
  createSession: async (title: string) => {
    const { currentProject } = get();
    if (!currentProject) return;
    set({ loading: true, error: null });
    try {
      const session = await api.sessions.create(currentProject.id, title);
      await get().fetchSessions();
      set({ currentSessionId: session.id, messages: [], loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create session',
        loading: false,
      });
    }
  },

  // Fork 会话
  forkSession: async () => {
    const { currentProject, currentSessionId } = get();
    if (!currentProject || !currentSessionId) return;
    set({ loading: true, error: null });
    try {
      const response = await api.sessions.fork(currentProject.id, currentSessionId);
      await get().fetchSessions();
      set({ currentSessionId: response.sessionId, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fork session',
        loading: false,
      });
    }
  },

  // 发送消息
  sendMessage: async (content: string) => {
    const { currentProject, currentSessionId } = get();
    if (!currentProject) return;
    set({ loading: true, error: null });
    try {
      const response = await api.messages.send(currentProject.id, content, currentSessionId || undefined);
      set({ currentJobId: response.jobId, currentSessionId: response.sessionId });
      await get().fetchSessions();
      await get().fetchMessages(response.sessionId);
      await get().fetchJobs();
      set({ loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to send message',
        loading: false,
      });
    }
  },

  // 重试任务
  retryJob: async (jobId: string) => {
    const { currentProject } = get();
    if (!currentProject) return;
    set({ loading: true, error: null });
    try {
      await api.jobs.retry(currentProject.id, jobId);
      await get().fetchJobs();
      set({ loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to retry job',
        loading: false,
      });
    }
  },

  // 获取预览 URL
  getPreviewUrl: async (deploymentId: string) => {
    try {
      const response = await api.deployments.getPreviewUrl(deploymentId);
      set({ previewUrl: response.url });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to get preview URL' });
    }
  },

  // 获取任务日志 URL
  getJobLogUrl: async (jobId: string) => {
    try {
      const response = await api.jobs.getLogUrl(jobId);
      return response.url;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to get log URL' });
      return null;
    }
  },

  // 清除错误
  clearError: () => set({ error: null }),

  // 切换侧边栏
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  // 设置加载状态
  setLoading: (loading: boolean) => set({ loading }),
}));
