/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Layout,
  Typography,
  Button,
  Space,
  Modal,
  Dropdown,
  Tooltip,
  Drawer,
  Spin,
  Divider,
  message,
  Alert,
  Collapse,
} from 'antd';
import {
  ThunderboltOutlined,
  UserOutlined,
  LogoutOutlined,
  PlusOutlined,
  HistoryOutlined,
  SettingOutlined,
  GlobalOutlined,
  QuestionCircleOutlined,
  LoadingOutlined,
  SunOutlined,
  MoonOutlined,
  PictureOutlined,
  TrophyOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  ApiOutlined,
  ExperimentOutlined,
  MenuOutlined,
  DownOutlined,
  UpOutlined,
  DeleteOutlined,
  FolderOutlined,
  ExclamationCircleOutlined,
  StopOutlined,
  ShareAltOutlined,
  ToolOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { supportedLocales, useT } from '../services/i18n';
import { BrandLockup } from '../brand/BrandMark';
import { SplitPane } from '../components/Layout/SplitPane';
import { ConversationPanel } from '../components/Conversation/ConversationPanel';
import { SessionHistory } from '../components/Conversation/SessionHistory';
import { QuickActions } from '../components/Conversation/QuickActions';
import { LivePreview } from '../components/Preview/LivePreview';
import { DesignIntakeCard } from '../components/Conversation/DesignIntakeCard';
import {
  artStyleIdOf,
  formatDesignBrief,
  inferIntakeDefaults,
  type DesignIntakeAnswers,
} from '../utils/designIntake';
import {
  getPublishedSlug,
  rememberPublishedSlug,
} from '../utils/communityPublishMemory';
import { deriveAcceptanceChecks } from '../utils/acceptanceChecks';
import {
  resolveQuickActionPrompt,
  isShareToCommunityPrompt,
} from '../utils/iterateSuggestions';
import { GameSettings } from '../components/Preview/GameSettings';
import { OnboardingGuide } from '../components/Onboarding/OnboardingGuide';
import { GameConfigBar } from '../components/Generation/GameConfigBar';
import {
  normalizeGameThemeParams,
  type GameThemeParams,
} from '../components/Params/GameParamsPanel';
import {
  ArtStyleBar,
  readStoredArtStyleId,
  storeArtStyleId,
} from '../components/Params/ArtStyleBar';
import { DEFAULT_ART_STYLE_ID, type ArtStyleId } from '@opengame/world-spec';
import {
  readWorldCreatePrefs,
  societySeedHoursOf,
  storeWorldCreatePrefs,
  worldPopulationOf,
  type WorldCreatePrefs,
} from '../components/World/worldCreatePrefs';
import type { GameParamsConfig } from '../services/api';
import { GameContextWindow } from '../components/Generation/GameContextWindow';
import { JobRetryPanel } from '../components/Generation/JobRetryPanel';
import { GlobalJobDock } from '../components/Generation/GlobalJobDock';
import { PreviewPipelineStrip } from '../components/Generation/PreviewPipelineStrip';
import { IterationHistory } from '../components/Conversation/IterationHistory';
import { AgentTimeline } from '../components/Agent/AgentTimeline';
import { CustomDomainPanel } from '../components/Deployment/CustomDomainPanel';
import { featureFlags } from '../utils/featureFlags';
import { PublishGameModal } from '../components/Community/PublishGameModal';
import { OutOfPointsModal } from '../components/Billing/OutOfPointsModal';
import { WorldLineageCard } from '../components/World/WorldLineageCard';
import { readWorldLineageSnapshot } from '../utils/worldLineage';
import { TechFriendlyStrip } from '../components/Tech/TechFriendlyStrip';
import { StudioModeSwitch } from '../components/Studio/StudioModeSwitch';
import {
  StudioToolsDrawer,
  type StudioToolsTab,
} from '../components/Studio/StudioToolsDrawer';
import type { WorldReadySummary } from '../components/World/WorldReadyStrip';
import {
  composeWorldGeneratePrompt,
  worldBriefOf,
} from '../components/World/composeWorldBrief';
import {
  readStoredGenerationMode,
  storeGenerationMode,
  rememberWorldGeneratePrompt,
  type GenerationMode,
} from '../components/World/worldTemplates';
import { useOnboarding } from '../hooks/useOnboarding';
import { useGeneration } from '../hooks/useGeneration';
import { useTheme } from '../hooks/useTheme';
import { useAppStore } from '../store';
import { api } from '../services/api';
import { summarizeJobLogKey } from '../utils/jobFailureText';
import { isWorldJobType } from '../hooks/useGenerationJobs';
import {
  readWorldAssetProgress,
  studioOverlayGenerateFailed,
} from '../utils/previewBundleHealth';

const { Header, Content } = Layout;
const { Text } = Typography;

export const GeneratePage: React.FC = () => {
  const {
    generationState,
    messages,
    previewUrl,
    playableDraft,
    isLoading,
    sessions,
    currentSessionId,
    codeChanges,
    sendMessage,
    retryLastMessage,
    stageStatuses,
    logKey,
    failedJobs,
    loadFailedJobs,
    retryJob,
    cancelActiveJob,
    canCancelJob,
    loadSessions,
    selectSession,
    createNewSession,
    deleteSession,
    forkSession,
    agentEvents,
    activeJobId,
    activeJobStartedAt,
    resumePercent,
    deploymentId,
    projectId,
    projects,
    activeProjectId,
    selectProject,
    createNewProject,
    deleteProject,
    agentSessionContext,
    saveBrief,
    iterationRecords,
    lastSuccessJobId,
    jobSuccessEpoch,
    lastSucceededJobType,
    jobLifecycleStatus,
    queuedTimeoutHint,
    liveProjectJobs,
    runningElsewhere,
    refreshLiveProjectJobs,
    recoverStaleJobs,
    refreshPreview,
    outOfPoints,
    dismissOutOfPoints,
  } = useGeneration();

  const [worldRefreshToken, setWorldRefreshToken] = useState(0);
  const [qualityTabRequest, setQualityTabRequest] = useState(0);
  const [worldSummary, setWorldSummary] = useState<WorldReadySummary | null>(
    null,
  );

  const projectIdForWorld = activeProjectId ?? projectId;

  useEffect(() => {
    if (!projectIdForWorld) {
      setWorldSummary(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.world.get(projectIdForWorld);
        if (cancelled) return;
        const w = res.world;
        if (!w) {
          setWorldSummary(null);
          return;
        }
        const spec = w.spec as {
          narrative?: {
            quests?: Array<{ title: string; status: string }>;
          };
          entities?: Array<{
            kind?: string;
            name?: string;
            tags?: string[];
          }>;
          presentation?: { plannerSource?: string };
        };
        const npcs = (spec.entities ?? []).filter((e) => e.kind === 'npc');
        const paddedList = npcs.filter((e) =>
          (e.tags ?? []).includes('padded'),
        );
        const authoredList = npcs.filter(
          (e) => !(e.tags ?? []).includes('padded'),
        );
        setWorldSummary({
          title: w.title,
          tipRevision: w.tipRevision,
          summary: w.summary,
          gameplay: w.gameplay,
          plannerSource:
            w.l3?.plannerSource ?? spec.presentation?.plannerSource ?? null,
          authoredNpcs: w.authoredNpcs ?? authoredList.length,
          paddedNpcs: w.paddedNpcs ?? paddedList.length,
          authoredNames:
            w.authoredNames ??
            authoredList
              .map((e) => e.name)
              .filter((n): n is string => Boolean(n)),
          paddedNames:
            w.paddedNames ??
            paddedList
              .map((e) => e.name)
              .filter((n): n is string => Boolean(n)),
          societySeed: w.societySeed ?? null,
          worldBrief: w.worldBrief ?? null,
          l2: w.l2
            ? {
                opsApplied: w.l2.opsApplied,
                regionsDelta: w.l2.regionsDelta,
                questsDelta: w.l2.questsDelta,
                ran: Boolean(
                  (w.l2 as { ran?: boolean }).ran || w.l2.opsApplied > 0,
                ),
              }
            : undefined,
          l3: w.l3
            ? {
                backend: w.l3.backend,
                lingbotMode: w.l3.lingbotMode,
                cinematicEnabled: w.l3.cinematicEnabled,
                clipCount: w.l3.clipCount,
              }
            : undefined,
          quests: spec.narrative?.quests,
        });
      } catch {
        if (!cancelled) setWorldSummary(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectIdForWorld, worldRefreshToken, jobSuccessEpoch]);

  const previewPipelineStage = useMemo(() => {
    if (previewUrl) return 'ready' as const;
    if (generationState === 'error') return 'error' as const;
    if (generationState === 'deploying') return 'deploying' as const;
    if (generationState === 'building') return 'building' as const;
    if (generationState === 'generating') return 'generating' as const;
    return 'idle' as const;
  }, [previewUrl, generationState]);

  const previewErrorSummary = useMemo(
    () => (generationState === 'error' ? summarizeJobLogKey(logKey) : ''),
    [generationState, logKey],
  );

  const worldAssetProgress = useMemo(
    () => readWorldAssetProgress(agentEvents.map((event) => event.summary)),
    [agentEvents],
  );

  /** Proof that the project's world shaped this game (null when there is none). */
  const worldLineage = useMemo(
    () => readWorldLineageSnapshot(agentEvents, activeJobId),
    [agentEvents, activeJobId],
  );

  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsTab, setToolsTab] = useState<StudioToolsTab>('quality');
  const [researchFocusToken, setResearchFocusToken] = useState(0);
  const [worldPaneFocusToken, setWorldPaneFocusToken] = useState(0);
  const [lingbotStripHealth, setLingbotStripHealth] = useState<{
    mode?: string;
    weightsReady?: boolean;
    readyReal?: boolean;
  } | null>(null);
  const [generationMode, setGenerationMode] = useState<GenerationMode>(() =>
    readStoredGenerationMode(),
  );
  // Shared by both tracks: the world track never had a style control, so worlds
  // were locked to whatever the planner guessed (in practice, pixel art).
  const [artStyleId, setArtStyleId] = useState<ArtStyleId>(
    () => readStoredArtStyleId() ?? DEFAULT_ART_STYLE_ID,
  );
  const [worldCreatePrefs, setWorldCreatePrefs] = useState<WorldCreatePrefs>(
    () => readWorldCreatePrefs(),
  );
  const pickArtStyle = (next: ArtStyleId) => {
    setArtStyleId(next);
    storeArtStyleId(next);
    setWorldCreatePrefs((prev) => {
      const merged = { ...prev, artStyleId: next };
      storeWorldCreatePrefs(merged);
      return merged;
    });
  };
  const applyWorldCreatePrefs = (next: WorldCreatePrefs) => {
    setWorldCreatePrefs(next);
    storeWorldCreatePrefs(next);
    setArtStyleId(next.artStyleId);
  };
  const worldJobParams = (): GameParamsConfig => ({
    artStyleId,
    worldPopulation: worldPopulationOf(worldCreatePrefs),
    societySeedHours: societySeedHoursOf(worldCreatePrefs),
    worldBrief: worldBriefOf(worldCreatePrefs),
  });

  /** Deep link: ?mode=world&lab=1 opens World drawer + Research Lab */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode');
      const lab = params.get('lab');
      if (mode === 'world' || mode === 'game') {
        setGenerationMode(mode);
        storeGenerationMode(mode);
      }
      if (featureFlags.researchLab && (lab === '1' || lab === 'true')) {
        setGenerationMode('world');
        storeGenerationMode('world');
        openStudioTools('world');
        setResearchFocusToken((n) => n + 1);
      }
    } catch {
      // ignore
    }
  }, []);

  /**
   * Deep link from Community / My page: `?project=<id>&remix=<one line>`.
   * The fork already happened server-side; here we just land on that project
   * with the sentence prefilled so the visitor's next act is pressing send.
   */
  const remixDeepLink = useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const project = params.get('project');
      const remix = params.get('remix');
      return {
        projectId: project && project.length > 0 ? project : null,
        line: remix && remix.trim().length > 0 ? remix.trim() : null,
      };
    } catch {
      return { projectId: null, line: null };
    }
  }, []);
  const remixDeepLinkApplied = useRef(false);

  useEffect(() => {
    if (remixDeepLinkApplied.current) return;
    const { projectId: wanted, line } = remixDeepLink;
    if (!wanted) return;
    if (!projects.some((p) => p.id === wanted)) return;
    remixDeepLinkApplied.current = true;
    if (activeProjectId !== wanted) {
      void selectProject(wanted);
    }
    if (line) {
      setChatDraft(line);
      setChatDraftNonce((n) => n + 1);
    }
    // Keep the URL clean so a refresh does not re-apply the fork prompt.
    try {
      window.history.replaceState({}, '', window.location.pathname);
    } catch {
      // ignore
    }
  }, [remixDeepLink, projects, activeProjectId, selectProject]);

  // Only probe when the world declares the LingBot backend or the operator
  // opened the Research Lab. Entering world mode alone must not round-trip to a
  // sidecar that is off by default.
  const worldDeclaresLingbot = worldSummary?.l3?.backend === 'lingbot';

  useEffect(() => {
    if (generationMode !== 'world' || !projectIdForWorld) {
      setLingbotStripHealth(null);
      return;
    }
    if (!worldDeclaresLingbot && researchFocusToken === 0) {
      setLingbotStripHealth(null);
      return;
    }
    let cancelled = false;
    void api.world
      .lingbotHealth(projectIdForWorld)
      .then((h) => {
        if (cancelled) return;
        setLingbotStripHealth({
          mode: h.mode,
          weightsReady: Boolean(h.weightsReady ?? h.weights?.weightsReady),
          readyReal: Boolean(h.readyReal),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLingbotStripHealth({
            mode: undefined,
            weightsReady: false,
            readyReal: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    generationMode,
    projectIdForWorld,
    worldDeclaresLingbot,
    researchFocusToken,
    worldRefreshToken,
  ]);

  const openStudioTools = (tab: StudioToolsTab = 'quality') => {
    setToolsTab(tab);
    setToolsOpen(true);
    if (tab === 'quality') {
      setQualityTabRequest((n) => n + 1);
    }
  };
  const handleGenerationModeChange = (mode: GenerationMode) => {
    setGenerationMode(mode);
    storeGenerationMode(mode);
  };

  const worldGenerateBody = (content?: string) => {
    const trimmed = content?.trim() ?? '';
    if (
      /场所必须包含|Places must include/i.test(trimmed) &&
      /society\.(town|crew|cloister)/.test(trimmed)
    ) {
      return trimmed;
    }
    return composeWorldGeneratePrompt(worldCreatePrefs, trimmed);
  };

  const startWorldDemo = (prompt?: string) => {
    const p = worldGenerateBody(prompt);
    if (projectIdForWorld) rememberWorldGeneratePrompt(projectIdForWorld, p);
    setGenerationMode('world');
    storeGenerationMode('world');
    setToolsOpen(false);
    void sendMessage(p, worldJobParams(), undefined, 'world');
  };
  const [quickActionsDrawerVisible, setQuickActionsDrawerVisible] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(false);

  const { toggleTheme, isDark } = useTheme();
  const { token, logout } = useAppStore();
  const navigate = useNavigate();
  const { t, locale, setLocale } = useT();
  const { showOnboarding, closeOnboarding, openOnboarding, completeOnboarding } =
    useOnboarding();

  // UI 状态
  const [sessionDrawerVisible, setSessionDrawerVisible] = useState(false);
  const [gameSettingsVisible, setGameSettingsVisible] = useState(false);
  const [publishModalVisible, setPublishModalVisible] = useState(false);
  const [communityShareOpen, setCommunityShareOpen] = useState(false);
  const [publishedSlugTick, setPublishedSlugTick] = useState(0);
  const [logDrawerVisible, setLogDrawerVisible] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakePrompt, setIntakePrompt] = useState('');
  const [intakeImages, setIntakeImages] = useState<string[] | undefined>();
  const [intakeMode, setIntakeMode] = useState<'game' | 'world' | 'world_edit'>(
    'game',
  );

  const publishedCommunitySlug = useMemo(() => {
    void publishedSlugTick;
    return getPublishedSlug(deploymentId);
  }, [deploymentId, publishedSlugTick]);

  const openCommunityShare = () => {
    if (!deploymentId) {
      message.warning(t('community.publish.noDeployment'));
      return;
    }
    const existing = getPublishedSlug(deploymentId);
    if (existing) {
      message.info(t('community.publish.alreadyPublished'));
      window.open(`/community/game/${existing}`, '_blank', 'noopener,noreferrer');
      return;
    }
    setCommunityShareOpen(true);
  };

  const needsDesignIntake =
    generationMode === 'game' &&
    !previewUrl &&
    !isLoading &&
    // Someone who arrived from a work page already said what they want changed;
    // asking them the intake questions would bury that line.
    !remixDeepLink.line &&
    messages.filter((m) => m.role === 'user').length === 0;

  const buildGameParams = (
    content: string,
    intake?: DesignIntakeAnswers,
  ): GameParamsConfig => {
    const heuristic: GameParamsConfig = {
      theme: /赛博|cyberpunk/i.test(content)
        ? 'cyberpunk'
        : /像素|pixel/i.test(content)
          ? 'pixel'
          : /水彩|watercolor/i.test(content)
            ? 'watercolor'
            : undefined,
      difficulty: /更难|harder|boss/i.test(content)
        ? 4
        : /更简单|easier/i.test(content)
          ? 1
          : undefined,
    };
    const answers = intake ?? inferIntakeDefaults(content);
    // The intake answer wins when the user actually went through the card;
    // otherwise the persisted bar selection is the user's standing choice.
    const style = intake ? artStyleIdOf(intake.artTone) : artStyleId;
    return {
      theme: heuristic.theme ?? gameThemeParams.theme,
      variant: gameThemeParams.variant,
      artStyleId: style,
      difficulty: heuristic.difficulty ?? gameThemeParams.difficulty,
      musicStyle: gameThemeParams.musicStyle,
      effectsVolume: gameThemeParams.effectsVolume,
      gameSpeed: gameThemeParams.gameSpeed,
      lives: gameThemeParams.lives,
      timeLimit: gameThemeParams.timeLimit,
      preferredArchetype: answers.preferredArchetype,
      artTone: style,
      winFeel: answers.winFeel,
      designBrief: formatDesignBrief({ ...answers, artTone: style }),
    };
  };

  const commitGenerate = (
    content: string,
    images: string[] | undefined,
    mode: 'game' | 'world' | 'world_edit',
    intake?: DesignIntakeAnswers,
  ) => {
    const body =
      mode === 'world' ? worldGenerateBody(content) : content;
    if (mode === 'world' && projectIdForWorld) {
      rememberWorldGeneratePrompt(projectIdForWorld, body);
    }
    const gameParams =
      mode === 'game' ? buildGameParams(content, intake) : worldJobParams();
    void sendMessage(body, gameParams, images, mode);
  };

  const [logDrawerTitle, setLogDrawerTitle] = useState('');
  const [logContent, setLogContent] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const [failedJobsExpanded, setFailedJobsExpanded] = useState(false);
  const chatInputAnchorRef = useRef<HTMLDivElement>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [chatDraftNonce, setChatDraftNonce] = useState(0);
  const [gameThemeParams, setGameThemeParams] = useState<GameThemeParams>(() => {
    try {
      const raw = localStorage.getItem('opengame_game_theme_params');
      if (raw) {
        return normalizeGameThemeParams(JSON.parse(raw) as GameThemeParams);
      }
    } catch {
      /* ignore */
    }
    return normalizeGameThemeParams({
      theme: 'cyberpunk',
      variant: 'classic',
      difficulty: 2,
      musicStyle: 'synthwave',
      effectsVolume: 80,
      gameSpeed: 1,
      lives: 3,
    });
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        'opengame_game_theme_params',
        JSON.stringify(gameThemeParams),
      );
    } catch {
      /* ignore */
    }
  }, [gameThemeParams]);

  // 加载失败任务
  useEffect(() => {
    loadFailedJobs();
  }, [loadFailedJobs]);

  useEffect(() => {
    if (failedJobs.length === 0) {
      setFailedJobsExpanded(false);
    }
  }, [failedJobs.length]);

  // Auto-expand failed-jobs panel when generation fails so recovery chips are visible
  useEffect(() => {
    if (generationState === 'error' && failedJobs.length > 0) {
      setFailedJobsExpanded(true);
    }
  }, [generationState, failedJobs.length]);

  useEffect(() => {
    const updateViewport = () => {
      setIsCompactViewport(window.innerWidth < 1100);
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  // 用户菜单
  const userMenuItems = [
    { key: 'settings', label: t('menu.settings'), icon: <SettingOutlined />, onClick: () => setGameSettingsVisible(true) },
    { key: 'world', label: t('product.tools.world'), icon: <GlobalOutlined />, onClick: () => openStudioTools('world') },
    { key: 'assets', label: t('product.tools.assets'), icon: <PictureOutlined />, onClick: () => openStudioTools('assets') },
    { key: 'profile', label: t('nav.myStudio'), icon: <TrophyOutlined />, onClick: () => navigate('/profile') },
    { key: 'wallet', label: t('nav.points'), icon: <TrophyOutlined />, onClick: () => navigate('/wallet') },
    ...(featureFlags.ecosystem
      ? [
          { key: 'plugins', label: t('menu.plugins'), icon: <AppstoreOutlined />, onClick: () => navigate('/plugins') },
          { key: 'bench', label: t('menu.bench'), icon: <BarChartOutlined />, onClick: () => navigate('/bench') },
          { key: 'developer', label: t('menu.developer'), icon: <ApiOutlined />, onClick: () => navigate('/developer') },
        ]
      : []),
    { type: 'divider' as const },
    { key: 'logout', label: t('menu.logout'), icon: <LogoutOutlined />, onClick: logout, danger: true },
  ];

  const openSessionHistory = async () => {
    setSessionDrawerVisible(true);
    await loadSessions();
  };

  // 处理快捷操作 — map to ChangePlan-friendly Chinese prompts
  const handleQuickAction = (action: { type: string; params?: any; prompt?: string }) => {
    if (action.type === 'onboarding') {
      openOnboarding();
      return;
    }
    const prompt =
      (typeof action.prompt === 'string' && action.prompt.trim()) ||
      resolveQuickActionPrompt(action.type);
    if (generationMode === 'game' && needsDesignIntake) {
      setIntakePrompt(prompt);
      setIntakeImages(undefined);
      setIntakeMode('game');
      setIntakeOpen(true);
      return;
    }
    commitGenerate(
      prompt,
      undefined,
      generationMode === 'world'
        ? worldSummary
          ? 'world_edit'
          : 'world'
        : 'game',
    );
  };

  // World job success → Observatory-first (not RPG preview)
  useEffect(() => {
    if (jobSuccessEpoch <= 0) return;
    if (
      lastSucceededJobType !== 'world_generate' &&
      lastSucceededJobType !== 'world_edit'
    ) {
      return;
    }
    setGenerationMode('world');
    storeGenerationMode('world');
    setWorldRefreshToken((n) => n + 1);
    setWorldPaneFocusToken((n) => n + 1);
    message.success(t('world.toast.jobReadyObserve'));
  }, [jobSuccessEpoch, lastSucceededJobType, t]);

  // Full CLI / build log via API proxy (no S3 CORS). Inline keys still render.
  const handleViewLog = async (jobId: string, logKey: string | null) => {
    setLogDrawerVisible(true);
    if (!logKey?.trim()) {
      setLogDrawerTitle(t('generate.failedJobs.drawerFailureDetail'));
      setLogContent(t('generate.failedJobs.noLogKey'));
      setLogLoading(false);
      return;
    }
    setLogDrawerTitle(t('generate.failedJobs.drawerBuildLog'));
    setLogLoading(true);
    setLogContent(t('common.loading'));

    try {
      const response = await api.jobs.getLog(jobId);
      setLogContent(response.text || t('generate.failedJobs.logEmpty'));
      if (response.source === 'inline') {
        setLogDrawerTitle(t('generate.failedJobs.drawerFailureDetail'));
      }
    } catch (error) {
      console.error('获取日志失败:', error);
      setLogContent(t('generate.failedJobs.logFetchFailed', { msg: (error as Error).message }));
    } finally {
      setLogLoading(false);
    }
  };

  const projectDropdown = useMemo(() => {
    const rowStyle = (active: boolean): React.CSSProperties => ({
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 8px 6px 12px',
      borderRadius: 8,
      background: active
        ? 'color-mix(in srgb, var(--color-ember) 14%, var(--bg-card))'
        : 'transparent',
      cursor: 'pointer',
    });
    return (
      <div
        style={{
          width: 280,
          maxHeight: 360,
          overflowY: 'auto',
          padding: 8,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 12,
          boxShadow: '0 12px 32px rgba(15,23,42,0.12)',
        }}
      >
        {projects.length === 0 ? (
          <div style={{ padding: 12, color: 'var(--text-secondary)', fontSize: 12 }}>
            {t('common.loading')}
          </div>
        ) : (
          projects.map((p) => {
            const active = p.id === activeProjectId;
            return (
              <div key={p.id} style={rowStyle(active)}>
                <button
                  type="button"
                  onClick={() => {
                    void selectProject(p.id);
                  }}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: 13,
                    padding: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.name}
                </button>
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label={t('generate.project.delete')}
                  onClick={(e) => {
                    e.stopPropagation();
                    Modal.confirm({
                      title: t('generate.project.deleteConfirmTitle'),
                      content: t('generate.project.deleteConfirm', { name: p.name }),
                      okText: t('common.delete'),
                      okButtonProps: { danger: true },
                      cancelText: t('common.cancel'),
                      onOk: () => deleteProject(p.id),
                    });
                  }}
                />
              </div>
            );
          })
        )}
        <Divider style={{ margin: '8px 0' }} />
        <Button
          type="text"
          icon={<PlusOutlined />}
          block
          style={{ textAlign: 'left', height: 36 }}
          onClick={() => {
            void createNewProject();
          }}
        >
          {t('generate.project.new')}
        </Button>
      </div>
    );
  }, [
    projects,
    activeProjectId,
    selectProject,
    createNewProject,
    deleteProject,
    t,
    isDark,
  ]);

  const activeProjectName =
    projects.find((p) => p.id === activeProjectId)?.name ?? (token ? t('common.loading') : '');
  const sessionLabel = currentSessionId
    ? sessions.find((s) => s.id === currentSessionId)?.title ?? t('generate.header.sessionDraft')
    : t('generate.header.sessionDraft');

  const scrollChatInputIntoView = () => {
    chatInputAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const fillChatWithSuggestion = (prompt: string) => {
    if (isShareToCommunityPrompt(prompt)) {
      openCommunityShare();
      return;
    }
    setChatDraft(prompt);
    setChatDraftNonce((n) => n + 1);
    setFailedJobsExpanded(false);
    scrollChatInputIntoView();
    message.success(t('generate.failedJobs.suggestionFilled'));
  };

  const sendChatWithSuggestion = (prompt: string) => {
    if (isShareToCommunityPrompt(prompt)) {
      openCommunityShare();
      return;
    }
    setFailedJobsExpanded(false);
    const mode =
      generationMode === 'world'
        ? worldSummary
          ? 'world_edit'
          : 'world'
        : 'game';
    if (mode === 'game' && needsDesignIntake) {
      setIntakePrompt(prompt);
      setIntakeImages(undefined);
      setIntakeMode('game');
      setIntakeOpen(true);
      message.success(t('generate.failedJobs.suggestionSent'));
      return;
    }
    message.success(t('generate.failedJobs.suggestionSent'));
    commitGenerate(prompt, undefined, mode);
  };

  // 获取状态文字和颜色
  const getStatusDisplay = () => {
    const worldBusy =
      generationMode === 'world' &&
      (isLoading ||
        generationState === 'generating' ||
        generationState === 'building' ||
        generationState === 'deploying');
    const statusMap: Record<string, { text: string; color: string; bgColor: string }> = {
      'idle': { text: t('generate.status.waiting'), color: '#71717a', bgColor: 'rgba(113, 113, 122, 0.1)' },
      'sending': { text: t('generate.status.sending'), color: 'var(--color-ember)', bgColor: 'rgba(196, 92, 38, 0.12)' },
      'generating': {
        text: worldBusy
          ? t('generate.status.buildingWorld')
          : t('generate.status.generating'),
        color: worldBusy ? 'var(--color-teal)' : 'var(--color-ember)',
        bgColor: worldBusy
          ? 'color-mix(in srgb, var(--color-teal) 14%, transparent)'
          : 'color-mix(in srgb, var(--color-ember) 14%, transparent)',
      },
      'building': {
        text: worldBusy
          ? t('generate.status.buildingWorld')
          : t('generate.status.building'),
        color: '#f59e0b',
        bgColor: 'rgba(245, 158, 11, 0.1)',
      },
      'deploying': { text: t('generate.status.deploying'), color: '#06b6d4', bgColor: 'rgba(6, 182, 212, 0.1)' },
      'preview': {
        text:
          generationMode === 'world'
            ? t('generate.status.worldReady')
            : t('generate.status.done'),
        color: '#22c55e',
        bgColor: 'rgba(34, 197, 94, 0.1)',
      },
      'error': { text: t('generate.status.error'), color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.1)' },
    };

    const status = statusMap[generationState] || statusMap['idle'];
    const isActive = isLoading || generationState === 'generating' || generationState === 'building' || generationState === 'deploying';
    const showIdleFailures = generationState === 'idle' && failedJobs.length > 0 && !isLoading;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: showIdleFailures ? 2 : 0,
          padding: '4px 12px',
          borderRadius: 20,
          background: status.bgColor,
          border: `1px solid ${status.color}20`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isActive && (
            <LoadingOutlined
              style={{ color: status.color, fontSize: 12 }}
              spin={!isLoading}
            />
          )}
          {!isActive && (
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: status.color,
                animation: generationState === 'preview' ? 'none' : 'pulse 2s infinite',
              }}
            />
          )}
          <Text style={{ fontSize: 12, color: status.color, fontWeight: 500 }}>
            {isLoading
              ? worldBusy
                ? t('generate.status.buildingWorld')
                : t('generate.status.thinking')
              : status.text}
          </Text>
        </div>
        {showIdleFailures && (
          <Text style={{ fontSize: 10, color: '#a16207', paddingLeft: 16, lineHeight: 1.35 }}>
            {t('generate.status.idleWithFailures', { count: failedJobs.length })}
          </Text>
        )}
      </div>
    );
  };

  return (
    <Layout
      style={{
        flex: 1,
        height: '100%',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-layout)',
      }}
    >
      {/* 顶部导航 */}
      <Header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        background: 'var(--bg-header)',
        height: 56,
        lineHeight: '56px',
        borderBottom: '1px solid var(--border-color)',
        zIndex: 100,
        boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.05)',
      }}>
        {/* 左侧：品牌、当前项目/会话、状态 */}
        <Space size={8} style={{ minWidth: 0, flex: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
          }}>
            <BrandLockup variant="full" size={32} />
          </div>
          {token ? (
            <>
              <Divider
                orientation="vertical"
                style={{ height: 24, margin: 0, borderColor: 'var(--border-color)' }}
              />
              <Dropdown
                popupRender={() => projectDropdown}
                trigger={['click']}
                placement="bottomLeft"
              >
                <Button
                  type="text"
                  size="small"
                  icon={<FolderOutlined />}
                  style={{ color: 'var(--text-secondary)', maxWidth: 220, height: 32 }}
                >
                  <Text ellipsis style={{ maxWidth: 160, fontSize: 12 }}>
                    {activeProjectName || '—'}
                  </Text>
                  <DownOutlined style={{ fontSize: 10, marginLeft: 4 }} />
                </Button>
              </Dropdown>
              <Text type="secondary" ellipsis style={{ maxWidth: 120, fontSize: 11 }}>
                {sessionLabel}
              </Text>
            </>
          ) : null}
          {/* Mode-first primary control */}
          <StudioModeSwitch
            mode={generationMode}
            onChange={handleGenerationModeChange}
          />
          {getStatusDisplay()}
          {canCancelJob ? (
            <Tooltip title={t('generate.cancel')}>
              <Button
                danger
                size="small"
                icon={<StopOutlined />}
                onClick={() => {
                  void cancelActiveJob();
                }}
                style={{ height: 28, fontSize: 12 }}
              >
                {t('generate.cancel')}
              </Button>
            </Tooltip>
          ) : null}
        </Space>

        {/* 右侧操作 */}
        <Space size={4}>
          {/* 主题切换 */}
          <Tooltip title={isDark ? '切换亮色模式' : '切换暗色模式'}>
            <Button
              type="text"
              icon={isDark ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggleTheme}
              style={{ color: 'var(--text-secondary)' }}
            />
          </Tooltip>

          <Tooltip title={t('product.tools.open')}>
            <Button
              type="text"
              icon={<ToolOutlined />}
              onClick={() =>
                openStudioTools(
                  generationMode === 'world'
                    ? 'world'
                    : codeChanges.length
                      ? 'code'
                      : 'quality',
                )
              }
              style={{ color: 'var(--text-secondary)' }}
            />
          </Tooltip>
          {generationMode === 'world' ? (
            <Tooltip title={t('world.research.open')}>
              <Button
                type="text"
                icon={<ExperimentOutlined />}
                onClick={() => {
                  openStudioTools('world');
                  setResearchFocusToken((n) => n + 1);
                }}
                style={{ color: '#a855f7' }}
              />
            </Tooltip>
          ) : null}
          <Tooltip title={t('generate.preview.newChat')}>
            <Button
              type="text"
              icon={<PlusOutlined />}
              onClick={() => {
                createNewSession();
                void loadSessions();
              }}
              style={{ color: 'var(--text-secondary)' }}
            />
          </Tooltip>
          <Tooltip title={t('generate.preview.history')}>
            <Button
              type="text"
              icon={<HistoryOutlined />}
              onClick={openSessionHistory}
              style={{ color: 'var(--text-secondary)' }}
            />
          </Tooltip>
          {projectId ? (
            <IterationHistory
              iterations={iterationRecords}
              currentVersion={iterationRecords.length || 1}
              messages={messages}
            />
          ) : null}
          <Tooltip title={t('nav.goPlay.tip')}>
            <Button
              type="text"
              icon={<GlobalOutlined />}
              style={{ color: 'var(--text-secondary)' }}
              onClick={() => navigate('/community')}
            >
              {isCompactViewport ? null : t('nav.goPlay')}
            </Button>
          </Tooltip>
          <Dropdown
            placement="bottomRight"
            menu={{
              items: supportedLocales().map((loc) => ({
                key: loc,
                label: loc === 'en' ? 'English' : '简体中文',
                onClick: () => setLocale(loc),
              })),
              selectedKeys: [locale],
            }}
          >
            <Button
              type="text"
              size="small"
              style={{ color: 'var(--text-secondary)' }}
            >
              {locale === 'zh-CN' ? '中' : 'EN'}
            </Button>
          </Dropdown>

          {token ? (
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Button
                type="text"
                icon={<UserOutlined style={{ color: 'var(--color-ember)' }} />}
                style={{ marginLeft: 8 }}
              />
            </Dropdown>
          ) : (
            <Button type="primary" href="/login" size="small" style={{ marginLeft: 8 }}>
              {t('generate.preview.login')}
            </Button>
          )}
        </Space>
      </Header>

      {/* 主内容区 */}
      <Content style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <SplitPane
          left={
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: 0,
                background: 'var(--bg-layout)',
              }}
            >
              {/* 失败任务面板（默认收起，避免遮挡对话与输入） */}
              {failedJobs.length > 0 && (
                <div style={{ flexShrink: 0 }}>
                  {!failedJobsExpanded ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setFailedJobsExpanded(true);
                        }
                      }}
                      onClick={() => setFailedJobsExpanded(true)}
                      style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        background: 'var(--bg-layout)',
                      }}
                    >
                      <Space>
                        <ExclamationCircleOutlined style={{ color: '#ef4444' }} />
                        <Text style={{ fontSize: 13 }}>
                          {t('generate.failedJobs.barTitle', { count: failedJobs.length })}
                        </Text>
                      </Space>
                      <DownOutlined style={{ color: 'var(--text-secondary)', fontSize: 12 }} />
                    </div>
                  ) : (
                    <div
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        background: 'var(--bg-layout)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          padding: '8px 12px 0',
                          gap: 8,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text type="secondary" style={{ fontSize: 12, display: 'block', lineHeight: 1.5 }}>
                            {t('generate.failedJobs.hint')}
                          </Text>
                          <Button
                            type="link"
                            size="small"
                            style={{ paddingLeft: 0, height: 'auto' }}
                            onClick={scrollChatInputIntoView}
                          >
                            {t('generate.failedJobs.scrollToInput')}
                          </Button>
                        </div>
                        <Button
                          type="text"
                          size="small"
                          icon={<UpOutlined />}
                          onClick={() => setFailedJobsExpanded(false)}
                        >
                          {t('generate.failedJobs.collapse')}
                        </Button>
                      </div>
                      <div style={{ padding: '0 12px 12px' }}>
                        <JobRetryPanel
                          projectId={activeProjectId}
                          failedJobs={failedJobs}
                          onRetry={retryJob}
                          onViewLog={handleViewLog}
                          onUseSuggestion={fillChatWithSuggestion}
                          onSendSuggestion={sendChatWithSuggestion}
                          loading={isLoading}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
              {projectId && (
                <GameContextWindow
                  gameContext={{}}
                  conversationSummary={agentSessionContext?.sessionSummary ?? ''}
                  lastModifiedFiles={codeChanges.map((c) => c.filename)}
                  iterationCount={iterationRecords.length}
                  brief={agentSessionContext?.brief ?? null}
                  memories={agentSessionContext?.memories ?? []}
                  projectId={projectId}
                  onSaveBrief={saveBrief}
                />
              )}
              
              
                            {(worldLineage || agentEvents.length > 0 || generationMode === 'world') ? (
                <div
                  style={{
                    padding: '4px 12px',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  <Collapse
                    size="small"
                    ghost
                    items={[
                      {
                        key: 'process',
                        label: t('product.process.title'),
                        children: (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {worldLineage ? (
                              <WorldLineageCard
                                snapshot={worldLineage}
                                onOpenWorld={() => openStudioTools('world')}
                              />
                            ) : null}
                            {agentEvents.length > 0 ? (
                              <AgentTimeline
                                events={agentEvents}
                                generationMode={generationMode}
                                activeJobId={activeJobId}
                              />
                            ) : null}
                            <TechFriendlyStrip
                              mode={generationMode}
                              lingbotMode={
                                lingbotStripHealth?.mode ??
                                worldSummary?.l3?.lingbotMode ??
                                null
                              }
                              weightsReady={lingbotStripHealth?.weightsReady ?? null}
                              readyReal={lingbotStripHealth?.readyReal ?? null}
                              worldCompiled={Boolean(worldLineage)}
                              worldTunablesSource={worldLineage?.tunablesSource ?? null}
                              onOpenWorld={() => openStudioTools('world')}
                              onOpenResearch={() => {
                                setGenerationMode('world');
                                storeGenerationMode('world');
                                openStudioTools('world');
                                setResearchFocusToken((n) => n + 1);
                              }}
                            />
                          </div>
                        ),
                      },
                    ]}
                  />
                </div>
              ) : null}
              {/* 对话区域 */}
              <div
                style={{
                  flex: '1 1 0',
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <ConversationPanel
                  messages={messages}
                  draftValue={chatDraft}
                  draftNonce={chatDraftNonce}
                  onUseSuggestion={fillChatWithSuggestion}
                  onSendSuggestion={sendChatWithSuggestion}
                  onSendMessage={(content, images) => {
                    const mode =
                      generationMode === 'world'
                        ? worldSummary
                          ? 'world_edit'
                          : 'world'
                        : 'game';
                    if (mode === 'game' && needsDesignIntake && !intakeOpen) {
                      setIntakePrompt(content);
                      setIntakeImages(images);
                      setIntakeMode(mode);
                      setIntakeOpen(true);
                      return;
                    }
                    commitGenerate(content, images, mode);
                  }}
                  loading={isLoading}
                  chatInputAnchorRef={chatInputAnchorRef}
                  generationMode={generationMode}
                  onGenerationModeChange={handleGenerationModeChange}
                  onOpenWorldPanel={() => {
                    openStudioTools('world');
                    setResearchFocusToken((n) => n + 1);
                  }}
                  hasWorldTip={Boolean(worldSummary)}
                  worldCreatePrefs={worldCreatePrefs}
                  onWorldCreatePrefsChange={applyWorldCreatePrefs}
                  onRegenerate={() => {
                    void retryLastMessage();
                  }}
                  onShareToCommunity={
                    deploymentId ? openCommunityShare : undefined
                  }
                />
                <DesignIntakeCard
                  open={intakeOpen}
                  promptPreview={intakePrompt}
                  loading={isLoading}
                  onConfirm={(answers) => {
                    setIntakeOpen(false);
                    pickArtStyle(artStyleIdOf(answers.artTone));
                    commitGenerate(
                      intakePrompt,
                      intakeImages,
                      intakeMode,
                      answers,
                    );
                  }}
                  onSkip={(answers) => {
                    setIntakeOpen(false);
                    pickArtStyle(artStyleIdOf(answers.artTone));
                    commitGenerate(
                      intakePrompt,
                      intakeImages,
                      intakeMode,
                      answers,
                    );
                  }}
                />
                {generationMode === 'world' && !worldSummary ? null : (
                  <div style={{ padding: '0 20px 6px' }}>
                    <ArtStyleBar
                      value={artStyleId}
                      onChange={pickArtStyle}
                      disabled={isLoading}
                    />
                  </div>
                )}
                {generationMode === 'game' ? (
                  <div style={{ padding: '0 20px 4px' }}>
                    <GameConfigBar
                      params={gameThemeParams}
                      onChange={(next) =>
                        setGameThemeParams(normalizeGameThemeParams(next))
                      }
                    />
                  </div>
                ) : null}
              </div>
              {/* 快捷操作：收成一行入口，不占首屏 */}
              {generationMode === 'game' ? (
                <div
                  style={{
                    flexShrink: 0,
                    borderTop: '1px solid var(--border-color)',
                    padding: '6px 16px',
                    background: 'var(--bg-layout)',
                    display: 'flex',
                    justifyContent: 'flex-end',
                  }}
                >
                  <Button
                    type="text"
                    size="small"
                    icon={<MenuOutlined />}
                    onClick={() => setQuickActionsDrawerVisible(true)}
                    style={{ color: 'var(--text-secondary)', fontSize: 12 }}
                  >
                    {t('generate.quickActions.open')}
                  </Button>
                </div>
              ) : null}
            </div>
          }
          right={
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-layout)' }}>
              <div style={{ flex: '1 1 100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <LivePreview
                  previewUrl={previewUrl}
                  deploymentId={deploymentId}
                  isGenerating={
                    isLoading ||
                    liveProjectJobs.some(
                      (j) => j.status === 'queued' || j.status === 'running',
                    )
                  }
                  playableDraft={Boolean(playableDraft && previewUrl && isLoading)}
                  pipelineStage={previewPipelineStage}
                  generationMode={generationMode}
                  projectId={activeProjectId ?? projectId}
                  worldPaneFocusToken={worldPaneFocusToken}
                  onShareToCommunity={deploymentId ? openCommunityShare : undefined}
                  publishedCommunitySlug={publishedCommunitySlug}
                  onOpenCommunityGame={(slug) =>
                    window.open(`/community/game/${slug}`, '_blank', 'noopener,noreferrer')
                  }
                  onOpenWorldPanel={() => {
                    openStudioTools('world');
                    setResearchFocusToken((n) => n + 1);
                  }}
                  onStartWorldDemo={() => startWorldDemo()}
                  remountKey={worldRefreshToken}
                  generateFailed={studioOverlayGenerateFailed({
                    hasCurrentWorldFail: failedJobs.some((job) =>
                      isWorldJobType(job.type),
                    ),
                    isGenerating: isLoading,
                    generationState,
                    jobLifecycleStatus,
                  })}
                  assetProgress={worldAssetProgress}
                  onRetryFailedJob={() => {
                    const failed = failedJobs.find((job) =>
                      isWorldJobType(job.type),
                    );
                    if (failed) void retryJob(failed.id);
                  }}
                  onRefreshPreview={async () => {
                    try {
                      await refreshPreview();
                      setWorldRefreshToken((n) => n + 1);
                    } catch {
                      message.warning(t('preview.diag.noDeployment'));
                    }
                  }}
                  worldSummary={
                    generationMode === 'world' ? worldSummary : null
                  }
                  acceptanceChecks={deriveAcceptanceChecks(
                    agentEvents,
                    generationMode,
                    jobLifecycleStatus,
                  )}
                  onOpenQuality={() => openStudioTools('quality')}
                  errorSummary={previewErrorSummary}
                  progressPanel={
                    isLoading && (generationMode === 'world' || !previewUrl) ? (
                      <PreviewPipelineStrip
                        agentEvents={agentEvents}
                        activeJobId={activeJobId}
                        generationState={generationState}
                        generationMode={generationMode}
                        startedAt={activeJobStartedAt}
                        resumePercent={resumePercent}
                      />
                    ) : null
                  }
                />
              </div>
              {/* quality / code / feedback → StudioToolsDrawer */}
            </div>
          }
          defaultLeftWidth={42}
          minLeftWidth={35}
          maxLeftWidth={55}
        />
      </Content>

      <GlobalJobDock
        jobs={liveProjectJobs}
        runningElsewhere={runningElsewhere}
        activeJobId={activeJobId}
        onRefresh={() => void refreshLiveProjectJobs()}
        onRecoverStale={() => void recoverStaleJobs()}
        onCancelActive={() => void cancelActiveJob()}
        canCancelActive={canCancelJob}
      />

      {/* 游戏设置 */}
      <GameSettings
        open={gameSettingsVisible}
        onClose={() => setGameSettingsVisible(false)}
        onApply={() => setGameSettingsVisible(false)}
      />

      <StudioToolsDrawer
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        activeTab={toolsTab}
        onTabChange={setToolsTab}
        generationMode={generationMode}
        projectId={activeProjectId ?? projectId}
        agentEvents={agentEvents}
        generationState={generationState}
        isLoading={isLoading}
        jobLifecycleStatus={jobLifecycleStatus}
        queuedTimeoutHint={queuedTimeoutHint}
        activeJobId={activeJobId}
        qualityTabRequest={qualityTabRequest}
        previewUrl={previewUrl}
        liveProjectJobs={liveProjectJobs}
        runningElsewhere={runningElsewhere}
        jobType={liveProjectJobs.find((j) => j.id === activeJobId)?.type ?? null}
        jobStartedAt={activeJobStartedAt}
        codeChanges={codeChanges}
        worldRefreshToken={worldRefreshToken}
        researchFocusToken={researchFocusToken}
        onPreviewRemount={() => setWorldRefreshToken((n) => n + 1)}
        onRequestWorldGenerate={(prompt) => {
          startWorldDemo(prompt);
        }}
        onRequestWorldEdit={(prompt) => {
          setToolsOpen(false);
          setGenerationMode('world');
          storeGenerationMode('world');
          void sendMessage(prompt, undefined, undefined, 'world_edit');
        }}
        lastSuccessJobId={lastSuccessJobId}
      />

      <Drawer
        title={t('generate.preview.history')}
        placement="left"
        size="default"
        open={sessionDrawerVisible}
        onClose={() => setSessionDrawerVisible(false)}
        styles={{ body: { padding: 0 } }}
      >
        <SessionHistory
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={(sessionId) => {
            selectSession(sessionId);
            setSessionDrawerVisible(false);
          }}
          onNewSession={() => {
            createNewSession();
            setSessionDrawerVisible(false);
          }}
          onDeleteSession={deleteSession}
          onForkSession={(sessionId) => {
            void forkSession(sessionId);
          }}
        />
      </Drawer>

      <Drawer
        title={t('generate.quickActions.open')}
        placement="bottom"
        size="default"
        open={quickActionsDrawerVisible}
        onClose={() => setQuickActionsDrawerVisible(false)}
      >
        <QuickActions onAction={handleQuickAction} disabled={isLoading} />
      </Drawer>

      {/* 发布弹窗 */}
      
        <PublishGameModal
          open={communityShareOpen}
          onClose={() => setCommunityShareOpen(false)}
          deploymentId={deploymentId ?? undefined}
          projectId={projectIdForWorld ?? undefined}
          projectName={
            projects.find((x) => x.id === (activeProjectId ?? projectId))?.name
          }
          kind={generationMode === 'world' ? 'world' : 'game'}
          onSuccess={(slug) => {
            if (deploymentId) rememberPublishedSlug(deploymentId, slug);
            setPublishedSlugTick((n) => n + 1);
            // The modal now stays open on its "here is your page" step; opening
            // a tab here would yank the author away from copying the link.
          }}
        />

        <OutOfPointsModal shortfall={outOfPoints} onClose={dismissOutOfPoints} />

        <Modal
        title="发布与域名"
        open={featureFlags.customDomain && publishModalVisible}
        onCancel={() => setPublishModalVisible(false)}
        footer={null}
        width={640}
      >
        <div style={{ padding: '8px 0' }}>
          <Text strong style={{ fontSize: 14 }}>
            自定义域名与 CDN
          </Text>
          <div style={{ marginTop: 12 }}>
            <CustomDomainPanel deploymentId={deploymentId ?? null} />
          </div>
        </div>
      </Modal>

      {/* 新手引导 */}
      <OnboardingGuide
        open={showOnboarding}
        onClose={() => {
          closeOnboarding();
        }}
        onStartCreate={() => {
          completeOnboarding();
          setGenerationMode('game');
          storeGenerationMode('game');
          scrollChatInputIntoView();
        }}
        onStartWorld={() => {
          completeOnboarding();
          startWorldDemo();
        }}
      />

      {/* 日志查看抽屉 */}
      <Drawer
        title={logDrawerTitle || t('generate.failedJobs.drawerBuildLog')}
        open={logDrawerVisible}
        onClose={() => setLogDrawerVisible(false)}
        size="large"
        styles={{ body: { padding: 0 } }}
      >
        {logLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
            <Spin />
          </div>
        ) : (
          <pre style={{
            margin: 0,
            padding: 16,
            fontSize: 12,
            fontFamily: 'Monaco, Menlo, monospace',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            overflow: 'auto',
            maxHeight: 'calc(100vh - 100px)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            {logContent}
          </pre>
        )}
      </Drawer>

      {/* 右下角帮助 */}
      <div style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 1000,
      }}>
        <Tooltip title={t('onboarding.help')}>
          <Button
            type="primary"
            shape="circle"
            icon={<QuestionCircleOutlined />}
            size="large"
            onClick={() => openOnboarding()}
            style={{
              background: 'linear-gradient(135deg, var(--color-ember) 0%, var(--color-gold) 100%)',
              border: 'none',
              boxShadow: '0 4px 16px rgba(99, 102, 241, 0.4)',
            }}
          />
        </Tooltip>
      </div>
    </Layout>
  );
};
