/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `game.json` is the Planner Agent's output: a declarative description of the
 * game's metadata, scenes, entities and skills. The Coder Agent fills in
 * custom Phaser logic via `custom_modules`. The runtime loader expands the
 * DSL into Entities + Components / Behaviors / SkillChains.
 *
 * Keep this schema *additive*: every minor must remain readable by older
 * runtime patches.
 */
export const DSL_VERSION = '1.0.0' as const;

export interface GameMeta {
  readonly title: string;
  readonly description?: string;
  readonly genre?: string;
  readonly orientation?: 'portrait' | 'landscape';
  readonly canvas?: { width: number; height: number; background?: string };
  /** Picked art style profile id (world-spec `ArtStyleId`), for provenance. */
  readonly artStyleId?: string;
  /**
   * True only for deliberately pixel styles. Drives Phaser `pixelArt` /
   * `roundPixels`; leaving it unset gives smoothed rendering, which is what
   * painterly and illustrated art needs.
   */
  readonly pixelPerfect?: boolean;
  /**
   * On-screen touch controls. Unset auto-enables them on coarse-pointer
   * devices, which is what makes a keyboard-shaped game playable in a phone
   * browser. Set `enabled: false` for a game that already handles touch, or
   * `stick: false` for one that only needs taps.
   */
  readonly mobileInput?: {
    readonly enabled?: boolean;
    readonly stick?: boolean;
    readonly actions?: ReadonlyArray<'primary' | 'secondary' | 'tertiary' | 'confirm'>;
  };
}

export interface AssetRef {
  readonly id: string;
  readonly kind: 'image' | 'audio' | 'spritesheet' | 'video';
  readonly url: string;
  readonly frame?: { width: number; height: number };
}

/** Reject truncated / malformed data URLs that cause WebGL texImage2D errors. */
export function isPlausibleDataImageUrl(url: string): boolean {
  if (!url.startsWith('data:image/')) return true;
  const comma = url.indexOf(',');
  if (comma <= 0) return false;
  const header = url.slice(0, comma).toLowerCase();
  const payload = url.slice(comma + 1).replace(/\s+/g, '');
  if (header.includes(';base64')) {
    if (payload.length < 12) return false;
    if (!/^[A-Za-z0-9+/=]+$/.test(payload)) return false;
    const body = payload.replace(/=+$/, '');
    if (body.length % 4 === 1) return false;
    return true;
  }
  return payload.length > 0;
}

export interface EntitySpec {
  readonly id: string;
  readonly tags?: ReadonlyArray<string>;
  readonly sprite?: {
    readonly assetId?: string;
    readonly shape?: 'rect' | 'circle';
    readonly color?: string;
    readonly width?: number;
    readonly height?: number;
    readonly x: number;
    readonly y: number;
    /** Phaser depth; higher draws above. */
    readonly depth?: number;
  };
  /** ordered list of `behaviorKind:opts` references, e.g. `patrol`, `chase` */
  readonly behaviors?: ReadonlyArray<BehaviorSpec>;
  readonly skills?: ReadonlyArray<string>;
  readonly tunables?: Record<string, TunableSpec>;
  /** Numeric per-entity stats (hp, mp, …) tracked by EntityStateRegistry. */
  readonly state?: Record<string, number>;
}

export interface BehaviorSpec {
  readonly kind: string;
  readonly options?: Record<string, unknown>;
}

export interface TunableSpec {
  readonly type: 'number' | 'string' | 'boolean';
  readonly value: number | string | boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly label?: string;
}

export interface SceneSpec {
  readonly id: string;
  readonly title?: string;
  readonly dialogueKey?: string;
  readonly entities: ReadonlyArray<EntitySpec>;
  readonly hud?: { score?: boolean; lives?: boolean };
  /**
   * World-region layout carrier only — not a playable Phaser DSL scene.
   * WorldScene reads entities via resolveWorldLayoutsBySceneId; bootstrap must not compile these.
   */
  readonly layoutOnly?: boolean;
}

/**
 * When true, the scene is implemented by a Coder `Phaser.Scene` in `bootstrap({ extraScenes })`;
 * `compileDslToScenes` must not emit a `DslScene` for the same key (avoids duplicate Phaser scene keys).
 */
export function sceneDeferredToCustomPhaser(spec: SceneSpec): boolean {
  const r = spec as unknown as Record<string, unknown>;
  const cm = r['customModule'];
  return typeof cm === 'string' && cm.trim() !== '';
}

/**
 * World-region rows in game.json that carry entities/portals for WorldScene layouts.
 * Must not become Phaser DSL scenes (would steal portal hops from WorldScene).
 */
export function sceneIsLayoutOnly(spec: SceneSpec): boolean {
  const r = spec as unknown as Record<string, unknown>;
  return r['layoutOnly'] === true;
}

/** Skip compiling into Phaser — customModule shells or world layout carriers. */
export function sceneSkippedByDslCompile(spec: SceneSpec): boolean {
  return sceneDeferredToCustomPhaser(spec) || sceneIsLayoutOnly(spec);
}

/** Keys to try when calling `game.scene.start`, in order (initial first, then bootable scene ids). */
export function sceneStartCandidates(dsl: GameDsl, initialKey: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (k: string) => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    keys.push(k);
  };
  add(initialKey);
  for (const s of dsl.scenes) {
    if (sceneIsLayoutOnly(s)) continue;
    add(s.id);
  }
  return keys;
}

export interface DialogueLine {
  readonly id?: string;
  readonly group?: string;
  readonly speaker?: string;
  readonly text: string;
  readonly choices?: ReadonlyArray<{ readonly label: string; readonly nextId?: string }>;
  /** Jump to another line id after this line (graph edge). */
  readonly nextId?: string;
}

export interface GameRules {
  readonly win?: string;
  readonly lose?: string;
  readonly scoreLabel?: string;
}

export interface AudioTrackSpec {
  readonly id: string;
  readonly assetId: string;
  readonly loop?: boolean;
  readonly volume?: number;
  readonly role?: 'bgm' | 'sfx';
}

export interface CutsceneSpec {
  readonly id: string;
  readonly assetId?: string;
  readonly durationSec?: number;
  readonly caption?: string;
}

export interface GameDsl {
  readonly dslVersion: typeof DSL_VERSION | string;
  readonly meta: GameMeta;
  readonly assets?: ReadonlyArray<AssetRef>;
  readonly dialogue?: ReadonlyArray<DialogueLine>;
  readonly rules?: GameRules;
  readonly audioTracks?: ReadonlyArray<AudioTrackSpec>;
  readonly cutscenes?: ReadonlyArray<CutsceneSpec>;
  readonly skills?: ReadonlyArray<{
    id: string;
    trigger: { kind: string; key?: string; otherTag?: string; periodSec?: number };
    effects: ReadonlyArray<{ kind: string; payload?: Record<string, unknown> }>;
    cooldownSec?: number;
  }>;
  readonly scenes: ReadonlyArray<SceneSpec>;
  readonly initialSceneId?: string;
  readonly customModules?: ReadonlyArray<string>;
}

const ASSET_KINDS = new Set(['image', 'audio', 'spritesheet', 'video']);

function normalizeAssetRow(entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const a = entry as Record<string, unknown>;
  const rawType =
    typeof a.type === 'string' && a.type.trim() !== ''
      ? a.type.trim()
      : typeof a.kind === 'string' && a.kind.trim() !== ''
        ? a.kind.trim()
        : 'image';
  const kindLower = rawType.toLowerCase();
  const kind = ASSET_KINDS.has(kindLower) ? kindLower : 'image';
  const idRaw =
    typeof a.id === 'string' && a.id.trim() !== ''
      ? a.id.trim()
      : typeof a.key === 'string' && a.key.trim() !== ''
        ? a.key.trim()
        : '';
  if (!idRaw) return null;
  const url =
    typeof a.url === 'string'
      ? a.url
      : a.url === null || a.url === undefined
        ? ''
        : String(a.url);
  const urlNorm =
    kind === 'image' && url.startsWith('data:image/') && !isPlausibleDataImageUrl(url) ? '' : url;
  return { ...a, id: idRaw, kind, url: urlNorm };
}

function normalizeAudioTrackRow(entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const a = entry as Record<string, unknown>;
  const id =
    typeof a.id === 'string' && a.id.trim() !== ''
      ? a.id.trim()
      : typeof a.key === 'string' && a.key.trim() !== ''
        ? a.key.trim()
        : '';
  if (!id) return null;
  const assetId =
    typeof a.assetId === 'string' && a.assetId.trim() !== ''
      ? a.assetId.trim()
      : typeof a.asset === 'string' && a.asset.trim() !== ''
        ? a.asset.trim()
        : '';
  return { ...a, id, assetId };
}

function behaviorKindFromPlannerKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function normalizeBehaviors(raw: unknown): BehaviorSpec[] {
  if (Array.isArray(raw)) {
    const out: BehaviorSpec[] = [];
    for (const b of raw) {
      if (!b || typeof b !== 'object') continue;
      const row = b as Record<string, unknown>;
      if (typeof row.kind === 'string' && row.kind.trim() !== '') {
        out.push({
          kind: row.kind.trim(),
          options:
            row.options && typeof row.options === 'object' && !Array.isArray(row.options)
              ? (row.options as Record<string, unknown>)
              : {},
        });
      }
    }
    return out;
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([kind, options]) => ({
      kind: behaviorKindFromPlannerKey(kind),
      options:
        options && typeof options === 'object' && !Array.isArray(options)
          ? (options as Record<string, unknown>)
          : {},
    }));
  }
  return [];
}

function normalizeEntitySkills(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const ids = raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    return ids.length > 0 ? ids : undefined;
  }
  if (raw && typeof raw === 'object') {
    const ids = Object.keys(raw as Record<string, unknown>).filter((k) => k.trim() !== '');
    return ids.length > 0 ? ids : undefined;
  }
  return undefined;
}

function normalizeEntitySprite(entity: Record<string, unknown>): Record<string, unknown> | undefined {
  const spriteRaw = entity['sprite'];
  const ex = typeof entity['x'] === 'number' ? entity['x'] : 0;
  const ey = typeof entity['y'] === 'number' ? entity['y'] : 0;
  if (!spriteRaw || typeof spriteRaw !== 'object' || Array.isArray(spriteRaw)) {
    if (typeof entity['x'] === 'number' && typeof entity['y'] === 'number') {
      return {
        x: ex,
        y: ey,
        shape: 'rect',
        width: 32,
        height: 32,
        color: '#6366f1',
      };
    }
    return undefined;
  }
  const s = { ...(spriteRaw as Record<string, unknown>) };
  if (typeof s['assetId'] !== 'string' && typeof s['key'] === 'string') {
    s['assetId'] = s['key'];
  }
  if (typeof s['x'] !== 'number') s['x'] = ex;
  if (typeof s['y'] !== 'number') s['y'] = ey;
  if (typeof s['tint'] === 'string' && typeof s['color'] !== 'string') {
    const tint = String(s['tint']).replace(/^0x/i, '');
    s['color'] = `#${tint}`;
  }
  if (s['shape'] === 'arc') {
    s['shape'] = 'circle';
    if (typeof s['radius'] === 'number') {
      s['width'] = (s['radius'] as number) * 2;
      s['height'] = (s['radius'] as number) * 2;
    }
  }
  if (s['shape'] === 'circle' && typeof s['radius'] === 'number') {
    if (typeof s['width'] !== 'number') s['width'] = (s['radius'] as number) * 2;
    if (typeof s['height'] !== 'number') s['height'] = (s['radius'] as number) * 2;
  }
  if (typeof s['depth'] === 'string' && s['depth'] !== '') {
    const d = Number(s['depth']);
    if (Number.isFinite(d)) s['depth'] = d;
    else delete s['depth'];
  }
  if (typeof s['depth'] === 'number' && !Number.isFinite(s['depth'])) {
    delete s['depth'];
  }
  return s;
}

function normalizeEntityRow(entity: unknown): unknown {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return entity;
  const e = entity as Record<string, unknown>;
  const behaviors = normalizeBehaviors(e['behaviors']);
  const dialogRaw = e['dialog'];
  if (dialogRaw && typeof dialogRaw === 'object' && !Array.isArray(dialogRaw)) {
    const d = dialogRaw as Record<string, unknown>;
    behaviors.push({
      kind: 'dialog',
      options: {
        dialogueId: d['dialogueId'] ?? d['id'],
        interactKey: d['interactKey'] ?? 'E',
        interactRange: d['interactRange'] ?? 60,
      },
    });
  }
  const sprite = normalizeEntitySprite(e);
  const skills = normalizeEntitySkills(e['skills']);
  const next: Record<string, unknown> = { ...e, behaviors };
  if (sprite) next['sprite'] = sprite;
  if (skills) next['skills'] = skills;
  return next;
}

function slugifySceneKey(raw: string, index: number): string {
  const x = raw
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return x.length > 0 ? x : `scene_${index}`;
}

/**
 * Older `game.json` / agent output sometimes used Phaser-style `key` instead of
 * `id`, or omitted `id` entirely. The loader requires `scene.id`. This returns
 * a shallow-cloned object safe to cast to `GameDsl` after validation.
 */
export function normalizeGameDsl(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }
  const root = input as Record<string, unknown>;
  const scenesRaw = root['scenes'];
  if (!Array.isArray(scenesRaw)) {
    return input;
  }

  const used = new Set<string>();
  const scenes = scenesRaw.map((scene, i) => {
    if (typeof scene === 'string') {
      const t = scene.trim();
      const base = t ? slugifySceneKey(t, i) : `scene_${i}`;
      let id = base;
      let n = 0;
      while (used.has(id)) {
        n += 1;
        id = `${base}_${n}`;
      }
      used.add(id);
      return { id, entities: [] as unknown[] };
    }
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
      return { id: `scene_${i}`, entities: [] };
    }
    const s = scene as Record<string, unknown>;
    const meta = s['metadata'];
    const metaId =
      meta && typeof meta === 'object' && !Array.isArray(meta)
        ? (meta as Record<string, unknown>)['id']
        : undefined;
    const metaIdStr =
      typeof metaId === 'string' && metaId.trim() !== '' ? metaId.trim() : '';

    let base =
      typeof s['id'] === 'string' && s['id'].trim() !== ''
        ? s['id'].trim()
        : typeof s['id'] === 'number' && Number.isFinite(s['id'])
          ? String(s['id'])
          : metaIdStr
            ? metaIdStr
            : typeof s['key'] === 'string' && s['key'].trim() !== ''
              ? s['key'].trim()
              : typeof s['sceneKey'] === 'string' && s['sceneKey'].trim() !== ''
                ? s['sceneKey'].trim()
                : typeof s['sceneId'] === 'string' && s['sceneId'].trim() !== ''
                  ? s['sceneId'].trim()
                  : typeof s['name'] === 'string' && s['name'].trim() !== ''
                    ? slugifySceneKey(s['name'].trim(), i)
                    : `scene_${i}`;

    let id = base;
    let n = 0;
    while (used.has(id)) {
      n += 1;
      id = `${base}_${n}`;
    }
    used.add(id);

    const entities = (Array.isArray(s['entities']) ? s['entities'] : []).map(normalizeEntityRow);
    return { ...s, id, entities };
  });

  let next: Record<string, unknown> = { ...root, scenes };
  const assetsRaw = root['assets'];
  if (Array.isArray(assetsRaw)) {
    const assets = assetsRaw
      .map(normalizeAssetRow)
      .filter((row): row is Record<string, unknown> => row !== null);
    next = { ...next, assets };
  }
  const audioRaw = root['audioTracks'];
  if (Array.isArray(audioRaw)) {
    const audioTracks = audioRaw
      .map(normalizeAudioTrackRow)
      .filter((row): row is Record<string, unknown> => row !== null);
    next = { ...next, audioTracks };
  }

  // Planner/Coder drift: initialSceneId must match a normalized scenes[].id or
  // bootstrap / Phaser may try to start a non-existent key (console warning + black screen).
  const sceneIds = new Set(
    scenes
      .map((s) => {
        const r = s as Record<string, unknown>;
        return typeof r['id'] === 'string' ? r['id'] : '';
      })
      .filter((id) => id.length > 0),
  );
  const initVal = next['initialSceneId'];
  const initStr =
    typeof initVal === 'string' && initVal.trim() !== ''
      ? initVal.trim()
      : typeof initVal === 'number' && Number.isFinite(initVal)
        ? String(initVal)
        : '';
  if (initStr && sceneIds.size > 0 && !sceneIds.has(initStr)) {
    const first = scenes[0] as Record<string, unknown>;
    const firstId = typeof first['id'] === 'string' ? first['id'] : '';
    if (firstId) {
      // eslint-disable-next-line no-console
      console.warn(
        `[opengame/runtime] game.json initialSceneId "${initStr}" does not match any scenes[].id; using "${firstId}".`,
      );
      next = { ...next, initialSceneId: firstId };
    }
  }

  return next;
}

/**
 * Lightweight validator (no zod dep) — checks the minimum the loader relies
 * on. Returns an array of human-readable errors; empty means valid.
 */
export function validateGameDsl(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return ['game.json must be a JSON object'];
  }
  const dsl = input as Partial<GameDsl>;
  if (typeof dsl.dslVersion !== 'string') errors.push('dslVersion missing');
  if (!dsl.meta || typeof dsl.meta.title !== 'string') {
    errors.push('meta.title required');
  }
  if (!Array.isArray(dsl.scenes) || dsl.scenes.length === 0) {
    errors.push('scenes must be a non-empty array');
  } else {
    const ids = new Set<string>();
    for (const s of dsl.scenes) {
      if (!s || typeof s.id !== 'string') {
        errors.push('scene.id required');
        continue;
      }
      if (ids.has(s.id)) errors.push(`duplicate scene id: ${s.id}`);
      ids.add(s.id);
      if (!Array.isArray(s.entities)) {
        errors.push(`scene ${s.id} entities must be array`);
      }
    }
  }
  return errors;
}
