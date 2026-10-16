import { isDemo } from './demo';
import { isStandalone } from './install';
import type { DayDef } from './program';
import { loadReminders } from './reminders';
import type { ReminderPlan } from './reminders';

// True push notifications: the phone is woken by the browser's own push service, so reminders arrive with the app closed.
// The server (see api/push.ts) is told only the push address, the time zone, and the reminder times and wording.
// The wording is deliberately generic. Nothing you have logged is ever sent.

export interface PushItem {
  id: string;
  time: string;
  /** 0 = Sunday. Empty means every day. */
  days: number[];
  title: string;
  body: string;
}

/** What the server is given for one device: only the switched-on reminders. */
export function buildPushSchedule(plan: ReminderPlan, program: DayDef[]): PushItem[] {
  const out: PushItem[] = [];
  if (plan.checkin.on) out.push({ id: 'checkin', time: plan.checkin.time, days: [], title: 'Time to check in', body: 'Tick your plates and rate your energy for today.' });
  if (plan.training.on && program.length)
    out.push({ id: 'training', time: plan.training.time, days: [...new Set(program.map((d) => d.weekday))].sort(), title: 'Training day', body: 'Open your programme and log your sets.' });
  if (plan.money.on) out.push({ id: 'money', time: plan.money.time, days: [], title: 'Log today’s spending', body: 'Add anything you spent or received today.' });
  if (plan.review.on) out.push({ id: 'review', time: plan.review.time, days: [0], title: 'Weekly review', body: 'Look back at the week, then set up the next one.' });
  return out;
}

export type PushSupport = 'ok' | 'demo' | 'unsupported' | 'needs-install' | 'not-configured';

export const vapidKey = (): string => import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Whether this device and this build can do push, and if not, the one thing standing in the way. */
export function pushSupport(): PushSupport {
  if (isDemo) return 'demo';
  if (typeof window === 'undefined' || !window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iPhones only get push once the app is on the Home Screen, and until then the browser hides the feature entirely.
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (!vapidKey()) return 'not-configured';
  return 'ok';
}

/** The browser wants the public key as bytes, but it is stored as URL-safe base64 text. */
export function keyToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const toB64 = (buf: ArrayBuffer | null): string => {
  if (!buf) return '';
  let s = '';
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export interface PushRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  tz: string;
  schedule: PushItem[];
}

const ON_SLOT = 'life-dashboard:v1:push-on';
const SAVED_SLOT = 'life-dashboard:v1:push-saved';
const get = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string | null) => {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

export const pushWanted = (): boolean => get(ON_SLOT) === '1';
export const deviceZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * The app's service worker. `ready` never settles if the worker failed to register (private windows, blocked workers),
 * which would leave a button spinning forever, so the wait is capped.
 */
async function registration(waitMs = 6000): Promise<ServiceWorkerRegistration | null> {
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing?.active) return existing;
    const ready = navigator.serviceWorker.ready;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs));
    return (await Promise.race([ready, timeout])) ?? existing ?? null;
  } catch {
    return null;
  }
}

/** This device's existing subscription, if any. A pure lookup that never waits, so sign-out and syncing are never held up by it. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  try {
    return (await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

export const rowFrom = (sub: PushSubscription, plan: ReminderPlan, program: DayDef[]): PushRow => ({
  endpoint: sub.endpoint,
  p256dh: toB64(sub.getKey('p256dh')),
  auth: toB64(sub.getKey('auth')),
  tz: deviceZone(),
  schedule: buildPushSchedule(plan, program),
});

export type EnableResult = { ok: true; row: PushRow } | { ok: false; reason: 'denied' | 'dismissed' | 'unsupported' | 'failed' };

/** Asks permission (this must come from a tap), subscribes this device, and returns the row to save on the server. */
export async function subscribeThisDevice(plan: ReminderPlan, program: DayDef[]): Promise<EnableResult> {
  if (pushSupport() !== 'ok') return { ok: false, reason: 'unsupported' };
  try {
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm === 'denied') return { ok: false, reason: 'denied' };
    if (perm !== 'granted') return { ok: false, reason: 'dismissed' };
    const reg = await registration();
    if (!reg) return { ok: false, reason: 'unsupported' };
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(vapidKey()) }));
    return { ok: true, row: rowFrom(sub, plan, program) };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Stops this device receiving pushes and returns its address so the server's copy can be removed. */
export async function unsubscribeThisDevice(): Promise<string | null> {
  set(ON_SLOT, null);
  set(SAVED_SLOT, null);
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  return endpoint;
}

/** Remember that this device is switched on, and what the server was last told, so it isn't re-sent on every start. */
export const markPushOn = (row: PushRow) => {
  set(ON_SLOT, '1');
  set(SAVED_SLOT, JSON.stringify([row.endpoint, row.tz, row.schedule]));
};
export const needsResend = (row: PushRow): boolean => get(SAVED_SLOT) !== JSON.stringify([row.endpoint, row.tz, row.schedule]);

/**
 * Keeps the server's copy current after the reminder times, the programme days or the time zone change.
 * Does nothing unless this device is switched on and still has permission.
 */
export async function refreshPush(save: (row: PushRow) => Promise<void>, program: DayDef[], plan: ReminderPlan = loadReminders()): Promise<boolean> {
  if (!pushWanted() || pushSupport() !== 'ok' || Notification.permission !== 'granted') return false;
  const sub = await currentSubscription();
  if (!sub) return false;
  const row = rowFrom(sub, plan, program);
  if (!needsResend(row)) return false;
  await save(row);
  markPushOn(row);
  return true;
}

/** Shows a notification from this device itself, which proves the phone will display them even before the server is involved. */
export async function showLocalTest(): Promise<boolean> {
  try {
    const reg = await registration();
    if (!reg || Notification.permission !== 'granted') return false;
    await reg.showNotification('Life Dashboard', { body: 'This device can show notifications.', tag: 'local-test', icon: './icon-192.png' });
    return true;
  } catch {
    return false;
  }
}
