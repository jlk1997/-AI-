#!/usr/bin/env node
/**
 * Offline multi-turn productization smoke (no LLM, no browser).
 * Asserts the north-star ChangePlan chain is parseable + artifact-seedable.
 *
 * Usage: node scripts/quality-multiturn-smoke.mjs
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const failures = [];

async function loadChangePlan() {
  const dist = path.join(root, 'apps', 'platform-worker', 'dist', 'changePlan.js');
  if (fs.existsSync(dist)) {
    return import(pathToFileURL(dist).href);
  }
  try {
    return require(dist);
  } catch {
    failures.push('Build worker first: npm run build -w @opengame/platform-worker');
    return null;
  }
}

async function main() {
  const cp = await loadChangePlan();
  if (!cp) {
    console.log(JSON.stringify({ ok: false, failures }, null, 2));
    process.exit(1);
  }

  const turns = [
    { prompt: '做一个横版跑酷，两关', expect: { intent: 'create' } },
    {
      prompt: '更难一点，加一个 Boss',
      expect: { difficulty: 'harder', addBoss: true },
    },
    {
      prompt: '画风换成赛博朋克',
      expect: { artStyle: /cyberpunk|赛博/i, forceAssetRegen: true },
    },
  ];

  const neonScenes = [
    'TitleScene',
    'Level1Scene',
    'Level2Scene',
    'GameOverScene',
  ];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-mt-'));
  const pub = path.join(dir, 'public');
  fs.mkdirSync(pub, { recursive: true });
  fs.writeFileSync(
    path.join(pub, 'game.json'),
    JSON.stringify({
      meta: { title: 'Platformer' },
      scenes: [
        {
          id: 'level1',
          entities: [
            { id: 'player', kind: 'player', tags: ['player'] },
            { id: 'slime', kind: 'enemy', tags: ['enemy'], attrs: { hp: 2 } },
          ],
        },
      ],
      tunables: { enemyCount: 2, spawnIntervalMs: 1200 },
    }),
    'utf8',
  );

  // Turn 1 — create-shaped plan (still parse as iterate flags when follow-up)
  const t1 = cp.parseChangePlan({
    userPrompt: turns[0].prompt,
    intent: 'create',
  });
  if (!t1 || t1.schema !== 'opengame-change-plan-v1') {
    failures.push('turn1: invalid ChangePlan schema');
  }

  // Turn 2 — harder + boss must seed DSL
  const t2 = cp.parseChangePlan({
    userPrompt: turns[1].prompt,
    intent: 'iterate',
  });
  if (t2.difficulty !== 'harder' || !t2.addBoss) {
    failures.push('turn2: expected harder + addBoss');
  }
  await cp.writeChangePlan(dir, t2);
  await cp.applyChangePlanToGdd(dir, t2);
  const seeded = await cp.applyChangePlanToGameArtifacts(dir, t2);
  if (!seeded.patches?.length) {
    failures.push('turn2: applyChangePlanToGameArtifacts produced no patches');
  }
  const dsl = JSON.parse(
    fs.readFileSync(path.join(pub, 'game.json'), 'utf8'),
  );
  if (!/\bboss\b/i.test(JSON.stringify(dsl))) {
    failures.push('turn2: game.json missing boss after seed');
  }
  if (Number(dsl.tunables?.enemyCount ?? 0) < 5) {
    failures.push('turn2: enemyCount not bumped for harder');
  }
  if (!fs.existsSync(path.join(pub, 'og_intent.json'))) {
    failures.push('turn2: missing og_intent.json');
  }

  // Turn 3 — art style force regen
  const t3 = cp.parseChangePlan({
    userPrompt: turns[2].prompt,
    sessionSummary: '- 用户: 更难一点，加一个 Boss',
    intent: 'iterate',
  });
  if (!t3.artStyle || !turns[2].expect.artStyle.test(t3.artStyle)) {
    failures.push(`turn3: artStyle not cyberpunk (got ${t3.artStyle})`);
  }
  if (!t3.forceAssetRegen) {
    failures.push('turn3: forceAssetRegen should be true');
  }
  await cp.applyChangePlanToGdd(dir, t3);
  const gdd = fs.readFileSync(path.join(dir, 'GAME_DESIGN.md'), 'utf8');
  if (!/art\s*style[:：]/i.test(gdd)) {
    failures.push('turn3: GDD missing art style line');
  }
  const styleToken = (t3.artStyle || '')
    .toLowerCase()
    .split(/\s+/)
    .find((t) => t.length >= 4);
  if (styleToken && !gdd.toLowerCase().includes(styleToken.slice(0, 6))) {
    // cyberpunk / 赛博 may be written as full phrase
    if (!/cyberpunk|赛博/i.test(gdd)) {
      failures.push('turn3: GDD art style not aligned with ChangePlan');
    }
  }

  // Neon-style three targeted turns: coin on L1 → harder → Title copy
  const neonTurns = [
    {
      prompt: '第1关多一个金币',
      check: (p) =>
        p.editLevel &&
        p.targetSceneId &&
        /Level1|level1/i.test(String(p.targetSceneId)),
      fail: 'neon1: expected editLevel + Level1 target',
    },
    {
      prompt: '更难一点',
      check: (p) => p.difficulty === 'harder',
      fail: 'neon2: expected harder',
    },
    {
      prompt: 'Title 文案改一句',
      check: (p) => p.targetSceneId && /Title/i.test(String(p.targetSceneId)),
      fail: 'neon3: expected TitleScene target',
    },
  ];
  for (const nt of neonTurns) {
    const plan = cp.parseChangePlan({
      userPrompt: nt.prompt,
      intent: 'iterate',
      sceneIds: neonScenes,
    });
    if (!nt.check(plan)) failures.push(nt.fail);
  }

  // ui_heavy short story: create dialogue seed + second-turn append
  const vnDir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-vn-'));
  const vnPub = path.join(vnDir, 'public');
  fs.mkdirSync(vnPub, { recursive: true });
  fs.writeFileSync(
    path.join(vnPub, 'game.json'),
    JSON.stringify({
      meta: { title: 'Town Tale' },
      scenes: [
        { id: 'TitleScene', entities: [] },
        { id: 'ChapterScene', entities: [] },
      ],
      dialogue: [],
    }),
    'utf8',
  );
  const vn1 = cp.parseChangePlan({
    userPrompt: '做一个小镇剧情：加对话和选项',
    intent: 'iterate',
    sceneIds: ['TitleScene', 'ChapterScene', 'BattleScene', 'EndingScene'],
  });
  if (!vn1.addDialogue) failures.push('ui_heavy1: expected addDialogue');
  const vnSeed = await cp.applyChangePlanToGameArtifacts(vnDir, vn1);
  const storyPath = path.join(vnPub, 'story', 'chapter_01.json');
  if (!fs.existsSync(storyPath)) {
    failures.push('ui_heavy1: missing public/story/chapter_01.json');
  }
  if (!vnSeed.patches?.some((p) => String(p).includes('story'))) {
    failures.push('ui_heavy1: no story patch');
  }
  const beforeEntries = JSON.parse(fs.readFileSync(storyPath, 'utf8')).entries
    ?.length;
  const vn2 = cp.parseChangePlan({
    userPrompt: '给铁匠加三句对话',
    intent: 'iterate',
    sceneIds: ['TitleScene', 'ChapterScene'],
  });
  if (!vn2.addDialogue) failures.push('ui_heavy2: expected addDialogue');
  await cp.applyChangePlanToGameArtifacts(vnDir, vn2);
  const afterEntries = JSON.parse(fs.readFileSync(storyPath, 'utf8')).entries
    ?.length;
  if (!(afterEntries > beforeEntries)) {
    failures.push('ui_heavy2: story entries did not grow');
  }

  // Confirm label for chat bar
  if (typeof cp.formatChangePlanConfirmLabel === 'function') {
    const label = cp.formatChangePlanConfirmLabel(neonTurns[0]
      ? cp.parseChangePlan({
          userPrompt: '第1关多一个金币',
          intent: 'iterate',
          sceneIds: neonScenes,
        })
      : vn1);
    if (!/^本轮将改：/.test(label)) {
      failures.push(`confirmLabel: bad format (${label})`);
    }
  } else {
    failures.push('missing formatChangePlanConfirmLabel');
  }

  // Outline → bible (load from dist if present)
  try {
    const outlineDist = path.join(
      root,
      'apps',
      'platform-worker',
      'dist',
      'storyOutline.js',
    );
    if (fs.existsSync(outlineDist)) {
      const so = await import(pathToFileURL(outlineDist).href);
      const bible = so.buildHeuristicStoryBible(
        '做一个小镇剧情：3 NPC、2 任务、对话选项影响结局',
      );
      if (!bible?.npcs || bible.npcs.length < 2) {
        failures.push('outline: bible needs ≥2 NPCs');
      }
      if (!bible?.quests || bible.quests.length < 1) {
        failures.push('outline: bible needs ≥1 quest');
      }
    }
  } catch (e) {
    failures.push(`outline load failed: ${e}`);
  }

  // World planner ops allow-list in source
  const plannerSrc = fs.readFileSync(
    path.join(root, 'packages', 'world-planner', 'src', 'planner.ts'),
    'utf8',
  );
  for (const needle of ['add_quest', 'edit_dialogue']) {
    if (!plannerSrc.includes(needle)) {
      failures.push(`world-planner missing ${needle}`);
    }
  }

  // Community share wiring (IDE)
  const genPage = fs.readFileSync(
    path.join(root, 'apps', 'platform-web', 'src', 'pages', 'GeneratePage.tsx'),
    'utf8',
  );
  for (const needle of [
    'PublishGameModal',
    'openCommunityShare',
    'shareToCommunity',
  ]) {
    if (!genPage.includes(needle) && needle !== 'shareToCommunity') {
      failures.push(`GeneratePage missing ${needle}`);
    }
  }
  if (!genPage.includes('onShareToCommunity') && !genPage.includes('shareToCommunity')) {
    failures.push('GeneratePage missing share-to-community CTA wiring');
  }
  const pubModal = fs.readFileSync(
    path.join(
      root,
      'apps',
      'platform-web',
      'src',
      'components',
      'Community',
      'PublishGameModal.tsx',
    ),
    'utf8',
  );
  if (!pubModal.includes('api.community.publishGame')) {
    failures.push('PublishGameModal should use api.community.publishGame');
  }
  const appTsx = fs.readFileSync(
    path.join(root, 'apps', 'platform-web', 'src', 'App.tsx'),
    'utf8',
  );
  if (!appTsx.includes('/play/') || !appTsx.includes('PlayRedirect')) {
    failures.push('App.tsx missing /play/:slug redirect');
  }
  const socialMig = path.join(
    root,
    'packages',
    'platform-db',
    'migrations',
    '0008_community_social.sql',
  );
  if (!fs.existsSync(socialMig)) {
    failures.push('missing 0008_community_social.sql migration');
  }

  // ChoicePanel export
  const dlgIndex = fs.readFileSync(
    path.join(root, 'packages', 'module-dialogue', 'src', 'index.ts'),
    'utf8',
  );
  if (!dlgIndex.includes('ChoicePanel')) {
    failures.push('module-dialogue missing ChoicePanel export');
  }

  // Contracts present in worker sources
  const proc = fs.readFileSync(
    path.join(root, 'apps', 'platform-worker', 'src', 'processJob.ts'),
    'utf8',
  );
  for (const needle of [
    'prepareWorkspaceForReset',
    'applyChangePlanToGameArtifacts',
    'ensureChangePlanSceneContracts',
    'fixStrategy',
    'readTargetSceneSlice',
    'formatChangePlanConfirmLabel',
    'buildNarrativeQualityRecovery',
  ]) {
    if (!proc.includes(needle)) failures.push(`processJob missing ${needle}`);
  }

  // Scene contract: stripped Level must get Boss inject
  const scenesDir = path.join(dir, 'src', 'scenes');
  fs.mkdirSync(scenesDir, { recursive: true });
  fs.writeFileSync(
    path.join(scenesDir, 'Level1Scene.ts'),
    `import Phaser from 'phaser';
export class Level1Scene extends Phaser.Scene {
  constructor() { super('Level1Scene'); }
  create(): void { this.add.text(0,0,'hi'); }
}
`,
  );
  const contracts = await cp.ensureChangePlanSceneContracts(dir, t2);
  if (!contracts?.patches?.some((p) => String(p).includes('boss'))) {
    failures.push('ensureChangePlanSceneContracts did not inject boss');
  }
  const levelSrc = fs.readFileSync(
    path.join(scenesDir, 'Level1Scene.ts'),
    'utf8',
  );
  if (!/bossPresent|setData\(['"]boss['"]/.test(levelSrc)) {
    failures.push('Level1Scene missing boss after scene contract');
  }

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        turns: turns.map((t) => t.prompt),
        neon: neonTurns.map((t) => t.prompt),
        uiHeavy: ['加对话和选项', '给铁匠加三句对话'],
        patches: seeded.patches?.slice(0, 10),
        failures,
      },
      null,
      2,
    ),
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
