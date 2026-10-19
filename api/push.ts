/// <reference types="node" />
// The push sender. One Vercel function with two jobs, told apart by who is calling:
//
//   * The clock (Supabase's scheduler, once a minute) calls it with the shared CRON_SECRET. It looks at every saved device,
//     works out which reminders are due in that device's own time zone, and sends them.
//   * A signed-in person calls it with their own session token to send a test notification to their own devices.
//
// It never touches the encrypted vault. All it knows is what the `push_subscriptions` table holds: a push address, a time
// zone, and the reminder times and wording.

import { timingSafeEqual } from 'node:crypto';

export interface ReminderItem {
  id: string;
  /** 24-hour "HH:MM" in the person's own time zone. */
  time: string;
  /** 0 = Sunday. Empty means every day. */
  days: number[];
  title: string;
  body: string;
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
/** Key inside `last_sent` that holds when a device first could not be reached. Reminder ids cannot look like this. */
export const FAIL_KEY = '_fail';
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
    out.push({ id: o.id, time: o.time, days, title: o.title.slice(0, 80), body: o.body.slice(0, 160) });
  }
  return out;
}

/** Which reminders should go out right now for one device, given what it has already been sent today. */
export function dueReminders(schedule: unknown, lastSent: unknown, tz: string, now: Date): ReminderItem[] {
  const local = localParts(now, tz);
  if (!local) return [];
  const sent = asObject(lastSent);
  return cleanSchedule(schedule).filter((r) => {
    const [h, m] = r.time.split(':').map(Number);
    const late = local.minutes - (h * 60 + m);
    // A reminder set very close to midnight and delayed past it is skipped, which is better than sending it a day late.
    if (late < 0 || late >= WINDOW_MINUTES) return false;
    if (r.days.length && !r.days.includes(local.weekday)) return false;
    return sent[r.id] !== local.date;
  });
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
          sent[r.id] = local.date;
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
        const keep = new Set([FAIL_KEY, ...cleanSchedule(row.schedule).map((r) => r.id)]);
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

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return fetch(`${supabaseUrl()}/rest/v1${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
  });
}

async function makeSender(): Promise<(row: SubRow, p: Payload) => Promise<SendResult>> {
  const { default: webpush } = await import('web-push');
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VITE_VAPID_PUBLIC_KEY') || env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  return async (row, p) => {
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(p), { TTL: 3600, urgency: 'normal' });
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
  const who = await fetch(`${supabaseUrl()}/auth/v1/user`, { headers: { apikey: env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${token}` } });
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
