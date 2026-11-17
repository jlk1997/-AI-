/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stanford-town observe stage: replay society events on the Spec region map.
 * Not a win/lose RPG — residents walk, talk bubbles, time scrub.
 */

import Phaser from 'phaser';

import {
  agentChromeLift,
  agentLabelText,
  chromeClusterSlot,
  crowdSpreadOffset,
  minimapBox,
  minimapDockForFollow,
  chromeOriginBottomRect,
  nameplateDepth,
  preferUniquePortraitFile,
  regionNavAlpha,
  shouldDrawTalkArc,
  shouldFollowSpeech,
  shouldHideNameUnderSpeech,
  shouldShowObjectLabel,
  speechBubbleBgDepth,
  speechBubbleTextDepth,
  speechFocusPoint,
  talkArcDepth,
  type ChromeRect,
  type MinimapDock,
} from '../ui/agentChrome';
import { fitTownCamera } from '../ui/cameraFit';
import {
  CHAR_FRAMES_PER_DIR,
  WALK_DIRS,
  characterPalette,
  characterSheetLayout,
  charFrameName,
  charFrameRect,
  drawCharacterSheet,
} from '../ui/characterSprite';
import {
  decorCells,
  drawPlaceSprite,
  interiorWallCellKeys,
  interiorWallClusters,
  minimapTerrainFill,
  placeAnchorCell,
  placeKindFromName,
  placePadCells,
  placePalette,
  placeSpriteLayout,
  placeTextureKey,
  type PlaceKind,
} from '../ui/placeSprite';
import { UI_FONT, fontPx } from '../ui/fonts';
import {
  CIRCLE_GAP_MS,
  DEFAULT_SPEECH_PACING,
  circleIndexOfPayload,
  compareReplayTalkOrder,
  conversationEndMs,
  liveSpeechCaption,
  nextCircleStartMs,
  openingCirclesAtTip,
  pickCurrentTalkEvent,
  pinNarrativeTalkEvents,
  scheduleConversation,
  shouldArmCircleStage,
  speechHoldMs,
  talkSeqOfPayload,
  type SpeechCue,
  type SpeechPacing,
  type SpeechTurnInput,
} from '../ui/speechSchedule';

type WorldRegion = {
  id: string;
  name?: string;
  width: number;
  height: number;
  kind?: string;
  layoutAscii?: string;
};

type WorldDoc = {
  meta?: { title?: string; summary?: string };
  styleAnchor?: { palette?: string[] };
  space: {
    startRegionId: string;
    regions: WorldRegion[];
    areas?: Array<{
      id: string;
      name?: string;
      regionId: string;
      objects?: Array<{ id: string; name: string; state?: string }>;
    }>;
  };
  entities?: Array<{
    id: string;
    kind: string;
    name: string;
    regionId: string;
    pos: { x: number; y: number };
  }>;
  presentation?: {
    tileSize?: number;
    /** Source frame size of tileset.png; may exceed the on-screen tile size. */
    tileSourceSize?: number;
    pixelPerfect?: boolean;
    genreProfile?: { clock?: { kind?: string; shifts?: number; hoursPerDay?: number } };
  };
};

type ReplayObject = {
  id: string;
  name: string;
  state: string;
  regionId: string;
  areaName?: string;
  kind?: string;
  x?: number;
  y?: number;
};

type ReplayEvent = {
  id: string;
  simTime: number;
  kind: string;
  agentId?: string | null;
  payload: Record<string, unknown>;
};

type ReplayAgent = {
  id: string;
  name: string;
  regionId: string;
  x: number;
  y: number;
  currentAction: string;
  goalX?: number;
  goalY?: number;
  goalPlace?: string;
  goalReason?: string;
  drive?: string;
};

type CrowdDot = {
  regionId: string;
  x: number;
  y: number;
  stance: number;
};

type ReplayPayload = {
  version?: number;
  simTime?: number;
  agents: ReplayAgent[];
  events: ReplayEvent[];
  crowd?: CrowdDot[];
  report?: {
    summary?: string;
    informationSpread?: { rate: number };
  } | null;
  focusAgentId?: string | null;
  rumor?: boolean;
  objects?: ReplayObject[];
};

type AgentPose = {
  id: string;
  name: string;
  regionId: string;
  x: number;
  y: number;
  action: string;
  /** Spoken line — shown in speech bubble above the agent. */
  bubble?: string;
  bubbleAt?: number;
  bubbleUntil?: number;
  /** Non-speech activity hint — icon under the name tag. */
  actionGlyph?: string;
  /** Who this resident is addressing (name). */
  talkWith?: string;
  goalX?: number;
  goalY?: number;
  goalPlace?: string;
  goalReason?: string;
  drive?: string;
  /**
   * Position came from the live roster rather than the event trail, i.e. nothing
   * newer than the cursor is known for this resident. Only those may be eased by
   * {@link SocietyReplayScene.tipLerp}.
   */
  fromSnapshot?: boolean;
};

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

/**
 * Speech pacing.
 *
 * A tick hands over whole conversations at once, so pinning every speaker on
 * arrival popped the entire town's bubbles in the same instant: no order to
 * follow, and nothing ever left the screen. Turns are now laid on a wall-clock
 * timeline (see ../ui/speechSchedule): serial inside one conversation, and each
 * further conversation of the same batch opens this much later so parallel
 * exchanges are still visible without starting in lockstep.
 */
const CONVERSATION_OPEN_STAGGER_MS = CIRCLE_GAP_MS;
/** Opening reel may queue several circles; do not drop the later ones. */
const SPEECH_HORIZON_MS = 90_000;
/** One circle on stage — a circle is at most a few speakers. */
const MAX_CONCURRENT_LIVE_SPEECH = 1;
/** How many bubbles the current region draws at once. */
const MAX_VISIBLE_BUBBLES = 1;
/** Minimap redraw interval — coarse positions do not need 60fps. */
const MINIMAP_INTERVAL_MS = 50;
/** Redraw time slice; frames that blow through it back off for a few frames. */
const FRAME_BUDGET_MS = 8;

function pinNarrativeEvents(
  events: readonly ReplayEvent[],
  cap: number,
): ReplayEvent[] {
  return pinNarrativeTalkEvents(events, cap);
}

function ySortDepth(y: number, base = 10): number {
  return base + Math.floor(y);
}

function npcAssetSlug(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 28);
}

function walkDirFromDelta(
  dx: number,
  dy: number,
): 'down' | 'left' | 'right' | 'up' {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

export class SocietyReplayScene extends Phaser.Scene {
  private world!: WorldDoc;
  private tileSize = 48;
  /** Texture frame size of the tileset; decoupled from the on-screen size. */
  private tileSourceSize = 48;
  private replay: ReplayPayload = { agents: [], events: [] };
  private cursor = 0;
  private playing = false;
  /** Parent town-clock; when false, replay/append must not auto-resume. */
  private clockPlaying: boolean | undefined;
  private speed = 1;
  private regionId = '';
  private mapLayer!: Phaser.GameObjects.Container;
  /** Roofs and field pads sit on the tiles, under props and people. */
  private structureLayer!: Phaser.GameObjects.Container;
  private structureGfx?: Phaser.GameObjects.Graphics;
  private structureTrees: Phaser.GameObjects.Image[] = [];
  /** Reused across region switches instead of recreating the whole grid. */
  private tilePool: Phaser.GameObjects.Image[] = [];
  private tileFill?: Phaser.GameObjects.Graphics;
  private objectLayer!: Phaser.GameObjects.Container;
  private agentLayer!: Phaser.GameObjects.Container;
  private crowdGfx?: Phaser.GameObjects.Graphics;
  private crowdDots: CrowdDot[] = [];
  /** Speech sits above every nameplate — not y-sorted with the crowd. */
  private speechLayer!: Phaser.GameObjects.Container;
  private talkArcs!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private agentGfx = new Map<
    string,
    {
      body: Phaser.GameObjects.Sprite;
      shadow: Phaser.GameObjects.Ellipse;
      glyph: Phaser.GameObjects.Text;
      label: Phaser.GameObjects.Text;
      bubble: Phaser.GameObjects.Text;
      bubbleBg: Phaser.GameObjects.Graphics;
      highlight: Phaser.GameObjects.Ellipse;
      dir: 'down' | 'left' | 'right' | 'up';
      atlasKey?: string;
    }
  >();
  private objectGfx = new Map<
    string,
    {
      mark: Phaser.GameObjects.Image | Phaser.GameObjects.Arc;
      glow?: Phaser.GameObjects.Arc;
      label: Phaser.GameObjects.Text;
    }
  >();
  private lastApplied = -1;
  private selectedId: string | null = null;
  private pinnedAgentId: string | null = null;
  private lastParentNotify = 0;
  private lastTalkEventId: string | null = null;
  private regionPinned: string | null = null;
  /**
   * Observer dragged the map. Speech follow yields until they unpin a resident
   * or click the current region chip again.
   */
  private userSteeredCamera = false;
  /** Last conversation we framed — same event must not hard-cut every line. */
  private speechFollowEventId: string | null = null;
  /** After a cross-region fade, land on the speakers instead of the map centre. */
  private pendingSpeechFocus: { x: number; y: number } | null = null;
  private cameraDrag: { x: number; y: number; moved: boolean } | null = null;
  private followId: string | null = null;
  private bgmMuted = false;
  /** Browser may block autoplay until a user gesture. */
  private bgmNeedsGesture = false;
  private bgmLoaded = false;
  /** Cached tip sim time — avoid Math.max(...events) every frame. */
  private cachedMaxSimTime = 0;
  /**
   * Bumped whenever `replay` changes. Together with the cursor it keys the pose
   * memo below, so a frame that calls posesAtCursor() from applyCursor, hover,
   * refreshAgents and the minimap only pays for the event scan once.
   */
  private replayVersion = 0;
  private poseCache: { key: string; poses: AgentPose[] } | null = null;
  private objectCache: { key: string; objects: ReplayObject[] } | null = null;
  /** Live id index so appends dedupe without rebuilding a Set each time. */
  private eventIds = new Set<string>();
  private lastAutoRegionSwitch = 0;
  private lastHudClockBucket = -1;
  private nightVeil!: Phaser.GameObjects.Rectangle;
  private duskGlow!: Phaser.GameObjects.Rectangle;
  private navLayer!: Phaser.GameObjects.Container;
  private navLabels: Array<{
    id: string;
    label: Phaser.GameObjects.Text;
  }> = [];
  private hoverAgentId: string | null = null;
  private hoverObjectId: string | null = null;
  private helpVisible = false;
  private regionFadeGen = 0;
  private pendingRegionId: string | null = null;
  private didCenterCrowd = false;
  /** When tip agents jump without new move keyframes, ease sprites over ~1.8s. */
  private tipLerp = new Map<
    string,
    {
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      regionId: string;
      t0: number;
      dur: number;
    }
  >();
  /** Wall-clock speech pins for live append (do not wait for cursor to catch up). */
  private liveSpeech = new Map<string, { text: string; untilMs: number }>();
  /** Live exchange partner names, keyed by speaker id. */
  private liveTalkWith = new Map<string, string>();
  /** Timers used to play a multi-person dialogue as an ordered exchange. */
  private liveSpeechTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Wall clock at which the next conversation of a batch may open. */
  private speechStageFreeMs = 0;
  /** Per resident: when their current line ends, so they never talk over it. */
  private agentSpeechFreeMs = new Map<string, number>();
  /** Subtitle for the line currently on stage; expires with its bubble. */
  private liveCaption: { text: string; untilMs: number } | null = null;
  private captionDirty = false;
  private lastNotifiedCaption: string | null = null;
  /** Circle currently being heard (opening reel / live). */
  private stageTalkEventId: string | null = null;
  private stageTalkSeq = 0;
  private stageCircleIndex = 0;
  private listeningCircleTotal = 0;
  /** Community guests stay on the shared tip — no local scrub / speed. */
  private lockLiveTip = false;
  /** Region size in world pixels — the camera fit needs it on every resize. */
  private mapPixelW = 0;
  private mapPixelH = 0;
  /**
   * HUD/minimap/subtitle live on their own unzoomed camera: the town camera is
   * scaled to fill the pane, and scroll-locked chrome would scale with it.
   */
  private hudCam?: Phaser.Cameras.Scene2D.Camera;
  /** Set when live speech changes; consumed once per frame by update(). */
  private agentsDirty = false;
  private assetKeys = {
    tile: 'wa_tile',
    wall: 'wa_wall',
    path: 'wa_path',
    water: 'wa_water',
    decor: 'wa_decor',
    tileset: 'wa_tileset',
    npc: 'wa_npc',
  };
  private tilemaps = new Map<
    string,
    { width: number; height: number; gids: number[] }
  >();
  private walkAtlasByAgent = new Map<string, string>();
  private minimap!: Phaser.GameObjects.Graphics;
  private minimapTerrain!: Phaser.GameObjects.Graphics;
  private minimapDock: MinimapDock = 'bottom-right';
  /** `regionId:boxX:boxY` — terrain only needs a redraw when this changes. */
  private minimapTerrainKey = '';
  private lastMinimapAt = 0;
  /** Frames to coast without a redraw after one blew the frame budget. */
  private redrawSkipFrames = 0;
  private hoverHint!: Phaser.GameObjects.Text;

  constructor() {
    super('SocietyReplay');
  }

  create(): void {
    this.world = this.registry.get('world') as WorldDoc;
    this.tileSize = this.world.presentation?.tileSize ?? 48;
    this.tileSourceSize =
      this.world.presentation?.tileSourceSize ?? this.tileSize;
    this.regionId = this.world.space.startRegionId;
    this.cameras.main.setBackgroundColor(0x1a3d2a);
    this.mapLayer = this.add.container(0, 0);
    this.structureLayer = this.add.container(0, 0).setDepth(2);
    this.objectLayer = this.add.container(0, 0).setDepth(4);
    this.agentLayer = this.add.container(0, 0).setDepth(10);
    this.speechLayer = this.add.container(0, 0).setDepth(8000);
    this.talkArcs = this.add.graphics();
    this.agentLayer.add(this.talkArcs);

    // Origin at the top-left so layoutChrome can stretch them over any viewport;
    // they used to be fixed 800x600 and left the corners unlit after a resize.
    this.nightVeil = this.add
      .rectangle(0, 0, 800, 600, 0x020617, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(40)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.duskGlow = this.add
      .rectangle(0, 0, 800, 320, 0xea580c, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(39)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.navLayer = this.add.container(0, 0).setScrollFactor(0).setDepth(1001);
    this.minimapTerrain = this.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(1002);
    this.minimap = this.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(1003);
    this.hoverHint = this.add
      .text(12, 48, '', {
        fontFamily: UI_FONT,
        fontSize: fontPx(14),
        color: '#fde68a',
        backgroundColor: '#0f172add',
        padding: { x: 10, y: 5 },
      })
      .setScrollFactor(0)
      .setDepth(1003)
      .setVisible(false);

    this.hud = this.add
      .text(12, 10, '', {
        fontFamily: UI_FONT,
        fontSize: fontPx(14),
        color: '#e2e8f0',
        backgroundColor: '#0f172acc',
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.subtitle = this.add
      .text(12, 710, '', {
        fontFamily: UI_FONT,
        fontSize: fontPx(17),
        color: '#f8fafc',
        backgroundColor: '#0f172add',
        padding: { x: 12, y: 9 },
        wordWrap: { width: 1000 },
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(1000);
    this.setupCameras();
    this.layoutChrome();

    const seeded = this.registry.get('societyReplay') as ReplayPayload | null;
    const observeMode = this.registry.get('observeMode') === true;
    if (
      !observeMode &&
      (seeded?.events?.length || seeded?.agents?.length)
    ) {
      this.applyReplay(seeded);
    } else if (!observeMode) {
      void this.loadReplayFile();
    }
    // observeMode: wait for parent MSG_REPLAY; stay paused until data arrives.
    // Guests start locked to the shared tip so a keypress cannot rewind
    // before the parent says this desk may scrub.
    if (observeMode) {
      this.playing = false;
      this.lockLiveTip = true;
    }

    this.bindInput();
    this.bindParentMessages();
    this.drawRegion(this.regionId);
    this.buildRegionNav();
    this.refreshAgents(true);
    this.notifyParent(MSG_READY, {});
    this.scale.on('resize', () => this.layoutChrome());
    void this.loadWorldAssets().then(() => {
      this.drawRegion(this.regionId);
      this.refreshAgents(true);
      this.playBgm();
    });
    this.events.once('shutdown', () => {
      window.removeEventListener('message', this.onWindowMessage);
      for (const timer of this.liveSpeechTimers) clearTimeout(timer);
      this.liveSpeechTimers.clear();
    });
  }

    update(_t: number, dt: number): void {
    // A backgrounded tab still gets ticked in some browsers; advancing the cursor
    // there only builds up redraw work nobody can see.
    if (typeof document !== 'undefined' && document.hidden) return;
    const nowMs = performance.now();
    for (const [id, v] of this.liveSpeech) {
      if (v.untilMs <= nowMs) {
        this.liveSpeech.delete(id);
        this.agentsDirty = true;
      }
    }
    if (this.liveCaption && this.liveCaption.untilMs <= nowMs) {
      this.liveCaption = null;
      this.captionDirty = true;
    }
    if (!this.playing) {
      // applyCursor redraws agents itself, so never do both in one frame.
      if (this.tipLerp.size > 0) {
        this.applyCursor();
      } else if (this.agentsDirty || this.liveSpeech.size > 0) {
        this.refreshAgents(false);
      }
      if (this.captionDirty) this.refreshSubtitle();
      this.agentsDirty = false;
      if (this.lastHudClockBucket !== -2) {
        this.lastHudClockBucket = -2;
        this.refreshHud();
      }
      return;
    }
    const maxT = this.maxSimTime();
    const gap = maxT - this.cursor;
    const prevCursor = this.cursor;
    if (gap > 0.0001 && gap <= 1.5) {
      this.cursor += (dt / 1000) * Math.max(0.08, gap / 2.0);
    } else {
      this.cursor += (dt / 1000) * this.speed;
    }
    if (this.cursor > maxT) this.cursor = maxT;
    const moved =
      Math.abs(this.cursor - prevCursor) > 0.00005 || this.tipLerp.size > 0;
    if (moved) {
      if (this.redrawSkipFrames > 0) {
        this.redrawSkipFrames -= 1;
      } else {
        const t0 = performance.now();
        this.applyCursor();
        const cost = performance.now() - t0;
        // A crowded town can push a redraw past the frame budget. Drop the redraw
        // rate rather than the whole tab — the cursor keeps advancing, and
        // interpolation is wall-clock based, so motion stays smooth-ish.
        this.redrawSkipFrames =
          cost > FRAME_BUDGET_MS
            ? Math.min(4, Math.ceil(cost / FRAME_BUDGET_MS) - 1)
            : 0;
      }
    } else if (this.agentsDirty || this.liveSpeech.size > 0) {
      this.refreshAgents(false);
    }
    if (this.captionDirty) this.refreshSubtitle();
    this.agentsDirty = false;
    const bucket = Math.floor(this.cursor * 8);
    if (bucket !== this.lastHudClockBucket) {
      this.lastHudClockBucket = bucket;
      this.refreshHud();
    }
  }

  private recomputeMaxSimTime(): void {
    let m = this.replay.simTime ?? 0;
    for (const e of this.replay.events) {
      if (e.simTime > m) m = e.simTime;
    }
    this.cachedMaxSimTime = m;
  }

  private maxSimTime(): number {
    return this.cachedMaxSimTime;
  }

  private async loadReplayFile(): Promise<void> {
    if (this.registry.get('observeMode') === true) return;
    try {
      const res = await fetch('./society_replay.json');
      if (!res.ok) return;
      const data = (await res.json()) as ReplayPayload;
      this.applyReplay(data);
    } catch {
      // empty town until parent posts data
    }
  }

  private replayMaxSimTime(data: ReplayPayload): number {
    let m = data.simTime ?? 0;
    for (const e of data.events ?? []) {
      if (e.simTime > m) m = e.simTime;
    }
    return m;
  }

  private applyReplay(data: ReplayPayload): void {
    const incomingMax = this.replayMaxSimTime(data);
    // A stale parent snapshot must not rewind the live tip — that replays
    // opening circles and snaps everyone back to an earlier hour.
    if (this.lockLiveTip && this.cursor > incomingMax + 0.05) {
      this.appendReplay(data);
      return;
    }
    this.tipLerp.clear();
    this.resetLiveSpeech();
    const rawEvents = (data.events ?? [])
      .filter((e) => e.kind !== 'emergence_report')
      .slice()
      .sort(compareReplayTalkOrder);
    this.crowdDots = data.crowd ?? this.crowdDots;
    this.replay = {
      agents: data.agents ?? [],
      events: pinNarrativeEvents(rawEvents, 400),
      simTime: data.simTime ?? 0,
      report: data.report ?? null,
      objects: data.objects ?? [],
      crowd: this.crowdDots,
    };
    this.bumpReplayVersion();
    this.reindexEventIds();
    this.recomputeMaxSimTime();
    this.cursor = this.maxSimTime();
    this.lastApplied = -1;
    this.lastParentNotify = 0;
    const observe = this.registry.get('observeMode') === true;
    this.playing = observe
      ? this.clockPlaying === true
      : this.clockPlaying ?? true;
    // Prime the first circle before the first paint. pickCurrentTalkEvent
    // without a live id would otherwise pin the last same-hour circle.
    this.primeOpeningCircle();
    this.applyCursor(true);
    this.refreshAgents(true);
    this.refreshHud();
    this.centerOnCrowd();
    // The cursor sits at the tip after a load — play that hour's circles
    // one at a time so generate-complete does not dump every bubble at once.
    this.replayOpeningCircles();
  }

  private appendReplay(data: ReplayPayload): void {
    const oldMax = this.maxSimTime();
    const extra = (data.events ?? []).filter(
      (e) =>
        e.kind !== 'emergence_report' &&
        e.kind !== 'occupancy_ema' &&
        !this.eventIds.has(e.id),
    );
    if (data.crowd?.length) this.crowdDots = data.crowd;
    const prevAgents = new Map(this.replay.agents.map((a) => [a.id, a]));

    if (data.agents?.length) {
      const looksLikePatch = data.agents.every(
        (a) => typeof a.x !== 'number' || typeof a.y !== 'number',
      );
      const isPartial =
        this.replay.agents.length > 0 &&
        data.agents.length < this.replay.agents.length;
      if (looksLikePatch && this.replay.agents.length === 0) {
        // Inspector goal patch arrived before the town roster — ignore.
      } else if (isPartial || looksLikePatch) {
        this.mergeReplayAgents(data.agents);
      } else {
        // Ease every roster jump, not only the ones that land while the cursor
        // happens to sit on the tip: posesAtCursor only applies these to
        // residents whose position actually comes from the roster.
        const now = performance.now();
        for (const a of data.agents) {
          const prev = prevAgents.get(a.id);
          if (!prev || prev.regionId !== a.regionId) {
            this.tipLerp.delete(a.id);
            continue;
          }
          if (prev.x === a.x && prev.y === a.y) continue;
          const existing = this.tipLerp.get(a.id);
          let fromX = prev.x;
          let fromY = prev.y;
          if (existing && existing.regionId === a.regionId) {
            const u = easeSmooth(
              (now - existing.t0) / Math.max(1, existing.dur),
            );
            fromX = existing.fromX + (existing.toX - existing.fromX) * u;
            fromY = existing.fromY + (existing.toY - existing.fromY) * u;
          }
          this.tipLerp.set(a.id, {
            fromX,
            fromY,
            toX: a.x,
            toY: a.y,
            regionId: a.regionId,
            t0: now,
            dur: 2200,
          });
        }
        this.replay.agents = data.agents;
      }
    }
    if (data.objects?.length) this.replay.objects = data.objects;
    if (data.report) this.replay.report = data.report;
    if (typeof data.simTime === 'number') {
      this.replay.simTime = Math.max(this.replay.simTime ?? 0, data.simTime);
    }
    if (extra.length) {
      extra.sort(compareReplayTalkOrder);
      const tail = this.replay.events[this.replay.events.length - 1];
      // Frames normally arrive in order, so the whole buffer only needs a
      // re-sort when something genuinely older shows up.
      if (!tail || extra[0]!.simTime >= tail.simTime) {
        this.replay.events = [...this.replay.events, ...extra];
      } else {
        this.replay.events = [...this.replay.events, ...extra].sort(
          compareReplayTalkOrder,
        );
      }
      for (const e of extra) this.eventIds.add(e.id);
      for (const e of extra) {
        if (e.kind === 'dialogue' || e.kind === 'intervene') {
          this.pinLiveSpeech(e);
          if (typeof e.simTime === 'number') {
            this.cursor = Math.max(this.cursor, e.simTime);
          }
        }
        if (e.kind === 'move' && e.agentId) {
          const prev = prevAgents.get(e.agentId);
          const rid = e.payload['regionId'];
          if (
            prev &&
            typeof rid === 'string' &&
            rid !== prev.regionId
          ) {
            this.tipLerp.delete(e.agentId);
          }
        }
      }
    }
    const MAX_LIVE_EVENTS = 400;
    if (this.replay.events.length > MAX_LIVE_EVENTS) {
      this.replay.events = pinNarrativeEvents(
        this.replay.events,
        MAX_LIVE_EVENTS,
      );
      this.reindexEventIds();
    }
    if (extra.some((e) => e.kind === 'dialogue')) {
      this.refreshListeningCircleTotal();
    }
    this.bumpReplayVersion();
    this.recomputeMaxSimTime();
    const newMax = this.maxSimTime();
    const observe = this.registry.get('observeMode') === true;
    if (
      !this.playing &&
      extra.length &&
      (observe ? this.clockPlaying === true : this.clockPlaying !== false)
    ) {
      this.playing = true;
    }
    const following = this.playing && this.cursor >= oldMax - 0.35;
    // Guests stay unable to scrub, but a local pause must freeze *this*
    // view. Snapping while paused made "pause view" jump to the live tip.
    if (this.lockLiveTip && this.playing) {
      this.cursor = Math.max(this.cursor, newMax);
    } else if (!this.lockLiveTip && following && newMax - this.cursor > 2) {
      this.cursor = Math.max(0, newMax - 1);
    }
    if (data.focusAgentId) {
      const focus = this.replay.agents.find((a) => a.id === data.focusAgentId);
      if (focus) {
        this.selectedId = data.focusAgentId;
        if (this.pinnedAgentId === data.focusAgentId && focus.regionId) {
          this.switchRegion(focus.regionId);
        }
      }
    }
    this.applyCursor();
    this.refreshHud();
  }

  /** One-person inspector patch must not wipe the rest of the town. */
  private mergeReplayAgents(incoming: ReplayAgent[]): void {
    const byId = new Map(incoming.map((a) => [a.id, a]));
    this.replay.agents = this.replay.agents.map((prev) => {
      const a = byId.get(prev.id);
      if (!a) return prev;
      return {
        ...prev,
        ...a,
        x: typeof a.x === 'number' && Number.isFinite(a.x) ? a.x : prev.x,
        y: typeof a.y === 'number' && Number.isFinite(a.y) ? a.y : prev.y,
        currentAction: a.currentAction || prev.currentAction,
        regionId: a.regionId || prev.regionId,
      };
    });
    this.bumpReplayVersion();
  }

  private bindInput(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-SPACE', () => {
      if (this.lockLiveTip) return;
      this.playing = !this.playing;
      this.notifyParent(MSG_LIVE_PAUSE, { paused: !this.playing });
    });
    kb.on('keydown-LEFT', () => {
      if (this.lockLiveTip) return;
      this.cursor = Math.max(0, this.cursor - 1);
      this.lastApplied = -1;
      this.applyCursor();
    });
    kb.on('keydown-RIGHT', () => {
      if (this.lockLiveTip) return;
      this.cursor = Math.min(this.maxSimTime(), this.cursor + 1);
      this.applyCursor();
    });
    kb.on('keydown-ONE', () => {
      if (this.lockLiveTip) return;
      this.speed = 1;
    });
    kb.on('keydown-TWO', () => {
      if (this.lockLiveTip) return;
      this.speed = 2;
    });
    kb.on('keydown-FOUR', () => {
      if (this.lockLiveTip) return;
      this.speed = 4;
    });
    kb.on('keydown-R', () => {
      if (this.lockLiveTip) return;
      this.cursor = this.replay.events[0]?.simTime ?? 0;
      this.lastApplied = -1;
      this.playing = true;
      this.applyCursor();
    });
    kb.on('keydown-M', () => {
      this.toggleBgmMute();
    });
    kb.on('keydown-H', () => {
      this.helpVisible = !this.helpVisible;
      this.refreshHud();
    });
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      const ctx = this.audioContext();
      if (ctx?.state === 'suspended') void ctx.resume();
      const mgr = this.sound as Phaser.Sound.WebAudioSoundManager & {
        unlock?: () => void;
      };
      mgr.unlock?.();
      if (this.bgmNeedsGesture || !this.sound.get('bgm')) {
        this.bgmNeedsGesture = false;
        this.playBgm(true);
      }
      if (this.pointerOnChrome(ptr)) {
        this.cameraDrag = null;
        return;
      }
      this.cameraDrag = { x: ptr.x, y: ptr.y, moved: false };
    });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!this.cameraDrag || !ptr.isDown) return;
      const dx = ptr.x - ptr.prevPosition.x;
      const dy = ptr.y - ptr.prevPosition.y;
      if (!this.cameraDrag.moved) {
        const dist = Math.hypot(ptr.x - this.cameraDrag.x, ptr.y - this.cameraDrag.y);
        if (dist < 8) return;
        this.cameraDrag.moved = true;
        this.lockCameraFromDrag();
      }
      const cam = this.cameras.main;
      const z = cam.zoom || 1;
      cam.stopFollow();
      this.followId = null;
      cam.scrollX -= dx / z;
      cam.scrollY -= dy / z;
    });
    this.input.on('pointerup', () => {
      this.cameraDrag = null;
    });
    this.input.on('pointerupoutside', () => {
      this.cameraDrag = null;
    });
    this.sound.once('unlocked', () => {
      if (this.bgmMuted) return;
      this.bgmNeedsGesture = false;
      this.playBgm(true);
    });
  }

  private onWindowMessage = (ev: MessageEvent): void => {
    const data = ev.data as {
      type?: string;
      payload?: ReplayPayload & {
        agentId?: string;
        regionId?: string;
        cursor?: number;
        playing?: boolean;
        pinned?: boolean;
        speed?: number;
        lockLiveTip?: boolean;
      };
    };
    if (!data?.type) return;
    if (data.type === MSG_REPLAY && data.payload) {
      const p = data.payload;
      if (typeof p.lockLiveTip === 'boolean') this.lockLiveTip = p.lockLiveTip;
      this.applyReplay({
        ...p,
        events: pinNarrativeEvents(p.events ?? [], 400),
      });
    }
    if (data.type === MSG_LOCK_LIVE) {
      if (typeof data.payload?.lockLiveTip === 'boolean') {
        this.lockLiveTip = data.payload.lockLiveTip;
      }
    }
    if (data.type === MSG_APPEND && data.payload) {
      const p = data.payload;
      // Catch-up / coalesced bursts can carry many same-hour circles.
      // A last-N slice used to drop the earlier ones before appendReplay
      // could dedupe by id.
      this.appendReplay({
        ...p,
        events: pinNarrativeEvents(p.events ?? [], 240),
      });
    }
    if (data.type === MSG_SET_PLAYING) {
      if (typeof data.payload?.playing === 'boolean') {
        this.clockPlaying = data.payload.playing;
        this.playing = data.payload.playing;
        if (this.playing && this.lockLiveTip) {
          this.cursor = this.maxSimTime();
          this.applyCursor();
        }
        this.refreshHud();
      }
    }
    if (data.type === MSG_SELECT) {
      const id = data.payload?.agentId ?? data.payload?.focusAgentId;
      if (typeof id === 'string' && id) {
        this.selectedId = id;
        this.refreshAgents(true);
      }
    }
    if (data.type === MSG_PIN) {
      const id = data.payload?.agentId ?? data.payload?.focusAgentId;
      const pinned = data.payload?.pinned !== false;
      if (pinned && typeof id === 'string' && id) {
        this.pinnedAgentId = id;
        this.selectedId = id;
        const pose = this.posesAtCursor().find((p) => p.id === id);
        const regionId = pose?.regionId
          ?? this.replay.agents.find((a) => a.id === id)?.regionId;
        if (regionId) this.switchRegion(regionId);
        this.refreshAgents(true);
        this.refreshHud();
      } else {
        this.pinnedAgentId = null;
        this.userSteeredCamera = false;
        this.updateFollowCam();
        this.refreshHud();
      }
    }
    if (data.type === MSG_SET_SPEED) {
      if (this.lockLiveTip) return;
      const speed = data.payload?.speed;
      if (typeof speed === 'number' && Number.isFinite(speed) && speed > 0) {
        this.speed = Math.max(0.25, Math.min(8, speed));
        this.refreshHud();
      }
    }
    if (data.type === MSG_FOCUS_REGION) {
      const rid = data.payload?.regionId;
      if (typeof rid === 'string' && rid) {
        this.regionPinned = rid;
        this.switchRegion(rid);
        this.refreshHud();
      }
    }
    if (data.type === MSG_SCRUB) {
      if (this.lockLiveTip) return;
      const c = data.payload?.cursor;
      if (typeof c === 'number' && Number.isFinite(c)) {
        this.cursor = Math.max(0, Math.min(this.maxSimTime() || c, c));
        this.lastApplied = -1;
        if (typeof data.payload?.playing === 'boolean') {
          this.playing = data.payload.playing;
        } else {
          this.playing = false;
        }
        this.applyCursor();
        this.refreshHud();
      }
    }
    if (data.type === MSG_BGM) {
      const action = (data.payload as { action?: string } | undefined)?.action;
      if (action === 'toggle') {
        this.toggleBgmMute();
      } else if (action === 'unmute' || action === 'play') {
        this.bgmMuted = false;
        this.bgmNeedsGesture = false;
        this.playBgm(true);
      } else if (action === 'mute') {
        this.bgmMuted = true;
        const bgm = this.sound.get('bgm') as
          | { setVolume?: (v: number) => void }
          | undefined;
        bgm?.setVolume?.(0);
        this.refreshHud();
        this.notifyBgmStatus();
      }
    }
  };

  private bindParentMessages(): void {
    window.addEventListener('message', this.onWindowMessage);
  }

  private notifyParent(type: string, payload: Record<string, unknown>): void {
    try {
      window.parent?.postMessage({ type, payload }, '*');
    } catch {
      // ignore
    }
  }

  /**
   * Put a live exchange on stage as an ordered conversation.
   *
   * The event carries every turn of a finished conversation, so the turns are
   * scheduled on the wall clock: one speaker at a time, each bubble holding for
   * as long as its line takes to read, and the caption following whoever is
   * currently talking.
   */
  private pinLiveSpeech(e: ReplayEvent): void {
    if (e.payload['degraded'] === true) return;
    const now = performance.now();
    if (e.kind === 'intervene' && !e.agentId) {
      // A town-wide whisper is one line the whole town hears at once.
      const line = eventLine(e);
      if (isFillerSpeech(line)) return;
      const holdMs = speechHoldMs(line, this.speechPacing());
      for (const a of this.replay.agents) {
        this.showLiveSpeech(a.id, line, holdMs);
      }
      this.setLiveCaption(line, holdMs);
      return;
    }
    if (!e.agentId) return;
    const turns = this.speechTurnsOf(e);
    if (!turns.length) return;
    const startAtMs = nextCircleStartMs(
      this.speechStageFreeMs,
      now + 80,
      this.conversationOpenStaggerMs(),
    );
    const cues = scheduleConversation(turns, {
      startAtMs,
      pacing: this.speechPacing(),
      busyUntilMs: this.agentSpeechFreeMs,
    });
    if (!cues.length) return;
    const meta = {
      event: e,
      talkSeq: talkSeqOfPayload(e.payload),
      circleIndex: circleIndexOfPayload(e.payload),
    };
    this.speechStageFreeMs = conversationEndMs(cues);
    for (const cue of cues) {
      this.agentSpeechFreeMs.set(cue.speakerId, cue.atMs + cue.holdMs);
      this.queueSpeechCue(cue, now, meta);
    }
  }

  /** Turns in speaking order: resolved speakers, no filler, with an addressee. */
  private speechTurnsOf(e: ReplayEvent): SpeechTurnInput[] {
    const byName = new Map(
      this.replay.agents.map((a) => [a.name, a.id] as const),
    );
    const nameOf = (id: string): string =>
      this.replay.agents.find((a) => a.id === id)?.name ?? '';
    const raw = Array.isArray(e.payload['turns'])
      ? (e.payload['turns'] as Array<{
          text?: unknown;
          speakerId?: unknown;
          speakerName?: unknown;
        }>)
      : [];
    const spoken: SpeechTurnInput[] = [];
    for (const turn of raw) {
      if (typeof turn.text !== 'string' || !turn.text.trim()) continue;
      if (isFillerSpeech(turn.text)) continue;
      let sid = typeof turn.speakerId === 'string' ? String(turn.speakerId) : '';
      if (!sid && typeof turn.speakerName === 'string') {
        sid = byName.get(String(turn.speakerName)) ?? '';
      }
      if (!sid) continue;
      spoken.push({
        speakerId: sid,
        speakerName: nameOf(sid) || undefined,
        text: turn.text.trim(),
      });
    }
    if (!spoken.length) {
      // Older payloads only carry a summary line.
      const line = eventLine(e);
      if (!e.agentId || isFillerSpeech(line)) return [];
      return [
        {
          speakerId: e.agentId,
          speakerName: nameOf(e.agentId) || undefined,
          text: line,
        },
      ];
    }
    const withId =
      typeof e.payload['with'] === 'string' ? String(e.payload['with']) : '';
    return spoken.map((turn, i) => {
      const self = turn.speakerId;
      let to: string | undefined;
      for (let j = i + 1; j < spoken.length && !to; j += 1) {
        if (spoken[j]!.speakerId !== self) to = spoken[j]!.speakerName;
      }
      for (let j = i - 1; j >= 0 && !to; j -= 1) {
        if (spoken[j]!.speakerId !== self) to = spoken[j]!.speakerName;
      }
      if (!to && withId && withId !== self) to = nameOf(withId) || undefined;
      return to ? { ...turn, toName: to } : turn;
    });
  }

  private queueSpeechCue(
    cue: SpeechCue,
    nowMs: number,
    circle?: { event: ReplayEvent; talkSeq: number; circleIndex: number },
  ): void {
    const delay = cue.atMs - nowMs;
    // Anything this far out belongs to a town that has already moved on.
    if (delay > SPEECH_HORIZON_MS) return;
    if (delay <= 0) {
      this.fireSpeechCue(cue, circle);
      return;
    }
    const timer = setTimeout(() => {
      this.liveSpeechTimers.delete(timer);
      this.fireSpeechCue(cue, circle);
    }, delay);
    this.liveSpeechTimers.add(timer);
  }

  private fireSpeechCue(
    cue: SpeechCue,
    circle?: { event: ReplayEvent; talkSeq: number; circleIndex: number },
  ): void {
    if (circle) {
      if (shouldArmCircleStage(this.speechFollowEventId, circle.event.id)) {
        this.liveTalkWith.clear();
        this.rememberLiveTalkPartners(circle.event);
        this.lastTalkEventId = circle.event.id;
        this.playTalkBlip();
        this.followNewSpeech(circle.event);
      }
      this.stageTalkEventId = circle.event.id;
      this.stageTalkSeq = circle.talkSeq;
      this.stageCircleIndex = circle.circleIndex;
    }
    this.showLiveSpeech(cue.speakerId, cue.text, cue.holdMs);
    this.setLiveCaption(this.captionFor(cue), cue.holdMs);
  }

  /** `第2圈 · who → whom · line`, matching the bubble that is on screen right now. */
  private captionFor(cue: SpeechCue): string {
    return liveSpeechCaption({
      text: cue.text,
      speakerName: cue.speakerName,
      toName: cue.toName,
      circleIndex: this.stageCircleIndex,
      ascii: worldHudAscii(this.world),
    });
  }

  private showLiveSpeech(id: string, text: string, holdMs: number): void {
    if (isFillerSpeech(text)) return;
    const now = performance.now();
    for (const [k, v] of this.liveSpeech) {
      if (now >= v.untilMs) this.liveSpeech.delete(k);
    }
    if (
      !this.liveSpeech.has(id) &&
      this.liveSpeech.size >= this.maxConcurrentLiveSpeech()
    ) {
      // Evict the bubble closest to expiry rather than dropping this line;
      // silently discarding was a big part of "the town goes quiet".
      let oldest: string | undefined;
      let oldestUntil = Infinity;
      for (const [k, v] of this.liveSpeech) {
        if (v.untilMs < oldestUntil) {
          oldestUntil = v.untilMs;
          oldest = k;
        }
      }
      if (oldest) this.liveSpeech.delete(oldest);
    }
    this.liveSpeech.set(id, { text, untilMs: now + Math.max(900, holdMs) });
    // Several cues can fire in the same tick — coalesce into one redraw.
    this.agentsDirty = true;
  }

  private setLiveCaption(text: string, holdMs: number): void {
    this.liveCaption = {
      text,
      untilMs: performance.now() + Math.max(900, holdMs),
    };
    this.captionDirty = true;
  }

  /** Drop everything queued: a fresh replay must not keep old lines coming. */
  private resetLiveSpeech(): void {
    for (const timer of this.liveSpeechTimers) clearTimeout(timer);
    this.liveSpeechTimers.clear();
    this.liveSpeech.clear();
    this.liveTalkWith.clear();
    this.agentSpeechFreeMs.clear();
    this.speechStageFreeMs = 0;
    this.liveCaption = null;
    this.captionDirty = true;
    this.speechFollowEventId = null;
    this.pendingSpeechFocus = null;
    this.stageTalkEventId = null;
    this.stageTalkSeq = 0;
    this.stageCircleIndex = 0;
    this.listeningCircleTotal = 0;
  }

  /** Stamp the first tip-hour circle so the first paint is not the last circle. */
  private primeOpeningCircle(): void {
    const opening = openingCirclesAtTip(this.replay.events);
    this.listeningCircleTotal = opening.length;
    const first = opening[0];
    if (!first) return;
    this.stageTalkEventId = first.id;
    this.stageTalkSeq = talkSeqOfPayload(first.payload);
    this.stageCircleIndex = circleIndexOfPayload(first.payload) || 1;
  }

  private refreshListeningCircleTotal(): void {
    this.listeningCircleTotal = openingCirclesAtTip(this.replay.events).length;
  }

  /** After a (re)load, play that hour's circles one at a time. */
  private replayOpeningCircles(): void {
    const opening = openingCirclesAtTip(this.replay.events);
    this.listeningCircleTotal = opening.length;
    if (!this.stageTalkEventId && opening[0]) {
      this.primeOpeningCircle();
    }
    const latest = opening[opening.length - 1];
    if (latest) this.pinLiveSpeech(latest);
  }

  /**
   * Speech pacing knobs, overridable per world through the Phaser registry
   * (seeded from `world.json`) so a talkative town can be tuned without a build.
   */
  private conversationOpenStaggerMs(): number {
    const raw = Number(this.registry.get('speechStaggerMs'));
    if (Number.isFinite(raw) && raw >= 0) return Math.min(4_000, raw);
    return CONVERSATION_OPEN_STAGGER_MS;
  }

  private speechPacing(): SpeechPacing {
    const budget = Number(this.registry.get('speechBudgetMs'));
    if (Number.isFinite(budget) && budget >= 2_000) {
      return {
        ...DEFAULT_SPEECH_PACING,
        budgetMs: Math.min(20_000, budget),
      };
    }
    return DEFAULT_SPEECH_PACING;
  }

  private maxConcurrentLiveSpeech(): number {
    const raw = Number(this.registry.get('maxLiveSpeech'));
    if (Number.isFinite(raw) && raw >= 1) return Math.min(24, Math.floor(raw));
    return MAX_CONCURRENT_LIVE_SPEECH;
  }

  private rememberLiveTalkPartners(e: ReplayEvent): void {
    if (e.kind !== 'dialogue') return;
    const nameOf = (id: string): string =>
      this.replay.agents.find((a) => a.id === id)?.name ?? '';
    const ids: string[] = [];
    const participants = e.payload['participants'];
    if (Array.isArray(participants)) {
      for (const id of participants) {
        if (typeof id === 'string' && id) ids.push(id);
      }
    }
    if (typeof e.agentId === 'string' && e.agentId) ids.push(e.agentId);
    if (typeof e.payload['with'] === 'string') ids.push(String(e.payload['with']));
    const turns = Array.isArray(e.payload['turns'])
      ? (e.payload['turns'] as Array<{ speakerId?: unknown; speakerName?: unknown }>)
      : [];
    const byName = new Map(this.replay.agents.map((a) => [a.name, a.id] as const));
    for (const turn of turns) {
      if (typeof turn.speakerId === 'string' && turn.speakerId) {
        ids.push(turn.speakerId);
      } else if (typeof turn.speakerName === 'string') {
        const sid = byName.get(String(turn.speakerName));
        if (sid) ids.push(sid);
      }
    }
    const unique = [...new Set(ids.filter(Boolean))];
    for (const id of unique) {
      const other = unique.find((x) => x !== id);
      const nm = other ? nameOf(other) : '';
      if (nm) this.liveTalkWith.set(id, nm);
    }
  }

  private speechBubbleText(raw: string): string {
    const t = raw.trim();
    if (!t) return '';
    const wrapped = t.length > 72 ? `${t.slice(0, 70)}…` : t;
    const chars = [...wrapped];
    if (chars.length <= 18) return wrapped;
    const lines: string[] = [];
    for (let i = 0; i < chars.length; i += 18) {
      lines.push(chars.slice(i, i + 18).join(''));
    }
    return lines.slice(0, 3).join('\n');
  }

  private actionGlyphFor(p: AgentPose): string {
    if (p.actionGlyph) return p.actionGlyph;
    const act = p.action ?? '';
    const low = act.toLowerCase();
    if (
      low.includes('talking') ||
      act.includes('交谈') ||
      p.talkWith
    ) {
      return '💬';
    }
    if (
      act.includes('热闹') ||
      act.includes('围观') ||
      low.includes('crowd')
    ) {
      return '👀';
    }
    if (
      act.includes('去找') ||
      act.includes('找人') ||
      act.includes('赴约') ||
      low.includes('looking for') ||
      low.includes('promised meeting') ||
      low.includes('going to talk')
    ) {
      return '🔎';
    }
    if (
      act.includes('饿') ||
      act.includes('吃') ||
      act.includes('餐') ||
      low.includes('hungry') ||
      low.includes('galley') ||
      low.includes('refectory')
    ) {
      return '🍽️';
    }
    if (
      act.includes('睡') ||
      act.includes('休息') ||
      low.includes('sleep') ||
      low.includes('tired') ||
      low.includes('rests') ||
      low.includes('bunk')
    ) {
      return '💤';
    }
    if (act.includes('烘') || act.includes('烤') || act.includes('面包')) return '🍞';
    if (act.includes('打铁') || act.includes('锤')) return '⚒️';
    if (act.includes('上课') || act.includes('学堂') || act.includes('读')) return '📖';
    if (act.includes('酒') || act.includes('吧台')) return '🍺';
    if (act.includes('干活') || act.includes('工作') || act.includes('记账')) return '🛠️';
    if (
      act.includes('前往') ||
      low.includes('walk') ||
      low.includes('move') ||
      low.includes('heading')
    ) {
      return '🚶';
    }
    if (act.includes('whisper') || act.includes('耳语')) return '🤫';
    if (low.includes('idle') || !act.trim()) return '';
    return '';
  }

  private bumpReplayVersion(): void {
    this.replayVersion += 1;
    this.poseCache = null;
    this.objectCache = null;
  }

  private reindexEventIds(): void {
    this.eventIds = new Set(this.replay.events.map((e) => e.id));
  }

  /**
   * Poses for the current cursor, memoized on `(replayVersion, cursor)`.
   *
   * The `tipLerp` tween is wall-clock driven, so it cannot live in the memo —
   * it is re-applied to shallow copies on every call, leaving the cached array
   * pristine for the rest of the frame.
   */
  private posesAtCursor(): AgentPose[] {
    const key = `${this.replayVersion}:${this.cursor.toFixed(5)}`;
    let base = this.poseCache?.key === key ? this.poseCache.poses : undefined;
    if (!base) {
      base = this.scanPosesAtCursor();
      this.poseCache = { key, poses: base };
    }
    if (this.tipLerp.size === 0) return base;
    const now = performance.now();
    return base.map((p) => {
      const lerp = this.tipLerp.get(p.id);
      // Only residents standing on a roster position may be eased — easing one
      // who is mid-path between keyframes would fight the recorded walk.
      if (!lerp || !p.fromSnapshot || p.regionId !== lerp.regionId) return p;
      const u = easeSmooth((now - lerp.t0) / lerp.dur);
      if (u >= 1) this.tipLerp.delete(p.id);
      return {
        ...p,
        x: lerp.fromX + (lerp.toX - lerp.fromX) * u,
        y: lerp.fromY + (lerp.toY - lerp.fromY) * u,
      };
    });
  }

  private scanPosesAtCursor(): AgentPose[] {
    const pose = new Map<string, AgentPose>();
    for (const a of this.replay.agents) {
      pose.set(a.id, {
        id: a.id,
        name: a.name,
        regionId: a.regionId,
        x: a.x,
        y: a.y,
        action: a.currentAction,
        talkWith: partnerFromAction(a.currentAction),
        goalX: a.goalX,
        goalY: a.goalY,
        goalPlace: a.goalPlace,
        goalReason: a.goalReason,
        drive: a.drive,
      });
    }
    // Seed from Spec NPCs if replay agents empty
    if (!pose.size && this.world.entities) {
      for (const e of this.world.entities) {
        if (e.kind !== 'npc') continue;
        pose.set(e.id, {
          id: e.id,
          name: e.name,
          regionId: e.regionId,
          x: e.pos.x,
          y: e.pos.y,
          action: 'idle',
        });
      }
    }

    type Kf = {
      t: number;
      x: number;
      y: number;
      regionId: string;
      action: string;
    };
    const lastKf = new Map<string, Kf>();
    const nextKf = new Map<string, Kf>();
    // Past the cursor the only remaining work is one look-ahead keyframe per
    // agent for interpolation, so stop as soon as everyone has theirs.
    let awaitingNextKf = pose.size;
    const currentTalk = pickCurrentTalkEvent(
      this.replay.events,
      this.cursor,
      this.stageTalkEventId,
    );

    for (const e of this.replay.events) {
      if (e.simTime > this.cursor && awaitingNextKf <= 0) break;
      if (e.simTime <= this.cursor && e.kind === 'intervene' && !e.agentId) {
        const summary = eventLine(e);
        for (const p of pose.values()) {
          p.action = 'whispered';
          p.bubble = summary;
          p.bubbleUntil = e.simTime + 5;
        }
        continue;
      }
      if (!e.agentId) continue;
      const cur = pose.get(e.agentId);
      if (!cur) continue;
      if (e.kind === 'move' || e.kind === 'action' || e.kind === 'use-object') {
        const x =
          typeof e.payload['x'] === 'number' ? Number(e.payload['x']) : cur.x;
        const y =
          typeof e.payload['y'] === 'number' ? Number(e.payload['y']) : cur.y;
        const regionId =
          typeof e.payload['regionId'] === 'string'
            ? String(e.payload['regionId'])
            : cur.regionId;
        const action =
          e.kind === 'use-object'
            ? typeof e.payload['action'] === 'string'
              ? String(e.payload['action'])
              : typeof e.payload['name'] === 'string'
                ? String(e.payload['name'])
                : cur.action
            : typeof e.payload['activity'] === 'string'
              ? String(e.payload['activity'])
              : cur.action;
        if (e.simTime <= this.cursor) {
          lastKf.set(e.agentId, {
            t: e.simTime,
            x,
            y,
            regionId,
            action,
          });
          const prevRegion = cur.regionId;
          cur.x = x;
          cur.y = y;
          cur.regionId = regionId;
          cur.action = action;
          const talkingWith =
            typeof e.payload['talkingWith'] === 'string'
              ? String(e.payload['talkingWith']).trim()
              : '';
          const fromAct = partnerFromAction(action);
          if (talkingWith) cur.talkWith = talkingWith;
          else if (fromAct) cur.talkWith = fromAct;
          else if (action !== 'talking') cur.talkWith = undefined;
          if (regionId !== prevRegion) {
            const dest = this.regionName(regionId);
            cur.action = worldHudAscii(this.world)
              ? `heading to ${dest}`
              : `前往${dest}`;
            cur.actionGlyph = '🚶';
          }
          if (e.payload['reason'] === 'seek-talk') {
            cur.action = worldHudAscii(this.world)
              ? 'going to talk'
              : '去找人说';
            cur.actionGlyph = '👋';
          }
          if (e.kind === 'use-object') {
            cur.actionGlyph = objectGlyph(
              typeof e.payload['name'] === 'string'
                ? String(e.payload['name'])
                : action,
            );
          }
          if (typeof e.payload['goalX'] === 'number') {
            cur.goalX = Number(e.payload['goalX']);
          }
          if (typeof e.payload['goalY'] === 'number') {
            cur.goalY = Number(e.payload['goalY']);
          }
          if (typeof e.payload['goalPlace'] === 'string') {
            cur.goalPlace = String(e.payload['goalPlace']);
          }
          if (typeof e.payload['goalReason'] === 'string') {
            cur.goalReason = String(e.payload['goalReason']);
          }
          if (typeof e.payload['drive'] === 'string') {
            cur.drive = String(e.payload['drive']);
          }
        } else if (!nextKf.has(e.agentId)) {
          nextKf.set(e.agentId, {
            t: e.simTime,
            x,
            y,
            regionId,
            action,
          });
          awaitingNextKf -= 1;
        }
      }
      if (e.simTime > this.cursor) continue;
      if (e.kind === 'dialogue') {
        if (e.payload['degraded'] === true) continue;
        if (!currentTalk || e.id !== currentTalk.id) continue;
        const turns = Array.isArray(e.payload['turns'])
          ? (e.payload['turns'] as Array<{
              text?: unknown;
              speakerName?: unknown;
              speakerId?: unknown;
            }>)
          : [];
        const byName = new Map(
          [...pose.values()].map((p) => [p.name, p.id] as const),
        );
        const participantIds = Array.isArray(e.payload['participants'])
          ? (e.payload['participants'] as unknown[]).filter(
              (id): id is string => typeof id === 'string' && Boolean(id),
            )
          : [];
        const withId =
          typeof e.payload['with'] === 'string' ? String(e.payload['with']) : '';
        const speakerIds: string[] = [];
        let pinned = 0;
        for (const turn of turns) {
          if (typeof turn.text !== 'string' || !turn.text.trim()) continue;
          let sid =
            typeof turn.speakerId === 'string' ? String(turn.speakerId) : '';
          if (!sid && typeof turn.speakerName === 'string') {
            sid = byName.get(String(turn.speakerName)) ?? '';
          }
          const who = sid ? pose.get(sid) : undefined;
          if (!who) continue;
          if (isFillerSpeech(String(turn.text))) continue;
          if (sid) speakerIds.push(sid);
          who.action = 'talking';
          who.actionGlyph = '💬';
          who.bubble = String(turn.text);
          // Replay the exchange as a sequence when scrubbing, too.
          who.bubbleAt = e.simTime + pinned * 0.55;
          who.bubbleUntil = who.bubbleAt + 2.2;
          pinned += 1;
        }
        const circle = [
          ...new Set(
            [
              ...participantIds,
              ...speakerIds,
              e.agentId,
              withId,
            ].filter((id): id is string => Boolean(id)),
          ),
        ];
        for (const id of circle) {
          const who = pose.get(id);
          if (!who) continue;
          const other = circle.find((x) => x !== id);
          const otherPose = other ? pose.get(other) : undefined;
          who.talkWith = otherPose?.name ?? who.talkWith;
          who.action = 'talking';
          who.actionGlyph = '💬';
        }
        if (!pinned) {
          const t0 =
            typeof turns[0]?.text === 'string' ? turns[0].text : eventLine(e);
          if (!isFillerSpeech(t0) && e.payload['degraded'] !== true) {
          cur.action = 'talking';
          cur.actionGlyph = '💬';
          cur.bubble = t0;
          cur.bubbleAt = e.simTime;
          cur.bubbleUntil = e.simTime + 4;
          const otherId =
            typeof e.payload['with'] === 'string'
              ? String(e.payload['with'])
              : '';
          const other = otherId ? pose.get(otherId) : undefined;
          const t1 =
            typeof turns[1]?.text === 'string' ? turns[1].text : '';
          if (other && t1 && !isFillerSpeech(t1)) {
            other.action = 'talking';
            other.actionGlyph = '💬';
            other.bubble = t1;
            other.bubbleAt = e.simTime + 0.55;
            other.bubbleUntil = e.simTime + 4;
          }
          }
        }
      } else if (e.kind === 'intervene') {
        const summary = eventLine(e);
        cur.action = 'whispered';
        cur.actionGlyph = '🤫';
        cur.bubble = summary;
        cur.bubbleUntil = e.simTime + 5;
      } else if (
        (e.kind === 'plan' || e.kind === 'reflection') &&
        this.cursor - e.simTime < 2
      ) {
        cur.actionGlyph = e.kind === 'plan' ? '📋' : '💭';
      }
    }

    const roster = new Map(this.replay.agents.map((a) => [a.id, a]));
    for (const p of pose.values()) {
      const a = lastKf.get(p.id);
      const b = nextKf.get(p.id);
      if (a && b && a.regionId === b.regionId && b.t > a.t) {
        // Between two recorded keyframes: walk the path that was actually taken.
        const u = easeSmooth((this.cursor - a.t) / (b.t - a.t));
        p.x = a.x + (b.x - a.x) * u;
        p.y = a.y + (b.y - a.y) * u;
        p.regionId = a.regionId;
      } else if (!b) {
        /**
         * Nothing newer than the cursor is recorded for this resident, so the
         * live roster is the honest continuation of their walk.
         *
         * This used to be one global "cursor is within 0.08 of the tip" switch,
         * which flipped the whole town between roster and trail every time a
         * frame pushed the tip forward: residents who had already arrived
         * snapped back to wherever the retained trail last saw them and then
         * walked in again.
         */
        const snap = roster.get(p.id);
        if (snap) {
          if (snap.regionId) p.regionId = snap.regionId;
          if (Number.isFinite(snap.x)) p.x = snap.x;
          if (Number.isFinite(snap.y)) p.y = snap.y;
          p.fromSnapshot = true;
        }
      }
      if (p.bubbleUntil != null && this.cursor > p.bubbleUntil) {
        p.bubble = undefined;
        p.bubbleAt = undefined;
      }
      if (p.action === 'idle' || p.action === 'talking') {
        p.actionGlyph = p.action === 'talking' ? '💬' : undefined;
      }
    }
    return [...pose.values()];
  }

  private applyCursor(forceNotify = false): void {
    const poses = this.posesAtCursor();
    const counts = new Map<string, number>();
    for (const p of poses) {
      counts.set(p.regionId, (counts.get(p.regionId) ?? 0) + 1);
    }
    let best = this.regionId;
    const followId = this.pinnedAgentId;
    const selectedPose = followId
      ? poses.find((p) => p.id === followId)
      : undefined;
    if (selectedPose) {
      best = selectedPose.regionId;
    } else if (
      this.regionPinned &&
      this.world.space.regions.some((r) => r.id === this.regionPinned)
    ) {
      best = this.regionPinned;
    } else {
      let bestN = -1;
      for (const [rid, n] of counts) {
        if (n > bestN) {
          best = rid;
          bestN = n;
        }
      }
    }
    if (best && best !== this.regionId && best !== this.pendingRegionId) {
      const pinned = this.regionPinned;
      const selected = Boolean(this.pinnedAgentId);
      const followingSpeech =
        this.liveSpeech.size > 0 &&
        shouldFollowSpeech({
          pinnedAgentId: this.pinnedAgentId,
          regionPinned: this.regionPinned,
          userSteeredCamera: this.userSteeredCamera,
        });
      if (selected || pinned) {
        this.switchRegion(best);
      } else if (followingSpeech) {
        // Speakers already framed this region; do not jump to the crowd.
      } else {
        const here = counts.get(this.regionId) ?? 0;
        const there = counts.get(best) ?? 0;
        const now = this.time.now;
        if (
          there > here &&
          now - this.lastAutoRegionSwitch > 4000
        ) {
          this.lastAutoRegionSwitch = now;
          this.switchRegion(best);
        }
      }
    }

    this.refreshAgents(false, poses);
    this.refreshObjects();
    this.refreshSubtitle();

    this.notifyParentThrottled(forceNotify, {
      cursor: this.cursor,
      regionId: this.regionId,
      caption: this.liveCaption?.text ?? null,
      talkSeq: this.stageTalkSeq || null,
      circleIndex: this.stageCircleIndex || null,
      listeningCircle: this.stageCircleIndex || null,
      listeningTotal: this.listeningCircleTotal || null,
    });
    this.lastApplied = this.cursor;
  }

  /**
   * Bottom caption. While a scheduled line is on stage it wins, so the subtitle
   * names the resident whose bubble is currently up instead of the last line of
   * the batch. Falls back to the newest event at or before the cursor, which is
   * what scrubbing needs.
   */
  private refreshSubtitle(): void {
    this.captionDirty = false;
    const live =
      this.liveCaption && performance.now() < this.liveCaption.untilMs
        ? this.liveCaption.text
        : null;
    // The parent overlays this caption outside the canvas, so changes are pushed
    // as they happen rather than waiting for the cursor throttle.
    if (live !== this.lastNotifiedCaption) {
      this.lastNotifiedCaption = live;
      this.notifyParent(MSG_CURSOR, {
        cursor: this.cursor,
        regionId: this.regionId,
        caption: live,
        talkSeq: this.stageTalkSeq || null,
        circleIndex: this.stageCircleIndex || null,
        listeningCircle: this.stageCircleIndex || null,
        listeningTotal: this.listeningCircleTotal || null,
      });
    }
    if (live) {
      // Observatory parent already draws the HTML caption — do not stack a
      // second line on the canvas over the followed pair.
      if (window.parent !== window) {
        this.subtitle.setText('');
      } else {
        this.subtitle.setText(live.slice(0, 180));
      }
      return;
    }
    // events is sorted by simTime, so walk back from the tip and stop at the
    // first hit instead of copying and filtering the whole buffer each frame.
    let recent: ReplayEvent | undefined;
    for (let i = this.replay.events.length - 1; i >= 0; i -= 1) {
      const e = this.replay.events[i]!;
      if (e.simTime > this.cursor) continue;
      if (e.kind !== 'dialogue' && e.kind !== 'intervene') continue;
      if (e.payload['degraded'] === true) continue;
      const line = addressedEventLine(e, this.replay.agents);
      if (line.trim().length < 4 || isFillerSpeech(line)) continue;
      recent = e;
      break;
    }
    if (recent) {
      if (recent.id !== this.lastTalkEventId) {
        this.lastTalkEventId = recent.id;
        this.playTalkBlip();
      }
      if (window.parent !== window) {
        this.subtitle.setText('');
        return;
      }
      const line = addressedEventLine(recent, this.replay.agents);
      const ascii = worldHudAscii(this.world);
      const rumor = recent.payload['kind'] === 'rumor' || recent.payload['town'] === true;
      const whisper = recent.kind === 'intervene';
      const tag = rumor
        ? ascii
          ? ' (rumor) '
          : '（传闻）'
        : recent.payload['interview'] === true
          ? ascii
            ? ' (interview) '
            : '（采访）'
          : whisper
            ? ascii
              ? ' (whisper) '
              : '（耳语）'
            : '';
      this.subtitle.setText(`${tag}${line}`.slice(0, 180));
    } else if (!this.playing) {
      const observe = this.lockLiveTip;
      this.subtitle.setText(
        observe
          ? worldHudAscii(this.world)
            ? 'Your view is paused · the shared clock still runs'
            : '画面已停 · 镇上的钟还在走'
          : worldHudAscii(this.world)
            ? 'Paused · Continue or press Space'
            : '已暂停 · 点「继续推演」或按空格',
      );
    } else {
      const spread = this.replay.report?.informationSpread?.rate;
      const ascii = worldHudAscii(this.world);
      const observe = this.lockLiveTip;
      this.subtitle.setText(
        observe
          ? ascii
            ? 'Watching the shared town · it walks while someone is here'
            : '围观中 · 有人看着，镇子自己走'
          : spread != null
            ? ascii
              ? `Live · spread ${Math.round(spread * 100)}% · Space to pause`
              : `推演中 · 信息扩散 ${Math.round(spread * 100)}% · 空格暂停`
            : ascii
              ? 'Live · waiting for the next beat (people walk and talk on their own)'
              : '推演中 · 等待下一步（居民会自己走动与交谈）',
      );
    }
  }

  private notifyParentThrottled(
    force: boolean,
    payload: Record<string, unknown>,
  ): void {
    const now = this.time.now;
    if (!force && now - this.lastParentNotify < 500) return;
    this.lastParentNotify = now;
    this.notifyParent(MSG_CURSOR, payload);
  }

  /**
   * Split the stage across two cameras: the main one frames and zooms the town,
   * a second draws chrome at 1:1. Scroll-locked HUD still scales with camera
   * zoom, so without the split a zoomed town shrank the clock and pushed the
   * minimap out of its corner.
   */
  private setupCameras(): void {
    const chrome: Phaser.GameObjects.GameObject[] = [
      this.nightVeil,
      this.duskGlow,
      this.navLayer,
      this.minimapTerrain,
      this.minimap,
      this.hoverHint,
      this.hud,
      this.subtitle,
    ];
    const town: Phaser.GameObjects.GameObject[] = [
      this.mapLayer,
      this.structureLayer,
      this.objectLayer,
      this.agentLayer,
      this.speechLayer,
    ];
    const cam = this.cameras.add(
      0,
      0,
      this.scale.width,
      this.scale.height,
      false,
      'chrome',
    );
    cam.transparent = true;
    this.hudCam = cam;
    this.cameras.main.ignore(chrome);
    cam.ignore(town);
  }

  /**
   * Fill the pane with the town instead of parking it in a corner.
   *
   * Bounds were previously floored at 800x600: whenever they were smaller than
   * the viewport Phaser clamped the scroll to their origin, which is what pinned
   * small regions to the top-left with dead space around them.
   */
  private applyCameraFit(): void {
    const cam = this.cameras.main;
    if (!cam || !this.mapPixelW || !this.mapPixelH) return;
    const frame = fitTownCamera({
      mapW: this.mapPixelW,
      mapH: this.mapPixelH,
      viewW: cam.width,
      viewH: cam.height,
    });
    cam.setZoom(frame.zoom);
    if (frame.bounded) {
      cam.setBounds(0, 0, this.mapPixelW, this.mapPixelH);
    } else {
      cam.removeBounds();
    }
    if (this.pendingSpeechFocus) {
      const focus = speechFocusPoint(
        this.pendingSpeechFocus.x,
        this.pendingSpeechFocus.y,
      );
      cam.centerOn(focus.x, focus.y);
      this.pendingSpeechFocus = null;
    } else if (
      !this.followId &&
      !this.userSteeredCamera &&
      !this.speechFollowEventId
    ) {
      cam.centerOn(frame.centerX, frame.centerY);
    }
  }

  private layoutChrome(): void {
    const cam = this.cameras.main;
    const w = cam.width || 800;
    const h = cam.height || 600;
    this.hudCam?.setSize(w, h);
    this.nightVeil?.setPosition(0, 0).setSize(w, h);
    this.duskGlow?.setPosition(0, 0).setSize(w, Math.max(120, h * 0.45));
    this.hud?.setPosition(12, 10);
    this.hoverHint?.setPosition(12, 48);
    this.subtitle
      ?.setOrigin(0, 1)
      .setPosition(12, h - 10)
      .setWordWrapWidth(Math.max(220, w - 148));
    this.applyCameraFit();
  }

  private refreshHud(): void {
    const region = this.world.space.regions.find((r) => r.id === this.regionId);
    const title = this.world.meta?.title ?? 'Town';
    const ascii = worldHudAscii(this.world);
    const clock = formatTownClock(
      this.cursor,
      this.world.presentation?.genreProfile?.clock,
      ascii,
    );
    const observe = this.lockLiveTip;
    const live = this.playing
      ? observe
        ? ascii
          ? 'watching'
          : '围观中'
        : ascii
          ? 'live'
          : '推演中'
      : observe
        ? ascii
          ? 'view paused'
          : '画面已停'
        : ascii
          ? 'paused'
          : '已暂停';
    const mute = this.bgmMuted ? (ascii ? ' · muted' : ' · 静音') : '';
    const camLocked =
      Boolean(this.pinnedAgentId) ||
      Boolean(this.regionPinned) ||
      this.userSteeredCamera;
    const camHint = ascii
      ? camLocked
        ? 'locked'
        : 'follow talk'
      : camLocked
        ? '已锁定'
        : '跟随对话';
    this.hud.setText(
      this.helpVisible
        ? [
            `🏘 ${title.slice(0, 18)} · ${region?.name ?? this.regionId} · ${clock} · ${live}×${this.speed}`,
            observe
              ? ascii
                ? 'Click a person · follows talk · pin or drag to lock · H hide · M mute'
                : '点人查看 · 跟随对话 · 钉住或拖地图 · H 收起 · M 静音'
              : ascii
                ? 'Click a person · follows talk · pin or drag to lock · Space pause · H hide · M mute · R rewind'
                : '点人查看 · 跟随对话 · 钉住或拖地图锁定 · 空格暂停 · H 收起 · M 静音 · R 回看',
          ].join('\n')
        : `🏘 ${region?.name ?? this.regionId} · ${clock} · ${live}×${this.speed}${mute} · ${camHint} · ${ascii ? 'H help' : 'H 帮助'}`,
    );
    this.refreshSky();
  }

  private refreshSky(): void {
    if (!this.nightVeil) return;
    const hour = ((this.cursor % 24) + 24) % 24;
    const clockKind = this.world.presentation?.genreProfile?.clock?.kind;
    let veil = 0;
    let veilColor = 0x020617;
    let glow = 0;
    let glowColor = 0xea580c;
    if (clockKind === 'watch') {
      veil = 0.28;
      veilColor = 0x0b1220;
      glow = 0.04;
      glowColor = 0x38bdf8;
    } else if (clockKind === 'event') {
      veil = 0.12;
      veilColor = 0x1e1b4b;
      glow = 0.06;
      glowColor = 0xc4b5fd;
    } else if (hour >= 21 || hour < 5) {
      veil = 0.68;
      veilColor = 0x020617;
    } else if (hour >= 18.5 || hour < 6.2) {
      veil = 0.38;
      veilColor = 0x1e3a5f;
      glow = hour >= 18.5 ? 0.14 : 0.18;
      glowColor = hour >= 18.5 ? 0xfb923c : 0xf97316;
    } else if (hour >= 6.2 && hour < 8) {
      veil = 0.16;
      veilColor = 0x9a3412;
      glow = 0.12;
      glowColor = 0xfdba74;
    } else if (hour >= 16 && hour < 18.5) {
      veil = 0.08;
      veilColor = 0x9a3412;
      glow = 0.07;
      glowColor = 0xfb923c;
    }
    this.nightVeil.setFillStyle(veilColor, veil);
    this.duskGlow?.setFillStyle(glowColor, glow);
  }

  private destroyAgentGfx(gfx: {
    body: Phaser.GameObjects.Sprite;
    shadow: Phaser.GameObjects.Ellipse;
    glyph: Phaser.GameObjects.Text;
    label: Phaser.GameObjects.Text;
    bubble: Phaser.GameObjects.Text;
    bubbleBg: Phaser.GameObjects.Graphics;
    highlight: Phaser.GameObjects.Ellipse;
  }): void {
    gfx.body.destroy();
    gfx.shadow.destroy();
    gfx.glyph.destroy();
    gfx.label.destroy();
    gfx.bubble.destroy();
    gfx.bubbleBg.destroy();
    gfx.highlight.destroy();
  }

  private ensureWalkAnims(atlasKey: string): void {
    const dirs = ['down', 'left', 'right', 'up'] as const;
    for (const dir of dirs) {
      const walkKey = `${atlasKey}_walk_${dir}`;
      const idleKey = `${atlasKey}_idle_${dir}`;
      if (!this.anims.exists(walkKey)) {
        try {
          this.anims.create({
            key: walkKey,
            frames: this.anims.generateFrameNames(atlasKey, {
              prefix: `walk_${dir}_`,
              start: 0,
              end: 2,
            }),
            frameRate: 10,
            repeat: -1,
          });
        } catch {
          /* atlas frames may be missing */
        }
      }
      if (!this.anims.exists(idleKey)) {
        try {
          this.anims.create({
            key: idleKey,
            frames: this.anims.generateFrameNames(atlasKey, {
              prefix: `walk_${dir}_`,
              start: 0,
              end: 0,
            }),
            frameRate: 1,
            repeat: 0,
          });
        } catch {
          /* optional */
        }
      }
    }
  }

  private layoutBubble(
    gfx: {
      bubble: Phaser.GameObjects.Text;
      bubbleBg: Phaser.GameObjects.Graphics;
    },
    x: number,
    y: number,
    text: string,
    slot = 0,
    clusterSize = 1,
  ): ChromeRect {
    const shown = this.speechBubbleText(text);
    const cluster = chromeClusterSlot(slot, clusterSize, this.tileSize);
    const lift = agentChromeLift(this.tileSize).bubbleLift(cluster.bubbleTier);
    const ox = cluster.bubbleDx;
    const depth = ySortDepth(y);
    gfx.bubble.setText(shown).setVisible(true);
    gfx.bubble.setPosition(x + ox, y - lift);
    gfx.bubble.setDepth(speechBubbleTextDepth(depth));
    const w = Math.max(28, gfx.bubble.width + 14);
    const h = Math.max(18, gfx.bubble.height + 10);
    gfx.bubbleBg.clear();
    gfx.bubbleBg.setPosition(x + ox, y - lift);
    gfx.bubbleBg.setDepth(speechBubbleBgDepth(depth));
    gfx.bubbleBg.fillStyle(0xfffbeb, 0.94);
    gfx.bubbleBg.lineStyle(1, 0xd97706, 0.85);
    gfx.bubbleBg.fillRoundedRect(-w / 2, -h, w, h, 6);
    gfx.bubbleBg.strokeRoundedRect(-w / 2, -h, w, h, 6);
    gfx.bubbleBg.fillTriangle(-5, -2, 5, -2, 0, 9);
    gfx.bubbleBg.setVisible(true);
    return chromeOriginBottomRect(x + ox, y - lift, w, h);
  }

  private refreshAgents(_force: boolean, poses?: AgentPose[]): void {
    try {
      this.refreshAgentsUnsafe(_force, poses);
    } catch (err) {
      console.warn('[society] refreshAgents failed', err);
    }
  }

  private drawCrowdDots(): void {
    if (!this.crowdGfx || !this.crowdGfx.active) {
      this.crowdGfx = this.add.graphics();
      this.agentLayer?.add(this.crowdGfx);
    }
    this.crowdGfx.clear();
    const zoom = this.cameras.main?.zoom || 1;
    if (zoom < 0.35) return;
    const here = this.crowdDots
      .filter((d) => !this.regionId || d.regionId === this.regionId)
      .slice(0, zoom < 0.8 ? 40 : 120);
    for (const dot of here) {
      const color = dot.stance >= 0.4 ? 0x16a34a : dot.stance <= -0.4 ? 0xdc2626 : 0x94a3b8;
      this.crowdGfx.fillStyle(color, 0.85);
      this.crowdGfx.fillCircle(
        dot.x * this.tileSize + this.tileSize / 2,
        dot.y * this.tileSize + this.tileSize / 2,
        Math.max(2, this.tileSize * 0.08),
      );
    }
  }

  private refreshAgentsUnsafe(_force: boolean, poses?: AgentPose[]): void {
    this.drawCrowdDots();
    if (!this.talkArcs || !this.talkArcs.active) {
      this.talkArcs = this.add.graphics();
      this.agentLayer?.add(this.talkArcs);
    }
    const list = poses ?? this.posesAtCursor();
    const visible = list.filter((p) => p.regionId === this.regionId);
    const clusters = chromeClusters(visible);
    const seen = new Set<string>();
    const talking = new Set<string>();
    const nowMs = performance.now();
    const atLiveTip = this.cursor >= this.maxSimTime() - 0.02;
    for (const [id, live] of this.liveSpeech) {
      if (nowMs >= live.untilMs) {
        this.liveSpeech.delete(id);
        this.liveTalkWith.delete(id);
      }
    }
    this.talkArcs.clear();
    const bubbleCands: Array<{
      id: string;
      partner?: string;
      gfx: {
        bubble: Phaser.GameObjects.Text;
        bubbleBg: Phaser.GameObjects.Graphics;
      };
      bx: number;
      by: number;
      text: string;
      live: boolean;
      slot: number;
      clusterSize: number;
    }> = [];

    for (const p of visible) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      seen.add(p.id);
      let gfx = this.agentGfx.get(p.id);
      const spread = crowdSpread(visible, p.id);
      const px = p.x * this.tileSize + this.tileSize / 2 + spread.dx;
      const py = p.y * this.tileSize + this.tileSize * 0.85 + spread.dy;
      if (!gfx) {
        const colors = [0x38bdf8, 0xa78bfa, 0xfbbf24, 0x34d399, 0xf472b6];
        const color = colors[Math.abs(hash(p.id)) % colors.length]!;
        // One drawn pixel person per resident. AI walk sheets and photo
        // portraits change size and face between loads, which is the weird look.
        let texKey: string;
        let atlasKey: string | undefined;
        const drawn = this.ensureCharacterAtlas(p.id, p.name);
        if (drawn) {
          texKey = drawn;
          atlasKey = drawn;
        } else {
          texKey = this.ensurePortrait(p.id, p.name, color);
        }
        if (atlasKey) this.ensureWalkAnims(atlasKey);
        const shadow = this.add
          .ellipse(px, py + 4, this.tileSize * 0.55, this.tileSize * 0.22, 0x000000, 0.28);
        const highlight = this.add
          .ellipse(px, py + 2, this.tileSize * 1.35, this.tileSize * 0.55, 0xfbbf24, 0.22)
          .setVisible(false);
        const body = this.add.sprite(px, py, texKey);
        if (atlasKey) {
          // A canvas atlas defaults to the whole sheet; start on a real frame.
          const first = charFrameName('down', 0);
          if (this.textures.get(texKey).has(first)) body.setFrame(first);
        }
        body
          .setDisplaySize(
            this.tileSize * (atlasKey ? 0.95 : 0.9),
            this.tileSize * (atlasKey ? 1.25 : 0.9),
          )
          .setOrigin(0.5, 1)
          .setInteractive({ useHandCursor: true });
        body.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
          ptr.event?.stopPropagation?.();
          this.selectedId = p.id;
          this.notifyParent(MSG_SELECT, { agentId: p.id, name: p.name });
        });
        body.on('pointerover', () => {
          this.hoverAgentId = p.id;
          const now = this.posesAtCursor().find((x) => x.id === p.id);
          const action =
            now?.action ||
            p.action ||
            (worldHudAscii(this.world) ? 'idle' : '闲逛');
          const why = now?.goalReason?.trim();
          this.hoverHint
            ?.setText(
              why
                ? `${p.name} · ${action} · ${why.slice(0, 28)}`
                : `${p.name} · ${action}`,
            )
            .setVisible(true);
          this.notifyParent(MSG_HOVER, {
            agentId: p.id,
            name: p.name,
            action,
            regionId: now?.regionId ?? p.regionId,
          });
        });
        body.on('pointerout', () => {
          if (this.hoverAgentId === p.id) this.hoverAgentId = null;
          this.hoverHint?.setVisible(false);
          this.notifyParent(MSG_HOVER, { agentId: null });
        });
        const glyph = this.add
          .text(px, py - this.tileSize * 0.55, '', {
            fontFamily: UI_FONT,
            fontSize: fontPx(16),
            color: '#0f172a',
            fontStyle: 'bold',
          })
          .setOrigin(0.5, 0.5)
          .setVisible(false);
        const nameLift = agentChromeLift(this.tileSize).nameLift;
        const label = this.add
          .text(px, py - nameLift, labelText(p), {
            fontFamily: UI_FONT,
            fontSize: fontPx(13),
            color: '#f8fafc',
            backgroundColor: '#0f172acc',
            padding: { x: 5, y: 3 },
          })
          .setOrigin(0.5, 1);
        const bubbleBg = this.add.graphics().setVisible(false);
        const bubble = this.add
          .text(px, py - agentChromeLift(this.tileSize).bubbleLift(0), '', {
            fontFamily: UI_FONT,
            fontSize: fontPx(15),
            color: '#0f172a',
            align: 'center',
            wordWrap: { width: 240 },
          })
          .setOrigin(0.5, 1)
          .setVisible(false);
        this.agentLayer.add([highlight, shadow, body, glyph, label]);
        this.speechLayer.add([bubbleBg, bubble]);
        gfx = {
          body,
          shadow,
          glyph,
          label,
          bubble,
          bubbleBg,
          highlight,
          dir: 'down',
          ...(atlasKey ? { atlasKey } : {}),
        };
        this.agentGfx.set(p.id, gfx);
      } else {
        const dist = Math.hypot(px - gfx.body.x, py - gfx.body.y);
        const dx = px - gfx.body.x;
        const dy = py - gfx.body.y;
        if (dist > this.tileSize * 6) {
          gfx.body.setPosition(px, py);
        } else {
          gfx.body.setPosition(
            gfx.body.x + dx * 0.38,
            gfx.body.y + dy * 0.38,
          );
        }
        const partnerName =
          p.talkWith ||
          partnerFromAction(p.action) ||
          this.liveTalkWith.get(p.id);
        if (!partnerName && dist > 0.8) {
          gfx.dir = walkDirFromDelta(dx, dy);
        }
      }

      const bx = gfx.body.x;
      const by = gfx.body.y;
      const depth = ySortDepth(by);
      gfx.body.setDepth(depth);
      gfx.shadow
        .setDepth(depth - 1)
        .setPosition(bx, by + 4)
        .setVisible((this.cameras.main?.zoom || 1) >= 0.6);
      gfx.highlight.setDepth(depth - 2).setPosition(bx, by + 2);
      gfx.glyph.setDepth(depth + 1).setPosition(bx, by - this.tileSize * 0.55);
      const cluster = clusters.get(p.id) ?? { index: 0, size: 1 };
      const nameSlot = chromeClusterSlot(
        cluster.index,
        cluster.size,
        this.tileSize,
      );
      const zoom = this.cameras.main?.zoom || 1;
      gfx.label
        .setOrigin(0.5, 1)
        .setDepth(nameplateDepth(depth))
        .setVisible(zoom >= 0.55 || this.selectedId === p.id)
        .setPosition(
          bx + nameSlot.nameDx,
          by - agentChromeLift(this.tileSize).nameLift - nameSlot.nameDy,
        );
      gfx.bubble.setDepth(speechBubbleTextDepth(depth));
      gfx.bubbleBg.setDepth(speechBubbleBgDepth(depth));
      gfx.body.setAlpha(this.selectedId === p.id ? 1 : 0.95);
      const partnerName =
        p.talkWith ||
        partnerFromAction(p.action) ||
        this.liveTalkWith.get(p.id);
      const labeled = { ...p, talkWith: partnerName ?? p.talkWith };
      const live = this.liveSpeech.get(p.id);
      const liveLine =
        live && performance.now() < live.untilMs ? live.text : '';
      // Replay bubbles expire against the cursor, which stops moving once it
      // reaches the tip — that is how bubbles used to hang around until the next
      // frame arrived. At the tip the scheduled live cues own the bubbles, and
      // they always expire on the wall clock.
      const replayLine =
        atLiveTip || (p.bubbleAt != null && this.cursor < p.bubbleAt)
          ? undefined
          : p.bubble;
      const speech = liveLine || replayLine;
      const shown =
        speech && !isFillerSpeech(speech) ? speech : undefined;
      gfx.label.setText(
        labelText(labeled, {
          selected: this.selectedId === p.id,
          hovered: this.hoverAgentId === p.id,
          speech: Boolean(speech),
          clusterSize: cluster.size,
        }),
      );
      gfx.label.setBackgroundColor(
        this.selectedId === p.id ? '#b45309cc' : '#0f172acc',
      );
      gfx.bubble.setVisible(false);
      gfx.bubbleBg.clear().setVisible(false);
      if (shown) {
        talking.add(p.id);
        bubbleCands.push({
          id: p.id,
          partner: partnerName,
          gfx,
          bx,
          by,
          text: shown,
          live: Boolean(liveLine),
          slot: cluster.index,
          clusterSize: cluster.size,
        });
      }
      if (partnerName) talking.add(p.id);
      const other = partnerName
        ? list.find(
            (o) =>
              o.regionId === this.regionId &&
              (o.name === partnerName || o.id === partnerName),
          )
        : undefined;
      if (other) {
        const ox = other.x * this.tileSize + this.tileSize / 2;
        const oy = other.y * this.tileSize + this.tileSize * 0.85;
        gfx.dir = walkDirFromDelta(ox - px, oy - py);
      }
      // Never draw chest action glyphs — names and bubbles already say enough.
      gfx.glyph.setVisible(false);
      const moving =
        !partnerName &&
        (Math.hypot(px - gfx.body.x, py - gfx.body.y) > 0.4 ||
          (p.action ?? '').includes('前往') ||
          /walk|move|heading/i.test(p.action ?? ''));
      if (gfx.atlasKey) {
        // Side-view towns: left/right use flipX on the right-facing sheet.
        // Up/down keep the same side portrait — do not treat a flop as a face.
        const sheetDir = gfx.dir === 'left' ? 'right' : gfx.dir;
        const anim = `${gfx.atlasKey}_${moving ? 'walk' : 'idle'}_${sheetDir}`;
        gfx.body.setFlipX(gfx.dir === 'left');
        const still = charFrameName('down', 0);
        const sheet = this.textures.get(gfx.body.texture.key);
        if (sheet.has(still)) {
          if (gfx.body.anims.isPlaying) gfx.body.anims.stop();
          if (gfx.body.frame.name !== still) gfx.body.setFrame(still);
        } else if (this.anims.exists(anim) && gfx.body.anims.currentAnim?.key !== anim) {
          gfx.body.play(anim, true);
        }
      } else {
        // A single portrait has no frames to cycle, so it at least faces its
        // travel direction and bounces while walking instead of gliding.
        gfx.body.setFlipX(gfx.dir === 'left');
        const squash = moving
          ? 1 + Math.sin(nowMs / 90 + hash(p.id)) * 0.05
          : 1;
        gfx.body.setDisplaySize(
          this.tileSize * 0.9,
          this.tileSize * 0.9 * squash,
        );
      }
    }

    const onePerTalk = new Map<string, (typeof bubbleCands)[number]>();
    for (const cand of bubbleCands) {
      const key = [cand.id, cand.partner ?? ''].sort().join('|');
      const prev = onePerTalk.get(key);
      if (!prev || (cand.live && !prev.live)) onePerTalk.set(key, cand);
    }
    const speechRects: ChromeRect[] = [...onePerTalk.values()]
      .sort((a, b) => Number(b.live) - Number(a.live))
      .slice(0, MAX_VISIBLE_BUBBLES)
      .sort((a, b) => a.by - b.by || a.bx - b.bx)
      .map((b) =>
        this.layoutBubble(
          b.gfx,
          b.bx,
          b.by,
          b.text,
          b.slot,
          b.clusterSize,
        ),
      );
    for (const gfx of this.agentGfx.values()) {
      if (!gfx.label.visible) continue;
      const nameRect = chromeOriginBottomRect(
        gfx.label.x,
        gfx.label.y,
        gfx.label.width,
        gfx.label.height,
      );
      if (shouldHideNameUnderSpeech(nameRect, speechRects)) {
        gfx.label.setVisible(false);
      }
    }
    this.speechLayer.setDepth(8000);
    this.children.bringToTop(this.speechLayer);

    this.drawTalkArcs(visible, list);
    this.drawGoalMarkers(visible);

    const groupTalk = talking.size >= 2;
    for (const [id, gfx] of this.agentGfx) {
      const pile = clusters.get(id)?.size ?? 1;
      const liveOrPicked =
        this.selectedId === id || this.liveSpeech.has(id);
      gfx.highlight.setVisible(
        liveOrPicked || (groupTalk && talking.has(id) && pile < 3),
      );
      gfx.highlight.setFillStyle(
        this.selectedId === id ? 0x38bdf8 : 0xfbbf24,
        this.selectedId === id ? 0.35 : 0.22,
      );
      if (!seen.has(id)) {
        this.destroyAgentGfx(gfx);
        this.agentGfx.delete(id);
      }
    }
    this.updateFollowCam();
    this.fadeChromeForSpeechFollow();
    // The minimap only conveys coarse positions, so 20fps is plenty and it keeps
    // its redraw off the critical path of a busy frame.
    if (nowMs - this.lastMinimapAt >= MINIMAP_INTERVAL_MS) {
      this.lastMinimapAt = nowMs;
      this.refreshMinimap(list);
    }
  }

  private drawTalkArcs(visible: AgentPose[], list: AgentPose[]): void {
    const drawn = new Set<string>();
    const clusters = chromeClusters(visible);
    this.talkArcs.lineStyle(2, 0xfbbf24, 0.88);
    // One index instead of a linear find per talking resident.
    const byNameOrId = new Map<string, AgentPose>();
    for (const o of list) {
      if (o.regionId !== this.regionId) continue;
      if (!byNameOrId.has(o.name)) byNameOrId.set(o.name, o);
      byNameOrId.set(o.id, o);
    }
    for (const p of visible) {
      const partnerName =
        p.talkWith ||
        partnerFromAction(p.action) ||
        this.liveTalkWith.get(p.id);
      if (!partnerName) continue;
      const other = byNameOrId.get(partnerName);
      if (!other) continue;
      const pile = Math.max(
        clusters.get(p.id)?.size ?? 1,
        clusters.get(other.id)?.size ?? 1,
      );
      if (
        !shouldDrawTalkArc({
          speakerId: p.id,
          partnerId: other.id,
          selectedId: this.selectedId,
          liveSpeechIds: new Set(this.liveSpeech.keys()),
          clusterSize: pile,
        })
      ) {
        continue;
      }
      const key = [p.id, other.id].sort().join('|');
      if (drawn.has(key)) continue;
      drawn.add(key);
      const a = this.agentGfx.get(p.id);
      const b = this.agentGfx.get(other.id);
      if (!a || !b) continue;
      const x1 = a.body.x;
      const y1 = a.body.y - this.tileSize * 0.32;
      const x2 = b.body.x;
      const y2 = b.body.y - this.tileSize * 0.32;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const bulge = Math.min(32, len * 0.28);
      const cx = mx + (-dy / len) * bulge;
      const cy = my + (dx / len) * bulge;
      // Phaser.Graphics has no quadratic-curve primitive — walk the Bézier by hand.
      this.talkArcs.beginPath();
      this.talkArcs.moveTo(x1, y1);
      const segs = 8;
      for (let i = 1; i <= segs; i += 1) {
        const t = i / segs;
        const u = 1 - t;
        const qx = u * u * x1 + 2 * u * t * cx + t * t * x2;
        const qy = u * u * y1 + 2 * u * t * cy + t * t * y2;
        this.talkArcs.lineTo(qx, qy);
      }
      this.talkArcs.strokePath();
      const ax = x2 - (dx / len) * 10;
      const ay = y2 - (dy / len) * 10;
      this.talkArcs.fillStyle(0xfbbf24, 0.9);
      this.talkArcs.fillTriangle(
        x2,
        y2,
        ax - (-dy / len) * 4,
        ay - (dx / len) * 4,
        ax + (-dy / len) * 4,
        ay + (dx / len) * 4,
      );
    }
    const bodyDepth = Math.min(
      ...[...this.agentGfx.values()].map((g) => g.body.depth),
      ySortDepth(0),
    );
    this.talkArcs.setDepth(talkArcDepth(bodyDepth));
  }

  private drawGoalMarkers(visible: AgentPose[]): void {
    const clusters = chromeClusters(visible);
    for (const p of visible) {
      if ((clusters.get(p.id)?.size ?? 1) >= 3) continue;
      if (p.goalX == null || p.goalY == null) continue;
      const gfx = this.agentGfx.get(p.id);
      if (!gfx) continue;
      const gx = p.goalX * this.tileSize + this.tileSize / 2;
      const gy = p.goalY * this.tileSize + this.tileSize * 0.85;
      const alpha = this.selectedId === p.id ? 0.75 : 0.28;
      this.talkArcs.lineStyle(1, 0xfde68a, alpha);
      this.talkArcs.beginPath();
      this.talkArcs.moveTo(gfx.body.x, gfx.body.y);
      this.talkArcs.lineTo(gx, gy);
      this.talkArcs.strokePath();
      this.talkArcs.fillStyle(0xf59e0b, alpha);
      this.talkArcs.fillCircle(gx, gy, 5);
    }
  }

  private updateFollowCam(): void {
    const followId = this.pinnedAgentId;
    if (followId) {
      const gfx = this.agentGfx.get(followId);
      if (gfx) {
        if (this.followId !== followId) {
          this.cameras.main.startFollow(gfx.body, true, 0.12, 0.12);
          this.followId = followId;
        }
        return;
      }
    }
    if (this.followId) {
      this.cameras.main.stopFollow();
      this.followId = null;
      if (!this.userSteeredCamera && !this.speechFollowEventId) {
        this.applyCameraFit();
      }
    }
  }

  private pointerOnChrome(ptr: Phaser.Input.Pointer): boolean {
    if (this.hoverAgentId) return true;
    const hits = this.input.hitTestPointer(ptr);
    for (const obj of hits) {
      if (obj === this.hud || obj === this.subtitle || obj === this.hoverHint) {
        return true;
      }
      if (this.navLabels.some((n) => n.label === obj)) return true;
      for (const gfx of this.agentGfx.values()) {
        if (obj === gfx.body) return true;
      }
    }
    return false;
  }

  private lockCameraFromDrag(): void {
    if (this.userSteeredCamera) return;
    this.userSteeredCamera = true;
    this.refreshHud();
  }

  private fadeChromeForSpeechFollow(): void {
    const following =
      this.liveSpeech.size > 0 &&
      shouldFollowSpeech({
        pinnedAgentId: this.pinnedAgentId,
        regionPinned: this.regionPinned,
        userSteeredCamera: this.userSteeredCamera,
      });
    const a = following ? 0.28 : 1;
    this.minimap?.setAlpha(a);
    this.minimapTerrain?.setAlpha(a);
    const follow = following ? this.speechFollowScreenPoint() : null;
    this.navLayer?.setAlpha(
      regionNavAlpha({
        following,
        followScreenY: follow?.y,
      }),
    );
    this.hud?.setAlpha(following ? 0.45 : 1);
    this.subtitle?.setAlpha(following ? 0.2 : 1);
  }

  /** Frame a newly staged exchange; yield if the observer has locked the camera. */
  private followNewSpeech(e: ReplayEvent): void {
    if (this.speechFollowEventId === e.id) return;
    this.speechFollowEventId = e.id;
    if (
      !shouldFollowSpeech({
        pinnedAgentId: this.pinnedAgentId,
        regionPinned: this.regionPinned,
        userSteeredCamera: this.userSteeredCamera,
      })
    ) {
      return;
    }
    const mid = this.speechMidpoint(this.speechSpeakerIds(e));
    if (!mid) return;
    if (mid.regionId !== this.regionId) {
      this.pendingSpeechFocus = { x: mid.x, y: mid.y };
      this.switchRegion(mid.regionId);
      return;
    }
    const focus = speechFocusPoint(mid.x, mid.y);
    this.panToSpeech(focus.x, focus.y);
  }

  private speechSpeakerIds(e: ReplayEvent): string[] {
    const ids = new Set<string>();
    if (e.agentId) ids.add(e.agentId);
    const withId = e.payload['with'];
    if (typeof withId === 'string' && withId) ids.add(withId);
    const participants = e.payload['participants'];
    if (Array.isArray(participants)) {
      for (const id of participants) {
        if (typeof id === 'string' && id) ids.add(id);
      }
    }
    for (const t of this.speechTurnsOf(e)) ids.add(t.speakerId);
    return [...ids];
  }

  private speechMidpoint(
    ids: string[],
  ): { x: number; y: number; regionId: string } | null {
    if (!ids.length) return null;
    const poses = this.posesAtCursor();
    const roster = new Map(this.replay.agents.map((a) => [a.id, a]));
    const pts: Array<{ x: number; y: number; regionId: string }> = [];
    for (const id of ids) {
      const p = poses.find((x) => x.id === id);
      const a = roster.get(id);
      const regionId = p?.regionId ?? a?.regionId;
      const x = p?.x ?? a?.x;
      const y = p?.y ?? a?.y;
      if (
        !regionId ||
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      ) {
        continue;
      }
      pts.push({ x, y, regionId });
    }
    if (!pts.length) return null;
    const counts = new Map<string, number>();
    for (const p of pts) {
      counts.set(p.regionId, (counts.get(p.regionId) ?? 0) + 1);
    }
    let regionId = pts[0]!.regionId;
    let best = -1;
    for (const [rid, n] of counts) {
      if (n > best) {
        regionId = rid;
        best = n;
      }
    }
    const here = pts.filter((p) => p.regionId === regionId);
    const mx = here.reduce((s, p) => s + p.x, 0) / here.length;
    const my = here.reduce((s, p) => s + p.y, 0) / here.length;
    return {
      regionId,
      x: mx * this.tileSize + this.tileSize / 2,
      y: my * this.tileSize + this.tileSize * 0.85,
    };
  }

  private panToSpeech(x: number, y: number): void {
    const cam = this.cameras.main;
    cam.stopFollow();
    this.followId = null;
    if (typeof cam.pan === 'function') {
      cam.pan(x, y, 420, 'Sine.easeInOut', true);
    } else {
      cam.centerOn(x, y);
    }
  }

  /**
   * Reuses a pooled tile image, growing the pool on demand.
   *
   * Region switching used to `removeAll(true)` and re-`add.image()` the whole
   * grid — 400+ create/destroy cycles every time, and the observatory switches
   * regions on its own every few seconds.
   */
  private tileAt(index: number): Phaser.GameObjects.Image {
    let tile = this.tilePool[index];
    if (!tile || !tile.active) {
      tile = this.add.image(0, 0, this.assetKeys.tile);
      this.tilePool[index] = tile;
      this.mapLayer.add(tile);
    }
    return tile;
  }

  private drawRegion(regionId: string): void {
    const region = this.world.space.regions.find((r) => r.id === regionId);
    if (!region) return;

    const palette = this.world.styleAnchor?.palette ?? [];
    const ground = palette[0]
      ? Phaser.Display.Color.HexStringToColor(palette[0]).color
      : region.kind === 'wilderness'
        ? 0x1b4332
        : region.kind === 'interior'
          ? 0x6b4f3a
          : 0x2d6a4f;
    const accent = palette[1]
      ? Phaser.Display.Color.HexStringToColor(palette[1]).color
      : 0x40916c;
    const dirt = palette[2]
      ? Phaser.Display.Color.HexStringToColor(palette[2]).color
      : 0x52796f;
    const haze = 0x243d4a;

    if (!this.tileFill || !this.tileFill.active) {
      this.tileFill = this.add.graphics();
      this.mapLayer.add(this.tileFill);
    }
    const g = this.tileFill;
    g.clear();
    let tilesUsed = 0;
    const hasSheet = this.textures.exists(this.assetKeys.tileset);
    const kindKey: Record<number, string> = {
      1: this.assetKeys.tile,
      2: this.assetKeys.path,
      3: this.assetKeys.wall,
      4: this.assetKeys.water,
      5: this.assetKeys.decor,
    };
    const tm = this.tilemaps.get(regionId);
    const rows = (region.layoutAscii ?? '')
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.trimEnd());
    const width = tm?.width ?? region.width;
    const height = tm?.height ?? region.height;

    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const ch = rows[ty]?.[tx] ?? '.';
        const gid = tm?.gids[ty * width + tx];
        const wall = ch === '#' || ch === 'X' || gid === 3;
        const water = ch === '~' || gid === 4;
        const path = ch === '=' || gid === 2;
        const decor = ch === '*' || gid === 5;
        const cx = tx * this.tileSize + this.tileSize / 2;
        const cy = ty * this.tileSize + this.tileSize / 2;
        const frame = gid ? gid - 1 : wall ? 2 : water ? 3 : path ? 1 : decor ? 4 : 0;
        const depth = wall || decor ? ySortDepth(cy, wall ? 12 : 8) : 0;
        if (hasSheet) {
          this.tileAt(tilesUsed++)
            .setTexture(this.assetKeys.tileset, frame)
            .setPosition(cx, cy)
            .setDisplaySize(this.tileSize, this.tileSize)
            .setDepth(depth)
            .setVisible(true);
          continue;
        }
        const tex =
          kindKey[gid ?? (wall ? 3 : water ? 4 : path ? 2 : decor ? 5 : 1)];
        if (tex && this.textures.exists(tex)) {
          this.tileAt(tilesUsed++)
            .setTexture(tex)
            .setPosition(cx, cy)
            .setDisplaySize(this.tileSize, this.tileSize)
            .setDepth(depth)
            .setVisible(true);
          continue;
        }
        const far = ty < height * 0.28;
        const fill = wall
          ? 0x1b4332
          : water
            ? 0x1d4e89
            : path
              ? 0x8b7355
              : decor
                ? accent
                : far
                  ? haze
                  : (tx * 17 + ty * 31) % 7 === 0
                    ? accent
                    : ground;
        g.fillStyle(fill, 1);
        g.fillRect(
          tx * this.tileSize,
          ty * this.tileSize,
          this.tileSize,
          this.tileSize,
        );
        if (decor) {
          g.fillStyle(0x3f6212, 0.35);
          g.fillRect(
            tx * this.tileSize + 8,
            ty * this.tileSize + 8,
            this.tileSize - 16,
            this.tileSize - 16,
          );
        } else if (!wall && !water && !path && (tx * 13 + ty * 19) % 5 === 0) {
          g.fillStyle(dirt, 0.35);
          g.fillRect(
            tx * this.tileSize + 6,
            ty * this.tileSize + 6,
            this.tileSize - 12,
            this.tileSize - 12,
          );
        }
      }
    }
    g.setDepth(0);
    for (let i = tilesUsed; i < this.tilePool.length; i += 1) {
      this.tilePool[i]?.setVisible(false);
    }

    this.drawStructures(region, rows, width, height);
    this.refreshObjects();

    this.cameras.main.fadeIn(280, 15, 23, 42);

    this.mapPixelW = width * this.tileSize;
    this.mapPixelH = height * this.tileSize;
    this.applyCameraFit();
  }

  /**
   * Minimap terrain is static per region and viewport, so it lives on its own
   * Graphics. Redrawing those 400+ fillRects under the agent dots every frame was
   * one of the biggest per-frame costs in the observatory.
   */
  private refreshMinimapTerrain(
    region: { width: number; height: number; layoutAscii?: string },
    box: { x: number; y: number; w: number; h: number },
  ): void {
    const { x, y, w, h } = box;
    const sx = w / Math.max(1, region.width);
    const sy = h / Math.max(1, region.height);
    const g = this.minimapTerrain;
    g.clear();
    g.fillStyle(0x0f172a, 0.72);
    g.fillRoundedRect(x - 4, y - 4, w + 8, h + 8, 6);
    g.fillStyle(0x1a3d2a, 0.92);
    g.fillRect(x, y, w, h);
    const rows = (region.layoutAscii ?? '')
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.trimEnd());
    const roofs = interiorWallCellKeys(
      region.layoutAscii,
      region.width,
      region.height,
    );
    for (let ty = 0; ty < region.height; ty++) {
      for (let tx = 0; tx < region.width; tx++) {
        const ch = rows[ty]?.[tx] ?? '.';
        const fill = minimapTerrainFill(ch, {
          interiorWall: roofs.has(`${tx},${ty}`),
          far: ty < region.height * 0.28,
        });
        g.fillStyle(fill.color, fill.alpha);
        g.fillRect(x + tx * sx, y + ty * sy, sx, sy);
      }
    }
  }

  private worldToChromeScreen(
    wx: number,
    wy: number,
  ): { x: number; y: number } {
    const cam = this.cameras.main;
    return {
      x: (wx - cam.scrollX) * cam.zoom,
      y: (wy - cam.scrollY) * cam.zoom,
    };
  }

  private speechFollowScreenPoint(): { x: number; y: number } | null {
    if (this.pendingSpeechFocus) {
      return this.worldToChromeScreen(
        this.pendingSpeechFocus.x,
        this.pendingSpeechFocus.y,
      );
    }
    const staged = this.stageTalkEventId
      ? this.replay.events.find((e) => e.id === this.stageTalkEventId)
      : undefined;
    const mid = staged
      ? this.speechMidpoint(this.speechSpeakerIds(staged))
      : null;
    if (!mid) return null;
    return this.worldToChromeScreen(mid.x, mid.y);
  }

  private refreshMinimap(poses: AgentPose[]): void {
    if (!this.minimap) return;
    const region = this.world.space.regions.find((r) => r.id === this.regionId);
    if (!region) return;
    const cam = this.cameras.main;
    const viewW = cam.width || 800;
    const viewH = cam.height || 600;
    const following =
      this.liveSpeech.size > 0 &&
      shouldFollowSpeech({
        pinnedAgentId: this.pinnedAgentId,
        regionPinned: this.regionPinned,
        userSteeredCamera: this.userSteeredCamera,
      });
    const follow = following ? this.speechFollowScreenPoint() : null;
    this.minimapDock = follow
      ? minimapDockForFollow({
          following: true,
          screenX: follow.x,
          screenY: follow.y,
          viewW,
          viewH,
        })
      : 'bottom-right';
    const { x, y, w, h } = minimapBox(viewW, viewH, this.minimapDock);
    const sx = w / Math.max(1, region.width);
    const sy = h / Math.max(1, region.height);
    const terrainKey = `${this.regionId}:${x}:${y}`;
    if (this.minimapTerrainKey !== terrainKey) {
      this.minimapTerrainKey = terrainKey;
      this.refreshMinimapTerrain(region, { x, y, w, h });
    }
    this.minimap.clear();
    const here = poses.filter((p) => p.regionId === this.regionId);
    for (const p of here) {
      const spread = crowdSpread(here, p.id);
      this.minimap.fillStyle(
        this.selectedId === p.id
          ? 0xfbbf24
          : p.talkWith || p.bubble
            ? 0xf472b6
            : 0x38bdf8,
        1,
      );
      this.minimap.fillCircle(
        x + (p.x + spread.dx / this.tileSize) * sx,
        y + (p.y + spread.dy / this.tileSize) * sy,
        2.4,
      );
    }
  }

  private objectsFromWorld(): ReplayObject[] {
    const out: ReplayObject[] = [];
    for (const area of this.world.space.areas ?? []) {
      for (const o of area.objects ?? []) {
        out.push({
          id: o.id,
          name: o.name,
          state: o.state ?? '',
          regionId: area.regionId,
          areaName: area.name,
        });
      }
    }
    return out;
  }

  /** Memoized on `(replayVersion, cursor)` like {@link posesAtCursor}. */
  private objectStatesAtCursor(): ReplayObject[] {
    const key = `${this.replayVersion}:${this.cursor.toFixed(5)}`;
    if (this.objectCache?.key === key) return this.objectCache.objects;
    const base =
      this.replay.objects?.length ? this.replay.objects : this.objectsFromWorld();
    const byId = new Map(base.map((o) => [o.id, { ...o }]));
    for (const e of this.replay.events) {
      if (e.simTime > this.cursor) break;
      if (e.kind !== 'use-object' && e.kind !== 'observe') continue;
      const id = e.payload['objectId'];
      const state = e.payload['state'];
      if (typeof id !== 'string' || typeof state !== 'string') continue;
      const cur = byId.get(id);
      if (cur) cur.state = state;
    }
    const objects = [...byId.values()];
    this.objectCache = { key, objects };
    return objects;
  }

  private objectCell(
    o: { id: string; name: string; x?: number; y?: number },
    region: { width: number; height: number; layoutAscii?: string },
  ): { x: number; y: number } {
    if (typeof o.x === 'number' && typeof o.y === 'number') {
      return { x: o.x, y: o.y };
    }
    return placeAnchorCell(o.name, o.id, region);
  }

  /**
   * Roofs on interior wall blobs, crop/fence pads around field and coop
   * anchors, and a faint far band so the ground is not a dead green slab.
   */
  private drawStructures(
    region: WorldRegion,
    rows: string[],
    width: number,
    height: number,
  ): void {
    if (!this.structureLayer) return;
    if (!this.structureGfx || !this.structureGfx.active) {
      this.structureGfx = this.add.graphics();
      this.structureLayer.add(this.structureGfx);
    }
    const g = this.structureGfx;
    g.clear();
    for (const tree of this.structureTrees) tree.destroy();
    this.structureTrees = [];
    const ts = this.tileSize;
    const palette = placePalette(
      region.id,
      this.world.styleAnchor?.palette,
    );
    const roofHex =
      region.kind === 'wilderness' || region.kind === 'town'
        ? palette.wood
        : palette.roof;
    const roofDarkHex = shadeHex(roofHex, 0.72);
    const roof = Number.parseInt(roofHex.slice(1), 16);
    const roofDark = Number.parseInt(roofDarkHex.slice(1), 16);
    const wheat = Number.parseInt(palette.wheat.slice(1), 16);
    const wood = Number.parseInt(palette.wood.slice(1), 16);

    g.fillStyle(0x1e3a4a, 0.16);
    g.fillRect(0, 0, width * ts, Math.max(ts * 2, height * ts * 0.22));

    const layout = rows.join('\n');
    for (const cluster of interiorWallClusters(layout, width, height)) {
      const door = cluster.door;
      for (const cell of cluster.cells) {
        const gap =
          door && cell.x === door.x && cell.y === door.y - 1;
        const px = cell.x * ts;
        const py = cell.y * ts;
        const inset = 3;
        g.fillStyle(roofDark, 0.92);
        g.fillRect(px + inset, py + inset, ts - inset * 2, ts * 0.42);
        if (!gap) {
          g.fillStyle(roof, 0.88);
          g.fillRect(
            px + inset + 2,
            py + ts * 0.28,
            ts - inset * 2 - 4,
            ts * 0.38,
          );
        }
        g.fillStyle(0xfde68a, 0.28);
        g.fillRect(px + ts * 0.45, py + inset, 3, ts * 0.22);
      }
      if (cluster.door) {
        const dx = cluster.door.x * ts;
        const dy = cluster.door.y * ts;
        g.fillStyle(0x4b2e1e, 0.8);
        g.fillRect(dx + ts * 0.28, dy + ts * 0.15, ts * 0.44, ts * 0.7);
        g.fillStyle(0xfde68a, 0.35);
        g.fillCircle(dx + ts * 0.62, dy + ts * 0.48, 3);
      }
    }

    const treeKey = this.ensurePlaceTexture('tree');
    for (const cell of decorCells(region.layoutAscii, width, height)) {
      const cx = cell.x * ts + ts / 2;
      const cy = cell.y * ts + ts / 2;
      if (treeKey) {
        const tree = this.add
          .image(cx, cy, treeKey)
          .setDisplaySize(ts * 0.95, ts * 0.95)
          .setDepth(1);
        this.structureLayer.add(tree);
        this.structureTrees.push(tree);
      } else {
        g.fillStyle(0x3f6212, 0.85);
        g.fillCircle(cx, cy - 4, ts * 0.28);
        g.fillStyle(0x6b3f22, 0.9);
        g.fillRect(cx - 3, cy, 6, ts * 0.28);
      }
    }

    const pads = this.objectStatesAtCursor().filter(
      (o) => o.regionId === this.regionId,
    );
    for (const o of pads) {
      const kind = placeKindFromName(o.name);
      if (kind !== 'field' && kind !== 'coop') continue;
      const origin = this.objectCell(o, region);
      for (const cell of placePadCells(
        origin,
        kind,
        width,
        height,
        region.layoutAscii,
      )) {
        const px = cell.x * ts;
        const py = cell.y * ts;
        if (kind === 'field') {
          g.fillStyle(0x6b4f3a, 0.45);
          g.fillRect(px + 4, py + 8, ts - 8, ts - 14);
          g.fillStyle(wheat, 0.7);
          g.fillRect(px + 8, py + 6, 3, ts * 0.45);
          g.fillRect(px + ts * 0.55, py + 8, 3, ts * 0.4);
        } else {
          g.fillStyle(wood, 0.75);
          g.fillRect(px + 4, py + ts * 0.55, ts - 8, 5);
          g.fillRect(px + 6, py + ts * 0.4, 4, ts * 0.35);
        }
      }
    }
  }

  private refreshObjects(): void {
    if (!this.objectLayer) return;
    const region = this.world.space.regions.find((r) => r.id === this.regionId);
    if (!region) return;
    const list = this.objectStatesAtCursor().filter(
      (o) => o.regionId === this.regionId,
    );
    // "Recently used" only spans 1.5 sim-hours, so walk back from the cursor and
    // stop instead of touching the whole buffer every redraw.
    const used = new Set<string>();
    for (let i = this.replay.events.length - 1; i >= 0; i -= 1) {
      const e = this.replay.events[i]!;
      if (e.simTime > this.cursor) continue;
      if (this.cursor - e.simTime > 1.5) break;
      if (e.kind !== 'use-object') continue;
      const id = e.payload['objectId'];
      if (typeof id === 'string') used.add(id);
    }
    const seen = new Set<string>();
    for (const o of list) {
      seen.add(o.id);
      const cell = this.objectCell(o, region);
      const px = cell.x * this.tileSize + this.tileSize / 2;
      const py = cell.y * this.tileSize + this.tileSize / 2;
      let gfx = this.objectGfx.get(o.id);
      const hot = used.has(o.id);
      const crowdAtCell = this.posesAtCursor().filter(
        (p) =>
          p.regionId === this.regionId &&
          Math.round(p.x) === Math.round(cell.x) &&
          Math.round(p.y) === Math.round(cell.y),
      ).length;
      const showLabel = shouldShowObjectLabel({
        hot,
        hovered: this.hoverObjectId === o.id,
        crowdAtCell,
      });
      const kind = placeKindFromName(o.name);
      const tex = this.ensurePlaceTexture(kind);
      if (gfx && tex && !('setTexture' in gfx.mark)) {
        gfx.mark.destroy();
        gfx.glow?.destroy();
        gfx.label.destroy();
        this.objectGfx.delete(o.id);
        gfx = undefined;
      }
      if (!gfx) {
        const glow = this.add
          .circle(px, py, this.tileSize * 0.4, 0xf59e0b, 0)
          .setStrokeStyle(2, 0xfde68a, 0)
          .setDepth(ySortDepth(py, 3));
        const mark = tex
          ? this.add
              .image(px, py, tex)
              .setDisplaySize(this.tileSize * 0.9, this.tileSize * 0.9)
              .setDepth(ySortDepth(py, 4))
              .setInteractive({ useHandCursor: true })
          : this.add
              .circle(px, py, this.tileSize * 0.22, hot ? 0xf59e0b : 0x94a3b8, 0.9)
              .setStrokeStyle(1, hot ? 0xfde68a : 0xe2e8f0, 0.9)
              .setDepth(ySortDepth(py, 4))
              .setInteractive({ useHandCursor: true });
        mark.on('pointerover', () => {
          this.hoverObjectId = o.id;
          const g = this.objectGfx.get(o.id);
          g?.label.setVisible(true);
        });
        mark.on('pointerout', () => {
          if (this.hoverObjectId === o.id) this.hoverObjectId = null;
          const g = this.objectGfx.get(o.id);
          g?.label.setVisible(used.has(o.id));
        });
        const label = this.add
          .text(px, py - this.tileSize * 0.45, `${objectGlyph(o.name)} ${o.name}`, {
            fontFamily: UI_FONT,
            fontSize: fontPx(13),
            color: '#e2e8f0',
            backgroundColor: '#0f172acc',
            padding: { x: 4, y: 2 },
          })
          .setOrigin(0.5, 1)
          .setDepth(ySortDepth(py, 5));
        this.objectLayer.add([glow, mark, label]);
        gfx = { mark, glow, label };
        this.objectGfx.set(o.id, gfx);
      } else {
        gfx.mark.setPosition(px, py);
        gfx.glow?.setPosition(px, py);
        gfx.label.setPosition(px, py - this.tileSize * 0.45);
      }
      if ('texture' in gfx.mark && 'setTint' in gfx.mark) {
        const image = gfx.mark as Phaser.GameObjects.Image;
        image.setScale(hot ? 1.1 : 1);
        if (hot) image.setTint(0xffe4b5);
        else image.clearTint();
      } else {
        (gfx.mark as Phaser.GameObjects.Arc).setFillStyle(
          hot ? 0xf59e0b : 0x94a3b8,
          hot ? 0.95 : 0.7,
        );
      }
      gfx.glow
        ?.setStrokeStyle(2, 0xfde68a, hot ? 0.85 : 0)
        .setFillStyle(0xf59e0b, hot ? 0.12 : 0);
      gfx.label.setText(
        `${objectGlyph(o.name)} ${o.name}${o.state ? ` · ${o.state.slice(0, 10)}` : ''}`,
      );
      gfx.label.setVisible(showLabel);
    }
    for (const [id, gfx] of this.objectGfx) {
      if (seen.has(id)) continue;
      gfx.mark.destroy();
      gfx.glow?.destroy();
      gfx.label.destroy();
      this.objectGfx.delete(id);
    }
  }

  /**
   * Releases the follow camera for a region change.
   *
   * This used to also destroy every agent's 7 game objects, but `refreshAgents`
   * already prunes whoever is not visible in the new region — and residents who
   * appear in both regions can keep their sprite instead of being rebuilt.
   */
  private releaseFollowCam(): void {
    this.cameras.main.stopFollow();
    this.followId = null;
    if (this.talkArcs && this.talkArcs.active) this.talkArcs.clear();
  }

  private switchRegion(regionId: string): void {
    if (!regionId) return;
    if (regionId === this.regionId && !this.pendingRegionId) {
      this.refreshAgents(true);
      this.refreshObjects();
      return;
    }
    if (this.pendingRegionId === regionId) return;
    const gen = ++this.regionFadeGen;
    this.pendingRegionId = regionId;
    this.cameras.main.fadeOut(140, 15, 23, 42);
    this.time.delayedCall(140, () => {
      if (gen !== this.regionFadeGen) return;
      this.regionId = regionId;
      this.pendingRegionId = null;
      this.releaseFollowCam();
      this.drawRegion(regionId);
      this.buildRegionNav();
      this.refreshAgents(true);
      this.refreshObjects();
    });
  }

  private centerOnCrowd(): void {
    if (this.didCenterCrowd || this.followId || this.userSteeredCamera) return;
    // A region that fits the pane is already framed; re-centering on the crowd
    // there would only push the map off-centre and bring the margins back.
    if (!this.cameras.main.useBounds) return;
    const poses = this.posesAtCursor().filter((p) => p.regionId === this.regionId);
    if (poses.length < 2) return;
    const cx =
      poses.reduce((s, p) => s + p.x, 0) / poses.length;
    const cy =
      poses.reduce((s, p) => s + p.y, 0) / poses.length;
    this.cameras.main.centerOn(
      cx * this.tileSize + this.tileSize / 2,
      cy * this.tileSize + this.tileSize * 0.85,
    );
    this.didCenterCrowd = true;
  }

  /**
   * The nav strip is fixed per world, so it is built once and only restyled when
   * the active region changes.
   */
  private buildRegionNav(): void {
    if (!this.navLayer) return;
    if (this.navLabels.length) {
      for (const { id, label } of this.navLabels) {
        label.setBackgroundColor(
          id === this.regionId ? '#b45309cc' : '#1e293bcc',
        );
      }
      return;
    }
    let x = 12;
    for (const r of this.world.space.regions) {
      const rid = r.id;
      const label = this.add
        .text(x, 44, r.name ?? rid, {
          fontFamily: UI_FONT,
          fontSize: fontPx(14),
          color: '#f8fafc',
          backgroundColor: rid === this.regionId ? '#b45309cc' : '#1e293bcc',
          padding: { x: 8, y: 5 },
        })
        .setInteractive({ useHandCursor: true });
      label.on('pointerdown', () => {
        if (
          rid === this.regionId &&
          (this.regionPinned === rid || this.userSteeredCamera)
        ) {
          this.regionPinned = null;
          this.userSteeredCamera = false;
          this.refreshHud();
          return;
        }
        this.regionPinned = rid;
        this.selectedId = null;
        this.switchRegion(rid);
        this.refreshAgents(true);
      });
      this.navLayer.add(label);
      this.navLabels.push({ id: rid, label });
      x += Math.max(label.width, 36) + 8;
    }
  }

  private async loadWorldAssets(): Promise<void> {
    const images: Array<{ key: string; file: string }> = [
      { key: this.assetKeys.tile, file: './assets/ground.png' },
      { key: this.assetKeys.wall, file: './assets/wall.png' },
      { key: this.assetKeys.path, file: './assets/path.png' },
      { key: this.assetKeys.water, file: './assets/water.png' },
      { key: this.assetKeys.decor, file: './assets/decor.png' },
      { key: this.assetKeys.npc, file: './assets/npc.png' },
    ];
    const atlases: Array<{ key: string; png: string; json: string; agentId: string }> =
      [];
    const audio: Array<{ id: string; file: string }> = [
      { id: 'bgm', file: './assets/bgm.mp3' },
    ];
    let briefEntities: Array<{ id?: string; suggestedAsset?: string }> = [];
    try {
      const res = await fetch('./ASSET_BRIEF.json');
      if (res.ok) {
        const brief = (await res.json()) as {
          assets?: Array<{ role?: string; file?: string }>;
          audio?: Array<{ id?: string; file?: string; role?: string }>;
          entities?: Array<{
            id?: string;
            suggestedAsset?: string;
            walkSheet?: string;
            walkAtlas?: string;
          }>;
          npcWalks?: Array<{ id: string; file: string; atlas: string }>;
        };
        const roleToKey: Record<string, string> = {
          tile: this.assetKeys.tile,
          wall: this.assetKeys.wall,
          path: this.assetKeys.path,
          water: this.assetKeys.water,
          decor: this.assetKeys.decor,
          npc: this.assetKeys.npc,
        };
        for (const a of brief.assets ?? []) {
          const key = a.role ? roleToKey[a.role] : undefined;
          if (!key || !a.file) continue;
          const hit = images.find((i) => i.key === key);
          if (hit) hit.file = a.file;
        }
        for (const a of brief.audio ?? []) {
          if (a.file && (a.id === 'bgm' || a.role === 'bgm')) {
            audio[0] = { id: 'bgm', file: a.file };
          }
        }
        const walks = [
          ...(brief.npcWalks ?? []),
          ...(brief.entities ?? [])
            .filter((e) => e.id && e.walkSheet && e.walkAtlas)
            .map((e) => ({
              id: e.id!,
              file: e.walkSheet!,
              atlas: e.walkAtlas!,
            })),
        ];
        for (const w of walks) {
          const key = `walk_${npcAssetSlug(w.id)}`;
          this.walkAtlasByAgent.set(w.id, key);
          atlases.push({ key, png: w.file, json: w.atlas, agentId: w.id });
        }
        briefEntities = brief.entities ?? [];
      }
    } catch {
      /* optional */
    }

    await Promise.all(
      this.world.space.regions.map(async (r) => {
        try {
          const res = await fetch(
            `./assets/region_${npcAssetSlug(r.id)}_tilemap.json`,
          );
          if (!res.ok) return;
          const tm = (await res.json()) as {
            width?: number;
            height?: number;
            gids?: number[];
          };
          if (Array.isArray(tm.gids) && tm.width && tm.height) {
            this.tilemaps.set(r.id, {
              width: tm.width,
              height: tm.height,
              gids: tm.gids,
            });
          }
        } catch {
          /* optional */
        }
      }),
    );

    const queuePortrait = (id: string, suggested?: string): void => {
      const key = `portrait_${id}`;
      if (images.some((i) => i.key === key)) return;
      const unique =
        preferUniquePortraitFile(suggested) ??
        `./assets/${npcAssetSlug(id)}.png`;
      if (!preferUniquePortraitFile(unique)) return;
      images.push({ key, file: unique });
    };
    for (const e of briefEntities) {
      if (e.id) queuePortrait(e.id, e.suggestedAsset);
    }
    for (const e of this.world.entities ?? []) {
      if (e.kind !== 'npc' && e.kind !== 'player') continue;
      queuePortrait(e.id);
    }

    await new Promise<void>((resolve) => {
      let queued = 0;
      this.load.once('complete', () => resolve());
      this.load.on('loaderror', (file: { key?: string }) => {
        const key = file?.key;
        if (!key) return;
        // A failed portrait/atlas must not occupy the key, or the sprite
        // would render as a green missing-texture box instead of falling back.
        if (this.textures.exists(key)) this.textures.remove(key);
        this.walkAtlasByAgent.forEach((atlas, agentId) => {
          if (atlas === key) this.walkAtlasByAgent.delete(agentId);
        });
      });
      for (const img of images) {
        if (this.textures.exists(img.key)) continue;
        this.load.image(img.key, img.file);
        queued += 1;
      }
      if (!this.textures.exists(this.assetKeys.tileset)) {
        this.load.spritesheet(this.assetKeys.tileset, './assets/tileset.png', {
          frameWidth: this.tileSourceSize,
          frameHeight: this.tileSourceSize,
        });
        queued += 1;
      }
      for (const atlas of atlases) {
        if (this.textures.exists(atlas.key)) continue;
        this.load.atlas(atlas.key, atlas.png, atlas.json);
        queued += 1;
      }
      for (const a of audio) {
        if (this.cache.audio.exists(a.id)) continue;
        this.load.audio(a.id, a.file);
        queued += 1;
      }
      if (queued === 0) {
        resolve();
        return;
      }
      this.load.start();
    });
  }

  private notifyBgmStatus(): void {
    this.notifyParent(MSG_BGM_STATUS, {
      muted: this.bgmMuted,
      loaded: this.bgmLoaded,
      needsGesture: this.bgmNeedsGesture,
      playing: Boolean(this.sound.get('bgm')) && !this.audioContextLocked(),
    });
  }

  private audioContextLocked(): boolean {
    const mgr = this.sound as Phaser.Sound.WebAudioSoundManager & {
      locked?: boolean;
      context?: AudioContext;
    };
    if (mgr.locked) return true;
    const ctx = mgr.context ?? this.audioContext();
    return ctx?.state === 'suspended';
  }

  /**
   * The WebAudio context, when there is one. `NoAudioSoundManager` (headless
   * smoke runs, blocked autoplay) has no `context` at all, so this must not be
   * reached through `this.sound.context` directly.
   */
  private audioContext(): AudioContext | undefined {
    const mgr = this.sound as Phaser.Sound.BaseSoundManager & {
      context?: AudioContext;
    };
    return mgr.context;
  }

  private playBgm(force = false): void {
    if (!this.cache.audio.exists('bgm')) {
      this.bgmLoaded = false;
      this.notifyBgmStatus();
      return;
    }
    this.bgmLoaded = true;
    if (this.audioContextLocked() && !force) {
      this.bgmNeedsGesture = true;
      this.notifyBgmStatus();
      return;
    }
    const start = () => {
      if (this.sound.get('bgm')) {
        const existing = this.sound.get('bgm') as
          | { setVolume?: (v: number) => void; resume?: () => void }
          | undefined;
        existing?.setVolume?.(this.bgmMuted ? 0 : 0.22);
        if (force) existing?.resume?.();
        this.bgmNeedsGesture = this.audioContextLocked();
        this.notifyBgmStatus();
        return;
      }
      try {
        this.sound.play('bgm', {
          loop: true,
          volume: this.bgmMuted ? 0 : 0.22,
        });
        this.bgmNeedsGesture = this.audioContextLocked();
      } catch {
        this.bgmNeedsGesture = true;
      }
      this.notifyBgmStatus();
    };
    const ctx = this.audioContext();
    if (force && ctx?.state === 'suspended') {
      void ctx
        .resume()
        .then(() => start())
        .catch(() => {
          this.bgmNeedsGesture = true;
          this.notifyBgmStatus();
        });
      return;
    }
    start();
  }

  private toggleBgmMute(): void {
    this.bgmMuted = !this.bgmMuted;
    if (!this.sound.get('bgm')) {
      this.bgmNeedsGesture = false;
      this.playBgm(true);
    }
    const bgm = this.sound.get('bgm') as
      | { setVolume?: (v: number) => void }
      | undefined;
    bgm?.setVolume?.(this.bgmMuted ? 0 : 0.22);
    this.refreshHud();
    this.notifyBgmStatus();
  }

  private regionName(id: string): string {
    return this.world.space.regions.find((r) => r.id === id)?.name ?? id;
  }

  private playTalkBlip(): void {
    try {
      const ctx = this.audioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 720;
      gain.gain.value = 0.045;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
      osc.stop(ctx.currentTime + 0.1);
    } catch {
      /* ignore */
    }
  }

  /**
   * Procedural portraits use a separate key from file-loaded `portrait_${id}`
   * so an in-flight Loader cannot collide with createCanvas (Texture key in use).
   */
  private generatedPortraitKey(id: string): string {
    const slug = npcAssetSlug(id);
    return `portrait_gen_${slug || String(Math.abs(hash(id)))}`;
  }

  /**
   * Draw a resident as a 4-direction walk sheet.
   *
   * The asset pipeline only renders sheets for the first batch of townsfolk, so
   * everyone after that used to be a coloured blob with the first letter of
   * their name on it — same picture from every angle, no motion. A drawn
   * resident uses the frame names the generated atlases use, so it animates
   * through exactly the same path.
   */
  private ensurePlaceTexture(kind: PlaceKind): string | undefined {
    const key = placeTextureKey(kind);
    if (this.textures.exists(key)) return key;
    const layout = placeSpriteLayout(2);
    const canvas = this.textures.createCanvas(key, layout.size, layout.size);
    const ctx = canvas?.getContext() as CanvasRenderingContext2D | null;
    if (!canvas || !ctx) {
      if (this.textures.exists(key)) this.textures.remove(key);
      return undefined;
    }
    drawPlaceSprite(
      (x, y, w, h, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
      },
      kind,
      placePalette(kind, this.world.styleAnchor?.palette),
      layout,
    );
    canvas.refresh();
    return key;
  }

  private ensureCharacterAtlas(id: string, name: string): string | undefined {
    const slug = npcAssetSlug(id) || String(Math.abs(hash(id)));
    const key = `char_gen_${slug}`;
    if (this.textures.exists(key)) return key;
    const layout = characterSheetLayout(3);
    const canvas = this.textures.createCanvas(
      key,
      layout.sheetW,
      layout.sheetH,
    );
    const ctx = canvas?.getContext() as CanvasRenderingContext2D | null;
    if (!canvas || !ctx) {
      // createCanvas may have reserved the key before failing.
      if (this.textures.exists(key)) this.textures.remove(key);
      return undefined;
    }
    drawCharacterSheet(
      (x, y, w, h, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
      },
      characterPalette(`${id}:${name}`, this.world.styleAnchor?.palette),
      layout,
    );
    canvas.refresh();
    const texture = this.textures.get(key);
    for (const dir of WALK_DIRS) {
      for (let frame = 0; frame < CHAR_FRAMES_PER_DIR; frame += 1) {
        const rect = charFrameRect(dir, frame, layout);
        texture.add(
          charFrameName(dir, frame),
          0,
          rect.x,
          rect.y,
          rect.w,
          rect.h,
        );
      }
    }
    return key;
  }

  private ensurePortrait(id: string, name: string, color: number): string {
    const fileKey = `portrait_${id}`;
    if (this.textures.exists(fileKey)) return fileKey;
    const key = this.generatedPortraitKey(id);
    if (this.textures.exists(key)) return key;
    const canvas = this.textures.createCanvas(key, 48, 48);
    const ctx = canvas?.getContext() as CanvasRenderingContext2D | null;
    if (!canvas || !ctx) {
      // createCanvas may have already reserved `key` — remove before generateTexture.
      if (this.textures.exists(key)) this.textures.remove(key);
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(color, 1);
      g.fillCircle(16, 18, 13);
      g.fillStyle(0xffffff, 0.85);
      g.fillCircle(16, 12, 6);
      g.generateTexture(key, 32, 32);
      g.destroy();
      return key;
    }
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 48, 48);
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.ellipse(24, 34, 16, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe4c7';
    ctx.beginPath();
    ctx.arc(24, 18, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name.slice(0, 1), 24, 18);
    canvas.refresh();
    return key;
  }
}

function objectGlyph(name: string): string {
  const t = name.toLowerCase();
  if (/床|被褥|病床|bed/.test(t)) return '🛏';
  if (/鸡|舍|窝|coop|hen|chicken/.test(t) && !/宿舍/.test(name)) return '🐔';
  if (/麦|田|垄|稻|field|farm/.test(t)) return '🌾';
  if (/矿|mine/.test(t)) return '⛏️';
  if (/井|well/.test(t)) return '🪣';
  if (/喷泉|fountain/.test(t)) return '⛲';
  if (/椅|bench/.test(t)) return '🪑';
  if (/灯|lamp/.test(t)) return '🏮';
  if (/路标|招牌|sign/.test(t)) return '🪧';
  if (/秋千|swing/.test(t)) return '🪢';
  if (/炉|灶|oven|stove/.test(t)) return '🔥';
  if (/布告|告示|黑板|board/.test(t)) return '📋';
  if (/面包|厨|锅|食|咖啡/.test(t)) return '🍞';
  return '◆';
}

function shadeHex(color: string, factor: number): string {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;
  const dim = (i: number): string => {
    const v = Math.round(parseInt(hex.slice(i, i + 2), 16) * factor);
    return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  };
  return `#${dim(0)}${dim(2)}${dim(4)}`;
}

function partnerFromAction(action: string): string | undefined {
  const raw = action ?? '';
  const m = raw.match(/^与(.+?)交谈/) ?? raw.match(/^talking with (.+)/i);
  const name = m?.[1]?.trim();
  return name || undefined;
}

function labelText(
  p: AgentPose,
  opts:
    | {
        selected?: boolean;
        hovered?: boolean;
        speech?: boolean;
        clusterSize?: number;
      }
    | boolean = false,
): string {
  const selected =
    typeof opts === 'boolean' ? opts : Boolean(opts.selected);
  const hovered = typeof opts === 'boolean' ? false : Boolean(opts.hovered);
  const speech = typeof opts === 'boolean' ? false : Boolean(opts.speech);
  const clusterSize =
    typeof opts === 'boolean' ? 1 : (opts.clusterSize ?? 1);
  return agentLabelText({
    name: p.name,
    partner: p.talkWith || partnerFromAction(p.action ?? ''),
    action: p.action,
    selected,
    hovered,
    speech,
    clusterSize,
  });
}

function chromeClusters(
  poses: AgentPose[],
): Map<string, { index: number; size: number }> {
  const groups = new Map<string, AgentPose[]>();
  for (const p of poses) {
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  const out = new Map<string, { index: number; size: number }>();
  for (const list of groups.values()) {
    const ordered = [...list].sort((a, b) => a.id.localeCompare(b.id));
    ordered.forEach((p, index) => {
      out.set(p.id, { index, size: ordered.length });
    });
  }
  return out;
}

function easeSmooth(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

function crowdSpread(
  poses: AgentPose[],
  id: string,
): { dx: number; dy: number } {
  const self = poses.find((p) => p.id === id);
  if (!self) return { dx: 0, dy: 0 };
  const cell = `${Math.round(self.x)},${Math.round(self.y)}`;
  const same = poses.filter(
    (p) => `${Math.round(p.x)},${Math.round(p.y)}` === cell,
  );
  if (same.length < 2) return { dx: 0, dy: 0 };
  const ordered = [...same].sort((a, b) => a.id.localeCompare(b.id));
  const i = ordered.findIndex((p) => p.id === id);
  return crowdSpreadOffset(Math.max(0, i), same.length, hash(id) * 0.01);
}

/** Home/job recitals and empty crumbs — never pin these as "busy town" bubbles. */
function isFillerSpeech(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return true;
  return /我住在|我在.{0,24}干活|我在.{0,16}的岗位|路过跟你讲一声|I live in |I work at |打了个招呼，又各自忙去了|nodded and went back to work|朝\S{1,12}点了点头。$|nods at \S+\.$|says talk later|回头再聊[。.]?$/i.test(
    t,
  );
}

function addressedEventLine(e: ReplayEvent, agents: ReplayAgent[]): string {
  if (e.kind === 'intervene') return eventLine(e);
  const nameOf = (id: string): string =>
    agents.find((a) => a.id === id)?.name ?? '';
  const turns = e.payload['turns'];
  if (Array.isArray(turns)) {
    for (const row of turns) {
      if (!row || typeof row !== 'object') continue;
      const text = (row as { text?: unknown }).text;
      if (typeof text !== 'string' || !text.trim()) continue;
      const whoRaw = (row as { speakerName?: unknown }).speakerName;
      const sid = (row as { speakerId?: unknown }).speakerId;
      const who =
        typeof whoRaw === 'string' && whoRaw.trim()
          ? whoRaw.trim()
          : typeof sid === 'string'
            ? nameOf(sid)
            : nameOf(String(e.agentId ?? ''));
      const others = turns
        .map((t) =>
          t && typeof t === 'object'
            ? String((t as { speakerName?: unknown }).speakerName ?? '')
            : '',
        )
        .filter((n) => n && n !== who);
      const withName =
        typeof e.payload['with'] === 'string'
          ? nameOf(String(e.payload['with']))
          : '';
      const to = others[0] || withName || '对方';
      return `${who} → ${to}：${text.trim()}`.slice(0, 160);
    }
  }
  return eventLine(e);
}

function eventLine(e: ReplayEvent): string {
  const turns = e.payload['turns'];
  if (Array.isArray(turns)) {
    const bits: string[] = [];
    for (const row of turns) {
      if (!row || typeof row !== 'object') continue;
      const text = (row as { text?: unknown }).text;
      const who = (row as { speakerName?: unknown }).speakerName;
      if (typeof text === 'string' && text.trim()) {
        bits.push(
          typeof who === 'string' && who.trim()
            ? `${who}：${text.trim()}`
            : text.trim(),
        );
      }
    }
    if (bits.length) return bits.slice(0, 3).join(' / ').slice(0, 120);
  }
  const raw = String(e.payload['summary'] ?? e.payload['text'] ?? '…');
  const first = raw.split(/[。/]/)[0] ?? raw;
  return first.slice(0, 72);
}

function worldHudAscii(world?: {
  space?: { regions?: Array<{ name?: string }> };
}): boolean {
  const letters = (world?.space?.regions ?? [])
    .map((r) => r.name ?? '')
    .join('')
    .replace(/\s/g, '');
  if (!letters.length) return false;
  return !/[^\x00-\x7F]/.test(letters);
}

function formatTownClock(
  t: number,
  clock?: { kind?: string; shifts?: number },
  ascii = false,
): string {
  const kind = clock?.kind ?? 'diurnal';
  if (kind === 'watch') {
    const n = Math.max(1, clock?.shifts ?? 3);
    const shiftLen = 24 / n;
    const elapsed = Math.max(0, t);
    const shiftIndex = Math.floor((elapsed % 24) / shiftLen);
    const watch = Math.floor(elapsed / 24) + 1;
    return ascii
      ? `Watch ${watch} · shift ${shiftIndex + 1}`
      : `第${watch}轮 第${shiftIndex + 1}班`;
  }
  if (kind === 'event') {
    const beat = Math.floor(Math.max(0, t));
    return ascii ? `Beat ${beat}` : `时点 ${beat}`;
  }
  const day = Math.floor(Math.max(0, t) / 24) + 1;
  const hour = Math.floor(((t % 24) + 24) % 24);
  if (ascii) {
    const slot =
      hour < 5
        ? 'dawn'
        : hour < 11
          ? 'morning'
          : hour < 13
            ? 'noon'
            : hour < 18
              ? 'afternoon'
              : 'evening';
    return `Day ${day} ${slot} ${hour}:00`;
  }
  const slot =
    hour < 5 ? '凌晨' : hour < 11 ? '上午' : hour < 13 ? '中午' : hour < 18 ? '下午' : '晚上';
  return `第${day}天 ${slot}${hour}点`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
