/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  moduleSpecsForArchetype,
  moduleSpecsForModules,
  shouldRefreshSceneStub,
} from './workspace.js';

describe('shouldRefreshSceneStub', () => {
  it('refreshes when next kernel adds ending_b / questTitle / world layout', () => {
    const existing = `
      this.registry.set('ending_a', true);
      this.scene.start('GameOverScene');
    `;
    const next = `
      const questTitle = 'Meet Guide';
      this.registry.set('ending_b', true);
      resolveWorldLayoutsBySceneId
      worldRegionId
      __ogNpcPos
      bg_region_
      chapterOpenerOnly
      regionBgKey
      playRegionBgm
      leaveChapter
      Skip · S
      endings?
      this.wasd
      resolvePortalHop
      worldStartRegionId
      layoutOnly
      isEngineShellId
      wordWrap: true,
    `;
    expect(shouldRefreshSceneStub(existing, next)).toBe(true);
  });

  it('keeps matching uplifted stubs', () => {
    const body = `
      GameUiKit.addDialoguePanel(this);
      ContentDirector;
      STORY_BIBLE;
      ending_b;
      questTitle;
      resolveWorldLayoutFromGame;
      og_game;
      wordWrap: true,
    `;
    expect(shouldRefreshSceneStub(body, body)).toBe(false);
  });
});

describe('moduleSpecsForModules', () => {
  it('injects module-board when the spec asks for board, not by archetype bucket', () => {
    const byBucket = moduleSpecsForArchetype('grid_logic');
    expect(byBucket['@opengame/module-board']).toBeUndefined();
    const composed = moduleSpecsForModules(['platform', 'board', 'dialogue']);
    expect(composed['@opengame/module-board']).toMatch(/module-board/);
    expect(composed['@opengame/module-dialogue']).toMatch(/module-dialogue/);
    expect(composed['@opengame/module-platform']).toBeTruthy();
  });

  it('injects cards / emitter / match without inventing a sixth archetype', () => {
    const composed = moduleSpecsForModules(['platform', 'match', 'cards', 'emitter']);
    expect(composed['@opengame/module-board']).toMatch(/module-board/);
    expect(composed['@opengame/module-cards']).toMatch(/module-cards/);
    expect(composed['@opengame/module-emitter']).toMatch(/module-emitter/);
  });
});
