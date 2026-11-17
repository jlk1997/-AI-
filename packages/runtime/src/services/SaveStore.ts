/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Persists per-player save slots for a deployment. By default this uses
 * `localStorage`; when wired to a platform deployment, the runtime injects an
 * HTTP adapter so saves sync to the `player_saves` table via the BFF.
 *
 * Surface is intentionally tiny: get / set / remove / list. Generated games
 * should not care whether storage is local or remote.
 */
export interface SaveAdapter {
  load(slot: string): Promise<unknown | null>;
  save(slot: string, value: unknown): Promise<void>;
  remove(slot: string): Promise<void>;
  list(): Promise<string[]>;
}

class LocalStorageAdapter implements SaveAdapter {
  constructor(private readonly namespace: string) {}

  private prefix(slot: string): string {
    return `${this.namespace}:${slot}`;
  }

  async load(slot: string): Promise<unknown | null> {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(this.prefix(slot));
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async save(slot: string, value: unknown): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(this.prefix(slot), JSON.stringify(value));
  }

  async remove(slot: string): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(this.prefix(slot));
  }

  async list(): Promise<string[]> {
    if (typeof localStorage === 'undefined') return [];
    const out: string[] = [];
    const ns = `${this.namespace}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(ns)) out.push(key.slice(ns.length));
    }
    return out;
  }
}

export interface RemoteAdapterOptions {
  readonly deploymentId: string;
  readonly apiBaseUrl?: string;
  /** Bearer token; required for non-anonymous saves. */
  readonly token?: string;
}

/**
 * Cloud SaveAdapter backed by the platform's `/deployments/:id/saves/:slot`
 * endpoints. We deliberately keep auth minimal — the platform-web app injects
 * its session token via `window.__opengame_token__` so generated games don't
 * have to know about it.
 */
class PlatformAdapter implements SaveAdapter {
  constructor(private readonly opts: RemoteAdapterOptions) {}

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

  async load(slot: string): Promise<unknown | null> {
    if (typeof fetch === 'undefined') return null;
    const res = await fetch(
      `${this.base()}/deployments/${this.opts.deploymentId}/saves/${encodeURIComponent(slot)}`,
      { headers: this.headers() },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { payload?: unknown; found?: boolean };
    return data.found ? (data.payload ?? null) : null;
  }

  async save(slot: string, value: unknown): Promise<void> {
    if (typeof fetch === 'undefined') return;
    await fetch(
      `${this.base()}/deployments/${this.opts.deploymentId}/saves/${encodeURIComponent(slot)}`,
      {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({ payload: value }),
      },
    );
  }

  async remove(slot: string): Promise<void> {
    if (typeof fetch === 'undefined') return;
    await fetch(
      `${this.base()}/deployments/${this.opts.deploymentId}/saves/${encodeURIComponent(slot)}`,
      { method: 'DELETE', headers: this.headers() },
    );
  }

  async list(): Promise<string[]> {
    // The platform doesn't yet expose a list endpoint for a single deployment.
    // Games that need this should fall back to LocalStorageAdapter or
    // maintain an index file via `save('__slots__', [...])`.
    return [];
  }
}

export class SaveStore {
  private readonly adapter: SaveAdapter;

  constructor(adapter?: SaveAdapter, namespace = 'opengame:save') {
    this.adapter = adapter ?? new LocalStorageAdapter(namespace);
  }

  load<T>(slot = 'default'): Promise<T | null> {
    return this.adapter.load(slot) as Promise<T | null>;
  }

  save<T>(value: T, slot = 'default'): Promise<void> {
    return this.adapter.save(slot, value);
  }

  remove(slot = 'default'): Promise<void> {
    return this.adapter.remove(slot);
  }

  list(): Promise<string[]> {
    return this.adapter.list();
  }

  /** Convenience factory for cloud saves. */
  static remote(opts: RemoteAdapterOptions): SaveStore {
    return new SaveStore(new PlatformAdapter(opts));
  }
}
