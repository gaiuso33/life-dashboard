import { useSyncExternalStore } from 'react';

// Chrome, Edge and Samsung Internet on Android/desktop offer an install prompt only when they decide to, and the event can fire
// before the app has rendered. We catch it at start-up and keep it so an "Install" button can use it whenever the person wants.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

export function startInstallWatch() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    emit();
  });
}

export async function promptInstall() {
  const e = deferred;
  if (!e) return;
  deferred = null;
  emit();
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === 'accepted') installed = true;
  emit();
}

export type InstallState = 'ready' | 'installed' | 'ios' | 'file' | 'manual';

export function installState(): InstallState {
  if (installed || isStandalone()) return 'installed';
  if (!location.protocol.startsWith('http')) return 'file';
  if (deferred) return 'ready';
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios ? 'ios' : 'manual';
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    installState,
    installState,
  );
}
