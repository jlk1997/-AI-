/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createEmptyTownWorld } from '@opengame/world-spec';
import { WorldRuntimeCore, generateWorldPresenterScaffold } from './core.js';
import { resolveSpatialBackend } from './spatial/backends.js';

describe('world-runtime', () => {
  it('moves player via core', () => {
    const core = new WorldRuntimeCore(createEmptyTownWorld());
    const before = core.world.entities.find((e) => e.kind === 'player')!.pos;
    core.movePlayer(1, 0);
    const after = core.world.entities.find((e) => e.kind === 'player')!.pos;
    expect(after.x).toBe(before.x + 1);
  });

  it('scaffolds presenter files', () => {
    const { files, mode } = generateWorldPresenterScaffold({ title: 'Demo' });
    expect(mode).toBe('phaser2d');
    expect(files['src/ui/cameraFit.ts']).toContain('fitTownCamera');
    expect(files['src/ui/characterSprite.ts']).toContain('drawCharacterSheet');
    expect(files['src/ui/placeSprite.ts']).toContain('drawPlaceSprite');
    expect(files['src/ui/placeSprite.ts']).toContain('placeKindFromName');
    expect(files['src/ui/speechSchedule.ts']).toContain('scheduleConversation');
    expect(files['src/scenes/SocietyReplayScene.ts']).toContain('structureLayer');
    expect(files['src/scenes/SocietyReplayScene.ts']).toContain('ensurePlaceTexture');
    expect(files['src/scenes/SocietyReplayScene.ts']).toContain('placeKindFromName');
    expect(files['src/scenes/SocietyReplayScene.ts']).toContain('minimapTerrainFill');
    expect(files['src/scenes/WorldExploreScene.ts']).toContain('drawExploreStructures');
    for (const [rel, content] of Object.entries(files)) {
      if (!rel.endsWith('.ts')) continue;
      for (const match of content.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
        const spec = match[1]!;
        const fromDir = rel.replace(/\/[^/]+$/, '');
        const joined = `${fromDir}/${spec}`.replace(/\/\.\//g, '/');
        const parts: string[] = [];
        for (const part of joined.split('/')) {
          if (part === '..') parts.pop();
          else if (part !== '.') parts.push(part);
        }
        const target = `${parts.join('/')}.ts`;
        expect(files[target], `${rel} imports ${spec}`).toBeTruthy();
      }
    }
    expect(files['src/main.ts']).toContain('TitleScene');
        expect(files['src/scenes/WorldExploreScene.ts']).toContain('WorldGameEngine');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('SocietyReplay');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('opengame-society-append');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('use-object');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('refreshObjects');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('drawGoalMarkers');
        expect(files['src/scenes/SocietyReplayScene.ts']).not.toContain(
          'quadraticCurveTo',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'portrait_gen_',
        );
        // Drawing into a destroyed Graphics blanked the observatory once. The
        // layer is now pooled rather than torn down, so the guard is that the
        // scene re-creates talkArcs whenever it is no longer active.
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          '!this.talkArcs.active',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('ASSET_BRIEF');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('playTalkBlip');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('toggleBgmMute');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'opengame-society-bgm',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).not.toContain(
          "scene.start('WorldExplore')",
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('opengame-society-focus-region');
        expect(files['src/scenes/SocietyReplayScene.ts']).toMatch(
          /switchRegion\([\s\S]*refreshAgents\(true\)/,
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'data.agents?.length',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'mergeReplayAgents',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'opengame-society-pin-agent',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'opengame-society-set-speed',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          "payload['degraded'] === true",
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'isFillerSpeech',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('clockPlaying');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'clockPlaying === true',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('（采访）');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('热闹');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('layoutChrome');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('pinnedAgentId');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'setOrigin(0, 1)',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).not.toContain(
          'this.pinnedAgentId ?? this.selectedId',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('easeSmooth');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('fadeOut');
        expect(files['src/ui/agentChrome.ts']).toContain('agentChromeLift');
        expect(files['src/ui/agentChrome.ts']).toContain('shouldFollowSpeech');
        expect(files['src/ui/agentChrome.ts']).toContain('chromeClusterSlot');
        expect(files['src/ui/agentChrome.ts']).toContain('agentLabelText');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'chromeClusterSlot',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'clusterSize',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'userSteeredCamera',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'followNewSpeech',
        );
        {
          const scene = files['src/scenes/SocietyReplayScene.ts'] ?? '';
          const speech = scene.indexOf('const speech = liveLine || replayLine');
          expect(speech).toBeGreaterThan(-1);
          expect(scene).toContain('Never draw chest action glyphs');
          expect(scene).toContain('gfx.glyph.setVisible(false)');
          expect(scene).toContain('talkArcDepth');
          expect(scene).not.toContain('this.talkArcs.setDepth(10000)');
          expect(scene).toContain('speechLayer');
          expect(scene).toContain('this.speechLayer.setDepth(8000)');
          expect(scene).toContain('bringToTop(this.speechLayer)');
          expect(scene).toContain('speechBubbleBgDepth');
          expect(scene).toContain('shouldHideNameUnderSpeech');
          expect(scene).not.toContain('gfx.bubble.setDepth(depth + 3)');
          expect(scene).toContain('replayOpeningCircles');
          expect(scene).toContain('primeOpeningCircle');
          expect(scene).toContain('fadeChromeForSpeechFollow');
          expect(scene).toContain('preferUniquePortraitFile');
          expect(scene).toContain('Never assign the shared npc.png');
          expect(scene).toContain('minimapDockForFollow');
          expect(scene).toContain('shouldArmCircleStage');
          expect(scene).toContain('speechFocusPoint');
          expect(scene).toContain('regionNavAlpha');
          expect(scene).toContain('lockLiveTip');
          expect(scene).toContain('opengame-society-lock-live');
          expect(scene).toContain('围观中 · 有人看着，镇子自己走');
          expect(scene).toContain('画面已停 · 镇上的钟还在走');
          expect(scene).toContain('this.lockLiveTip = true');
          expect(scene).toContain('this.lockLiveTip && this.playing');
          const spaceHandler = scene.slice(
            scene.indexOf("keydown-SPACE"),
            scene.indexOf("keydown-LEFT"),
          );
          expect(spaceHandler).toContain('if (this.lockLiveTip) return;');
          expect(scene).toContain('this.cursor = newMax');
          const appendHandler = scene.slice(
            scene.indexOf('data.type === MSG_APPEND'),
            scene.indexOf('data.type === MSG_SET_PLAYING'),
          );
          expect(appendHandler).toContain('pinNarrativeEvents');
          expect(appendHandler).not.toContain('slice(-24)');
          expect(appendHandler).not.toContain('slice(-32)');
          const applyReplay = scene.slice(
            scene.indexOf('private applyReplay'),
            scene.indexOf('private appendReplay'),
          );
          expect(applyReplay.indexOf('primeOpeningCircle')).toBeGreaterThan(-1);
          expect(applyReplay.indexOf('primeOpeningCircle')).toBeLessThan(
            applyReplay.indexOf('this.applyCursor(true)'),
          );
          expect(applyReplay).toContain('compareReplayTalkOrder');
          const pin = scene.slice(
            scene.indexOf('private pinLiveSpeech'),
            scene.indexOf('private speechTurnsOf'),
          );
          expect(pin).not.toContain('this.followNewSpeech');
          expect(pin).not.toContain('this.rememberLiveTalkPartners');
          const fire = scene.slice(
            scene.indexOf('private fireSpeechCue'),
            scene.indexOf('private captionFor'),
          );
          expect(fire).toContain('this.followNewSpeech');
          expect(fire).toContain('this.rememberLiveTalkPartners');
        }
        expect(files['src/ui/speechSchedule.ts']).toContain('CIRCLE_GAP_MS');
        expect(files['src/ui/speechSchedule.ts']).toContain('pickCurrentTalkEvent');
        expect(files['src/ui/speechSchedule.ts']).toContain(
          'openingCirclesAtTip',
        );
        expect(files['src/ui/speechSchedule.ts']).toContain(
          'pinNarrativeTalkEvents',
        );
        expect(files['src/ui/speechSchedule.ts']).toContain('shouldArmCircleStage');
        expect(files['src/ui/speechSchedule.ts']).toContain('liveSpeechCaption');
        expect(files['src/ui/agentChrome.ts']).toContain('talkArcDepth');
        expect(files['src/ui/agentChrome.ts']).toContain('preferUniquePortraitFile');
        expect(files['src/ui/agentChrome.ts']).toContain('minimapDockForFollow');
        expect(files['src/ui/agentChrome.ts']).toContain('speechFocusPoint');
        expect(files['src/ui/agentChrome.ts']).toContain('regionNavAlpha');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('keydown-H');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('duskGlow');
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain('第');
        expect(files['src/scenes/SocietyReplayScene.ts']).not.toContain(
          'REGION_LABELS',
        );
        expect(files['src/scenes/SocietyReplayScene.ts']).toContain(
          'genreProfile',
        );
        {
          const scene = files['src/scenes/SocietyReplayScene.ts'] ?? '';
          const decl = scene.indexOf('const speech = liveLine || replayLine');
          const use = scene.indexOf('speech: Boolean(speech)');
          expect(decl).toBeGreaterThan(-1);
          expect(use).toBeGreaterThan(decl);
        }
        expect(files['src/main.ts']).toContain('SocietyReplayScene');
        expect(files['src/main.ts']).toContain('mode');
    expect(files['src/engine/CinematicLayer.ts']).toContain('class CinematicLayer');
    expect(files['src/engine/CinematicLayer.ts']).toContain('showRegion');
    expect(files['src/engine/CinematicLayer.ts']).toContain('lingbot.json');
    expect(files['src/engine/WorldGameEngine.ts']).toContain('class WorldGameEngine');
    expect(files['src/scenes/BattleScene.ts']).toContain('Combat');
    expect(files['src/scenes/WorldExploreScene.ts']).toContain('CinematicLayer');
    expect(files['src/scenes/WorldExploreScene.ts']).toContain('showRegion');
    expect(files['src/scenes/WorldExploreScene.ts']).toContain('ASSET_BRIEF');
    expect(files['src/scenes/WorldExploreScene.ts']).toContain('loadAssetBriefTextures');
    expect(files['src/engine/CinematicLayer.ts']).toContain('hasStaticSpec');
    expect(files['src/engine/CinematicLayer.ts']).toContain('preferStaticSpec');
    expect(files['src/scenes/TitleScene.ts']).toContain('assetUrl');
    expect(files['src/scenes/TitleScene.ts']).toContain('isPlayableMedia');
  });

  it('scaffolds three presenter with ASSET_BRIEF', () => {
    const { files, mode } = generateWorldPresenterScaffold({
      title: 'Demo3D',
      mode: 'three3d',
    });
    expect(mode).toBe('three3d');
    expect(files['src/main.ts']).toContain('THREE');
    expect(files['src/main.ts']).toContain('ASSET_BRIEF');
    expect(files['src/main.ts']).toContain('loadAssetBrief');
    expect(files['src/main.ts']).toContain('mountL3Poster');
  });

  it('resolves spatial backends', async () => {
    const nullBe = resolveSpatialBackend('null');
    const r = await nullBe.generateRegion({
      world: createEmptyTownWorld(),
      regionId: 'town_square',
    });
    expect(r.ok).toBe(true);

    const three = resolveSpatialBackend('three');
    const t = await three.generateRegion({
      world: createEmptyTownWorld(),
      regionId: 'town_square',
    });
    expect(t.assetUrl).toMatch(/^data:/);

    const lingbot = resolveSpatialBackend('lingbot');
    expect(lingbot.id).toBe('lingbot');
  });
});
