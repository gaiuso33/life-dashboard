import { useSyncExternalStore } from 'react';

// Getting a new version onto an installed phone app. The service worker (public/sw.js) is stamped with a new value on every
// build, so the browser notices a deploy by itself. This file asks the browser to look whenever the app comes back to the
// front (an installed app is usually just put away, not closed, so it is never "opened" again), and tells the person when
// a new version is ready so they can reload into it. Nothing is reloaded on its own, so nobody loses what they are typing.

/** Asking the server on every tap would be wasteful; once a minute at most is plenty. */
export const MIN_GAP_MS = 60_000;
/** While the app sits open on screen, look this often as well. */
export const POLL_MS = 30 * 60_000;

export const shouldCheck = (now: number, last: number, gap = MIN_GAP_MS): boolean => now - last >= gap;

let ready = false;
const listeners = new Set<() => void>();
const setReady = (v: boolean) => {
  if (ready === v) return;
  ready = v;
  listeners.forEach((l) => l());
};

/** True once a newer version of the app has been downloaded and is waiting for a reload. */
export const useUpdateReady = (): boolean =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => ready,
    () => false,
  );

/** Registers the service worker and starts watching for new versions. Does nothing where service workers are unavailable. */
export function startUpdates(): void {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  const sw = navigator.serviceWorker;
  // The first time the app is ever opened there is no worker yet and it takes control a moment after loading. That is the
  // install, not an update, so it must not show the banner.
  let controlled = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (controlled) setReady(true);
    controlled = true;
  });

  let last = 0;
  let registration: ServiceWorkerRegistration | undefined;
  const check = () => {
    if (!registration || !shouldCheck(Date.now(), last)) return;
    last = Date.now();
    registration.update().catch(() => undefined); // offline or the server is down: try again next time
  };

  const register = () =>
    void sw
      .register('./sw.js')
      .then((r) => {
        registration = r;
        last = Date.now();
      })
      .catch(() => undefined);
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });

  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  window.addEventListener('online', check);
  window.setInterval(check, POLL_MS);
}
