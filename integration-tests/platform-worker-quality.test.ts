/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { buildEnhancedPrompt } from '../apps/platform-worker/src/promptContracts.js';
import { runGameQualityGate } from '../apps/platform-worker/src/gameQualityGate.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('platform worker quality integration', () => {
  it('uses iteration contract when isIteration=true', () => {
    const prompt = buildEnhancedPrompt({
      basePrompt: '把蛇变长',
      isIteration: true,
      workspaceSummary: {
        hasExistingGame: true,
        gameJsonPath: 'public/game.json',
        title: 'Snake',
        sceneIds: ['main'],
        entityCount: 3,
        assetCount: 0,
        skillCount: 1,
        hasCustomModules: false,
        srcFiles: ['src/main.ts'],
        summaryText: '标题: Snake',
      },
    });
    expect(prompt).toContain('增量迭代');
    expect(prompt).not.toContain('首次生成');
  });

  it('rejects trivial movement-only games in QA gate', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-int-'));
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'public', 'game.json'),
      JSON.stringify({
        dslVersion: '1.0.0',
        meta: { title: 'Stub' },
        scenes: [
          {
            id: 'main',
            entities: [
              {
                id: 'box',
                sprite: { x: 0, y: 0 },
                behaviors: [{ kind: 'eightWayMovement' }],
              },
            ],
          },
        ],
      }),
      'utf8',
    );
    fs.writeFileSync(path.join(dir, 'src', 'main.ts'), '// entry\n', 'utf8');
    const q = await runGameQualityGate(dir, 'relaxed');
    expect(q.ok).toBe(false);
  });
});
