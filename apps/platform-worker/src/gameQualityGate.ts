/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { GameArchetype } from './generationPipeline.js';
import {
  probeAudioBuffer,
  probePngBuffer,
  requireRealAssets,
} from './assetAuthenticity.js';
import {
  archetypeSceneRequirements,
  countCustomSceneFiles,
  detectExtraScenesNotBootable,
  detectFakeHudButtons,
  detectFragileRestartAndDeath,
  detectMissingOgTextureAliases,
  detectOpaqueSpriteAssets,
  detectSvgImageAssets,
  detectUnimplementedDslFields,
  detectWinLoseInScenes,
  detectSceneRegistrationMismatch,
  hasBattleOrLevelScene,
  mainUsesExtraScenes,
  readPipelineMeta,
  readWorkspaceArchetype,
} from './gameQualityArchetype.js';

export interface GameQualityResult {
  readonly ok: boolean;
  readonly issues: string[];
}

export interface GameQualityGateOptions {
  readonly archetype?: GameArchetype | null;
  readonly skipArchetypeSceneRules?: boolean;
}

const MINIMAL_SKILLS_PATCH = `{
  "skills": [
    {
      "id": "score",
      "trigger": { "kind": "onKey", "key": "SPACE" },
      "effects": [{ "kind": "addScore", "payload": { "delta": 1, "winAt": 5 } }]
    }
  ]
}`;

function issuesNeedSceneTsFix(issues: string[]): boolean {
  return issues.some(
    (i) =>
      i.includes('Scene') ||
      i.includes('extraScenes') ||
      i.includes('胜负') ||
      i.includes('GDD 要求'),
  );
}

function issuesNeedJsonFix(issues: string[]): boolean {
  return issues.some(
    (i) =>
      i.includes('runtime 不执行') ||
      i.includes('.svg') ||
      i.includes('skills') ||
      i.includes('玩法信号') ||
      i.includes('过于简单'),
  );
}

function resolveGameJsonPath(workspace: string): string | null {
  for (const rel of ['public/game.json', 'game.json']) {
    const p = path.join(workspace, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function detectPhaserCustomScenes(workspace: string): Promise<boolean> {
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (!fs.existsSync(scenesDir)) return false;
  const entries = await fsp.readdir(scenesDir, { withFileTypes: true });
  const hasSceneFiles = entries.some(
    (e) =>
      e.isFile() &&
      e.name.endsWith('Scene.ts') &&
      !e.name.startsWith('_Template'),
  );
  if (!hasSceneFiles) return false;

  const mainPath = path.join(workspace, 'src', 'main.ts');
  if (!fs.existsSync(mainPath)) return false;
  const mainSrc = await fsp.readFile(mainPath, 'utf8');
  // Engine scaffold uses bootstrap({ extraScenes }) — not `new Phaser.Game`.
  if (
    /Phaser\.Game|new Phaser\.Game|bootstrap\s*\(|extraScenes\s*:/.test(mainSrc)
  ) {
    return true;
  }
  // Fallback: game.json scenes declare customModule pointing at TS scenes.
  try {
    const gamePath = resolveGameJsonPath(workspace);
    if (!gamePath) return false;
    const dsl = JSON.parse(await fsp.readFile(gamePath, 'utf8')) as {
      scenes?: Array<{ customModule?: string }>;
    };
    return (dsl.scenes ?? []).some(
      (s) => typeof s.customModule === 'string' && s.customModule.length > 0,
    );
  } catch {
    return false;
  }
}

async function detectDialogueManagerRpg(workspace: string): Promise<boolean> {
  const mgr = path.join(workspace, 'src', 'systems', 'DialogueManager.ts');
  if (!fs.existsSync(mgr)) return false;
  const gamePath = resolveGameJsonPath(workspace);
  if (!gamePath) return false;
  try {
    const dsl = JSON.parse(await fsp.readFile(gamePath, 'utf8')) as Record<string, unknown>;
    const scenes = Array.isArray(dsl['scenes']) ? dsl['scenes'] : [];
    return scenes.length > 0;
  } catch {
    return false;
  }
}

async function readGameJsonSnippet(workspace: string, maxChars = 1200): Promise<string> {
  const gamePath = resolveGameJsonPath(workspace);
  if (!gamePath) return '<missing public/game.json>';
  const raw = await fsp.readFile(gamePath, 'utf8');
  return raw.length > maxChars ? `${raw.slice(0, maxChars)}\n…(truncated)` : raw;
}

/**
 * Content smoke gate after build passes — ensures the game is more than a movable block.
 */
export async function runGameQualityGate(
  workspace: string,
  mode: 'strict' | 'relaxed' = 'relaxed',
  options: GameQualityGateOptions = {},
): Promise<GameQualityResult> {
  const gamePath = resolveGameJsonPath(workspace);
  const issues: string[] = [];
  if (!gamePath) {
    return { ok: false, issues: ['缺少 public/game.json'] };
  }

  let dsl: Record<string, unknown>;
  try {
    dsl = JSON.parse(await fsp.readFile(gamePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { ok: false, issues: ['game.json 无法解析'] };
  }

  issues.push(...detectUnimplementedDslFields(dsl));
  issues.push(...detectSvgImageAssets(dsl));

  const archetype =
    options.archetype ?? (await readWorkspaceArchetype(workspace));
  const pipelineMeta = await readPipelineMeta(workspace);
  const sceneReq = options.skipArchetypeSceneRules
    ? null
    : archetypeSceneRequirements(archetype, pipelineMeta.gddSceneKeys);
  if (sceneReq && pipelineMeta.gddSceneKeys?.length) {
    for (const key of pipelineMeta.gddSceneKeys) {
      const fileName = `${key}.ts`;
      const p = path.join(workspace, 'src', 'scenes', fileName);
      if (!fs.existsSync(p)) {
        issues.push(`GDD 要求的 Scene "${key}" 缺少 src/scenes/${fileName}`);
      }
    }
  }
  if (sceneReq) {
    const sceneCount = await countCustomSceneFiles(workspace);
    if (sceneCount < sceneReq.minSceneFiles) {
      issues.push(
        `archetype=${archetype} 需要至少 ${sceneReq.minSceneFiles} 个 src/scenes/*Scene.ts（当前 ${sceneCount}）`,
      );
    }
    if (sceneReq.requireExtraScenes && !(await mainUsesExtraScenes(workspace))) {
      issues.push(
        'main.ts 必须使用 bootstrap({ source: "./game.json", extraScenes: [...] }) 注册自定义 Scene',
      );
    }
    if (sceneReq.requireBattleOrLevel && !(await hasBattleOrLevelScene(workspace))) {
      issues.push(
        '缺少 Battle/Combat/Level/World/Chapter 等核心玩法 Scene 文件（文件名需含上述关键词之一）',
      );
    }
    if (sceneReq.requireWinLoseHint && !(await detectWinLoseInScenes(workspace))) {
      issues.push(
        'Scene 代码中未检测到胜负/场景跳转逻辑（需 scene.start / onBattleEnd / GameOver / Victory 等）',
      );
    }
    issues.push(...(await detectSceneRegistrationMismatch(workspace)));
  }

  issues.push(...(await detectExtraScenesNotBootable(workspace, dsl)));
  issues.push(...(await detectFragileRestartAndDeath(workspace)));
  issues.push(...(await detectMissingOgTextureAliases(workspace)));
  issues.push(...(await detectFakeHudButtons(workspace)));
  issues.push(...(await detectOpaqueSpriteAssets(workspace)));

  const scenes = Array.isArray(dsl['scenes']) ? dsl['scenes'] : [];
  if (scenes.length === 0) issues.push('至少需要一个 scene');

  let entityCount = 0;
  let hasMovementOnly = true;
  let hasRuleSignal = false;

  for (const s of scenes) {
    if (!s || typeof s !== 'object') continue;
    const scene = s as Record<string, unknown>;
    const entities = Array.isArray(scene['entities']) ? scene['entities'] : [];
    entityCount += entities.length;
    for (const e of entities) {
      if (!e || typeof e !== 'object') continue;
      const ent = e as Record<string, unknown>;
      let behaviors = Array.isArray(ent['behaviors']) ? ent['behaviors'] : [];
      if (
        behaviors.length === 0 &&
        ent['behaviors'] &&
        typeof ent['behaviors'] === 'object' &&
        !Array.isArray(ent['behaviors'])
      ) {
        behaviors = Object.entries(ent['behaviors'] as Record<string, unknown>).map(
          ([kind]) => ({ kind: kind.charAt(0).toLowerCase() + kind.slice(1) }),
        );
      }
      for (const b of behaviors) {
        if (!b || typeof b !== 'object') continue;
        const kind = (b as Record<string, unknown>)['kind'];
        if (kind !== 'eightWayMovement' && kind !== 'velocity') {
          hasMovementOnly = false;
        }
        if (
          kind === 'shoot' ||
          kind === 'chase' ||
          kind === 'patrol' ||
          kind === 'dialog' ||
          kind === 'spawner' ||
          kind === 'collectOnTouch' ||
          kind === 'sceneTransition' ||
          kind === 'damageOnTouch'
        ) {
          hasRuleSignal = true;
        }
      }
    }
    if (scene['hud'] && typeof scene['hud'] === 'object') {
      const hud = scene['hud'] as Record<string, unknown>;
      if (hud['score'] || hud['lives']) hasRuleSignal = true;
    }
    if (
      scene['dialogue'] ||
      scene['dialogueKey'] ||
      scene['onEnter'] ||
      scene['onStart'] ||
      scene['script']
    ) {
      hasRuleSignal = true;
    }
  }

  const skills = Array.isArray(dsl['skills']) ? dsl['skills'] : [];
  if (skills.length > 0) {
    hasRuleSignal = true;
    hasMovementOnly = false;
  }

  const dialogue = Array.isArray(dsl['dialogue']) ? dsl['dialogue'] : [];
  if (dialogue.length > 0) hasRuleSignal = true;

  const cutscenes = Array.isArray(dsl['cutscenes']) ? dsl['cutscenes'] : [];
  if (cutscenes.length > 0) hasRuleSignal = true;

  if (dsl['gameFlow'] && typeof dsl['gameFlow'] === 'object') {
    hasRuleSignal = true;
  }

  const customModules = Array.isArray(dsl['customModules'])
    ? dsl['customModules']
    : [];
  if (customModules.length > 0) hasRuleSignal = true;

  const assets = Array.isArray(dsl['assets']) ? dsl['assets'] : [];
  const audioTracks = Array.isArray(dsl['audioTracks']) ? dsl['audioTracks'] : [];
  const hasAudio =
    assets.some(
      (a) =>
        a &&
        typeof a === 'object' &&
        ((a as Record<string, unknown>)['kind'] === 'audio' ||
          (a as Record<string, unknown>)['type'] === 'audio'),
    ) || audioTracks.length > 0;

  const srcMain = path.join(workspace, 'src', 'main.ts');
  const dialogueTs = path.join(workspace, 'src', 'dialogue.ts');
  const hasDialogueModule = fs.existsSync(dialogueTs);
  if (hasDialogueModule) hasRuleSignal = true;

  const hasPhaserScenes = await detectPhaserCustomScenes(workspace);
  const hasDialogueManagerRpg = await detectDialogueManagerRpg(workspace);
  if (hasPhaserScenes || hasDialogueManagerRpg) {
    hasRuleSignal = true;
    hasMovementOnly = false;
  }

  const hasCustomTs =
    customModules.length > 0 ||
    hasDialogueModule ||
    hasPhaserScenes ||
    hasDialogueManagerRpg ||
    (fs.existsSync(srcMain) &&
      (await fsp.readFile(srcMain, 'utf8')).includes('extraScenes'));

  if (entityCount < 1 && !hasPhaserScenes) {
    issues.push('至少需要一个实体');
  }
  if (!hasRuleSignal && !hasCustomTs) {
    issues.push(
      '缺少玩法信号：需要 skills/rules/dialogue/HUD 计分或自定义 Scene（不能只有移动）',
    );
  }
  if (hasMovementOnly && entityCount <= 1 && !hasCustomTs) {
    issues.push('玩法过于简单：仅单实体移动，请增加规则或更多实体');
  }

  if (mode === 'strict' && !hasAudio) {
    issues.push('strict 模式要求至少一个 audio 资产或 audioTracks 条目');
  }

  // Beyond-baseline: require at least one raster image asset (not movement-only placeholder)
  const beyond =
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] === 'true' ||
    process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] === '1' ||
    mode === 'strict';
  if (beyond) {
    const raster = assets.filter(
      (a) =>
        a &&
        typeof a === 'object' &&
        ((a as Record<string, unknown>)['kind'] === 'image' ||
          (a as Record<string, unknown>)['type'] === 'image'),
    );
    // grid: ≥1 image; other archetypes: subject + background (≥2)
    const minImages = archetype === 'grid_logic' ? 1 : 2;
    if (raster.length < minImages) {
      issues.push(
        `ArtDirector beyond-baseline: need >= ${minImages} image asset(s) (png/webp; subject+bg for non-grid); FIX may call generate_game_assets`,
      );
    }
    for (const a of raster) {
      if (!a || typeof a !== 'object') continue;
      const rec = a as Record<string, unknown>;
      const url = String(rec['url'] ?? rec['src'] ?? rec['path'] ?? '');
      if (!url) {
        issues.push('ArtDirector: image asset missing url/src');
        continue;
      }
      if (!/\.(png|webp)(\?|$)/i.test(url) && !url.startsWith('data:image/')) {
        issues.push(`ArtDirector: image must be png/webp (got ${url})`);
        continue;
      }
      if (url.startsWith('data:image/')) continue;
      const rel = url.replace(/^\.\//, '').replace(/^\/+/, '');
      const candidates = [
        path.join(workspace, 'public', rel),
        path.join(workspace, rel),
        path.join(workspace, 'public', url),
      ];
      if (!candidates.some((p) => fs.existsSync(p))) {
        issues.push(`ArtDirector: image asset missing on disk: ${url}`);
      }
    }

    // Audio on-disk (strict / beyond): phantom .mp3 paths must fail
    const audioAssets = assets.filter(
      (a) =>
        a &&
        typeof a === 'object' &&
        ((a as Record<string, unknown>)['kind'] === 'audio' ||
          (a as Record<string, unknown>)['type'] === 'audio'),
    );
    const audioUrls: string[] = [];
    for (const a of audioAssets) {
      const rec = a as Record<string, unknown>;
      const url = String(rec['url'] ?? rec['src'] ?? rec['path'] ?? '');
      if (url) audioUrls.push(url);
    }
    for (const track of audioTracks) {
      if (!track || typeof track !== 'object') continue;
      const rec = track as Record<string, unknown>;
      const url = String(rec['url'] ?? rec['src'] ?? rec['path'] ?? '');
      if (url) audioUrls.push(url);
    }
    for (const url of audioUrls) {
      if (url.startsWith('data:audio/')) continue;
      if (!/\.(mp3|ogg|wav|m4a)(\?|$)/i.test(url)) {
        issues.push(`ArtDirector: audio must be mp3/ogg/wav (got ${url})`);
        continue;
      }
      const rel = url.replace(/^\.\//, '').replace(/^\/+/, '');
      const candidates = [
        path.join(workspace, 'public', rel),
        path.join(workspace, rel),
        path.join(workspace, 'public', url),
      ];
      if (!candidates.some((p) => fs.existsSync(p))) {
        issues.push(`ArtDirector: audio asset missing on disk: ${url}`);
      }
    }

    // Reject tiny / near-solid PNGs (procedural placeholders)
    if (requireRealAssets()) {
      for (const a of raster) {
        if (!a || typeof a !== 'object') continue;
        const rec = a as Record<string, unknown>;
        const url = String(rec['url'] ?? rec['src'] ?? rec['path'] ?? '');
        if (!url || url.startsWith('data:image/')) {
          if (url.startsWith('data:image/')) {
            issues.push(
              'ArtDirector: data:image URIs not allowed under real-asset policy — write public/assets/*.png',
            );
          }
          continue;
        }
        const rel = url.replace(/^\.\//, '').replace(/^\/+/, '');
        const candidates = [
          path.join(workspace, 'public', rel),
          path.join(workspace, rel),
          path.join(workspace, 'public', url),
        ];
        const hit = candidates.find((p) => fs.existsSync(p));
        if (!hit) continue;
        const buf = fs.readFileSync(hit);
        const probe = probePngBuffer(buf);
        if (!probe.ok) {
          issues.push(`ArtDirector authenticity ${url}: ${probe.reason}`);
        }
      }
      for (const url of audioUrls) {
        if (url.startsWith('data:audio/')) {
          issues.push(
            'ArtDirector: data:audio URIs not allowed — write public/assets/*.mp3',
          );
          continue;
        }
        const rel = url.replace(/^\.\//, '').replace(/^\/+/, '');
        const candidates = [
          path.join(workspace, 'public', rel),
          path.join(workspace, rel),
          path.join(workspace, 'public', url),
        ];
        const hit = candidates.find((p) => fs.existsSync(p));
        if (!hit) continue;
        const probe = probeAudioBuffer(fs.readFileSync(hit));
        if (!probe.ok) {
          issues.push(`ArtDirector authenticity ${url}: ${probe.reason}`);
        }
      }
      if (audioUrls.length < 1) {
        issues.push(
          'ArtDirector beyond-baseline: need >= 1 audio asset on disk (BGM); FIX may call generate_game_assets',
        );
      }
      const audioIds = [
        ...audioAssets.map((a) =>
          String((a as Record<string, unknown>)['id'] ?? ''),
        ),
        ...audioTracks.map((t) =>
          String((t as Record<string, unknown>)['id'] ?? ''),
        ),
      ].join(' ');
      if (
        archetype &&
        archetype !== 'grid_logic' &&
        !/sfx_win/i.test(audioIds) &&
        !/sfx_lose/i.test(audioIds)
      ) {
        issues.push(
          'ArtDirector beyond-baseline: add audio ids sfx_win and/or sfx_lose for result Scene kernels',
        );
      }

      // Entities must reference raster assetIds — no pure shape placeholders
      const scenes = Array.isArray(dsl['scenes']) ? dsl['scenes'] : [];
      let shapeOnlyTagged = 0;
      let playerWired = false;
      for (const scene of scenes) {
        if (!scene || typeof scene !== 'object') continue;
        const entities = (scene as Record<string, unknown>)['entities'];
        if (!Array.isArray(entities)) continue;
        for (const ent of entities) {
          if (!ent || typeof ent !== 'object') continue;
          const e = ent as Record<string, unknown>;
          const tags = Array.isArray(e['tags'])
            ? e['tags'].map((t) => String(t).toLowerCase())
            : [];
          const id = String(e['id'] ?? '').toLowerCase();
          const sprite =
            e['sprite'] && typeof e['sprite'] === 'object'
              ? (e['sprite'] as Record<string, unknown>)
              : null;
          if (!sprite) continue;
          const assetId = String(sprite['assetId'] ?? '');
          const tagged =
            tags.includes('player') ||
            tags.includes('enemy') ||
            tags.includes('item') ||
            /player|hero|enemy|hazard|item|coin/.test(id);
          if (tagged && !assetId && (sprite['shape'] || sprite['color'])) {
            shapeOnlyTagged += 1;
          }
          if (
            (tags.includes('player') || id === 'player' || id.includes('hero')) &&
            assetId === 'player'
          ) {
            playerWired = true;
          }
        }
      }
      if (shapeOnlyTagged > 0) {
        issues.push(
          `ArtDirector: ${shapeOnlyTagged} tagged entit(y/ies) still use shape/color without assetId — wire MiniMax player/enemy/item`,
        );
      }
      const hasPlayerEntity = scenes.some((scene) => {
        if (!scene || typeof scene !== 'object') return false;
        const entities = (scene as Record<string, unknown>)['entities'];
        if (!Array.isArray(entities)) return false;
        return entities.some((ent) => {
          if (!ent || typeof ent !== 'object') return false;
          const e = ent as Record<string, unknown>;
          const tags = Array.isArray(e['tags'])
            ? e['tags'].map((t) => String(t).toLowerCase())
            : [];
          const id = String(e['id'] ?? '').toLowerCase();
          return (
            tags.includes('player') || id === 'player' || id.includes('hero')
          );
        });
      });
      if (hasPlayerEntity && !playerWired && archetype !== 'grid_logic') {
        issues.push(
          'ArtDirector: player entity missing sprite.assetId="player" under real-asset policy',
        );
      }
      // Canonical MiniMax pack: require when game.json already uses those ids
      // (or PLATFORM_GAME_MINIMAX_ASSETS). Scene-only hero/bg fixtures stay soft.
      const assetIds = assets
        .filter((a) => a && typeof a === 'object')
        .map((a) => String((a as Record<string, unknown>)['id'] ?? ''));
      const usesMiniMaxPack =
        assetIds.includes('player') ||
        assetIds.includes('background') ||
        assetIds.includes('enemy') ||
        assetIds.includes('item') ||
        process.env['PLATFORM_GAME_MINIMAX_ASSETS'] === 'true' ||
        process.env['PLATFORM_GAME_MINIMAX_ASSETS'] === '1';
      const packRequired =
        usesMiniMaxPack && archetype !== 'grid_logic'
          ? new Set([
              'player.png',
              'player_run.png',
              'background.png',
              'enemy.png',
              'item.png',
            ])
          : new Set<string>();
      for (const name of packRequired) {
        const full = path.join(workspace, 'public', 'assets', name);
        if (!fs.existsSync(full)) {
          // player_run soft-missing: copy from player if present (idle fallback)
          if (name === 'player_run.png') {
            const playerFull = path.join(workspace, 'public', 'assets', 'player.png');
            if (fs.existsSync(playerFull)) {
              try {
                await fsp.copyFile(playerFull, full);
              } catch {
                issues.push(
                  `ArtDirector: missing MiniMax pack assets/${name} — regenerate with generate_game_assets / runGameAssetPhase`,
                );
                continue;
              }
            } else {
              issues.push(
                `ArtDirector: missing MiniMax pack assets/${name} — regenerate with generate_game_assets / runGameAssetPhase`,
              );
              continue;
            }
          } else {
            issues.push(
              `ArtDirector: missing MiniMax pack assets/${name} — regenerate with generate_game_assets / runGameAssetPhase`,
            );
            continue;
          }
        }
        const probe = probePngBuffer(fs.readFileSync(full));
        if (!probe.ok) {
          issues.push(`ArtDirector authenticity assets/${name}: ${probe.reason}`);
        }
      }
      // Always authenticate pack files if they happen to exist
      for (const name of [
        'player.png',
        'player_run.png',
        'background.png',
        'enemy.png',
        'item.png',
      ]) {
        if (packRequired.has(name)) continue;
        const full = path.join(workspace, 'public', 'assets', name);
        if (!fs.existsSync(full)) continue;
        const probe = probePngBuffer(fs.readFileSync(full));
        if (!probe.ok) {
          issues.push(`ArtDirector authenticity assets/${name}: ${probe.reason}`);
        }
      }
    }

    const { readMechanicSpec } = await import('./mechanicSpec.js');
    const mechanic = readMechanicSpec(workspace);
    if (mechanic && mechanic.loops.length > 0) {
      const scenesDirLoops = path.join(workspace, 'src', 'scenes');
      let loopEvidence = '';
      if (fs.existsSync(scenesDirLoops)) {
        for (const f of await fsp.readdir(scenesDirLoops)) {
          if (!f.endsWith('.ts')) continue;
          loopEvidence += await fsp.readFile(path.join(scenesDirLoops, f), 'utf8');
        }
      }
      const mainLoop = path.join(workspace, 'src', 'main.ts');
      if (fs.existsSync(mainLoop)) {
        loopEvidence += await fsp.readFile(mainLoop, 'utf8');
      }
      for (const loop of mechanic.loops) {
        if (loop.source === 'custom') {
          const primary = loop.signals[0];
          let hit = false;
          if (primary) {
            try {
              hit = new RegExp(primary, 'i').test(loopEvidence);
            } catch {
              hit = loopEvidence.includes(loop.label);
            }
          }
          if (!hit) {
            issues.push(
              `超越基线：点名循环「${loop.label}」未见实现（必须出现「${loop.label}」，不能只靠 registry.won 冒充）`,
            );
          }
          continue;
        }
        const hits = loop.signals.filter((s) => {
          try {
            return new RegExp(s, 'i').test(loopEvidence);
          } catch {
            return false;
          }
        });
        if (hits.length < 1) {
          issues.push(
            `超越基线：点名循环「${loop.label}」未见实现（${loop.signals[0] ?? loop.id}）`,
          );
        }
      }
    }

    // Named loops are the primary beyond-baseline. A win signal is still
    // required, but registry.won on a bound BoardTurnScene counts — mixed
    // explore+board must not be failed for lacking a Victory jump.
    if (archetype && archetype !== 'grid_logic') {
      const hasJump = await detectWinLoseInScenes(workspace);
      let sceneBlob = '';
      const scenesDirWin = path.join(workspace, 'src', 'scenes');
      if (fs.existsSync(scenesDirWin)) {
        for (const f of await fsp.readdir(scenesDirWin)) {
          if (!f.endsWith('.ts')) continue;
          sceneBlob += await fsp.readFile(path.join(scenesDirWin, f), 'utf8');
        }
      }
      const hasWonFlag = /registry\.set\(\s*['"]won['"]/.test(sceneBlob);
      if (mechanic && mechanic.loops.length > 0) {
        if (!hasJump && !hasWonFlag) {
          issues.push(
            '超越基线：点名循环之外还需要胜负信号（registry.won 或 Victory/GameOver/Ending 跳转）',
          );
        }
      } else if (!hasJump) {
        issues.push(
          '超越基线：非 grid 游戏必须有可检测的胜负/通关路径（scene.start Victory|GameOver|Ending + registry won）',
        );
      }
    }
    // grid_logic: arcade still uses skills.winAt; board-turn wins via Scene registry.won
    if (archetype === 'grid_logic') {
      const { leftoverSpaceShell, workspaceLooksLikeBoardTurn } = await import(
        './gridArcadeKernels.js'
      );
      const boardTurn = workspaceLooksLikeBoardTurn(workspace);
      if (boardTurn) {
        const scenesDir = path.join(workspace, 'src', 'scenes');
        let sceneSrc = '';
        if (fs.existsSync(scenesDir)) {
          for (const f of await fsp.readdir(scenesDir)) {
            if (!f.endsWith('.ts')) continue;
            sceneSrc += await fsp.readFile(path.join(scenesDir, f), 'utf8');
          }
        }
        const hasWon =
          /registry\.set\(\s*['"]won['"]/.test(sceneSrc) ||
          (await detectWinLoseInScenes(workspace));
        if (!hasWon) {
          issues.push(
            '棋盘循环需 Scene 内 registry.won / 将死结束（不要用 skills.winAt 冒充）',
          );
        }
        if (leftoverSpaceShell(workspace) || /score_space/.test(JSON.stringify(skills))) {
          issues.push('棋盘种子仍是空格加分壳 — 换成 BoardTurnScene + module-board');
        }
      } else if (skills.length < 1) {
        issues.push('grid_logic 需至少 1 条 skills[]（SPACE 计分等）');
      } else {
        const rawSkills = JSON.stringify(skills);
        const hasWin =
          /"winAt"\s*:\s*[1-9]/.test(rawSkills) ||
          /"key"\s*:\s*"won"/.test(rawSkills) ||
          /registry\.set\(\s*['"]won['"]/.test(rawSkills);
        if (!hasWin) {
          issues.push(
            'grid_logic beyond-baseline: skills 需胜负信号（addScore.winAt 或 setState won）',
          );
        }
      }
    }

    // TD kernels must use module-td APIs (eval: place towers + waves)
    if (archetype === 'tower_defense') {
      const scenesDirTd = path.join(workspace, 'src', 'scenes');
      let tdSrc = '';
      if (fs.existsSync(scenesDirTd)) {
        const files = await fsp.readdir(scenesDirTd);
        for (const f of files) {
          if (!f.endsWith('Scene.ts')) continue;
          tdSrc += await fsp.readFile(path.join(scenesDirTd, f), 'utf8');
        }
      }
      if (!tdSrc.includes('WaveManager') || !tdSrc.includes('EconomyManager')) {
        issues.push(
          'TD 需使用 @opengame/module-td 的 WaveManager + EconomyManager（放置塔防 + 波次）',
        );
      }
      if (!/registry\.set\(\s*['"]won['"]/.test(tdSrc)) {
        issues.push('TD 需 registry.set("won", ...) 通关/失败路径');
      }
    }

    // Reject leftover empty TODO stubs (pre-kernel era)
    const scenesDir = path.join(workspace, 'src', 'scenes');
    if (fs.existsSync(scenesDir)) {
      const files = await fsp.readdir(scenesDir);
      let juiceHits = 0;
      let gameplayScenes = 0;
      for (const f of files) {
        if (!f.endsWith('Scene.ts')) continue;
        const src = await fsp.readFile(path.join(scenesDir, f), 'utf8');
        if (
          src.includes('implement gameplay') ||
          /\/\/ TODO:.*实现完整玩法/.test(src)
        ) {
          issues.push(
            `Scene 仍为空白桩：${f} — 请替换为可玩内核（胜负/跳转），勿保留 implement gameplay`,
          );
        }
        if (/Title|Ending|Victory|GameOver|Chapter/i.test(f)) continue;
        gameplayScenes += 1;
        if (
          /PlatformSceneHelper|preloadGameAudio|playSfx|addParallaxBackground|installPauseMenu|startFollow/.test(
            src,
          )
        ) {
          juiceHits += 1;
        }
      }
      // Juice lock: MiniMax engine packs OR ChangePlan iterate must keep helpers
      const hasMiniMaxPlayer = fs.existsSync(
        path.join(workspace, 'public', 'assets', 'player.png'),
      );
      const minimaxOn =
        process.env['PLATFORM_GAME_MINIMAX_ASSETS'] === 'true' ||
        process.env['PLATFORM_GAME_MINIMAX_ASSETS'] === '1' ||
        hasMiniMaxPlayer;
      const hasChangePlan = fs.existsSync(
        path.join(workspace, 'public', 'CHANGE_PLAN.json'),
      );
      const juiceRequired =
        (requireRealAssets() || beyond || hasChangePlan) &&
        minimaxOn &&
        archetype &&
        archetype !== 'grid_logic' &&
        gameplayScenes > 0;
      if (juiceRequired && juiceHits === 0) {
        issues.push(
          'Juice 保活：玩法 Scene 缺少 PlatformSceneHelper / playSfx / followPlayer / pause — 勿把内核退化成无音效色块',
        );
      }
      // Harder regression: if juice was partially present (hit some files) but not all gameplay scenes
      if (
        juiceRequired &&
        juiceHits > 0 &&
        juiceHits < gameplayScenes &&
        hasChangePlan
      ) {
        issues.push(
          'Juice 保活：部分玩法 Scene 丢失 PlatformSceneHelper — 迭代时禁止删 juice 调用',
        );
      }
    }
  }

  // Juice hard-lock vs baseline snapshot (prevents CODE from stripping SFX forever)
  try {
    const { issuesFromJuiceBaseline } = await import('./juiceBaseline.js');
    issues.push(...(await issuesFromJuiceBaseline(workspace)));
  } catch {
    // optional module
  }

  // ChangePlan intent gate (multi-turn): Boss / harder must be visible in workspace
  try {
    const planPath = path.join(workspace, 'public', 'CHANGE_PLAN.json');
    if (fs.existsSync(planPath)) {
      const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as {
        addBoss?: boolean;
        difficulty?: string | null;
        artStyle?: string | null;
        addDialogue?: boolean;
        editLevel?: boolean;
        targetSceneId?: string | null;
        preserveScenes?: string[];
      };
      if (plan.addBoss) {
        const scenesDirBoss = path.join(workspace, 'src', 'scenes');
        let blob = JSON.stringify(dsl);
        if (fs.existsSync(scenesDirBoss)) {
          for (const f of await fsp.readdir(scenesDirBoss)) {
            if (!f.endsWith('.ts')) continue;
            blob += await fsp.readFile(path.join(scenesDirBoss, f), 'utf8');
          }
        }
        if (!/\bboss\b/i.test(blob)) {
          issues.push(
            'ChangePlan addBoss: 工作区未见 boss 标签/实体/Scene — 请在 entities.tags 加入 boss 或实现 Boss 战',
          );
        }
        if (!/bossPresent|setData\(\s*['"]boss['"]/i.test(blob)) {
          issues.push(
            'ChangePlan addBoss: Scene 未见 bossPresent/setData(boss) 生成路径 — 玩法可能不可见',
          );
        }
      }
      if (plan.difficulty === 'harder') {
        const scenesDirH = path.join(workspace, 'src', 'scenes');
        let srcBlob = '';
        if (fs.existsSync(scenesDirH)) {
          for (const f of await fsp.readdir(scenesDirH)) {
            if (!f.endsWith('Scene.ts')) continue;
            srcBlob += await fsp.readFile(path.join(scenesDirH, f), 'utf8');
          }
        }
        const harderSignal =
          /enemyCount\s*[:=]\s*[5-9]|enemyHp\s*[:=]\s*[3-9]|gravityY:\s*1[0-9]{2,}|spawnIntervalMs:\s*[1-6]\d{2}|HARDER|difficulty.*hard|difficultyTier/i.test(
            srcBlob,
          ) ||
          /"winAt"\s*:\s*[8-9]|winAt"\s*:\s*[1-9]\d/.test(JSON.stringify(dsl)) ||
          /"enemyCount"\s*:\s*[5-9]/.test(JSON.stringify(dsl));
        if (!harderSignal && archetype !== 'grid_logic') {
          issues.push(
            'ChangePlan harder: 未见可测难度提升（敌人数/HP/波次间隔/gravity/winAt）— 请相对基线加强',
          );
        }
      }
      if (plan.artStyle) {
        const gdd = path.join(workspace, 'GAME_DESIGN.md');
        if (fs.existsSync(gdd)) {
          const gddText = fs.readFileSync(gdd, 'utf8');
          if (!/art\s*style[:：]/i.test(gddText)) {
            issues.push(
              'ChangePlan artStyle: GAME_DESIGN.md 缺少 art style 行',
            );
          } else {
            const styleToken = plan.artStyle
              .toLowerCase()
              .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, ' ')
              .trim()
              .split(/\s+/)
              .filter((t) => t.length >= 3)
              .slice(0, 4);
            const gddLower = gddText.toLowerCase();
            const hit = styleToken.some((t) => gddLower.includes(t));
            if (styleToken.length > 0 && !hit) {
              issues.push(
                `ChangePlan artStyle: GDD art style 未对齐「${plan.artStyle}」— 请更新 style_anchor 并 force 重生资产`,
              );
            }
          }
        }
        try {
          const { issuesFromArtStyleFingerprint } = await import(
            './assetFingerprint.js'
          );
          issues.push(
            ...(await issuesFromArtStyleFingerprint(workspace, plan.artStyle)),
          );
        } catch {
          issues.push(
            'ChangePlan artStyle: 无法校验 ASSET_FINGERPRINT — 请 force 重生资产',
          );
        }
      }
      if (plan.addDialogue) {
        const storyPath = path.join(
          workspace,
          'public',
          'story',
          'chapter_01.json',
        );
        const dialogueArr = Array.isArray(dsl['dialogue']) ? dsl['dialogue'] : [];
        let sceneBlob = '';
        const scenesDirD = path.join(workspace, 'src', 'scenes');
        if (fs.existsSync(scenesDirD)) {
          for (const f of await fsp.readdir(scenesDirD)) {
            if (!f.endsWith('.ts')) continue;
            sceneBlob += await fsp.readFile(path.join(scenesDirD, f), 'utf8');
          }
        }
        const hasRuntime =
          /DialogueManager|hasDialogue|__ogDialogueSeeded|og_story_chapter/i.test(
            sceneBlob,
          );
        const hasData =
          fs.existsSync(storyPath) || dialogueArr.length > 0;
        if (!hasRuntime && !hasData) {
          issues.push(
            'ChangePlan addDialogue: 未见 DialogueManager / public/story / dialogue[] — 请落地对话内容',
          );
        }
      }
      if (plan.targetSceneId && (plan.editLevel || plan.preserveScenes?.length)) {
        const prevPath = path.join(workspace, 'public', 'SCENE_HASH_PREV.json');
        if (fs.existsSync(prevPath)) {
          try {
            const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8')) as {
              hashes?: Record<string, string>;
              targetSceneId?: string | null;
            };
            const scenesDirP = path.join(workspace, 'src', 'scenes');
            if (fs.existsSync(scenesDirP) && prev.hashes) {
              const crypto = await import('node:crypto');
              for (const [file, oldHash] of Object.entries(prev.hashes)) {
                if (
                  prev.targetSceneId &&
                  (file.includes(prev.targetSceneId) ||
                    file.replace(/\.ts$/i, '') === prev.targetSceneId)
                ) {
                  continue;
                }
                const full = path.join(scenesDirP, file);
                if (!fs.existsSync(full)) continue;
                const buf = fs.readFileSync(full);
                const now = crypto
                  .createHash('sha256')
                  .update(buf)
                  .digest('hex')
                  .slice(0, 16);
                if (now !== oldHash) {
                  issues.push(
                    `ChangePlan targetScene: 非目标 Scene ${file} 被改动（应只改 ${plan.targetSceneId}）`,
                  );
                }
              }
            }
          } catch {
            /* optional */
          }
        }
      }
    }
  } catch {
    // ignore malformed plan
  }

  // Narrative archetype gates (ui_heavy / top_down short stories)
  if (archetype === 'ui_heavy' || archetype === 'top_down') {
    const biblePath = path.join(workspace, 'public', 'STORY_BIBLE.json');
    const chapterPath = path.join(
      workspace,
      'public',
      'story',
      'chapter_01.json',
    );
    if (!fs.existsSync(biblePath)) {
      issues.push(
        '叙事门禁: 缺少 public/STORY_BIBLE.json（章节×NPC×任务大纲）',
      );
    } else {
      try {
        const bible = JSON.parse(fs.readFileSync(biblePath, 'utf8')) as {
          npcs?: unknown[];
          quests?: unknown[];
          endings?: Array<{ id?: string; title?: string; body?: string }>;
          flags?: Record<string, unknown>;
          winCondition?: string;
        };
        const npcCount = Array.isArray(bible.npcs) ? bible.npcs.length : 0;
        const questCount = Array.isArray(bible.quests) ? bible.quests.length : 0;
        if (npcCount < 2) {
          issues.push(
            '叙事门禁: STORY_BIBLE 需要 ≥2 可对话 NPC（短篇剧情产能）',
          );
        }
        if (questCount < 1) {
          issues.push('叙事门禁: STORY_BIBLE 需要 ≥1 任务状态机条目');
        }
        const endings = Array.isArray(bible.endings) ? bible.endings : [];
        const endingOk = (id: string) =>
          endings.some(
            (e) =>
              e?.id === id &&
              typeof e.title === 'string' &&
              e.title.trim().length > 0 &&
              typeof e.body === 'string' &&
              e.body.trim().length > 0,
          );
        if (!endingOk('ending_a') || !endingOk('ending_b')) {
          issues.push(
            '叙事门禁: STORY_BIBLE 需要 endings[] 含 ending_a/ending_b（title+body）',
          );
        }
        const flags = bible.flags ?? {};
        const flagKeys = Object.keys(flags);
        if (
          flagKeys.length === 0 &&
          !/ending|flag|win/i.test(String(bible.winCondition ?? ''))
        ) {
          issues.push(
            '叙事门禁: 胜负应与对话 flag / winCondition 挂钩（STORY_BIBLE.flags）',
          );
        }
      } catch {
        issues.push('叙事门禁: STORY_BIBLE.json 无法解析');
      }
    }
    if (!fs.existsSync(chapterPath)) {
      issues.push(
        '叙事门禁: 缺少 public/story/chapter_01.json（Chapter 应只 load JSON）',
      );
    } else {
      try {
        const ch = JSON.parse(fs.readFileSync(chapterPath, 'utf8')) as {
          entries?: Array<Record<string, unknown>>;
        };
        if (!Array.isArray(ch.entries) || ch.entries.length < 3) {
          issues.push(
            '叙事门禁: chapter_01.json entries 过少（需含 choice 分支）',
          );
        } else {
          const blob = JSON.stringify(ch);
          if (!/"type"\s*:\s*"choice"|choice/i.test(blob)) {
            issues.push('叙事门禁: chapter 对话缺少 choice 分支');
          }
          const { auditDialogueReachability } = await import(
            './experienceGate.js'
          );
          for (const issue of auditDialogueReachability(ch.entries)) {
            issues.push(`体验门禁/对话: ${issue}`);
          }
        }
      } catch {
        issues.push('叙事门禁: chapter_01.json 无法解析');
      }
    }
    // Multi-chapter presence when bible lists >1
    try {
      if (fs.existsSync(biblePath)) {
        const bible = JSON.parse(fs.readFileSync(biblePath, 'utf8')) as {
          chapters?: Array<{ file?: string }>;
        };
        const chapters = Array.isArray(bible.chapters) ? bible.chapters : [];
        for (const ch of chapters.slice(0, 4)) {
          if (!ch.file) continue;
          const p = path.join(workspace, 'public', ch.file);
          if (!fs.existsSync(p)) {
            issues.push(`叙事门禁: 缺少 ${ch.file}`);
          }
        }
      }
    } catch {
      /* optional */
    }
    // Content Graph SSOT
    const graphPath = path.join(workspace, 'public', 'CONTENT_GRAPH.json');
    if (!fs.existsSync(graphPath)) {
      issues.push('叙事门禁: 缺少 public/CONTENT_GRAPH.json（内容图 SSOT）');
    }
    // Scene wiring: DialogueManager or story load
    const scenesDirN = path.join(workspace, 'src', 'scenes');
    if (fs.existsSync(scenesDirN)) {
      let sceneBlob = '';
      for (const f of await fsp.readdir(scenesDirN)) {
        if (!f.endsWith('.ts')) continue;
        sceneBlob += await fsp.readFile(path.join(scenesDirN, f), 'utf8');
      }
      if (
        archetype === 'ui_heavy' &&
        !/DialogueManager|og_story_chapter|loadFromStoryJson/i.test(sceneBlob)
      ) {
        issues.push(
          '叙事门禁: Chapter/对话 Scene 未见 DialogueManager / story JSON 加载',
        );
      }
      if (
        archetype === 'top_down' &&
        !/keydown-E|dialogueSeed|DialogueManager|talk/i.test(sceneBlob)
      ) {
        issues.push(
          '叙事门禁: top_down 未见 E 对话 / 多 NPC 交互接线',
        );
      }
      // Prefer cast-driven or ≥2 interactive NPCs (bible ids, not hardcoded Guide/Smith)
      if (archetype === 'top_down') {
        const hasCastDriven =
          /bible\?\.npcs|cast\.forEach|npcAssetKey|talked_|giverNpcId/i.test(
            sceneBlob,
          );
        const npcLabels = (
          sceneBlob.match(/\.setText\([^)]*(?:Guide|Smith|Traveler|NPC)/gi) ?? []
        ).length;
        const npcVars = (sceneBlob.match(/\bnpc\w*\s*=/gi) ?? []).length;
        if (!hasCastDriven && npcLabels + npcVars < 2) {
          issues.push(
            '叙事门禁: top_down 建议 ≥2 可交互 NPC（对照 STORY_BIBLE）',
          );
        }
      }
      const { auditSceneLayoutOverflow } = await import('./experienceGate.js');
      for (const issue of auditSceneLayoutOverflow(sceneBlob)) {
        issues.push(issue);
      }
      if (
        !/ContentDirector|CONTENT_GRAPH|STORY_BIBLE|og_story_bible/i.test(
          sceneBlob,
        )
      ) {
        issues.push(
          '体验门禁: 叙事 Scene 应加载 STORY_BIBLE / ContentDirector（内容进 Spec）',
        );
      }
      if (
        /GameOverScene|EndingScene/i.test(sceneBlob) &&
        !/endings|endingMeta|og_story_bible/i.test(sceneBlob)
      ) {
        issues.push(
          '体验门禁: Ending/GameOver 应消费 STORY_BIBLE.endings（双结局文案）',
        );
      }
      if (
        /DialogueManager/.test(sceneBlob) &&
        !/leaveChapter|Skip · S|keydown-S/i.test(sceneBlob)
      ) {
        issues.push(
          '体验门禁: Chapter 建议提供 Skip（leaveChapter / KeyS）以便开场进 World',
        );
      }
      if (
        archetype === 'top_down' &&
        !/resolveWorldLayoutsBySceneId|worldRegionId|resolvePortalHop/i.test(
          sceneBlob,
        )
      ) {
        issues.push(
          '体验门禁: top_down 建议多区域 layout（resolveWorldLayoutsBySceneId / worldRegionId）与门户跳转',
        );
      }
    }

    // Storyboard narrative art slots (beyond / strict)
    const beyond =
      process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] === 'true' ||
      process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] === '1' ||
      mode === 'strict';
    if (beyond && fs.existsSync(biblePath)) {
      try {
        const { listExpectedNarrativeAssetSlots } = await import(
          './gameAssetPhase.js'
        );
        const expected = listExpectedNarrativeAssetSlots(workspace);
        const assetsDir = path.join(workspace, 'public', 'assets');
        const missing = expected.filter(
          (id) => !fs.existsSync(path.join(assetsDir, `${id}.png`)),
        );
        if (missing.length > 0) {
          issues.push(
            `叙事门禁: 分镜资产缺失 ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}（对照 STORY_BIBLE / ASSET_BRIEF.storyboard）`,
          );
        }
        const briefPath = path.join(workspace, 'public', 'ASSET_BRIEF.json');
        if (expected.length > 0 && fs.existsSync(briefPath)) {
          try {
            const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8')) as {
              storyboard?: unknown;
            };
            if (!brief.storyboard) {
              issues.push(
                '体验门禁: ASSET_BRIEF 缺少 storyboard 分镜表（NPC/章节背景）',
              );
            }
          } catch {
            /* optional */
          }
        }
      } catch {
        /* optional */
      }
    }
  }

  const mainExists = fs.existsSync(srcMain);
  if (!mainExists) issues.push('缺少 src/main.ts');

  return { ok: issues.length === 0, issues };
}

function issueFixHints(issues: string[]): string[] {
  const hints: string[] = [
    '【修复优先级】复杂游戏必须用 src/scenes/*.ts + extraScenes；不要写 runtime 未实现的 game.json 字段（gameFlow/spawners/rules 对象等）。',
  ];
  for (const issue of issues) {
    if (issue.includes('runtime 不执行') || issue.includes('.svg')) {
      hints.push('1. 删除未实现的 JSON 字段，在 TypeScript Scene 中实现同等逻辑；图片用 .png/.webp。');
    } else if (issue.includes('extraScenes')) {
      hints.push(
        '2. 在 src/main.ts: `import { TitleScene } from "./scenes/TitleScene"; await bootstrap({ source: "./game.json", extraScenes: [TitleScene, ...] });`',
      );
    } else if (issue.includes('customModule') || issue.includes('启动场景')) {
      hints.push(
        '2. 在 public/game.json：设置 `"initialSceneId":"TitleScene"`，并把 scenes 写成 `{ "id":"TitleScene", "customModule":"TitleScene", "entities":[] }`（Level/GameOver 同理）；删除只有色块的 DSL `"main"` 占位。',
      );
    } else if (issue.includes('Scene 文件')) {
      hints.push(
        '3. 在 src/scenes/ 创建 TitleScene.ts、BattleScene.ts、ChapterScene.ts、EndingScene.ts 等，并在 main.ts 注册。',
      );
    } else if (issue.includes('缺少玩法信号')) {
      hints.push(
        '4. 街机 grid 可用 game.json skills[]；棋类必须 BoardTurnScene + @opengame/module-board，禁止空格加分壳。',
        `最小 skills 补丁（仅 grid/街机）：\n${MINIMAL_SKILLS_PATCH}`,
      );
    } else if (issue.includes('过于简单')) {
      hints.push('5. 增加第二个实体或实现完整 Scene 流程（对话→战斗→结局）。');
    } else if (issue.includes('至少需要一个实体')) {
      hints.push('6. 在 scenes[0].entities 保留实体，或实现 src/scenes/*Scene.ts。');
    } else if (issue.includes('胜负')) {
      hints.push('7. 在 BattleScene 中实现 HP 归零后 this.scene.start("GameOverScene") 或类似跳转。');
    }
  }
  hints.push('8. 可参考 @opengame/module-dialogue / module-combat 的 TurnManager、DialogueManager API。');
  return hints;
}

export function formatQualityFailureForPrompt(result: GameQualityResult): string {
  return [
    '【内容质量门禁 / Game QA】上一版构建通过但游戏内容不达标，请修复：',
    ...result.issues.map((i) => `- ${i}`),
    ...issueFixHints(result.issues),
  ].join('\n');
}

export async function buildQualityFixPrompt(options: {
  readonly baseUserPrompt: string;
  readonly issues: string[];
  readonly workspace: string;
  readonly repeatIssues?: boolean;
  /** Force Scene-focused repair when ChangePlan Boss/harder stuck. */
  readonly preferScenePatch?: boolean;
}): Promise<string> {
  const snippet = await readGameJsonSnippet(options.workspace);
  const sceneFix =
    options.preferScenePatch || issuesNeedSceneTsFix(options.issues);
  const jsonFix = issuesNeedJsonFix(options.issues) && !options.preferScenePatch;
  const focus = sceneFix && !jsonFix ? 'TypeScript Scene' : jsonFix && !sceneFix ? 'game.json' : 'Scene + game.json';
  const lines = [
    `【内容质量门禁 FIX — 优先修复 ${focus}】`,
    `用户原始需求（保留）：${options.baseUserPrompt.slice(0, 400)}`,
    '问题：',
    ...options.issues.map((i) => `- ${i}`),
    ...issueFixHints(options.issues),
  ];
  if (options.preferScenePatch) {
    lines.push(
      '',
      '【策略=scene-patch】同 issue 已重复 — 只改 Scene/main 落地 Boss 或难度，禁止空转 JSON。',
    );
  }
  if (sceneFix) {
    lines.push(
      '',
      '【Scene 修复】在 src/scenes/ 实现 GDD 中的 Scene，main.ts 注册 extraScenes；实现 scene.start 跳转与胜负。',
    );
  }
  if (jsonFix || !sceneFix) {
    lines.push('', '当前 public/game.json 片段：', '```json', snippet, '```');
  }
  if (options.repeatIssues) {
    if (sceneFix) {
      lines.push('', '【重要】issue 未变 — 请直接改 src/scenes/*.ts 与 main.ts，不要只动 JSON。');
    } else {
      lines.push(
        '',
        '【重要】issue 未变 — 请按上方补丁改 public/game.json。',
        `可直接合并的最小 skills：\n${MINIMAL_SKILLS_PATCH}`,
      );
    }
  }
  lines.push('', '要求：最少文件改动；不要 run_shell_command build。');
  const { formatJuiceRestoreHint } = await import('./juiceBaseline.js');
  const juiceHint = formatJuiceRestoreHint(options.issues);
  if (juiceHint) lines.push(juiceHint);
  return lines.join('\n');
}
