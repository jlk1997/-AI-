/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AnalyticsEvent {
  readonly name: string;
  readonly props?: Record<string, unknown>;
  readonly ts?: number;
}

/**
 * No-op-friendly analytics tap. Generated games emit play metrics
 * (`level_start`, `level_complete`, `death`, etc.) and the host page wires a
 * sink (post to platform endpoint, console.log during dev, …). Without a
 * sink, events drop on the floor — by design.
 */
export class Analytics {
  private sinks: Array<(e: AnalyticsEvent) => void> = [];

  addSink(sink: (e: AnalyticsEvent) => void): void {
    this.sinks.push(sink);
  }

  track(name: string, props?: Record<string, unknown>): void {
    const e: AnalyticsEvent = { name, props, ts: Date.now() };
    for (const s of this.sinks) {
      try {
        s(e);
      } catch {
        /* never break gameplay for analytics */
      }
    }
  }
}
