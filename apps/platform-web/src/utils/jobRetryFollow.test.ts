/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { ApiError } from '../services/api';
import { followRetryJobId } from './jobRetryFollow';

describe('followRetryJobId', () => {
  it('follows the child job on already-requeued 409', () => {
    expect(
      followRetryJobId(
        new ApiError('already requeued', 'CONFLICT', 409, {
          jobId: '0aecc130-6f5a-470b-89e1-ce6264ead00a',
        }),
      ),
    ).toBe('0aecc130-6f5a-470b-89e1-ce6264ead00a');
  });

  it('ignores a crashed claim or a non-conflict error', () => {
    expect(
      followRetryJobId(
        new ApiError('already requeued', 'CONFLICT', 409, { jobId: 'claiming' }),
      ),
    ).toBeNull();
    expect(
      followRetryJobId(new ApiError('nope', 'INVALID_INPUT', 400)),
    ).toBeNull();
    expect(followRetryJobId(new Error('already requeued'))).toBeNull();
  });
});
