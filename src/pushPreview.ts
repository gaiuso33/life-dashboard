import type { DayDef } from './program';
import { buildPushSchedule } from './push';
import type { PushItem } from './push';
import type { ReminderPlan } from './reminders';

// What push notifications will do, in words, for the Settings screen: when each reminder fires next, and what the server
// actually holds for each device. This mirrors the sender (api/push.ts) on purpose: the sender runs on the server and
// cannot be imported here, so a unit test checks the two agree minute by minute.

/** How late a reminder may still go out. Kept in step with the sender by a test. */
export const WINDOW_MINUTES = 15;

const LONG_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const REMINDER_NAMES: Record<string, string> = { checkin: 'Daily check-in', training: 'Training day', money: 'Log spending', review: 'Weekly review' };

interface Parts {
  date: string;
  weekday: number;
  minutes: number;
}

/** The date, weekday and minutes-since-midnight at `now` in a time zone, or null if the zone is not a real one. */
export function zonedParts(now: Date, tz: string): Parts | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const weekday = SHORT_DAY.indexOf(get('weekday'));
    const minutes = Number(get('hour')) * 60 + Number(get('minute'));
    if (weekday < 0 || Number.isNaN(minutes)) return null;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday, minutes };
  } catch {
    return null;
  }
}

export interface Fire {
  when: 'now' | 'today' | 'tomorrow' | 'later';
  weekday: number;
  time: string;
}

const asObject = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

/** The next time a reminder goes out, given what has already been sent. `days` empty means every day (0 = Sunday). */
export function nextFire(item: { id: string; time: string; days: number[] }, tz: string, now: Date, lastSent: unknown = {}): Fire | null {
  const local = zonedParts(now, tz);
  const m = TIME.exec(item.time);
  if (!local || !m) return null;
  const target = Number(m[1]) * 60 + Number(m[2]);
  const sentToday = asObject(lastSent)[item.id] === local.date;
  for (let d = 0; d <= 7; d++) {
    const weekday = (local.weekday + d) % 7;
    if (item.days.length && !item.days.includes(weekday)) continue;
    if (d === 0) {
      if (sentToday) continue;
      if (target >= local.minutes) return { when: 'today', weekday, time: item.time };
      if (local.minutes - target < WINDOW_MINUTES) return { when: 'now', weekday, time: item.time };
      continue;
    }
    return { when: d === 1 ? 'tomorrow' : 'later', weekday, time: item.time };
  }
  return null;
}

export function fireText(f: Fire | null): string {
  if (!f) return 'never';
  if (f.when === 'now') return 'due any moment';
  if (f.when === 'today') return `today ${f.time}`;
  if (f.when === 'tomorrow') return `tomorrow (${LONG_DAY[f.weekday]}) ${f.time}`;
  return `${LONG_DAY[f.weekday]} ${f.time}`;
}

/** "every day", or "Mon, Wed, Fri" (Monday first). */
export function daysText(days: number[]): string {
  const set = [...new Set(days)];
  if (set.length === 0 || set.length === 7) return 'every day';
  return set.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => SHORT_DAY[d]).join(', ');
}

/** For a reminder row on this device: when it will next arrive, or null if it is switched off or has nothing to send. */
export function nextForRow(id: keyof ReminderPlan, plan: ReminderPlan, program: DayDef[], tz: string, now: Date): string | null {
  if (!plan[id].on) return null;
  const item = buildPushSchedule(plan, program).find((r) => r.id === id);
  return item ? fireText(nextFire(item, tz, now)) : null;
}

// ---- What the server holds ----

export interface ServerRow {
  endpoint: string;
  tz: string;
  schedule: unknown;
  last_sent: unknown;
  updated_at?: string;
  /** When the server started failing to reach this device, and the error it got. Absent until supabase/push.sql is re-run. */
  failing_since?: string | null;
  last_error?: string | null;
}

/** A device the server has not been able to reach for this long is worth telling the person about. A shorter blip is not. */
export const FAILING_AFTER_HOURS = 24;

export interface Failing {
  /** The day it started, such as "17 Oct", in the viewer's own time zone. */
  since: string;
  hours: number;
  /** The push service's error code, "network", or "blocked"; null when not known. */
  code: string | null;
}

export function failingInfo(row: Pick<ServerRow, 'failing_since' | 'last_error'>, now: Date, viewerTz: string): Failing | null {
  const t = row.failing_since ? Date.parse(row.failing_since) : NaN;
  if (Number.isNaN(t)) return null;
  const hours = (now.getTime() - t) / 3_600_000;
  if (hours < FAILING_AFTER_HOURS) return null;
  const fmt = (timeZone: string) => new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(new Date(t));
  let since: string;
  try {
    since = fmt(viewerTz);
  } catch {
    since = fmt('UTC');
  }
  const code = typeof row.last_error === 'string' && row.last_error.trim() ? row.last_error.trim().slice(0, 30) : null;
  return { since, hours: Math.floor(hours), code };
}

/** What to tell the person, and what to do about it. */
export function failingText(f: Failing, thisDevice: boolean): string {
  const why = !f.code ? '' : f.code === 'network' ? ' (no connection to the push service)' : f.code === 'blocked' ? ' (its address was refused)' : /^\d+$/.test(f.code) ? ` (the push service said ${f.code})` : '';
  return `Couldn’t reach ${thisDevice ? 'this device' : 'it'} since ${f.since}${why}. Turn push off and on again${thisDevice ? '' : ' on that device'}.`;
}

/** Reads a stored schedule defensively: anything malformed is skipped. */
export function readSchedule(raw: unknown): PushItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PushItem[] = [];
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

export interface ItemView {
  id: string;
  name: string;
  time: string;
  daysText: string;
  next: string;
  lastSent: string | null;
}

export interface DeviceView {
  endpoint: string;
  isThis: boolean;
  /** Which push service the device uses, from the address, so two devices can be told apart. */
  service: string;
  tz: string;
  updatedAgo: string;
  items: ItemView[];
  /** Set when the server has not been able to reach the device for a day or more. */
  failing: Failing | null;
  /** For this device only: the server holds exactly what the screen says. Always true for other devices. */
  inSync: boolean;
  /** "3 hours ago" when the server's last attempt to reach this device failed, otherwise null. */
  unreachable: string | null;
}

export function serviceName(endpoint: string): string {
  let host = '';
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return 'unknown service';
  }
  if (host.includes('googleapis') || host.includes('google')) return 'Chrome or Android';
  if (host.includes('apple')) return 'Apple (Safari or iPhone)';
  if (host.includes('mozilla')) return 'Firefox';
  if (host.includes('windows') || host.includes('microsoft')) return 'Edge or Windows';
  return host;
}

export function agoText(iso: string | undefined, now: Date): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return 'at an unknown time';
  const min = Math.max(0, Math.round((now.getTime() - t) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
}

/** Turns the server's rows into something readable, this device first. */
export function describeDevices(rows: ServerRow[], thisEndpoint: string | null, plan: ReminderPlan, program: DayDef[], now: Date, deviceTz: string): DeviceView[] {
  const wanted = JSON.stringify(buildPushSchedule(plan, program));
  const views = rows.map((r): DeviceView => {
    const schedule = readSchedule(r.schedule);
    const isThis = thisEndpoint !== null && r.endpoint === thisEndpoint;
    return {
      endpoint: r.endpoint,
      isThis,
      service: serviceName(r.endpoint),
      tz: r.tz,
      failing: failingInfo(r, now, deviceTz),
      updatedAgo: agoText(r.updated_at, now),
      items: schedule.map((i) => ({
        id: i.id,
        name: REMINDER_NAMES[i.id] ?? i.id,
        time: i.time,
        daysText: daysText(i.days),
        next: fireText(nextFire(i, r.tz, now, r.last_sent)),
        lastSent: typeof asObject(r.last_sent)[i.id] === 'string' ? (asObject(r.last_sent)[i.id] as string) : null,
      })),
      unreachable: typeof asObject(r.last_sent)._fail === 'string' && !Number.isNaN(Date.parse(asObject(r.last_sent)._fail as string)) ? agoText(asObject(r.last_sent)._fail as string, now) : null,
      inSync: !isThis || (JSON.stringify(schedule) === wanted && r.tz === deviceTz),
    };
  });
  return views.sort((a, b) => Number(b.isThis) - Number(a.isThis));
}
