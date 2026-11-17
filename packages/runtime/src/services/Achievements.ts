/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AchievementsOptions {
  readonly deploymentId: string;
  readonly apiBaseUrl?: string;
  readonly token?: string;
}

export interface AwardInput {
  readonly achievementKey: string;
  readonly title: string;
  readonly description?: string;
  readonly iconUrl?: string;
  readonly progress?: number;
}

/**
 * Awards cross-game achievements via the platform API. Idempotent on
 * `(user, deployment, achievementKey)` — games can call `award` from any
 * gameplay hook without dedup logic.
 */
export class AchievementsClient {
  constructor(private readonly opts: AchievementsOptions) {}

  private base(): string {
    return this.opts.apiBaseUrl ?? '/v1';
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token =
      this.opts.token ??
      ((globalThis as { __opengame_token__?: string }).__opengame_token__ ?? '');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  async award(input: AwardInput): Promise<{ ok: boolean; awarded: boolean } | null> {
    if (typeof fetch === 'undefined') return null;
    const res = await fetch(
      `${this.base()}/deployments/${this.opts.deploymentId}/achievements`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(input),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { ok: boolean; awarded: boolean };
    return data;
  }
}
