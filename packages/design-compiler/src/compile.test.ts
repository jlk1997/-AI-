/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { compileDesign, validateSystemsContent } from './compile.js';

describe('design-compiler', () => {
  it('compiles gdd + bible into datasets', () => {
    const r = compileDesign({
      gddMarkdown: `# GDD\n## Quests\n- Find ore\n- Slay wolf\n## Items\n- Iron\n`,
      storyBible: {
        npcs: [{ id: 'mayor', name: '村长' }],
        quests: [
          { id: 'q1', title: '打听', requires: [] },
          { id: 'q2', title: '出征', requires: ['q1'] },
        ],
      },
      targetMinutes: 40,
    });
    expect(r.ok).toBe(true);
    expect(r.content.quests.length).toBeGreaterThanOrEqual(2);
    expect(r.systems.economy.items.length).toBeGreaterThan(0);
    expect(r.content.estimatedMinutes).toBeGreaterThanOrEqual(40);
    expect(validateSystemsContent(r.systems, r.content).every((i) => i.level !== 'error')).toBe(
      true,
    );
  });
});
