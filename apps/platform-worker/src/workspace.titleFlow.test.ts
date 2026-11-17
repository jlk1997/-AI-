/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { pickTitleNextScene } from './workspace.js';

describe('pickTitleNextScene narrative beat', () => {
  const stubs = [
    {
      file: 'TitleScene.ts',
      className: 'TitleScene',
      sceneKey: 'TitleScene',
      hint: 'title',
    },
    {
      file: 'ChapterScene.ts',
      className: 'ChapterScene',
      sceneKey: 'ChapterScene',
      hint: 'chapter',
    },
    {
      file: 'WorldScene.ts',
      className: 'WorldScene',
      sceneKey: 'WorldScene',
      hint: 'world',
    },
    {
      file: 'GameOverScene.ts',
      className: 'GameOverScene',
      sceneKey: 'GameOverScene',
      hint: 'ending',
    },
  ];

  it('top_down Title goes to Chapter opener first', () => {
    expect(pickTitleNextScene('top_down', stubs, 'TitleScene')).toBe(
      'ChapterScene',
    );
  });

  it('ui_heavy Title goes to Chapter', () => {
    expect(pickTitleNextScene('ui_heavy', stubs, 'TitleScene')).toBe(
      'ChapterScene',
    );
  });

  it('top_down without Chapter falls back to World', () => {
    const noChapter = stubs.filter((s) => s.sceneKey !== 'ChapterScene');
    expect(pickTitleNextScene('top_down', noChapter, 'TitleScene')).toBe(
      'WorldScene',
    );
  });
});
