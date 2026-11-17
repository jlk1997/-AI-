/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Probe the hosted town bundle. 404 right after job.success is a wait,
 * not a failed world. Lease attempts survive URL re-signs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { previewDeploymentIdentity } from '../utils/previewUrlStability';
import {
  PREVIEW_PROBE_RETRY_MS,
  PREVIEW_SETTLE_MS,
  asPreviewReason,
  isTransientPreviewFailure,
  previewFailureIsHard,
  previewProbeShouldCondemn,
  probePreviewBundle,
  type PreviewBundleProbe,
} from '../utils/previewBundleHealth';

/** Survives SocietyTownStage remount when a lease refresh bumps remountKey. */
const leaseAttemptsByPack = new Map<string, number>();

function leasePackKey(stageKey: string, previewUrl: string | null): string {
  const id = previewUrl ? previewDeploymentIdentity(previewUrl) : null;
  return `${stageKey}:${id ?? 'none'}`;
}

export function usePreviewBundleProbe(input: {
  readonly previewUrl: string | null;
  readonly remountKey: number;
  readonly isGenerating: boolean;
  readonly stageKey: string;
}): {
  readonly bundleReady: boolean;
  readonly previewBroken: string | null;
  readonly previewProbe: PreviewBundleProbe | null;
  readonly previewSettling: boolean;
  readonly leaseRefreshAttempts: number;
  readonly markLeaseAttempt: () => void;
  readonly markBroken: (reason: string) => void;
  readonly markLive: () => void;
  readonly confirmedBroken: boolean;
} {
  const { previewUrl, remountKey, isGenerating, stageKey } = input;
  const [previewBroken, setPreviewBroken] = useState<string | null>(null);
  const [previewProbe, setPreviewProbe] = useState<PreviewBundleProbe | null>(
    null,
  );
  const [leaseRefreshAttempts, setLeaseRefreshAttempts] = useState(
    () => leaseAttemptsByPack.get(leasePackKey(stageKey, previewUrl)) ?? 0,
  );
  const [bundleReady, setBundleReady] = useState(false);
  const [previewSettling, setPreviewSettling] = useState(false);
  const [confirmedBroken, setConfirmedBroken] = useState(false);
  const [probeNonce, setProbeNonce] = useState(0);
  const generatingRef = useRef(isGenerating);
  generatingRef.current = isGenerating;
  const settlingRef = useRef(false);

  const identityRef = useRef<string | null>(null);
  const remountRef = useRef(remountKey);
  const liveRef = useRef(false);

  useEffect(() => {
    const identity = previewUrl
      ? previewDeploymentIdentity(previewUrl) ?? previewUrl
      : null;
    const remountChanged = remountRef.current !== remountKey;
    remountRef.current = remountKey;
    const identityChanged = identity !== identityRef.current;
    identityRef.current = identity;
    if (!identityChanged && !remountChanged) return;
    liveRef.current = false;
    setBundleReady(false);
    setPreviewBroken(null);
    setPreviewProbe(null);
    setConfirmedBroken(false);
    const settle = Boolean(previewUrl);
    setPreviewSettling(settle);
    settlingRef.current = settle;
  }, [previewUrl, remountKey]);

  useEffect(() => {
    settlingRef.current = previewSettling;
  }, [previewSettling]);

  useEffect(() => {
    if (!previewSettling) return;
    const timer = window.setTimeout(() => {
      settlingRef.current = false;
      setPreviewSettling(false);
      setProbeNonce((n) => n + 1);
    }, PREVIEW_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [previewSettling, previewUrl, remountKey]);

  useEffect(() => {
    const key = leasePackKey(stageKey, previewUrl);
    setLeaseRefreshAttempts(leaseAttemptsByPack.get(key) ?? 0);
  }, [stageKey, previewUrl]);

  useEffect(() => {
    if (!previewUrl) return;
    let cancelled = false;
    let timer: number | undefined;
    const run = async (): Promise<void> => {
      const result = await probePreviewBundle(previewUrl);
      if (cancelled || liveRef.current) return;
      if (result.ok) {
        setPreviewBroken(null);
        setPreviewProbe(null);
        setBundleReady(true);
        setPreviewSettling(false);
        settlingRef.current = false;
        leaseAttemptsByPack.delete(leasePackKey(stageKey, previewUrl));
        setLeaseRefreshAttempts(0);
        return;
      }
      const waiting = generatingRef.current || settlingRef.current;
      if (!previewFailureIsHard(result.reason, waiting)) {
        setPreviewBroken(null);
        setPreviewProbe(result);
        setBundleReady(false);
        timer = window.setTimeout(() => {
          void run();
        }, PREVIEW_PROBE_RETRY_MS);
        return;
      }
      // Scanner "syntax" is advisory — minified Vite trips it while Phaser runs.
      setPreviewProbe(result);
      setPreviewSettling(false);
      settlingRef.current = false;
      if (previewProbeShouldCondemn(result.reason)) {
        setPreviewBroken(result.reason ?? 'not-found');
        setBundleReady(false);
        return;
      }
      setPreviewBroken(null);
      setBundleReady(true);
    };
    void run();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [previewUrl, remountKey, probeNonce, stageKey]);

  useEffect(() => {
    if (!isGenerating || !previewBroken) return;
    if (!isTransientPreviewFailure(asPreviewReason(previewBroken))) return;
    setPreviewBroken(null);
    setProbeNonce((n) => n + 1);
  }, [isGenerating, previewBroken]);

  const markLeaseAttempt = useCallback(() => {
    const key = leasePackKey(stageKey, previewUrl);
    const next = (leaseAttemptsByPack.get(key) ?? 0) + 1;
    leaseAttemptsByPack.set(key, next);
    setLeaseRefreshAttempts(next);
  }, [stageKey, previewUrl]);

  const markBroken = useCallback((reason: string) => {
    if (liveRef.current) return;
    const parsed = asPreviewReason(reason);
    setConfirmedBroken(true);
    setPreviewBroken(parsed);
    setPreviewProbe({ ok: false, reason: parsed });
    setBundleReady(false);
    setPreviewSettling(false);
    settlingRef.current = false;
  }, []);

  /** Phaser already painted — a false HTTP-probe "syntax" must not freeze the town. */
  const markLive = useCallback(() => {
    liveRef.current = true;
    setConfirmedBroken(false);
    setPreviewBroken(null);
    setPreviewProbe(null);
    setBundleReady(true);
    setPreviewSettling(false);
    settlingRef.current = false;
  }, []);

  return {
    bundleReady,
    previewBroken,
    previewProbe,
    previewSettling,
    leaseRefreshAttempts,
    markLeaseAttempt,
    markBroken,
    markLive,
    confirmedBroken,
  };
}
