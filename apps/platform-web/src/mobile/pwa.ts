/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Registers the shell-only service worker. Kept out of `main.tsx` so a failure
 * here can never block the first render — an install prompt is a nice-to-have,
 * a running app is not.
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  // Dev serves modules unbundled; a SW in front of that only adds confusion.
  if (import.meta.env?.DEV) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline shell is optional */
    });
  });
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

export function watchInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    listeners.forEach((fn) => fn(true));
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn(false));
  });
}

export function onInstallAvailabilityChange(fn: (available: boolean) => void): () => void {
  listeners.add(fn);
  fn(deferredPrompt !== null);
  return () => listeners.delete(fn);
}

export function canPromptInstall(): boolean {
  return deferredPrompt !== null;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  const prompt = deferredPrompt;
  deferredPrompt = null;
  listeners.forEach((fn) => fn(false));
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}
