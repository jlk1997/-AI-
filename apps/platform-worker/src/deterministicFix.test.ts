/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseTscDiagnostics,
  runDeterministicFix,
} from './deterministicFix.js';

function workspaceWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-dfix-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  return dir;
}

describe('parseTscDiagnostics', () => {
  it('parses file/line/column/code from non-pretty tsc output', () => {
    const out = [
      'src/scenes/BattleScene.ts(12,5): error TS2531: Object is possibly \'null\'.',
      'src/main.ts(3,1): error TS2554: Expected 2 arguments, but got 1.',
      'random noise line',
    ].join('\n');
    const diags = parseTscDiagnostics(out);
    expect(diags).toHaveLength(2);
    expect(diags[0]).toMatchObject({
      file: 'src/scenes/BattleScene.ts',
      line: 12,
      column: 5,
      code: 'TS2531',
    });
    expect(diags[1]?.code).toBe('TS2554');
  });
});

describe('runDeterministicFix', () => {
  it('fixes Phaser lineStyle arity (TS2554)', async () => {
    const dir = workspaceWith({
      'src/scenes/BattleScene.ts': [
        'export class BattleScene {',
        '  draw(g: { lineStyle: (w: number, c: number) => void }) {',
        '    g.lineStyle(0xff0000);',
        '  }',
        '}',
      ].join('\n'),
    });
    const res = await runDeterministicFix(
      dir,
      "src/scenes/BattleScene.ts(3,7): error TS2554: Expected 2-3 arguments, but got 1.",
    );
    expect(res.ok).toBe(true);
    const src = fs.readFileSync(
      path.join(dir, 'src/scenes/BattleScene.ts'),
      'utf8',
    );
    expect(src).toContain('g.lineStyle(2, 0xff0000);');
  });

  it('rewrites optional-chain assignment (TS2779)', async () => {
    const dir = workspaceWith({
      'src/scenes/PlayScene.ts': [
        'export function wire(self: any) {',
        '  self.body?.checkCollision.down = true;',
        '}',
      ].join('\n'),
    });
    const res = await runDeterministicFix(
      dir,
      'src/scenes/PlayScene.ts(2,3): error TS2779: The left-hand side of an assignment expression may not be an optional property access.',
    );
    expect(res.ok).toBe(true);
    const src = fs.readFileSync(path.join(dir, 'src/scenes/PlayScene.ts'), 'utf8');
    expect(src).toContain('self.body!.checkCollision.down =');
    expect(src).not.toContain('?.checkCollision.down =');
  });

  it('bangs the expression tsc names in TS18047', async () => {
    const dir = workspaceWith({
      'src/scenes/PlayScene.ts': [
        'export function step(self: any) {',
        '  self.player.setVelocityX(100);',
        '}',
      ].join('\n'),
    });
    const res = await runDeterministicFix(
      dir,
      "src/scenes/PlayScene.ts(2,3): error TS18047: 'self.player' is possibly 'null'.",
    );
    expect(res.ok).toBe(true);
    const src = fs.readFileSync(path.join(dir, 'src/scenes/PlayScene.ts'), 'utf8');
    expect(src).toContain('self.player!.setVelocityX(100);');
  });

  it('recovers the receiver for anonymous TS2531 diagnostics', async () => {
    const dir = workspaceWith({
      'src/scenes/PlayScene.ts': [
        'export function step(self: any) {',
        '  self.body.velocity.x = 1;',
        '}',
      ].join('\n'),
    });
    const res = await runDeterministicFix(
      dir,
      "src/scenes/PlayScene.ts(2,3): error TS2531: Object is possibly 'null'.",
    );
    expect(res.ok).toBe(true);
    const src = fs.readFileSync(path.join(dir, 'src/scenes/PlayScene.ts'), 'utf8');
    expect(src).toContain('self.body.velocity!.x = 1;');
  });

  it('completes Vector2Like literals (TS2741)', async () => {
    const dir = workspaceWith({
      'src/scenes/PlayScene.ts': [
        'export const origin = { y: 10 };',
      ].join('\n'),
    });
    const res = await runDeterministicFix(
      dir,
      "src/scenes/PlayScene.ts(1,22): error TS2741: Property 'x' is missing in type '{ y: number; }' but required in type 'Vector2Like'.",
    );
    expect(res.ok).toBe(true);
    const src = fs.readFileSync(path.join(dir, 'src/scenes/PlayScene.ts'), 'utf8');
    expect(src).toContain('{ x: 0, y: 10 }');
  });

  it('refuses to touch files outside src/', async () => {
    const dir = workspaceWith({ 'vite.config.ts': 'export default {};' });
    const res = await runDeterministicFix(
      dir,
      "vite.config.ts(1,1): error TS2531: Object is possibly 'null'.",
    );
    expect(res.ok).toBe(false);
    expect(res.skipped.join(' ')).toContain('outside src');
  });

  it('reports no-op when nothing matches a rule', async () => {
    const dir = workspaceWith({ 'src/main.ts': 'export const a = 1;' });
    const res = await runDeterministicFix(
      dir,
      "src/main.ts(1,1): error TS9999: some unknown thing.",
    );
    expect(res.ok).toBe(false);
    expect(res.files).toHaveLength(0);
  });
});
