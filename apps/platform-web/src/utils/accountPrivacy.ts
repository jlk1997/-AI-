/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Export / close from both the desktop profile and the phone Me page.
 */

import { api } from '../services/api.js';
import { t, translateApiError } from '../services/i18n.js';

export async function downloadAccountExport(): Promise<void> {
  const bundle = await api.auth.exportAccount();
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'gebi-export.json';
  a.click();
  URL.revokeObjectURL(url);
}

export async function closeOwnAccount(): Promise<void> {
  await api.auth.deleteAccount();
}

export function accountPrivacyError(err: unknown): string {
  return translateApiError(err) || t('account.exportFail');
}
