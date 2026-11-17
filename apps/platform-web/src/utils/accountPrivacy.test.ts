import { describe, expect, it } from 'vitest';

import { ApiError } from '../services/api.js';
import { t } from '../services/i18n.js';
import { accountPrivacyError } from './accountPrivacy.js';

describe('accountPrivacyError', () => {
  it('maps UNAVAILABLE to the localized copy, not the raw API code', () => {
    const text = accountPrivacyError(
      new ApiError('down', 'UNAVAILABLE', 503),
    );
    expect(text).toBe(t('error.unavailable'));
    expect(text).not.toBe('UNAVAILABLE');
  });
});
