#!/usr/bin/env node
/**
 * Multi-turn blind scorecard harness (offline + human checklist).
 * 1) Runs deterministic ChangePlan/DSL seed checks (via multiturn smoke helpers).
 * 2) Prints a scorecard for human blind review of the north-star 三连.
 *
 * Usage: node scripts/quality-blind-scorecard.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const scorecard = {
  schema: 'opengame-blind-scorecard-v1',
  northStar:
    '横版 → 更难+Boss → 赛博画风：三轮都绿，玩法与美术肉眼可见变化',
  automated: {},
  humanChecklist: [
    {
      id: 'play_visible',
      prompt: '第二轮后：难度/Boss 是否肉眼可见？',
      passBar: '≥80% blind',
    },
    {
      id: 'art_visible',
      prompt: '第三轮后：赛博画风是否肉眼可见？',
      passBar: '≥80% blind',
    },
    {
      id: 'juice_survived',
      prompt: '三轮后：音效/镜头/暂停是否仍在？',
      passBar: 'no mute color-block regression',
    },
    {
      id: 'world_expand',
      prompt: '世界「扩一片林子」后新区海报是否更新？',
      passBar: 'no stale start poster',
    },
    {
      id: 'lingbot_honest',
      prompt: 'Lab /step 是否误标成真视频？',
      passBar: '0 incidents',
    },
  ],
};

function main() {
  const mt = spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'quality-multiturn-smoke.mjs')],
    { cwd: root, encoding: 'utf8', shell: true },
  );
  let multiturnOk = false;
  try {
    const parsed = JSON.parse(mt.stdout.slice(mt.stdout.indexOf('{')));
    multiturnOk = Boolean(parsed.ok);
    scorecard.automated.multiturnSmoke = parsed;
  } catch {
    scorecard.automated.multiturnSmoke = {
      ok: false,
      stderr: mt.stderr?.slice(0, 500),
      stdout: mt.stdout?.slice(0, 500),
    };
  }

  // Static contracts
  const failures = [];
  const arcade = path.join(
    root,
    'apps',
    'platform-worker',
    'src',
    'gridArcadeKernels.ts',
  );
  if (!fs.existsSync(arcade)) failures.push('missing gridArcadeKernels.ts');
  else {
    const src = fs.readFileSync(arcade, 'utf8');
    for (const n of [
      'SnakeArcadeScene',
      'FlappyArcadeScene',
      'G2048ArcadeScene',
      'PlatformSceneHelper',
      'preloadGameArt',
    ]) {
      if (!src.includes(n)) failures.push(`arcade kernel missing ${n}`);
    }
  }
  const juice = path.join(
    root,
    'apps',
    'platform-worker',
    'src',
    'juiceBaseline.ts',
  );
  if (!fs.existsSync(juice)) failures.push('missing juiceBaseline.ts');
  else if (
    !fs.readFileSync(juice, 'utf8').includes('restoreJuiceFromBaseline')
  ) {
    failures.push('juiceBaseline missing restoreJuiceFromBaseline');
  }

  const ws = path.join(root, 'apps', 'platform-worker', 'src', 'workspace.ts');
  if (fs.existsSync(ws)) {
    const wsrc = fs.readFileSync(ws, 'utf8');
    if (!wsrc.includes('bossPresent') || !wsrc.includes("setData('boss'")) {
      failures.push('platformer kernel missing Boss intent spawn');
    }
    if (!wsrc.includes('spriteOrRect')) {
      failures.push('platformer kernel missing spriteOrRect (art visibility)');
    }
  }
  const assetPhase = path.join(
    root,
    'apps',
    'platform-worker',
    'src',
    'gameAssetPhase.ts',
  );
  if (fs.existsSync(assetPhase)) {
    const a = fs.readFileSync(assetPhase, 'utf8');
    if (!a.includes('persistChatReferenceImages')) {
      failures.push('missing persistChatReferenceImages');
    }
    if (!a.includes('subjectReferenceImageFile') && !a.includes('subject_reference')) {
      failures.push('asset phase missing subject_reference wiring');
    }
  }
  const fp = path.join(
    root,
    'apps',
    'platform-worker',
    'src',
    'assetFingerprint.ts',
  );
  if (!fs.existsSync(fp)) failures.push('missing assetFingerprint.ts');
  const cp = path.join(root, 'apps', 'platform-worker', 'src', 'changePlan.ts');
  if (fs.existsSync(cp)) {
    const c = fs.readFileSync(cp, 'utf8');
    if (!c.includes('ensureChangePlanSceneContracts')) {
      failures.push('missing ensureChangePlanSceneContracts');
    }
  }
  const recovery = path.join(
    root,
    'apps',
    'platform-worker',
    'src',
    'jobRecovery.ts',
  );
  if (!fs.existsSync(recovery)) failures.push('missing jobRecovery.ts');

  scorecard.automated.contracts = { ok: failures.length === 0, failures };
  scorecard.automated.ok = multiturnOk && failures.length === 0;
  scorecard.generatedAt = new Date().toISOString();

  const outDir = path.join(root, 'docs', 'platform');
  const outFile = path.join(outDir, 'blind-scorecard-latest.json');
  fs.writeFileSync(outFile, JSON.stringify(scorecard, null, 2), 'utf8');

  console.log(JSON.stringify(scorecard, null, 2));
  console.log(`\nWrote ${outFile}`);
  console.log(
    '\nHuman: fill humanChecklist after running the live 三连 against a preview.',
  );
  process.exit(scorecard.automated.ok ? 0 : 1);
}

main();
