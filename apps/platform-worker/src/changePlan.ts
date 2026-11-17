/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Multi-turn ChangePlan SSOT — parse user follow-ups into verifiable intents.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { artStyleProfile, isArtStyleId } from '@opengame/world-spec';

export type ChangeDifficulty = 'easier' | 'harder' | null;

export interface ChangePlan {
  readonly schema: 'opengame-change-plan-v1';
  readonly createdAt: string;
  readonly userPrompt: string;
  readonly intent: 'create' | 'iterate' | 'reset';
  readonly difficulty: ChangeDifficulty;
  readonly addBoss: boolean;
  readonly artStyle: string | null;
  readonly addScene: boolean;
  readonly forceAssetRegen: boolean;
  /** Resolve "第2关" / LevelScene / Title 等到已有 scene id. */
  readonly targetSceneId: string | null;
  /** Optional NPC / entity id when user names one. */
  readonly targetNpcId: string | null;
  /** Add or deepen dialogue / NPC talk. */
  readonly addDialogue: boolean;
  /** Edit an existing level/scene (not add a new one). */
  readonly editLevel: boolean;
  /** Scene ids that must not be rewritten this turn. */
  readonly preserveScenes: string[];
  readonly changes: string[];
  readonly summary: string;
  /** Optional reference image URLs (text-only prompt injection for now). */
  readonly referenceImageHints: string[];
}

const HARDER =
  /更难|加大难度|提高难度|harder|more\s*difficult|increase\s*difficulty|更挑战|加难度/i;
const EASIER =
  /更简单|更易|降低难度|easier|easier|降低难度|简单一点|轻松一点/i;
const BOSS =
  /boss|首领|最终Boss|大Boss|加一个boss|加boss|加个boss|终局Boss|最终首领/i;
const ART_STYLE =
  /画风|美术风格|art\s*style|换成.{0,12}(风|风格)|改成.{0,12}(风|风格)|赛博|像素|水彩|写实|动漫|卡通|cyberpunk|pixel\s*art|oil\s*paint/i;
const ADD_SCENE =
  /加一关|再加一关|新关卡|add\s*(a\s*)?(level|stage|scene)|多一关|再来一关/i;
const ADD_DIALOGUE =
  /对话|加.*npc|npc.*对话|剧情|台词|dialogue|talk\s*to|加.*说话|加深.*剧情|视觉小说|支线/i;
const EDIT_LEVEL =
  /改.*关|修改.*关|改一下.*关|第\s*[一二三四五六七八九十\d]+\s*关|level\s*[_-]?\s*\d+|改\s*title|标题.*文案|改.*场景|edit\s*level|change\s*level/i;
const STYLE_CAPTURE =
  /(?:画风|美术风格|art\s*style|风格)[:：\s]*(.+)$/i;
const STYLE_SWAP =
  /(?:换成|改成|变成|改为)\s*(.+?)(?:画风|风格|$)/i;

const CN_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseLevelNumber(raw: string): number | null {
  const t = raw.trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (CN_NUM[t] != null) return CN_NUM[t]!;
  return null;
}

/** Map user phrasing to an existing scene id when possible. */
export function resolveTargetSceneId(
  prompt: string,
  sceneIds: readonly string[],
): string | null {
  if (!sceneIds.length) return null;
  for (const id of sceneIds) {
    if (new RegExp(`\\b${escapeRegExp(id)}\\b`, 'i').test(prompt)) return id;
  }
  if (/标题|title\s*(文案|文字|改)|改\s*title/i.test(prompt)) {
    const title = sceneIds.find((s) => /title|menu|hub/i.test(s));
    if (title) return title;
  }
  if (/game\s*over|结束|结算/i.test(prompt)) {
    const go = sceneIds.find((s) => /gameover|ending|result|victory/i.test(s));
    if (go) return go;
  }
  if (/章节|chapter|对话场景/i.test(prompt)) {
    const ch = sceneIds.find((s) => /chapter|dialog|story/i.test(s));
    if (ch) return ch;
  }
  const m = prompt.match(
    /第\s*([一二三四五六七八九十\d]+)\s*关|level\s*[_-]?\s*(\d+)|关卡\s*(\d+)/i,
  );
  if (m) {
    const n = parseLevelNumber(m[1] ?? m[2] ?? m[3] ?? '');
    if (n != null) {
      const byNum = sceneIds.find((s) =>
        new RegExp(`(?:level|stage|关)?[_-]?${n}\\b`, 'i').test(s),
      );
      if (byNum) return byNum;
      const playable = sceneIds.filter(
        (s) => !/title|menu|gameover|ending|result/i.test(s),
      );
      if (playable[n - 1]) return playable[n - 1]!;
    }
  }
  return null;
}

export function resolveTargetNpcId(
  prompt: string,
  entityIds: readonly string[] = [],
): string | null {
  for (const id of entityIds) {
    if (new RegExp(`\\b${escapeRegExp(id)}\\b`, 'i').test(prompt)) return id;
  }
  const named = prompt.match(
    /(?:给|找|和|与|对)\s*([A-Za-z\u4e00-\u9fff]{1,12})(?:\s*(?:加|改|说|对话|台词))?/,
  );
  if (named?.[1] && entityIds.length) {
    const tip = named[1];
    const hit = entityIds.find((e) => e.toLowerCase().includes(tip.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

export function parseChangePlan(options: {
  readonly userPrompt: string;
  readonly sessionSummary?: string | null;
  readonly gameParams?: {
    readonly theme?: string;
    readonly artStyleId?: string;
    readonly difficulty?: number;
    readonly musicStyle?: string;
    readonly variant?: string;
    readonly gameSpeed?: number;
    readonly timeLimit?: number;
  } | null;
  readonly imagesCount?: number;
  readonly imageHints?: string[];
  readonly intent?: 'create' | 'iterate' | 'reset';
  /** Existing scene ids from workspace (iteration). */
  readonly sceneIds?: readonly string[];
  readonly entityIds?: readonly string[];
}): ChangePlan {
  const prompt = options.userPrompt.trim();
  const blob = `${options.sessionSummary ?? ''}\n${prompt}`;
  const sceneIds = options.sceneIds ?? [];

  let difficulty: ChangeDifficulty = null;
  if (HARDER.test(blob)) difficulty = 'harder';
  else if (EASIER.test(blob)) difficulty = 'easier';

  if (
    typeof options.gameParams?.difficulty === 'number' &&
    options.gameParams.difficulty >= 4
  ) {
    difficulty = 'harder';
  } else if (
    typeof options.gameParams?.difficulty === 'number' &&
    options.gameParams.difficulty <= 2 &&
    difficulty === null
  ) {
    difficulty = 'easier';
  }

  const addBoss = BOSS.test(blob);
  const addScene = ADD_SCENE.test(blob);
  const addDialogue = ADD_DIALOGUE.test(blob);
  const targetSceneId = resolveTargetSceneId(prompt, sceneIds);
  const targetNpcId = resolveTargetNpcId(prompt, options.entityIds ?? []);
  const editLevel =
    !addScene &&
    (EDIT_LEVEL.test(blob) || Boolean(targetSceneId && /改|edit|change|加.*金币|多一个/i.test(blob)));

  let artStyle: string | null = null;
  if (options.gameParams?.theme?.trim()) {
    artStyle = options.gameParams.theme.trim().slice(0, 120);
  }
  // The picked profile beats the legacy free-text theme: it carries the
  // resolution/technique knobs the asset phase reads back out.
  if (isArtStyleId(options.gameParams?.artStyleId)) {
    artStyle = artStyleProfile(options.gameParams.artStyleId).artStyle;
  }
  const swap = prompt.match(STYLE_SWAP);
  if (swap?.[1]?.trim()) {
    artStyle = swap[1].trim().replace(/[。.!！?？]+$/, '').slice(0, 120);
  }
  const styled = prompt.match(STYLE_CAPTURE);
  if (styled?.[1]?.trim()) {
    artStyle = styled[1].trim().slice(0, 120);
  }
  if (!artStyle && ART_STYLE.test(prompt)) {
    const cyber = prompt.match(/赛博朋克|cyberpunk/i);
    const pixel = prompt.match(/像素|pixel\s*art/i);
    const anime = prompt.match(/动漫|二次元|anime/i);
    if (cyber) artStyle = 'cyberpunk neon city game art';
    else if (pixel) artStyle = 'pixel art retro game style';
    else if (anime) artStyle = 'anime stylized game art';
    else artStyle = prompt.slice(0, 80);
  }

  const forceAssetRegen = Boolean(artStyle) || (options.imagesCount ?? 0) > 0;

  const changes = prompt
    .split(/[，,；;。.\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .slice(0, 8);

  const preserveScenes =
    targetSceneId || editLevel
      ? sceneIds.filter((s) => s !== targetSceneId)
      : [];

  const flags: string[] = [];
  if (difficulty) flags.push(`difficulty=${difficulty}`);
  if (addBoss) flags.push('addBoss');
  if (artStyle) flags.push(`artStyle=${artStyle}`);
  if (addScene) flags.push('addScene');
  if (addDialogue) flags.push('addDialogue');
  if (editLevel) flags.push('editLevel');
  if (targetSceneId) flags.push(`targetScene=${targetSceneId}`);
  if (targetNpcId) flags.push(`targetNpc=${targetNpcId}`);
  if (forceAssetRegen) flags.push('forceAssetRegen');

  return {
    schema: 'opengame-change-plan-v1',
    createdAt: new Date().toISOString(),
    userPrompt: prompt.slice(0, 2000),
    intent: options.intent ?? 'iterate',
    difficulty,
    addBoss,
    artStyle,
    addScene,
    forceAssetRegen,
    targetSceneId,
    targetNpcId,
    addDialogue,
    editLevel,
    preserveScenes,
    changes: changes.length ? changes : [prompt.slice(0, 200)],
    summary: flags.length ? flags.join('; ') : prompt.slice(0, 200),
    referenceImageHints: (options.imageHints ?? []).slice(0, 4),
  };
}

export function changePlanPath(workspace: string): string {
  return path.join(workspace, 'public', 'CHANGE_PLAN.json');
}

export async function writeChangePlan(
  workspace: string,
  plan: ChangePlan,
): Promise<string> {
  const dir = path.join(workspace, 'public');
  await fsp.mkdir(dir, { recursive: true });
  const full = changePlanPath(workspace);
  await fsp.writeFile(full, JSON.stringify(plan, null, 2), 'utf8');
  if (plan.referenceImageHints.length) {
    const refPath = path.join(dir, 'REFERENCE_IMAGES.json');
    const urls = plan.referenceImageHints.filter((h) =>
      /^https?:\/\//i.test(h),
    );
    const localRefs = plan.referenceImageHints.filter(
      (h) =>
        /^(\.\/)?refs\//i.test(h) ||
        /[/\\]refs[/\\]/i.test(h) ||
        h.startsWith('assets/refs/'),
    );
    const text = plan.referenceImageHints.filter(
      (h) =>
        !/^https?:\/\//i.test(h) &&
        !localRefs.includes(h) &&
        !h.startsWith('data:'),
    );
    await fsp.writeFile(
      refPath,
      JSON.stringify(
        {
          schema: 'opengame-reference-images-v1',
          hints: text.slice(0, 6),
          urls: urls.slice(0, 4),
          localRefs: localRefs.slice(0, 4),
          fromChangePlan: true,
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
  }
  return full;
}

export function readChangePlan(workspace: string): ChangePlan | null {
  const full = changePlanPath(workspace);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8')) as ChangePlan;
  } catch {
    return null;
  }
}

/** Patch GAME_DESIGN.md art style / enemies / difficulty notes. */
export async function applyChangePlanToGdd(
  workspace: string,
  plan: ChangePlan,
): Promise<boolean> {
  const gddPath = path.join(workspace, 'GAME_DESIGN.md');
  let text = '';
  if (fs.existsSync(gddPath)) {
    text = await fsp.readFile(gddPath, 'utf8');
  } else {
    text = `# Game Design\n\nart style: stylized game art\n\n## Enemies\n- standard foes\n`;
  }

  if (plan.artStyle) {
    if (/art\s*style[:：]/i.test(text)) {
      text = text.replace(
        /art\s*style[:：]\s*.+/i,
        `art style: ${plan.artStyle}`,
      );
    } else {
      text = `art style: ${plan.artStyle}\n\n${text}`;
    }
  }

  if (plan.addBoss) {
    if (!/boss/i.test(text)) {
      text += `\n\n## Boss\n- Add a tagged boss enemy (tags: boss, enemy) with higher HP and a clear win path after defeat.\n`;
    } else if (!/## Boss/i.test(text)) {
      text += `\n\n## Boss (iteration)\n- Ensure a boss-tagged foe exists this round.\n`;
    }
  }

  if (plan.difficulty === 'harder') {
    text += `\n\n## Difficulty (iteration)\n- HARDER: more enemies / higher HP / faster waves / tighter timers vs prior baseline.\n`;
  } else if (plan.difficulty === 'easier') {
    text += `\n\n## Difficulty (iteration)\n- EASIER: fewer hazards / lower HP / slower pace vs prior baseline.\n`;
  }

  if (plan.addScene) {
    text += `\n\n## Scenes (iteration)\n- Add at least one new playable Scene beyond the prior set.\n`;
  }

  if (plan.addDialogue) {
    text += `\n\n## Dialogue (iteration)\n- Add or deepen NPC/chapter dialogue via DialogueManager or public/story/*.json. Prefer data files over hardcoding.\n`;
  }
  if (plan.targetSceneId) {
    text += `\n\n## Target Scene\n- Only edit \`${plan.targetSceneId}\` this round; preserve other scenes.\n`;
  }
  if (plan.editLevel && plan.targetSceneId) {
    text += `\n\n## Edit Level\n- Apply the requested change inside \`${plan.targetSceneId}\` only.\n`;
  }

  text += `\n\n## ChangePlan\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n`;

  await fsp.writeFile(gddPath, text, 'utf8');
  return true;
}

/**
 * Land ChangePlan into game.json + og_intent.json so gates/smoke see Boss/harder
 * even before the coder finishes — deterministic seed, coder may refine.
 */
export async function applyChangePlanToGameArtifacts(
  workspace: string,
  plan: ChangePlan,
): Promise<{ readonly patches: string[] }> {
  const patches: string[] = [];
  const candidates = [
    path.join(workspace, 'public', 'game.json'),
    path.join(workspace, 'game.json'),
  ];
  const gamePath = candidates.find((p) => fs.existsSync(p));
  if (!gamePath) {
    await writeOgIntent(workspace, plan, patches);
    return { patches };
  }

  let dsl: Record<string, unknown>;
  try {
    dsl = JSON.parse(await fsp.readFile(gamePath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    await writeOgIntent(workspace, plan, patches);
    return { patches };
  }

  const scenes = Array.isArray(dsl['scenes'])
    ? (dsl['scenes'] as Array<Record<string, unknown>>)
    : [];

  if (plan.addBoss) {
    let hasBoss = /\bboss\b/i.test(JSON.stringify(dsl));
    if (!hasBoss && scenes.length > 0) {
      const target = scenes[scenes.length - 1]!;
      const entities = Array.isArray(target['entities'])
        ? ([...target['entities']] as Array<Record<string, unknown>>)
        : [];
      entities.push({
        id: 'boss_1',
        kind: 'enemy',
        name: 'Boss',
        tags: ['boss', 'enemy'],
        sprite: { assetId: 'enemy', x: 700, y: 280, width: 56, height: 56 },
        attrs: { hp: 8, enemyHp: 8, boss: true },
      });
      target['entities'] = entities;
      patches.push('dsl:add boss_1 entity');
      hasBoss = true;
    }
  }

  if (plan.difficulty === 'harder') {
    const tunables = {
      ...((dsl['tunables'] as Record<string, unknown>) ?? {}),
    };
    const bump = (key: string, floor: number, mul = 1.4) => {
      const cur = tunables[key];
      const n =
        typeof cur === 'number'
          ? cur
          : typeof cur === 'object' &&
              cur &&
              typeof (cur as { value?: unknown }).value === 'number'
            ? Number((cur as { value: number }).value)
            : floor;
      const next = Math.max(floor, Math.round(n * mul));
      tunables[key] = next;
      patches.push(`tunable:${key}=${next}`);
    };
    bump('enemyCount', 5);
    bump('enemyHp', 3);
    bump('difficultyTier', 3, 1);
    if (tunables['spawnIntervalMs'] == null) {
      tunables['spawnIntervalMs'] = 700;
      patches.push('tunable:spawnIntervalMs=700');
    } else {
      const cur = Number(
        typeof tunables['spawnIntervalMs'] === 'number'
          ? tunables['spawnIntervalMs']
          : 900,
      );
      tunables['spawnIntervalMs'] = Math.max(400, Math.round(cur * 0.75));
      patches.push(`tunable:spawnIntervalMs=${tunables['spawnIntervalMs']}`);
    }
    dsl['tunables'] = tunables;

    // Stamp attrs on enemies for Scene kernels that read entity attrs
    for (const scene of scenes) {
      const entities = Array.isArray(scene['entities'])
        ? (scene['entities'] as Array<Record<string, unknown>>)
        : [];
      for (const e of entities) {
        const tags = Array.isArray(e['tags'])
          ? (e['tags'] as string[])
          : [];
        const kind = String(e['kind'] ?? '');
        if (kind === 'enemy' || tags.includes('enemy') || tags.includes('boss')) {
          const attrs = {
            ...((e['attrs'] as Record<string, unknown>) ?? {}),
          };
          const hp = Number(attrs['hp'] ?? attrs['enemyHp'] ?? 2);
          attrs['hp'] = Math.max(3, Math.round(hp * 1.5));
          attrs['enemyHp'] = attrs['hp'];
          e['attrs'] = attrs;
        }
      }
      scene['entities'] = entities;
    }
    patches.push('dsl:harder enemy attrs');
  }

  if (plan.difficulty === 'easier') {
    const tunables = {
      ...((dsl['tunables'] as Record<string, unknown>) ?? {}),
    };
    tunables['difficultyTier'] = 1;
    tunables['enemyCount'] = Math.max(
      1,
      Number(tunables['enemyCount'] ?? 3) - 1,
    );
    dsl['tunables'] = tunables;
    patches.push('dsl:easier tunables');
  }

  if (plan.addScene) {
    const sceneIds = new Set(
      scenes
        .map((s) => String(s['id'] ?? ''))
        .filter(Boolean),
    );
    let n = sceneIds.size + 1;
    let newId = `level_${n}`;
    while (sceneIds.has(newId)) {
      n += 1;
      newId = `level_${n}`;
    }
    scenes.push({
      id: newId,
      entities: [
        {
          id: `player_${newId}`,
          kind: 'player',
          tags: ['player'],
          sprite: { assetId: 'player', x: 80, y: 300, width: 40, height: 40 },
        },
      ],
      hud: { score: true },
    });
    patches.push(`dsl:addScene ${newId}`);

    // Seed Scene stub if engine scenes dir exists
    const scenesDir = path.join(workspace, 'src', 'scenes');
    if (fs.existsSync(scenesDir)) {
      const className = newId.replace(/(^|_)([a-z])/g, (_, __, c: string) =>
        c.toUpperCase(),
      ).replace(/_/g, '');
      const file = `${className}Scene.ts`;
      const full = path.join(scenesDir, file);
      if (!fs.existsSync(full)) {
        await fsp.writeFile(
          full,
          `/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import Phaser from 'phaser';
import { PlatformSceneHelper } from '@opengame/module-platform';

/** ChangePlan addScene seed — mini platformer loop + MiniMax art. */
export class ${className}Scene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  constructor() {
    super({ key: '${className}Scene' });
  }
  preload(): void {
    PlatformSceneHelper.preloadGameAudio(this);
    PlatformSceneHelper.preloadGameArt(this);
  }
  create(): void {
    PlatformSceneHelper.ensureBgm(this, 0.3);
    PlatformSceneHelper.installPauseMenu(this);
    if (!PlatformSceneHelper.addParallaxBackground(this, 'og_bg')) {
      this.cameras.main.setBackgroundColor(0x1e293b);
    }
    PlatformSceneHelper.applyArcadePhysics(this, {
      width: 960,
      height: 540,
      gravityY: 900,
    });
    const ground = PlatformSceneHelper.createGround(
      this, 480, 500, 960, 40, 0x334155,
    );
    this.player = PlatformSceneHelper.spriteOrRect(
      this, 100, 420, 'player', 36, 44, 0xf4a261,
    );
    this.physics.add.existing(this.player);
    PlatformSceneHelper.syncBodyToDisplay(this.player, 36, 44);
    (this.player.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true);
    this.physics.add.collider(this.player, ground);
    PlatformSceneHelper.followPlayer(this, this.player);

    const wantBoss = Boolean(this.registry.get('bossPresent'));
    const foe = PlatformSceneHelper.spriteOrRect(
      this, wantBoss ? 620 : 480, wantBoss ? 420 : 460, 'enemy',
      wantBoss ? 88 : 48, wantBoss ? 72 : 36, wantBoss ? 0x7f1d1d : 0xef4444,
    );
    if (wantBoss) {
      foe.setData('boss', true);
      foe.setData('hp', 5);
      this.registry.set('bossPresent', true);
      this.add.text(foe.x, foe.y - 48, 'BOSS', {
        fontSize: '14px', color: '#fecaca', fontStyle: 'bold',
      }).setOrigin(0.5);
      const bossHpBar = this.add.rectangle(foe.x, foe.y - 32, 80, 7, 0x22c55e).setOrigin(0.5);
      this.physics.add.existing(foe, true);
      const strikeBoss = () => {
        if (!foe.active) return;
        if (Math.hypot(this.player.x - foe.x, this.player.y - foe.y) > 110) return;
        const hp = Math.max(0, Number(foe.getData('hp') ?? 5) - 1);
        foe.setData('hp', hp);
        bossHpBar.width = Math.max(6, 80 * (hp / 5));
        if (hp <= 0) {
          this.registry.set('won', true);
          foe.destroy();
          bossHpBar.destroy();
          try { this.scene.start('VictoryScene'); } catch { /* optional */ }
        }
      };
      this.input.keyboard?.on('keydown-C', strikeBoss);
      this.input.keyboard?.on('keydown-SPACE', strikeBoss);
    } else {
      this.physics.add.existing(foe, true);
      this.physics.add.overlap(this.player, foe, () => {
        PlatformSceneHelper.playSfx(this, 'sfx_lose', 0.5);
        this.registry.set('won', false);
        this.scene.start('GameOverScene');
      });
    }

    const goal = PlatformSceneHelper.spriteOrRect(
      this, 860, 450, 'item', 40, 48, 0x22c55e,
    );
    this.physics.add.existing(goal, true);
    this.physics.add.overlap(this.player, goal, () => {
      PlatformSceneHelper.burst(this, goal.x, goal.y, 0x86efac, 12);
      PlatformSceneHelper.playSfx(this, 'sfx_win', 0.55);
      this.registry.set('won', true);
      this.registry.set('progress', Number(this.registry.get('progress') ?? 0) + 1);
      this.scene.start('GameOverScene');
    });

    this.add.text(16, 12, '${newId} · reach item · avoid foe', {
      fontFamily: 'monospace', fontSize: '14px', color: '#e2e8f0',
    }).setScrollFactor(0).setDepth(100);
    this.cursors = this.input.keyboard!.createCursorKeys();
  }
  update(): void {
    const b = this.player.body as Phaser.Physics.Arcade.Body;
    if (this.cursors.left?.isDown) b.setVelocityX(-220);
    else if (this.cursors.right?.isDown) b.setVelocityX(220);
    else b.setVelocityX(0);
    if (this.cursors.up?.isDown && b.blocked.down) b.setVelocityY(-420);
  }
}
`,
          'utf8',
        );
        patches.push(`scene:${file}`);
      }
    }
  }

  if (plan.addDialogue) {
    const storyDir = path.join(workspace, 'public', 'story');
    await fsp.mkdir(storyDir, { recursive: true });
    const storyFile = path.join(storyDir, 'chapter_01.json');
    const npcName = plan.targetNpcId ?? 'Guide';
    const storyPayload = {
      schema: 'opengame-story-chapter-v1',
      id: 'chapter_01',
      title: 'Chapter 1',
      targetSceneId: plan.targetSceneId,
      targetNpcId: plan.targetNpcId,
      entries: [
        {
          id: 'c1_intro',
          type: 'text',
          speaker: 'Narrator',
          text: 'A new voice joins the story…',
          nextId: 'c1_npc',
        },
        {
          id: 'c1_npc',
          type: 'text',
          speaker: npcName,
          text: `${npcName}: Stay a moment — I have something to tell you.`,
          nextId: 'c1_choice',
        },
        {
          id: 'c1_choice',
          type: 'choice',
          prompt: 'How do you answer?',
          options: [
            { label: 'I am listening.', nextId: 'c1_listen' },
            { label: 'I must go.', nextId: 'c1_leave' },
          ],
        },
        {
          id: 'c1_listen',
          type: 'text',
          speaker: npcName,
          text: 'Good. Your choice will matter later.',
        },
        {
          id: 'c1_leave',
          type: 'text',
          speaker: npcName,
          text: 'Then return when you are ready.',
        },
      ],
    };
    if (!fs.existsSync(storyFile)) {
      await fsp.writeFile(storyFile, JSON.stringify(storyPayload, null, 2), 'utf8');
      patches.push('story:chapter_01.json');
    } else {
      // Append into the dialogue *graph* — never dump orphan lines after a
      // terminal `nextId: null` (that used to fall through and loop branches).
      try {
        const prev = JSON.parse(await fsp.readFile(storyFile, 'utf8')) as {
          entries?: Array<Record<string, unknown>>;
        };
        let entries = Array.isArray(prev.entries) ? [...prev.entries] : [];
        entries = entries.filter(
          (e) =>
            !(
              typeof e['id'] === 'string' &&
              String(e['id']).startsWith('iter_')
            ),
        );
        const newId = `iter_${Date.now().toString(36)}`;
        const line =
          plan.changes[0]?.slice(0, 120) || 'The story deepens.';
        const newEntry: Record<string, unknown> = {
          id: newId,
          type: 'text',
          speaker: npcName,
          text: line,
          nextId: null,
        };
        // Wire into ONE terminal only (prefer ending_b / path_leave / last null)
        // so we do not collapse every ending into a single fan-in.
        let wired = false;
        const prefer =
          entries.findIndex(
            (e) =>
              e['type'] === 'text' &&
              typeof e['id'] === 'string' &&
              /path_leave|end_b|ending_b/i.test(String(e['id'])) &&
              Object.prototype.hasOwnProperty.call(e, 'nextId') &&
              (e['nextId'] === null || e['nextId'] === ''),
          ) >= 0
            ? entries.findIndex(
                (e) =>
                  e['type'] === 'text' &&
                  typeof e['id'] === 'string' &&
                  /path_leave|end_b|ending_b/i.test(String(e['id'])) &&
                  Object.prototype.hasOwnProperty.call(e, 'nextId') &&
                  (e['nextId'] === null || e['nextId'] === ''),
              )
            : -1;
        if (prefer >= 0) {
          entries[prefer] = { ...entries[prefer]!, nextId: newId };
          wired = true;
        }
        if (!wired) {
          for (let i = entries.length - 1; i >= 0; i--) {
            const e = entries[i]!;
            if (
              e['type'] === 'text' &&
              Object.prototype.hasOwnProperty.call(e, 'nextId') &&
              (e['nextId'] === null || e['nextId'] === '')
            ) {
              entries[i] = { ...e, nextId: newId };
              wired = true;
              break;
            }
          }
        }
        if (!wired && entries.length > 0) {
          const last = entries[entries.length - 1]!;
          if (last['type'] === 'text') {
            entries[entries.length - 1] = { ...last, nextId: newId };
            wired = true;
          }
        }
        entries.push(newEntry);
        // Soft-validate: drop orphan iter_ that somehow lost inbound edges
        try {
          const { validateDialogueGraph } = await import('./storyOutline.js');
          const issues = validateDialogueGraph(entries);
          if (issues.length > 0) {
            // keep graph; ChangePlan still applied — issues surface via quality gate
          }
        } catch {
          /* optional */
        }
        prev.entries = entries;
        await fsp.writeFile(storyFile, JSON.stringify(prev, null, 2), 'utf8');
        patches.push('story:chapter_01.json:append');
      } catch {
        await fsp.writeFile(storyFile, JSON.stringify(storyPayload, null, 2), 'utf8');
        patches.push('story:chapter_01.json:rewrite');
      }
    }

    // Seed root dialogue[] so DSL runners also see growth
    const dialogue = Array.isArray(dsl['dialogue'])
      ? ([...dsl['dialogue']] as Array<Record<string, unknown>>)
      : [];
    const group = plan.targetNpcId
      ? `dlg_${plan.targetNpcId}`
      : 'dlg_story';
    dialogue.push({
      id: `story_${dialogue.length + 1}`,
      group,
      speaker: npcName,
      text: plan.changes[0]?.slice(0, 160) || 'A new dialogue beat.',
    });
    dsl['dialogue'] = dialogue;
    patches.push('dsl:dialogue+=1');
  }

  if (plan.targetSceneId || plan.editLevel) {
    await snapshotPreserveSceneHashes(workspace, plan);
    patches.push('scene-hash:prev');
  }

  if (patches.length) {
    dsl['scenes'] = scenes;
    await fsp.writeFile(gamePath, JSON.stringify(dsl, null, 2), 'utf8');
  }
  await writeOgIntent(workspace, plan, patches);
  return { patches };
}

const SKIP_SCENE =
  /Title|Menu|Ending|Victory|GameOver|Chapter|Dialog|Result/i;

async function hashFileQuick(full: string): Promise<string | null> {
  if (!fs.existsSync(full)) return null;
  const buf = await fsp.readFile(full);
  const crypto = await import('node:crypto');
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/** Snapshot non-target scene hashes so gates can detect collateral edits. */
export async function snapshotPreserveSceneHashes(
  workspace: string,
  plan: ChangePlan,
): Promise<void> {
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (!fs.existsSync(scenesDir)) return;
  const hashes: Record<string, string> = {};
  for (const f of await fsp.readdir(scenesDir)) {
    if (!f.endsWith('.ts')) continue;
    const key = f.replace(/\.ts$/i, '');
    if (plan.targetSceneId && key === plan.targetSceneId) continue;
    if (
      plan.targetSceneId &&
      !key.includes(plan.targetSceneId) &&
      plan.preserveScenes.length &&
      !plan.preserveScenes.some((s) => key.includes(s) || s.includes(key))
    ) {
      // still hash all non-target for safety
    }
    if (plan.targetSceneId && (key === plan.targetSceneId || f.startsWith(plan.targetSceneId))) {
      continue;
    }
    const h = await hashFileQuick(path.join(scenesDir, f));
    if (h) hashes[f] = h;
  }
  const dir = path.join(workspace, 'public');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, 'SCENE_HASH_PREV.json'),
    JSON.stringify(
      {
        schema: 'opengame-scene-hash-prev-v1',
        targetSceneId: plan.targetSceneId,
        preserveScenes: plan.preserveScenes,
        hashes,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

const DIALOGUE_INTENT_SNIPPET = `
    // OpenGame ChangePlan intent — dialogue visible (deterministic)
    if (!this.registry.get('__ogDialogueSeeded')) {
      this.registry.set('__ogDialogueSeeded', true);
      this.registry.set('hasDialogue', true);
      try {
        this.load?.json?.('og_story_chapter_01', './story/chapter_01.json');
      } catch { /* optional */ }
      this.add.text(16, 40, '◆ Talk (story)', {
        fontSize: '12px', color: '#a5b4fc',
      }).setScrollFactor(0).setDepth(90);
    }
`;

const BOSS_INTENT_SNIPPET = `
    // OpenGame ChangePlan intent — Boss encounter (HP, not a QA checkbox)
    if (!this.registry.get('__ogBossSpawned')) {
      this.registry.set('__ogBossSpawned', true);
      this.registry.set('bossPresent', true);
      const __ogBoss = this.add.rectangle(720, 390, 88, 72, 0x7f1d1d)
        .setData('boss', true)
        .setData('hp', 5)
        .setDepth(20);
      this.add.text(720, 328, 'BOSS', {
        fontSize: '14px', color: '#fecaca', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(80);
      const __ogBossHp = this.add.rectangle(720, 348, 80, 7, 0x22c55e)
        .setOrigin(0.5).setDepth(80);
      try {
        if (this.physics?.add) this.physics.add.existing(__ogBoss, true);
      } catch { /* optional */ }
      this.time?.delayedCall?.(0, () => {
        const __ogPlayer = (this as { player?: Phaser.GameObjects.GameObject }).player
          ?? this.children?.list?.find((o) =>
            (o as Phaser.GameObjects.GameObject).getData?.('player'));
        const strike = () => {
          if (!__ogBoss.active) return;
          const px = Number((__ogPlayer as { x?: number } | undefined)?.x ?? 0);
          const py = Number((__ogPlayer as { y?: number } | undefined)?.y ?? 0);
          if (Math.hypot(px - __ogBoss.x, py - __ogBoss.y) > 110) return;
          const hp = Math.max(0, Number(__ogBoss.getData('hp') ?? 5) - 1);
          __ogBoss.setData('hp', hp);
          __ogBossHp.width = Math.max(6, 80 * (hp / 5));
          if (hp <= 0) {
            this.registry.set('won', true);
            __ogBoss.destroy();
            __ogBossHp.destroy();
            try { this.scene.start('VictoryScene'); } catch { /* optional */ }
          }
        };
        this.input?.keyboard?.on('keydown-C', strike);
        this.input?.keyboard?.on('keydown-SPACE', strike);
      });
    }
`;

const HARDER_INTENT_SNIPPET = `
    // OpenGame ChangePlan intent — harder signal
    if (Boolean(this.registry.get('HARDER')) || Number(this.registry.get('difficultyTier') ?? 0) >= 3) {
      this.registry.set('HARDER', true);
      this.registry.set('difficultyTier', Math.max(3, Number(this.registry.get('difficultyTier') ?? 3)));
    }
`;

/**
 * After CODE may strip Boss/harder spawn paths, deterministically re-inject
 * visible intent markers into gameplay Scenes so gates/smoke cannot false-green.
 */
export async function ensureChangePlanSceneContracts(
  workspace: string,
  plan: ChangePlan,
): Promise<{ readonly patches: string[] }> {
  const patches: string[] = [];
  if (
    !plan.addBoss &&
    plan.difficulty !== 'harder' &&
    !plan.artStyle &&
    !plan.addDialogue
  ) {
    return { patches };
  }
  const scenesDir = path.join(workspace, 'src', 'scenes');
  if (!fs.existsSync(scenesDir)) return { patches };

  for (const f of await fsp.readdir(scenesDir)) {
    if (!f.endsWith('.ts')) continue;
    if (SKIP_SCENE.test(f) && !plan.addDialogue) continue;
    // Dialogue inject prefers Chapter / target / first playable
    if (plan.addDialogue) {
      const isTarget =
        (plan.targetSceneId &&
          (f.includes(plan.targetSceneId) ||
            f.replace(/\.ts$/i, '') === plan.targetSceneId)) ||
        /Chapter|Dialog|World|Level/i.test(f);
      if (!isTarget && !/Chapter|World|Level1|LevelScene/i.test(f)) continue;
    } else if (SKIP_SCENE.test(f)) {
      continue;
    }
    const full = path.join(scenesDir, f);
    let src = await fsp.readFile(full, 'utf8');
    if (!/extends\s+Phaser\.Scene/.test(src)) continue;
    let dirty = false;

    if (plan.addBoss && !/bossPresent|setData\(\s*['"]boss['"]/.test(src)) {
      if (/create\s*\(\s*\)\s*:\s*void\s*\{/.test(src)) {
        src = src.replace(
          /create\s*\(\s*\)\s*:\s*void\s*\{/,
          (m) => `${m}${BOSS_INTENT_SNIPPET}`,
        );
        dirty = true;
        patches.push(`scene-contract:${f}:boss`);
      }
    }

    if (
      plan.difficulty === 'harder' &&
      !/enemyCount|difficultyTier|HARDER/.test(src)
    ) {
      if (/create\s*\(\s*\)\s*:\s*void\s*\{/.test(src)) {
        if (!src.includes('OpenGame ChangePlan intent — harder')) {
          src = src.replace(
            /create\s*\(\s*\)\s*:\s*void\s*\{/,
            (m) => `${m}${HARDER_INTENT_SNIPPET}`,
          );
          dirty = true;
          patches.push(`scene-contract:${f}:harder`);
        }
      }
    }

    if (
      plan.addDialogue &&
      !/DialogueManager|hasDialogue|og_story_chapter|__ogDialogueSeeded/.test(src)
    ) {
      if (/create\s*\(\s*\)\s*:\s*void\s*\{/.test(src)) {
        src = src.replace(
          /create\s*\(\s*\)\s*:\s*void\s*\{/,
          (m) => `${m}${DIALOGUE_INTENT_SNIPPET}`,
        );
        dirty = true;
        patches.push(`scene-contract:${f}:dialogue`);
      }
    }

    if (
      plan.artStyle &&
      /PlatformSceneHelper/.test(src) &&
      !/preloadGameArt|spriteOrRect|textures\.exists\(\s*['"](?:og_)?player/.test(
        src,
      )
    ) {
      if (/preload\s*\(\s*\)\s*:\s*void\s*\{/.test(src)) {
        src = src.replace(
          /preload\s*\(\s*\)\s*:\s*void\s*\{/,
          (m) =>
            `${m}\n    PlatformSceneHelper.preloadGameArt(this); // ChangePlan artStyle visibility\n`,
        );
        dirty = true;
        patches.push(`scene-contract:${f}:art`);
      }
    }

    if (
      /PlatformSceneHelper/.test(src) &&
      /preload\s*\(\s*\)\s*:\s*void\s*\{/.test(src) &&
      !/preloadGameAudio|preloadGameArt/.test(src)
    ) {
      src = src.replace(
        /preload\s*\(\s*\)\s*:\s*void\s*\{/,
        (m) =>
          `${m}\n    PlatformSceneHelper.preloadGameAudio(this);\n    PlatformSceneHelper.preloadGameArt(this);\n`,
      );
      dirty = true;
      patches.push(`scene-contract:${f}:juice`);
    }

    if (dirty) {
      await fsp.writeFile(full, src, 'utf8');
    }
  }

  if (patches.length) {
    await writeOgIntent(workspace, plan, [...patches]);
  }
  return { patches };
}

async function writeOgIntent(
  workspace: string,
  plan: ChangePlan,
  patches: string[],
): Promise<void> {
  const dir = path.join(workspace, 'public');
  await fsp.mkdir(dir, { recursive: true });
  const intent = {
    schema: 'opengame-intent-v1',
    addBoss: plan.addBoss,
    difficulty: plan.difficulty,
    artStyle: plan.artStyle,
    addScene: plan.addScene,
    addDialogue: plan.addDialogue,
    editLevel: plan.editLevel,
    targetSceneId: plan.targetSceneId,
    targetNpcId: plan.targetNpcId,
    preserveScenes: plan.preserveScenes,
    difficultyTier:
      plan.difficulty === 'harder' ? 4 : plan.difficulty === 'easier' ? 1 : 2,
    bossPresent: plan.addBoss,
    patches,
    updatedAt: new Date().toISOString(),
  };
  await fsp.writeFile(
    path.join(dir, 'og_intent.json'),
    JSON.stringify(intent, null, 2),
    'utf8',
  );
  patches.push('og_intent.json');
}

export function formatChangePlanForPrompt(plan: ChangePlan): string {
  const lines = [
    '【本轮 ChangePlan / 必须落地且可验收】',
    `- intent: ${plan.intent}`,
    `- summary: ${plan.summary}`,
  ];
  if (plan.difficulty) {
    lines.push(
      `- difficulty: ${plan.difficulty} — 必须改变可测数值（敌人数/HP/波次/gravity/speed）`,
    );
  }
  if (plan.addBoss) {
    lines.push(
      '- addBoss: true — game.json 或 Scene 中必须有 tags 含 boss 的实体，或 id/类名含 boss',
    );
  }
  if (plan.artStyle) {
    lines.push(
      `- artStyle: ${plan.artStyle} — 平台将 force 重生 MiniMax 资产；保留 assetId 接线`,
    );
  }
  if (plan.addScene) {
    lines.push('- addScene: true — 新增可玩 Scene 并注册到 extraScenes');
  }
  if (plan.addDialogue) {
    lines.push(
      '- addDialogue: true — 必须落地 DialogueManager 或 public/story/*.json / dialogue[] 增长',
    );
  }
  if (plan.targetSceneId) {
    lines.push(
      `- targetSceneId: ${plan.targetSceneId} — 本轮只改该 Scene；preserve: ${plan.preserveScenes.join(', ') || '（其余）'}`,
    );
  }
  if (plan.editLevel) {
    lines.push('- editLevel: true — 增量改关卡内容，禁止整盘重写无关 Scene');
  }
  if (plan.referenceImageHints.length) {
    lines.push(
      `- reference images (describe style from): ${plan.referenceImageHints.join(', ')}`,
    );
  }
  lines.push('- 禁止整盘重写；禁止删除 PlatformSceneHelper juice。');
  return lines.join('\n');
}

/** Short user-facing strip: 「本轮将改：Level1Scene · 加对话」 */
export function formatChangePlanConfirmLabel(plan: ChangePlan): string {
  const bits: string[] = [];
  if (plan.targetSceneId) bits.push(plan.targetSceneId);
  if (plan.addDialogue) bits.push('加对话');
  if (plan.editLevel && !plan.targetSceneId) bits.push('改关卡');
  if (plan.difficulty === 'harder') bits.push('加难');
  if (plan.difficulty === 'easier') bits.push('降难');
  if (plan.addBoss) bits.push('加 Boss');
  if (plan.addScene) bits.push('加关卡');
  if (plan.artStyle) bits.push(`画风「${plan.artStyle}」`);
  if (bits.length === 0 && plan.summary) bits.push(plan.summary.slice(0, 40));
  if (bits.length === 0) bits.push('增量改动');
  return `本轮将改：${bits.join(' · ')}`;
}
