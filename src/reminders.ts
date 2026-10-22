import type { DayDef } from './program';

// Reminders without a server: a calendar file with repeating events and an alert on each. The phone's own calendar
// does the reminding, even when this app is closed, and nothing about the person is sent anywhere.

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type ReminderId = 'checkin' | 'training' | 'money' | 'review';
export const REMINDER_IDS: ReminderId[] = ['checkin', 'training', 'money', 'review'];

export interface Reminder {
  on: boolean;
  /** 24-hour "HH:MM". */
  time: string;
  /** Weekdays chosen for this reminder (0 = Sunday). Left out, it follows the usual days (see `usualDays`). */
  days?: number[];
}

/** A window of the day in which nothing is sent. It may run past midnight, such as 22:00 to 07:00. */
export interface QuietHours {
  on: boolean;
  from: string;
  to: string;
}

export type ReminderPlan = Record<ReminderId, Reminder> & { quiet?: QuietHours };

export const DEFAULT_QUIET: QuietHours = { on: false, from: '22:00', to: '07:00' };

export const DEFAULT_REMINDERS: ReminderPlan = {
  checkin: { on: true, time: '21:00' },
  training: { on: true, time: '17:30' },
  money: { on: false, time: '20:00' },
  review: { on: true, time: '19:00' },
  quiet: { ...DEFAULT_QUIET },
};

export const anyReminderOn = (plan: ReminderPlan): boolean => REMINDER_IDS.some((id) => plan[id].on);

/** The days a reminder follows until the person picks their own. Empty means every day. */
export function usualDays(id: ReminderId, program: DayDef[]): number[] {
  if (id === 'training') return [...new Set(program.map((d) => d.weekday))].sort((a, b) => a - b);
  if (id === 'review') return [0];
  return [];
}

/** The days a reminder really applies on: the person's choice if they made one, otherwise the usual days. Empty means every day. */
export function reminderDays(plan: ReminderPlan, id: ReminderId, program: DayDef[]): number[] {
  const own = plan[id].days;
  if (!own || !own.length) return usualDays(id, program);
  const set = [...new Set(own)].sort((a, b) => a - b);
  return set.length === 7 ? [] : set;
}

/** Whether a time of day (minutes since midnight) is inside the quiet window. The end is the first minute that is allowed again. */
export function inQuiet(minutes: number, from: string, to: string): boolean {
  const f = TIME.exec(from);
  const t = TIME.exec(to);
  if (!f || !t) return false;
  const a = Number(f[1]) * 60 + Number(f[2]);
  const b = Number(t[1]) * 60 + Number(t[2]);
  if (a === b) return false;
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

/** Whether the plan's quiet hours cover a reminder's clock time ("HH:MM"). */
export function quietCovers(plan: ReminderPlan, time: string): boolean {
  const q = plan.quiet;
  const m = TIME.exec(time);
  return !!q && q.on && !!m && inQuiet(Number(m[1]) * 60 + Number(m[2]), q.from, q.to);
}

const SLOT = 'life-dashboard:v1:reminders';
const MADE_SLOT = 'life-dashboard:v1:reminders-made';

export function loadReminders(): ReminderPlan {
  try {
    const raw = JSON.parse(localStorage.getItem(SLOT) ?? 'null') as Partial<ReminderPlan> | null;
    const out = structuredClone(DEFAULT_REMINDERS);
    for (const k of REMINDER_IDS) {
      const r = raw?.[k];
      if (r && typeof r.on === 'boolean') out[k].on = r.on;
      if (r && typeof r.time === 'string' && TIME.test(r.time)) out[k].time = r.time;
      if (r && Array.isArray(r.days)) {
        const days = [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
        if (days.length) out[k].days = days;
      }
    }
    const q = raw?.quiet;
    if (q && typeof q === 'object') {
      const quiet = { ...DEFAULT_QUIET };
      if (typeof q.on === 'boolean') quiet.on = q.on;
      if (typeof q.from === 'string' && TIME.test(q.from)) quiet.from = q.from;
      if (typeof q.to === 'string' && TIME.test(q.to)) quiet.to = q.to;
      out.quiet = quiet;
    }
    return out;
  } catch {
    return structuredClone(DEFAULT_REMINDERS);
  }
}
export const saveReminders = (p: ReminderPlan) => {
  try {
    localStorage.setItem(SLOT, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
};
export const remindersMade = (): boolean => {
  try {
    return localStorage.getItem(MADE_SLOT) === '1';
  } catch {
    return false;
  }
};
export const markRemindersMade = () => {
  try {
    localStorage.setItem(MADE_SLOT, '1');
  } catch {
    /* storage unavailable */
  }
};

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/** Lines longer than 75 bytes are folded, as the calendar format requires. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

interface Ev {
  uid: string;
  title: string;
  note: string;
  time: string;
  /** 0 = Sunday. Empty means every day. */
  days: number[];
}

/** The first date, on or after `from` (a yyyy-mm-dd key), that falls on one of the weekdays. */
function firstDate(from: string, days: number[]): string {
  const [y, m, d] = from.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 7 && days.length && !days.includes(dt.getUTCDay()); i++) dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

/** The events for the calendar file. A reminder whose time falls in quiet hours is left out, as the push sender would skip it. */
export function buildReminderEvents(plan: ReminderPlan, program: DayDef[]): Ev[] {
  const text: Record<ReminderId, { title: string; note: string }> = {
    checkin: { title: 'Life Dashboard: check in', note: 'Tick your plates and rate your energy for today.' },
    training: { title: 'Life Dashboard: training today', note: program.map((d) => `${d.title}: ${d.focus}`).join('\n') },
    money: { title: 'Life Dashboard: log today’s spending', note: 'Add anything you spent or received today.' },
    review: { title: 'Life Dashboard: weekly review', note: 'Look at the week, then set up the next one.' },
  };
  const evs: Ev[] = [];
  for (const id of REMINDER_IDS) {
    if (!plan[id].on || (id === 'training' && !program.length) || quietCovers(plan, plan[id].time)) continue;
    evs.push({ uid: id, ...text[id], time: plan[id].time, days: reminderDays(plan, id, program) });
  }
  return evs;
}

/** A calendar file (.ics). Times are "floating", so they stay at the same clock time wherever the phone is. */
export function buildIcs(plan: ReminderPlan, program: DayDef[], today: string, now: Date = new Date()): string {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Life Dashboard//Reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Life Dashboard'];
  for (const e of buildReminderEvents(plan, program)) {
    const [hh, mm] = e.time.split(':').map(Number);
    const end = `${pad(Math.floor((hh * 60 + mm + 15) / 60) % 24)}${pad((mm + 15) % 60)}00`;
    const date = firstDate(today, e.days);
    L.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@life-dashboard`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${date}T${pad(hh)}${pad(mm)}00`,
      `DTEND:${date}T${end}`,
      e.days.length ? `RRULE:FREQ=WEEKLY;BYDAY=${e.days.map((d) => BYDAY[d]).join(',')}` : 'RRULE:FREQ=DAILY',
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(e.note)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(e.title)}`,
      'TRIGGER:PT0S',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(ics: string) {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'life-dashboard-reminders.ics';
  a.click();
  URL.revokeObjectURL(url);
  markRemindersMade();
}
