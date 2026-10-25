/// <reference types="node" />
// The push sender. One Vercel function with two jobs, told apart by who is calling:
//
//   * The clock (Supabase's scheduler, once a minute) calls it with the shared CRON_SECRET. It looks at every saved device,
//     works out which reminders are due in that device's own time zone, and sends them.
//   * A signed-in person calls it with their own session token to send a test notification to their own devices.
//
// It never touches the encrypted vault. All it knows is what the `push_subscriptions` table holds: a push address, a time
// zone, and the reminder times and wording.

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ReminderItem {
  id: string;
  /** 24-hour "HH:MM" in the person's own time zone. */
  time: string;
  /** 0 = Sunday. Empty means every day. */
  days: number[];
  title: string;
  body: string;
  /** A one-off nudge: sent only on this local date (YYYY-MM-DD), whatever `days` says. */
  date?: string;
  /** Nothing is sent while the device's clock is inside this window (it may run past midnight). */
  quiet?: { from: string; to: string };
}

export interface SubRow {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
  tz: string;
  schedule: unknown;
  last_sent: unknown;
}

export type SendResult = 'ok' | 'gone' | 'retry';
export interface Payload {
  title: string;
  body: string;
  tag: string;
}

/** A reminder that is a few minutes late (the clock can drift or skip) still goes out, but not one that is hours late. */
export const WINDOW_MINUTES = 15;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** Key inside `last_sent` that holds when a device first could not be reached. Reminder ids cannot look like this. */
export const FAIL_KEY = '_fail';
/** Prefix of the keys in `last_sent` that hold when a snoozed reminder should come back. Reminder ids cannot look like this. */
export const SNOOZE_PREFIX = '_snooze:';
export const SNOOZE_MINUTES = 60;
/** A snooze that could not be delivered (the phone was off, or it was waiting out quiet hours) is dropped after this long. */
export const SNOOZE_EXPIRY_MINUTES = 12 * 60;
/** "Send a test" is limited per person so a stuck button or a script cannot spam their phones. */
export const TEST_LIMIT = 5;
export const TEST_WINDOW_MS = 60 * 60_000;

/** Which earlier test sends still count against the limit, and whether another is allowed (and if not, minutes to wait). */
export function testAllowance(stamps: unknown, now: number): { recent: number[]; allowed: boolean; waitMinutes: number } {
  const recent = (Array.isArray(stamps) ? stamps : []).filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > now - TEST_WINDOW_MS && t <= now).sort((a, b) => a - b);
  if (recent.length < TEST_LIMIT) return { recent, allowed: true, waitMinutes: 0 };
  const free = recent[recent.length - TEST_LIMIT] + TEST_WINDOW_MS;
  return { recent, allowed: false, waitMinutes: Math.max(1, Math.ceil((free - now) / 60_000)) };
}

/** The date, weekday and minutes-since-midnight at `now` in a time zone, or null if the zone is not a real one. */
export function localParts(now: Date, tz: string): { date: string; weekday: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    const minutes = Number(get('hour')) * 60 + Number(get('minute'));
    if (weekday < 0 || Number.isNaN(minutes)) return null;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday, minutes };
  } catch {
    return null;
  }
}

/** Whether a time of day (minutes since midnight) is inside a quiet window. The end is the first minute allowed again. */
export function inQuiet(minutes: number, from: string, to: string): boolean {
  const f = TIME.exec(from);
  const t = TIME.exec(to);
  if (!f || !t) return false;
  const a = Number(f[1]) * 60 + Number(f[2]);
  const b = Number(t[1]) * 60 + Number(t[2]);
  if (a === b) return false;
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

const asObject = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

/** Reads the stored schedule defensively: anything malformed is skipped rather than trusted. */
export function cleanSchedule(raw: unknown): ReminderItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ReminderItem[] = [];
  for (const r of raw.slice(0, 12)) {
    const o = asObject(r);
    if (typeof o.id !== 'string' || !/^[a-z0-9-]{1,30}$/.test(o.id)) continue;
    if (typeof o.time !== 'string' || !TIME.test(o.time)) continue;
    if (typeof o.title !== 'string' || typeof o.body !== 'string') continue;
    const days = Array.isArray(o.days) ? [...new Set(o.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
    const item: ReminderItem = { id: o.id, time: o.time, days, title: o.title.slice(0, 80), body: o.body.slice(0, 160) };
    if (typeof o.date === 'string' && DATE.test(o.date)) item.date = o.date;
    const q = asObject(o.quiet);
    if (typeof q.from === 'string' && TIME.test(q.from) && typeof q.to === 'string' && TIME.test(q.to) && q.from !== q.to) item.quiet = { from: q.from, to: q.to };
    out.push(item);
  }
  return out;
}

/** A reminder that is due, and whether it is a snoozed one coming back rather than its usual time. */
export type Due = ReminderItem & { snoozed?: true };

/**
 * Which reminders should go out right now for one device, given what it has already been sent today.
 * Nothing goes out while the device's clock is inside the quiet window. A snoozed reminder comes back once its time has
 * passed, waiting out quiet hours if they are in the way, and is dropped if it still could not be delivered after twelve hours.
 */
export function dueReminders(schedule: unknown, lastSent: unknown, tz: string, now: Date): Due[] {
  const local = localParts(now, tz);
  if (!local) return [];
  const sent = asObject(lastSent);
  const items = cleanSchedule(schedule);
  const due: Due[] = items.filter((r) => {
    if (r.quiet && inQuiet(local.minutes, r.quiet.from, r.quiet.to)) return false;
    const [h, m] = r.time.split(':').map(Number);
    const late = local.minutes - (h * 60 + m);
    // A reminder set very close to midnight and delayed past it is skipped, which is better than sending it a day late.
    if (late < 0 || late >= WINDOW_MINUTES) return false;
    if (r.date) {
      if (r.date !== local.date) return false;
    } else if (r.days.length && !r.days.includes(local.weekday)) return false;
    return sent[r.id] !== local.date;
  });
  for (const r of items) {
    if (due.some((d) => d.id === r.id)) continue;
    const at = typeof sent[SNOOZE_PREFIX + r.id] === 'string' ? Date.parse(sent[SNOOZE_PREFIX + r.id] as string) : NaN;
    if (Number.isNaN(at)) continue;
    const overdue = (now.getTime() - at) / 60_000;
    if (overdue < 0 || overdue >= SNOOZE_EXPIRY_MINUTES) continue;
    if (r.quiet && inQuiet(local.minutes, r.quiet.from, r.quiet.to)) continue;
    due.push({ ...r, snoozed: true });
  }
  return due;
}

/** The proof, carried inside each reminder, that lets the phone ask for it to be snoozed without signing in. */
export function snoozeSignature(secret: string, endpoint: string, id: string): string {
  return createHmac('sha256', secret).update(`snooze|${endpoint}|${id}`).digest('hex');
}

/** Records a snooze in a device's `last_sent` map, and returns the new map (or null if the reminder is not on that device). */
export function withSnooze(schedule: unknown, lastSent: unknown, id: string, now: Date): Record<string, string> | null {
  if (!cleanSchedule(schedule).some((r) => r.id === id)) return null;
  const next = { ...asObject(lastSent) } as Record<string, string>;
  next[SNOOZE_PREFIX + id] = new Date(now.getTime() + SNOOZE_MINUTES * 60_000).toISOString();
  return next;
}

export interface TickResult {
  /** New "last sent" maps to save, by device. */
  updates: { endpoint: string; last_sent: Record<string, string> }[];
  /** Devices whose push address no longer works. */
  gone: string[];
  sent: number;
  retry: number;
}

/** Works out and sends everything due across all devices. Sending is injected so it can be tested without a network. */
export async function runTick(rows: SubRow[], now: Date, send: (row: SubRow, p: Payload) => Promise<SendResult>): Promise<TickResult> {
  const res: TickResult = { updates: [], gone: [], sent: 0, retry: 0 };
  const work = rows
    .map((row) => ({ row, due: dueReminders(row.schedule, row.last_sent, row.tz, now) }))
    .filter((w) => w.due.length);
  // A few devices at a time keeps the function quick without hammering the push services.
  const LANES = 10;
  let next = 0;
  const lane = async () => {
    while (next < work.length) {
      const { row, due } = work[next++];
      const local = localParts(now, row.tz)!;
      const sent = { ...asObject(row.last_sent) } as Record<string, string>;
      let changed = false;
      let okHere = 0;
      let failHere = 0;
      let goneHere = false;
      for (const r of due) {
        const out = await send(row, { title: r.title, body: r.body, tag: r.id }).catch((): SendResult => 'retry');
        if (out === 'ok') {
          // A snoozed reminder comes back once and is then done; a usual one is marked as sent for today (and ends any snooze).
          if (!r.snoozed) sent[r.id] = local.date;
          delete sent[SNOOZE_PREFIX + r.id];
          changed = true;
          res.sent++;
          okHere++;
        } else if (out === 'gone') {
          res.gone.push(row.endpoint);
          goneHere = true;
          break;
        } else {
          res.retry++;
          failHere++;
        }
      }
      if (goneHere) continue;
      // Remember when a device first could not be reached (Settings shows it), and forget it once a send gets through.
      if (failHere && !okHere && typeof sent[FAIL_KEY] !== 'string') {
        sent[FAIL_KEY] = now.toISOString();
        changed = true;
      }
      if (okHere && FAIL_KEY in sent) {
        delete sent[FAIL_KEY];
        changed = true;
      }
      if (changed) {
        // Forget entries for reminders that no longer exist so the map doesn't grow.
        const ids = cleanSchedule(row.schedule).map((r) => r.id);
        const keep = new Set([FAIL_KEY, ...ids, ...ids.map((id) => SNOOZE_PREFIX + id)]);
        for (const k of Object.keys(sent)) if (!keep.has(k)) delete sent[k];
        res.updates.push({ endpoint: row.endpoint, last_sent: sent });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LANES, work.length) }, lane));
  return res;
}

// ---- Everything below talks to the outside world and is only exercised for real on the deployed site. ----

interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status(code: number): Res;
  setHeader(name: string, value: string): Res;
  json(body: unknown): void;
  end(): void;
}

const env = (k: string) => process.env[k]?.trim() || '';
const supabaseUrl = () => (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/+$/, '');
const header = (req: Req, k: string) => {
  const v = req.headers[k];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};

/** Compares secrets without leaking, through timing, how much of a guess was right. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Longest the function waits on any one outside call, so a stuck service can't hold the whole run until Vercel kills it. */
export const TIMEOUT_MS = 8000;

/**
 * A device is saved by the person's own phone, so its address could be anything. The server only sends to https addresses on
 * a real public host (every push service is one): never a bare name, a numeric address, "localhost", a private network name,
 * or an address with a login in it.
 */
export function safeEndpoint(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const h = u.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes('.') || h.startsWith('.') || h.endsWith('.')) return false;
  if (/^\d+(\.\d+){3}$/.test(h)) return false;
  return !/(^|\.)(localhost|local|internal|localdomain|lan|home|corp|intranet)$/.test(h);
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return fetch(`${supabaseUrl()}/rest/v1${path}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
  });
}

async function makeSender(): Promise<(row: SubRow, p: Payload) => Promise<SendResult>> {
  const { default: webpush } = await import('web-push');
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VITE_VAPID_PUBLIC_KEY') || env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  return async (row, p) => {
    // An address that fails the check is never contacted; the device is treated as gone so it gets cleaned up.
    if (!safeEndpoint(row.endpoint)) return 'gone';
    try {
      // Each reminder carries a signed "snooze" so the phone can ask for it to come back without being signed in. The test
      // notification does not (its tag is not a reminder).
      const body = p.tag === 'test' ? p : { ...p, snooze: { id: p.tag, sig: snoozeSignature(env('CRON_SECRET'), row.endpoint, p.tag) } };
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(body), { TTL: 3600, urgency: 'normal', timeout: TIMEOUT_MS });
      return 'ok';
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      return code === 404 || code === 410 ? 'gone' : 'retry';
    }
  };
}

const COLUMNS = 'endpoint,user_id,p256dh,auth,tz,schedule,last_sent';

async function tick(): Promise<TickResult & { devices: number }> {
  const r = await rest(`/push_subscriptions?select=${COLUMNS}&limit=5000`);
  if (!r.ok) throw new Error(`Could not read devices (${r.status})`);
  const rows = (await r.json()) as SubRow[];
  const result = await runTick(rows, new Date(), await makeSender());
  for (const u of result.updates) {
    await rest(`/push_subscriptions?endpoint=eq.${encodeURIComponent(u.endpoint)}`, { method: 'PATCH', body: JSON.stringify({ last_sent: u.last_sent }) }).catch(() => undefined);
  }
  for (const endpoint of result.gone) {
    await rest(`/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' }).catch(() => undefined);
  }
  const summary = { devices: rows.length, due: result.sent + result.retry, sent: result.sent, retry: result.retry, gone: result.gone.length };
  // Counts only: never addresses, keys or anyone's schedule.
  console.log(`push tick: ${summary.devices} devices, ${summary.due} due, ${summary.sent} sent, ${summary.retry} failed, ${summary.gone} removed`);
  return { ...result, devices: rows.length };
}

/** Sends a test to the signed-in person's own devices. The session token is checked with Supabase, not trusted. */
async function test(token: string): Promise<{ sent: number; devices: number }> {
  const who = await fetch(`${supabaseUrl()}/auth/v1/user`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { apikey: env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${token}` } });
  if (!who.ok) throw Object.assign(new Error('Please sign in again.'), { status: 401 });
  const me = (await who.json()) as { id?: string; app_metadata?: Record<string, unknown> };
  const id = me.id;
  if (!id) throw Object.assign(new Error('Please sign in again.'), { status: 401 });
  const now = Date.now();
  const meta = asObject(me.app_metadata);
  const limit = testAllowance(meta.push_tests, now);
  if (!limit.allowed) {
    console.log('push test: refused, limit reached');
    throw Object.assign(new Error(`Too many tests. Try again in ${limit.waitMinutes} minute${limit.waitMinutes === 1 ? '' : 's'}.`), { status: 429, public: true });
  }
  // Counted before sending. If recording it fails the test still goes (the limit is a courtesy, not a gate worth breaking).
  await fetch(`${supabaseUrl()}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_metadata: { ...meta, push_tests: [...limit.recent, now] } }),
  }).catch(() => undefined);
  const r = await rest(`/push_subscriptions?select=${COLUMNS}&user_id=eq.${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error('Could not read your devices.');
  const rows = (await r.json()) as SubRow[];
  const send = await makeSender();
  let sent = 0;
  for (const row of rows) {
    const out = await send(row, { title: 'Life Dashboard', body: 'Push notifications are working on this device.', tag: 'test' });
    if (out === 'ok') sent++;
    else if (out === 'gone') await rest(`/push_subscriptions?endpoint=eq.${encodeURIComponent(row.endpoint)}`, { method: 'DELETE' }).catch(() => undefined);
  }
  console.log(`push test: ${rows.length} devices, ${sent} sent`);
  return { sent, devices: rows.length };
}

/** Snoozes one reminder on one device. The signature, made when the reminder was sent, is the only proof needed; it is checked first. */
export async function snooze(raw: unknown): Promise<{ ok: boolean }> {
  const o = asObject(raw);
  const { endpoint, id, sig } = o;
  if (typeof endpoint !== 'string' || typeof id !== 'string' || typeof sig !== 'string' || !safeEndpoint(endpoint) || !/^[a-z0-9-]{1,30}$/.test(id)) {
    throw Object.assign(new Error('Not allowed.'), { status: 401 });
  }
  if (!sameSecret(sig, snoozeSignature(env('CRON_SECRET'), endpoint, id))) throw Object.assign(new Error('Not allowed.'), { status: 401 });
  const r = await rest(`/push_subscriptions?select=${COLUMNS}&endpoint=eq.${encodeURIComponent(endpoint)}`);
  if (!r.ok) throw new Error('Could not read the device.');
  const row = ((await r.json()) as SubRow[])[0];
  const next = row ? withSnooze(row.schedule, row.last_sent, id, new Date()) : null;
  if (!next) return { ok: false };
  const w = await rest(`/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'PATCH', body: JSON.stringify({ last_sent: next }) });
  if (!w.ok) throw new Error('Could not save the snooze.');
  console.log('push snooze: saved');
  return { ok: true };
}

export default async function handler(req: Req, res: Res): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return void res.status(405).json({ error: 'POST only' });
  }
  const missing = ['SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PRIVATE_KEY', 'CRON_SECRET'].filter((k) => !env(k));
  if (!supabaseUrl() || !(env('VITE_VAPID_PUBLIC_KEY') || env('VAPID_PUBLIC_KEY')) || missing.length) {
    return void res.status(503).json({ error: 'Push is not set up on the server yet.' });
  }
  const token = header(req, 'authorization').replace(/^Bearer\s+/i, '');
  try {
    // A phone asking to snooze a reminder carries no sign-in, only the signature that came with the notification.
    if (!token && asObject(req.body).snooze) return void res.status(200).json(await snooze(asObject(req.body).snooze));
    if (sameSecret(token, env('CRON_SECRET'))) return void res.status(200).json(await tick());
    if (!token) return void res.status(401).json({ error: 'Not allowed.' });
    return void res.status(200).json(await test(token));
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    if (status === 500) console.error('push: failed');
    const message = status === 401 ? 'Please sign in again.' : status === 429 ? (e as Error).message : 'Something went wrong sending notifications.';
    return void res.status(status).json({ error: message });
  }
}
