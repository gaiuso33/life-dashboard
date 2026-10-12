import type { DayDef } from './program';

// Reminders without a server: a calendar file with repeating events and an alert on each. The phone's own calendar
// does the reminding, even when this app is closed, and nothing about the person is sent anywhere.

export interface ReminderPlan {
  checkin: { on: boolean; time: string };
  training: { on: boolean; time: string };
  money: { on: boolean; time: string };
  review: { on: boolean; time: string };
}

export const DEFAULT_REMINDERS: ReminderPlan = {
  checkin: { on: true, time: '21:00' },
  training: { on: true, time: '17:30' },
  money: { on: false, time: '20:00' },
  review: { on: true, time: '19:00' },
};

const SLOT = 'life-dashboard:v1:reminders';
const MADE_SLOT = 'life-dashboard:v1:reminders-made';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function loadReminders(): ReminderPlan {
  try {
    const raw = JSON.parse(localStorage.getItem(SLOT) ?? 'null') as Partial<ReminderPlan> | null;
    const out = structuredClone(DEFAULT_REMINDERS);
    for (const k of Object.keys(out) as (keyof ReminderPlan)[]) {
      const r = raw?.[k];
      if (r && typeof r.on === 'boolean') out[k].on = r.on;
      if (r && typeof r.time === 'string' && TIME.test(r.time)) out[k].time = r.time;
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

export function buildReminderEvents(plan: ReminderPlan, program: DayDef[]): Ev[] {
  const evs: Ev[] = [];
  if (plan.checkin.on) evs.push({ uid: 'checkin', title: 'Life Dashboard: check in', note: 'Tick your plates and rate your energy for today.', time: plan.checkin.time, days: [] });
  if (plan.training.on && program.length)
    evs.push({ uid: 'training', title: 'Life Dashboard: training today', note: program.map((d) => `${d.title}: ${d.focus}`).join('\n'), time: plan.training.time, days: program.map((d) => d.weekday) });
  if (plan.money.on) evs.push({ uid: 'money', title: 'Life Dashboard: log today’s spending', note: 'Add anything you spent or received today.', time: plan.money.time, days: [] });
  if (plan.review.on) evs.push({ uid: 'review', title: 'Life Dashboard: weekly review', note: 'Look at the week, then set up the next one.', time: plan.review.time, days: [0] });
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
