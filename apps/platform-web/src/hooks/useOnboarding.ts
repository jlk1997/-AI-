/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';

const ONBOARDING_KEY = 'opengame_has_seen_onboarding';

export function useOnboarding() {
  const [isFirstVisit, setIsFirstVisit] = useState(() => {
    try {
      return !localStorage.getItem(ONBOARDING_KEY);
    } catch {
      return true;
    }
  });

  const [showOnboarding, setShowOnboarding] = useState(false);

  /** Auto-open once for first-time visitors after mount. */
  useEffect(() => {
    if (!isFirstVisit) return;
    const timer = window.setTimeout(() => setShowOnboarding(true), 600);
    return () => window.clearTimeout(timer);
  }, [isFirstVisit]);

  const completeOnboarding = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_KEY, 'true');
    } catch {
      // ignore
    }
    setIsFirstVisit(false);
    setShowOnboarding(false);
  }, []);

  const openOnboarding = useCallback(() => {
    setShowOnboarding(true);
  }, []);

  const closeOnboarding = useCallback(() => {
    // Closing without completing still marks seen so we don't spam every reload;
    // users can reopen via help FAB.
    completeOnboarding();
  }, [completeOnboarding]);

  return {
    isFirstVisit,
    showOnboarding,
    completeOnboarding,
    openOnboarding,
    closeOnboarding,
  };
}
