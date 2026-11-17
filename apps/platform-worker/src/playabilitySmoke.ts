/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { readMechanicSpec, type MechanicSpec } from './mechanicSpec.js';

/** Pick smoke probes from MechanicSpec.time/input — not one SPACE-for-all. */
export function smokeProbePlan(
  mechanic: MechanicSpec | null,
  workspace?: string,
): {
  readonly mode: 'cell-select' | 'place' | 'choice' | 'keys';
  readonly rejectSpaceShell: boolean;
  readonly denseBoard: boolean;
} {
  const mixedBoard =
    mechanic?.space === 'top_down' &&
    Boolean(mechanic.boardKind) &&
    mechanic.arcadeVariant !== 'board_turn';
  if (mixedBoard) {
    return { mode: 'keys', rejectSpaceShell: true, denseBoard: false };
  }
  const input = mechanic?.input;
  const time = mechanic?.time;
  if (mechanic?.arcadeVariant === 'match3' || mechanic?.modules.includes('match')) {
    return { mode: 'cell-select', rejectSpaceShell: true, denseBoard: false };
  }
  if (input === 'cell-select' || time === 'turn' || mechanic?.boardKind) {
    return { mode: 'cell-select', rejectSpaceShell: true, denseBoard: true };
  }
  if (input === 'place' || time === 'wave') {
    return { mode: 'place', rejectSpaceShell: false, denseBoard: false };
  }
  if (input === 'choice' || input === 'pointer') {
    return { mode: input === 'choice' ? 'choice' : 'cell-select', rejectSpaceShell: false, denseBoard: false };
  }
  const boardOnDisk =
    workspace &&
    fs.existsSync(path.join(workspace, 'public', 'BOARD_KERNEL.json'));
  if (boardOnDisk) {
    return { mode: 'cell-select', rejectSpaceShell: true, denseBoard: true };
  }
  return { mode: 'keys', rejectSpaceShell: false, denseBoard: false };
}

export interface PlayabilitySmokeResult {
  readonly ok: boolean;
  readonly issues: string[];
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  /** Optional play-progress probe from window.__ogPlayProbe */
  readonly progress?: {
    readonly score: number;
    readonly won: boolean;
    readonly winHandled: boolean;
    readonly sceneKey: string | null;
    readonly sceneChanged: boolean;
    readonly moved: boolean;
    readonly poseMoved?: boolean;
    readonly inputFrames?: number;
    readonly pointerFrames?: number;
    readonly gameplaySignal?: boolean;
    readonly bossPresent?: boolean;
    readonly difficultyTier?: number | null;
    readonly enemyCount?: number;
    readonly talkedCount?: number;
    readonly inventory?: string | null;
    readonly endingA?: boolean;
    readonly endingB?: boolean;
    readonly chapterIndex?: number;
    readonly narrativeSignal?: boolean;
  };
  /**
   * Whether a touch-only pass got anywhere. `undefined` means the gate did not
   * run (opted out, or the keyboard pass had already failed).
   */
  readonly touchPlayable?: boolean;
  /** PNG base64 (no data: prefix) for Vision QA VLM path. */
  readonly screenshotBase64?: string;
}

function collectChangePlanSmokeIssues(workspace: string): string[] {
  const planPath = path.join(workspace, 'public', 'CHANGE_PLAN.json');
  if (!fs.existsSync(planPath)) return [];
  const issues: string[] = [];
  try {
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as {
      addBoss?: boolean;
      difficulty?: string | null;
    };
    let blob = '';
    const scenesDir = path.join(workspace, 'src', 'scenes');
    if (fs.existsSync(scenesDir)) {
      for (const f of fs.readdirSync(scenesDir)) {
        if (!f.endsWith('.ts')) continue;
        blob += fs.readFileSync(path.join(scenesDir, f), 'utf8');
      }
    }
    const gameJson = path.join(workspace, 'public', 'game.json');
    if (fs.existsSync(gameJson)) {
      blob += fs.readFileSync(gameJson, 'utf8');
    }
    if (plan.addBoss && !/\bboss\b/i.test(blob)) {
      issues.push(
        'ChangePlan 冒烟探针: addBoss 但 Scene/game.json 未见 boss — 请落地 Boss 实体或 Boss 场景',
      );
    }
    if (
      plan.addBoss &&
      !/bossPresent|setData\(\s*['"]boss['"]/i.test(blob)
    ) {
      issues.push(
        'ChangePlan 冒烟探针: addBoss 但 Scene 未见 bossPresent/setData(boss) 生成路径 — 玩法不可见',
      );
    }
    if (
      blob.includes('PlatformSceneHelper') &&
      !/spriteOrRect|preloadGameArt|textures\.exists\(\s*['"](?:og_)?player['"]/i.test(
        blob,
      )
    ) {
      issues.push(
        'ChangePlan 冒烟探针: Scene 使用 PlatformSceneHelper 但未见 spriteOrRect/preloadGameArt — 画风可能不可见',
      );
    }
    if (plan.difficulty === 'harder') {
      const harderSignal =
        /enemyCount\s*[:=]\s*[5-9]|enemyHp\s*[:=]\s*[3-9]|gravityY:\s*1[0-9]{2,}|spawnIntervalMs:\s*[1-6]\d{2}|HARDER|difficultyTier\s*[:=]\s*[3-9]|difficulty.*hard/i.test(
          blob,
        );
      if (!harderSignal) {
        issues.push(
          'ChangePlan 冒烟探针: harder 未见可测信号（敌人数/HP/间隔/difficultyTier）',
        );
      }
    }
  } catch {
    // ignore malformed plan
  }
  return issues;
}

const IGNORED_CONSOLE_PATTERNS = [
  /WebGL: INVALID_VALUE: texImage2D/i,
  /skip image asset.*SVG/i,
  /\[opengame\/runtime\]/i,
];

/** Optional fetches that 404 without breaking playability (bootstrap probes these). */
const OPTIONAL_404_PATH_RE =
  /(?:^|\/)(?:favicon\.ico|favicon\.png|apple-touch-icon[^/]*|og_intent\.json|CHANGE_PLAN\.json)(?:\?|$)/i;

function shouldIgnoreConsoleLine(line: string): boolean {
  return IGNORED_CONSOLE_PATTERNS.some((re) => re.test(line));
}

function isOptionalMissingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return OPTIONAL_404_PATH_RE.test(u.pathname);
  } catch {
    return OPTIONAL_404_PATH_RE.test(url);
  }
}

function isGenericResource404Console(line: string): boolean {
  return /Failed to load resource:.*status of 404/i.test(line);
}

export interface NoKeyboardProbeResult {
  /** False when the touch pass produced no gameplay signal at all. */
  readonly playable: boolean;
  /** False when the runtime never installed the on-screen controls. */
  readonly controlsPresent: boolean;
}

/**
 * Can this build be finished with no keyboard?
 *
 * A generated game that only reads WASD looks fine in the studio and is dead
 * on a phone — which is where most of its players will open it. So we run a
 * second pass in a touch-emulated context and drive it exclusively through the
 * runtime's on-screen controls and canvas taps. Nothing here touches
 * `page.keyboard`; that is the entire point of the check.
 */
async function runNoKeyboardProbe(
  browser: import('playwright').Browser,
  url: string,
  timeoutMs: number,
): Promise<NoKeyboardProbeResult> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  try {
    const page = await context.newPage();
    // `touch=on` forces the adapter in: headless Chromium reports a fine
    // pointer even inside a mobile context, so auto-detect would skip it.
    await page.goto(`${url}?touch=on`, {
      waitUntil: 'networkidle',
      timeout: timeoutMs,
    });
    await page.waitForTimeout(Math.min(1800, timeoutMs));

    type TouchProbe = {
      score: number;
      won: boolean;
      sceneKey: string | null;
      playerX: number | null;
      playerY: number | null;
      kills?: number;
      progress?: number;
    };
    const read = async (): Promise<TouchProbe | null> =>
      page
        .evaluate(() => {
          const fn = (globalThis as { __ogPlayProbe?: () => TouchProbe }).__ogPlayProbe;
          return fn ? fn() : null;
        })
        .catch(() => null);

    const controlsPresent = await page
      .evaluate(() => Boolean((globalThis as { __ogMobileInput?: unknown }).__ogMobileInput))
      .catch(() => false);

    const before = await read();

    const tapAction = async (action: string): Promise<void> => {
      await page
        .evaluate((name) => {
          (
            globalThis as { __ogMobileInput?: { tap: (a: string) => void } }
          ).__ogMobileInput?.tap(name);
        }, action)
        .catch(() => {});
    };
    const holdStick = async (x: number, y: number, ms: number): Promise<void> => {
      await page
        .evaluate(
          (v) => {
            (
              globalThis as { __ogMobileInput?: { setStick: (x: number, y: number) => void } }
            ).__ogMobileInput?.setStick(v.x, v.y);
          },
          { x, y },
        )
        .catch(() => {});
      await page.waitForTimeout(ms);
    };

    // Title screens first, then steer, then the taps a pointer-driven game wants.
    await tapAction('primary');
    await page.waitForTimeout(350);
    await tapAction('primary');
    await page.waitForTimeout(250);

    for (const [x, y] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 0],
    ] as const) {
      await holdStick(x, y, 220);
    }
    await holdStick(0, 0, 60);

    await tapAction('primary');
    await tapAction('secondary');
    await page.waitForTimeout(250);

    const canvas = page.locator('canvas').first();
    if ((await canvas.count()) > 0) {
      const bb = await canvas.boundingBox().catch(() => null);
      if (bb) {
        for (const [fx, fy] of [
          [0.5, 0.5],
          [0.35, 0.45],
          [0.65, 0.55],
        ] as const) {
          await page.touchscreen
            .tap(bb.x + bb.width * fx, bb.y + bb.height * fy)
            .catch(() => {});
          await page.waitForTimeout(200);
        }
      }
    }

    const after = await read();
    if (!before && !after) return { playable: false, controlsPresent };
    const a = before ?? after!;
    const b = after ?? a;
    const moved =
      a.playerX != null && b.playerX != null && a.playerY != null && b.playerY != null
        ? Math.abs(b.playerX - a.playerX) + Math.abs(b.playerY - a.playerY) >= 2
        : false;
    const playable =
      b.score > a.score ||
      b.score > 0 ||
      b.won ||
      moved ||
      (b.kills ?? 0) > (a.kills ?? 0) ||
      (b.progress ?? 0) > (a.progress ?? 0) ||
      Boolean(a.sceneKey && b.sceneKey && a.sceneKey !== b.sceneKey);
    return { playable, controlsPresent };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Serves dist/ locally and loads index.html in headless Chromium when available.
 * Falls back to static HTML parse when playwright is not installed.
 */
export async function runPlayabilitySmoke(
  workspace: string,
  timeoutMs = 8000,
): Promise<PlayabilitySmokeResult> {
  const distDir = path.join(workspace, 'dist');
  const indexHtml = path.join(distDir, 'index.html');
  const issues: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  if (!fs.existsSync(indexHtml)) {
    return { ok: false, issues: ['dist/index.html 不存在，无法冒烟'], consoleErrors, pageErrors };
  }

  let playwright: typeof import('playwright') | null = null;
  try {
    playwright = await import('playwright');
  } catch {
    const requireSmoke =
      process.env['PLATFORM_REQUIRE_PLAYABILITY_SMOKE'] === 'true' ||
      process.env['PLATFORM_REQUIRE_PLAYABILITY_SMOKE'] === '1' ||
      process.env['PLATFORM_GAME_QUALITY_MODE'] === 'strict';
    issues.push(
      'Playwright 未安装 — 无法浏览器冒烟（npm i -D playwright && npx playwright install chromium）',
    );
    return {
      ok: !requireSmoke,
      issues,
      consoleErrors,
      pageErrors,
    };
  }

  const port = 19000 + Math.floor(Math.random() * 1000);
  const server = http.createServer((req, res) => {
    const urlPath = req.url?.split('?')[0] ?? '/';
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    const filePath = path.join(distDir, rel);
    if (!filePath.startsWith(distDir) || !fs.existsSync(filePath)) {
      // Serve empty stubs for optional bootstrap probes so Chromium does not
      // emit a console 404 that falsely fails playability smoke.
      const base = path.basename(rel).toLowerCase();
      if (base === 'og_intent.json' || base === 'change_plan.json') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end('{}');
        return;
      }
      if (/^favicon\.(ico|png)$/i.test(base) || /^apple-touch-icon/i.test(base)) {
        res.statusCode = 204;
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
    };
    res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  const url = `http://127.0.0.1:${port}/index.html`;
  let browser: import('playwright').Browser | null = null;
  let progress: PlayabilitySmokeResult['progress'];
  let screenshotBase64: string | undefined;
  let touchPlayable: boolean | undefined;
  // Roughly doubles smoke time, so operators can turn it off for fast loops.
  const noTouchGate =
    process.env['PLATFORM_SMOKE_TOUCH_GATE'] === 'false' ||
    process.env['PLATFORM_SMOKE_TOUCH_GATE'] === '0';

  try {
    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    const missingUrls: string[] = [];
    page.on('response', (res) => {
      if (res.status() !== 404) return;
      const u = res.url();
      if (!isOptionalMissingUrl(u)) missingUrls.push(u);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (shouldIgnoreConsoleLine(text)) return;
        // Chromium omits the URL from this message; correlate via response 404s.
        if (isGenericResource404Console(text)) {
          if (missingUrls.length === 0) return;
          consoleErrors.push(
            `Failed to load resource (404): ${missingUrls[0]!.slice(0, 180)}`,
          );
          return;
        }
        consoleErrors.push(text);
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    await page.waitForTimeout(Math.min(2000, timeoutMs));
    if (missingUrls.length > 0 && !consoleErrors.some((e) => /404/.test(e))) {
      consoleErrors.push(
        `Failed to load resource (404): ${missingUrls[0]!.slice(0, 180)}`,
      );
    }

    type Probe = {
      score: number;
      won: boolean;
      winHandled: boolean;
      sceneKey: string | null;
      playerX: number | null;
      playerY: number | null;
      inputFrames: number;
      pointerFrames?: number;
      kills?: number;
      hp?: number | null;
      enemyHp?: number | null;
      progress?: number;
      talkedCount?: number;
      chapterIndex?: number;
      endingA?: boolean;
      endingB?: boolean;
      inventory?: string | null;
    };
    const readProbe = async (): Promise<Probe | null> =>
      page
        .evaluate(() => {
          const fn = (
            globalThis as {
              __ogPlayProbe?: () => Probe;
            }
          ).__ogPlayProbe;
          return fn ? fn() : null;
        })
        .catch(() => null);

    const probe0 = await readProbe();
    if (
      probe0?.sceneKey &&
      /gameover|victory|ending|defeat|result/i.test(probe0.sceneKey)
    ) {
      issues.push(
        `启动场景异常：加载后落在 ${probe0.sceneKey}（应为 Title/玩法）。请检查 game.json initialSceneId + customModule 与 bootstrap extraScenes`,
      );
    }

    // Walk toward nearest NPC (layout or runtime registry) then talk —
    // random key mash often never enters talk range (≤90).
    let walkTarget: { x: number; y: number } | null = null;
    try {
      const gamePath = path.join(workspace, 'public', 'game.json');
      if (fs.existsSync(gamePath)) {
        const { resolveWorldLayoutFromGame } = await import('./worldLayout.js');
        const layout = resolveWorldLayoutFromGame(
          JSON.parse(fs.readFileSync(gamePath, 'utf8')),
        );
        const npc = layout.npcs[0];
        if (npc) walkTarget = { x: npc.x, y: npc.y };
        else if (layout.player) {
          walkTarget = { x: layout.player.x + 80, y: layout.player.y };
        }
      }
    } catch {
      /* optional */
    }
    const runtimeNpc = await page
      .evaluate(() => {
        const g = (
          globalThis as {
            __ogGame?: {
              scene?: {
                getScenes?: (active?: boolean) => Array<{
                  registry?: { get: (k: string) => unknown };
                }>;
              };
            };
          }
        ).__ogGame;
        const scenes = g?.scene?.getScenes?.(true) ?? [];
        for (const s of scenes) {
          const list = s.registry?.get?.('__ogNpcPos');
          if (Array.isArray(list) && list[0] && typeof list[0] === 'object') {
            const n = list[0] as { x?: unknown; y?: unknown };
            if (typeof n.x === 'number' && typeof n.y === 'number') {
              return { x: n.x, y: n.y };
            }
          }
        }
        return null;
      })
      .catch(() => null);
    if (runtimeNpc) walkTarget = runtimeNpc;

    // Title / menu: Space to enter play scene before steering
    await page.keyboard.press('Space').catch(() => {});
    await page.waitForTimeout(400);
    await page.keyboard.press('Space').catch(() => {});
    await page.waitForTimeout(300);

    if (walkTarget) {
      for (let step = 0; step < 24; step++) {
        const probe = await readProbe();
        const px = probe?.playerX;
        const py = probe?.playerY;
        if (typeof px !== 'number' || typeof py !== 'number') {
          await page.keyboard.press('ArrowRight').catch(() => {});
          await page.keyboard.press('KeyD').catch(() => {});
          await page.waitForTimeout(100);
          continue;
        }
        const dx = walkTarget.x - px;
        const dy = walkTarget.y - py;
        if (Math.abs(dx) + Math.abs(dy) <= 70) break;
        const pair =
          Math.abs(dx) >= Math.abs(dy)
            ? dx > 0
              ? (['ArrowRight', 'KeyD'] as const)
              : (['ArrowLeft', 'KeyA'] as const)
            : dy > 0
              ? (['ArrowDown', 'KeyS'] as const)
              : (['ArrowUp', 'KeyW'] as const);
        for (const key of pair) {
          await page.keyboard.down(key).catch(() => {});
        }
        await page.waitForTimeout(140);
        for (const key of pair) {
          await page.keyboard.up(key).catch(() => {});
        }
      }
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('KeyE').catch(() => {});
        await page.waitForTimeout(100);
      }
    }

    // Steer toward a portal with targetSceneId (region hop / scene.start)
    let portalTarget: { x: number; y: number } | null = null;
    try {
      const gamePath = path.join(workspace, 'public', 'game.json');
      if (fs.existsSync(gamePath)) {
        const { resolveWorldLayoutFromGame } = await import('./worldLayout.js');
        const layout = resolveWorldLayoutFromGame(
          JSON.parse(fs.readFileSync(gamePath, 'utf8')),
        );
        const portal =
          layout.portals.find((p) => Boolean(p.targetSceneId)) ??
          layout.portals[0];
        if (portal) portalTarget = { x: portal.x, y: portal.y };
      }
    } catch {
      /* optional */
    }
    const regionBefore = await page
      .evaluate(() => {
        const g = (
          globalThis as {
            __ogGame?: {
              scene?: {
                getScenes?: (active?: boolean) => Array<{
                  registry?: { get: (k: string) => unknown };
                }>;
              };
            };
          }
        ).__ogGame;
        for (const s of g?.scene?.getScenes?.(true) ?? []) {
          const rid = s.registry?.get?.('worldRegionId');
          if (typeof rid === 'string' && rid) return rid;
        }
        return null;
      })
      .catch(() => null);
    if (portalTarget) {
      for (let step = 0; step < 20; step++) {
        const probe = await readProbe();
        const px = probe?.playerX;
        const py = probe?.playerY;
        if (typeof px !== 'number' || typeof py !== 'number') break;
        const dx = portalTarget.x - px;
        const dy = portalTarget.y - py;
        if (Math.abs(dx) + Math.abs(dy) <= 50) break;
        const pair =
          Math.abs(dx) >= Math.abs(dy)
            ? dx > 0
              ? (['ArrowRight', 'KeyD'] as const)
              : (['ArrowLeft', 'KeyA'] as const)
            : dy > 0
              ? (['ArrowDown', 'KeyS'] as const)
              : (['ArrowUp', 'KeyW'] as const);
        for (const key of pair) {
          await page.keyboard.down(key).catch(() => {});
        }
        await page.waitForTimeout(140);
        for (const key of pair) {
          await page.keyboard.up(key).catch(() => {});
        }
      }
      await page.waitForTimeout(250);
    }

    // World-compiled games use WASD; World kernel also accepts arrows — dual-press.
    const worldSeedPresent = fs.existsSync(
      path.join(workspace, 'public', 'WORLD_SEED.json'),
    );
    const biblePresent = fs.existsSync(
      path.join(workspace, 'public', 'STORY_BIBLE.json'),
    );
    const keys = [
      'ArrowRight',
      'KeyD',
      'ArrowRight',
      'KeyD',
      'ArrowDown',
      'KeyS',
      'ArrowLeft',
      'KeyA',
      'ArrowUp',
      'KeyW',
      'Space',
      'Space',
      'Enter',
      'KeyE',
      'KeyE',
      'KeyF',
    ];
    for (const key of keys) {
      await page.keyboard.press(key).catch(() => {});
      await page.waitForTimeout(160);
    }
    // Extra narrative pulses: E talk + Space for Chapter dialogue
    if (biblePresent) {
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('KeyE').catch(() => {});
        await page.waitForTimeout(120);
        await page.keyboard.press('Space').catch(() => {});
        await page.waitForTimeout(120);
      }
      // Chapter Skip — accelerate Title→Chapter→World opener
      await page.keyboard.press('KeyS').catch(() => {});
      await page.waitForTimeout(300);
      await page.keyboard.press('KeyS').catch(() => {});
      await page.waitForTimeout(200);
    }
    // TD / Title / Chapter: pointer interactions (place tower, start, advance)
    const box = page.locator('canvas').first();
    if ((await box.count()) > 0) {
      const bb = await box.boundingBox().catch(() => null);
      if (bb) {
        await page.mouse
          .click(bb.x + bb.width * 0.35, bb.y + bb.height * 0.55)
          .catch(() => {});
        await page.waitForTimeout(250);
        await page.mouse
          .click(bb.x + bb.width * 0.65, bb.y + bb.height * 0.45)
          .catch(() => {});
        await page.waitForTimeout(250);
        if (biblePresent) {
          // STORY hub (~left) and dialogue advance (~bottom)
          await page.mouse
            .click(bb.x + bb.width * 0.08, bb.y + bb.height * 0.5)
            .catch(() => {});
          await page.waitForTimeout(200);
          await page.mouse
            .click(bb.x + bb.width * 0.5, bb.y + bb.height * 0.72)
            .catch(() => {});
          await page.waitForTimeout(200);
        }
        const probePlan = smokeProbePlan(readMechanicSpec(workspace), workspace);
        if (probePlan.denseBoard || probePlan.mode === 'place') {
          const cells =
            probePlan.mode === 'place'
              ? ([
                  [0.25, 0.35],
                  [0.4, 0.4],
                  [0.55, 0.35],
                  [0.7, 0.45],
                ] as const)
              : ([
                  [0.12, 0.16],
                  [0.12, 0.28],
                  [0.18, 0.16],
                  [0.22, 0.22],
                  [0.28, 0.16],
                  [0.35, 0.22],
                  [0.45, 0.2],
                  [0.55, 0.25],
                ] as const);
          for (const [fx, fy] of cells) {
            await page.mouse
              .click(bb.x + bb.width * fx, bb.y + bb.height * fy)
              .catch(() => {});
            await page.waitForTimeout(80);
          }
        }
        if (probePlan.mode === 'choice') {
          await page.mouse
            .click(bb.x + bb.width * 0.5, bb.y + bb.height * 0.72)
            .catch(() => {});
          await page.waitForTimeout(200);
        }
      }
    }

    const probe1 = await readProbe();

    const smokeEnv = process.env['PLATFORM_SMOKE_REQUIRE_PROGRESS'];
    const beyondQuality =
      process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] === 'true' ||
      process.env['PLATFORM_QUALITY_BEYOND_BASELINE'] === '1' ||
      process.env['PLATFORM_GAME_QUALITY_MODE'] === 'strict';
    // `false`/`0` is a hard opt-out so the baseline gate tier can ship a
    // playable build even when CHANGE_PLAN / ARCADE_KERNEL are on disk.
    const progressOptOut = smokeEnv === 'false' || smokeEnv === '0';
    const requireProgress =
      !progressOptOut &&
      (smokeEnv === 'true' ||
        smokeEnv === '1' ||
        beyondQuality ||
        fs.existsSync(path.join(workspace, 'public', 'CHANGE_PLAN.json')) ||
        fs.existsSync(path.join(workspace, 'public', 'ARCADE_KERNEL.json')) ||
        fs.existsSync(path.join(workspace, 'public', 'BOARD_KERNEL.json')) ||
        smokeProbePlan(readMechanicSpec(workspace), workspace).rejectSpaceShell);

    if (!probe0 && !probe1) {
      if (requireProgress) {
        issues.push(
          '冒烟进度信号缺失：未找到 __ogPlayProbe（runtime 未安装探针）',
        );
      }
    } else {
      const a = probe0 ?? {
        score: 0,
        won: false,
        winHandled: false,
        sceneKey: null as string | null,
        playerX: null as number | null,
        playerY: null as number | null,
        inputFrames: 0,
        pointerFrames: 0,
        kills: 0,
        hp: null as number | null,
        enemyHp: null as number | null,
        progress: 0,
      };
      const b = probe1 ?? a;
      const sceneChanged = Boolean(
        a.sceneKey && b.sceneKey && a.sceneKey !== b.sceneKey,
      );
      const dx =
        a.playerX != null && b.playerX != null
          ? Math.abs(b.playerX - a.playerX)
          : 0;
      const dy =
        a.playerY != null && b.playerY != null
          ? Math.abs(b.playerY - a.playerY)
          : 0;
      const poseMoved = dx + dy >= 2;
      const inputHeard = (b.inputFrames ?? 0) > (a.inputFrames ?? 0);
      const pointerHeard =
        (b.pointerFrames ?? 0) > (a.pointerFrames ?? 0);
      const statProgress =
        (b.kills ?? 0) > (a.kills ?? 0) ||
        (b.progress ?? 0) > (a.progress ?? 0) ||
        (a.hp != null && b.hp != null && b.hp !== a.hp) ||
        (a.enemyHp != null &&
          b.enemyHp != null &&
          b.enemyHp !== a.enemyHp);
      // Real gameplay signal — bare keydown alone is NOT enough under REQUIRE_PROGRESS
      const boardKernelPresent = fs.existsSync(
        path.join(workspace, 'public', 'BOARD_KERNEL.json'),
      );
      const leftoverSpace =
        (boardKernelPresent ||
          smokeProbePlan(readMechanicSpec(workspace), workspace)
            .rejectSpaceShell) &&
        fs.existsSync(path.join(workspace, 'src', 'scenes', 'GridArcadeScene.ts'));
      if (leftoverSpace) {
        issues.push(
          '棋盘冒烟：仍是空格加分壳（GridArcadeScene），不是走子循环',
        );
      }
      const turnChanged =
        String((a as { turn?: unknown }).turn ?? '') !==
          String((b as { turn?: unknown }).turn ?? '') &&
        Boolean((b as { turn?: unknown }).turn);
      const gameplaySignal =
        leftoverSpace
          ? false
          : b.score > a.score ||
            b.won ||
            b.winHandled ||
            sceneChanged ||
            b.score > 0 ||
            poseMoved ||
            statProgress ||
            (boardKernelPresent && (pointerHeard || turnChanged));
      const moved = requireProgress
        ? gameplaySignal
        : gameplaySignal || inputHeard || pointerHeard;
      const narrativeSignal =
        (b.talkedCount ?? 0) > (a.talkedCount ?? 0) ||
        (b.talkedCount ?? 0) > 0 ||
        Boolean(b.inventory) ||
        (b.progress ?? 0) > (a.progress ?? 0) ||
        Boolean(b.endingA) ||
        Boolean(b.endingB) ||
        (b.chapterIndex ?? 0) > (a.chapterIndex ?? 0) ||
        sceneChanged;
      progress = {
        score: b.score,
        won: b.won,
        winHandled: b.winHandled,
        sceneKey: b.sceneKey,
        sceneChanged,
        moved,
        poseMoved,
        inputFrames: b.inputFrames,
        pointerFrames: b.pointerFrames,
        gameplaySignal,
        bossPresent: Boolean(
          (b as { bossPresent?: boolean }).bossPresent,
        ),
        difficultyTier:
          (b as { difficultyTier?: number | null }).difficultyTier ?? null,
        enemyCount: Number((b as { enemyCount?: number }).enemyCount ?? 0),
        talkedCount: b.talkedCount ?? 0,
        inventory: b.inventory ?? null,
        endingA: Boolean(b.endingA),
        endingB: Boolean(b.endingB),
        chapterIndex: b.chapterIndex ?? 0,
        narrativeSignal,
      };
      if (requireProgress && !moved) {
        issues.push(
          '冒烟进度信号缺失：输入后 score/won/scene/位移/HP/塔/击杀均无变化（PLATFORM_SMOKE_REQUIRE_PROGRESS；仅按键不算）',
        );
      }
      // Narrative walk-talk: STORY_BIBLE present → expect talk/quest signal after E
      const biblePath = path.join(workspace, 'public', 'STORY_BIBLE.json');
      if (
        requireProgress &&
        fs.existsSync(biblePath) &&
        /world|chapter/i.test(String(b.sceneKey ?? a.sceneKey ?? ''))
      ) {
        if (!narrativeSignal && !poseMoved) {
          issues.push(
            '叙事冒烟: 有 STORY_BIBLE 但未见 walked/talked_*/quest progress（走动对话闭环未接线）',
          );
        } else if (
          beyondQuality &&
          !narrativeSignal &&
          poseMoved &&
          /world/i.test(String(b.sceneKey ?? a.sceneKey ?? ''))
        ) {
          // Beyond tier: mere walking is not enough for World+bible — need talk/quest/portal hop
          issues.push(
            '叙事冒烟: World+STORY_BIBLE 仅有位移，未见 talked_*/inventory/ending/门户换场（请接线 E 对话或 portal scene.start）',
          );
        }
      }
      // WORLD_SEED / multi-region portals: wiring + optional region hop signal
      if (beyondQuality && requireProgress) {
        try {
          let exitCount = 0;
          if (worldSeedPresent) {
            const seed = JSON.parse(
              fs.readFileSync(
                path.join(workspace, 'public', 'WORLD_SEED.json'),
                'utf8',
              ),
            ) as {
              scenePlan?: Array<{ exits?: unknown[] }>;
              scenes?: Array<{ exits?: unknown[] }>;
            };
            const plans = seed.scenePlan ?? seed.scenes ?? [];
            exitCount = plans.reduce(
              (n, s) => n + (Array.isArray(s.exits) ? s.exits.length : 0),
              0,
            );
          }
          if (exitCount === 0) {
            const gamePath = path.join(workspace, 'public', 'game.json');
            if (fs.existsSync(gamePath)) {
              const { resolveWorldLayoutsBySceneId } = await import(
                './worldLayout.js'
              );
              const byId = resolveWorldLayoutsBySceneId(
                JSON.parse(fs.readFileSync(gamePath, 'utf8')),
              );
              exitCount = Object.values(byId).reduce(
                (n, lay) =>
                  n + lay.portals.filter((p) => Boolean(p.targetSceneId)).length,
                0,
              );
            }
          }
          if (exitCount > 0) {
            let sceneBlob = '';
            const scenesDir = path.join(workspace, 'src', 'scenes');
            if (fs.existsSync(scenesDir)) {
              for (const f of fs.readdirSync(scenesDir)) {
                if (!f.endsWith('.ts')) continue;
                sceneBlob += fs.readFileSync(path.join(scenesDir, f), 'utf8');
              }
            }
            if (
              !/scene\.start\s*\(|sceneTransition|WORLD_SCENES|resolvePortalHop|resolvePortalTarget|worldRegionId/i.test(
                sceneBlob,
              )
            ) {
              issues.push(
                '叙事冒烟: 含门户出口，但 Scene 未见 scene.start / resolvePortalHop / worldRegionId 接线',
              );
            }
            const regionAfter = await page
              .evaluate(() => {
                const g = (
                  globalThis as {
                    __ogGame?: {
                      scene?: {
                        getScenes?: (active?: boolean) => Array<{
                          registry?: { get: (k: string) => unknown };
                        }>;
                      };
                    };
                  }
                ).__ogGame;
                for (const s of g?.scene?.getScenes?.(true) ?? []) {
                  const rid = s.registry?.get?.('worldRegionId');
                  if (typeof rid === 'string' && rid) return rid;
                }
                return null;
              })
              .catch(() => null);
            const regionHopped =
              Boolean(regionBefore) &&
              Boolean(regionAfter) &&
              regionBefore !== regionAfter;
            const portalStrict =
              process.env['PLATFORM_SMOKE_PORTAL_STRICT'] === 'true' ||
              process.env['PLATFORM_SMOKE_PORTAL_STRICT'] === '1';
            // Hard when strict env, or when player clearly reached portal pad
            let nearPortal = false;
            if (portalTarget) {
              const probe = await readProbe();
              if (
                typeof probe?.playerX === 'number' &&
                typeof probe?.playerY === 'number'
              ) {
                nearPortal =
                  Math.abs(probe.playerX - portalTarget.x) +
                    Math.abs(probe.playerY - portalTarget.y) <=
                  80;
              }
            }
            if (
              !sceneChanged &&
              !regionHopped &&
              (portalStrict || nearPortal)
            ) {
              issues.push(
                '叙事冒烟: 已靠近门户但未换场/换区（sceneKey 与 worldRegionId 均未变）— 请确认 portal overlap → scene.start / worldRegionId+restart',
              );
            }
          }
        } catch {
          /* optional seed parse */
        }
      }
      const planPath = path.join(workspace, 'public', 'CHANGE_PLAN.json');
      if (fs.existsSync(planPath)) {
        try {
          const plan = JSON.parse(fs.readFileSync(planPath, 'utf8')) as {
            addBoss?: boolean;
            difficulty?: string | null;
          };
          if (plan.addBoss && progress.bossPresent === false) {
            issues.push(
              'ChangePlan 冒烟: addBoss 但运行时 bossPresent=false（og_intent/Scene 未落地）',
            );
          }
        } catch {
          /* ignore */
        }
      }
    }

    /*
     * No-keyboard gate. Only meaningful when the keyboard pass already proved
     * the build works — otherwise the failure is "this game is broken", which
     * is reported above, and repeating it as a touch problem would send the
     * fix loop after the wrong thing.
     */
    if (!noTouchGate && progress?.gameplaySignal) {
      try {
        const touch = await runNoKeyboardProbe(browser, url, timeoutMs);
        touchPlayable = touch.playable;
        if (!touch.controlsPresent) {
          issues.push(
            '触屏可玩性: 运行时未安装屏幕摇杆（@opengame/runtime 版本过旧或 meta.mobileInput.enabled=false）— 手机上将不可操作',
          );
        } else if (!touch.playable) {
          issues.push(
            '触屏可玩性: 仅用摇杆/按钮/点击无法产生任何进度（score/位移/换场均无变化）— 该作品在手机与微信里不可玩，请让玩法响应指针或方向输入',
          );
        }
      } catch {
        // A touch pass that cannot start must not fail an otherwise good build.
      }
    }

    const canvas = page.locator('canvas').first();
    const canvasCount = await canvas.count();
    if (canvasCount === 0) {
      issues.push('页面未找到 canvas — 游戏可能未启动');
    } else {
      const notBlank = await canvas.evaluate((el) => {
        const c = el as unknown as {
          width: number;
          height: number;
          toDataURL: (type?: string) => string;
          getContext: (type: string) => unknown;
        };
        if (c.width < 2 || c.height < 2) return true;
        // WebGL canvases often reject getContext('2d') — use toDataURL sample
        try {
          const url = c.toDataURL('image/png');
          if (url.length < 200) return false;
          return true;
        } catch {
          /* fall through */
        }
        try {
          const gl = (c.getContext('webgl') ||
            c.getContext('webgl2') ||
            c.getContext('experimental-webgl')) as {
            readPixels: (
              x: number,
              y: number,
              w: number,
              h: number,
              format: number,
              type: number,
              pixels: Uint8Array,
            ) => void;
            RGBA: number;
            UNSIGNED_BYTE: number;
          } | null;
          if (gl) {
            const pixels = new Uint8Array(4);
            gl.readPixels(
              Math.floor(c.width / 2),
              Math.floor(c.height / 2),
              1,
              1,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              pixels,
            );
            return pixels[0]! + pixels[1]! + pixels[2]! > 12;
          }
        } catch {
          /* fall through */
        }
        const ctx = c.getContext('2d') as {
          getImageData: (
            x: number,
            y: number,
            w: number,
            h: number,
          ) => { data: Uint8ClampedArray };
        } | null;
        if (!ctx) return true;
        const sample = ctx.getImageData(
          Math.floor(c.width / 2),
          Math.floor(c.height / 2),
          1,
          1,
        ).data;
        return sample[0]! + sample[1]! + sample[2]! > 12;
      });
      if (!notBlank) {
        issues.push('canvas 采样全黑 — Scene 可能未启动或 initialSceneId 错误');
      }
    }

    try {
      screenshotBase64 = (
        await page.screenshot({ type: 'png' })
      ).toString('base64');
    } catch {
      /* optional vision input */
    }
  } catch (err) {
    issues.push(err instanceof Error ? err.message : String(err));
  } finally {
    await browser?.close().catch(() => {});
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  if (pageErrors.length > 0) {
    issues.push(`运行时异常: ${pageErrors[0]!.slice(0, 200)}`);
  }
  if (consoleErrors.length > 0) {
    issues.push(`控制台错误: ${consoleErrors[0]!.slice(0, 200)}`);
  }

  issues.push(...collectChangePlanSmokeIssues(workspace));

  return {
    ok: issues.length === 0,
    issues,
    consoleErrors,
    pageErrors,
    ...(progress ? { progress } : {}),
    ...(screenshotBase64 ? { screenshotBase64 } : {}),
    ...(touchPlayable === undefined ? {} : { touchPlayable }),
  };
}

export function formatPlayabilityFailureForPrompt(result: PlayabilitySmokeResult): string {
  return [
    '【运行时冒烟 / Playability smoke】预览加载失败，请修复：',
    ...result.issues.map((i) => `- ${i}`),
    ...(result.pageErrors.length
      ? ['', '--- pageerror ---', result.pageErrors.slice(0, 3).join('\n')]
      : []),
    '',
    '检查：main.ts 是否 bootstrap({ extraScenes: [...] })；Scene key 是否与 scene.start 一致；game.json 是否合法。',
  ].join('\n');
}
