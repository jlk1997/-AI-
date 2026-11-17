/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Worlds cannot ride a raw preview-dist iframe: walking needs the React
 * stage to ping presence. Point third-party embeds at /play instead.
 */

export function publicWorldEmbed(input: {
  readonly category: string;
  readonly slug: string;
  readonly webBaseUrl?: string | null;
}): {
  readonly embedUrl: string | null;
  readonly embedDenied: string | null;
  readonly requiresStage: true;
} | null {
  if (input.category !== 'world') return null;
  const web = input.webBaseUrl?.replace(/\/$/, '');
  if (!web) {
    return {
      embedUrl: null,
      embedDenied: 'world_requires_stage',
      requiresStage: true,
    };
  }
  return {
    embedUrl: `${web}/play/${encodeURIComponent(input.slug)}`,
    embedDenied: null,
    requiresStage: true,
  };
}
