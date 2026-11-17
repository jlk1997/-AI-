import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { courseBoardModuleHrefs } from './courseSettleLoop.js';

describe('courseBoardModuleHrefs', () => {
  it('points at the API course board next to this worker', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const hrefs = courseBoardModuleHrefs(here);
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.some((href) => href.includes('courseBoard'))).toBe(true);
    expect(hrefs.some((href) => href.includes('platform-api'))).toBe(true);
  });
});
