#!/usr/bin/env node
/**
 * Lightweight quality regression harness (no LLM).
 * Usage: node scripts/quality-eval-smoke.mjs
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

async function loadBuilt(pkg, file) {
  const dist = path.join(root, 'packages', pkg, 'dist', file);
  try {
    return await import(pathToFileURL(dist).href);
  } catch {
    return require(path.join(root, 'packages', pkg, 'dist', file));
  }
}

const failures = [];

function assertScaffoldContains(rel, needles, label) {
  const full = path.join(root, 'packages', 'world-runtime', rel);
  if (!fs.existsSync(full)) {
    failures.push(`missing scaffold file: ${rel}`);
    return;
  }
  const src = fs.readFileSync(full, 'utf8');
  for (const n of needles) {
    if (!src.includes(n)) failures.push(`${label}: missing ${n}`);
  }
}

async function main() {
  const spec = await loadBuilt('world-spec', 'index.js');
  const sim = await loadBuilt('world-sim', 'index.js');
  const planner = await loadBuilt('world-planner', 'index.js');

  const town = spec.createEmptyTownWorld({ title: 'EvalTown' });
  if (town.space.regions.length < 3) {
    failures.push('town template regions < 3');
  }
  if (town.narrative.quests.length < 2) {
    failures.push('town template quests < 2');
  }

  const depth = planner.ensureWorldDepth(town);
  if (depth.after.regions < 3 || depth.after.quests < 2) {
    failures.push('ensureWorldDepth failed to meet minima');
  }

  const probe = sim.probeWorldPlayability(depth.world);
  if (!probe.ok) {
    failures.push(...(probe.issues.length ? probe.issues : ['playability probe failed']));
  }
  if (
    probe.startedQuestIds.length + probe.completedQuestIds.length === 0 &&
    probe.issues.some((i) => i.includes('仿真探测'))
  ) {
    failures.push('playability probe: no quest progress');
  }

  if (typeof spec.isPlayableSpatialUrl !== 'function') {
    failures.push('isPlayableSpatialUrl not exported');
  } else {
    if (spec.isPlayableSpatialUrl('data:application/json,{}')) {
      failures.push('JSON data URI must not be playable');
    }
    if (!spec.isPlayableSpatialUrl('data:image/png;base64,xx')) {
      failures.push('PNG data URI should be playable');
    }
    if (!spec.isPlayableSpatialUrl('./spatial/start.mp4')) {
      failures.push('mp4 path should be playable');
    }
  }

  const l3World = spec.createEmptyTownWorld({ title: 'L3Eval' });
  l3World.presentation.cinematicEnabled = true;
  l3World.presentation.spatialAssets = {
    [l3World.space.startRegionId]: {
      backend: 'lingbot',
      assetUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    },
  };
  const l3 = spec.toL3PresentationManifest(l3World);
  if (l3.clipCount < 1) {
    failures.push('toL3PresentationManifest clipCount should count playable posters');
  }

  // Presenter source contracts (Phase-4/5)
  assertScaffoldContains(
    'scaffold/src/scenes/TitleScene.ts',
    ['assetUrl', 'isPlayableMedia', 'createElement(\'img\')'],
    'TitleScene',
  );
  assertScaffoldContains(
    'scaffold/src/scenes/WorldExploreScene.ts',
    ['ASSET_BRIEF', 'loadAssetBriefTextures'],
    'WorldExploreScene',
  );
  assertScaffoldContains(
    'scaffold/src/engine/CinematicLayer.ts',
    ['hasStaticSpec', 'preferStaticSpec'],
    'CinematicLayer',
  );
  assertScaffoldContains(
    'scaffold-three/src/main.ts',
    ['ASSET_BRIEF', 'loadAssetBrief', 'mountL3Poster'],
    'three3d',
  );

  // TD / Battle kernels must use module APIs (eval-set alignment)
  const workspaceKernels = path.join(
    root,
    'apps',
    'platform-worker',
    'src',
    'workspace.ts',
  );
  if (fs.existsSync(workspaceKernels)) {
    const ks = fs.readFileSync(workspaceKernels, 'utf8');
    if (!ks.includes('WaveManager') || !ks.includes('EconomyManager')) {
      failures.push('TD kernel missing WaveManager/EconomyManager');
    }
    if (!ks.includes("from '@opengame/module-combat'") || !ks.includes('TurnManager')) {
      failures.push('Battle kernel missing TurnManager');
    }
  if (!ks.includes('PlatformSceneHelper') || !ks.includes("@opengame/module-platform")) {
    failures.push('platformer kernel missing PlatformSceneHelper');
  }
  if (!ks.includes('WorldSceneHelper') || !ks.includes("@opengame/module-world")) {
    failures.push('top_down kernel missing WorldSceneHelper');
  }
  if (!ks.includes('DialogueManager') || !ks.includes("@opengame/module-dialogue")) {
    failures.push('Chapter kernel missing DialogueManager');
  }
  const gateSrc = fs.readFileSync(path.join(root, 'apps', 'platform-worker', 'src', 'gameQualityGate.ts'), 'utf8');
  if (!gateSrc.includes('winAt')) {
    failures.push('MINIMAL_SKILLS / gate missing winAt win signal');
  }
  const effects = fs.readFileSync(path.join(root, 'packages', 'runtime', 'src', 'skills', 'defaultSkillEffects.ts'), 'utf8');
  if (!effects.includes('winAt')) {
    failures.push('defaultSkillEffects missing addScore winAt');
  }
  const loaderSrc = fs.readFileSync(
    path.join(root, 'packages', 'runtime', 'src', 'dsl', 'loader.ts'),
    'utf8',
  );
  if (!loaderSrc.includes('handleSkillWin') || !loaderSrc.includes('og:win')) {
    failures.push('runtime loader missing og:win → Victory/overlay handler');
  }
  if (!effects.includes("emit('og:score'") && !effects.includes('og:score')) {
    failures.push('defaultSkillEffects missing og:score emit');
  }


  }

  // Sidecar mock must expose PNG poster helper
  const sidecar = path.join(root, 'services', 'lingbot-sidecar', 'app.py');
  if (fs.existsSync(sidecar)) {
    const py = fs.readFileSync(sidecar, 'utf8');
    if (!py.includes('def _png_frame')) {
      failures.push('sidecar missing _png_frame');
    }
    if (!py.includes('presentationMock')) {
      failures.push('sidecar missing presentationMock honesty flag');
    }
  }

  // finish-when-ready should read .env (not only hardcoded paths)
  const finishPs1 = path.join(
    root,
    'services',
    'lingbot-sidecar',
    'finish-when-ready.ps1',
  );
  if (fs.existsSync(finishPs1)) {
    const ps = fs.readFileSync(finishPs1, 'utf8');
    if (!ps.includes('LINGBOT_CKPT_DIR') || !ps.includes('PSScriptRoot')) {
      failures.push('finish-when-ready.ps1 should resolve paths from .env / PSScriptRoot');
    }
  }

  // Phase-24/26: multi-turn ChangePlan fixtures (no LLM)
  const changePlanSrc = path.join(
    root,
    'apps',
    'platform-worker',
    'src',
    'changePlan.ts',
  );
  if (!fs.existsSync(changePlanSrc)) {
    failures.push('missing apps/platform-worker/src/changePlan.ts');
  } else {
    const cps = fs.readFileSync(changePlanSrc, 'utf8');
    for (const needle of [
      'opengame-change-plan-v1',
      'parseChangePlan',
      'addBoss',
      'forceAssetRegen',
      'applyChangePlanToGdd',
    ]) {
      if (!cps.includes(needle)) {
        failures.push(`changePlan.ts missing ${needle}`);
      }
    }
  }
  try {
    const distCp = path.join(
      root,
      'apps',
      'platform-worker',
      'dist',
      'changePlan.js',
    );
    if (fs.existsSync(distCp)) {
      const cp = await import(pathToFileURL(distCp).href);
      const boss = cp.parseChangePlan({
        userPrompt: '更难一点，加一个 Boss',
        intent: 'iterate',
      });
      if (!boss.addBoss || boss.difficulty !== 'harder') {
        failures.push('ChangePlan fixture: harder+Boss not parsed');
      }
      const style = cp.parseChangePlan({
        userPrompt: '画风换成赛博朋克',
        intent: 'iterate',
      });
      if (!style.artStyle || !/cyberpunk|赛博/i.test(style.artStyle)) {
        failures.push('ChangePlan fixture: cyberpunk artStyle not parsed');
      }
      if (!style.forceAssetRegen) {
        failures.push('ChangePlan fixture: artStyle should forceAssetRegen');
      }
      const scene = cp.parseChangePlan({
        userPrompt: '再加一关',
        intent: 'iterate',
      });
      if (!scene.addScene) {
        failures.push('ChangePlan fixture: addScene not parsed');
      }
    } else {
      // Source contract already checked; dist optional until worker build
      const gateSrc = fs.readFileSync(
        path.join(root, 'apps', 'platform-worker', 'src', 'gameQualityGate.ts'),
        'utf8',
      );
      if (!gateSrc.includes('ChangePlan addBoss')) {
        failures.push('gameQualityGate missing ChangePlan addBoss intent gate');
      }
      if (!gateSrc.includes('ChangePlan harder')) {
        failures.push('gameQualityGate missing ChangePlan harder intent gate');
      }
    }
  } catch (e) {
    failures.push(
      `ChangePlan eval import failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const smokeSrc = fs.readFileSync(
    path.join(root, 'apps', 'platform-worker', 'src', 'playabilitySmoke.ts'),
    'utf8',
  );
  if (!smokeSrc.includes('collectChangePlanSmokeIssues')) {
    failures.push('playabilitySmoke missing ChangePlan smoke probes');
  }
  if (!smokeSrc.includes('ARCADE_KERNEL.json')) {
    failures.push('playabilitySmoke should require progress for arcade kernels');
  }
  const arcadeSrc = fs.readFileSync(
    path.join(root, 'apps', 'platform-worker', 'src', 'gridArcadeKernels.ts'),
    'utf8',
  );
  if (!arcadeSrc.includes('preloadGameArt')) {
    failures.push('arcade kernels missing preloadGameArt (MiniMax pack)');
  }
  const modPlat = fs.readFileSync(
    path.join(root, 'packages', 'module-platform', 'src', 'index.ts'),
    'utf8',
  );
  if (!modPlat.includes('preloadGameArt')) {
    failures.push('module-platform missing preloadGameArt');
  }
  if (!modPlat.includes("og_player") || !modPlat.includes('spriteOrRect')) {
    failures.push('module-platform should alias og_* + expose spriteOrRect');
  }
  const wsSrc = fs.readFileSync(
    path.join(root, 'apps', 'platform-worker', 'src', 'workspace.ts'),
    'utf8',
  );
  if (!wsSrc.includes('bossPresent') || !wsSrc.includes("setData('boss'")) {
    failures.push('platformer Level kernel missing Boss spawn from registry');
  }
  if (!smokeSrc.includes('setData')) {
    failures.push('playabilitySmoke should require Boss spawn path for addBoss');
  }
  const assetPhaseSrc = fs.readFileSync(
    path.join(root, 'apps', 'platform-worker', 'src', 'gameAssetPhase.ts'),
    'utf8',
  );
  if (!assetPhaseSrc.includes('persistChatReferenceImages')) {
    failures.push('gameAssetPhase missing persistChatReferenceImages');
  }
  const worldSrc = fs.readFileSync(
    path.join(root, 'apps', 'platform-worker', 'src', 'worldPipeline.ts'),
    'utf8',
  );
  if (!worldSrc.includes('regionIdsMissingSpatial')) {
    failures.push('worldPipeline missing regionIdsMissingSpatial (pad poster sync)');
  }
  const fpSrc = fs.readFileSync(
    path.join(root, 'apps', 'platform-worker', 'src', 'assetFingerprint.ts'),
    'utf8',
  );
  if (!fpSrc.includes('issuesFromArtStyleFingerprint')) {
    failures.push('missing assetFingerprint artStyle gate');
  }
  const mmSrc = fs.readFileSync(
    path.join(root, 'apps', 'platform-worker', 'src', 'minimaxClient.ts'),
    'utf8',
  );
  if (!mmSrc.includes('subject_reference')) {
    failures.push('minimaxClient missing subject_reference multimodal');
  }
  if (!mmSrc.includes('arkGenerateImagePng') || !mmSrc.includes('takeProviderFailoverNotes')) {
    failures.push('minimaxClient missing Ark image failover / failover notes');
  }
  if (!mmSrc.includes('tryMinimaxGenerateMusicMp3')) {
    failures.push('minimaxClient missing audio soft-skip helpers');
  }
  const arkSrcPath = path.join(
    root,
    'apps',
    'platform-worker',
    'src',
    'arkImageClient.ts',
  );
  if (!fs.existsSync(arkSrcPath)) {
    failures.push('missing arkImageClient.ts');
  } else {
    const arkSrc = fs.readFileSync(arkSrcPath, 'utf8');
    if (!arkSrc.includes('OPENGAME_FALLBACK_API_KEY') || !arkSrc.includes('/images/generations')) {
      failures.push('arkImageClient missing OPENGAME_FALLBACK / images/generations');
    }
    if (!arkSrc.includes('ensurePngBuffer') || !arkSrc.includes('sharp')) {
      failures.push('arkImageClient must convert Seedream JPEG→PNG via sharp');
    }
    if (
      !arkSrc.includes('seedreamSupportsOutputFormat') ||
      !arkSrc.includes('buildArkImageRequestBody')
    ) {
      failures.push('arkImageClient must gate output_format by Seedream major version');
    }
  }
  if (!assetPhaseSrc.includes('failoverEvents') || !assetPhaseSrc.includes('mixed-failover')) {
    failures.push('gameAssetPhase missing failoverEvents / mixed-failover quality');
  }
  if (!assetPhaseSrc.includes('loadAudioQuotaSeed') || !assetPhaseSrc.includes('quota-seed')) {
    failures.push('gameAssetPhase missing audio quota seed pack fallback');
  }
  const audioSeedDir = path.join(
    root,
    'apps',
    'platform-worker',
    'assets',
    'audio-quota-seed',
  );
  for (const f of ['bgm.mp3', 'sfx_win.mp3', 'sfx_lose.mp3']) {
    if (!fs.existsSync(path.join(audioSeedDir, f))) {
      failures.push(`missing audio quota seed ${f}`);
    }
  }
  const coreProv = path.join(
    root,
    'packages',
    'core',
    'src',
    'services',
    'providerConfig.ts',
  );
  if (fs.existsSync(coreProv)) {
    const pSrc = fs.readFileSync(coreProv, 'utf8');
    if (!pSrc.includes('withProviderFailover') || !pSrc.includes('OPENGAME_FALLBACK')) {
      failures.push('providerConfig missing withProviderFailover / OPENGAME_FALLBACK');
    }
  }
  if (!wsSrc.includes("setData('boss'") || !wsSrc.includes('wantBoss')) {
    failures.push('kernels should honor wantBoss / setData(boss) across archetypes');
  }
  const wqSrc = fs.readFileSync(
    path.join(root, 'apps', 'platform-worker', 'src', 'worldQualityGate.ts'),
    'utf8',
  );
  if (!wqSrc.includes('padded') || !wqSrc.includes('mustCheck')) {
    failures.push('worldQualityGate should check padded/all small-world regions');
  }
  const labSrc = fs.readFileSync(
    path.join(
      root,
      'apps',
      'platform-web',
      'src',
      'components',
      'World',
      'LingBotResearchLab.tsx',
    ),
    'utf8',
  );
  if (!labSrc.includes('presentationMock')) {
    failures.push('LingBotResearchLab missing presentationMock UI honesty');
  }
  if (!labSrc.includes('preview?.videoUrl') && !labSrc.includes('preview.videoUrl')) {
    // clip finish must prefer videoUrl (not mock frameUrl)
    if (!/videoUrl[\s\S]{0,80}finish|!preview\?\.videoUrl/.test(labSrc)) {
      failures.push('LingBotResearchLab should not finish clip step on mock frameUrl alone');
    }
  }
  // Prefer: step finishes only on videoUrl
  if (/frameUrl\s*\?\s*['"]finish['"]/.test(labSrc) || /videoUrl\s*\|\|\s*preview\?\.frameUrl\s*\?\s*['"]finish['"]/.test(labSrc)) {
    failures.push('LingBotResearchLab still finishes clip on frameUrl');
  }
  const procSrc = fs.readFileSync(
    path.join(root, 'apps', 'platform-worker', 'src', 'processJob.ts'),
    'utf8',
  );
  if (!procSrc.includes('ensureChangePlanSceneContracts')) {
    failures.push('processJob should re-apply scene contracts after CODE');
  }
  if (!procSrc.includes('writeJobRecovery') && !procSrc.includes('jobRecovery')) {
    failures.push('processJob missing jobRecovery on ChangePlan abort');
  }
  const recoverySrc = path.join(
    root,
    'apps',
    'platform-worker',
    'src',
    'jobRecovery.ts',
  );
  if (!fs.existsSync(recoverySrc)) {
    failures.push('missing jobRecovery.ts');
  } else if (
    !fs.readFileSync(recoverySrc, 'utf8').includes('suggestedPrompts')
  ) {
    failures.push('jobRecovery missing suggestedPrompts');
  }
  const failText = path.join(
    root,
    'apps',
    'platform-web',
    'src',
    'utils',
    'jobFailureText.ts',
  );
  if (
    fs.existsSync(failText) &&
    !fs.readFileSync(failText, 'utf8').includes('ChangePlan 未落地')
  ) {
    failures.push('jobFailureText should summarize ChangePlan abort recovery');
  }
  if (
    fs.existsSync(failText) &&
    !fs.readFileSync(failText, 'utf8').includes('parseRecoverySuggestedPrompts')
  ) {
    failures.push('jobFailureText missing parseRecoverySuggestedPrompts');
  }
  if (!worldSrc.includes('dirtyRegions')) {
    failures.push('worldPipeline should persist dirtyRegions on edit revisions');
  }
  if (!worldSrc.includes('diffSummary') || !worldSrc.includes('diffWorldSpecs')) {
    failures.push('worldPipeline should persist diffSummary via diffWorldSpecs');
  }
  const schemaSrc = path.join(root, 'packages', 'world-spec', 'src', 'schema.ts');
  if (
    fs.existsSync(schemaSrc) &&
    !fs.readFileSync(schemaSrc, 'utf8').includes('export function diffWorldSpecs')
  ) {
    failures.push('world-spec missing diffWorldSpecs');
  }
  const apiSrc = path.join(root, 'apps', 'platform-api', 'src', 'v1.ts');
  if (
    fs.existsSync(apiSrc) &&
    !fs.readFileSync(apiSrc, 'utf8').includes('/world/revisions/:revision/diff')
  ) {
    failures.push('platform-api missing revision diff endpoint');
  }
  const retryPanel = path.join(
    root,
    'apps',
    'platform-web',
    'src',
    'components',
    'Generation',
    'JobRetryPanel.tsx',
  );
  if (
    fs.existsSync(retryPanel) &&
    !fs.readFileSync(retryPanel, 'utf8').includes('onSendSuggestion')
  ) {
    failures.push('JobRetryPanel missing onSendSuggestion (Phase-35)');
  }
  const juiceSrc = path.join(
    root,
    'apps',
    'platform-worker',
    'src',
    'juiceBaseline.ts',
  );
  if (
    fs.existsSync(juiceSrc) &&
    !fs.readFileSync(juiceSrc, 'utf8').includes('restoreJuiceFromBaseline')
  ) {
    failures.push('juiceBaseline missing restoreJuiceFromBaseline (Phase-36)');
  }
  if (
    !procSrc.includes('restoreJuiceFromBaseline')
  ) {
    failures.push('processJob should call restoreJuiceFromBaseline (Phase-36)');
  }
  if (
    fs.existsSync(schemaSrc) &&
    !fs.readFileSync(schemaSrc, 'utf8').includes('addedEntities')
  ) {
    failures.push('diffWorldSpecs should include entity/rule id lists');
  }
  const worldPanel = path.join(
    root,
    'apps',
    'platform-web',
    'src',
    'components',
    'World',
    'WorldPanel.tsx',
  );
  if (
    fs.existsSync(worldPanel) &&
    !fs.readFileSync(worldPanel, 'utf8').includes('revisionDiff')
  ) {
    failures.push('WorldPanel missing revisionDiff UI');
  }
  if (!procSrc.includes('prepareWorkspaceForReset')) {
    failures.push('processJob missing prepareWorkspaceForReset (reset path)');
  }
  if (!procSrc.includes('fixStrategy')) {
    failures.push('processJob missing explicit FIX fixStrategy');
  }

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        regions: depth.after.regions,
        quests: depth.after.quests,
        probeStarted: probe.startedQuestIds,
        probeCompleted: probe.completedQuestIds,
        l3ClipCount: l3.clipCount,
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
