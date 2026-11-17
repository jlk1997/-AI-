/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Modality,
  MissingProviderConfigError,
  resolveProviderConfig,
} from '@opengame/opengame-core';

/**
 * Optional early validation so long-running OpenGame jobs fail fast with the
 * same actionable errors as the CLI (see `resolveProviderConfig` in core).
 *
 * `PLATFORM_OPENGAME_PROVIDER_PREFLIGHT`:
 * - unset / `off`: skip
 * - `all`: resolve reasoning, image, video, audio (matches a fully configured agent run)
 * - `minimax`: resolve only modalities whose `OPENGAME_<MOD>_PROVIDER` is `minimax`
 */
export function runOpenGameProviderPreflightIfConfigured(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const mode = env['PLATFORM_OPENGAME_PROVIDER_PREFLIGHT']?.trim().toLowerCase();
  if (!mode || mode === 'off' || mode === 'false') {
    return;
  }
  const modalities: Modality[] = ['reasoning', 'image', 'video', 'audio'];
  if (mode === 'all') {
    for (const m of modalities) {
      resolveProviderConfig(m, undefined, env);
    }
    return;
  }
  if (mode === 'minimax') {
    for (const m of modalities) {
      const prov =
        env[`OPENGAME_${m.toUpperCase()}_PROVIDER`]?.trim().toLowerCase();
      if (prov === 'minimax') {
        resolveProviderConfig(m, undefined, env);
      }
    }
    return;
  }
  throw new Error(
    `Invalid PLATFORM_OPENGAME_PROVIDER_PREFLIGHT="${mode}". Use off | all | minimax.`,
  );
}

export function formatProviderPreflightError(err: unknown): string {
  if (err instanceof MissingProviderConfigError) {
    return `${err.message}\n(modality=${err.modality})`;
  }
  return err instanceof Error ? err.message : String(err);
}
