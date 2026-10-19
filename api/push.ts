/// <reference types="node" />
// The push sender. One Vercel function with two jobs, told apart by who is calling:
//
//   * The clock (Supabase's scheduler, once a minute) calls it with the shared CRON_SECRET. It looks at every saved device,
//     works out which reminders are due in that device's own time zone, and sends them.
//   * A signed-in person calls it with their own session token to send a test notification to their own devices.
//
// It never touches the encrypted vault. All it knows is what the `push_subscriptions` table holds: a push address, a time
// zone, and the reminder times and wording. It also notes, per device, when sending to it started failing and with what
// error code, so Settings can say so. A person can ask for a test at most a few times an hour.

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
  /** When sending to this device started failing, and the push service's error code. Absent until supabase/push.sql is re-run. */
  failing_since?: string | null;
  last_error?: string | null;
}

export type SendResult = 'ok' | 'gone' | 'retry';
/** A sender may say only how it went, or also why (the push service's status code, or "network"). */
export type SendOutcome = SendResult | { result: SendResult; code?: string };
export interface Payload {
  title: string;
  body: string;
  tag: string;
}

/** A reminder that is a few minutes late (the clock can drift or skip) still goes out, but not one that is hours late. */
export const WINDOW_MINUTES = 15;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

export interface HealthUpdate {
  endpoint: string;
  failing_since: string | null;
  last_error: string | null;
}

export interface TickResult {
  /** New "last sent" maps to save, by device. */
  updates: { endpoint: string; last_sent: Record<string, string> }[];
  /** Devices whose push address no longer works. */
  gone: string[];
  /** Devices whose "failing since" note needs to be set or cleared. Only changes are listed. */
  healthUpdates: HealthUpdate[];
  /** How many devices had something due this minute. */
  due: number;
  sent: number;
  retry: number;
}

/** Works out and sends everything due across all devices. Sending is injected so it can be tested without a network. */
export async function runTick(rows: SubRow[], now: Date, send: (row: SubRow, p: Payload) => Promise<SendOutcome>): Promise<TickResult> {
  const res: TickResult = { updates: [], gone: [], healthUpdates: [], due: 0, sent: 0, retry: 0 };
  const work = rows
    .map((row) => ({ row, due: dueReminders(row.schedule, row.last_sent, row.tz, now) }))
    .filter((w) => w.due.length);
  res.due = work.length;
  // A few devices at a time keeps the function quick without hammering the push services.
  const LANES = 10;
  let next = 0;
  const lane = async () => {
    while (next < work.length) {
      const { row, due } = work[next++];
      const local = localParts(now, row.tz)!;
      const sent = { ...asObject(row.last_sent) } as Record<string, string>;
      let changed = false;
      let anyOk = false;
      let dead = false;
      let failCode: string | undefined;
      for (const r of due) {
        const raw = await send(row, { title: r.title, body: r.body, tag: r.id }).catch((): SendOutcome => ({ result: 'retry', code: 'network' }));
        const out = typeof raw === 'string' ? { result: raw, code: undefined } : raw;
        if (out.result === 'ok') {
          sent[r.id] = local.date;
          changed = true;
          anyOk = true;
          res.sent++;
        } else if (out.result === 'gone') {
          res.gone.push(row.endpoint);
          changed = false;
          dead = true;
          break;
        } else {
          res.retry++;
          failCode = out.code ?? 'error';
        }
      }
      // Remember when a device started failing (and why), and forget it once a send gets through. Only changes are written.
      if (!dead) {
        if (anyOk) {
          if (row.failing_since) res.healthUpdates.push({ endpoint: row.endpoint, failing_since: null, last_error: null });
        } else if (failCode && (!row.failing_since || row.last_error !== failCode)) {
          res.healthUpdates.push({ endpoint: row.endpoint, failing_since: row.failing_since ?? now.toISOString(), last_error: failCode });
        }
      }
      if (changed) {
        // Forget entries for reminders that no longer exist so the map doesn't grow.
        const keep = new Set(cleanSchedule(row.schedule).map((r) => r.id));
        for (const k of Object.keys(sent)) if (!keep.has(k)) delete sent[k];
        res.updates.push({ endpoint: row.endpoint, last_sent: sent });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LANES, work.length) }, lane));
  return res;
}

// ---- Everything below talks to the outside world. It takes its dependencies as a parameter so tests can fake them. ----

export interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}
export interface Res {
  status(code: number): Res;
  setHeader(name: string, value: string): Res;
  json(body: unknown): void;
  end(): void;
}

export type Sender = (row: SubRow, p: Payload) => Promise<SendOutcome>;

export interface Deps {
  env: (k: string) => string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  makeSender: () => Promise<Sender>;
  now: () => Date;
  log: (line: string) => void;
}

/** A person may ask for this many test notifications in a rolling hour. */
export const TEST_LIMIT = 5;
export const TEST_WINDOW_MS = 60 * 60 * 1000;
/** The most devices read in one run. A run that reaches it says so in the log (see README on scaling). */
export const DEVICE_CAP = 5000;
/** Nothing waits on the network for longer than this. */
export const TIMEOUT_MS = 8000;

const BASE_COLUMNS = 'endpoint,user_id,p256dh,auth,tz,schedule,last_sent';
const HEALTH_COLUMNS = ',failing_since,last_error';

const baseUrl = (d: Deps) => (d.env('SUPABASE_URL') || d.env('VITE_SUPABASE_URL')).replace(/\/+$/, '');
const enc = encodeURIComponent;
const header = (req: Req, k: string) => {
  const v = req.headers[k];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};
const line = (d: Deps, o: Record<string, unknown>) => d.log(JSON.stringify(o));
const note = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Compares secrets without leaking, through timing, how much of a guess was right. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** A session token is a signed token of three parts. Anything else is turned away without asking Supabase. */
export function looksLikeSessionToken(t: string): boolean {
  return t.length <= 4096 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t);
}

const USER_ID = /^[0-9a-fA-F-]{36}$/;

/**
 * A device is saved by the person's own phone, so its address could be anything. The server only sends to https addresses on
 * a real public host (every push service is one): never a bare name, a numeric address, "localhost", a private network name,
 * or an address with a login in it. Anything else is skipped, not sent to.
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

/** Wraps a sender so it is never asked to send to an address that fails the check above. */
const guarded = (send: Sender): Sender => async (row, p) => (safeEndpoint(row.endpoint) ? send(row, p) : { result: 'retry', code: 'blocked' });

async function rest(d: Deps, path: string, init: RequestInit = {}): Promise<Response> {
  const key = d.env('SUPABASE_SERVICE_ROLE_KEY');
  return d.fetch(`${baseUrl(d)}/rest/v1${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
  });
}

/** Reads the devices. If the newer "failing since" columns are not there yet, carries on without them rather than stopping. */
async function readDevices(d: Deps): Promise<{ rows: SubRow[]; health: boolean }> {
  let health = true;
  let r = await rest(d, `/push_subscriptions?select=${BASE_COLUMNS}${HEALTH_COLUMNS}&limit=${DEVICE_CAP}`);
  if (r.status === 400) {
    health = false;
    r = await rest(d, `/push_subscriptions?select=${BASE_COLUMNS}&limit=${DEVICE_CAP}`);
  }
  if (!r.ok) throw new Error(`Could not read devices (${r.status})`);
  const rows = (await r.json()) as unknown;
  return { rows: Array.isArray(rows) ? (rows as SubRow[]) : [], health };
}

async function tick(d: Deps) {
  const t0 = d.now().getTime();
  const { rows, health } = await readDevices(d);
  const result = await runTick(rows, d.now(), guarded(await d.makeSender()));
  // What was sent is recorded first and on its own, so it never depends on the newer columns existing.
  for (const u of result.updates) {
    await rest(d, `/push_subscriptions?endpoint=eq.${enc(u.endpoint)}`, { method: 'PATCH', body: JSON.stringify({ last_sent: u.last_sent }) }).catch(() => undefined);
  }
  if (health) {
    for (const h of result.healthUpdates) {
      await rest(d, `/push_subscriptions?endpoint=eq.${enc(h.endpoint)}`, { method: 'PATCH', body: JSON.stringify({ failing_since: h.failing_since, last_error: h.last_error }) }).catch(() => undefined);
    }
  }
  for (const endpoint of result.gone) {
    await rest(d, `/push_subscriptions?endpoint=eq.${enc(endpoint)}`, { method: 'DELETE' }).catch(() => undefined);
  }
  const failing = result.healthUpdates.filter((h) => h.failing_since).length;
  const summary = { devices: rows.length, due: result.due, sent: result.sent, retry: result.retry, removed: result.gone.length, failing };
  line(d, { evt: 'push-tick', ...summary, capped: rows.length >= DEVICE_CAP, healthColumns: health, ms: d.now().getTime() - t0 });
  return summary;
}

/** Whether this person may send another test now, and if not, how many seconds until they may. Fails open: a missing table must not break tests. */
async function testAllowance(d: Deps, userId: string): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  try {
    const since = new Date(d.now().getTime() - TEST_WINDOW_MS).toISOString();
    const r = await rest(d, `/push_test_log?select=at&user_id=eq.${enc(userId)}&at=gte.${enc(since)}&order=at.asc&limit=${TEST_LIMIT}`);
    if (!r.ok) {
      line(d, { evt: 'push-limit-unavailable', status: r.status });
      return { ok: true };
    }
    const rows = (await r.json()) as { at?: string }[];
    if (!Array.isArray(rows) || rows.length < TEST_LIMIT) return { ok: true };
    const oldest = Date.parse(String(rows[0]?.at));
    const wait = Number.isNaN(oldest) ? TEST_WINDOW_MS : oldest + TEST_WINDOW_MS - d.now().getTime();
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(wait / 1000)) };
  } catch (e) {
    line(d, { evt: 'push-limit-unavailable', error: note(e) });
    return { ok: true };
  }
}

async function noteTest(d: Deps, userId: string): Promise<void> {
  try {
    await rest(d, '/push_test_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: userId, at: d.now().toISOString() }) });
    // Tidy up: entries older than a day are of no use.
    const old = new Date(d.now().getTime() - 24 * TEST_WINDOW_MS).toISOString();
    await rest(d, `/push_test_log?user_id=eq.${enc(userId)}&at=lt.${enc(old)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  } catch {
    /* best effort */
  }
}

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Sends a test to the signed-in person's own devices. The session token is checked with Supabase, not trusted. */
async function test(d: Deps, token: string): Promise<{ sent: number; devices: number } | { limited: number }> {
  const who = await d.fetch(`${baseUrl(d)}/auth/v1/user`, { headers: { apikey: d.env('VITE_SUPABASE_ANON_KEY') || d.env('SUPABASE_ANON_KEY') || d.env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${token}` } });
  if (who.status === 401 || who.status === 403) throw new HttpError('Please sign in again.', 401);
  if (!who.ok) throw new Error(`Could not check the session (${who.status})`);
  const id = ((await who.json().catch(() => ({}))) as { id?: unknown }).id;
  if (typeof id !== 'string' || !USER_ID.test(id)) throw new HttpError('Please sign in again.', 401);

  const allowed = await testAllowance(d, id);
  if (!allowed.ok) {
    line(d, { evt: 'push-test', limited: true });
    return { limited: allowed.retryAfterSec };
  }
  await noteTest(d, id);

  const r = await rest(d, `/push_subscriptions?select=${BASE_COLUMNS}&user_id=eq.${enc(id)}`);
  if (!r.ok) throw new Error(`Could not read the person's devices (${r.status})`);
  const rows = (await r.json()) as SubRow[];
  const send = guarded(await d.makeSender());
  let sent = 0;
  let removed = 0;
  for (const row of rows) {
    const raw = await send(row, { title: 'Life Dashboard', body: 'Push notifications are working on this device.', tag: 'test' }).catch((): SendOutcome => 'retry');
    const out = typeof raw === 'string' ? raw : raw.result;
    if (out === 'ok') sent++;
    else if (out === 'gone') {
      removed++;
      await rest(d, `/push_subscriptions?endpoint=eq.${enc(row.endpoint)}`, { method: 'DELETE' }).catch(() => undefined);
    }
  }
  line(d, { evt: 'push-test', devices: rows.length, sent, removed });
  return { sent, devices: rows.length };
}

export function createHandler(d: Deps) {
  return async function handler(req: Req, res: Res): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return void res.status(405).json({ error: 'POST only' });
    }
    const missing = ['SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PRIVATE_KEY', 'CRON_SECRET'].filter((k) => !d.env(k));
    if (!baseUrl(d) || !(d.env('VITE_VAPID_PUBLIC_KEY') || d.env('VAPID_PUBLIC_KEY')) || missing.length) {
      return void res.status(503).json({ error: 'Push is not set up on the server yet.' });
    }
    const token = header(req, 'authorization').replace(/^Bearer\s+/i, '');
    try {
      if (sameSecret(token, d.env('CRON_SECRET'))) return void res.status(200).json(await tick(d));
      if (!token) return void res.status(401).json({ error: 'Not allowed.' });
      if (!looksLikeSessionToken(token)) return void res.status(401).json({ error: 'Please sign in again.' });
      const out = await test(d, token);
      if ('limited' in out) {
        const minutes = Math.max(1, Math.ceil(out.limited / 60));
        res.setHeader('Retry-After', String(out.limited));
        return void res.status(429).json({ error: `You have sent several tests in the last hour. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
      }
      return void res.status(200).json(out);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      // The real reason goes to the server log only. The reply never says more than this.
      if (status !== 401) line(d, { evt: 'push-error', error: note(e) });
      return void res.status(status).json({ error: status === 401 ? 'Please sign in again.' : 'Something went wrong sending notifications.' });
    }
  };
}

// ---- The real thing ----

const realEnv = (k: string) => process.env[k]?.trim() || '';

async function realSender(): Promise<Sender> {
  const { default: webpush } = await import('web-push');
  webpush.setVapidDetails(realEnv('VAPID_SUBJECT') || 'mailto:admin@example.com', realEnv('VITE_VAPID_PUBLIC_KEY') || realEnv('VAPID_PUBLIC_KEY'), realEnv('VAPID_PRIVATE_KEY'));
  return async (row, p) => {
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(p), { TTL: 3600, urgency: 'normal', timeout: TIMEOUT_MS });
      return 'ok';
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      return code === 404 || code === 410 ? 'gone' : { result: 'retry', code: code ? String(code) : 'network' };
    }
  };
}

export default createHandler({
  env: realEnv,
  fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }),
  makeSender: realSender,
  now: () => new Date(),
  log: (l) => console.log(l),
});
