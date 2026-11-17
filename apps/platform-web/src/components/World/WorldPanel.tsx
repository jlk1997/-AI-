/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  Empty,
  List,
  Modal,
  Space,
  Steps,
  Tag,
  Typography,
  Spin,
  Select,
  Row,
  Col,
} from 'antd';
import {
  GlobalOutlined,
  ReloadOutlined,
  ExperimentOutlined,
  EditOutlined,
  PlayCircleOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  DiffOutlined,
} from '@ant-design/icons';
import { api } from '../../services/api';
import { useT } from '../../services/i18n';
import { useTheme } from '../../hooks/useTheme';
import {
  WORLD_TEMPLATES,
  firstClickWorldTemplates,
  promptForWorldTemplate,
  readLastWorldGeneratePrompt,
  type WorldTemplate,
} from './worldTemplates';
import {
  applyWorldTemplateToPrefs,
  composeWorldTemplatePrompt,
} from './composeWorldBrief';
import {
  readWorldCreatePrefs,
  storeWorldCreatePrefs,
} from './worldCreatePrefs';
import { LingBotResearchLab } from './LingBotResearchLab';
import { WorldNarrativeCard } from './WorldNarrativeCard';
import { CourseDebugPanel } from './CourseDebugPanel';
import { featureFlags } from '../../utils/featureFlags';
import { createPerfMarker } from '@opengame/platform-shared';

const { Text, Paragraph, Title } = Typography;

export interface WorldPanelProps {
  readonly projectId: string | null;
  readonly onRequestWorldGenerate?: (prompt?: string) => void;
  readonly onRequestWorldEdit?: (prompt: string) => void;
  /** Bump to force reload after world_generate / world_edit succeeds. */
  readonly refreshToken?: number;
  /** Remount LivePreview after L3 clip stamps Spec + deployment world.json. */
  readonly onPreviewRemount?: () => void;
  /** Bump to scroll/focus the research lab (LingBot L3). */
  readonly researchFocusToken?: number;
}

type WorldTip = {
  id: string;
  title: string;
  tipRevision: number;
  summary: string;
  metaSummary?: string | null;
  openingRumor?: string | null;
  gameplay?: {
    regions: number;
    npcs: number;
    enemies: number;
    items: number;
    quests: number;
    portals: number;
    hasCombat: boolean;
    hasInventoryLoop: boolean;
    winCondition: string;
    controls: string[];
  };
  l3?: {
    backend: string | null;
    lingbotMode: 'mock' | 'real' | null;
    cinematicEnabled: boolean;
    plannerSource: string | null;
    regionsWithVideo: string[];
    clipCount: number;
  };
  l2?: {
    opsApplied: number;
    regionsDelta: number;
    questsDelta: number;
    rulesDelta: number;
    narrativeSeed: string | null;
  } | null;
  spec: {
    entities?: Array<{ id: string; kind: string; name: string; regionId: string }>;
    space?: { regions?: Array<{ id: string; name: string }> };
    narrative?: {
      quests?: Array<{ id: string; title: string; status: string }>;
      flags?: Record<string, boolean>;
    };
    presentation?: {
      cinematicEnabled?: boolean;
      spatialBackend?: string;
      lingbotMode?: string;
      plannerSource?: string;
      narrativeSeed?: string;
      agenticDiff?: {
        beforeRegions: number;
        afterRegions: number;
        beforeQuests: number;
        afterQuests: number;
        opsApplied: number;
      };
    };
    timeHours?: number;
  };
  updatedAt?: string;
};

type RevisionRow = {
  revision: number;
  parentRevision: number | null;
  summary: string | null;
  createdAt: string;
  op?: {
    dirtyRegions?: string[];
    dirtyAssetKeys?: string[];
    planner?: string;
    op?: string;
    diffSummary?: {
      summaryLines?: string[];
      addedRegions?: string[];
      removedRegions?: string[];
      addedQuests?: string[];
      removedQuests?: string[];
      regionsBefore?: number;
      regionsAfter?: number;
      questsBefore?: number;
      questsAfter?: number;
    };
  } | null;
};

type RevisionDiffPayload = {
  fromRevision: number;
  toRevision: number;
  diff: {
    summaryLines: string[];
    addedRegions: string[];
    removedRegions: string[];
    addedQuests: string[];
    removedQuests: string[];
    addedEntities: string[];
    removedEntities: string[];
    addedRules: string[];
    removedRules: string[];
    regionsBefore: number;
    regionsAfter: number;
    questsBefore: number;
    questsAfter: number;
    entitiesBefore: number;
    entitiesAfter: number;
    rulesBefore: number;
    rulesAfter: number;
  };
  fromSummary: string;
  toSummary: string;
  storedDiffSummary: unknown;
  dirtyRegions: unknown;
};

export const WorldPanel: React.FC<WorldPanelProps> = ({
  projectId,
  onRequestWorldGenerate,
  onRequestWorldEdit,
  refreshToken = 0,
  onPreviewRemount,
  researchFocusToken = 0,
}) => {
  const { t } = useT();
  const { message } = App.useApp();
  const { isDark } = useTheme();
  const researchRef = React.useRef<HTMLDivElement>(null);
  // 批次 9：性能预算。每个 WorldPanel 实例独立一份 marker，避免互相覆盖。
  const perfRef = React.useRef<ReturnType<typeof createPerfMarker> | null>(null);
  if (perfRef.current == null) {
    perfRef.current = createPerfMarker({
      budgets: {
        world_render: { softLimitMs: 800, hardLimitMs: 1500 },
        narrative_render: { softLimitMs: 400, hardLimitMs: 800 },
      },
    });
  }
  const [loading, setLoading] = useState(false);
  const [world, setWorld] = useState<WorldTip | null>(null);
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffPayload, setDiffPayload] = useState<RevisionDiffPayload | null>(null);
  const [spatialBackend, setSpatialBackend] = useState<string>('null');
  const [spatialPreview, setSpatialPreview] = useState<{
    message: string;
    videoUrl?: string;
    frameUrl?: string;
    licenseNote?: string;
    fallbackFromReal?: boolean;
    presentationMock?: boolean;
  } | null>(null);
  const [lingbotSessionId, setLingbotSessionId] = useState<string | null>(null);
  const [lastTrainResult, setLastTrainResult] = useState<{
    finalLoss?: number;
    steps?: number;
  } | null>(null);
  const [lastImagineResult, setLastImagineResult] = useState<{
    preferred?: string;
    surprise?: number;
  } | null>(null);
  const [lingbotHealth, setLingbotHealth] = useState<{
    ok: boolean;
    mode?: string;
    acceptNc?: boolean;
    profile?: string;
    readyReal?: boolean;
    weightsReady?: boolean;
    shardComplete?: number;
    shardExpected?: number;
    gpuName?: string;
    vramMb?: number;
    warnings?: string[];
    recommendedFrameNum?: number;
    ckpt?: string | null;
    repo?: string | null;
  } | null>(null);
  const [clipBusy, setClipBusy] = useState(false);
  const [clipFrameNum, setClipFrameNum] = useState<number>(17);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setWorld(null);
      setRevisions([]);
      return;
    }
    setLoading(true);
    perfRef.current?.mark('world_render');
    try {
      const [w, r] = await Promise.all([
        api.world.get(projectId),
        api.world.revisions(projectId),
      ]);
      setWorld((w.world as WorldTip | null) ?? null);
      setRevisions((r.revisions ?? []) as RevisionRow[]);
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('world.error.load'));
    } finally {
      const sample = perfRef.current?.end('world_render');
      if (sample && sample.status !== 'ok') {
        // 仅在超预算时打点，避免污染正常流量
        console.warn('[og-course] perf budget exceeded', sample);
      }
      setLoading(false);
    }
  }, [projectId, t]);

  const openRevisionDiff = useCallback(
    async (revision: number) => {
      if (!projectId) return;
      setDiffOpen(true);
      setDiffLoading(true);
      setDiffPayload(null);
      try {
        const data = await api.world.revisionDiff(projectId, revision);
        setDiffPayload(data as RevisionDiffPayload);
      } catch (e) {
        message.error(e instanceof Error ? e.message : t('world.error.load'));
        setDiffOpen(false);
      } finally {
        setDiffLoading(false);
      }
    },
    [projectId, t],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (refreshToken > 0) {
      void refresh();
    }
  }, [refreshToken, refresh]);

  useEffect(() => {
    if (researchFocusToken > 0) {
      researchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [researchFocusToken]);

  // Sync spatial probe Select from Spec tip (SSOT), not a sticky local default
  useEffect(() => {
    const fromSpec =
      world?.spec.presentation?.spatialBackend ?? world?.l3?.backend ?? null;
    if (fromSpec) setSpatialBackend(fromSpec);
    else if (world) setSpatialBackend('null');
  }, [
    world?.id,
    world?.tipRevision,
    world?.spec.presentation?.spatialBackend,
    world?.l3?.backend,
  ]);

  // LingBot is an opt-in L3 layer. Probe only when this world actually declares
  // it, or when the operator focuses the Research Lab — otherwise every project
  // open paid a doomed round-trip to a sidecar nobody started.
  const worldWantsLingbot =
    (world?.spec.presentation?.spatialBackend ?? world?.l3?.backend) === 'lingbot';

  useEffect(() => {
    if (!projectId) return;
    if (!worldWantsLingbot && researchFocusToken === 0) return;
    void api.world
      .lingbotHealth(projectId)
      .then((h) => applyLingbotHealth(h))
      .catch(() => setLingbotHealth({ ok: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, worldWantsLingbot, researchFocusToken]);

  const checklistStep = useMemo(() => {
    if (!world) return 0;
    if ((world.gameplay?.quests ?? 0) > 0) return 2;
    return 1;
  }, [world]);

  const runSim = async () => {
    if (!projectId) return;
    try {
      await api.world.simulate(projectId, { ticks: 1, hoursPerTick: 1 });
      message.success(t('world.toast.sim'));
      await refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('world.error.sim'));
    }
  };

  const runTrain = async () => {
    if (!projectId) return;
    try {
      const res = await api.world.train(projectId, {
        sync: true,
        episodes: 12,
        epochs: 20,
      });
      setLastTrainResult({
        finalLoss: res.finalLoss,
        steps: res.steps,
      });
      message.success(
        t('world.toast.train', {
          loss: res.finalLoss?.toFixed(5) ?? '?',
          steps: String(res.steps ?? '?'),
        }),
      );
      await refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('world.error.train'));
    }
  };

  const runImagine = async () => {
    if (!projectId) return;
    try {
      const res = await api.world.imagine(projectId);
      setLastImagineResult({
        preferred: res.preferred ?? undefined,
        surprise: res.ranked[0]?.surprise,
      });
      const src = res.weightsSource ?? 'hot_train';
      message.info(
        `${t('world.toast.imagine', {
          action: res.preferred ?? 'n/a',
          surprise: res.ranked[0]?.surprise.toFixed(3) ?? '?',
        })} · weights=${src}`,
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('world.error.imagine'));
    }
  };

  const probeSpatial = async () => {
    if (!projectId) return;
    try {
      const res = await api.world.spatialProbe(projectId, spatialBackend);
      setSpatialPreview({
        message: res.result?.message ?? res.label,
        videoUrl: res.result?.videoUrl,
        frameUrl: res.result?.assetUrl?.startsWith('data:image')
          ? res.result.assetUrl
          : undefined,
        licenseNote: res.licenseNote ?? res.result?.licenseNote,
      });
      message.info(res.result?.message ?? res.label);
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('world.error.spatial'));
    }
  };

  const persistSpatialBackend = async (next: string) => {
    if (next === 'marble') {
      message.warning(
        'Marble backend is a stub (no API) — use lingbot or null (2D).',
      );
      return;
    }
    setSpatialBackend(next);
    if (!projectId || !world) return;
    try {
      const res = await api.world.patchPresentation(projectId, {
        spatialBackend: next === 'null' ? null : next,
        cinematicEnabled: next === 'lingbot' ? true : undefined,
      });
      message.success(
        t('world.toast.presentation', {
          backend: next,
          rev: String(res.tipRevision),
        }),
      );
      await refresh();
      onPreviewRemount?.();
    } catch (e) {
      message.error(
        e instanceof Error ? e.message : t('world.error.presentation'),
      );
    }
  };

  const runAgentic = async () => {
    if (!projectId) return;
    try {
      const res = await api.world.agentic(projectId, {
        intent: 'director expand mystery forest; pilot NPCs react',
        persist: true,
      });
      message.success(
        t('world.toast.agentic', {
          count: String(res.applied.length),
          roles: res.proposals.map((p) => p.role).join('+'),
        }),
      );
      if (res.rebuildJobId) {
        message.info(t('world.toast.rebuildQueued'));
      }
      await refresh();
      onPreviewRemount?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('world.error.agentic'));
    }
  };

  const applyLingbotHealth = (health: Awaited<ReturnType<typeof api.world.lingbotHealth>>) => {
    const warnings = [...(health.warnings ?? [])];
    if (health.ok && !health.readyReal) {
      if (!health.repo) warnings.push('Missing LINGBOT_REPO_DIR');
      if (!health.ckpt) warnings.push('Missing LINGBOT_CKPT_DIR');
    }
    if (health.weightsReady && health.mode !== 'real') {
      warnings.push(
        `Weights ready (${health.weights?.shardComplete ?? '?'}/${health.weights?.shardExpected ?? 8}) — set LINGBOT_MODE=real to enable real clips`,
      );
    }
    setLingbotHealth({
      ok: health.ok,
      mode: health.mode,
      acceptNc: health.acceptNc,
      profile: health.profile,
      readyReal: health.readyReal,
      weightsReady: health.weightsReady,
      shardComplete: health.weights?.shardComplete,
      shardExpected: health.weights?.shardExpected,
      gpuName: health.gpu?.name,
      vramMb: health.gpu?.vramTotalMb,
      warnings,
      recommendedFrameNum: health.recommended?.frameNum,
      ckpt: health.ckpt,
      repo: health.repo,
    });
    if (health.recommended?.frameNum) {
      setClipFrameNum(health.recommended.frameNum);
    }
  };

  const openLingbotSession = async () => {
    if (!projectId) return;
    try {
      const health = await api.world.lingbotHealth(projectId);
      applyLingbotHealth(health);
      if (!health.ok) {
        message.warning(t('world.lingbot.sidecarDown'));
        return;
      }
      if (lingbotSessionId) {
        try {
          await api.world.lingbotCloseSession(projectId, lingbotSessionId);
        } catch {
          // ignore stale session close
        }
        setLingbotSessionId(null);
      }
      const res = await api.world.lingbotSession(projectId);
      setLingbotSessionId(res.session.sessionId);
      setSpatialPreview({
        message: `Session ${res.session.sessionId.slice(0, 8)}… · ${res.session.mode}`,
        frameUrl: res.session.frameUrl,
        licenseNote: 'CC BY-NC-SA 4.0',
        presentationMock: true,
      });
      message.info(t('world.lingbot.frameMock'), 6);
      message.success(t('world.lingbot.sessionOk'));
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('world.error.lingbot'));
    }
  };

  const checkLingbotHealth = async () => {
    if (!projectId) return;
    try {
      const health = await api.world.lingbotHealth(projectId);
      applyLingbotHealth(health);
      message.info(
        health.ok
          ? t('world.lingbot.healthOk', {
              mode: health.mode ?? 'mock',
              gpu: health.gpu?.name ?? 'n/a',
            })
          : t('world.lingbot.sidecarDown'),
      );
    } catch (e) {
      setLingbotHealth({ ok: false });
      message.error(e instanceof Error ? e.message : t('world.error.lingbot'));
    }
  };

  const generateLingbotClip = async () => {
    if (!projectId) return;
    setClipBusy(true);
    message.loading({
      content: t('world.lingbot.clipBusy'),
      key: 'lingbot-clip',
      duration: 0,
    });
    try {
      const res = await api.world.lingbotClip(projectId, {
        sessionId: lingbotSessionId ?? undefined,
        persist: true,
        frameNum: clipFrameNum,
      });
      message.destroy('lingbot-clip');
      if (!res.ok && res.error) {
        message.error(res.error);
        return;
      }
      const videoUrl =
        res.previewUrl ??
        (res.videoUrl?.startsWith('file:') ? res.httpUrl : res.videoUrl ?? res.httpUrl);
      setSpatialPreview({
        message: res.message ?? t('world.lingbot.clipOk'),
        videoUrl,
        licenseNote: res.license,
        fallbackFromReal: Boolean(res.fallbackFromReal),
      });
      if (res.fallbackFromReal) {
        message.warning(t('world.lingbot.clipFallback'), 8);
      } else if (!res.ok) {
        message.error(res.message ?? t('world.error.clip'));
      } else {
        message.success(t('world.lingbot.clipOkSpec'));
      }
      await refresh();
      // Clip persist rewrites deployment world.json — remount iframe to pick up L3
      onPreviewRemount?.();
    } catch (e) {
      message.destroy('lingbot-clip');
      message.error(e instanceof Error ? e.message : t('world.error.clip'));
    } finally {
      setClipBusy(false);
    }
  };

  const closeLingbotSession = async () => {
    if (!projectId || !lingbotSessionId) return;
    try {
      await api.world.lingbotCloseSession(projectId, lingbotSessionId);
      setLingbotSessionId(null);
      message.success(t('world.lingbot.sessionClosed'));
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('world.error.lingbot'));
    }
  };

  const runLingbotSmoke = async () => {
    if (!projectId) return;
    try {
      const res = await api.world.lingbotSmoke(projectId);
      if (res.error) {
        message.error(res.error);
        return;
      }
      setSpatialPreview({
        message: res.message ?? t('world.lingbot.smokeOk'),
        videoUrl: res.videoUrl ?? res.httpUrl,
        licenseNote: 'CC BY-NC-SA 4.0',
      });
      message.success(t('world.lingbot.smokeOk'));
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('world.lingbot.sidecarDown'));
    }
  };

  const stepLingbot = async (action: string) => {
    if (!projectId || !lingbotSessionId) return;
    try {
      const res = await api.world.lingbotStep(projectId, {
        sessionId: lingbotSessionId,
        action,
      });
      setSpatialPreview((prev) => ({
        message: prev?.message ?? 'step',
        frameUrl: res.frameUrl ?? res.session?.frameUrl,
        licenseNote: prev?.licenseNote,
        presentationMock: true,
        fallbackFromReal: prev?.fallbackFromReal,
      }));
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('world.error.step'));
    }
  };

  const requestWorldEdit = (prompt: string) => {
    if (!onRequestWorldEdit) return;
    Modal.confirm({
      title: t('world.action.editConfirmTitle'),
      content: t('world.action.editConfirmDesc'),
      okText: t('world.action.editConfirmOk'),
      cancelText: t('world.action.editConfirmCancel'),
      onOk: () => onRequestWorldEdit(prompt),
    });
  };

  const applyTemplate = (tpl: WorldTemplate) => {
    const prefs = readWorldCreatePrefs();
    if (tpl.mode === 'world_edit') {
      requestWorldEdit(promptForWorldTemplate(tpl.id));
      return;
    }
    const next = applyWorldTemplateToPrefs(prefs, tpl.id);
    storeWorldCreatePrefs(next);
    onRequestWorldGenerate?.(composeWorldTemplatePrompt(next, tpl.id));
  };

  const cardBg = isDark ? '#141418' : '#f8fafc';
  const cardBorder = isDark ? '#27272a' : '#e2e8f0';

  if (!projectId) {
    return <Empty description={t('world.empty.noProject')} />;
  }

  return (
    <Spin spinning={loading}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Alert
          type="info"
          showIcon
          icon={<ThunderboltOutlined />}
          title={t('world.banner.title')}
          description={t('world.banner.desc')}
          style={{ borderRadius: 10 }}
        />

        <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
          <Steps
            size="small"
            current={checklistStep}
            items={[
              { title: t('world.steps.create'), content: t('world.steps.createHint') },
              { title: t('world.steps.play'), content: t('world.steps.playHint') },
              { title: t('world.steps.iterate'), content: t('world.steps.iterateHint') },
            ]}
          />
        </Card>

        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
            {t('world.action.refresh')}
          </Button>
          <Button
            type="primary"
            icon={<GlobalOutlined />}
            onClick={() => {
              if (world) {
                Modal.confirm({
                  title: t('world.action.generateConfirmTitle'),
                  content: t('world.action.generateConfirmDesc'),
                  okText: t('world.action.generateConfirmOk'),
                  cancelText: t('world.action.generateConfirmCancel'),
                  onOk: () =>
                    onRequestWorldGenerate?.(
                      readLastWorldGeneratePrompt(projectId) ?? undefined,
                    ),
                });
              } else {
                onRequestWorldGenerate?.();
              }
            }}
          >
            {world
              ? t('world.action.regenerate')
              : t('world.action.generate')}
          </Button>
          <Button
            icon={<EditOutlined />}
            disabled={!world}
            onClick={() => requestWorldEdit(t('world.edit.examplePrompt'))}
          >
            {t('world.action.editIncremental')}
          </Button>
          <Button
            icon={<ExperimentOutlined />}
            onClick={() => void runSim()}
            disabled={!world}
          >
            {t('world.action.sim')}
          </Button>
          <Button disabled={!world} onClick={() => void runTrain()}>
            {t('world.action.train')}
          </Button>
          <Button
            disabled={!world}
            type={lastTrainResult ? 'primary' : 'default'}
            onClick={() => void runImagine()}
          >
            {t('world.action.imagine')}
          </Button>
          <Button disabled={!world} onClick={() => void runAgentic()}>
            {t('world.action.agentic')}
          </Button>
        </Space>
        {world ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 0 }}
            title={t('world.edit.vsRegenTitle')}
            description={t('world.edit.vsRegenDesc')}
          />
        ) : null}
        {(lastTrainResult || lastImagineResult) && (
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            {lastTrainResult
              ? t('world.dynamics.trainStatus', {
                  loss: lastTrainResult.finalLoss?.toFixed(5) ?? '?',
                  steps: String(lastTrainResult.steps ?? '?'),
                })
              : null}
            {lastTrainResult && lastImagineResult ? ' · ' : null}
            {lastImagineResult
              ? t('world.dynamics.imagineStatus', {
                  action: lastImagineResult.preferred ?? 'n/a',
                  surprise:
                    lastImagineResult.surprise?.toFixed(3) ?? '?',
                })
              : null}
          </Paragraph>
        )}


        {!world ? (
          <>
            <Title level={5} style={{ margin: 0 }}>
              {t('world.quickStart.title')}
            </Title>
            <Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 8 }}>
              {t('world.quickStart.desc')}
            </Paragraph>
            <Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 8, fontSize: 12 }}>
              {(() => {
                const prefs = readWorldCreatePrefs();
                return t('world.create.summary', {
                  note: prefs.note.trim()
                    ? prefs.note.trim().slice(0, 28)
                    : t('world.create.noteEmpty'),
                  art: t(`intake.art.${prefs.artStyleId}`),
                  scale: t(`world.create.scale.${prefs.scale}`),
                  livedIn: t(`world.create.livedIn.${prefs.livedIn}`),
                  pack: t(`world.create.pack.${prefs.packId}`),
                  useCase: t(`world.create.useCase.${prefs.useCase}`),
                  venues: prefs.venues
                    .map((v) => t(`world.create.venue.${v}`))
                    .join(t('world.create.venueJoin')),
                });
              })()}
            </Paragraph>
            <Row gutter={[12, 12]}>
              {firstClickWorldTemplates().map((tpl) => (
                <Col xs={24} sm={12} key={tpl.id}>
                  <Card
                    hoverable
                    size="small"
                    onClick={() => applyTemplate(tpl)}
                    style={{
                      background: cardBg,
                      border: `1px solid ${
                        tpl.recommended ? 'var(--color-ember)' : cardBorder
                      }`,
                      borderRadius: 12,
                      height: '100%',
                    }}
                  >
                    <Space align="start">
                      <span style={{ fontSize: 28 }}>{tpl.emoji}</span>
                      <div>
                        <Space size={6}>
                          <Text strong>{t(tpl.titleKey)}</Text>
                          {tpl.recommended ? (
                            <Tag color="processing">{t('world.quickStart.recommended')}</Tag>
                          ) : null}
                          {tpl.id === 'lingbot_cinematic' ? (
                            <Tag color="purple">{t('world.research.badge')}</Tag>
                          ) : null}
                          {tpl.id === 'agentic_expand' ? (
                            <Tag color="cyan">{t('world.template.agentic.badge')}</Tag>
                          ) : null}
                        </Space>
                        <Paragraph
                          type="secondary"
                          style={{ marginBottom: 0, fontSize: 12, marginTop: 4 }}
                        >
                          {t(tpl.descKey)}
                        </Paragraph>
                      </div>
                    </Space>
                  </Card>
                </Col>
              ))}
            </Row>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('world.empty.noSpec')}
              style={{ marginTop: 8 }}
            >
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={() =>
                  applyTemplate(WORLD_TEMPLATES.find((x) => x.recommended)!)
                }
              >
                {t('world.quickStart.oneClick')}
              </Button>
            </Empty>

            {featureFlags.researchLab ? (
            <LingBotResearchLab
              ref={researchRef}
              health={lingbotHealth}
              sessionId={lingbotSessionId}
              spatialBackend={spatialBackend}
              clipFrameNum={clipFrameNum}
              clipBusy={clipBusy}
              preview={spatialPreview}
              hasWorld={false}
              onHealth={() => void checkLingbotHealth()}
              onSmoke={() => void runLingbotSmoke()}
              onBackendChange={(v) => void persistSpatialBackend(v)}
              onFrameChange={setClipFrameNum}
              onProbe={() => void probeSpatial()}
              onOpenSession={() => void openLingbotSession()}
              onCloseSession={() => void closeLingbotSession()}
              onClip={() => void generateLingbotClip()}
              onStep={(a) => void stepLingbot(a)}
              onStartWorld={() =>
                applyTemplate(
                  WORLD_TEMPLATES.find((x) => x.id === 'lingbot_cinematic') ??
                    WORLD_TEMPLATES.find((x) => x.recommended)!,
                )
              }
            />
            ) : null}
          </>
        ) : (
          <>
            <Card
              size="small"
              title={
                <Space>
                  <CheckCircleOutlined style={{ color: '#22c55e' }} />
                  {world.title}
                  <Tag>r{world.tipRevision}</Tag>
                </Space>
              }
            >
              <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                t={Math.floor(world.spec.timeHours ?? 0)}h
                {world.l3?.backend || world.spec.presentation?.spatialBackend
                  ? ` · L3=${world.l3?.backend ?? world.spec.presentation?.spatialBackend}`
                  : ''}
                {world.l3?.lingbotMode || world.spec.presentation?.lingbotMode
                  ? ` · mode=${world.l3?.lingbotMode ?? world.spec.presentation?.lingbotMode}`
                  : ''}
                {(world.l3?.clipCount ?? 0) > 0
                  ? ` · clips=${world.l3!.clipCount}`
                  : ''}
                {world.spec.presentation?.plannerSource
                  ? ` · planner=${world.spec.presentation.plannerSource}`
                  : ''}
              </Paragraph>
              {(world.l2 &&
                (world.l2.opsApplied > 0 ||
                  (world.l2 as { ran?: boolean }).ran)) ||
              world.spec.presentation?.agenticDiff ? (
                <Space wrap style={{ marginBottom: 8 }}>
                  <Tag color="cyan">
                    {t('world.ready.expansion')}
                    {(world.l2?.opsApplied ??
                      world.spec.presentation?.agenticDiff?.opsApplied ??
                      0) > 0
                      ? ` +${
                          world.l2?.regionsDelta ??
                          (world.spec.presentation?.agenticDiff
                            ? world.spec.presentation.agenticDiff.afterRegions -
                              world.spec.presentation.agenticDiff.beforeRegions
                            : 0)
                        }r +${
                          world.l2?.questsDelta ??
                          (world.spec.presentation?.agenticDiff
                            ? world.spec.presentation.agenticDiff.afterQuests -
                              world.spec.presentation.agenticDiff.beforeQuests
                            : 0)
                        }q · ${
                          world.l2?.opsApplied ??
                          world.spec.presentation?.agenticDiff?.opsApplied ??
                          0
                        } ops`
                      : ' · agentic'}
                  </Tag>
                  {world.l2?.narrativeSeed ? (
                    <Tag>seed={world.l2.narrativeSeed.slice(0, 12)}</Tag>
                  ) : null}
                </Space>
              ) : null}
              <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                {world.summary}
              </Paragraph>
              {featureFlags.courseUxV2 ? (
                <WorldNarrativeCard
                  projectId={projectId}
                  summary={world.metaSummary ?? world.summary ?? null}
                  openingRumor={world.openingRumor ?? null}
                  tipRevision={world.tipRevision}
                  onRefreshed={(next) => {
                    setWorld((prev) =>
                      prev
                        ? {
                            ...prev,
                            tipRevision: next.tipRevision,
                            metaSummary: next.summary ?? prev.metaSummary ?? null,
                            openingRumor: next.openingRumor ?? prev.openingRumor ?? null,
                          }
                        : prev,
                    );
                  }}
                />
              ) : null}
              {world.gameplay ? (
                <Paragraph style={{ fontSize: 12, marginBottom: 8 }}>
                  <Text strong>{t('world.gameplay.label')}：</Text>
                  {world.gameplay.regions} {t('world.gameplay.regions')} ·{' '}
                  {world.gameplay.npcs} NPC · {world.gameplay.enemies}{' '}
                  {t('world.gameplay.enemies')} · {world.gameplay.items}{' '}
                  {t('world.gameplay.items')} · {world.gameplay.quests}{' '}
                  {t('world.gameplay.quests')}
                  {world.gameplay.hasCombat ? ` · ${t('world.gameplay.combat')}` : ''}
                  {world.gameplay.hasInventoryLoop
                    ? ` · ${t('world.gameplay.inventory')}`
                    : ''}
                  <br />
                  <Text type="secondary">
                    {t('world.gameplay.win')}：{world.gameplay.winCondition}
                  </Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {t('world.gameplay.controls')}：
                    {world.gameplay.controls?.join(' · ')}
                  </Text>
                </Paragraph>
              ) : null}
              <Alert
                type="info"
                showIcon
                title={t('product.world.panelHint')}
                style={{ marginBottom: 0 }}
              />
            </Card>

            {featureFlags.researchLab &&
            !(
              world.spec.presentation?.narrativeSeed ===
                'society-gathering-observe' &&
              !world.spec.presentation?.cinematicEnabled
            ) ? (
            <LingBotResearchLab
              ref={researchRef}
              health={lingbotHealth}
              sessionId={lingbotSessionId}
              spatialBackend={spatialBackend}
              clipFrameNum={clipFrameNum}
              clipBusy={clipBusy}
              preview={spatialPreview}
              hasWorld
              onHealth={() => void checkLingbotHealth()}
              onSmoke={() => void runLingbotSmoke()}
              onBackendChange={(v) => void persistSpatialBackend(v)}
              onFrameChange={setClipFrameNum}
              onProbe={() => void probeSpatial()}
              onOpenSession={() => void openLingbotSession()}
              onCloseSession={() => void closeLingbotSession()}
              onClip={() => void generateLingbotClip()}
              onStep={(a) => void stepLingbot(a)}
            />
            ) : null}

            <Collapse
              size="small"
              defaultActiveKey={[]}
              items={[
                {
                  key: 'entities',
                  label: t('world.collapse.entities'),
                  children: (
                    <List
                      size="small"
                      dataSource={world.spec.entities ?? []}
                      renderItem={(e) => (
                        <List.Item>
                          <Tag>{e.kind}</Tag> {e.name}{' '}
                          <Text type="secondary">@{e.regionId}</Text>
                        </List.Item>
                      )}
                    />
                  ),
                },
                {
                  key: 'quests',
                  label: t('world.collapse.quests'),
                  children: (
                    <List
                      size="small"
                      dataSource={world.spec.narrative?.quests ?? []}
                      renderItem={(q) => (
                        <List.Item>
                          <Tag
                            color={
                              q.status === 'completed'
                                ? 'success'
                                : q.status === 'active'
                                  ? 'processing'
                                  : 'default'
                            }
                          >
                            {q.status}
                          </Tag>
                          {q.title}
                        </List.Item>
                      )}
                    />
                  ),
                },
                {
                  key: 'revisions',
                  label: t('world.collapse.revisions'),
                  children: (
                    <List
                      size="small"
                      dataSource={revisions}
                      renderItem={(r) => (
                        <List.Item
                          actions={[
                            r.revision !== world?.tipRevision ? (
                              <Button
                                key="diff"
                                type="link"
                                size="small"
                                icon={<DiffOutlined />}
                                onClick={() => void openRevisionDiff(r.revision)}
                              >
                                {t('world.revision.diff')}
                              </Button>
                            ) : null,
                            r.revision !== world?.tipRevision ? (
                              <Button
                                key="restore"
                                type="link"
                                size="small"
                                onClick={() => {
                                  Modal.confirm({
                                    title: t('world.action.restoreConfirmTitle'),
                                    content: t('world.action.restoreConfirmDesc', {
                                      rev: String(r.revision),
                                    }),
                                    onOk: async () => {
                                      if (!projectId) return;
                                      try {
                                        await api.world.restoreRevision(
                                          projectId,
                                          r.revision,
                                        );
                                        message.success(
                                          t('world.toast.restoreQueued', {
                                            rev: String(r.revision),
                                          }),
                                        );
                                        await refresh();
                                        onPreviewRemount?.();
                                      } catch (e) {
                                        message.error(
                                          e instanceof Error
                                            ? e.message
                                            : t('world.error.restore'),
                                        );
                                      }
                                    },
                                  });
                                }}
                              >
                                {t('world.action.restoreRevision')}
                              </Button>
                            ) : (
                              <Tag key="tip">tip</Tag>
                            ),
                          ].filter(Boolean)}
                        >
                          <div>
                            <div>
                              r{r.revision}
                              {r.parentRevision != null
                                ? ` ← r${r.parentRevision}`
                                : ''}{' '}
                              — {r.summary}
                            </div>
                            {Array.isArray(r.op?.diffSummary?.summaryLines) &&
                            r.op!.diffSummary!.summaryLines!.length > 0 ? (
                              <div style={{ marginTop: 4 }}>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  {t('world.revision.diffSummary')}:{' '}
                                  {r.op!.diffSummary!.summaryLines!.slice(0, 4).join(' · ')}
                                </Text>
                              </div>
                            ) : null}
                            {Array.isArray(r.op?.dirtyRegions) &&
                            r.op!.dirtyRegions!.length > 0 ? (
                              <div style={{ marginTop: 4 }}>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  {t('world.revision.dirtyPosters', {
                                    regions: r.op!.dirtyRegions!.slice(0, 6).join(', '),
                                  })}
                                </Text>
                                <div style={{ marginTop: 2 }}>
                                  {r.op!.dirtyRegions!.slice(0, 6).map((id) => (
                                    <Tag key={id} style={{ fontSize: 10 }}>
                                      {id}
                                    </Tag>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </List.Item>
                      )}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
      </Space>
      <Modal
        open={diffOpen}
        onCancel={() => setDiffOpen(false)}
        footer={null}
        width={720}
        title={
          diffPayload
            ? t('world.revision.diffTitle', {
                from: String(diffPayload.fromRevision),
                to: String(diffPayload.toRevision),
              })
            : t('world.revision.diff')
        }
      >
        <Spin spinning={diffLoading}>
          {diffPayload ? (
            <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                {(diffPayload.diff.summaryLines ?? []).map((line) => (
                  <Tag key={line} style={{ marginBottom: 4 }}>
                    {line}
                  </Tag>
                ))}
              </div>
              {diffPayload.diff.addedRegions?.length ? (
                <Text>
                  +regions: {diffPayload.diff.addedRegions.join(', ')}
                </Text>
              ) : null}
              {diffPayload.diff.removedRegions?.length ? (
                <Text>
                  -regions: {diffPayload.diff.removedRegions.join(', ')}
                </Text>
              ) : null}
              {diffPayload.diff.addedQuests?.length ? (
                <Text>+quests: {diffPayload.diff.addedQuests.join(', ')}</Text>
              ) : null}
              {diffPayload.diff.removedQuests?.length ? (
                <Text>
                  -quests: {diffPayload.diff.removedQuests.join(', ')}
                </Text>
              ) : null}
              {diffPayload.diff.addedEntities?.length ? (
                <Text>
                  +entities: {diffPayload.diff.addedEntities.join(', ')}
                </Text>
              ) : null}
              {diffPayload.diff.removedEntities?.length ? (
                <Text>
                  -entities: {diffPayload.diff.removedEntities.join(', ')}
                </Text>
              ) : null}
              {diffPayload.diff.addedRules?.length ? (
                <Text>+rules: {diffPayload.diff.addedRules.join(', ')}</Text>
              ) : null}
              {diffPayload.diff.removedRules?.length ? (
                <Text>
                  -rules: {diffPayload.diff.removedRules.join(', ')}
                </Text>
              ) : null}
              <Row gutter={12}>
                <Col span={12}>
                  <Paragraph
                    style={{
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                      maxHeight: 220,
                      overflow: 'auto',
                      background: isDark ? '#18181b' : '#f8fafc',
                      padding: 8,
                      borderRadius: 8,
                    }}
                  >
                    {diffPayload.fromSummary}
                  </Paragraph>
                </Col>
                <Col span={12}>
                  <Paragraph
                    style={{
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                      maxHeight: 220,
                      overflow: 'auto',
                      background: isDark ? '#18181b' : '#f8fafc',
                      padding: 8,
                      borderRadius: 8,
                    }}
                  >
                    {diffPayload.toSummary}
                  </Paragraph>
                </Col>
              </Row>
            </Space>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Spin>
      </Modal>
      <CourseDebugPanel />
    </Spin>
  );
};
