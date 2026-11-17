/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Drawer,
  List,
  Result,
  Segmented,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  AppstoreOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  MessageOutlined,
  PlusOutlined,
  ReloadOutlined,
  SlidersOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import type { ArtStyleId } from '@opengame/world-spec';

import { ChatInput } from '../../components/Conversation/ChatInput.js';
import { MessageList } from '../../components/Conversation/MessageList.js';
import { PublishGameModal } from '../../components/Community/PublishGameModal.js';
import { OutOfPointsModal } from '../../components/Billing/OutOfPointsModal.js';
import {
  ArtStyleBar,
  readStoredArtStyleId,
  storeArtStyleId,
} from '../../components/Params/ArtStyleBar.js';
import {
  normalizeGameThemeParams,
  defaultGameThemeParams,
  type GameThemeParams,
} from '../../components/Params/GameParamsPanel.js';
import {
  composeWorldGeneratePrompt,
  worldBriefOf,
} from '../../components/World/composeWorldBrief.js';
import {
  readWorldCreatePrefs,
  societySeedHoursOf,
  storeWorldCreatePrefs,
  worldPopulationOf,
  type WorldCreatePrefs,
} from '../../components/World/worldCreatePrefs.js';
import {
  readStoredGenerationMode,
  storeGenerationMode,
  type GenerationMode,
} from '../../components/World/worldTemplates.js';
import { useGeneration } from '../../hooks/useGeneration.js';
import type { GameParamsConfig } from '../../services/api.js';
import { AlleyEmpty } from '../../components/brand/AlleyEmpty.js';
import { useT } from '../../services/i18n.js';
import { useAppStore } from '../../store/index.js';
import { previewIframeAllow, previewIframeSandbox } from '../../utils/previewIframeSandbox.js';
import { getPublishedSlug } from '../../utils/communityPublishMemory.js';
import { rememberLoginReturnTo } from '../../utils/loginIntent.js';
import {
  derivePipelineSteps,
  pipelineVisualPercent,
} from '../../utils/creationPipeline.js';
import {
  getActiveJobEvents,
  getEffectivePhase,
  phaseToProgressPercent,
} from '../../utils/generationProgressText.js';
import {
  patchLiveJobSnapshot,
  readLiveJobSnapshot,
} from '../../utils/generationResume.js';
import { ConfigSheet } from '../studio/ConfigSheet.js';
import { PipelineOverlay } from '../studio/PipelineOverlay.js';
import { ToolsSheet, type ToolsTab } from '../studio/ToolsSheet.js';

const { Text } = Typography;

type Sheet = 'none' | 'chat' | 'tools' | 'config' | 'projects';

function withObserveMode(url: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.set('mode', 'observe');
    return parsed.toString();
  } catch {
    return url.includes('?') ? `${url}&mode=observe` : `${url}?mode=observe`;
  }
}

function readGameParams(): GameThemeParams {
  try {
    const raw = localStorage.getItem('opengame_game_theme_params');
    if (raw) return normalizeGameThemeParams(JSON.parse(raw) as GameThemeParams);
  } catch {
    /* fall through to defaults */
  }
  return defaultGameThemeParams;
}

/**
 * The phone studio. Same hook, same jobs, same projects as the desktop one —
 * what changes is that the preview owns the screen and everything else is a
 * sheet you pull up. Side-by-side chat, preview and code is unusable at 390px
 * wide, and shrinking the desktop SplitPane would have shipped exactly that.
 */
export const MobileStudio: React.FC = () => {
  const { t } = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated } = useAppStore();
  const gen = useGeneration();

  const [mode, setMode] = useState<GenerationMode>(() => readStoredGenerationMode());
  const [sheet, setSheet] = useState<Sheet>('none');
  const [toolsTab, setToolsTab] = useState<ToolsTab>('assets');
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishTick, setPublishTick] = useState(0);
  const [pipelineHidden, setPipelineHidden] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [chatDraftNonce, setChatDraftNonce] = useState(0);
  const [artStyleId, setArtStyleId] = useState<ArtStyleId>(
    () => readStoredArtStyleId() ?? readWorldCreatePrefs().artStyleId,
  );
  const [gameParams, setGameParams] = useState<GameThemeParams>(readGameParams);
  const [worldPrefs, setWorldPrefs] = useState<WorldCreatePrefs>(() =>
    readWorldCreatePrefs(),
  );

  const {
    activeProjectId,
    projects,
    previewUrl,
    playableDraft,
    isLoading,
    generationState,
    jobLifecycleStatus,
    queuedTimeoutHint,
    messages,
    agentEvents,
    activeJobId,
    activeJobStartedAt,
    resumePercent,
    codeChanges,
    iterationRecords,
    failedJobs,
    sessions,
    currentSessionId,
    deploymentId,
    canCancelJob,
  } = gen;

  const busy =
    isLoading ||
    generationState === 'generating' ||
    generationState === 'building' ||
    generationState === 'deploying';

  const resumeSnap = activeProjectId ? readLiveJobSnapshot(activeProjectId) : null;
  const resumeSteps =
    resumeSnap && resumeSnap.jobId === activeJobId ? resumeSnap.steps : [];

  useEffect(() => {
    if (!activeProjectId || !activeJobId) {
      setPipelineHidden(false);
      return;
    }
    const snap = readLiveJobSnapshot(activeProjectId);
    setPipelineHidden(Boolean(snap && snap.jobId === activeJobId && snap.pipelineHidden));
  }, [activeProjectId, activeJobId]);

  useEffect(() => {
    if (!busy) setPipelineHidden(false);
  }, [busy]);

  useEffect(() => {
    if (!activeProjectId || !activeJobId || !busy) return;
    const jobEvents = getActiveJobEvents(agentEvents, activeJobId);
    if (jobEvents.length === 0) return;
    const steps = derivePipelineSteps(jobEvents, mode, {
      failed: generationState === 'error',
      hasPreview: Boolean(previewUrl),
    });
    patchLiveJobSnapshot(activeProjectId, {
      visualPercent: pipelineVisualPercent(
        steps,
        phaseToProgressPercent(getEffectivePhase(jobEvents)),
      ),
      steps: steps.map((s) => ({
        id: s.id,
        status: s.status,
        labelKey: s.labelKey,
      })),
    });
  }, [activeProjectId, activeJobId, busy, agentEvents, mode, generationState, previewUrl]);

  // Deep links from a remix ("/?project=x&remix=one line") must land in the
  // studio with the sentence already typed, not on an empty screen.
  const remixApplied = useRef(false);
  useEffect(() => {
    if (remixApplied.current) return;
    const projectParam = searchParams.get('project');
    const remix = searchParams.get('remix');
    const modeParam = searchParams.get('mode');
    if (modeParam === 'world' || modeParam === 'game') {
      setMode(modeParam);
      storeGenerationMode(modeParam);
    }
    if (projectParam && projectParam !== activeProjectId) {
      if (!projects.some((p) => p.id === projectParam)) return;
      void gen.selectProject(projectParam);
    }
    if (remix) {
      setChatDraft(remix);
      setChatDraftNonce((n) => n + 1);
      setSheet('chat');
    }
    if (projectParam || remix || modeParam) {
      remixApplied.current = true;
      const next = new URLSearchParams(searchParams);
      next.delete('remix');
      setSearchParams(next, { replace: true });
    }
  }, [activeProjectId, gen, projects, searchParams, setSearchParams]);

  useEffect(() => {
    if (busy) setPipelineHidden(false);
  }, [busy]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const publishedSlug = useMemo(() => {
    void publishTick;
    return getPublishedSlug(deploymentId);
  }, [deploymentId, publishTick]);

  const stageUrl = useMemo(() => {
    if (!previewUrl) return null;
    return mode === 'world' ? withObserveMode(previewUrl) : previewUrl;
  }, [previewUrl, mode]);

  const jobParams = (): GameParamsConfig =>
    mode === 'world'
      ? {
          artStyleId,
          worldPopulation: worldPopulationOf(worldPrefs),
          societySeedHours: societySeedHoursOf(worldPrefs),
          worldBrief: worldBriefOf(worldPrefs),
        }
      : { ...gameParams, artStyleId };

  const submit = (content: string, images?: string[]): void => {
    const jobMode: 'game' | 'world' | 'world_edit' =
      mode === 'world' ? (previewUrl ? 'world_edit' : 'world') : 'game';
    const body =
      jobMode === 'world'
        ? /场所必须包含|Places must include/i.test(content)
          ? content
          : composeWorldGeneratePrompt(worldPrefs, content)
        : content;
    setSheet('none');
    void gen.sendMessage(body, jobParams(), images, jobMode);
  };

  const changeMode = (next: GenerationMode): void => {
    setMode(next);
    storeGenerationMode(next);
  };

  const pickArtStyle = (next: ArtStyleId): void => {
    setArtStyleId(next);
    storeArtStyleId(next);
    const merged = { ...worldPrefs, artStyleId: next };
    setWorldPrefs(merged);
    storeWorldCreatePrefs(merged);
  };

  const updateGameParams = (next: GameThemeParams): void => {
    setGameParams(next);
    try {
      localStorage.setItem('opengame_game_theme_params', JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  const openPublish = (): void => {
    if (!deploymentId) {
      message.info(t('mobile.studio.publish.needBuild'));
      return;
    }
    setPublishOpen(true);
  };

  if (!isAuthenticated) {
    return (
      <Result
        icon={<AppstoreOutlined />}
        title={t('mobile.studio.signInTitle')}
        subTitle={t('mobile.studio.signInHint')}
        extra={
          <Button
            type="primary"
            onClick={() => {
              rememberLoginReturnTo('/');
              navigate('/login');
            }}
          >
            {t('mobile.me.signIn')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="og-studio">
      <div className="og-studio__stage">
        {stageUrl ? (
          <iframe
            key={stageUrl}
            className="og-play-stage__frame"
            src={stageUrl}
            title={activeProject?.name ?? 'preview'}
            sandbox={previewIframeSandbox(stageUrl)}
            allow={previewIframeAllow()}
          />
        ) : (
          <div className="og-studio__empty">
            <AlleyEmpty
              title={
                mode === 'world'
                  ? t('mobile.studio.empty.world')
                  : t('mobile.studio.empty.game')
              }
              hint={t('mobile.studio.empty.hint')}
              action={t('mobile.studio.empty.cta')}
              onAction={() => setSheet('chat')}
            />
          </div>
        )}

        <div className="og-play-stage__overlay">
          <button
            type="button"
            className="og-play-stage__chip"
            style={{ flex: 1, minWidth: 0 }}
            onClick={() => setSheet('projects')}
          >
            <FolderOpenOutlined />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {activeProject?.name ?? t('mobile.studio.noProject')}
            </span>
          </button>
          <Segmented
            size="small"
            value={mode}
            onChange={(v) => changeMode(v as GenerationMode)}
            options={[
              { label: t('mobile.studio.modeGame'), value: 'game' },
              { label: t('mobile.studio.modeWorld'), value: 'world' },
            ]}
          />
        </div>

        {playableDraft && !busy && (
          <div className="og-studio__banner">
            <Alert
              type="info"
              showIcon
              banner
              message={t('mobile.studio.draftPlayable')}
            />
          </div>
        )}
      </div>

      <div className="og-studio__dock">
        <button
          type="button"
          className="og-studio__prompt"
          onClick={() => setSheet('chat')}
          disabled={busy}
        >
          <MessageOutlined />
          <span>
            {busy
              ? t('mobile.studio.dock.busy')
              : previewUrl
                ? t('mobile.studio.dock.iterate')
                : t('mobile.studio.dock.create')}
          </span>
        </button>
        <Button
          icon={<SlidersOutlined />}
          onClick={() => setSheet('config')}
          aria-label={t('mobile.studio.config.title')}
        />
        <Button
          icon={<ToolOutlined />}
          onClick={() => {
            setToolsTab(
              mode === 'world' ? 'observatory' : codeChanges.length ? 'code' : 'assets',
            );
            setSheet('tools');
          }}
          aria-label={t('mobile.studio.tools.title')}
        />
        <Button
          type="primary"
          icon={<CloudUploadOutlined />}
          disabled={!previewUrl}
          onClick={() => (publishedSlug ? navigate(`/play/${publishedSlug}`) : openPublish())}
          aria-label={
            publishedSlug
              ? t('mobile.studio.publish.view')
              : t('mobile.studio.publish.action')
          }
        />
      </div>

      {busy && !pipelineHidden && (
        <PipelineOverlay
          events={agentEvents}
          activeJobId={activeJobId}
          mode={mode}
          failed={generationState === 'error'}
          hasPreview={Boolean(previewUrl)}
          queued={jobLifecycleStatus === 'queued'}
          queuedTimeoutHint={queuedTimeoutHint}
          canCancel={canCancelJob}
          onCancel={() => void gen.cancelActiveJob()}
          startedAt={activeJobStartedAt}
          resumePercent={resumePercent}
          resumeSteps={resumeSteps}
          onMinimize={() => {
            setPipelineHidden(true);
            if (activeProjectId) {
              patchLiveJobSnapshot(activeProjectId, { pipelineHidden: true });
            }
          }}
        />
      )}

      {busy && pipelineHidden && (
        <button
          type="button"
          className="og-studio__resume"
          onClick={() => {
            setPipelineHidden(false);
            if (activeProjectId) {
              patchLiveJobSnapshot(activeProjectId, { pipelineHidden: false });
            }
          }}
        >
          <ReloadOutlined spin /> {t('mobile.studio.pipeline.stillRunning')}
        </button>
      )}

      <Drawer
        className="og-sheet"
        placement="bottom"
        size="88%"
        open={sheet === 'chat'}
        onClose={() => setSheet('none')}
        title={
          mode === 'world'
            ? t('mobile.studio.chat.titleWorld')
            : t('mobile.studio.chat.title')
        }
        extra={
          <Button size="small" onClick={() => gen.createNewSession()}>
            {t('mobile.studio.chat.newSession')}
          </Button>
        }
        styles={{ body: { display: 'flex', flexDirection: 'column', padding: 0 } }}
      >
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px' }}>
          <MessageList
            messages={messages}
            loading={isLoading}
            onUseSuggestion={(prompt) => {
              setChatDraft(prompt);
              setChatDraftNonce((n) => n + 1);
            }}
            onSendSuggestion={(prompt) => submit(prompt)}
            onShareToCommunity={openPublish}
          />
        </div>
        <div style={{ flex: 'none', padding: '8px 12px 12px', borderTop: '1px solid var(--border-color)' }}>
          <ArtStyleBar value={artStyleId} onChange={pickArtStyle} disabled={busy} />
          <div style={{ height: 8 }} />
          <ChatInput
            onSend={submit}
            loading={isLoading}
            generationMode={mode}
            draftValue={chatDraft}
            draftNonce={chatDraftNonce}
            placeholder={
              mode === 'world'
                ? t('mobile.studio.chat.placeholderWorld')
                : t('mobile.studio.chat.placeholder')
            }
          />
        </div>
      </Drawer>

      <ConfigSheet
        open={sheet === 'config'}
        onClose={() => setSheet('none')}
        mode={mode}
        artStyleId={artStyleId}
        onArtStyleChange={pickArtStyle}
        params={gameParams}
        onParamsChange={updateGameParams}
        worldPrefs={worldPrefs}
        onWorldPrefsChange={(next) => {
          setWorldPrefs(next);
          storeWorldCreatePrefs(next);
          setArtStyleId(next.artStyleId);
        }}
        disabled={busy}
      />

      <ToolsSheet
        open={sheet === 'tools'}
        onClose={() => setSheet('none')}
        tab={toolsTab}
        onTabChange={setToolsTab}
        projectId={activeProjectId}
        mode={mode}
        codeChanges={codeChanges}
        agentEvents={agentEvents}
        activeJobId={activeJobId}
        iterationRecords={iterationRecords}
        failedJobs={failedJobs}
        onRetryJob={(jobId) => void gen.retryJob(jobId)}
      />

      <Drawer
        className="og-sheet"
        placement="bottom"
        size="70%"
        open={sheet === 'projects'}
        onClose={() => setSheet('none')}
        title={t('mobile.studio.projects.title')}
        extra={
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => void gen.createNewProject()}
          >
            {t('mobile.studio.projects.new')}
          </Button>
        }
      >
        <List
          dataSource={projects}
          renderItem={(p) => (
            <List.Item
              actions={
                projects.length > 1
                  ? [
                      <Button
                        key="del"
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          void gen.deleteProject(p.id);
                        }}
                      />,
                    ]
                  : undefined
              }
              onClick={() => {
                void gen.selectProject(p.id);
                setSheet('none');
              }}
            >
              <List.Item.Meta
                title={
                  <Space size={6}>
                    <Text>{p.name}</Text>
                    {p.id === activeProjectId && (
                      <Tag color="blue">{t('mobile.studio.projects.current')}</Tag>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
        {sessions.length > 0 && (
          <>
            <Text strong style={{ fontSize: 13 }}>
              {t('mobile.studio.projects.sessions')}
            </Text>
            <List
              size="small"
              dataSource={sessions}
              renderItem={(s) => (
                <List.Item
                  onClick={() => {
                    gen.selectSession(s.id);
                    setSheet('chat');
                  }}
                >
                  <List.Item.Meta
                    title={
                      <Text style={{ fontSize: 13 }}>
                        {s.title}
                        {s.id === currentSessionId ? ' ·' : ''}
                      </Text>
                    }
                  />
                </List.Item>
              )}
            />
          </>
        )}
      </Drawer>

      <PublishGameModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        deploymentId={deploymentId ?? undefined}
        projectId={activeProjectId ?? undefined}
        projectName={activeProject?.name}
        kind={mode === 'world' ? 'world' : 'game'}
        onSuccess={(slug) => {
          setPublishTick((n) => n + 1);
          setPublishOpen(false);
          navigate(`/play/${slug}`);
        }}
      />

      <OutOfPointsModal shortfall={gen.outOfPoints} onClose={gen.dismissOutOfPoints} />
    </div>
  );
};

export default MobileStudio;
