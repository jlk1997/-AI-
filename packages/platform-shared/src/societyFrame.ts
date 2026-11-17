/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * One live town, one Redis channel, one cached tip frame.
 */

export const SOCIETY_LATEST_FRAME_TTL_SEC = 15 * 60;

export function societyChannel(worldId: string): string {
  return `society:${worldId}`;
}

export function societyLatestFrameKey(worldId: string): string {
  return `society:latest:${worldId}`;
}

export function worldIdFromSocietyChannel(channel: string): string | null {
  if (!channel.startsWith('society:') || channel.startsWith('society:latest:')) {
    return null;
  }
  const id = channel.slice('society:'.length);
  return id || null;
}
