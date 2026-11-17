/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified Stanford-town stage: observe iframe (map + agents) + side inspector.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  Input,
  InputNumber,
  Select,
  Slider,
  Space,
  Statistic,
  Segmented,
  Spin,
  Tag,
  Tree,
  Typography,
} from 'antd';
import {
  CameraOutlined,
  LoadingOutlined,
  PushpinOutlined,
  SoundOutlined,
  ThunderboltOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { api, ApiError, type WorkCommerce } from '../../services/api';
import { DeepMindPanel } from './DeepMindPanel';
import {
  SocietyOpinionBoard,
  type OpinionBoardView,
} from './SocietyOpinionBoard';
import { useAppStore } from '../../store';
import { useT } from '../../services/i18n';
import { useTheme } from '../../hooks/useTheme';
import { isObservatoryLocked, societyDeskGates } from './observatoryLock';
import {
  leaseRemainingMs,
  permitRemainParts,
  quietTownSkipReason,
  guestMuteOverlayKey,
  readTalkBudget,
  shouldAutoloadTownMap,
  shouldClearBudgetMute,
  talkBudgetTone,
  urgeWorldLight,
  worldLightUntilLine,
  authorTownPulses,
  shouldAutostartPlayback,
  livePausedHintKey,
  showAuthorServerClock,
  showTownInspector,
  shouldBootstrapInspectorNow,
  shouldHydrateIframeReplay,
  shouldFollowSharedCursor,
  shouldHydrateWithFullReplay,
  shouldKeepSocietyStream,
  shouldPushSocietySnapshotToIframe,
  mergeSocietyReloadOpts,
  societyReloadCursor,
  societyTownCapabilities,
  isTownStageAliveMessage,
  talkLogNodKey,
  townTalkQuietOverlay,
  type SocietyReloadOpts,
} from './societyTownGating';
import { SocietyObservatoryStats } from './SocietyObservatoryStats';
import { SocietyTownGuestDesk } from './SocietyTownGuestDesk';
import { scrollToCourseDesk } from './societyTownTimeDesk';
import { featureFlags } from '../../utils/featureFlags';
import { SocietyTownLampStrip } from './SocietyTownLampStrip';
import { societyWatchTabId } from './societyWatchTab';
import {
  scrollToWorldLightDesk,
  townLampTitleKey,
} from './societyTownTimeDesk';
import { SocietyTownLightDesk } from './SocietyTownLightDesk';
import { courseDeskClockLine, courseKeepAliveNeeded, coursePhaseCopyKey } from './SocietyTownCourseDesk';
import { mergeCourseBoardPoll } from './courseBoardMerge';
import {
  PAGE_IDLE_COURSE_POLL_MS,
  STAGE_EMBEDDED_COURSE_POLL_MS,
  stageOwnsCoursePoll,
} from './coursePullCoalesce';
import { SocietyTownCourseAuthorModal } from './SocietyTownCourseAuthorModal';
import { SocietyTownAuthorOpsBar } from './SocietyTownAuthorOpsBar';
import { courseAuthorRecommendHintKey, genreProfileFromWorldSpec } from './courseAuthorFlow';
import { guestCourseChromeKey } from './courseAuthorFlow';
import { courseEvidenceHudState } from './courseEvidence';
import { SocietyTownCourseClockHud } from './SocietyTownCourseClockHud';
import type { CourseBoard, TownContributor, TownLamp } from '../../services/api';
import { SocietyRosterPanel } from './SocietyRosterPanel';
import {
  currentPlanPlace,
  paidTraceLabelKey,
  placeLabel,
  regionLabel,
  whyLine,
  driveLabelOf,
} from './societyTownLabels';
import {
  gatheringSeedText,
  worldCopyAscii,
  anonymousLeadName,
  hubPlaceName,
  societySeedUsedFallback,
  type WorldLike,
} from '@opengame/world-spec';
import {
  previewIframeAllow,
  previewIframeSandbox,
} from '../../utils/previewIframeSandbox';
import {
  previewSiblingAssetUrl,
  withPreviewBustParam,
} from '../../utils/previewUrlStability';
import {
  PREVIEW_BROKEN_MSG,
  asPreviewReason,
  previewRetryAction,
  previewRetryKind,
  previewRetryLabelKey,
  previewStageFace,
  previewStageIsDead,
} from '../../utils/previewBundleHealth';
import { usePreviewBundleProbe } from '../../hooks/usePreviewBundleProbe';
import { PreviewDiagnosticsStrip } from '../Preview/PreviewDiagnosticsStrip';
import { SocietyTownMapFace } from './SocietyTownMapFace';
import { SocietyTownObserveAlerts } from './SocietyTownObserveAlerts';
import { AdoptedResidents } from '../Community/AdoptedResidents';
import {
  PRESENCE_HIDDEN_GRACE_MS,
  leaseActive,
  placesFromWorldSpec,
  presenceWhilePageVisible,
  worldCoursePrefersNightMarket,
} from '@opengame/platform-shared';
import { SocietyRelationGraph } from './SocietyRelationGraph';
import {
  commitmentChips,
  displayMemoryText,
  isBeliefMemory,
  isBookkeepingMemory,
  isOwnedPlaceName,
  isPaidTraceMemory,
  isWitnessMemory,
  overlayTalkText,
  paidTraceKind,
  talkColon,
  talkGroupTitle,
  talkTurnMark,
  compareTalkLines,
  compareSocietyEvtOrder,
  orderTalkGroups,
  visibleTalkGroups,
  talkingWithOf,
  townWideSpeakerLabel,
  clockHonestyKey,
} from './societyInspectorCopy';
import { coalesceSocietyFrames, mergeSocietyFrameReport } from './societyFrames';
import {
  guestTownHonestyKey,
  type TownLiveChrome,
} from './societyTownHonesty';
import {
  clipNeeds,
  compactReportPayload,
  formatTownClock,
  generatingRumorLine,
  isMapEventKind,
  mergeTalkLog,
  objectLooksBroken,
  ownedPlacesOf,
  pinMapEvents,
  pinTalkEvents,
  pointerSnippets,
  reflectionTreeNodes,
  talkLinesFromEvent,
  townAgentFrom,
  visibleMemoriesOf,
  withObserveMode,
  type EmergenceReport,
  type RelationEdge,
  type SocietyEvt,
  type SocietyFrame,
  type TalkCopyOpts,
  type TalkLine,
  type TownAgent,
  type TownNeeds,
  type TownObject,
} from './societyTownStageModel';

const { Text, Paragraph } = Typography;

const MSG_REPLAY = 'opengame-society-replay';
const MSG_APPEND = 'opengame-society-append';
const MSG_SELECT = 'opengame-society-select-agent';
const MSG_READY = 'opengame-society-ready';
const MSG_CURSOR = 'opengame-society-cursor';
const MSG_LIVE_PAUSE = 'opengame-society-live-pause';
const MSG_SET_PLAYING = 'opengame-society-set-playing';
const MSG_FOCUS_REGION = 'opengame-society-focus-region';
const MSG_HOVER = 'opengame-society-hover';
const MSG_SCRUB = 'opengame-society-scrub';
const MSG_BGM = 'opengame-society-bgm';
const MSG_BGM_STATUS = 'opengame-society-bgm-status';
const MSG_PIN = 'opengame-society-pin-agent';
const MSG_SET_SPEED = 'opengame-society-set-speed';
const MSG_LOCK_LIVE = 'opengame-society-lock-live';
const LIVE_TICK_MS = 2500;
/**
 * How long a server frame keeps the browser from driving its own ticks. Must
 * exceed the worker's sweep interval, or the two would alternate.
 */
const SERVER_CLOCK_GRACE_MS = 12_000;

type PlanSegment = {
  startHour?: number;
  endHour?: number;
  activity?: string;
  locationId?: string;
  locationName?: string;
};

export type SocietyTownStageRole = 'author' | 'guest';

export interface SocietyTownStageProps {
  readonly role?: SocietyTownStageRole;
  /** Author studio / observatory. Required when role is author. */
  readonly projectId?: string;
  /** Published community work. Required when role is guest. */
  readonly gameId?: string;
  readonly previewUrl: string | null;
  readonly remountKey?: number;
  /** Host job still running — empty map is a wait state, not a broken stage. */
  readonly isGenerating?: boolean;
  /** Latest world job failed — refetching the lease cannot invent preview files. */
  readonly generateFailed?: boolean;
  readonly onRetryFailedJob?: () => void | Promise<void>;
  /** GET /world produced a spec — without this the inspector stays locked. */
  readonly hasWorld?: boolean;
  /** Re-sign the hosted preview after a process restart. */
  readonly onRefreshPreview?: () => void | Promise<void>;
  /** Stack map above the inspector (phone community play). */
  readonly compact?: boolean;
  /** Open the map without a second click (observatory / community). */
  readonly autoloadMap?: boolean;
  /** Portrait pass while the skeleton preview is already walkable. */
  readonly assetProgress?: { readonly done: number; readonly total: number } | null;
  /** Guest desk: tonight’s board + free whisper from the published work. */
  readonly guestDesk?: {
    readonly commerce?: WorkCommerce | null;
    readonly canSpend: boolean;
    readonly onRequireLogin: (line?: string) => void;
    readonly whisperDraft?: string;
    readonly whisperTick?: number;
    readonly onWhispered?: () => void;
    /** Sidebar / sheet tip stacked the same lamp. */
    readonly lightUntil?: string | null;
  };
  /**
   * `page` = community GameDetail hosts the board in the right column.
   * `stage` = inspector / compact play keeps the board here.
   */
  readonly courseHost?: 'stage' | 'page';
  /**
   * When `courseHost="page"`, the page desk owns `/course` polling — Stage
   * mirrors this snapshot for HUD / chrome / keepAlive and skips its interval.
   */
  readonly pageCourseBoard?: CourseBoard | null;
  /**
   * Page desk is mounted and polling (desktop column, or mobile sheet open).
   * When false on `courseHost="page"`, Stage keeps a slow HUD poll.
   */
  readonly courseDeskActive?: boolean;
  /** Header / mobile chrome: keep living, lamp, and pause in sync with this stage. */
  readonly onTownLiveChange?: (chrome: TownLiveChrome) => void;
  /** Mobile / page host: sync talks + board for the course drawer. */
  readonly onCourseContextChange?: (ctx: {
    readonly talks: readonly TalkLine[];
    readonly liveNudge: number;
  }) => void;
  /** Bump from parent to resume a paused town clock (author OpsBar). */
  readonly resumeClockNonce?: number;
}


export const SocietyTownStage: React.FC<SocietyTownStageProps> = ({
  role = 'author',
  projectId,
  gameId,
  previewUrl,
  remountKey = 0,
  isGenerating = false,
  generateFailed = false,
  hasWorld = false,
  onRefreshPreview,
  onRetryFailedJob,
  compact = false,
  autoloadMap = false,
  assetProgress = null,
  guestDesk,
  courseHost = 'stage',
  pageCourseBoard,
  courseDeskActive = false,
  onTownLiveChange,
  onCourseContextChange,
  resumeClockNonce = 0,
}) => {
  const isAuthor = role !== 'guest';
  const embedCourseOnStage = courseHost !== 'page';
  const showInspector = showTownInspector({ role, courseHost });
  const caps = societyTownCapabilities(role);
  const stageKey = projectId ?? gameId ?? 'town';
  const { t, locale } = useT();
  const { message } = App.useApp();
  const { isDark } = useTheme();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const parentBgmRef = useRef<HTMLAudioElement | null>(null);
  const parentBgmPlayingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [whisperLoading, setWhisperLoading] = useState(false);
  const [ffLoading, setFfLoading] = useState(false);
  const [hours, setHours] = useState(16);
  const [clock, setClock] = useState<{ kind?: string; shifts?: number }>();
  const [worldLike, setWorldLike] = useState<WorldLike>();
  const [allowsGathering, setAllowsGathering] = useState(true);
  const clockAscii = worldLike
    ? worldCopyAscii(worldLike)
    : locale === 'en';
  const packId = (
    worldLike?.presentation?.genreProfile as { id?: string } | undefined
  )?.id;
  const townLabel = townWideSpeakerLabel({ ascii: clockAscii, packId });
  const talkOpts: TalkCopyOpts = {
    nodText: t(talkLogNodKey({ isGenerating, skipReason: undefined })),
    townLabel,
    locale,
    skipText: (reason, retryQueued) =>
      reason === 'overloaded' || reason === 'timeout'
        ? t('product.obs.talkBusyLine')
        : t('product.obs.talkFailed', {
            reason: t(`product.obs.talkSkip.${reason}`),
            retry: retryQueued
              ? t('product.obs.talkRetryQueued')
              : t('product.obs.talkRetryGaveUp'),
          }),
  };
  const clockLabel = (sim: number): string =>
    formatTownClock(sim, clock, clockAscii);
  const [report, setReport] = useState<EmergenceReport | null>(null);
  const [agents, setAgents] = useState<TownAgent[]>([]);
  const [opinionLive, setOpinionLive] = useState<OpinionBoardView | null>(null);
  const [relations, setRelations] = useState<RelationEdge[]>([]);
  const [objects, setObjects] = useState<TownObject[]>([]);
  const [highlightedObjectId, setHighlightedObjectId] = useState<string | null>(
    null,
  );
  const [inspectorKeys, setInspectorKeys] = useState<string[]>(['talk']);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playbackSpeedRef = useRef(1);
  const [memoryFilter, setMemoryFilter] = useState<
    'all' | 'witness' | 'belief' | 'reflection' | 'paid'
  >('all');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [memories, setMemories] = useState<
    Array<{
      id?: string;
      kind: string;
      text: string;
      simTime: number;
      importance: number;
      pointers?: unknown;
    }>
  >([]);
  const [dayPlan, setDayPlan] = useState<{
    dayIndex: number;
    segments: PlanSegment[];
    reason?: string;
    replan?: boolean;
  } | null>(null);
  const [agentCard, setAgentCard] = useState<{
    name: string;
    regionId: string;
    areaName?: string;
    regionName?: string;
    currentAction: string;
    goalPlace?: string;
    identity?: string;
    stance?: string;
    secret?: string;
    needs?: TownNeeds;
    goalReason?: string;
    drive?: string;
  } | null>(null);
  const [whisper, setWhisper] = useState('');
  const [eventCount, setEventCount] = useState(0);
  const observatoryLocked = isObservatoryLocked({
    hasWorld,
    previewUrl,
    eventCount,
    agentCount: agents.length,
  });
  /** Playback cursor from Phaser (sim hours). Intervene from here — never wipe from 0. */
  const [cursor, setCursor] = useState(0);
  const [simMax, setSimMax] = useState(0);
  const cursorRef = useRef(0);
  const livePausedRef = useRef(true);
  const authorClockPausedRef = useRef(false);
  const clockHydratedRef = useRef(!isAuthor);
  const toggleTownClockRef = useRef<
    (paused: boolean, opts?: { resumeShared?: boolean }) => void
  >(() => undefined);
  const tickingRef = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const agentsRef = useRef(agents);
  const [livePaused, setLivePaused] = useState(true);
  const [userStoppedClock, setUserStoppedClock] = useState(false);
  const userStoppedClockRef = useRef(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [iframePrep, setIframePrep] = useState<'idle' | 'republish' | 'ready'>('idle');
  /** Hosted JS cannot parse — stage is black; do not keep buying MiniMax talks. */
  const generatingRef = useRef(isGenerating);
  generatingRef.current = isGenerating;
  const {
    bundleReady,
    previewBroken,
    previewProbe,
    previewSettling,
    leaseRefreshAttempts,
    markLeaseAttempt,
    markBroken,
    markLive,
    confirmedBroken,
  } = usePreviewBundleProbe({
    previewUrl,
    remountKey,
    isGenerating,
    stageKey,
  });
  const [phaserLive, setPhaserLive] = useState(false);
  const phaserReadyRef = useRef(false);
  const desk = societyDeskGates({
    locked: observatoryLocked,
    isGenerating,
    previewBroken: Boolean(previewBroken),
    hasPreview: Boolean(previewUrl),
    stageLive: iframeReady,
    phaserLive,
    confirmedByIframe: confirmedBroken,
    probeReason: previewBroken ? asPreviewReason(previewBroken) : undefined,
  });
  const observatoryDisabled = desk.walkDisabled;
  const talkDisabled = desk.talkDisabled;
  const inspectDisabled = desk.inspectDisabled;
  const rebuildDisabled = desk.rebuildDisabled;
  const stageDead = previewStageIsDead({
    probeBroken: Boolean(previewBroken),
    probeReason: previewBroken ? asPreviewReason(previewBroken) : undefined,
    iframeReady,
    phaserLive,
    confirmedByIframe: confirmedBroken,
  });
  const [llmLive, setLlmLive] = useState<boolean | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [skipReason, setSkipReason] = useState<
    | 'budget'
    | 'no_key'
    | 'generate'
    | 'unwatched'
    | 'no_permit'
    | 'keys_exhausted'
    | null
  >(null);
  const [townLiving, setTownLiving] = useState(false);
  const [townSpeaking, setTownSpeaking] = useState(false);
  const [authorClockPaused, setAuthorClockPaused] = useState(false);
  const [clockHydrated, setClockHydrated] = useState(!isAuthor);
  const [presenceAcked, setPresenceAcked] = useState(false);
  const [townTimeUntil, setTownTimeUntil] = useState<string | null>(null);
  const [townLamp, setTownLamp] = useState<TownLamp | null>(null);
  const [townContributors, setTownContributors] = useState<TownContributor[]>([]);
  const [watcherCount, setWatcherCount] = useState(0);
  const [lampFlash, setLampFlash] = useState<TownLamp | null>(null);
  const [lightFlash, setLightFlash] = useState<{
    name: string;
    bonus: number;
  } | null>(null);
  const [talkBudget, setTalkBudget] = useState<ReturnType<typeof readTalkBudget>>(
    null,
  );
  const [leaseNow, setLeaseNow] = useState(() => Date.now());
  const [retrievalDegraded, setRetrievalDegraded] = useState(false);
  const [dialogueKind, setDialogueKind] = useState<
    'model' | 'template' | 'none' | null
  >(null);
  const [talkLog, setTalkLog] = useState<TalkLine[]>([]);
  const [liveTalkSeq, setLiveTalkSeq] = useState<number | null>(null);
  const [liveCircleIndex, setLiveCircleIndex] = useState<number | null>(null);
  const [listeningTotal, setListeningTotal] = useState(0);
  const [interviewQ, setInterviewQ] = useState('');
  const [interviewA, setInterviewA] = useState<{
    answer: string;
    cited: string[];
    citedMemoryIds?: string[];
    source?: 'model' | 'memory';
  } | null>(null);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [hoverIntent, setHoverIntent] = useState<{
    name: string;
    action: string;
  } | null>(null);
  /** Line the stage is speaking right now; the stage clears it when it fades. */
  const [stageCaption, setStageCaption] = useState<string | null>(null);
  /** Worlds deployed before the stage paced speech never send one — keep the log line for them. */
  const stagePacesSpeech = useRef(false);
  const scrubbingRef = useRef(false);
  const [tickError, setTickError] = useState<string | null>(null);
  const [tickBusy, setTickBusy] = useState(false);
  /** 'busy' = 423 lock; 'slow' = holder/LLM timeout */
  const [tickBusyKind, setTickBusyKind] = useState<'busy' | 'slow'>('busy');
  const [apiOffline, setApiOffline] = useState(false);
  const loadingRef = useRef(false);
  const ffLoadingRef = useRef(false);
  const didAutoSelect = useRef(false);
  const reloadInFlightRef = useRef<Promise<void> | null>(null);
  const pendingReloadRef = useRef<SocietyReloadOpts | null>(null);
  const lastSoftReloadAtRef = useRef(0);
  /** One bootstrap reload per iframe boot — avoid mount+onLoad+MSG_READY storm. */
  const didBootstrapRef = useRef(false);
  /**
   * Snapshot often lands before Phaser is listening. Replay once after
   * `MSG_READY` (or a late iframe load) so the map is not stuck on day 1.
   */
  const didIframeHydrateRef = useRef(false);
  const hydrateRetryTimerRef = useRef<number | null>(null);
  /** Last inspector snapshot, so Phaser can catch up without another fetch. */
  const lastReplayPayloadRef = useRef<Record<string, unknown> | null>(null);
  /** Live tick starts only after first successful bootstrap reload. */
  const liveReadyRef = useRef(false);
  const loadAgentTimerRef = useRef<number | null>(null);
  /**
   * Wall-clock time of the last frame pushed by the server clock. While this is
   * fresh the browser stops driving ticks — the worker owns the timeline, and two
   * drivers would fight over the world lock.
   */
  const lastServerFrameAtRef = useRef(0);
  const [serverClock, setServerClock] = useState(false);
  const [bgmMuted, setBgmMuted] = useState(false);
  const [bgmLoaded, setBgmLoaded] = useState(false);
  const [bgmNeedsGesture, setBgmNeedsGesture] = useState(false);
  const [pinnedAgent, setPinnedAgent] = useState<string | null>(null);
  const [partyLoading, setPartyLoading] = useState(false);
  const [objectDraft, setObjectDraft] = useState<Record<string, string>>({});
  const [moments, setMoments] = useState<
    Array<{ simTime: number; agentId?: string; name?: string; line: string }>
  >([]);

  useEffect(() => {
    if (observatoryLocked || !isAuthor || !projectId) return;
    let cancelled = false;
    void api.world
      .get(projectId)
      .then((res) => {
        if (cancelled) return;
        const spec = res.world?.spec as
          | {
              presentation?: WorldLike['presentation'];
              space?: WorldLike['space'];
              entities?: WorldLike['entities'];
            }
          | undefined;
        setClock(
          (
            spec?.presentation?.genreProfile as
              | { clock?: { kind?: string; shifts?: number } }
              | undefined
          )?.clock,
        );
        setWorldLike({
          space: spec?.space,
          presentation: spec?.presentation,
          entities: spec?.entities,
        });
        const verbs = (
          spec?.presentation?.genreProfile as
            | { verbs?: readonly string[] }
            | undefined
        )?.verbs;
        setAllowsGathering(
          !verbs || verbs.includes('host_gathering'),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isAuthor, projectId, observatoryLocked, isGenerating, hasWorld]);

  useEffect(() => {
    return () => {
      const el = parentBgmRef.current;
      if (!el) return;
      el.pause();
      el.removeAttribute('src');
      parentBgmRef.current = null;
    };
  }, []);

  const pushReplayToIframe = useCallback(
    (payload: Record<string, unknown>) => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      win.postMessage(
        { type: MSG_REPLAY, payload: { ...payload, lockLiveTip: !isAuthor } },
        '*',
      );
    },
    [isAuthor],
  );

  const pushAppendToIframe = useCallback(
    (payload: Record<string, unknown>) => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      win.postMessage({ type: MSG_APPEND, payload }, '*');
    },
    [],
  );

  const reloadSociety = useCallback(async (opts?: SocietyReloadOpts) => {
    if (reloadInFlightRef.current) {
      pendingReloadRef.current = mergeSocietyReloadOpts(
        pendingReloadRef.current,
        opts,
      );
      return reloadInFlightRef.current;
    }
    const quiet = Boolean(opts?.quiet);
    const iframeMode = opts?.iframe ?? (quiet ? 'append' : 'replay');
    if (!quiet) setLoading(true);
    const run = (async () => {
      try {
        const res =
          isAuthor && projectId
            ? await api.world.societyEvents(projectId, 0, 1e9, 120)
            : gameId
              ? await api.community.societySnapshot(gameId)
              : { events: [], agents: [], relations: [], objects: [], simTime: 0 };
        if ('opinion' in res && res.opinion && typeof res.opinion === 'object') {
          setOpinionLive(res.opinion as OpinionBoardView);
        }
        if (!isAuthor) {
          if ('clock' in res && res.clock) setClock(res.clock);
          if ('space' in res || 'presentation' in res) {
            setWorldLike({
              space: (res as { space?: WorldLike['space'] }).space,
              presentation: (res as { presentation?: WorldLike['presentation'] })
                .presentation,
            });
          }
        }
        if ('clockPaused' in res) {
          const paused = Boolean(res.clockPaused);
          authorClockPausedRef.current = paused;
          setAuthorClockPaused(paused);
          if (isAuthor) {
            clockHydratedRef.current = true;
            setClockHydrated(true);
            if (paused) {
              livePausedRef.current = true;
              setLivePaused(true);
              setUserStoppedClock(true);
              userStoppedClockRef.current = true;
            }
          }
        } else if (isAuthor && !clockHydratedRef.current) {
          clockHydratedRef.current = true;
          setClockHydrated(true);
        }
        if ('living' in res) {
          setTownLiving(res.clockPaused ? false : Boolean(res.living));
        }
        if ('speaking' in res) {
          setTownSpeaking(res.clockPaused ? false : Boolean(res.speaking));
        }
        if ('townTimeUntil' in res) {
          setTownTimeUntil(res.townTimeUntil ?? null);
        }
        if ('lamp' in res) setTownLamp(res.lamp ?? null);
        if ('contributors' in res) setTownContributors(res.contributors ?? []);
        if ('watcherCount' in res) setWatcherCount(res.watcherCount ?? 0);
        if ('talkBudget' in res) {
          setTalkBudget(readTalkBudget((res as { talkBudget?: unknown }).talkBudget));
        }
        if ('speaking' in res) {
          if (res.speaking) {
            setSkipReason((prev) =>
              prev === 'no_permit' || prev === 'budget' ? null : prev,
            );
          } else if (res.living && res.speaking === false) {
            const lamp =
              'talkBudget' in res
                ? readTalkBudget((res as { talkBudget?: unknown }).talkBudget)
                : talkBudget;
            const quiet = featureFlags.demoOpenWorld
              ? null
              : quietTownSkipReason({
                  living: true,
                  speaking: false,
                  litUntil: lamp?.litUntil ?? null,
                  remaining: lamp?.remaining,
                  litBonus: lamp?.litBonus,
                });
            if (quiet === 'budget') {
              setSkipReason((prev) =>
                prev === 'generate' || prev === 'no_key' ? prev : 'budget',
              );
            } else {
              setSkipReason((prev) =>
                prev === 'budget' || prev === 'no_permit' ? null : prev,
              );
            }
          }
        }
        const events = res.events
          .filter((e) => e.kind !== 'emergence_report')
          .map((e) => {
            const ms = Number((e as { createdAtMs?: unknown }).createdAtMs);
            return {
              ...e,
              payload: e.payload ?? {},
              ...(Number.isFinite(ms) && ms > 0 ? { createdAtMs: ms } : {}),
            } as SocietyEvt;
          });
        const snapshotMaxT = Math.max(
          typeof res.simTime === 'number' ? res.simTime : 0,
          events.length ? Math.max(...events.map((e) => e.simTime)) : 0,
        );
        const snapshotStale = !shouldPushSocietySnapshotToIframe({
          liveCursor: cursorRef.current,
          snapshotMaxT,
          liveReady: liveReadyRef.current,
        });
        const goalByAgent = new Map<
          string,
          { place?: string; x?: number; y?: number; reason?: string; drive?: string }
        >();
        for (const e of events) {
          if (
            (e.kind !== 'action' && e.kind !== 'move') ||
            !e.agentId
          ) {
            continue;
          }
          const p = e.payload ?? {};
          const prev = goalByAgent.get(e.agentId) ?? {};
          goalByAgent.set(e.agentId, {
            place:
              typeof p.goalPlace === 'string'
                ? String(p.goalPlace)
                : prev.place,
            x: typeof p.goalX === 'number' ? Number(p.goalX) : prev.x,
            y: typeof p.goalY === 'number' ? Number(p.goalY) : prev.y,
            reason:
              typeof p.goalReason === 'string'
                ? String(p.goalReason)
                : prev.reason,
            drive:
              typeof p.drive === 'string'
                ? String(p.drive)
                : p.drive &&
                    typeof p.drive === 'object' &&
                    typeof (p.drive as { kind?: unknown }).kind === 'string'
                  ? String((p.drive as { kind: string }).kind)
                  : prev.drive,
          });
        }
        if (!snapshotStale) {
        setAgents(
          res.agents.map((a) =>
            townAgentFrom({
              id: a.id,
              name: a.name,
              currentAction: a.currentAction,
              regionId: a.regionId,
              areaId: (a as { areaId?: string }).areaId,
              areaName: (a as { areaName?: string }).areaName,
              regionName: (a as { regionName?: string }).regionName,
              goalPlace:
                (a as { goalPlace?: string }).goalPlace ??
                goalByAgent.get(a.id)?.place,
              goalReason:
                (a as { goalReason?: string }).goalReason ??
                goalByAgent.get(a.id)?.reason,
              drive:
                (a as { drive?: string }).drive ??
                goalByAgent.get(a.id)?.drive,
              goalX:
                (a as { goalX?: number }).goalX ?? goalByAgent.get(a.id)?.x,
              goalY:
                (a as { goalY?: number }).goalY ?? goalByAgent.get(a.id)?.y,
              needs: clipNeeds((a as { needs?: unknown }).needs),
              padded: (a as { padded?: boolean }).padded,
              identity: (() => {
                const ident = (a as { identity?: { summary?: unknown } }).identity;
                return typeof ident?.summary === 'string' ? ident.summary : undefined;
              })(),
            }),
          ),
        );
        setRelations(res.relations ?? []);
        setObjects(res.objects ?? []);
        const nameOf = (id: string) =>
          res.agents.find((a) => a.id === id)?.name ?? id.slice(0, 8);
        setTalkLog(
          pinTalkEvents(events)
            .flatMap((e) => talkLinesFromEvent(e, nameOf, talkOpts))
            .sort(compareTalkLines),
        );
        setEventCount(events.length);
        }
        let maxT = snapshotMaxT;
        const followTip = shouldFollowSharedCursor({
          role,
          viewPaused: userStoppedClockRef.current,
        });
        const nextCursor = societyReloadCursor({
          liveCursor: cursorRef.current,
          snapshotMaxT: maxT,
          followTip,
        });
        if (snapshotStale) {
          maxT = Math.max(maxT, nextCursor);
        }
        setSimMax((m) => Math.max(m, maxT, nextCursor));
        cursorRef.current = nextCursor;
        setCursor(nextCursor);
        let nextReport: EmergenceReport | null = null;
        try {
          if (isAuthor && projectId) {
            const rr = await api.world.societyReport(projectId);
            if (rr.report) nextReport = rr.report as EmergenceReport;
          } else if ('report' in res && res.report) {
            nextReport = res.report as EmergenceReport;
          }
        } catch {
          /* optional */
        }
        setReport(nextReport);
        if (snapshotStale) {
          liveReadyRef.current = true;
          return;
        }
        const agentPayload = res.agents.map((a) => ({
          id: a.id,
          name: a.name,
          regionId: a.regionId,
          x: a.x,
          y: a.y,
          currentAction: a.currentAction,
          goalPlace:
            (a as { goalPlace?: string }).goalPlace ??
            goalByAgent.get(a.id)?.place,
          goalReason:
            (a as { goalReason?: string }).goalReason ??
            goalByAgent.get(a.id)?.reason,
          drive:
            (a as { drive?: string }).drive ?? goalByAgent.get(a.id)?.drive,
          goalX: (a as { goalX?: number }).goalX ?? goalByAgent.get(a.id)?.x,
          goalY: (a as { goalY?: number }).goalY ?? goalByAgent.get(a.id)?.y,
        }));
        const reportPayload = compactReportPayload(nextReport);
        const replayPayload = {
          version: 1,
          projectId: stageKey,
          simTime: maxT,
          agents: agentPayload,
          events: pinMapEvents(events).map((e) => ({
            id: e.id,
            simTime: e.simTime,
            kind: e.kind,
            agentId: e.agentId,
            payload: e.payload,
            ...(typeof e.createdAtMs === 'number'
              ? { createdAtMs: e.createdAtMs }
              : {}),
          })),
          report: reportPayload,
          objects: res.objects ?? [],
        };
        if (!snapshotStale) {
          lastReplayPayloadRef.current = replayPayload;
        }
        const pushToIframe = shouldPushSocietySnapshotToIframe({
          liveCursor: cursorRef.current,
          snapshotMaxT: maxT,
          liveReady: liveReadyRef.current,
        });
        if (pushToIframe) {
          if (iframeMode === 'replay') {
            pushReplayToIframe(replayPayload);
          } else if (iframeMode === 'append') {
            pushAppendToIframe({
              simTime: maxT,
              agents: agentPayload,
              events: replayPayload.events,
              report: reportPayload,
              objects: res.objects ?? [],
            });
          }
        }
        liveReadyRef.current = true;
      } catch (err) {
        if (axios.isAxiosError(err) && err.code === 'ERR_CANCELED') return;
        if (!quiet) {
          message.warning(
            err instanceof Error ? err.message : t('product.obs.eventsEmpty'),
          );
        }
      } finally {
        if (!quiet) setLoading(false);
      }
    })();
    reloadInFlightRef.current = run.finally(() => {
      if (reloadInFlightRef.current === run) {
        reloadInFlightRef.current = null;
      }
      const pending = pendingReloadRef.current;
      pendingReloadRef.current = null;
      if (pending) void reloadSociety(pending);
    });
    return reloadInFlightRef.current;
  }, [
    isAuthor,
    role,
    projectId,
    gameId,
    stageKey,
    pushReplayToIframe,
    pushAppendToIframe,
    t,
    message,
    talkOpts,
  ]);

  const hydrateIframeReplay = useCallback(
    (_markReady: boolean) => {
      const kick = () => {
        if (
          !shouldHydrateIframeReplay({
            iframeReady: Boolean(iframeRef.current?.contentWindow),
            inspectorBooted: didBootstrapRef.current,
            alreadyHydrated: didIframeHydrateRef.current,
          })
        ) {
          return;
        }
        const stashed = lastReplayPayloadRef.current;
        if (stashed) {
          const stashT =
            typeof stashed.simTime === 'number' ? stashed.simTime : 0;
          if (
            shouldHydrateWithFullReplay({
              liveCursor: cursorRef.current,
              stashSimTime: stashT,
            })
          ) {
            pushReplayToIframe(stashed);
          } else {
            void reloadSociety({ quiet: true, iframe: 'replay' });
          }
          didIframeHydrateRef.current = true;
          return;
        }
        didIframeHydrateRef.current = true;
        void reloadSociety({ quiet: true, iframe: 'replay' });
      };
      if (reloadInFlightRef.current) {
        void reloadInFlightRef.current.then(kick);
        return;
      }
      kick();
    },
    [pushReplayToIframe, reloadSociety],
  );

  useEffect(() => {
    didBootstrapRef.current = false;
    didIframeHydrateRef.current = false;
    lastReplayPayloadRef.current = null;
    if (hydrateRetryTimerRef.current != null) {
      window.clearTimeout(hydrateRetryTimerRef.current);
      hydrateRetryTimerRef.current = null;
    }
    liveReadyRef.current = false;
    didAutoSelect.current = false;
    phaserReadyRef.current = false;
    setPhaserLive(false);
    setIframeReady(false);
    setIframePrep('idle');
    return () => {
      if (hydrateRetryTimerRef.current != null) {
        window.clearTimeout(hydrateRetryTimerRef.current);
        hydrateRetryTimerRef.current = null;
      }
    };
  }, [stageKey, remountKey, isAuthor]);

  useEffect(() => {
    setLivePaused(true);
    livePausedRef.current = true;
    authorClockPausedRef.current = false;
    setAuthorClockPaused(false);
    clockHydratedRef.current = !isAuthor;
    setClockHydrated(!isAuthor);
    setUserStoppedClock(false);
    userStoppedClockRef.current = false;
    setInterviewA(null);
    setInterviewQ('');
    setObjects([]);
    setPinnedAgent(null);
    setAgents([]);
    setEventCount(0);
    setTalkLog([]);
    setReport(null);
    setRelations([]);
    setTownLiving(false);
    setTownSpeaking(false);
    setTownTimeUntil(null);
    try {
      const raw = window.localStorage.getItem(`opengame-obs-moment-${stageKey}`);
      setMoments(raw ? (JSON.parse(raw) as typeof moments) : []);
    } catch {
      setMoments([]);
    }
  }, [stageKey, isAuthor]);

  useEffect(() => {
    if (!stageDead || generatingRef.current) return;
    livePausedRef.current = true;
    setLivePaused(true);
    if (isAuthor) {
      authorClockPausedRef.current = true;
      setAuthorClockPaused(true);
    }
    if (isAuthor && projectId && hasWorld) {
      void api.world.societyHeartbeat(projectId, 'off').catch(() => undefined);
    }
  }, [stageDead, isAuthor, projectId, hasWorld]);

  /** Slim replay on S3 before iframe loads society_replay.json (old bundles parse it on boot). */
  useEffect(() => {
    if (!previewUrl || !isAuthor || !projectId || isGenerating) {
      setIframePrep('ready');
      return;
    }
    let cancelled = false;
    setIframePrep('republish');
    const fallback = window.setTimeout(() => {
      if (!cancelled) setIframePrep('ready');
    }, 6_000);
    void (async () => {
      try {
        await api.world.societyRepublishReplay(projectId);
      } catch {
        /* dev may have no S3 — parent postMessage still works */
      }
      if (!cancelled) setIframePrep('ready');
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
  }, [previewUrl, isAuthor, projectId, remountKey, isGenerating]);

  useEffect(() => {
    userStoppedClockRef.current = userStoppedClock;
  }, [userStoppedClock]);

  useEffect(() => {
    if (isAuthor) return;
    const timer = window.setInterval(() => setLeaseNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [isAuthor, townTimeUntil]);

  useEffect(() => {
    if (!lampFlash) return;
    const hold = lampFlash.sku === 'month' ? 12_000 : 8_000;
    const timer = window.setTimeout(() => setLampFlash(null), hold);
    return () => window.clearTimeout(timer);
  }, [lampFlash]);

  useEffect(() => {
    if (!lightFlash) return;
    const timer = window.setTimeout(() => setLightFlash(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [lightFlash]);

  useEffect(() => {
    if (
      !shouldAutoloadTownMap({
        role,
        autoloadMap,
        hasPreview: Boolean(previewUrl),
        mapPrepReady: iframePrep === 'ready',
        broken: Boolean(previewBroken),
        bundleReady: isGenerating ? undefined : bundleReady,
      })
    ) {
      return;
    }
    setIframeReady(true);
  }, [role, autoloadMap, previewUrl, iframePrep, previewBroken, bundleReady, isGenerating, remountKey]);

  useEffect(() => {
    const guestReady = shouldBootstrapInspectorNow({
      role,
      gameId,
      locked: observatoryLocked,
    });
    const observatoryReady =
      isAuthor && autoloadMap && Boolean(projectId) && !observatoryLocked;
    if (!guestReady && !observatoryReady) return;
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;
    void reloadSociety({ iframe: 'none' }).then(() => {
      hydrateIframeReplay(false);
      if (
        shouldAutostartPlayback({
          role,
          autoloadMap,
          userStopped: userStoppedClockRef.current,
          locked: observatoryLocked,
          broken: Boolean(previewBroken),
          stageLive: iframeReady,
          clockPaused: authorClockPausedRef.current,
        })
      ) {
        toggleTownClockRef.current(false);
      }
    });
  }, [
    role,
    isAuthor,
    projectId,
    gameId,
    autoloadMap,
    observatoryLocked,
    previewBroken,
    remountKey,
    reloadSociety,
    hydrateIframeReplay,
  ]);

  const loadAgent = useCallback(
    async (agentKey: string) => {
      setSelectedAgent(agentKey);
      setInspectorKeys((keys) =>
        keys.includes('agent') ? keys : [...keys, 'agent'],
      );
      const win = iframeRef.current?.contentWindow;
      win?.postMessage(
        { type: MSG_SELECT, payload: { agentId: agentKey } },
        '*',
      );
      if (!isAuthor || !projectId) {
        const live = agentsRef.current.find((a) => a.id === agentKey);
        setMemories([]);
        setDayPlan(null);
        setAgentCard({
          name: live?.name ?? agentKey,
          regionId: live?.regionId ?? '',
          areaName: live?.areaName,
          regionName: live?.regionName,
          currentAction: live?.currentAction ?? '',
          goalPlace: live?.goalPlace,
          goalReason: live?.goalReason,
          drive: live?.drive,
          needs: live?.needs,
          identity: live?.identity,
        });
        return;
      }
      try {
        const res = await api.world.societyAgent(projectId, agentKey);
        setMemories(res.memories);
        if (selectedRef.current && selectedRef.current !== agentKey) {
          setInterviewA(null);
        }
        const segs = Array.isArray(res.plans[0]?.segments)
          ? (res.plans[0]!.segments as PlanSegment[])
          : [];
        const planRow = res.plans[0] as
          | {
              dayIndex: number;
              replan?: boolean;
              reason?: string;
            }
          | undefined;
        setDayPlan((prev) =>
          planRow
            ? {
                dayIndex: planRow.dayIndex,
                segments: segs,
                replan:
                  planRow.replan === true ||
                  (prev?.dayIndex === planRow.dayIndex
                    ? prev.replan
                    : undefined),
                reason:
                  typeof planRow.reason === 'string' && planRow.reason.trim()
                    ? planRow.reason
                    : prev?.dayIndex === planRow.dayIndex
                      ? prev.reason
                      : undefined,
              }
            : null,
        );
        const ident = res.agent?.identity;
        const identRec =
          ident && typeof ident === 'object'
            ? (ident as {
                summary?: unknown;
                stance?: unknown;
                secret?: unknown;
              })
            : undefined;
        const summary =
          identRec && typeof identRec.summary === 'string'
            ? identRec.summary
            : undefined;
        const stance =
          identRec && typeof identRec.stance === 'string'
            ? identRec.stance
            : undefined;
        const secret =
          identRec && typeof identRec.secret === 'string'
            ? identRec.secret
            : undefined;
        const live = agentsRef.current.find((a) => a.id === agentKey);
        const goalPlace = res.agent?.goalPlace ?? live?.goalPlace;
        const goalReason =
          (res.agent as { goalReason?: string } | undefined)?.goalReason ??
          live?.goalReason;
        const drive =
          (res.agent as { drive?: string } | undefined)?.drive ?? live?.drive;
        const goalX = res.agent?.goalX ?? live?.goalX;
        const goalY = res.agent?.goalY ?? live?.goalY;
        setAgentCard(
          res.agent
            ? {
                name: res.agent.name,
                regionId: res.agent.regionId,
                areaName: res.agent.areaName ?? live?.areaName,
                regionName: res.agent.regionName ?? live?.regionName,
                currentAction: res.agent.currentAction,
                goalPlace,
                goalReason,
                drive,
                identity: summary,
                stance,
                secret,
                needs: clipNeeds(res.agent.needs) ?? live?.needs,
              }
            : {
                name: live?.name ?? agentKey,
                regionId: live?.regionId ?? '',
                areaName: live?.areaName,
                regionName: live?.regionName,
                currentAction: live?.currentAction ?? '',
                goalPlace,
                goalReason,
                drive,
                needs: live?.needs,
              },
        );
        if (goalPlace || goalX != null || goalY != null) {
          pushAppendToIframe({
            agents: [
              {
                id: agentKey,
                name: res.agent?.name ?? live?.name ?? agentKey,
                regionId: res.agent?.regionId ?? live?.regionId ?? '',
                currentAction:
                  res.agent?.currentAction ?? live?.currentAction ?? '',
                goalX,
                goalY,
                goalPlace,
              },
            ],
            events: [],
          });
        }
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
    [isAuthor, projectId, pushAppendToIframe],
  );

  useEffect(() => {
    if (didAutoSelect.current || selectedRef.current || !agents.length) return;
    const pick = agents[0];
    if (!pick) return;
    didAutoSelect.current = true;
    void loadAgent(pick.id);
  }, [agents, loadAgent]);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data as {
        type?: string;
        payload?: {
          agentId?: string | null;
          cursor?: number;
          paused?: boolean;
          name?: string;
          action?: string;
          muted?: boolean;
          loaded?: boolean;
          needsGesture?: boolean;
          playing?: boolean;
          caption?: string | null;
          talkSeq?: number | null;
          circleIndex?: number | null;
          listeningCircle?: number | null;
          listeningTotal?: number | null;
          reason?: string;
        };
      };
      if (!data?.type) return;
      const fromStage = ev.source === iframeRef.current?.contentWindow;
      if (iframeRef.current?.contentWindow && !fromStage) return;
      if (data.type === PREVIEW_BROKEN_MSG) {
        if (phaserReadyRef.current) return;
        markBroken(asPreviewReason(data.payload?.reason));
        return;
      }
      if (isTownStageAliveMessage(data.type)) {
        phaserReadyRef.current = true;
        setPhaserLive(true);
        setIframeReady(true);
        markLive();
      }
      if (data.type === MSG_READY) {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: MSG_SET_PLAYING,
            payload: { playing: !livePausedRef.current },
          },
          '*',
        );
        if (!didBootstrapRef.current) {
          didBootstrapRef.current = true;
          void reloadSociety().then(() => {
            if (iframeRef.current?.contentWindow) {
              didIframeHydrateRef.current = true;
            }
          });
        } else {
          hydrateIframeReplay(true);
        }
      }
      if (data.type === MSG_BGM_STATUS && data.payload) {
        if (parentBgmPlayingRef.current) {
          if (typeof data.payload.loaded === 'boolean' && data.payload.loaded) {
            setBgmLoaded(true);
          }
        } else {
          if (typeof data.payload.muted === 'boolean') setBgmMuted(data.payload.muted);
          if (typeof data.payload.loaded === 'boolean') setBgmLoaded(data.payload.loaded);
          if (typeof data.payload.needsGesture === 'boolean') {
            setBgmNeedsGesture(data.payload.needsGesture);
          }
        }
      }
      if (data.type === MSG_SELECT && data.payload?.agentId) {
        void loadAgent(data.payload.agentId);
      }
      if (data.type === MSG_HOVER) {
        const name = data.payload?.name;
        const action = data.payload?.action;
        if (typeof name === 'string' && name) {
          setHoverIntent({ name, action: action ?? '' });
        } else {
          setHoverIntent(null);
        }
      }
      if (data.type === MSG_LIVE_PAUSE && typeof data.payload?.paused === 'boolean') {
        if (data.payload.paused) {
          if (!livePausedRef.current) toggleTownClockRef.current(true);
        } else {
          toggleTownClockRef.current(false);
        }
      }
      if (data.type === MSG_CURSOR && data.payload && 'caption' in data.payload) {
        // The stage paces the exchange one line at a time, so it owns the caption:
        // the newest log line would run ahead of the bubble that is on screen.
        const caption = data.payload.caption;
        stagePacesSpeech.current = true;
        setStageCaption(typeof caption === 'string' && caption ? caption : null);
        const seq = Number(data.payload.talkSeq);
        setLiveTalkSeq(Number.isFinite(seq) && seq > 0 ? seq : null);
        const circle = Number(
          data.payload.listeningCircle ?? data.payload.circleIndex,
        );
        setLiveCircleIndex(Number.isFinite(circle) && circle > 0 ? circle : null);
        const total = Number(data.payload.listeningTotal);
        setListeningTotal(Number.isFinite(total) && total > 0 ? total : 0);
      }
      if (
        data.type === MSG_CURSOR &&
        liveReadyRef.current &&
        !scrubbingRef.current &&
        shouldFollowSharedCursor({
          role,
          viewPaused: userStoppedClockRef.current,
        }) &&
        typeof data.payload?.cursor === 'number' &&
        Number.isFinite(data.payload.cursor)
      ) {
        const c = data.payload.cursor;
        cursorRef.current = c;
        setCursor((prev) => {
          if (c + 0.35 < prev) return prev;
          return Math.abs(prev - c) < 0.25 ? prev : c;
        });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [reloadSociety, hydrateIframeReplay, loadAgent, markBroken, markLive, role]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    ffLoadingRef.current = ffLoading;
  }, [ffLoading]);

  useEffect(() => {
    selectedRef.current = selectedAgent;
  }, [selectedAgent]);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    if (!selectedAgent) return;
    const a = agents.find((x) => x.id === selectedAgent);
    if (!a) return;
    setAgentCard((prev) =>
      prev
        ? {
            ...prev,
            name: a.name,
            regionId: a.regionId ?? prev.regionId,
            areaName: a.areaName ?? prev.areaName,
            regionName: a.regionName ?? prev.regionName,
            currentAction: a.currentAction,
            goalPlace: a.goalPlace ?? prev.goalPlace,
            goalReason: a.goalReason ?? prev.goalReason,
            drive: a.drive ?? prev.drive,
            needs: a.needs ?? prev.needs,
          }
        : prev,
    );
  }, [agents, selectedAgent]);

  useEffect(() => {
    livePausedRef.current = livePaused;
  }, [livePaused]);

  useEffect(() => {
    if (!iframeReady) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: MSG_SET_PLAYING, payload: { playing: !livePaused } },
      '*',
    );
    iframeRef.current?.contentWindow?.postMessage(
      { type: MSG_LOCK_LIVE, payload: { lockLiveTip: !isAuthor } },
      '*',
    );
    if (isAuthor) {
      iframeRef.current?.contentWindow?.postMessage(
        { type: MSG_SET_SPEED, payload: { speed: playbackSpeedRef.current } },
        '*',
      );
    }
  }, [iframeReady, livePaused, isAuthor]);

  const toggleTownClock = useCallback(
    (paused: boolean, opts?: { resumeShared?: boolean }) => {
      if (!paused && observatoryDisabled) return;
      if (!paused && stageDead) {
        message.warning(t('product.obs.previewBroken'));
        return;
      }
      livePausedRef.current = paused;
      setLivePaused(paused);
      if (isAuthor) {
        authorClockPausedRef.current = paused;
        setAuthorClockPaused(paused);
      }
      iframeRef.current?.contentWindow?.postMessage(
        { type: MSG_SET_PLAYING, payload: { playing: !paused } },
        '*',
      );
      if (paused) {
        setUserStoppedClock(true);
        userStoppedClockRef.current = true;
        if (isAuthor && projectId) {
          void api.world.societyHeartbeat(projectId, 'off').catch(() => undefined);
        }
        return;
      }
      setUserStoppedClock(false);
      userStoppedClockRef.current = false;
      if (!iframeReady) setIframeReady(true);
      if (opts?.resumeShared && isAuthor && projectId) {
        void api.world
          .societyHeartbeat(projectId, 'watching', 8, societyWatchTabId(), {
            resumeClock: true,
          })
          .catch(() => undefined);
      }
    },
    [isAuthor, projectId, iframeReady, stageDead, observatoryDisabled, message, t],
  );
  toggleTownClockRef.current = toggleTownClock;

  useEffect(() => {
    if (!resumeClockNonce) return;
    toggleTownClockRef.current(false, { resumeShared: true });
  }, [resumeClockNonce]);

  useEffect(() => {
    if (!iframeReady) return;
    if (
      !shouldAutostartPlayback({
        role,
        autoloadMap,
        userStopped: userStoppedClockRef.current,
        locked: observatoryLocked,
        broken: Boolean(previewBroken),
        stageLive: true,
        clockPaused: authorClockPausedRef.current,
      })
    ) {
      return;
    }
    if (isAuthor && !clockHydratedRef.current) return;
    if (livePausedRef.current) toggleTownClockRef.current(false);
  }, [iframeReady, autoloadMap, role, isAuthor, clockHydrated, observatoryLocked, previewBroken]);

  const rebuildPresenter = useCallback(() => {
    if (!isAuthor || !projectId) return;
    void (async () => {
      try {
        await api.world.edit(projectId, {
          prompt: 'rebuild society presenter',
          rebuildOnly: true,
        });
        message.info(t('world.toast.rebuildQueued'));
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [isAuthor, projectId, message, t]);

  const askInterview = useCallback(
    async (rawQuestion?: string) => {
      if (!isAuthor || !projectId) return;
      if (talkDisabled) return;
      if (stageDead) {
        message.warning(t('product.obs.previewBroken'));
        return;
      }
      if (!selectedAgent) {
        message.warning(t('product.obs.interviewNeedAgent'));
        return;
      }
      const question = (rawQuestion ?? interviewQ).trim();
      if (!question) return;
      setInterviewQ(question);
      setInterviewLoading(true);
      try {
        const res = await api.world.societyInterview(projectId, {
          agentKey: selectedAgent,
          question,
        });
        setInterviewA({
          answer: res.answer,
          cited: res.cited ?? [],
          citedMemoryIds: res.citedMemoryIds ?? [],
          source: res.source,
        });
        if (res.source === 'memory') {
          message.info(t('product.obs.interviewFromMemory'));
        }
        if (res.answer) {
          const who =
            agentsRef.current.find((a) => a.id === selectedAgent)?.name ??
            selectedAgent;
          const visitor = t('product.obs.visitor');
          const evt: SocietyEvt = {
            id: `interview-${Date.now()}`,
            simTime: cursorRef.current,
            kind: 'intervene',
            agentId: selectedAgent,
            payload: {
              interview: true,
              text: res.answer.slice(0, 180),
              turns: [
                {
                  speakerId: selectedAgent,
                  speakerName: who,
                  text: res.answer.slice(0, 180),
                },
              ],
              with: visitor,
            },
          };
          const nameOf = (id: string) =>
            agentsRef.current.find((a) => a.id === id)?.name ?? id;
          setTalkLog((prev) =>
            mergeTalkLog(prev, talkLinesFromEvent(evt, nameOf, talkOpts)),
          );
          pushAppendToIframe({
            simTime: cursorRef.current,
            events: [evt],
          });
        }
        void loadAgent(selectedAgent);
        void reloadSociety({ quiet: true, iframe: 'append' });
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        message.error(msg);
      } finally {
        setInterviewLoading(false);
      }
    },
    [
      interviewQ,
      loadAgent,
      message,
      projectId,
      pushAppendToIframe,
      reloadSociety,
      selectedAgent,
      t,
      talkOpts,
      stageDead,
      talkDisabled,
      isAuthor,
    ],
  );

  /**
   * Render one advance of the world. Shared by the server-clock stream and the
   * browser-driven fallback tick so both produce identical UI state.
   */
  const applySocietyFrame = useCallback(
    (frame: SocietyFrame) => {
      if (typeof frame.llm === 'boolean') setLlmLive(frame.llm);
      if (typeof frame.degraded === 'boolean') setDegraded(frame.degraded);
      if (frame.talkBudget !== undefined) {
        setTalkBudget(readTalkBudget(frame.talkBudget));
      }
      if (authorClockPausedRef.current) {
        setTownLiving(false);
        setTownSpeaking(false);
        if (typeof frame.llm === 'boolean') setLlmLive(false);
        return;
      }
      setAuthorClockPaused(false);
      setTownLiving(true);
      if (
        frame.skipReason === 'generate' ||
        frame.skipReason === 'no_key' ||
        frame.skipReason === 'budget' ||
        frame.skipReason === 'unwatched' ||
        frame.skipReason === 'no_permit' ||
        frame.skipReason === 'keys_exhausted'
      ) {
        setSkipReason(frame.skipReason);
        if (frame.skipReason === 'no_permit') setTownSpeaking(false);
      } else if (typeof frame.llm === 'boolean') {
        setSkipReason(null);
        if (frame.llm) setTownSpeaking(true);
      }
      if (
        frame.dialogueKind === 'model' ||
        frame.dialogueKind === 'template' ||
        frame.dialogueKind === 'none'
      ) {
        setDialogueKind(frame.dialogueKind);
      }
      if (typeof frame.retrievalDegraded === 'boolean') {
        setRetrievalDegraded(frame.retrievalDegraded);
      }
      setSimMax(frame.simTime);
      setEventCount((n) => n + frame.events.length);
      if (frame.relations?.length) {
        setRelations((prev) => {
          if (!frame.agentsDelta) return frame.relations ?? prev;
          const byKey = new Map(prev.map((r) => [`${r.from}|${r.to}`, r]));
          for (const edge of frame.relations ?? []) {
            byKey.set(`${edge.from}|${edge.to}`, edge);
          }
          return [...byKey.values()];
        });
      }
      if (frame.opinion) setOpinionLive(frame.opinion);
      if (frame.objects?.length) setObjects(frame.objects);
      if (frame.report) {
        setReport(
          (prev) =>
            (mergeSocietyFrameReport(prev, frame.report) as EmergenceReport) ??
            frame.report ??
            prev,
        );
      }
      if (
        typeof frame.simTime === 'number' &&
        shouldFollowSharedCursor({
          role,
          viewPaused: userStoppedClockRef.current,
          scrubbing: scrubbingRef.current,
        })
      ) {
        setSimMax((m) => Math.max(m, frame.simTime));
        const next = Math.max(cursorRef.current, frame.simTime);
        cursorRef.current = next;
        setCursor((prev) => (Math.abs(prev - next) < 0.25 ? prev : next));
      }
      const mergedAgents = (() => {
        const incoming = frame.agents ?? [];
        if (!frame.agentsDelta) {
          return incoming.map((a) =>
            townAgentFrom({
              id: a.id,
              name: a.name,
              currentAction: a.currentAction,
              regionId: a.regionId ?? '',
              areaId: a.areaId,
              areaName: a.areaName,
              regionName: a.regionName,
              goalPlace: a.goalPlace,
              goalReason: a.goalReason,
              drive: a.drive,
              goalX: a.goalX,
              goalY: a.goalY,
              needs: clipNeeds(a.needs),
              padded: a.padded,
            }),
          );
        }
        const prevById = new Map(agentsRef.current.map((p) => [p.id, p]));
        for (const a of incoming) {
          const was = prevById.get(a.id);
          prevById.set(
            a.id,
            townAgentFrom({
              id: a.id,
              name: a.name || was?.name || a.id,
              currentAction: a.currentAction || was?.currentAction || '',
              regionId: a.regionId ?? was?.regionId ?? '',
              areaId: a.areaId ?? was?.areaId,
              areaName: a.areaName ?? was?.areaName,
              regionName: a.regionName ?? was?.regionName,
              goalPlace: a.goalPlace ?? was?.goalPlace,
              goalReason: a.goalReason ?? was?.goalReason,
              drive: a.drive ?? was?.drive,
              goalX: a.goalX ?? was?.goalX,
              goalY: a.goalY ?? was?.goalY,
              needs: clipNeeds(a.needs) ?? was?.needs,
              padded: a.padded ?? was?.padded,
            }),
          );
        }
        return [...prevById.values()];
      })();
      setAgents(mergedAgents);
      const namesById = new Map(mergedAgents.map((a) => [a.id, a.name]));
      const nameOf = (id: string) => namesById.get(id) ?? id.slice(0, 8);
      const fresh = frame.events.flatMap((e) => talkLinesFromEvent(e, nameOf, talkOpts));
      if (fresh.length) setTalkLog((prev) => mergeTalkLog(prev, fresh));
      const prevReplay = lastReplayPayloadRef.current;
      const prevEvents = (
        Array.isArray(prevReplay?.events) ? prevReplay.events : []
      ) as SocietyEvt[];
      const incoming = frame.events.filter((e) => isMapEventKind(e.kind));
      const byId = new Map(prevEvents.map((e) => [e.id, e]));
      for (const e of incoming) byId.set(e.id, e);
      const prevRoster = (
        Array.isArray(prevReplay?.agents) ? prevReplay.agents : []
      ) as SocietyFrame['agents'];
      const replayAgents = frame.agentsDelta
        ? (() => {
            const byAgent = new Map(prevRoster.map((a) => [a.id, a]));
            for (const agent of frame.agents) byAgent.set(agent.id, { ...byAgent.get(agent.id), ...agent });
            return [...byAgent.values()];
          })()
        : frame.agents;
      lastReplayPayloadRef.current = {
        version: 1,
        projectId: stageKey,
        simTime: frame.simTime,
        agents: replayAgents,
        events: pinMapEvents([...byId.values()]),
        report: compactReportPayload(frame.report) ?? prevReplay?.report,
        objects: frame.objects?.length
          ? frame.objects
          : (prevReplay?.objects ?? []),
        ...(frame.crowd ? { crowd: frame.crowd } : {}),
      };
      pushAppendToIframe({
        simTime: frame.simTime,
        agents: replayAgents,
        events: incoming.sort(compareSocietyEvtOrder),
        report: compactReportPayload(frame.report),
        objects: frame.objects ?? [],
        ...(frame.crowd ? { crowd: frame.crowd } : {}),
      });
      const sel = selectedRef.current;
      if (sel) {
        const planEvt = frame.events.find(
          (e) => e.kind === 'plan' && e.agentId === sel,
        );
        if (planEvt && Array.isArray(planEvt.payload['segments'])) {
          const segs = (planEvt.payload['segments'] as PlanSegment[]).map(
            (s) => ({
              startHour: s.startHour,
              endHour: s.endHour,
              activity: s.activity,
              locationId: s.locationId,
              locationName: s.locationName,
            }),
          );
          setDayPlan({
            dayIndex: Number(planEvt.payload['dayIndex'] ?? 0),
            segments: segs,
            replan: planEvt.payload['replan'] === true,
            reason:
              typeof planEvt.payload['reason'] === 'string'
                ? String(planEvt.payload['reason'])
                : undefined,
          });
        }
      }
      if (
        sel &&
        frame.events.some(
          (e) =>
            e.kind === 'dialogue' ||
            e.kind === 'intervene' ||
            e.kind === 'plan',
        )
      ) {
        if (loadAgentTimerRef.current != null) {
          window.clearTimeout(loadAgentTimerRef.current);
        }
        loadAgentTimerRef.current = window.setTimeout(() => {
          loadAgentTimerRef.current = null;
          void loadAgent(sel);
        }, 2000);
      }
    },
    [loadAgent, pushAppendToIframe, role, stageKey],
  );

  const [courseLiveNudge, setCourseLiveNudge] = useState(0);

  /**
   * Subscribe to the server-side world clock. The worker advances the town on its
   * own schedule, so the browser only needs to render frames — no POST per tick,
   * and every viewer sees the same timeline.
   */
  useEffect(() => {
    if (
      !shouldKeepSocietyStream({
        role,
        livePaused,
        disabled: observatoryDisabled,
        dead: stageDead,
      })
    ) {
      return;
    }
    if (typeof EventSource === 'undefined') return;
    if (isAuthor && !useAppStore.getState().token) return;
    let cancelled = false;
    let es: EventSource | null = null;
    let pending: SocietyFrame | null = null;
    let raf: number | null = null;
    const flush = () => {
      raf = null;
      const frame = pending;
      pending = null;
      if (frame) applySocietyFrame(frame);
    };
    const onPatron = (ev: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(ev.data) as {
          og?: string;
          lamp?: TownLamp;
          contributors?: TownContributor[];
          watcherCount?: number;
          displayName?: string;
          bonus?: number;
          talkBudget?: unknown;
        };
        if (msg.og === 'world-light') {
          const view = msg.talkBudget ? readTalkBudget(msg.talkBudget) : null;
          if (view) setTalkBudget(view);
          if (msg.contributors) setTownContributors(msg.contributors);
          if (msg.watcherCount != null) setWatcherCount(msg.watcherCount);
          setLightFlash({
            name: msg.displayName || t('product.obs.worldLightOk'),
            bonus: Number(msg.bonus) || 0,
          });
          if (shouldClearBudgetMute(view)) {
            setSkipReason((prev) =>
              prev === 'budget' || prev === 'keys_exhausted' ? null : prev,
            );
          }
          return;
        }
        if (msg.og !== 'patron' || !msg.lamp) return;
        setTownLamp(msg.lamp);
        setTownTimeUntil(msg.lamp.townTimeUntil);
        setTownContributors(msg.contributors ?? []);
        if (msg.watcherCount != null) setWatcherCount(msg.watcherCount);
        setLampFlash(msg.lamp);
        setSkipReason((prev) => (prev === 'no_permit' ? null : prev));
      } catch {
        /* ignore a bad ceremony frame */
      }
    };
    const onCourse = (ev: MessageEvent<string>): void => {
      setCourseLiveNudge((n) => n + 1);
      try {
        const msg = JSON.parse(ev.data) as {
          og?: string;
          canon?: string | null;
          nodeId?: string | null;
        };
        const canon = msg.og === 'course' ? msg.canon?.trim() : '';
        if (!canon) return;
        const id = `course-settle:${msg.nodeId ?? 'live'}`;
        setTalkLog((prev) =>
          mergeTalkLog(prev, [
            {
              id,
              eventId: id,
              turnIndex: 0,
              simTime: cursorRef.current,
              kind: 'observation',
              who: townLabel,
              text: canon.slice(0, 140),
            },
          ]),
        );
      } catch {
        /* a bad pulse must not tear the stream */
      }
    };
    const onFrame = (ev: MessageEvent<string>) => {
      try {
        const frame = JSON.parse(ev.data) as SocietyFrame;
        lastServerFrameAtRef.current = Date.now();
        setServerClock(true);
        setApiOffline(false);
        setTickError(null);
        setTickBusy(false);
        pending = coalesceSocietyFrames(pending, frame);
        raf ??= requestAnimationFrame(flush);
      } catch {
        // A malformed frame must not tear down the stream.
      }
    };
    const openStream = (url: string) => {
      try {
        es = new EventSource(url);
      } catch {
        return;
      }
      es.addEventListener('society-frame', onFrame as EventListener);
      es.addEventListener('society-patron', onPatron as EventListener);
      es.addEventListener('society-course', onCourse as EventListener);
      es.onerror = () => {
        setServerClock(false);
      };
    };
    if (isAuthor && projectId) {
    void api.auth.mintSseQueryTicket().then((ticket) => {
      if (cancelled || !ticket) return;
      openStream(api.world.societyStreamUrl(projectId, ticket));
    });
    } else if (gameId) {
      openStream(api.community.societyStreamUrl(gameId));
    }
    return () => {
      cancelled = true;
      if (raf !== null) cancelAnimationFrame(raf);
      es?.removeEventListener('society-frame', onFrame as EventListener);
      es?.removeEventListener('society-patron', onPatron as EventListener);
      es?.removeEventListener('society-course', onCourse as EventListener);
      es?.close();
      setServerClock(false);
    };
  }, [
    isAuthor,
    role,
    projectId,
    gameId,
    livePaused,
    stageDead,
    observatoryDisabled,
    applySocietyFrame,
    townLabel,
  ]);

  /**
   * Refresh a short observer lease so this town's MiniMax talks run.
   * Author pause stops watching (off already froze the shared clock).
   * Guest local pause still counts as being on the page.
   * A hidden tab is not presence — after a short grace we leave.
   */
  useEffect(() => {
    if (observatoryDisabled || stageDead) return;
    if (isAuthor && !hasWorld) return;
    if (isAuthor && livePaused) return;
    let cancelled = false;
    let hiddenSince: number | null =
      typeof document !== 'undefined' && document.hidden ? Date.now() : null;
    let hiddenTimer: number | null = null;
    let leftHidden = false;

    const dropLease = () => {
      if (cancelled || leftHidden) return;
      leftHidden = true;
      const tab = societyWatchTabId();
      if (isAuthor && projectId) {
        void api.world
          .societyHeartbeat(projectId, 'leave', undefined, tab)
          .then((res) => {
            if (res.watcherCount != null) setWatcherCount(res.watcherCount);
          })
          .catch(() => undefined);
        return;
      }
      if (gameId) {
        void api.community
          .presence(gameId, { leave: true, tab })
          .then((res) => {
            if (res.watcherCount != null) setWatcherCount(res.watcherCount);
          })
          .catch(() => undefined);
      }
    };

    const touch = () => {
      if (cancelled) return;
      const decision = presenceWhilePageVisible({ hiddenSince });
      if (decision === 'leave') {
        dropLease();
        return;
      }
      if (decision === 'hold') return;
      leftHidden = false;
      const tab = societyWatchTabId();
      if (isAuthor && projectId) {
        void api.world
          .societyHeartbeat(projectId, 'watching', 8, tab)
          .then((res) => {
            if (res.watcherCount != null) setWatcherCount(res.watcherCount);
            setPresenceAcked(true);
          })
          .catch(() => undefined);
        return;
      }
      if (gameId) {
        void api.community
          .presence(gameId, { tab })
          .then((res) => {
            if (res.paused) {
              authorClockPausedRef.current = true;
              setAuthorClockPaused(true);
              setTownLiving(false);
              setTownSpeaking(false);
            } else if (res.ok && !res.throttled) {
              authorClockPausedRef.current = false;
              setAuthorClockPaused(false);
            }
            setPresenceAcked(true);
            if (res.watcherCount != null) setWatcherCount(res.watcherCount);
          })
          .catch(() => undefined);
      }
    };

    const onVis = () => {
      if (document.hidden) {
        hiddenSince = Date.now();
        if (hiddenTimer != null) window.clearTimeout(hiddenTimer);
        hiddenTimer = window.setTimeout(() => {
          if (presenceWhilePageVisible({ hiddenSince }) === 'leave') dropLease();
        }, PRESENCE_HIDDEN_GRACE_MS);
        return;
      }
      hiddenSince = null;
      if (hiddenTimer != null) window.clearTimeout(hiddenTimer);
      hiddenTimer = null;
      leftHidden = false;
      touch();
    };

    touch();
    const timer = window.setInterval(touch, isAuthor ? 90_000 : 60_000);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (hiddenTimer != null) window.clearTimeout(hiddenTimer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [isAuthor, projectId, gameId, livePaused, stageDead, observatoryDisabled, hasWorld]);

  useEffect(() => {
    return () => {
      const tab = societyWatchTabId();
      // 离开时立刻发 leave；之前要 hasWorld=true 才发，导致 hasWorld 未到位
      // 时组件卸载（登录页跳转），lease 永远不释放，worker 一直生成对话。
      // 这里只要 author + projectId 已知就发；后端 leave 写入本身就是 idempotent。
      if (isAuthor && projectId) {
        void api.world
          .societyHeartbeat(projectId, 'leave', undefined, tab)
          .catch(() => undefined);
        return;
      }
      if (gameId) {
        void api.community
          .presence(gameId, { leave: true, tab })
          .catch(() => undefined);
      }
    };
  }, [isAuthor, projectId, gameId]);

  useEffect(() => {
    if (
      !shouldKeepSocietyStream({
        role,
        livePaused,
        disabled: observatoryDisabled,
        dead: stageDead,
      })
    ) {
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    let failStreak = 0;
    const schedule = (ms: number) => {
      if (cancelled) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void tick();
      }, ms);
    };
    const tick = async () => {
      if (cancelled || tickingRef.current) return;
      if (livePausedRef.current && isAuthor) return;
      if (!liveReadyRef.current) {
        schedule(400);
        return;
      }
      if (ffLoadingRef.current) {
        schedule(LIVE_TICK_MS);
        return;
      }
      if (typeof document !== 'undefined' && document.hidden) {
        schedule(LIVE_TICK_MS);
        return;
      }
      // The worker owns the clock while frames keep arriving. Two drivers would
      // just contend for the world lock and produce 423s.
      if (lastServerFrameAtRef.current === 0) {
        lastServerFrameAtRef.current = Date.now();
        schedule(SERVER_CLOCK_GRACE_MS);
        return;
      }
      if (Date.now() - lastServerFrameAtRef.current < SERVER_CLOCK_GRACE_MS) {
        schedule(LIVE_TICK_MS);
        return;
      }
      tickingRef.current = true;
      try {
        if (!isAuthor || !projectId) {
          const now = Date.now();
          if (now - lastSoftReloadAtRef.current > 8_000) {
            lastSoftReloadAtRef.current = now;
            void reloadSociety({ quiet: true, iframe: 'append' });
          }
          schedule(LIVE_TICK_MS);
          return;
        }
        const res = await api.world.societyTick(projectId);
        if (cancelled) return;
        failStreak = 0;
        setLlmLive(res.llm);
        setDegraded(res.degraded);
        setSkipReason(res.skipReason ?? null);
        setDialogueKind(res.dialogueKind ?? null);
        setTickError(null);
        setTickBusy(false);
        setApiOffline(false);
        applySocietyFrame(res);
        lastServerFrameAtRef.current = Date.now();
        schedule(SERVER_CLOCK_GRACE_MS);
      } catch (err) {
        failStreak += 1;
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        const code =
          err instanceof ApiError
            ? err.code
            : axios.isAxiosError(err)
              ? (err.response?.data as { code?: string } | undefined)?.code
              : undefined;
        const busy = code === 'society_busy' || status === 423;
        const tickTimeout =
          code === 'society_tick_timeout' || status === 503;
        const msg = err instanceof Error ? err.message : String(err);
        const timedOut =
          /timeout/i.test(msg) ||
          (axios.isAxiosError(err) && err.code === 'ECONNABORTED');
        const offline =
          /ECONNREFUSED|Network Error|Failed to fetch|ERR_CONNECTION/i.test(
            msg,
          ) ||
          (axios.isAxiosError(err) && !err.response) ||
          // Vite proxy returns empty 500 when :3847 is down
          (status === 500 &&
            (!axios.isAxiosError(err) ||
              !err.response?.data ||
              (typeof err.response.data === 'string' &&
                !err.response.data.trim()) ||
              (typeof err.response.data === 'object' &&
                !(err.response.data as { error?: string }).error)));
        if (offline) {
          setApiOffline(true);
          setTickBusy(false);
          setTickError(null);
          schedule(
            Math.min(
              30_000,
              Math.max(8_000, LIVE_TICK_MS * 2 ** Math.min(failStreak, 4)),
            ),
          );
        } else if (busy || tickTimeout || timedOut) {
          setApiOffline(false);
          setTickBusy(true);
          setTickBusyKind(busy ? 'busy' : 'slow');
          setTickError(null);
          if (busy) lastServerFrameAtRef.current = Date.now();
          const now = Date.now();
          if (!busy && now - lastSoftReloadAtRef.current > 8_000) {
            lastSoftReloadAtRef.current = now;
            void reloadSociety({ quiet: true, iframe: 'append' });
          }
          schedule(
            busy
              ? Math.min(12_000, 4_000 + failStreak * 800)
              : Math.min(12_000, 4_000 + failStreak * 1_000),
          );
        } else {
          setApiOffline(false);
          setTickBusy(false);
          setTickError(msg);
          schedule(LIVE_TICK_MS);
        }
      } finally {
        tickingRef.current = false;
      }
    };
    void tick();
    const onVis = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [
    isAuthor,
    role,
    projectId,
    livePaused,
    stageDead,
    observatoryDisabled,
    remountKey,
    loadAgent,
    pushAppendToIframe,
    reloadSociety,
    t,
  ]);

  const runSociety = async () => {
    if (!isAuthor || !projectId) return;
    if (observatoryDisabled) return;
    if (stageDead) {
      message.warning(t('product.obs.previewBroken'));
      return;
    }
    if (ffLoadingRef.current) return;
    ffLoadingRef.current = true;
    setFfLoading(true);
    setTickError(null);
    try {
      let lastEvents = 0;
      for (let step = 0; step < hours; step += 1) {
        const res = await api.world.societyRun(projectId, {
          hours: 1,
          sync: true,
        });
        lastEvents = res.events ?? lastEvents;
        if (res.report) setReport(res.report as EmergenceReport);
        await reloadSociety({ quiet: true, iframe: 'append' });
      }
      message.success(
        t('product.town.fastForwardDone', {
          count: String(lastEvents),
        }),
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      setTickError(err instanceof Error ? err.message : String(err));
    } finally {
      ffLoadingRef.current = false;
      setFfLoading(false);
    }
  };

  const hostGathering = async () => {
    if (!isAuthor || !projectId) return;
    if (talkDisabled) return;
    if (stageDead) {
      message.warning(t('product.obs.previewBroken'));
      return;
    }
    if (partyLoading) return;
    setPartyLoading(true);
    try {
      const fromSimTime =
        cursorRef.current > 0 ? cursorRef.current : simMax > 0 ? simMax : 0;
      const hubName =
        agentCard?.regionName ||
        agents.find((a) => a.regionName)?.regionName ||
        hubPlaceName(worldLike) ||
        t('product.obs.crossing');
      const lead =
        agentCard?.name ||
        agents[0]?.name ||
        anonymousLeadName(worldLike);
      const res = await api.world.societyIntervene(projectId, {
        fromSimTime,
        kind: 'whisper',
        text: worldLike
          ? gatheringSeedText(lead, worldLike)
          : worldCopyAscii({
              space: { regions: [{ id: 'hub', name: hubName }] },
            })
            ? `${lead} is gathering at ${hubName}`
            : `今晚在${hubName}聚会，大家都来。`,
      });
      message.success(t('product.obs.partyDone', { place: hubName }));
      if (res.live && res.delta?.length) {
        setSimMax(res.simTime);
        cursorRef.current = res.simTime;
        setCursor(res.simTime);
        if (res.objects?.length) setObjects(res.objects);
        if (res.relations?.length) setRelations(res.relations);
        if (res.agents) {
          setAgents((prev) => {
            const prevById = new Map(prev.map((p) => [p.id, p]));
            return res.agents!.map((a) => {
              const was = prevById.get(a.id);
              return townAgentFrom({
                id: a.id,
                name: a.name,
                currentAction: a.currentAction,
                regionId: a.regionId,
                areaId: (a as { areaId?: string }).areaId ?? was?.areaId,
                areaName: (a as { areaName?: string }).areaName ?? was?.areaName,
                regionName:
                  (a as { regionName?: string }).regionName ?? was?.regionName,
                goalPlace:
                  (a as { goalPlace?: string }).goalPlace ?? was?.goalPlace,
                goalReason:
                  (a as { goalReason?: string }).goalReason ?? was?.goalReason,
                drive: (a as { drive?: string }).drive ?? was?.drive,
                goalX: (a as { goalX?: number }).goalX ?? was?.goalX,
                goalY: (a as { goalY?: number }).goalY ?? was?.goalY,
                needs: clipNeeds((a as { needs?: unknown }).needs) ?? was?.needs,
              });
            });
          });
        }
        pushAppendToIframe({
          simTime: res.simTime,
          agents: res.agents,
          events: (res.delta ?? []).filter((e) => isMapEventKind(e.kind)),
          rumor: true,
          objects: res.objects ?? [],
        });
        const nameOf = (id: string) =>
          (res.agents ?? []).find((a) => a.id === id)?.name ?? id.slice(0, 8);
        const fresh = res.delta.flatMap((e) => talkLinesFromEvent(e, nameOf, talkOpts));
        if (fresh.length) setTalkLog((prev) => mergeTalkLog(prev, fresh));
      } else {
        await reloadSociety({ quiet: true, iframe: 'append' });
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPartyLoading(false);
    }
  };

  const setObjectState = async (objectId: string, objectState: string) => {
    if (!isAuthor || !projectId) return;
    const fromSimTime =
      cursorRef.current > 0 ? cursorRef.current : simMax > 0 ? simMax : 0;
    try {
      const res = await api.world.societyIntervene(projectId, {
        fromSimTime,
        kind: 'set_object',
        objectId,
        objectState,
      });
      if (res.objects?.length) setObjects(res.objects);
      else {
        setObjects((prev) =>
          prev.map((o) => (o.id === objectId ? { ...o, state: objectState } : o)),
        );
      }
      if (res.relations?.length) setRelations(res.relations);
      if (res.agents) {
        setAgents(
          res.agents.map((a) =>
            townAgentFrom({
              id: a.id,
              name: a.name,
              currentAction: a.currentAction,
              regionId: a.regionId,
              areaId: (a as { areaId?: string }).areaId,
              areaName: (a as { areaName?: string }).areaName,
              regionName: (a as { regionName?: string }).regionName,
              goalPlace: (a as { goalPlace?: string }).goalPlace,
              goalReason: (a as { goalReason?: string }).goalReason,
              drive: (a as { drive?: string }).drive,
              goalX: (a as { goalX?: number }).goalX,
              goalY: (a as { goalY?: number }).goalY,
              needs: clipNeeds((a as { needs?: unknown }).needs),
              padded: (a as { padded?: boolean }).padded,
            }),
          ),
        );
      }
      setHighlightedObjectId(objectId);
      setInspectorKeys((prev) =>
        prev.includes('objects') ? prev : [...prev, 'objects'],
      );
      if (res.focusAgentId) {
        setSelectedAgent(res.focusAgentId);
        void loadAgent(res.focusAgentId);
      }
      if (res.live && res.delta?.length) {
        pushAppendToIframe({
          simTime: res.simTime,
          agents: res.agents,
          objects: res.objects ?? objects.map((o) =>
            o.id === objectId ? { ...o, state: objectState } : o,
          ),
          events: res.delta.filter((e) => isMapEventKind(e.kind)),
          focusAgentId: res.focusAgentId,
        });
      }
      message.success(`${t('product.obs.setObject')}: ${objectState}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!highlightedObjectId) return;
    const el = document.getElementById(`town-obj-${highlightedObjectId}`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlightedObjectId, inspectorKeys]);

  const togglePin = () => {
    if (!selectedAgent) {
      message.warning(t('product.obs.interviewNeedAgent'));
      return;
    }
    const next = pinnedAgent === selectedAgent ? null : selectedAgent;
    setPinnedAgent(next);
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: MSG_PIN,
        payload: { agentId: selectedAgent, pinned: Boolean(next) },
      },
      '*',
    );
  };

  const applyPlaybackSpeed = (speed: number) => {
    playbackSpeedRef.current = speed;
    setPlaybackSpeed(speed);
    iframeRef.current?.contentWindow?.postMessage(
      { type: MSG_SET_SPEED, payload: { speed } },
      '*',
    );
  };

  const playThisDay = () => {
    if (observatoryDisabled) return;
    const dayStart = Math.floor(Math.max(0, cursor) / 24) * 24;
    applyPlaybackSpeed(4);
    iframeRef.current?.contentWindow?.postMessage(
      { type: MSG_SCRUB, payload: { cursor: dayStart, playing: true } },
      '*',
    );
    iframeRef.current?.contentWindow?.postMessage(
      { type: MSG_SET_PLAYING, payload: { playing: true } },
      '*',
    );
  };

  const saveMoment = () => {
    if (observatoryDisabled) return;
    const line =
      talkLog[talkLog.length - 1]?.text ??
      agentCard?.currentAction ??
      whyLine({
        goalPlace: agentCard?.goalPlace,
        goalReason: agentCard?.goalReason,
        drive: agentCard?.drive,
        currentAction: agentCard?.currentAction,
        t,
      }) ??
      clockLabel(cursor);
    const row = {
      simTime: cursor,
      agentId: selectedAgent ?? undefined,
      name: agentCard?.name,
      line,
    };
    const next = [row, ...moments].slice(0, 12);
    setMoments(next);
    try {
      window.localStorage.setItem(
        `opengame-obs-moment-${stageKey}`,
        JSON.stringify(next),
      );
    } catch {
      /* private mode */
    }
    message.success(t('product.obs.snapshotDone'));
  };

  const intervene = async () => {
    if (!isAuthor || !projectId) return;
    if (talkDisabled) return;
    if (!whisper.trim()) {
      message.warning(t('product.obs.whisperPlaceholder'));
      return;
    }
    setWhisperLoading(true);
    try {
      const fromSimTime =
        cursorRef.current > 0
          ? cursorRef.current
          : simMax > 0
            ? simMax
            : 0;
      const payload = {
        fromSimTime,
        kind: 'whisper' as const,
        agentKey: selectedAgent ?? undefined,
        text: whisper.trim(),
      };
      let res: Awaited<ReturnType<typeof api.world.societyIntervene>> | null =
        null;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          res = await api.world.societyIntervene(projectId, payload);
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err;
          const status = axios.isAxiosError(err)
            ? err.response?.status
            : undefined;
          const code =
            err instanceof ApiError
              ? err.code
              : axios.isAxiosError(err)
                ? (err.response?.data as { code?: string } | undefined)?.code
                : undefined;
          const busy = code === 'society_busy' || status === 423;
          if (!busy || attempt === 3) throw err;
          await new Promise((r) => setTimeout(r, 1200 + attempt * 800));
        }
      }
      if (!res) throw lastErr ?? new Error('intervene failed');
      message.success(
        res.rumor ? t('product.obs.rumorDone') : t('product.obs.intervene'),
      );
      const heard = whisper.trim();
      const speaker =
        (selectedAgent
          ? agents.find((agent) => agent.id === selectedAgent)?.name
          : undefined) || (res.rumor ? '全镇' : '你');
      setTalkLog((prev) =>
        mergeTalkLog(prev, [
          {
            id: `heard-${fromSimTime}-${heard.slice(0, 24)}`,
            eventId: `heard-${fromSimTime}-${heard.slice(0, 24)}`,
            turnIndex: 0,
            simTime: Math.max(fromSimTime, simMax),
            kind: 'intervene',
            who: speaker,
            text: heard,
          },
        ]),
      );
      setInspectorKeys((keys) => (keys.includes('talk') ? keys : [...keys, 'talk']));
      setStageCaption(`${speaker}：${heard}`);
      setWhisper('');
      if (res.live && res.delta?.length) {
        setSimMax(res.simTime);
        cursorRef.current = res.simTime;
        setCursor(res.simTime);
        setEventCount((n) => n + res.delta!.length);
        if (typeof res.llm === 'boolean') setLlmLive(res.llm);
        if (typeof res.degraded === 'boolean') setDegraded(res.degraded);
        if (res.skipReason) setSkipReason(res.skipReason);
        if (res.dialogueKind) setDialogueKind(res.dialogueKind);
        if (typeof res.retrievalDegraded === 'boolean') {
          setRetrievalDegraded(res.retrievalDegraded);
        }
        if (res.relations?.length) setRelations(res.relations);
        if (res.objects?.length) setObjects(res.objects);
        if (res.agents) {
          setAgents(
            res.agents.map((a) =>
              townAgentFrom({
                id: a.id,
                name: a.name,
                currentAction: a.currentAction,
                regionId: a.regionId,
                areaId: (a as { areaId?: string }).areaId,
                areaName: (a as { areaName?: string }).areaName,
                regionName: (a as { regionName?: string }).regionName,
                goalPlace: (a as { goalPlace?: string }).goalPlace,
                goalReason: (a as { goalReason?: string }).goalReason,
                drive: (a as { drive?: string }).drive,
                goalX: (a as { goalX?: number }).goalX,
                goalY: (a as { goalY?: number }).goalY,
                needs: clipNeeds((a as { needs?: unknown }).needs),
              }),
            ),
          );
        }
        pushAppendToIframe({
          simTime: res.simTime,
          agents: res.agents,
          events: (res.delta ?? []).filter((e) => isMapEventKind(e.kind)),
          focusAgentId: res.focusAgentId,
          rumor: res.rumor,
          objects: res.objects ?? [],
        });
        const nameOf = (id: string) =>
          (res.agents ?? []).find((a) => a.id === id)?.name ?? id.slice(0, 8);
        const fresh = res.delta.flatMap((e) => talkLinesFromEvent(e, nameOf, talkOpts));
        if (fresh.length) setTalkLog((prev) => mergeTalkLog(prev, fresh));
        const focus = res.focusAgentId ?? selectedAgent;
        if (focus) void loadAgent(focus);
      } else {
        await reloadSociety();
        if (selectedAgent) void loadAgent(selectedAgent);
      }
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const code =
        err instanceof ApiError
          ? err.code
          : axios.isAxiosError(err)
            ? (err.response?.data as { code?: string } | undefined)?.code
            : undefined;
      if (code === 'society_busy' || status === 423) {
        message.warning(t('product.obs.societyBusy'));
      } else {
        message.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setWhisperLoading(false);
    }
  };

  const regionPlaces = [
    ...new Set(
      agents
        .map((a) => a.regionId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const shopPlaces = ownedPlacesOf(agents, objects);
  const parentBgmUrl = previewUrl
    ? previewSiblingAssetUrl(previewUrl, 'assets/bgm.mp3')
    : null;

  const focusRegion = (regionId?: string) => {
    if (!regionId) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: MSG_FOCUS_REGION, payload: { regionId } },
      '*',
    );
  };

  const playParentBgm = async (): Promise<boolean> => {
    if (!parentBgmUrl) return false;
    let el = parentBgmRef.current;
    if (!el) {
      el = new Audio();
      el.loop = true;
      el.preload = 'auto';
      el.onerror = () => {
        parentBgmPlayingRef.current = false;
        setBgmLoaded(false);
        setBgmNeedsGesture(false);
      };
      parentBgmRef.current = el;
    }
    el.volume = 0.22;
    if (el.dataset.ogSrc !== parentBgmUrl) {
      el.src = parentBgmUrl;
      el.dataset.ogSrc = parentBgmUrl;
    }
    try {
      await el.play();
      parentBgmPlayingRef.current = true;
      setBgmLoaded(true);
      setBgmNeedsGesture(false);
      setBgmMuted(false);
      iframeRef.current?.contentWindow?.postMessage(
        { type: MSG_BGM, payload: { action: 'mute' } },
        '*',
      );
      return true;
    } catch {
      parentBgmPlayingRef.current = false;
      setBgmNeedsGesture(true);
      return false;
    }
  };

  const pauseParentBgm = () => {
    parentBgmPlayingRef.current = false;
    parentBgmRef.current?.pause();
    setBgmMuted(true);
    iframeRef.current?.contentWindow?.postMessage(
      { type: MSG_BGM, payload: { action: 'mute' } },
      '*',
    );
  };

  const visibleMemories = useMemo(
    () => visibleMemoriesOf(memories, memoryFilter),
    [memories, memoryFilter],
  );

  const talkGroups = useMemo(() => {
    const groups: Array<{
      id: string;
      simTime: number;
      kind: string;
      talkSeq?: number;
      circleIndex?: number;
      lines: TalkLine[];
    }> = [];
    const index = new Map<string, number>();
    for (const line of talkLog) {
      const hit = index.get(line.eventId);
      if (hit == null) {
        index.set(line.eventId, groups.length);
        groups.push({
          id: line.eventId,
          simTime: line.simTime,
          kind: line.kind,
          talkSeq: line.talkSeq,
          circleIndex: line.circleIndex,
          lines: [line],
        });
      } else {
        groups[hit]!.lines.push(line);
      }
    }
    const built = groups.map((group) => ({
      ...group,
      lines: [...group.lines].sort((a, b) => a.turnIndex - b.turnIndex),
    }));
    return orderTalkGroups(built, liveTalkSeq);
  }, [talkLog, liveTalkSeq]);

  const iframeSrc = previewUrl
    ? withObserveMode(
        withPreviewBustParam(previewUrl, String(remountKey)),
        !isAuthor,
      )
    : '';

  const livingRumor =
    report?.informationSpread.seedText?.trim() ||
    talkLog.find((l) => l.kind === 'intervene')?.text;
  const buildingRumor = generatingRumorLine(worldLike);
  const buildingOverlay = buildingRumor
    ? t('generate.preview.worldBuildingRumor', { rumor: buildingRumor })
    : t('generate.preview.worldBuildingOverlay');

  const honestyKey = clockHonestyKey({
    skipReason,
    dialogueKind,
    llm: llmLive,
    degraded,
    authorPaused: authorClockPaused,
    joining: !isAuthor && !presenceAcked && !townLiving,
    isGenerating,
  });
  const guestHonesty = guestTownHonestyKey({
    clockPaused: authorClockPaused,
    presenceAcked,
    living: townLiving,
    speaking: townSpeaking,
    skipReason,
    isGenerating,
  });
  const generateQuiet = townTalkQuietOverlay({
    isGenerating,
    skipReason,
    livePaused,
    authorClockPaused,
    isAuthor,
  });

  const latestDialogueTime = talkGroups.reduce((max, g) => {
    if (g.kind !== 'dialogue') return max;
    return Math.max(max, g.simTime);
  }, -1);
  const parallelTalkCount = talkGroups.filter(
    (g) =>
      g.kind === 'dialogue' &&
      latestDialogueTime >= 0 &&
      Math.abs(g.simTime - latestDialogueTime) <= 0.3,
  ).length;
  const listeningCurrent =
    liveCircleIndex ??
    talkGroups.find((g) => g.talkSeq === liveTalkSeq)?.circleIndex ??
    0;
  const listeningOf =
    listeningTotal ||
    parallelTalkCount ||
    talkGroups.filter((g) => g.kind === 'dialogue').length;

  const [guideOpen, setGuideOpen] = useState(() => {
    try {
      const key = isAuthor
        ? 'og-society-guide-dismissed'
        : 'og-society-guest-guide-v1';
      return localStorage.getItem(key) !== '1';
    } catch {
      return true;
    }
  });

  const stageFace = previewStageFace({
    previewUrl,
    bundleReady,
    isGenerating,
    settling: previewSettling,
    broken: Boolean(previewBroken),
    iframeReady,
    phaserLive,
    confirmedByIframe: confirmedBroken,
  });
  const draftBanner =
    isGenerating && previewUrl
      ? assetProgress
        ? t('preview.diag.draftLive', {
            done: String(assetProgress.done),
            total: String(assetProgress.total),
          })
        : t('preview.diag.draftLiveGeneric')
      : null;
  const brokenRetryKind = previewRetryKind({
    reason: asPreviewReason(previewBroken),
    isGenerating,
    settling: previewSettling,
    generateFailed,
    leaseAttempts: leaseRefreshAttempts,
  });

  const statusHint = stageFace === 'broken'
    ? t('product.obs.previewBroken')
    : stageFace === 'baking'
      ? t(
          previewSettling && !isGenerating
            ? 'preview.diag.settling'
            : 'preview.diag.baking',
        )
    : authorClockPaused
    ? t('product.obs.authorPaused')
    : apiOffline
    ? null
    : tickError
      ? null
      : userStoppedClock
        ? t(isAuthor ? 'product.obs.clockStopped' : 'product.obs.viewPaused')
        : livePaused
          ? (() => {
              const key = livePausedHintKey({
                role,
                iframeReady,
                userStopped: userStoppedClock,
              });
              return key ? t(key) : null;
            })()
          : tickBusy
            ? tickBusyKind === 'busy'
              ? t('product.obs.societyBusy')
              : t('product.obs.tickSlow')
            : ffLoading
              ? t('product.obs.ffBusy', { hours: String(hours) })
              : honestyKey
                ? t(honestyKey)
                : null;

  const permitLeft = permitRemainParts(leaseRemainingMs(townTimeUntil, leaseNow));
  const permitHint = !isAuthor
    ? ''
    : permitLeft.kind === 'none'
      ? t('product.obs.guestPermitNone')
      : permitLeft.kind === 'days'
        ? t('product.obs.guestPermitDays', { days: String(permitLeft.days) })
        : permitLeft.kind === 'hours'
          ? t('product.obs.guestPermitHours', {
              hours: String(permitLeft.hours),
              minutes: String(permitLeft.minutes ?? 0),
            })
          : t('product.obs.guestPermitMinutes', {
              minutes: String(permitLeft.minutes),
            });
  const lightLine = worldLightUntilLine({
    litUntil: talkBudget?.litUntil,
    litBonus: talkBudget?.litBonus,
    now: leaseNow,
  });
  const lightHint = !lightLine
    ? t('product.obs.lightNone')
    : lightLine.key === 'thisHour'
      ? t('product.obs.worldLightThisHour')
      : lightLine.key === 'minutes'
        ? t('product.obs.worldLightRemainMinutes', {
            minutes: String(lightLine.minutes),
          })
        : lightLine.key === 'hours'
          ? t('product.obs.worldLightRemainHours', {
              hours: String(lightLine.hours),
              minutes: String(lightLine.minutes),
            })
          : t('product.obs.worldLightRemainDays', {
              days: String(lightLine.days),
            });
  const onGuestTownMoved = (info?: {
    townTimeUntil?: string | null;
    lamp?: TownLamp | null;
    contributors?: TownContributor[];
    watcherCount?: number;
    talkBudget?: unknown;
    lightUntil?: string | null;
    lightBonusPerHour?: number;
  }): void => {
    if (info?.townTimeUntil) {
      setTownTimeUntil(info.townTimeUntil);
      setSkipReason((prev) => (prev === 'no_permit' ? null : prev));
    }
    if (info?.talkBudget) {
      const view = readTalkBudget(info.talkBudget);
      setTalkBudget(view);
      if (shouldClearBudgetMute(view)) {
        setSkipReason((prev) =>
          prev === 'budget' || prev === 'keys_exhausted' ? null : prev,
        );
      }
    }
    const litView = info?.talkBudget
      ? readTalkBudget(info.talkBudget)
      : null;
    const flashBonus =
      litView?.litBonus || info?.lightBonusPerHour || 0;
    if (flashBonus > 0) {
      setLightFlash({
        name: t('product.obs.worldLightOk'),
        bonus: flashBonus,
      });
    }
    if (info?.lamp) {
      setTownLamp(info.lamp);
      setLampFlash(info.lamp);
    }
    if (info?.lightUntil) {
      const until = info.lightUntil;
      setTalkBudget((prev) => (prev ? { ...prev, litUntil: until } : prev));
      setSkipReason((prev) => (prev === 'budget' ? null : prev));
    }
    if (info?.contributors) setTownContributors(info.contributors);
    if (info?.watcherCount != null) setWatcherCount(info.watcherCount);
    guestDesk?.onWhispered?.();
    void (async () => {
      if (gameId) {
        try {
          await api.community.presence(gameId, { tab: societyWatchTabId() });
        } catch {
          /* next presence ping retries */
        }
      }
      await reloadSociety({ quiet: true, iframe: 'append' });
    })();
  };

  useEffect(() => {
    const until = guestDesk?.lightUntil;
    if (!until) return;
    setTalkBudget((prev) => (prev ? { ...prev, litUntil: until } : prev));
    setSkipReason((prev) =>
      prev === 'budget' || prev === 'no_permit' ? null : prev,
    );
  }, [guestDesk?.lightUntil]);

  const [courseKeepAlive, setCourseKeepAlive] = useState(false);
  const [courseBoard, setCourseBoard] = useState<CourseBoard | null>(null);
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [opsOpen, setOpsOpen] = useState<string[]>([]);
  const budgetTone = talkBudgetTone(talkBudget);
  const lightUrge = featureFlags.demoOpenWorld
    ? false
    : urgeWorldLight(budgetTone, courseKeepAlive);
  const talkBudgetHint = !isAuthor
    ? courseKeepAlive
      ? t('product.obs.course.keepAlive')
      : t('product.obs.guestWatchHint')
    : t('product.obs.sharedTalk');
  const authorCourseLabel = courseBoard?.current
    ? `${t('product.obs.course.authorTitle')} · ${
        courseDeskClockLine(t, courseBoard.current) ??
        t(coursePhaseCopyKey(courseBoard.current.status))
      }`
    : t('product.obs.course.authorTitle');
  const authorPulses = isAuthor
    ? authorTownPulses({
        paused: authorClockPaused,
        funded:
          featureFlags.demoOpenWorld ||
          leaseActive(talkBudget?.litUntil, leaseNow),
        hasBoard: Boolean(courseBoard?.current),
      })
    : [];
  const evidenceHud = courseBoard?.current
    ? courseEvidenceHudState(courseBoard.current, talkLog)
    : null;

  // A stage that paces its own speech tells us which line is on screen; older
  // published worlds do not, so they keep showing the newest log line.
  const latestTalk = talkLog[talkLog.length - 1];
  const bottomCaption = stagePacesSpeech.current
    ? stageCaption
    : latestTalk
      ? overlayTalkText(latestTalk, t, locale)
      : null;

  useEffect(() => {
    onTownLiveChange?.({
      living: authorClockPaused ? false : townLiving,
      speaking: authorClockPaused ? false : townSpeaking,
      watcherCount,
      lamp: townLamp,
      clockPaused: authorClockPaused,
      honestyKey: isAuthor ? honestyKey ?? guestHonesty : guestHonesty,
    });
  }, [
    onTownLiveChange,
    isAuthor,
    authorClockPaused,
    townLiving,
    townSpeaking,
    watcherCount,
    townLamp,
    honestyKey,
    guestHonesty,
  ]);

  useEffect(() => {
    onCourseContextChange?.({ talks: talkLog, liveNudge: courseLiveNudge });
  }, [onCourseContextChange, talkLog, courseLiveNudge]);

  useEffect(() => {
    if (courseHost !== 'page' || !pageCourseBoard) return;
    setCourseBoard((prev) => mergeCourseBoardPoll(prev, pageCourseBoard));
    setCourseKeepAlive(courseKeepAliveNeeded(pageCourseBoard));
  }, [courseHost, pageCourseBoard]);

  useEffect(() => {
    if (!featureFlags.courseMarket || !gameId) return;
    if (
      !stageOwnsCoursePoll({
        courseHost,
        courseDeskActive,
      })
    ) {
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const pageHosts = courseHost === 'page';
    const pull = (): void => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (inFlight) return;
      inFlight = true;
      void api.community
        .course(gameId, { ensure: pageHosts ? false : isAuthor })
        .then((next) => {
          if (cancelled) return;
          setCourseBoard((prev) => mergeCourseBoardPoll(prev, next));
          setCourseKeepAlive(courseKeepAliveNeeded(next));
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    pull();
    const pollMs = pageHosts
      ? PAGE_IDLE_COURSE_POLL_MS
      : STAGE_EMBEDDED_COURSE_POLL_MS;
    const timer = window.setInterval(pull, pollMs);
    const onVis = (): void => {
      if (typeof document !== 'undefined' && document.hidden) return;
      pull();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [gameId, isAuthor, courseHost, courseDeskActive]);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        width: '100%',
        height: '100%',
        maxHeight: '100%',
        display: 'grid',
        gridTemplateColumns: compact || !showInspector
          ? '1fr'
          : 'minmax(0, 1fr) minmax(300px, 380px)',
        gridTemplateRows: compact && showInspector
          ? 'minmax(200px, 1fr) minmax(260px, 42%)'
          : 'minmax(0, 1fr)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          minWidth: 0,
          minHeight: 0,
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
          background: '#000',
        }}
      >
        {(isAuthor && compact) || (!isAuthor && !compact) ? (
          <div
            className={`og-town-guest-status${authorClockPaused ? ' is-paused' : ''}`}
          >
            {isAuthor ? t(honestyKey ?? 'product.obs.authorCostHint') : t(guestHonesty)}
          </div>
        ) : null}
        <SocietyTownCourseClockHud
          townClock={clockLabel(cursor)}
          gameId={gameId}
          projectId={projectId}
          talks={talkLog}
          board={courseBoard}
          offsetTop={(isAuthor && compact) || (!isAuthor && !compact) ? 48 : 10}
        />
        {draftBanner && stageFace !== 'baking' && stageFace !== 'broken' ? (
          <div
            style={{
              position: 'absolute',
              top: (isAuthor && compact) || (!isAuthor && !compact) ? 48 : 10,
              left: 12,
              right: 12,
              zIndex: 4,
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--text-primary)',
              background: 'color-mix(in srgb, var(--bg-card) 92%, transparent)',
              border: '1px solid var(--border-color)',
              pointerEvents: 'none',
            }}
          >
            {draftBanner}
          </div>
        ) : null}
        <SocietyTownMapFace
          face={stageFace}
          t={t}
          previewSettling={previewSettling}
          isGenerating={isGenerating}
          previewUrl={previewUrl}
          buildingOverlay={buildingOverlay}
          previewProbe={previewProbe}
          previewBroken={previewBroken}
          brokenRetryKind={brokenRetryKind}
          onRetryFailedJob={onRetryFailedJob}
          onRefreshPreview={onRefreshPreview}
          markLeaseAttempt={markLeaseAttempt}
          isAuthor={isAuthor}
          rebuildPresenter={rebuildPresenter}
          iframeRef={iframeRef}
          remountKey={remountKey}
          iframeSrc={iframeSrc}
          iframePrep={iframePrep}
          onLoadMap={() => setIframeReady(true)}
          onIframeLoad={() => {
            hydrateIframeReplay(false);
            if (hydrateRetryTimerRef.current != null) {
              window.clearTimeout(hydrateRetryTimerRef.current);
            }
            hydrateRetryTimerRef.current = window.setTimeout(() => {
              hydrateRetryTimerRef.current = null;
              hydrateIframeReplay(false);
            }, 400);
          }}
        />
        {isAuthor && lightFlash ? (
          <div
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 12,
              zIndex: 8,
              pointerEvents: 'none',
              background: '#0c4a6eee',
              color: '#e0f2fe',
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.55,
              border: '1px solid #38bdf888',
            }}
          >
            {t('product.obs.worldLightFlash', {
              name: lightFlash.name,
              n: String(lightFlash.bonus),
            })}
          </div>
        ) : isAuthor && lampFlash ? (
          <div
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 12,
              zIndex: 8,
              pointerEvents: 'none',
              background: lampFlash.sku === 'month' ? '#7c2d12ee' : '#422006ee',
              color: '#fde68a',
              padding: lampFlash.sku === 'month' ? '14px 16px' : '10px 14px',
              borderRadius: 8,
              fontSize: lampFlash.sku === 'month' ? 16 : 13,
              lineHeight: 1.55,
              border: '1px solid #f59e0a88',
            }}
          >
            {t('product.obs.lampFlash', {
              name: lampFlash.displayName,
              title: t(townLampTitleKey(lampFlash.sku)),
              until: new Date(lampFlash.townTimeUntil).toLocaleString(),
            })}
          </div>
        ) : ffLoading ? (
          <div
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 12,
              zIndex: 3,
              pointerEvents: 'none',
              background: '#1e3a8add',
              color: '#f8fafc',
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            {t('product.obs.ffBusy', { hours: String(hours) })}
          </div>
        ) : generateQuiet ? (
          <div
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 12,
              zIndex: 6,
              pointerEvents: 'none',
              background: '#422006ee',
              color: '#fde68a',
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.55,
              border: '1px solid #f59e0a88',
            }}
          >
            {t(generateQuiet.key)}
          </div>
        ) : authorClockPaused ? (
          <div
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 12,
              zIndex: 4,
              pointerEvents: 'none',
              background: '#422006ee',
              color: '#fde68a',
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.55,
              border: '1px solid #f59e0a88',
            }}
          >
            <div>{t('product.obs.authorPaused')}</div>
            <div style={{ marginTop: 4, fontSize: 12, color: '#fbbf24' }}>
              {t('product.obs.authorPausedHint')}
            </div>
          </div>
        ) : ((!featureFlags.demoOpenWorld &&
            (skipReason === 'no_permit' || skipReason === 'budget')) ||
          skipReason === 'keys_exhausted') ? (
          isAuthor ? (
          <button
            type="button"
            onClick={() => {
              // SocietyTownLightDesk 嵌在 ops Collapse 里，默认折叠不渲染。
              // 不先展开的话 scrollToWorldLightDesk 找不到 id，等于无反应。
              setOpsOpen((prev) => (prev.includes('ops') ? prev : ['ops']));
              window.setTimeout(() => scrollToWorldLightDesk(), 80);
            }}
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 12,
              zIndex: 3,
              pointerEvents: 'auto',
              cursor: 'pointer',
              border: '1px solid #38bdf888',
              background: '#0c4a6eee',
              color: '#e0f2fe',
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.55,
              textAlign: 'left',
              minHeight: 48,
            }}
          >
            <div>
              {t(
                skipReason === 'keys_exhausted'
                  ? 'product.obs.llmKeysExhausted'
                  : 'product.obs.authorTalkEmpty',
              )}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: '#7dd3fc' }}>
              {t('product.obs.worldLightCta')} →
            </div>
          </button>
          ) : (
            <div
              style={{
                position: 'absolute',
                left: 12,
                right: 12,
                bottom: 12,
                zIndex: 3,
                pointerEvents: 'none',
                background: '#0c4a6eee',
                color: '#e0f2fe',
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              {t(guestMuteOverlayKey(skipReason) ?? 'product.obs.talkFloorEmpty')}
            </div>
          )
        ) : hoverIntent ? (
          <div
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 12,
              zIndex: 3,
              pointerEvents: 'none',
              background: '#422006dd',
              color: '#fde68a',
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            {t('product.obs.hoverIntent', {
              name: hoverIntent.name,
              action: hoverIntent.action || '…',
            })}
          </div>
        ) : !isAuthor && livePaused ? (
          <div
            style={{
              position: 'absolute',
              left: 12,
              right: 'auto',
              bottom: 12,
              maxWidth: 'min(420px, 56%)',
              zIndex: 5,
              pointerEvents: 'none',
              background: '#0f172add',
              color: '#f8fafc',
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            {t('product.obs.viewPaused')}
          </div>
        ) : bottomCaption || evidenceHud?.hitLabels.length || evidenceHud?.showMuted ? (
          <div
            className={
              evidenceHud?.hitLabels.length
                ? 'og-course-hit-flash'
                : evidenceHud?.showMuted
                  ? 'og-course-hit-flash is-muted'
                  : undefined
            }
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              top: 12,
              bottom: 'auto',
              maxWidth: 'none',
              zIndex: 4,
              pointerEvents: 'none',
              background: '#0f172aee',
              color: '#f8fafc',
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 16,
              lineHeight: 1.4,
            }}
          >
            {evidenceHud?.hitLabels.length
              ? t('product.obs.course.hit', {
                  label: evidenceHud.hitLabels.join(' / '),
                })
              : evidenceHud?.showMuted
                ? t('product.obs.course.evidenceHealth.muted')
                : bottomCaption}
          </div>
        ) : null}
        {!isAuthor ? (
          <div className="og-town-guest-chrome">
            <button
              type="button"
              className="og-town-guest-chrome__btn"
              disabled={observatoryDisabled}
              onClick={() =>
                toggleTownClock(!livePaused, {
                  resumeShared: false,
                })
              }
            >
              {livePaused
                ? t('product.obs.liveResumeView')
                : t('product.obs.livePauseLocal')}
            </button>
            {!compact && featureFlags.courseMarket && !embedCourseOnStage ? (
              <button
                type="button"
                className="og-town-guest-chrome__btn og-town-guest-chrome__btn--stake"
                onClick={() => scrollToCourseDesk()}
              >
                {t(guestCourseChromeKey(courseBoard?.current?.status))}
              </button>
            ) : null}
          </div>
        ) : featureFlags.courseMarket || authorPulses.length > 0 ? (
          <div className="og-town-guest-chrome">
            {authorPulses.includes('paused') ? (
              <button
                type="button"
                className="og-town-guest-chrome__btn og-course-author-pulse"
                onClick={() =>
                  toggleTownClock(false, { resumeShared: true })
                }
              >
                {t('product.obs.pulse.paused')}
              </button>
            ) : null}
            {authorPulses.includes('fund') ? (
              <button
                type="button"
                className="og-town-guest-chrome__btn og-course-author-pulse"
                onClick={() => {
                  setOpsOpen(['ops']);
                  window.setTimeout(() => scrollToWorldLightDesk(), 80);
                }}
              >
                {t('product.obs.pulse.fund')}
              </button>
            ) : null}
            {featureFlags.courseMarket ? (
              <button
                type="button"
                className={`og-town-guest-chrome__btn og-town-guest-chrome__btn--stake${
                  authorPulses.includes('seed') ? ' og-course-author-pulse' : ''
                }`}
                onClick={() => setCourseModalOpen(true)}
              >
                {authorCourseLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {showInspector ? (
      <div
        style={{
          minWidth: compact ? 0 : 300,
          maxWidth: compact ? 'none' : 380,
          width: '100%',
          borderLeft: compact ? 'none' : '1px solid var(--border-color)',
          borderTop: compact ? '1px solid var(--border-color)' : undefined,
          background: 'var(--bg-card)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {observatoryLocked ? (
        <div style={{ padding: 16 }}>
          <Text strong>{t('product.obs.title')}</Text>
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            title={
              isGenerating
                ? t('generate.preview.pipelineWorldGenerateTitle')
                : t('product.obs.lockedTitle')
            }
            description={
              isGenerating
                ? buildingOverlay
                : t('product.obs.lockedDesc')
            }
          />
        </div>
        ) : (
        <>
        <div style={{ padding: '12px 12px 8px', flexShrink: 0 }}>
          <Space orientation="vertical" style={{ width: '100%' }} size={6}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
              <Text strong>{t('product.obs.title')}</Text>
              <Space size={4} wrap>
                {isAuthor && featureFlags.courseMarket ? (
                  <Button
                    type="primary"
                    size="small"
                    className={
                      authorPulses.includes('seed') ? 'og-course-author-pulse' : undefined
                    }
                    onClick={() => setCourseModalOpen(true)}
                  >
                    {authorCourseLabel}
                  </Button>
                ) : null}
                <Button
                  size="small"
                  disabled={observatoryDisabled}
                  onClick={() =>
                    toggleTownClock(!livePaused, {
                      resumeShared: Boolean(livePaused && isAuthor),
                    })
                  }
                >
                  {livePaused
                    ? t(isAuthor ? 'product.obs.liveResume' : 'product.obs.liveResumeView')
                    : isAuthor
                      ? t('product.obs.livePause')
                      : t('product.obs.livePauseLocal')}
                </Button>
                {caps.canFastForward ? (
                <Segmented
                  size="small"
                  title={t('product.obs.playback')}
                  disabled={observatoryDisabled}
                  value={playbackSpeed}
                  options={[
                    { label: '1×', value: 1 },
                    { label: '2×', value: 2 },
                    { label: '4×', value: 4 },
                  ]}
                  onChange={(v) => applyPlaybackSpeed(Number(v))}
                />
                ) : null}
                <Button
                  size="small"
                  icon={<SoundOutlined />}
                  type={bgmMuted ? 'default' : 'primary'}
                  ghost={!bgmMuted}
                  disabled={observatoryDisabled}
                  onClick={() => {
                    const playingHere = parentBgmPlayingRef.current;
                    if (playingHere && !bgmMuted && !bgmNeedsGesture) {
                      pauseParentBgm();
                      return;
                    }
                    void playParentBgm().then((ok) => {
                      if (ok) return;
                      iframeRef.current?.contentWindow?.postMessage(
                        {
                          type: MSG_BGM,
                          payload: { action: bgmNeedsGesture ? 'play' : 'unmute' },
                        },
                        '*',
                      );
                    });
                  }}
                >
                  {bgmNeedsGesture
                    ? t('product.obs.bgmClick')
                    : bgmMuted
                      ? t('product.obs.bgmOff')
                      : bgmLoaded
                        ? t('product.obs.bgmOn')
                        : t('product.obs.bgmMissing')}
                </Button>
              </Space>
            </Space>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {!isAuthor ? t(guestHonesty) : t('product.obs.authorCostHint')}
            </Text>
            {isAuthor ? (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {`${lightHint} · ${t('product.obs.sharedTalk')}`}
              </Text>
            ) : !isAuthor && courseKeepAlive ? (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('product.obs.course.keepAlive')}
              </Text>
            ) : null}
          </Space>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 12px 12px' }}>
          <Space orientation="vertical" style={{ width: '100%' }} size={6}>
            <SocietyTownObserveAlerts
              isGenerating={isGenerating}
              previewUrl={previewUrl}
              guideOpen={isAuthor && guideOpen}
              isAuthor={isAuthor}
              assetDone={assetProgress?.done}
              assetTotal={assetProgress?.total}
              onCloseGuide={() => {
                setGuideOpen(false);
                try {
                  localStorage.setItem(
                    isAuthor
                      ? 'og-society-guide-dismissed'
                      : 'og-society-guest-guide-v1',
                    '1',
                  );
                } catch {
                  /* ignore */
                }
              }}
            />
            {isAuthor ? (
            <SocietyObservatoryStats
              clockLabel={clockLabel(cursor)}
              seedHours={report?.seed?.hours}
              spreadLabel={
                report ? `${Math.round(report.informationSpread.rate * 100)}%` : '—'
              }
              realDialogues={
                report?.seed?.dialogues ??
                talkLog.filter((l) => l.kind === 'dialogue' && !l.degraded).length
              }
              liveTalks={talkLog.filter((l) => l.kind === 'dialogue').length}
              seedDegraded={societySeedUsedFallback(report?.seed)}
              retrievalDegraded={Boolean(
                report?.seed?.retrievalDegraded || retrievalDegraded,
              )}
              seedDegradedText={t('product.obs.seedDegraded')}
              retrievalDegradedText={t('product.obs.retrievalDegraded')}
              seedHoursText={t('product.obs.seedHours')}
              spreadText={t('product.obs.spread')}
              realDialoguesText={t('product.obs.realDialogues')}
              liveTalkText={t('product.obs.liveTalk')}
              demand={
                selectedAgent && agentCard
                  ? driveLabelOf(agentCard.drive, t) ||
                    whyLine({
                      goalPlace: agentCard.goalPlace,
                      goalReason: agentCard.goalReason,
                      drive: agentCard.drive,
                      currentAction: agentCard.currentAction,
                      t,
                    })?.slice(0, 32) ||
                    agentCard.currentAction?.slice(0, 32) ||
                    null
                  : null
              }
              surprise={
                selectedAgent && agentCard?.needs
                  ? `${Math.round(agentCard.needs.curiosity * 100)}%`
                  : null
              }
              citedMemoryIds={interviewA?.citedMemoryIds}
            />
            ) : null}
            {isAuthor ? (
            <Space size={8} wrap>
              {agents.filter((a) => a.padded).length > 0 ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('product.obs.rosterPad', {
                    authored: String(agents.filter((a) => !a.padded).length),
                    padded: String(agents.filter((a) => a.padded).length),
                  })}
                </Text>
              ) : null}
              {listeningCurrent > 0 && listeningOf > 0 ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('product.obs.listeningCircle', {
                    current: String(listeningCurrent),
                    total: String(listeningOf),
                  })}
                </Text>
              ) : null}
              {report?.dialogueNovelty &&
              report.dialogueNovelty.rate > 0 &&
              talkLog.some((l) => l.kind === 'dialogue') ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('product.obs.lineNovelty')}{' '}
                  {Math.round(report.dialogueNovelty.rate * 100)}%
                </Text>
              ) : null}
            </Space>
            ) : null}
            {livingRumor ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('product.obs.livingRumor')}
                {' · '}
                {livingRumor.slice(0, 72)}
              </Text>
            ) : null}
            {statusHint ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {statusHint}
              </Text>
            ) : null}
            {showAuthorServerClock({ role, serverClock }) ? (
              <Text type="success" style={{ fontSize: 12 }}>
                {t('product.town.serverClock')}
              </Text>
            ) : null}
            {apiOffline ? (
              <Alert
                type="warning"
                showIcon
                style={{ fontSize: 12 }}
                title={t('product.obs.apiOffline')}
              />
            ) : null}
            {isAuthor && tickError ? (
              <Alert
                type="error"
                showIcon
                style={{ fontSize: 12 }}
                title={t('product.obs.tickError')}
                description={tickError}
              />
            ) : null}
            {isAuthor ? (
            <Space wrap size={4}>
              <Space.Compact>
                <InputNumber
                  min={1}
                  max={48}
                  value={hours}
                  onChange={(v) => setHours(Number(v ?? 8))}
                  size="small"
                  disabled={observatoryDisabled}
                />
                <Button size="small" disabled>
                  {t('product.obs.hours')}
                </Button>
              </Space.Compact>
              <Button
                type="primary"
                size="small"
                icon={<ThunderboltOutlined />}
                loading={ffLoading}
                disabled={observatoryDisabled || ffLoading}
                onClick={() => void runSociety()}
              >
                {t('product.obs.fastForward')}
              </Button>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('product.obs.ffHint')}
              </Text>
              {clock?.kind !== 'watch' && allowsGathering ? (
              <Button
                size="small"
                icon={<TeamOutlined />}
                loading={partyLoading}
                disabled={talkDisabled || ffLoading}
                onClick={() => void hostGathering()}
              >
                {t('product.obs.party')}
              </Button>
              ) : null}
            </Space>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('product.obs.guestWatchHint')}
              </Text>
            )}
            <Space wrap size={4}>
              {caps.canFastForward ? (
              <Button
                size="small"
                disabled={observatoryDisabled}
                onClick={() => playThisDay()}
              >
                {t('product.obs.thisDay')}
              </Button>
              ) : null}
              {isAuthor ? (
              <Button
                size="small"
                icon={<CameraOutlined />}
                disabled={observatoryDisabled}
                onClick={() => saveMoment()}
              >
                {t('product.obs.snapshot')}
              </Button>
              ) : null}
              <Button
                size="small"
                loading={loading}
                disabled={observatoryDisabled || ffLoading}
                onClick={() => void reloadSociety()}
              >
                {t('product.obs.refresh')}
              </Button>
              {isAuthor ? (
              <Button
                size="small"
                disabled={rebuildDisabled}
                onClick={() => rebuildPresenter()}
              >
                {t('product.town.refreshArt')}
              </Button>
              ) : null}
            </Space>
            {caps.canFastForward ? (
            <Slider
              min={0}
              max={Math.max(0.1, simMax)}
              step={0.1}
              disabled={observatoryDisabled}
              value={Math.min(cursor, Math.max(0.1, simMax))}
              tooltip={{ formatter: (v) => clockLabel(Number(v ?? 0)) }}
              onChange={(v) => {
                const next = Number(v);
                if (!Number.isFinite(next)) return;
                scrubbingRef.current = true;
                cursorRef.current = next;
                setCursor(next);
                iframeRef.current?.contentWindow?.postMessage(
                  { type: MSG_SCRUB, payload: { cursor: next, playing: false } },
                  '*',
                );
              }}
              onChangeComplete={() => {
                window.setTimeout(() => {
                  scrubbingRef.current = false;
                }, 400);
              }}
            />
            ) : null}
            {isAuthor ? (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('product.town.timelineMeta', {
                cursor: cursor.toFixed(1),
                max: simMax.toFixed(1),
                events: String(eventCount),
                agents: String(agents.length),
              })}
            </Text>
            ) : null}
          <Collapse
            size="small"
            activeKey={inspectDisabled ? [] : inspectorKeys}
            onChange={(keys) => {
              if (inspectDisabled) return;
              setInspectorKeys(Array.isArray(keys) ? keys : [keys]);
            }}
            items={[
              ...(isAuthor
                ? [
                    {
                      key: 'adopt',
                      label: t('kai.adopt.panel'),
                      children: (
                        <AdoptedResidents
                          projectId={projectId}
                          gameId={gameId}
                        />
                      ),
                    },
                  ]
                : []),
              {
                key: 'opinion',
                label: t('product.obs.opinion'),
                children: (
                  <SocietyOpinionBoard
                    projectId={isAuthor ? projectId : undefined}
                    live={opinionLive}
                  />
                ),
              },
              ...(isAuthor
                ? [
                    {
                      key: 'mind',
                      label: t('product.obs.deepMind'),
                      children: <DeepMindPanel projectId={projectId} />,
                    },
                  ]
                : []),
              {
                key: 'talk',
                label: t('product.obs.liveTalk'),
                children: talkGroups.length ? (
                  <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    {visibleTalkGroups(talkGroups).map((group) => {
                      const current =
                        liveTalkSeq != null &&
                        group.talkSeq != null &&
                        group.talkSeq === liveTalkSeq;
                      const upcoming =
                        liveTalkSeq != null &&
                        (group.talkSeq ?? 0) > liveTalkSeq;
                      return (
                      <div
                        key={group.id}
                        style={{
                          borderLeft: `3px solid ${
                            group.kind === 'intervene' ? '#a855f7' : '#38bdf8'
                          }`,
                          paddingLeft: 8,
                        }}
                      >
                        <Space size={4} style={{ marginBottom: 3 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {group.circleIndex
                              ? t('product.obs.circleClock', {
                                  n: String(group.circleIndex),
                                  clock: clockLabel(group.simTime),
                                })
                              : clockLabel(group.simTime)}
                          </Text>
                          {upcoming ? (
                            <Tag>{t('product.obs.nextCircle')}</Tag>
                          ) : null}
                          {talkGroupTitle(group.lines, t) ? (
                            <Text strong style={{ fontSize: 12 }}>
                              {talkGroupTitle(group.lines, t)}
                            </Text>
                          ) : null}
                          {group.kind === 'intervene' ? (
                            <Tag
                              color={
                                group.lines.some((l) => l.interview)
                                  ? 'gold'
                                  : 'purple'
                              }
                            >
                              {group.lines.some((l) => l.interview)
                                ? t('product.obs.interviewTag')
                                : t('product.obs.whisper')}
                            </Tag>
                          ) : group.lines.some(
                              (l) =>
                                l.skipReason === 'error' ||
                                l.skipReason === 'keys_exhausted',
                            ) ? (
                            <Tag color="orange">
                              {t('product.obs.talkFailedTag')}
                            </Tag>
                          ) : group.lines.some((l) => l.skipReason) ? (
                            <Tag>{t('product.obs.talkBusyTag')}</Tag>
                          ) : group.lines.some((l) => l.degraded) ? (
                            <Tag>{t('product.obs.meetNod')}</Tag>
                          ) : (
                            <Tag color={group.lines.length >= 3 ? 'cyan' : 'blue'}>
                              {group.lines.length >= 3
                                ? t('product.obs.groupTalk')
                                : t('product.obs.pairTalk')}
                            </Tag>
                          )}
                        </Space>
                        <Space
                          orientation="vertical"
                          size={2}
                          style={{ width: '100%' }}
                        >
                          {group.lines.map((line, i) => (
                            <Text key={line.id} style={{ fontSize: 12 }}>
                              {current ? (
                                <Text type="secondary">
                                  {talkTurnMark(i)}{' '}
                                </Text>
                              ) : null}
                              <Text strong>{line.who}</Text>
                              {line.to ? (
                                <Text type="secondary"> → {line.to}</Text>
                              ) : null}
                              {talkColon(locale)}
                              {line.text}
                            </Text>
                          ))}
                        </Space>
                      </div>
                      );
                    })}
                  </Space>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {isGenerating || skipReason === 'generate'
                      ? t('product.obs.talkNodGenerate')
                      : llmLive === false
                        ? t('product.obs.talkNodOnly')
                        : t('product.obs.talkWaiting')}
                  </Text>
                ),
              },
              {
                key: 'agent',
                label: t('product.obs.agents'),
                children: (
                  <SocietyRosterPanel
                    agents={agents}
                    selectedAgent={selectedAgent}
                    pinnedAgent={pinnedAgent}
                    agentCard={
                      agentCard && selectedAgent
                        ? { ...agentCard, id: selectedAgent }
                        : null
                    }
                    relations={relations}
                    objects={objects}
                    dayPlan={dayPlan}
                    cursor={cursor}
                    interviewQ={interviewQ}
                    interviewA={interviewA}
                    interviewLoading={interviewLoading}
                    observatoryDisabled={talkDisabled}
                    memories={memories}
                    locale={locale}
                    isDark={isDark}
                    onSelectAgent={(id) => void loadAgent(id)}
                    onFocusRegion={focusRegion}
                    onTogglePin={togglePin}
                    onInterviewChange={setInterviewQ}
                    onAskInterview={(q) => void askInterview(q)}
                    allowInterview={isAuthor}
                    interviewHint={
                      isAuthor &&
                      (budgetTone === 'empty' ||
                        skipReason === 'keys_exhausted')
                        ? t('product.obs.interviewBudgetHint')
                        : null
                    }
                  />
                ),
              },
              {
                key: 'places',
                label: t('product.obs.places'),
                children: (
                  <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    {regionPlaces.length ? (
                      <Space wrap size={4}>
                        {regionPlaces.map((rid) => (
                          <Button
                            key={rid}
                            size="small"
                            onClick={() => focusRegion(rid)}
                          >
                            {regionLabel(
                              rid,
                              agents.find((a) => a.regionId === rid)?.regionName,
                            )}{' '}
                            · {agents.filter((a) => a.regionId === rid).length}
                          </Button>
                        ))}
                      </Space>
                    ) : null}
                    {shopPlaces.length ? (
                      <Space wrap size={4}>
                        {shopPlaces.slice(0, 12).map((p) => (
                          <Button
                            key={p.id}
                            size="small"
                            onClick={() => {
                              focusRegion(p.regionId);
                              const owner =
                                agents.find((a) => a.areaId === p.id) ??
                                agents.find(
                                  (a) => a.name && p.name.startsWith(a.name),
                                );
                              if (owner) void loadAgent(owner.id);
                            }}
                          >
                            {p.name}
                          </Button>
                        ))}
                      </Space>
                    ) : null}
                    {!regionPlaces.length && !shopPlaces.length ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t('product.obs.eventsEmpty')}
                      </Text>
                    ) : null}
                  </Space>
                ),
              },
              {
                key: 'graph',
                label: t('product.obs.relationGraph'),
                children: relations.length ? (
                  <SocietyRelationGraph
                    agents={agents}
                    relations={relations}
                    selectedId={selectedAgent}
                    cursor={cursor}
                    onSelect={(id) => void loadAgent(id)}
                    height={260}
                  />
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('product.obs.relationEmpty')}
                  </Text>
                ),
              },
              {
                key: 'objects',
                label: t('product.obs.objects'),
                children: objects.length ? (
                  <div style={{ maxHeight: 180, overflow: 'auto' }}>
                    <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                      {[...objects]
                        .sort((a, b) => {
                          const ab = objectLooksBroken(a.state) ? 0 : 1;
                          const bb = objectLooksBroken(b.state) ? 0 : 1;
                          return ab - bb;
                        })
                        .slice(0, 24)
                        .map((o) => {
                          const broken = objectLooksBroken(o.state);
                          const lit = highlightedObjectId === o.id;
                          return (
                        <div key={o.id} id={`town-obj-${o.id}`}>
                        <Space
                          size={4}
                          wrap
                          style={{
                            width: '100%',
                            padding: '2px 4px',
                            borderRadius: 4,
                            background:
                              broken || lit
                                ? 'rgba(217, 119, 6, 0.16)'
                                : undefined,
                            outline: lit ? '1px solid #d97706' : undefined,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              color: broken ? '#b45309' : undefined,
                              fontWeight: broken || lit ? 600 : 400,
                            }}
                          >
                            {o.areaName ? `${o.areaName} / ` : ''}
                            {o.name}
                            {o.kind ? ` · ${o.kind}` : ''} — {o.state}
                          </Text>
                          <Button
                            size="small"
                            onClick={() =>
                              void setObjectState(o.id, t('product.obs.objectOff'))
                            }
                          >
                            {t('product.obs.objectOff')}
                          </Button>
                          <Button
                            size="small"
                            onClick={() =>
                              void setObjectState(o.id, t('product.obs.objectOn'))
                            }
                          >
                            {t('product.obs.objectOn')}
                          </Button>
                          <Input
                            size="small"
                            style={{ width: 88 }}
                            value={objectDraft[o.id] ?? ''}
                            placeholder={t('product.obs.setObject')}
                            onChange={(e) =>
                              setObjectDraft((prev) => ({
                                ...prev,
                                [o.id]: e.target.value,
                              }))
                            }
                            onPressEnter={() => {
                              const v = (objectDraft[o.id] ?? '').trim();
                              if (v) void setObjectState(o.id, v);
                            }}
                          />
                        </Space>
                        </div>
                          );
                        })}
                    </Space>
                  </div>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('product.obs.objectsEmpty')}
                  </Text>
                ),
              },
              {
                key: 'memory',
                label: t('product.obs.memory'),
                children: memories.length ? (
                  <div style={{ maxHeight: 180, overflow: 'auto' }}>
                    <Space size={4} wrap style={{ marginBottom: 6 }}>
                      {(
                        [
                          ['all', t('product.obs.memoryAll')],
                          ['paid', t('product.obs.memoryPaid')],
                          ['witness', t('product.obs.memoryWitness')],
                          ['belief', t('product.obs.memoryBeliefs')],
                          ['reflection', t('product.obs.memoryReflections')],
                        ] as const
                      ).map(([key, label]) => (
                        <Button
                          key={key}
                          size="small"
                          type={memoryFilter === key ? 'primary' : 'default'}
                          onClick={() => setMemoryFilter(key)}
                        >
                          {label}
                        </Button>
                      ))}
                    </Space>
                    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                      {reflectionTreeNodes(memories).length ? (
                        <Tree
                          showLine
                          defaultExpandAll
                          treeData={reflectionTreeNodes(memories)}
                          style={{ fontSize: 12 }}
                        />
                      ) : null}
                      {visibleMemories.length ? (
                      visibleMemories
                        .map((m, i) => (
                        <Space
                          key={`${m.simTime}-${m.kind}-${i}`}
                          orientation="vertical"
                          size={0}
                        >
                          <Space>
                            <Tag
                              color={
                                paidTraceKind(m.text)
                                  ? 'magenta'
                                  : isBeliefMemory(m.text)
                                    ? 'cyan'
                                    : m.kind === 'reflection'
                                      ? 'purple'
                                      : isWitnessMemory(m.text)
                                        ? 'gold'
                                        : m.kind === 'dialogue'
                                          ? 'blue'
                                          : 'default'
                              }
                            >
                              {paidTraceLabelKey(paidTraceKind(m.text))
                                ? t(paidTraceLabelKey(paidTraceKind(m.text))!)
                                : isBeliefMemory(m.text)
                                  ? t('product.obs.belief')
                                  : isWitnessMemory(m.text)
                                    ? t('product.obs.memoryWitness')
                                    : m.kind}
                            </Tag>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {clockLabel(m.simTime)}
                            </Text>
                          </Space>
                          <Text style={{ fontSize: 12 }}>{displayMemoryText(m.text)}</Text>
                          {m.kind === 'reflection' &&
                          Array.isArray(m.pointers) &&
                          m.pointers.length ? (
                            <Text
                              type="secondary"
                              style={{
                                fontSize: 11,
                                whiteSpace: 'pre-line',
                              }}
                            >
                              {t('product.obs.reflection')}
                              {'\n'}
                              {pointerSnippets(m.pointers, memories).join('\n')}
                            </Text>
                          ) : null}
                        </Space>
                      ))
                      ) : (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {t('product.obs.memoryFilterEmpty')}
                        </Text>
                      )}
                    </Space>
                  </div>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('product.obs.memoryEmpty')}
                  </Text>
                ),
              },
              {
                key: 'emergence',
                label: t('product.obs.emergence'),
                children: report ? (
                  <Space orientation="vertical" style={{ width: '100%' }}>
                    {report.seed ? (
                      <Alert
                        type={report.seed.gateFailed ? 'error' : 'info'}
                        showIcon
                        style={{ fontSize: 12 }}
                        title={
                          report.seed.gateFailed
                            ? t('product.obs.seedFailed')
                            : t('product.obs.seedContract')
                        }
                        description={`${t('product.obs.seedHours')} ${report.seed.hours ?? '—'}h · ${t('product.obs.realDialogues')} ${report.seed.dialogues ?? 0} · ${t('product.obs.spread')} ${Math.round(report.informationSpread.rate * 100)}%${societySeedUsedFallback(report.seed) ? ` · ${t('product.obs.seedDegraded')}` : ''}${report.seed.retrievalDegraded ? ` · ${t('product.obs.retrievalDegraded')}` : ''}`}
                      />
                    ) : null}
                    <Statistic
                      title={t('product.obs.spread')}
                      value={Math.round(report.informationSpread.rate * 100)}
                      suffix="%"
                    />
                    {report.informationSpread.seedText ? (
                      <Text style={{ fontSize: 12 }}>
                        {t('product.obs.livingRumor')}
                        {' · '}
                        {report.informationSpread.seedText.slice(0, 80)}
                      </Text>
                    ) : null}
                    {typeof report.informationSpread.awareCount === 'number' ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t('product.obs.rumorWho')}
                        {' · '}
                        {report.informationSpread.awareCount}/
                        {report.informationSpread.totalAgents ?? agents.length}
                        {report.informationSpread.awareIds?.length
                          ? `：${report.informationSpread.awareIds
                              .slice(0, 12)
                              .map(
                                (id) =>
                                  agents.find((a) => a.id === id)?.name ??
                                  id.slice(0, 6),
                              )
                              .join('、')}`
                          : ''}
                      </Text>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t('product.obs.rumorNone')}
                      </Text>
                    )}
                    {moments.length ? (
                      <div>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {t('product.obs.moments')}
                        </Text>
                        {moments.slice(0, 6).map((m, i) => (
                          <div key={`${m.simTime}-${i}`}>
                            <Text style={{ fontSize: 12 }}>
                              {clockLabel(m.simTime)}
                              {m.name ? ` · ${m.name}` : ''} — {m.line.slice(0, 48)}
                            </Text>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <Space size={16}>
                      <Statistic
                        title={t('product.obs.relations')}
                        value={report.relationshipFormation.newRelations}
                        valueStyle={{ fontSize: 18 }}
                      />
                      <Statistic
                        title={t('product.obs.attendance')}
                        value={Math.round(
                          (report.coordination?.peakGatheringRate ??
                            report.coordination?.attendanceRate ??
                            0) * 100,
                        )}
                        suffix="%"
                        valueStyle={{ fontSize: 18 }}
                      />
                      {typeof report.scheduleDiversity?.rate === 'number' ? (
                        <Statistic
                          title={t('product.obs.routeVariety')}
                          value={Math.round(report.scheduleDiversity.rate * 100)}
                          suffix="%"
                          valueStyle={{ fontSize: 18 }}
                        />
                      ) : null}
                    </Space>
                    {report.dialogueQuality?.summary ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t('product.obs.dialogueQuality')} ·{' '}
                        {report.dialogueQuality.summary}
                      </Text>
                    ) : null}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {report.summary}
                    </Text>
                  </Space>
                ) : (
                  <Text type="secondary">{t('product.obs.emergenceEmpty')}</Text>
                ),
              },
              {
                key: 'advanced',
                label: t('product.obs.advanced'),
                children: (
                  <Button
                    type="link"
                    size="small"
                    disabled={!previewUrl}
                    onClick={() => {
                      if (!previewUrl) return;
                      try {
                        const u = new URL(previewUrl, window.location.href);
                        u.searchParams.set('mode', 'play');
                        window.open(u.toString(), '_blank', 'noopener,noreferrer');
                      } catch {
                        window.open(previewUrl, '_blank', 'noopener,noreferrer');
                      }
                    }}
                  >
                    {t('product.town.openPlayDebug')}
                  </Button>
                ),
              },
            ].filter((item) => isAuthor || item.key === 'talk')}
          />
          {!eventCount ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 8 }}
              title={
                isGenerating
                  ? t('generate.preview.pipelineWorldGenerateTitle')
                  : t('product.town.mapEmpty')
              }
              description={
                isGenerating
                  ? buildingOverlay
                  : isAuthor
                    ? t('product.obs.empty')
                    : t('product.obs.guestEmpty')
              }
            />
          ) : null}
          </Space>
        </div>

        {isAuthor ? (
        <div
          style={{
            flexShrink: 0,
            maxHeight: compact ? '48%' : '42%',
            overflow: 'auto',
            borderTop: '1px solid var(--border-color)',
            padding: 12,
            background: 'var(--bg-elevated)',
          }}
        >
          <Collapse
            size="small"
            style={{ marginBottom: 10 }}
            activeKey={opsOpen}
            onChange={(keys) =>
              setOpsOpen(Array.isArray(keys) ? keys.map(String) : [String(keys)])
            }
            items={[
              {
                key: 'ops',
                label: t('product.obs.authorOps'),
                children: (
                  <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                    {featureFlags.courseMarket ? (
                      <SocietyTownAuthorOpsBar
                        gameId={gameId}
                        projectId={projectId}
                        board={courseBoard}
                        paused={authorClockPaused}
                        funded={leaseActive(talkBudget?.litUntil, leaseNow)}
                        nowMs={leaseNow}
                        recommendHintKey={courseAuthorRecommendHintKey({
                          ...genreProfileFromWorldSpec(worldLike),
                          villagePack: worldCoursePrefersNightMarket(worldLike),
                        })}
                        onOpenAdvanced={() => setCourseModalOpen(true)}
                        onOpenFund={() => {
                          setOpsOpen(['ops']);
                          window.setTimeout(() => scrollToWorldLightDesk(), 80);
                        }}
                        onResumeClock={() =>
                          toggleTownClock(false, { resumeShared: true })
                        }
                        onSeeded={(next) => {
                          setCourseBoard(next);
                          setCourseKeepAlive(courseKeepAliveNeeded(next));
                        }}
                      />
                    ) : null}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('product.obs.authorOpsHint')}
                    </Text>
                    <SocietyTownLampStrip
                      readOnly
                      dense={compact}
                      permitHint={lightHint}
                      talkBudgetHint={t('product.obs.sharedTalk')}
                      lamp={townLamp}
                      contributors={townContributors}
                      watcherCount={watcherCount}
                    />
                    <SocietyTownLightDesk
                      gameId={gameId}
                      projectId={projectId}
                      canSpend
                      onRequireLogin={() => undefined}
                      costs={{
                        hour: guestDesk?.commerce?.worldLightHour,
                        day: guestDesk?.commerce?.worldLightDay,
                        week: guestDesk?.commerce?.worldLightWeek,
                      }}
                      talkBudget={talkBudget}
                      urge={lightUrge}
                      dense={compact}
                      now={leaseNow}
                      onLit={(info) => {
                        const view = info.talkBudget
                          ? readTalkBudget(info.talkBudget)
                          : null;
                        if (view) setTalkBudget(view);
                        if (shouldClearBudgetMute(view)) {
                          setSkipReason((prev) =>
                            prev === 'budget' || prev === 'keys_exhausted' ? null : prev,
                          );
                        }
                        setLightFlash({
                          name: t('product.obs.worldLightOk'),
                          bonus: view?.litBonus || info.lightBonusPerHour || 12,
                        });
                        void reloadSociety({ quiet: true, iframe: 'append' });
                      }}
                    />
                  </Space>
                ),
              },
            ]}
          />
          <Text strong>{t('product.obs.whisper')}</Text>
          <Text
            type="secondary"
            style={{ fontSize: 11, display: 'block', marginBottom: 6 }}
          >
            {t('product.town.interveneFrom', {
              time: cursor.toFixed(1),
            })}
          </Text>
          <Input.TextArea
            rows={2}
            value={whisper}
            onChange={(e) => setWhisper(e.target.value)}
            placeholder={t('product.obs.whisperPlaceholder')}
            disabled={talkDisabled}
          />
          <Button
            block
            type="dashed"
            style={{ marginTop: 8 }}
            loading={whisperLoading}
            disabled={talkDisabled || !whisper.trim() || whisperLoading}
            onClick={() => void intervene()}
          >
            {selectedAgent
              ? t('product.obs.intervene')
              : t('product.obs.rumorNow')}
          </Button>
        </div>
        ) : embedCourseOnStage ? (
        <div
          style={{
            flexShrink: 0,
            maxHeight: '42%',
            overflow: 'auto',
            borderTop: '1px solid var(--border-color)',
            padding: 12,
            background: 'var(--bg-elevated)',
          }}
        >
          {gameId && guestDesk ? (
            <SocietyTownGuestDesk
              slot="full"
              dense={compact}
              onCourseKeepAlive={setCourseKeepAlive}
              liveNudge={courseLiveNudge}
              talks={talkLog}
              gameId={gameId}
              commerce={guestDesk.commerce}
              canSpend={guestDesk.canSpend}
              whisperDraft={guestDesk.whisperDraft}
              whisperTick={guestDesk.whisperTick}
              onRequireLogin={guestDesk.onRequireLogin}
              onWhispered={guestDesk.onWhispered}
              permitHint={permitHint}
              talkBudgetHint={talkBudgetHint}
              onTownMoved={onGuestTownMoved}
              lamp={townLamp}
              contributors={townContributors}
              watcherCount={watcherCount}
              talkBudget={talkBudget}
              urgeLight={lightUrge}
              now={leaseNow}
            />
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('product.obs.guestWatchHint')}
            </Text>
          )}
        </div>
        ) : null}
        </>
        )}
      </div>
      ) : null}
      {isAuthor ? (
        <SocietyTownCourseAuthorModal
          open={courseModalOpen}
          onClose={() => setCourseModalOpen(false)}
          gameId={gameId}
          projectId={projectId}
          talks={talkLog}
          places={placesFromWorldSpec(worldLike)}
          worldSpec={worldLike}
          seedEmpty={Boolean(
            report?.seed &&
              (report.seed.dialogues === 0 || report.seed.degraded),
          )}
          locale={locale === 'en' ? 'en' : 'zh-CN'}
          onSeeded={(next) => {
            setCourseBoard(next);
            setCourseKeepAlive(courseKeepAliveNeeded(next));
          }}
        />
      ) : null}
    </div>
  );
};
