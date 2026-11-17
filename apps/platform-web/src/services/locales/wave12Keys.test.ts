/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { en } from './en';
import { zhCN } from './zh-CN';

const WAVE12_KEYS = [
  'generate.jobs.retried',
  'generate.jobs.alreadyRequeued',
  'generate.jobs.retryFailed',
  'generate.sessions.deleteFailed',
  'generate.project.switchedFailed',
  'generate.project.created',
  'generate.project.createFailed',
  'generate.project.signInRequired',
  'generate.ops.build',
  'generate.ops.buildFailed',
  'generate.collab.title',
  'generate.collab.invite',
  'generate.collab.notFound',
] as const;

describe('wave 12 studio copy', () => {
  it('has en and zh-CN strings for invite, retry, and build', () => {
    for (const key of WAVE12_KEYS) {
      expect(en[key]?.length).toBeGreaterThan(0);
      expect(zhCN[key]?.length).toBeGreaterThan(0);
    }
  });
});
