/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

import { detectShell, type ShellKind } from './deviceShell.js';

/**
 * Re-evaluates on resize and orientation change so rotating a phone into
 * landscape (or dragging a desktop window narrow) swaps shells live rather
 * than stranding the user in a layout that no longer fits.
 */
export function useDeviceShell(): ShellKind {
  const [shell, setShell] = useState<ShellKind>(() => detectShell());

  useEffect(() => {
    let frame = 0;
    const sync = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setShell((prev) => {
          const next = detectShell();
          return next === prev ? prev : next;
        });
      });
    };
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
    };
  }, []);

  return shell;
}

export function useIsMobileShell(): boolean {
  return useDeviceShell() === 'mobile';
}
