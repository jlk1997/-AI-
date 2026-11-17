/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { summarizeWorkspaceGame, workspaceHasPlayableGame, prepareWorkspaceForReset } from './workspaceContext.js';

describe('workspaceContext', () => {
  it('detects missing game.json', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-ws-'));
    const summary = await summarizeWorkspaceGame(dir);
    expect(summary.hasExistingGame).toBe(false);
    expect(workspaceHasPlayableGame(dir)).toBe(false);
  });

  it('summarizes existing game.json', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-ws-'));
    const publicDir = path.join(dir, 'public');
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(
      path.join(publicDir, 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'Test Snake' },
        scenes: [{ id: 'main', entities: [{ id: 'player', sprite: { x: 0, y: 0 } }] }],
        skills: [{ id: 'eat', trigger: { kind: 'onTick' }, effects: [{ kind: 'addScore' }] }],
      }),
      'utf8',
    );
    const summary = await summarizeWorkspaceGame(dir);
    expect(summary.hasExistingGame).toBe(true);
    expect(summary.title).toBe('Test Snake');
    expect(summary.sceneIds).toContain('main');
    expect(summary.entityIds).toContain('player');
    expect(workspaceHasPlayableGame(dir)).toBe(true);
  });

  it('prepareWorkspaceForReset clears playable markers', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-ws-reset-'));
    const publicDir = path.join(dir, 'public');
    const scenesDir = path.join(dir, 'src', 'scenes');
    fs.mkdirSync(publicDir, { recursive: true });
    fs.mkdirSync(scenesDir, { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'game.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(dir, 'GAME_DESIGN.md'), '# gdd', 'utf8');
    fs.writeFileSync(path.join(scenesDir, 'MainScene.ts'), 'export {}', 'utf8');
    expect(workspaceHasPlayableGame(dir)).toBe(true);
    const wiped = await prepareWorkspaceForReset(dir);
    expect(workspaceHasPlayableGame(dir)).toBe(false);
    expect(wiped.removed.some((r) => r.includes('game.json'))).toBe(true);
    expect(fs.existsSync(path.join(publicDir, 'RESET_STAMP.json'))).toBe(true);
  });
});
